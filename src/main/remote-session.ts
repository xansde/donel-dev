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
import { resolvePermissionMode } from '../shared/commandBuilder';

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
  const bypass = resolvePermissionMode(claudeArgs, undefined) === 'bypassPermissions' || claudeArgs.includes('--dangerously-skip-permissions');
  if (!bypass) return [];
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
  const claudeScript = [
    '#!/usr/bin/env bash',
    `S="$HOME/${REMOTE_SESSIONS_DIR}/${input.sid}"`,
    `cd "$HOME"/${shQuote(input.homeRelativeDir)} || exit 1`,
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
    'mkdir -p "$S" && chmod 700 "$HOME/.donel" "$HOME/.donel/s" "$S"',
    `printf '%s' ${shQuote(b64(TMUX_CONF))} | base64 -d > "$HOME/.donel/tmux.conf"`,
    ...files.map((file) => `printf '%s' ${shQuote(b64(file.content))} | base64 -d > "$S"/${shQuote(file.name)} && chmod 600 "$S"/${shQuote(file.name)}`),
    '(cd "$D" && pwd) > "$S/dir"',
    // The CLI on a fresh machine opens on onboarding (theme + login method) and asks to trust the folder,
    // even with the account already written there by the accounts engine. Mark both as done, atomically.
    `command -v python3 >/dev/null 2>&1 && python3 -c ${shQuote(MARK_ONBOARDED_PY)} "$(cat "$S/dir")" >/dev/null 2>&1 || true`,
    'printf "DONEL_NEW\\n"; cat "$S/dir"',
    '',
  ].join('\n');
}

/** Pure — reads the answer of the setup script. */
export function parseRemoteSetupOutput(stdout: string, code: number | null): RemoteSetupResult {
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
  return { kind: 'error', message: code === 255 ? 'Não consegui entrar no lugar remoto por ssh.' : 'O lugar remoto não respondeu como esperado.' };
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

export function buildEndScript(sid: string): string {
  assertSessionId(sid);
  return [
    `tmux -L ${REMOTE_TMUX_SOCKET} kill-session -t ${shQuote(`donel-${sid}`)} 2>/dev/null`,
    `rm -rf "$HOME/${REMOTE_SESSIONS_DIR}"/${shQuote(sid)}`,
    '',
  ].join('\n');
}

/** Runs a script on the remote through stdin. */
export function runRemoteScript(sshTarget: string, script: string, timeoutMs = SETUP_TIMEOUT_MS): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, 'bash -l -s'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ code: null, stdout: '' });
      return;
    }
    let stdout = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
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
  sid: string;
  readonly remoteDir: string;
  pump: { child: ChildProcess; out: WriteStream } | null;
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
    const entry: LiveRemote = { sshTarget, sid, remoteDir, pump: null };
    this.live.set(ptyId, entry);
    return this.startPump(entry, remoteTranscriptPath(remoteDir, sid), sid);
  }

  /** `/clear`, `/resume` or fork inside the remote session: follow the new transcript. */
  repoint(ptyId: string, sid: string, remoteAbsoluteTranscript: string): string | null {
    const entry = this.live.get(ptyId);
    if (!entry) return null;
    if (entry.sid === sid && entry.pump) return this.mirrorPathFor(sid); // the hub and the main both follow the switch
    entry.sid = sid;
    this.stopPump(entry);
    return this.startPump(entry, remoteAbsoluteTranscript, sid);
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
    if (!entry) return;
    const sid = entry.sid;
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

  private startPump(entry: LiveRemote, remoteTranscript: string, sid: string): string {
    const mirror = this.mirrorPathFor(sid);
    mkdirSync(this.mirrorRoot, { recursive: true });
    const out = createWriteStream(mirror, { flags: 'w' });
    const target = remoteTranscript.startsWith('/') ? shQuote(remoteTranscript) : `"$HOME"/${shQuote(remoteTranscript)}`;
    const child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', entry.sshTarget, `tail -c +1 -F ${target} 2>/dev/null`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout?.pipe(out);
    child.on('error', () => out.end());
    entry.pump = { child, out };
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
    'SLUG=$(printf %s "$D" | sed "s/[^a-zA-Z0-9]/-/g")',
    `if [ -f "$HOME/.claude/projects/$SLUG/${sid}.jsonl" ]; then echo DONEL_HAS; else echo DONEL_HASNT; fi`,
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
