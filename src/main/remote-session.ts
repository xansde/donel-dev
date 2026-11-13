// Sessões remotas — the `claude` of a tab runs on a remote place (a VPS reached by ssh), inside a tmux session
// that outlives the app. Design: docs/adr/0006-sessoes-em-lugares-remotos.md.
//
// How one session is wired:
// - A setup script goes through `ssh … bash -l -s` (stdin, never argv): it creates `~/.donel/s/<sid>/`, clones
//   the project when the folder is missing, and writes the files the session needs (per-session `--settings`,
//   `--mcp-config`, role prompt, the launch scripts and `meta.json`). When the tmux session of that id is still
//   alive it writes nothing and answers with the meta it already has (tokens and ports of the live CLI).
// - The tab's PTY is `ssh -t -R <remote>:127.0.0.1:<local> … bash -l run.sh`; `run.sh` attaches to (or creates)
//   `tmux -L donel new-session -A -s donel-<sid>`. The reverse tunnels carry the hooks and the MCP back to the app.
// - The transcript is mirrored: `ssh … tail -c +1 -F <jsonl>` streams into a local file, which the chat and the
//   watchers read as if the session were local.
// - Closing the tab ends the remote session (`tmux kill-session`); closing the app does not: the tmux session
//   keeps working, and the next boot finds it (`discover`) and reattaches.

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { basename, join, relative, sep, isAbsolute } from 'node:path';
import { isBypassLaunch } from '../shared/launchPermission';
import type { RemoteAliveSession } from '../shared';
import { isSafeWorktreeName } from '../shared/sessionWorktree';

export const REMOTE_TMUX_SOCKET = 'donel';
export const REMOTE_SESSIONS_DIR = '.donel/s';

/**
 * Marks `~/.claude.json` of the remote place as onboarded (theme chosen) and the project folder (argv[1]) as
 * trusted. Only non-secret flags; `oauthAccount` and credentials are never read or touched here.
 */
const MARK_ONBOARDED_PY = [
  'import json,os,sys',
  'p=os.path.expanduser("~/.claude.json")',
  'd=json.load(open(p)) if os.path.exists(p) else {}',
  'd["hasCompletedOnboarding"]=True',
  'd.setdefault("theme","dark")',
  'pr=d.setdefault("projects",{}).setdefault(sys.argv[1],{})',
  'pr["hasTrustDialogAccepted"]=True',
  't=p+".donel-tmp"',
  'f=open(t,"w");json.dump(d,f,indent=2);f.close();os.chmod(t,0o600);os.replace(t,p)',
].join('\n');

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
const SETUP_TIMEOUT_MS = 180_000; // a clone can take a while
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** What the remote keeps about a live session, so a reattach reuses the same tokens and ports. */
export interface RemoteSessionMeta {
  readonly sid: string;
  readonly hookToken: string;
  readonly hookPort: number;
  readonly mcpToken: string | null;
  readonly mcpPort: number | null;
  /** Local project folder the tab belongs to (sidebar, git, files). */
  readonly localCwd: string;
  readonly projectName: string;
  readonly name: string;
  readonly launchArgs: readonly string[];
  /** Place of the session that opened this one (`sessao_abrir`); absent when the owner opened it. */
  readonly openedBy?: string;
  /** Líder único na VPS — the role and the Jobu's mark, so the tab that comes back after a restart is the Líder again. */
  readonly roleId?: string;
  readonly leaderOfAll?: boolean;
  readonly createdAt: string;
}

/** A file the setup writes under the session folder. */
export interface RemoteFile {
  readonly name: string;
  readonly content: string;
}

export interface RemoteSetupInput {
  readonly sid: string;
  /** Project folder relative to `$HOME`, posix separators. */
  readonly homeRelativeDir: string;
  readonly repoUrl: string | null;
  readonly branch: string | null;
  readonly files: readonly RemoteFile[];
  /** Argv of `claude`; an argument starting with `@S/` is a file of the session folder. */
  readonly claudeArgs: readonly string[];
  readonly meta: RemoteSessionMeta;
  /**
   * t-58b67066 — a worktree of its own for the session (`<project>/.claude/worktrees/<name>`, branch
   * `worktree-<name>` from the project's HEAD), created here when missing: sessions on a place share its project
   * folder, and one switching the branch there pulled it from under the others. Absent = the project folder, except
   * a conversation that was born in a worktree, which goes back to it.
   */
  readonly worktree?: string;
}

