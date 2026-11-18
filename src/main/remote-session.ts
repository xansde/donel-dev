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
// - The transcript is mirrored into a local file, which the chat and the watchers read as if the session were local.
//   Every transcript of one place goes through ONE shared ssh (`remote-mirror.ts`, t-9ab0ce2e), never one per tab.
// - Closing the tab ends the remote session (`tmux kill-session`); closing the app does not: the tmux session
//   keeps working, and the next boot finds it (`discover`) and reattaches.

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import * as nodePath from 'node:path';
import { join } from 'node:path';
import { isBypassLaunch } from '../shared/launchPermission';
import type { RemoteAliveSession } from '../shared';
import type { SessionWhereLives } from '../shared/sessions';
import { isSafeWorktreeName } from '../shared/sessionWorktree';
import { DEFAULT_MIRROR_TIMING, MirrorHub, probeMirror, sshMirrorSpawner, type MirrorHubTiming, type SpawnMirror } from './remote-mirror';
import { sshGate, type SshGate } from './ssh-gate';

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

export const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
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
  /**
   * t-205b44c8 — only attach to the live tmux of `sid` (a resume of the conversation it carries past a `/clear`): when
   * it is gone, the setup answers `gone` and prepares nothing in its folder.
   */
  readonly attachOnly?: boolean;
}

export type RemoteSetupResult =
  | { readonly kind: 'new'; readonly remoteDir: string }
  | { readonly kind: 'alive'; readonly remoteDir: string; readonly meta: RemoteSessionMeta }
  /** t-205b44c8 — `attachOnly` and the tmux was not there: nothing was prepared. */
  | { readonly kind: 'gone' }
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
  // A Windows folder is read as one on any OS (the kit de abertura is built and tested off Windows too); on Windows
  // `node:path` already is `win32`, so nothing changes there.
  const { basename, relative, sep, isAbsolute } = /^[A-Za-z]:[\\/]|^\\\\/.test(localCwd) ? nodePath.win32 : nodePath;
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
    // `pwd -P` here too (t-fe46929a): a session born before #440 wrote its logical folder in `$S/dir`, and the mirror
    // of the reattached tab would follow a transcript folder the CLI never wrote (it names it after the physical cwd).
    '  printf "DONEL_ALIVE\\n"; { (cd "$(cat "$S/dir")" 2>/dev/null && pwd -P) || cat "$S/dir"; }; tr -d "\\n" < "$S/meta.json"; printf "\\n"; exit 0',
    'fi',
    ...(input.attachOnly ? ['echo DONEL_GONE; exit 0'] : []),
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
    // `pwd -P`: the CLI names the transcript folder after its physical cwd (a symlinked project folder, as
    // `~/seazone/Homologação` → `/opt/homologacao/Homologacao`, is never the name it uses; t-f0fb2f2e).
    '(cd "$D" && pwd -P) > "$S/dir"',
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
    '  D=$(cd "$D" && pwd -P)',
    '  SLUG=$(printf %s "$D" | sed "s/[^a-zA-Z0-9]/-/g")',
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
  if (lines.includes('DONEL_GONE')) return { kind: 'gone' };
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

const DISCOVER_END = 'DONEL_DISCOVER_END';

/** Pure — lists the live sessions with their meta, then the end mark. */
export function buildDiscoverScript(): string {
  return [
    `for m in "$HOME"/${REMOTE_SESSIONS_DIR}/*/meta.json; do`,
    '  [ -f "$m" ] || continue',
    '  sid=$(basename "$(dirname "$m")")',
    `  tmux -L ${REMOTE_TMUX_SOCKET} has-session -t "donel-$sid" 2>/dev/null || continue`,
    '  printf "DONEL_META "; tr -d "\\n" < "$m"; printf "\\n"',
    'done',
    `printf "${DISCOVER_END}\\n"`,
    '',
  ].join('\n');
}

/**
 * t-fe46929a — the place listed all its live sessions. Without the mark, an ssh that failed, timed out or was cut
 * midway read as "no live session there", and the place's tabs did not come back after a restart.
 */