export type RemoteSetupResult =
  | { readonly kind: 'new'; readonly remoteDir: string }
  | { readonly kind: 'alive'; readonly remoteDir: string; readonly meta: RemoteSessionMeta }
  | { readonly kind: 'error'; readonly message: string };

export interface RemoteDiscovered {
  readonly remoteId: string;
  readonly meta: RemoteSessionMeta;
}

/** Pure — POSIX single-quote. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function assertSessionId(sid: string): void {
  if (!SESSION_ID_PATTERN.test(sid)) throw new Error('Id de sessão inválido para lugar remoto.');
}

/**
 * Pure — the remote folder of a local project: the same path below the project root, under a folder named like
 * the root (`C:\Users\x\seazone\Donel Dev` with root `C:\Users\x\seazone` → `seazone/Donel Dev`).
 */
export function remoteDirFor(localCwd: string, projectRoots: readonly string[]): string {
  const normalized = (path: string): string => path.replace(/[\\/]+$/, '');
  const cwd = normalized(localCwd);
  const root = projectRoots
    .map(normalized)
    .filter((candidate) => {
      const rel = relative(candidate, cwd);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    })
    .sort((a, b) => b.length - a.length)[0];
  if (!root) return basename(cwd);
  return [basename(root), ...relative(root, cwd).split(sep)].filter((part) => part.length > 0).join('/');
}

/** Pure — the slug the CLI gives the transcript folder of an absolute posix path. */
export function remoteTranscriptPath(remoteDir: string, sid: string): string {
  return `.claude/projects/${remoteDir.replace(/[^a-zA-Z0-9]/g, '-')}/${sid}.jsonl`;
}

/**
 * Pure — the env lines a bypass session needs on a remote place. Without them the CLI asks to confirm the bypass,
 * and as root it refuses it outright unless `IS_SANDBOX=1` (checked on the place, at launch: the app does not
 * know which user the ssh target is).
 */
function bypassEnvLines(claudeArgs: readonly string[]): string[] {
  if (!isBypassLaunch(claudeArgs)) return [];
  return ['export CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1', 'if [ "$(id -u)" = 0 ]; then export IS_SANDBOX=1; fi'];
}

function renderArg(arg: string): string {
  return arg.startsWith('@S/') ? `"$S"/${shQuote(arg.slice(3))}` : shQuote(arg);
}

const TMUX_CONF = [
  'set -g status off',
  'set -g mouse on',
  'set -g history-limit 50000',
  'set -g default-terminal "tmux-256color"',
  // Not 0: over ssh an escape sequence (the terminal's answer to tmux's queries) arrives split, and with 0 its
  // tail leaks into the CLI's input box as text (';23;24;28;32;42c'), which blocks the chat's send.
  'set -sg escape-time 50',
  'set -g set-clipboard on',
  'setw -g aggressive-resize on',
  '',
].join('\n');

/** Pure — the setup script (sent on stdin). Last lines: `DONEL_NEW` + dir, `DONEL_ALIVE` + dir + meta, or `DONEL_ERR`. */
export function buildRemoteSetupScript(input: RemoteSetupInput): string {
  assertSessionId(input.sid);
  if (input.worktree !== undefined && !isSafeWorktreeName(input.worktree)) throw new Error('Nome de worktree inválido para lugar remoto.');
  const claudeScript = [
    '#!/usr/bin/env bash',
    `S="$HOME/${REMOTE_SESSIONS_DIR}/${input.sid}"`,
    `cd "$HOME"/${shQuote(input.homeRelativeDir)} || exit 1`,
    // The folder the setup chose (the session's worktree, when it has one): the transcript is named after it.
    'if [ -f "$S/dir" ]; then cd "$(cat "$S/dir")" || exit 1; fi',
    'export CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1',
    'export LANG="${LANG:-C.UTF-8}" LC_ALL="${LC_ALL:-C.UTF-8}"',
    'export COLORTERM=truecolor',
    // Proxy de saída (scripts/proxy-saida): written by its VPS installer; only sessions started after the install pick it up.
    'if [ -r "$HOME/.donel/proxy-saida.env" ]; then . "$HOME/.donel/proxy-saida.env"; fi',
    ...bypassEnvLines(input.claudeArgs),
    `exec claude ${input.claudeArgs.map(renderArg).join(' ')}`,
    '',
  ].join('\n');
  const runScript = [
    '#!/usr/bin/env bash',
    `S="$HOME/${REMOTE_SESSIONS_DIR}/${input.sid}"`,
    // `-u`: the client is UTF-8 even when ssh brings no locale (without it tmux draws the CLI's box and `❯` as `_`,
    // and the chat never finds the input box). LANG for the same reason, for the CLI.
    'export LANG="${LANG:-C.UTF-8}" LC_ALL="${LC_ALL:-C.UTF-8}"',
    `exec tmux -u -L ${REMOTE_TMUX_SOCKET} -f "$HOME/.donel/tmux.conf" new-session -A -s ${shQuote(`donel-${input.sid}`)} "bash $S/claude.sh"`,
    '',
  ].join('\n');
  const files: RemoteFile[] = [
    ...input.files,
    { name: 'claude.sh', content: claudeScript },
    { name: 'run.sh', content: runScript },
    { name: 'meta.json', content: `${JSON.stringify(input.meta)}\n` },
  ];
  const repo = input.repoUrl ?? '';
  const branch = input.branch ?? '';
  return [
    'set -u',
    `SID=${shQuote(input.sid)}`,
    `S="$HOME/${REMOTE_SESSIONS_DIR}/$SID"`,
    `D="$HOME"/${shQuote(input.homeRelativeDir)}`,
    `if [ -f "$S/meta.json" ] && [ -f "$S/dir" ] && tmux -L ${REMOTE_TMUX_SOCKET} has-session -t "donel-$SID" 2>/dev/null; then`,
    '  printf "DONEL_ALIVE\\n"; cat "$S/dir"; tr -d "\\n" < "$S/meta.json"; printf "\\n"; exit 0',
    'fi',
    'command -v tmux >/dev/null 2>&1 || { echo "DONEL_ERR O tmux não está instalado no lugar remoto."; exit 3; }',
    'command -v claude >/dev/null 2>&1 || { echo "DONEL_ERR O claude não está instalado no lugar remoto."; exit 3; }',
    'if [ ! -d "$D" ]; then',
    `  REPO=${shQuote(repo)}; BRANCH=${shQuote(branch)}`,
    '  mkdir -p "$(dirname "$D")"',
    '  if [ -n "$REPO" ]; then',
    '    { gh repo clone "$REPO" "$D" -- -q || git clone -q "$REPO" "$D"; } >/dev/null 2>&1 || { echo "DONEL_ERR Não consegui clonar o projeto no lugar remoto ($REPO)."; exit 4; }',
    '    if [ -n "$BRANCH" ]; then git -C "$D" switch -q "$BRANCH" >/dev/null 2>&1 || true; fi',
    '  else',
    '    mkdir -p "$D"',
    '  fi',
    'fi',
    ...worktreeLines(input.worktree ?? ''),
    'mkdir -p "$S" && chmod 700 "$HOME/.donel" "$HOME/.donel/s" "$S"',
    `printf '%s' ${shQuote(b64(TMUX_CONF))} | base64 -d > "$HOME/.donel/tmux.conf"`,
    ...files.map((file) => `printf '%s' ${shQuote(b64(file.content))} | base64 -d > "$S"/${shQuote(file.name)} && chmod 600 "$S"/${shQuote(file.name)}`),
    '(cd "$D" && pwd) > "$S/dir"',
    // Oráculo na VPS (fatia 4): with the daemon's MCP gate there, the session calls it instead of its tunnel; the gate
    // passes the call on while the PC is on and answers who the session is and the tasks when it is off.
    'if [ -f "$S/mcp.json" ] && [ -r "$HOME/.donel/oraculo/portao" ]; then P="$(tr -dc 0-9 < "$HOME/.donel/oraculo/portao")"; if [ -n "$P" ]; then sed -i "s#http://127.0.0.1:[0-9]*/mcp#http://127.0.0.1:$P/s/$SID/mcp#" "$S/mcp.json"; fi; fi',
    // The CLI on a fresh machine opens on onboarding (theme + login method) and asks to trust the folder,
    // even with the account already written there by the accounts engine. Mark both as done, atomically.
    `command -v python3 >/dev/null 2>&1 && python3 -c ${shQuote(MARK_ONBOARDED_PY)} "$(cat "$S/dir")" >/dev/null 2>&1 || true`,
    'printf "DONEL_NEW\\n"; cat "$S/dir"',
    '',
  ].join('\n');
}