export function discoverAnswered(stdout: string): boolean {
  return stdout.split(/\r?\n/).some((line) => line.trim() === DISCOVER_END);
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

/**
 * Runs a script on the remote through stdin. `stderr` keeps the ssh's last words; `timedOut` when it was killed.
 * The login waits for a slot of the place (ssh-gate.ts); the timeout counts from the spawn, not from the wait.
 */
export async function runRemoteScript(
  sshTarget: string,
  script: string,
  timeoutMs = SETUP_TIMEOUT_MS,
  gate: SshGate = sshGate,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const release = await gate.acquire(sshTarget);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, 'bash -l -s'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      release();
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
      release(); // the script runs there: the login is done
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on('error', (error) => {
      release();
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on('close', (code) => {
      release();
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin?.end(script);
  });
}

type RemoteScriptAnswer = Awaited<ReturnType<typeof runRemoteScript>>;

/** Waits before each new try of a setup that fell on the ssh transport (t-205b44c8): about 45 s in all. */
export const SETUP_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000];

/**
 * Pure — whether a setup answer is the ssh transport failing (the script never answered), never the place saying no:
 * an exit 255 (ssh's own code, e.g. `kex_exchange_identification: Connection reset`) or a spawn that never ran. Any
 * `DONEL_` line means the script ran there, and its answer stands. A timeout is not retried: the try already waited
 * 180 s (a login waiting for a Tailscale check, a clone still running there), and four more would hold the tab
 * "connecting" for a quarter of an hour and take the place's login slot each time.
 */
export function isSetupTransportFailure(answer: RemoteScriptAnswer): boolean {
  if (answer.timedOut) return false;
  if (answer.stdout.split(/\r?\n/).some((line) => line.startsWith('DONEL_'))) return false;
  if (answer.code === 255) return true;
  return answer.code === null && answer.stdout.trim() === '';
}

/**
 * Runs the setup and, while it fails by ssh transport only (`isSetupTransportFailure`), waits and runs it again; every
 * try takes the place's login slot again (`runRemoteScript`). Returns the first answer that is not a transport
 * failure, or the last failure once `delays` ran out. A transport failure means the script never started there, so
 * the next try starts from the same state.
 */
export async function runSetupWithRetry(
  run: () => Promise<RemoteScriptAnswer>,
  options: {
    readonly delays?: readonly number[];
    readonly sleep?: (ms: number) => Promise<void>;
    readonly onRetry?: (attempt: number, said: string) => void;
  } = {},
): Promise<RemoteScriptAnswer> {
  const delays = options.delays ?? SETUP_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let answer = await run();
  for (let attempt = 1; attempt <= delays.length && isSetupTransportFailure(answer); attempt += 1) {
    options.onRetry?.(attempt, lastLine(answer.stderr));
    await sleep(delays[attempt - 1]);
    answer = await run();
  }
  return answer;
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
    remoteAttachCommand(input.sid),
  ];
}

/** Pure — what the place runs to show a tab's tmux: its own ssh's command, or its terminal on the place's link. */
export function remoteAttachCommand(sid: string): string {
  assertSessionId(sid);
  return `bash -l "$HOME/${REMOTE_SESSIONS_DIR}/${sid}/run.sh"`;
}

/** A free-looking port on the remote, for one reverse tunnel. */
export function pickRemotePort(random: () => number = Math.random): number {
  return 20000 + Math.floor(random() * 20000);
}

/** How a transcript reaches its mirror: the place's shared ssh, or (a place without python3) a tail of its own. */
type MirrorPump =
  | { readonly kind: 'hub'; readonly key: string; readonly hub: MirrorHub; readonly out: WriteStream; bytes: number }
  /** `child` is null while the tail waits for a login slot of the place; `stopped` once detached. */
  | { readonly kind: 'tail'; child: ChildProcess | null; readonly out: WriteStream; bytes: number; stopped?: true };

interface LiveRemote {
  readonly sshTarget: string;
  /** `~/.donel/s/<folder>`: the id the session was prepared with (it never follows `/clear`). */
  readonly folder: string;
  sid: string;
  readonly remoteDir: string;
  /** The transcript the mirror follows (it moves with `/clear`); a relink resumes it where it stopped. */
  transcript: string;
  pump: MirrorPump | null;
  /** `resumePump` is between ending the old mirror stream and appending with the new one. */
  restarting?: true;
  /** Its remote session was ended already (on the kill of the tab): the exit that follows does not end it again. */
  ended?: true;
}

export interface RemoteHeldFolder {
  readonly sshTarget: string;
  readonly folder: string;
}

/**
 * Pure — t-205b44c8: another tab of this app already holds the tmux `donel-<folder>` on that place. A second one there
 * would be two clients of the same CLI, and closing either would end it under the other.
 */
export function remoteFolderAlreadyLive(held: readonly RemoteHeldFolder[], sshTarget: string, folder: string): boolean {
  return held.some((entry) => entry.sshTarget === sshTarget && entry.folder === folder);
}

/** The live remote tabs of this run of the app: transcript mirrors and the end of the remote session. */
export class RemoteSessionRegistry {
  private readonly live = new Map<string, LiveRemote>();
  private readonly ending = new Map<string, Promise<void>>();
  /** One shared mirror ssh per place (t-9ab0ce2e). */
  private readonly hubs = new Map<string, MirrorHub>();
  /** Places whose shared mirror gave up: one tail per transcript there (until a later try brings the mirror back). */
  private readonly noMirrorHub = new Set<string>();
  /** The next try of the shared mirror of a place that gave up, by ssh target. */
  private readonly mirrorRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private nextKey = 0;
  private readonly spawnMirror: SpawnMirror;
  private readonly timing: MirrorHubTiming;
  private readonly spawnTail: (sshTarget: string, command: string) => ChildProcess;
  private readonly onMirrorFallback: (sshTarget: string, reason: string) => void;
  private readonly onMirrorBack: (sshTarget: string) => void;
  private readonly gate: SshGate;

  constructor(
    private readonly mirrorRoot: string,
    options: {
      readonly spawnMirror?: SpawnMirror;
      readonly timing?: Partial<MirrorHubTiming>;
      /** The per-tab `ssh … tail -F` of a place whose shared mirror gave up (tests pass a fake). */
      readonly spawnTail?: (sshTarget: string, command: string) => ChildProcess;
      /** A place's shared mirror gave up: its transcripts went back to one tail per tab (the main logs why). */
      readonly onMirrorFallback?: (sshTarget: string, reason: string) => void;
      /** A later try found the place's shared mirror working: its tabs went back to it (the main logs it). */
      readonly onMirrorBack?: (sshTarget: string) => void;
      /** The place's login slots (the app's one gate by default). */
      readonly gate?: SshGate;
    } = {},
  ) {
    this.spawnMirror = options.spawnMirror ?? sshMirrorSpawner(SSH_OPTIONS);
    this.timing = { ...DEFAULT_MIRROR_TIMING, ...options.timing };
    this.spawnTail =
      options.spawnTail ?? ((sshTarget, command) => spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, command], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
    this.onMirrorFallback = options.onMirrorFallback ?? (() => undefined);
    this.onMirrorBack = options.onMirrorBack ?? (() => undefined);
    this.gate = options.gate ?? sshGate;
  }

  has(ptyId: string): boolean {
    return this.live.has(ptyId);
  }

  /** The ssh target of a live remote tab (the Oráculo reads its proof files there). */
  sshTargetOf(ptyId: string): string | undefined {
    return this.live.get(ptyId)?.sshTarget;
  }

  /** The place's folder a live remote tab runs in (its worktree, when it has one): a renewal goes back to it. */
  remoteDirOf(ptyId: string): string | undefined {
    return this.live.get(ptyId)?.remoteDir;
  }

  mirrorPathFor(sid: string): string {
    return join(this.mirrorRoot, `${sid}.jsonl`);
  }

  /**
   * The tab was spawned: starts mirroring the transcript of `sid`; returns the local mirror path. `folder` is the tmux
   * session the tab attached to, when it is not the conversation's own (t-205b44c8: one that carries `sid` past a `/clear`).
   */
  attach(ptyId: string, sshTarget: string, sid: string, remoteDir: string, folder: string = sid): string {
    const entry: LiveRemote = { sshTarget, folder, sid, remoteDir, transcript: remoteTranscriptPath(remoteDir, sid), pump: null };
    this.live.set(ptyId, entry);
    return this.startPump(entry, entry.transcript, sid);
  }

  /** Oráculo na VPS (fatia 4): the live remote tabs, by the folder their MCP gate knows them by. */
  liveSessions(): { readonly ptyId: string; readonly folder: string }[] {
    return [...this.live].map(([ptyId, entry]) => ({ ptyId, folder: entry.folder }));
  }

  /** t-205b44c8 — the tmux folder each live remote tab holds, by place; one whose end was already asked is let go. */
  heldFolders(): RemoteHeldFolder[] {
    return [...this.live.values()].filter((entry) => !entry.ended).map((entry) => ({ sshTarget: entry.sshTarget, folder: entry.folder }));
  }

  /** `/clear`, `/resume` or fork inside the remote session: follow the new transcript. */
  repoint(ptyId: string, sid: string, remoteAbsoluteTranscript: string): string | null {
    const entry = this.live.get(ptyId);
    if (!entry) return null;
    // The hub and the main both follow the switch; a restart under way already follows this transcript.
    if (entry.sid === sid && (entry.pump || entry.restarting)) return this.mirrorPathFor(sid);
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
    if (entry) this.restartPump(entry);
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
    this.stopped = true;
    for (const timer of this.mirrorRetries.values()) clearTimeout(timer);
    this.mirrorRetries.clear();
    for (const ptyId of [...this.live.keys()]) this.onPtyExit(ptyId);
  }

  /** A new mirror stream from the byte the old one had, once the old one flushed (appending, never rewriting). */
  private restartPump(entry: LiveRemote): void {
    const old = entry.pump;
    const from = old?.bytes ?? 0;
    entry.pump = null;
    const start = (): void => {
      delete entry.restarting;
      if (![...this.live.values()].includes(entry) || entry.pump) return; // closed, or repointed, meanwhile
      this.startPump(entry, entry.transcript, entry.sid, from);
    };
    if (!old) return start();
    entry.restarting = true;
    this.detach(entry, old);
    old.out.end(start); // the old stream flushes before the new one appends
  }

  private startPump(entry: LiveRemote, remoteTranscript: string, sid: string, fromByte = 0): string {
    const mirror = this.mirrorPathFor(sid);
    mkdirSync(this.mirrorRoot, { recursive: true });
    const out = createWriteStream(mirror, { flags: fromByte > 0 ? 'a' : 'w' });
    if (this.noMirrorHub.has(entry.sshTarget)) {
      entry.pump = this.startTail(entry, remoteTranscript, out, fromByte);
      return mirror;
    }
    let hub = this.hubs.get(entry.sshTarget);
    if (!hub) {
      const target = entry.sshTarget;
      hub = new MirrorHub(target, this.spawnMirror, this.timing, (_follows, reason, permanent) => this.fallBackToTails(target, reason, permanent));
      this.hubs.set(target, hub);
    }
    const pump: MirrorPump = { kind: 'hub', key: String(++this.nextKey), hub, out, bytes: fromByte };
    entry.pump = pump;
    hub.add({
      key: pump.key,
      path: remoteTranscript,
      bytes: () => pump.bytes,
      write: (data) => {
        if (entry.pump !== pump) return; // a late frame of a stopped follow
        pump.bytes += data.length;
        out.write(data);
      },
    });
    return mirror;
  }

  /**
   * The shared mirror of a place gave up: each of its transcripts gets its own `ssh … tail -F`, as before the shared
   * ssh. Unless the place has no python3, the mirror is asked again later (`retryAfterMs`).
   */
  private fallBackToTails(sshTarget: string, reason: string, permanent: boolean): void {
    this.noMirrorHub.add(sshTarget);
    this.onMirrorFallback(sshTarget, reason);
    this.hubs.delete(sshTarget);
    for (const entry of this.live.values()) if (entry.sshTarget === sshTarget && entry.pump?.kind === 'hub') this.restartPump(entry);
    if (!permanent) this.scheduleMirrorRetry(sshTarget);
  }

  /**
   * One try of the place's shared mirror, with nothing on it: the tails keep the chat going meanwhile, so a try that
   * fails costs one ssh and no tab loses a byte. Up → every tail of the place moves back to the shared ssh, from the
   * byte its mirror has. Not up → the place is asked again after the same wait.
   */
  private scheduleMirrorRetry(sshTarget: string): void {
    if (this.stopped || this.mirrorRetries.has(sshTarget)) return;
    const timer = setTimeout(() => {
      if (![...this.live.values()].some((entry) => entry.sshTarget === sshTarget)) {
        // No tab left there: the next one starts the shared mirror as any place would.
        this.mirrorRetries.delete(sshTarget);
        this.noMirrorHub.delete(sshTarget);
        return;
      }
      void probeMirror(this.spawnMirror, sshTarget, this.timing.startupTimeoutMs).then((up) => {
        this.mirrorRetries.delete(sshTarget);
        if (this.stopped || !this.noMirrorHub.has(sshTarget)) return;
        if (!up) return this.scheduleMirrorRetry(sshTarget);
        this.noMirrorHub.delete(sshTarget);
        this.onMirrorBack(sshTarget);
        for (const entry of this.live.values()) if (entry.sshTarget === sshTarget && entry.pump?.kind === 'tail') this.restartPump(entry);
      });
    }, this.timing.retryAfterMs);
    this.mirrorRetries.set(sshTarget, timer);
  }

  /**
   * One `ssh … tail -F` for one transcript. It waits for a login slot of the place first (t-eb9a736a): when a
   * place's shared mirror gives up, every tab there moves to a tail at once, and those logins are spread out.
   */
  private startTail(entry: LiveRemote, remoteTranscript: string, out: WriteStream, fromByte: number): MirrorPump {
    const target = remoteTranscript.startsWith('/') ? shQuote(remoteTranscript) : `"$HOME"/${shQuote(remoteTranscript)}`;
    const pump: MirrorPump & { kind: 'tail' } = { kind: 'tail', child: null, out, bytes: fromByte };
    void this.gate.acquire(entry.sshTarget).then((release) => {
      if (pump.stopped) return release(); // detached (tab closed, repointed) while it waited
      let child: ChildProcess;
      try {
        child = this.spawnTail(entry.sshTarget, `tail -c +${fromByte + 1} -F ${target} 2>/dev/null`);
      } catch {
        release();
        out.end();
        return;
      }
      pump.child = child;
      child.stdout?.on('data', (chunk: Buffer) => {
        release();
        pump.bytes += chunk.length;
      });
      child.stdout?.pipe(out);
      child.on('close', release);
      child.on('error', () => {
        release();
        out.end();
      });
    });
    return pump;
  }

  /** Stops what feeds a mirror, leaving its stream to the caller. */
  private detach(entry: LiveRemote, pump: MirrorPump): void {
    if (pump.kind === 'tail') {
      pump.stopped = true;
      pump.child?.stdout?.unpipe(pump.out);
      pump.child?.kill();
      return;
    }
    pump.hub.remove(pump.key);
    if (pump.hub.size === 0 && this.hubs.get(entry.sshTarget) === pump.hub) this.hubs.delete(entry.sshTarget);
  }

  private stopPump(entry: LiveRemote): void {
    const pump = entry.pump;
    if (!pump) return;
    entry.pump = null;
    this.detach(entry, pump);
    pump.out.end();
  }
}

/**
 * Pure — answers `DONEL_HAS` when the transcript of `sid` exists for the project folder (`homeRelativeDir`, as
 * `remoteDirFor` gives it). The CLI names the transcript folder after the absolute path, so the slug is taken there.
 * `otherIds` (t-205b44c8): the place's other conversations; each one whose tmux is alive there (the setup's ALIVE test)
 * AND whose CLI is on `sid` now comes first as `DONEL_LIVE <id>`: after a `/clear` that tmux still runs the CLI, on
 * `sid`. "On `sid`" is the `current` mark its SessionStart hook writes (`conversationMarkCommand`): a tmux left alive
 * on its own conversation (a renewal whose `endRemote` failed) or born before the mark existed is never attached to.
 */
export function buildHasTranscriptScript(homeRelativeDir: string, sid: string, otherIds: readonly string[] = []): string {
  assertSessionId(sid);
  const others = otherIds.filter((id) => id !== sid);
  others.forEach(assertSessionId);
  const folder = (id: string): string => `"$HOME/${REMOTE_SESSIONS_DIR}/${id}`;
  return [
    ...others.map(
      (id) =>
        `if [ -f ${folder(id)}/meta.json" ] && [ -f ${folder(id)}/dir" ] && [ "$(cat ${folder(id)}/current" 2>/dev/null)" = ${shQuote(sid)} ] && tmux -L ${REMOTE_TMUX_SOCKET} has-session -t ${shQuote(`donel-${id}`)} 2>/dev/null; then echo DONEL_LIVE ${id}; fi`,
    ),
    // Physical path: the CLI's folder slug comes from its real cwd, never from a symlink on the way (t-f0fb2f2e).
    `D=$(cd "$HOME"/${shQuote(homeRelativeDir)} 2>/dev/null && pwd -P) || { echo DONEL_HASNT; exit 0; }`,
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

/** Pure — the first of the place's other conversations whose tmux is alive there (`DONEL_LIVE <id>`), if any. */
function parseLiveSessionId(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^DONEL_LIVE ([A-Za-z0-9-]{1,64})$/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

export interface RemoteTranscriptPlaceAnswer {
  readonly id: string;
  readonly answer: RemoteTranscriptAnswer;
  /** t-205b44c8 — another conversation of the place whose tmux is alive there (its CLI went on past a `/clear`). */
  readonly liveSessionId?: string;
}

/**
 * Pure — B39, where a conversation to resume lives, from what this disk and each remote place answered. Without
 * remote places it is this computer; with them, a conversation none of them has is `nowhere`, never this computer.
 * A place where another conversation of the same board place still runs in tmux wins (t-205b44c8): the resume attaches
 * to that tmux instead of starting a second CLI on the conversation it carries now.
 */
export function decideWhereLives(
  local: boolean,
  answers: ReadonlyArray<RemoteTranscriptPlaceAnswer>,
  places: ReadonlyArray<{ readonly id: string; readonly label: string }>,
): SessionWhereLives {
  if (local) return { kind: 'local' };
  if (places.length === 0) return { kind: 'local' };
  const running = answers.find((answer) => answer.liveSessionId !== undefined);
  if (running?.liveSessionId) return { kind: 'remote', remoteId: running.id, liveSessionId: running.liveSessionId };
  const found = answers.find((answer) => answer.answer === 'has');
  if (found) return { kind: 'remote', remoteId: found.id };
  const labelOf = (id: string): string => places.find((place) => place.id === id)?.label ?? id;
  const silent = answers.filter((answer) => answer.answer === 'unreachable');
  if (silent.length > 0) return { kind: 'unreachable', labels: silent.map((answer) => labelOf(answer.id)) };
  // t-e72ca49e — every place said "hasn't": the old `local` opened an empty `claude -r` on this computer.
  return { kind: 'nowhere', labels: places.map((place) => place.label) };
}

/**
 * B39 — asks each place whether the conversation `sid` of the project folder `homeRelativeDir` lives there, and in the
 * same ssh whether one of the board place's `otherIds` still runs in tmux there (t-205b44c8).
 */
export async function findRemoteTranscript(
  places: ReadonlyArray<{ readonly id: string; readonly sshTarget: string }>,
  homeRelativeDir: string,
  sid: string,
  otherIds: readonly string[] = [],
  run: RunDiscover = (sshTarget, script, timeoutMs) => runRemoteScript(sshTarget, script, timeoutMs),
): Promise<RemoteTranscriptPlaceAnswer[]> {
  const script = buildHasTranscriptScript(homeRelativeDir, sid, otherIds);
  return Promise.all(
    places.map(async (place) => {
      const { stdout } = await run(place.sshTarget, script, 20_000);
      const liveSessionId = parseLiveSessionId(stdout);
      return { id: place.id, answer: parseHasTranscriptOutput(stdout), ...(liveSessionId ? { liveSessionId } : {}) };
    }),
  );
}

/** How one place answered the discover (main-events.log keeps it: a silent place is why its tabs did not come back). */
export interface DiscoverPlaceOutcome {
  readonly id: string;
  readonly sshTarget: string;
  /** The place listed all its live sessions (the end mark came). */
  readonly answered: boolean;
  readonly found: number;
  readonly code: number | null;
  readonly timedOut: boolean;
  /** The ssh's last words, when the place did not answer. */
  readonly said?: string;
}

export interface DiscoverResult {
  readonly sessions: RemoteDiscovered[];
  readonly places: DiscoverPlaceOutcome[];
}

type RunDiscover = (sshTarget: string, script: string, timeoutMs: number) => ReturnType<typeof runRemoteScript>;

/**
 * Live sessions of each place. A place that did not answer (ssh failed, timed out, cut midway) is said so in `places`,
 * with whatever sessions it did list: the caller asks it again instead of taking it for a place with nothing alive.
 */
export async function discoverRemoteSessions(
  places: ReadonlyArray<{ readonly id: string; readonly sshTarget: string }>,
  run: RunDiscover = (sshTarget, script, timeoutMs) => runRemoteScript(sshTarget, script, timeoutMs),
): Promise<DiscoverResult> {
  const answers = await Promise.all(
    places.map(async (place) => {
      const ran = await run(place.sshTarget, buildDiscoverScript(), 20_000);
      const sessions = parseDiscoverOutput(ran.stdout).map((meta) => ({ remoteId: place.id, meta }));
      const answered = !ran.timedOut && discoverAnswered(ran.stdout);
      const said = answered ? '' : lastLine(ran.stderr);
      const outcome: DiscoverPlaceOutcome = {
        id: place.id,
        sshTarget: place.sshTarget,
        answered,
        found: sessions.length,
        code: ran.code,
        timedOut: ran.timedOut,
        ...(said ? { said } : {}),
      };
      return { sessions, outcome };
    }),
  );
  return { sessions: answers.flatMap((answer) => answer.sessions), places: answers.map((answer) => answer.outcome) };
}