/**
 * The setup lines that move `D` into the session's worktree. Asked for one (`WT`): created from the project's HEAD
 * when missing, reused when it exists; a folder without git keeps the session in it. Without one, a conversation
 * whose transcript is in a worktree of the project (a resume) goes back there.
 */
function worktreeLines(worktree: string): string[] {
  return [
    `WT=${shQuote(worktree)}`,
    'if [ -n "$WT" ] && git -C "$D" rev-parse --git-dir >/dev/null 2>&1; then',
    '  W="$D/.claude/worktrees/$WT"',
    '  if [ ! -d "$W" ]; then',
    '    git -C "$D" worktree add -q -b "worktree-$WT" "$W" HEAD >/dev/null 2>&1 || git -C "$D" worktree add -q "$W" "worktree-$WT" >/dev/null 2>&1 || { echo "DONEL_ERR Não consegui criar a worktree $WT da sessão no lugar remoto."; exit 5; }',
    '  fi',
    '  D="$W"',
    'elif [ -z "$WT" ] && [ -d "$D/.claude/worktrees" ]; then',
    '  SLUG=$(cd "$D" && pwd | sed "s/[^a-zA-Z0-9]/-/g")',
    '  if [ ! -f "$HOME/.claude/projects/$SLUG/$SID.jsonl" ]; then',
    '    for W in "$D"/.claude/worktrees/*/; do',
    '      W="${W%/}"; [ -d "$W" ] || continue',
    '      if [ -f "$HOME/.claude/projects/$(printf %s "$W" | sed "s/[^a-zA-Z0-9]/-/g")/$SID.jsonl" ]; then D="$W"; break; fi',
    '    done',
    '  fi',
    'fi',
  ];
}

/** Pure — reads the answer of the setup script. */
export function parseRemoteSetupOutput(stdout: string, code: number | null, stderr = '', timedOut = false): RemoteSetupResult {
  const lines = stdout.split(/\r?\n/);
  const errLine = lines.find((line) => line.startsWith('DONEL_ERR'));
  if (errLine) return { kind: 'error', message: errLine.slice('DONEL_ERR'.length).trim() };
  const newAt = lines.indexOf('DONEL_NEW');
  if (newAt !== -1 && lines[newAt + 1]) return { kind: 'new', remoteDir: lines[newAt + 1].trim() };
  const aliveAt = lines.indexOf('DONEL_ALIVE');
  if (aliveAt !== -1) {
    try {
      const meta = JSON.parse(lines[aliveAt + 2] ?? '') as RemoteSessionMeta;
      return { kind: 'alive', remoteDir: (lines[aliveAt + 1] ?? '').trim(), meta };
    } catch {
      return { kind: 'error', message: 'O lugar remoto devolveu uma sessão ilegível.' };
    }
  }
  // 07/11 — the ssh's own words (e.g. Tailscale SSH asking for an extra check) are the cause the owner needs.
  const said = lastLine(stderr);
  if (timedOut) return { kind: 'error', message: `O lugar remoto não respondeu em ${Math.round(SETUP_TIMEOUT_MS / 1000)} s${said ? ` (o ssh disse: ${said})` : ' (o ssh ficou esperando, sem dizer por quê)'}.` };
  if (code === 255) return { kind: 'error', message: `Não consegui entrar no lugar remoto por ssh${said ? `: ${said}` : '.'}` };
  return { kind: 'error', message: `O lugar remoto não respondeu como esperado${said ? `: ${said}` : '.'}` };
}

/**
 * The ssh's last line, clean: it goes to a terminal and to another session's chat, so escape sequences (CSI, OSC)
 * and every other control character are dropped, and a lone `\r` (a redrawn progress line) counts as a new line.
 */
function lastLine(text: string): string {
  const clean = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]?/g, '');
  const lines = clean
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1] ?? '';
  return last.length > 300 ? `${last.slice(0, 300)}…` : last;
}

/** Pure — lists the live sessions with their meta. */
export function buildDiscoverScript(): string {
  return [
    `for m in "$HOME"/${REMOTE_SESSIONS_DIR}/*/meta.json; do`,
    '  [ -f "$m" ] || continue',
    '  sid=$(basename "$(dirname "$m")")',
    `  tmux -L ${REMOTE_TMUX_SOCKET} has-session -t "donel-$sid" 2>/dev/null || continue`,
    '  printf "DONEL_META "; tr -d "\\n" < "$m"; printf "\\n"',
    'done',
    '',
  ].join('\n');
}

export function parseDiscoverOutput(stdout: string): RemoteSessionMeta[] {
  const metas: RemoteSessionMeta[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('DONEL_META ')) continue;
    try {
      const meta = JSON.parse(line.slice('DONEL_META '.length)) as RemoteSessionMeta;
      if (typeof meta.sid === 'string' && SESSION_ID_PATTERN.test(meta.sid)) metas.push(meta);
    } catch {
      // a half-written meta is skipped; the next discover reads it whole
    }
  }
  return metas;
}

/** Pure — the tab a live remote session comes back as. The Líder único comes back with its mark and no project. */
export function remoteAliveFromMeta(remoteId: string, meta: RemoteSessionMeta): RemoteAliveSession {
  const leaderOfAll = meta.leaderOfAll === true;
  return {
    remoteId,
    sessionId: meta.sid,
    cwd: meta.localCwd,
    ...(leaderOfAll ? {} : { projectName: meta.projectName }),
    name: meta.name,
    launchArgs: meta.launchArgs,
    ...(typeof meta.openedBy === 'string' && meta.openedBy !== '' ? { openedBy: meta.openedBy } : {}),
    ...(typeof meta.roleId === 'string' && meta.roleId !== '' ? { roleId: meta.roleId } : {}),
    ...(leaderOfAll ? { leaderOfAll: true } : {}),
  };
}

/** Líder único na VPS — runs one command line on the place over ssh, with stdin and stdout piped (`lider/transfer.ts`). */
export function sshRemoteCommand(sshTarget: string): (command: string) => ChildProcess {
  return (command) => spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * "Sem ligação" — asks whether the tmux session of `sid` is still there. A place that prints neither marker (ssh
 * failed, timeout) is unreachable, never "gone": only `gone` lets the app give the place as closed.
 */
export async function probeRemoteSession(sshTarget: string, sid: string): Promise<'alive' | 'gone' | 'unreachable'> {
  assertSessionId(sid);
  const script = `if tmux -L ${REMOTE_TMUX_SOCKET} has-session -t ${shQuote(`donel-${sid}`)} 2>/dev/null; then echo DONEL_LIVE; else echo DONEL_GONE; fi\n`;
  const { stdout } = await runRemoteScript(sshTarget, script, 20_000);
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes('DONEL_LIVE')) return 'alive';
  if (lines.includes('DONEL_GONE')) return 'gone';
  return 'unreachable';
}

export function buildEndScript(sid: string): string {
  assertSessionId(sid);
  return [
    `tmux -L ${REMOTE_TMUX_SOCKET} kill-session -t ${shQuote(`donel-${sid}`)} 2>/dev/null`,
    `rm -rf "$HOME/${REMOTE_SESSIONS_DIR}"/${shQuote(sid)}`,
    '',
  ].join('\n');
}

/** Runs a script on the remote through stdin. `stderr` keeps the ssh's last words; `timedOut` when it was killed. */
export function runRemoteScript(
  sshTarget: string,
  script: string,
  timeoutMs = SETUP_TIMEOUT_MS,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, 'bash -l -s'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin?.end(script);
  });
}

/** Pure — argv of the tab's PTY (`ssh` with the reverse tunnels). */
export function buildAttachSshArgs(input: {
  readonly sshTarget: string;
  readonly sid: string;
  readonly tunnels: ReadonlyArray<{ readonly remotePort: number; readonly localPort: number }>;
}): string[] {
  assertSessionId(input.sid);
  return [
    '-t',
    ...SSH_OPTIONS,
    // A relink right after a drop can find the old tunnel still held on the place (its sshd has not noticed the
    // drop yet). Without this the ssh would attach with no tunnel at all, and hooks and MCP would stay refused;
    // with it the ssh leaves, and the app tries again later (remote-link.ts) until the old tunnel is gone.
    '-o', 'ExitOnForwardFailure=yes',
    ...input.tunnels.flatMap((tunnel) => ['-R', `127.0.0.1:${tunnel.remotePort}:127.0.0.1:${tunnel.localPort}`]),
    '--',
    input.sshTarget,
    `bash -l "$HOME/${REMOTE_SESSIONS_DIR}/${input.sid}/run.sh"`,
  ];
}

/** A free-looking port on the remote, for one reverse tunnel. */
export function pickRemotePort(random: () => number = Math.random): number {
  return 20000 + Math.floor(random() * 20000);
}

interface LiveRemote {
  readonly sshTarget: string;
  /** `~/.donel/s/<folder>`: the id the session was prepared with (it never follows `/clear`). */
  readonly folder: string;
  sid: string;
  readonly remoteDir: string;
  /** The transcript the mirror follows (it moves with `/clear`); a relink resumes it where it stopped. */
  transcript: string;
  pump: { child: ChildProcess; out: WriteStream; bytes: number } | null;
  /** Its remote session was ended already (on the kill of the tab): the exit that follows does not end it again. */
  ended?: true;
}

/** The live remote tabs of this run of the app: transcript mirrors and the end of the remote session. */
export class RemoteSessionRegistry {
  private readonly live = new Map<string, LiveRemote>();
  private readonly ending = new Map<string, Promise<void>>();

  constructor(private readonly mirrorRoot: string) {}

  has(ptyId: string): boolean {
    return this.live.has(ptyId);
  }

  /** The ssh target of a live remote tab (the Oráculo reads its proof files there). */
  sshTargetOf(ptyId: string): string | undefined {
    return this.live.get(ptyId)?.sshTarget;
  }

  mirrorPathFor(sid: string): string {
    return join(this.mirrorRoot, `${sid}.jsonl`);
  }

  /** The tab was spawned: starts mirroring the transcript; returns the local mirror path. */
  attach(ptyId: string, sshTarget: string, sid: string, remoteDir: string): string {
    const entry: LiveRemote = { sshTarget, folder: sid, sid, remoteDir, transcript: remoteTranscriptPath(remoteDir, sid), pump: null };
    this.live.set(ptyId, entry);
    return this.startPump(entry, entry.transcript, sid);
  }

  /** Oráculo na VPS (fatia 4): the live remote tabs, by the folder their MCP gate knows them by. */
  liveSessions(): { readonly ptyId: string; readonly folder: string }[] {
    return [...this.live].map(([ptyId, entry]) => ({ ptyId, folder: entry.folder }));
  }

  /** `/clear`, `/resume` or fork inside the remote session: follow the new transcript. */
  repoint(ptyId: string, sid: string, remoteAbsoluteTranscript: string): string | null {
    const entry = this.live.get(ptyId);
    if (!entry) return null;
    if (entry.sid === sid && entry.pump) return this.mirrorPathFor(sid); // the hub and the main both follow the switch
    entry.sid = sid;
    entry.transcript = remoteAbsoluteTranscript;
    this.stopPump(entry);
    return this.startPump(entry, remoteAbsoluteTranscript, sid);
  }

  /**
   * "Sem ligação" — the ssh of the tab was spawned again: the mirror's ssh fell with the same link (or will, once its
   * keepalive gives up), so a new one takes over from the byte the mirror already has. Appending, never rewriting:
   * a mirror read again from the start would show the chat's messages twice.
   */
  resumePump(ptyId: string): void {
    const entry = this.live.get(ptyId);
    if (!entry) return;
    const old = entry.pump;
    const from = old?.bytes ?? 0;
    entry.pump = null;
    const start = (): void => {
      if (this.live.get(ptyId) !== entry || entry.pump) return; // closed, or repointed, meanwhile
      this.startPump(entry, entry.transcript, entry.sid, from);
    };
    if (!old) return start();
    old.child.stdout?.unpipe(old.out);
    old.child.kill();
    old.out.end(start); // the old stream flushes before the new one appends
  }

  /** The PTY left (tab closed, app quitting or ssh dropped): stop mirroring. */
  onPtyExit(ptyId: string): void {
    const entry = this.live.get(ptyId);
    if (!entry) return;
    this.stopPump(entry);
    this.live.delete(ptyId);
  }

  /** The owner closed the tab: the remote session ends too. */
  endRemote(ptyId: string): void {
    const entry = this.live.get(ptyId);
    if (!entry || entry.ended) return;
    // Once per tab: a second end, after a respawn of the same id was set up, would end the new tmux.
    entry.ended = true;
    // The tmux session and its folder are named after the id the session was prepared with, never after the
    // conversation a `/clear` moved it to: ending by `entry.sid` left the tmux alive after the tab closed.
    const sid = entry.folder;
    const ending = runRemoteScript(entry.sshTarget, buildEndScript(sid), 20_000).then(() => undefined);
    this.ending.set(sid, ending);
    void ending.finally(() => {
      if (this.ending.get(sid) === ending) this.ending.delete(sid);
    });
  }

  /** A respawn of the same conversation (Reiniciar, Retomar) waits for its end, or it would attach to a dying tmux. */
  waitEnded(sid: string): Promise<void> {
    return this.ending.get(sid) ?? Promise.resolve();
  }

  stopAll(): void {
    for (const ptyId of [...this.live.keys()]) this.onPtyExit(ptyId);
  }

  private startPump(entry: LiveRemote, remoteTranscript: string, sid: string, fromByte = 0): string {
    const mirror = this.mirrorPathFor(sid);
    mkdirSync(this.mirrorRoot, { recursive: true });
    const out = createWriteStream(mirror, { flags: fromByte > 0 ? 'a' : 'w' });
    const target = remoteTranscript.startsWith('/') ? shQuote(remoteTranscript) : `"$HOME"/${shQuote(remoteTranscript)}`;
    const child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', entry.sshTarget, `tail -c +${fromByte + 1} -F ${target} 2>/dev/null`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pump = { child, out, bytes: fromByte };
    child.stdout?.on('data', (chunk: Buffer) => {
      pump.bytes += chunk.length;
    });
    child.stdout?.pipe(out);
    child.on('error', () => out.end());
    entry.pump = pump;
    return mirror;
  }

  private stopPump(entry: LiveRemote): void {
    if (!entry.pump) return;
    entry.pump.child.kill();
    entry.pump.out.end();
    entry.pump = null;
  }
}

/**
 * Pure — answers `DONEL_HAS` when the transcript of `sid` exists for the project folder (`homeRelativeDir`, as
 * `remoteDirFor` gives it). The CLI names the transcript folder after the absolute path, so the slug is taken there.
 */
export function buildHasTranscriptScript(homeRelativeDir: string, sid: string): string {
  assertSessionId(sid);
  return [
    `D=$(cd "$HOME"/${shQuote(homeRelativeDir)} 2>/dev/null && pwd) || { echo DONEL_HASNT; exit 0; }`,
    // The project folder, then the worktrees of the project's sessions (t-58b67066).
    'for F in "$D" "$D"/.claude/worktrees/*/; do',
    '  F="${F%/}"; [ -d "$F" ] || continue',
    `  if [ -f "$HOME/.claude/projects/$(printf %s "$F" | sed "s/[^a-zA-Z0-9]/-/g")/${sid}.jsonl" ]; then echo DONEL_HAS; exit 0; fi`,
    'done',
    'echo DONEL_HASNT',
    '',
  ].join('\n');
}

export type RemoteTranscriptAnswer = 'has' | 'hasnt' | 'unreachable';

/** Pure — a place that did not print either marker (ssh failed, timeout) is unreachable, never "has not". */
export function parseHasTranscriptOutput(stdout: string): RemoteTranscriptAnswer {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes('DONEL_HAS')) return 'has';
  if (lines.includes('DONEL_HASNT')) return 'hasnt';
  return 'unreachable';
}

/** B39 — asks each place whether the conversation `sid` of the project folder `homeRelativeDir` lives there. */
export async function findRemoteTranscript(
  places: ReadonlyArray<{ readonly id: string; readonly sshTarget: string }>,
  homeRelativeDir: string,
  sid: string,
): Promise<Array<{ readonly id: string; readonly answer: RemoteTranscriptAnswer }>> {
  const script = buildHasTranscriptScript(homeRelativeDir, sid);
  return Promise.all(
    places.map(async (place) => {
      const { stdout } = await runRemoteScript(place.sshTarget, script, 20_000);
      return { id: place.id, answer: parseHasTranscriptOutput(stdout) };
    }),
  );
}

/** Live sessions of each place. A place that does not answer is left out. */
export async function discoverRemoteSessions(places: ReadonlyArray<{ readonly id: string; readonly sshTarget: string }>): Promise<RemoteDiscovered[]> {
  const found = await Promise.all(
    places.map(async (place) => {
      const { stdout } = await runRemoteScript(place.sshTarget, buildDiscoverScript(), 20_000);
      return parseDiscoverOutput(stdout).map((meta) => ({ remoteId: place.id, meta }));
    }),
  );
  return found.flat();
}
