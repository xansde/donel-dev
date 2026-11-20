// Abrir sessão com o PC desligado (t-1a3f7150, fatia 3; docs/adr/0009) — the Líder único alive in this machine's tmux
// calls `sessao_abrir` while nothing listens on its tunnel, and this daemon opens the session itself, in this machine's
// tmux, with the same files the PC would make (`planRemoteLaunch`, the one plan of a remote launch) and the place
// `session:<sid>` the PC gives a live conversation it finds on its return (`freePlaceId`). The board itself
// (`mindscape.json`) is never written here.
//
// Rules (the board Líder's decisions, 18/11): only the Líder único local opens; any role but `lider`; the board is
// named and must be in the picture and in the PC's kit (`abrir.json`, open-kit.ts); a board with a live Líder gets
// the request instead (its Líder hands it out); the kit's `openCap` is counted on this machine's folders opened by the
// same opener on that board; no room (memory, load), no opening.
//
// t-d461e003 (19/11): the request the Líder único hands to a board Líder alive here would stop there, since that Líder
// got `NOT_THE_LEADER`. So a board Líder alive in this machine's tmux (`boardLeaders` of his board in the picture names
// his place) opens too, only on his own board (`quadro` may be left out), with the same rules; the new session is
// `openedBy` his place, so his opening arrow holds in the picture made here (retrato-local.ts).
//
// t-d461e003 (19/11, the satellite): a board this machine's picture does not have, but another machine's satellite
// pictures (the Homologação, on the Homologações), goes there (`remote`, abrir-satelite.ts): only the Líder único's. The
// satellite runs this same module: the Líder único's order comes through `openFor` (the registro checked who asked), a
// board Líder alive there opens on his own board by its gate (the rule above), the kit is the registro's copy, and the
// board's folder comes from that machine's own sessions of the board (`folderFromSessions`), never from the kit.
//
// Order: the folder with its `criando` mark → the synthetic picture (so the Líder's `tarefa_criar` for the new place
// passes the reach rules) → the first message and the setup (files and meta) → the tmux, last; the mark leaves at the
// end. A failure removes the folder. A repeat of the same call (board, role, request, name) within 10 min answers the
// same place (`abertas.json`). At boot, a folder still `criando` without its tmux is removed.
//
// t-49dee38d (20/11) — the successor of a session past the context limit, with the PC away (`openSuccessor`, called by
// renovar-local.ts, never by a tool): the SAME place, role, worktree, name and model as the session that leaves, read
// from the named fields of its meta (never its keys) and its `dir`; its meta gets `renovaDe` (the limitador reads it)
// and the first message is "read the handoff". It never touches the old session: renovar-local.ts ends it after.
//
// The session folder holds keys: nothing read from a meta here is ever shown or logged.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type { OwnerMessage } from '../main/ledger-card-writer';
import { OPEN_KIT_FILE, OPEN_KIT_VERSION, type OpenKit, type OpenKitRole } from '../main/open-kit';
import { planRemoteLaunch } from '../main/remote-launch-plan';
import { parseRemoteSetupOutput, REMOTE_TMUX_SOCKET, shQuote } from '../main/remote-session';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { MCP_SERVER_NAME } from '../shared/browser/mcp';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import type { MindscapeBoard } from '../shared/mindscape/model';
import { boardLeaders, hearingPlaceIds } from '../shared/mindscape/reach';
import { buildRemoteInventoryScript, buildRoleScopeSettings, EMPTY_INVENTORY, parseRemoteInventoryOutput, type RoleScopeSettings } from '../shared/role-scope';
import { LEADER_ROLE_ID } from '../shared/roles';
import { renewalLaunchArgs } from '../shared/sessionRenewal';
import { remoteSpawnWorktree, worktreeNameFor, worktreeNameFromArgs } from '../shared/sessionWorktree';
import type { GateAbrir, OpenCall } from './gate-abrir';
import type { LocalLeader } from './lider-local';
import { picturedBoards, type BoardPicture, type PictureSession } from './portao';

/** The repeats' memory, next to the kit (`~/.donel/oraculo`). */
export const OPENED_FILE = 'abertas.json';
/** In a session folder while it is being made. */
export const CREATING_MARK = 'criando';
/** A repeat of the same opening within this answers the same place. */
export const REPEAT_MS = 10 * 60_000;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const META_FILE = 'meta.json';
const PORT_MIN = 20000;
const PORT_SPAN = 20000;

export const NOT_THE_LEADER = 'Com o PC desligado, só o Líder único desta máquina abre sessão por aqui. Tente quando o PC ligar.';
const ONLY_OWN_BOARD = (own: string): string => `Com o PC desligado, o Líder do quadro abre só no próprio quadro (${own}). Para outro quadro, peça ao Líder único.`;
export const NO_KIT =
  'O PC ainda não deixou o kit de abertura (abrir.json, gravado quando o app do PC conecta a esta máquina): sem ele não sei os papéis nem as pastas dos quadros. Tente quando o PC ligar.';

export interface ScriptRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface OpenLocalDeps {
  /** `~/.donel/s`. */
  readonly sessionsDir: string;
  /** `~/.donel/oraculo` (the kit and the repeats' memory). */
  readonly oraculoDir: string;
  readonly picture: () => BoardPicture | null;
  /** Keeps one session's picture (the synthetic one of the new place). */
  readonly setSession: (sid: string, session: PictureSession) => void;
  /** Drops the synthetic picture of an opening that failed. */
  readonly forgetSession?: (sid: string) => void;
  /** The Líder único alive here (lider-local.ts). */
  readonly leader: () => Promise<LocalLeader | null>;
  /** This machine's live tmux sessions (folder sids). */
  readonly liveSessions: () => Promise<ReadonlySet<string>>;
  /** To the board's Líder: the recados of this machine, else the PC's relay. */
  readonly deliver: (message: OwnerMessage) => Promise<LedgerDeliveredTo>;
  /** Runs a bash script (on stdin) as the sessions' user, with its login PATH: the setup, the tmux, the inventory. */
  readonly run: (script: string) => Promise<ScriptRun>;
  /** Why this machine has no room now; `null` = room. */
  readonly room: () => string | null;
  /** Nothing listens on this loopback port. */
  readonly portFree: (port: number) => Promise<boolean>;
  /** Other names of this machine `onde` may use (its hostname). */
  readonly names?: readonly string[];
  /** The kit of roles and boards; default: the one the PC left in `oraculoDir` (the satellite's comes from the registro). */
  readonly kit?: () => OpenKit | null;
  /**
   * t-d461e003 — set (this machine's `$HOME`) = the board's folder comes from this machine's own sessions of that board
   * (`boardFolderFrom`), never from the kit's `homeRelativeDir`, which the PC made for the personal VPS. The satellite.
   */
  readonly folderFromSessions?: string;
  /**
   * t-d461e003 — the Líder único's `sessao_abrir` for a board this machine's picture does not have: to the machine whose
   * satellite pictures it (abrir-satelite.ts). `null` = no other machine has it (the refusal of today).
   */
  readonly remote?: (call: OpenCall) => Promise<BrowserToolOutcome | null>;
  /** This machine's `$HOME` (default `os.homedir()`): a successor's project folder is its old `dir` relative to it. */
  readonly home?: string;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly random?: () => number;
  readonly log?: (line: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The kit the PC left; `null` = none, unreadable or of another version. */
export function readOpenKit(oraculoDir: string): OpenKit | null {
  try {
    const raw = JSON.parse(readFileSync(join(oraculoDir, OPEN_KIT_FILE), 'utf8')) as unknown;
    if (!isRecord(raw) || raw.version !== OPEN_KIT_VERSION || !Array.isArray(raw.roles) || !Array.isArray(raw.boards) || !isRecord(raw.place)) return null;
    return raw as unknown as OpenKit;
  } catch {
    return null;
  }
}

/** The fields of a session folder's meta this needs (never its keys). */
interface FolderFacts {
  readonly sid: string;
  readonly openedBy?: string;
  readonly localCwd?: string;
  readonly ports: readonly number[];
  readonly worktree: string | null;
  /** The session's working folder (`dir`, written by its setup: the physical path, maybe a worktree). */
  readonly dir?: string;
}

function readDirFile(sessionsDir: string, sid: string): string | undefined {
  try {
    const dir = readFileSync(join(sessionsDir, sid, 'dir'), 'utf8').trim();
    return dir.startsWith('/') && !dir.includes('\n') ? dir : undefined;
  } catch {
    return undefined;
  }
}

function readFolders(sessionsDir: string): FolderFacts[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const out: FolderFacts[] = [];
  for (const sid of names) {
    if (!SID_PATTERN.test(sid)) continue;
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, sid, META_FILE), 'utf8')) as unknown;
      if (!isRecord(raw)) continue;
      const ports = [raw.hookPort, raw.mcpPort].filter((port): port is number => typeof port === 'number');
      const args = Array.isArray(raw.launchArgs) ? raw.launchArgs.filter((arg): arg is string => typeof arg === 'string') : [];
      out.push({
        sid,
        ...(typeof raw.openedBy === 'string' ? { openedBy: raw.openedBy } : {}),
        ...(typeof raw.localCwd === 'string' ? { localCwd: raw.localCwd } : {}),
        ports,
        worktree: worktreeNameFromArgs(args),
        ...(() => {
          const dir = readDirFile(sessionsDir, sid);
          return dir ? { dir } : {};
        })(),
      });
    } catch {
      // no meta yet (being made) or unreadable: not counted
    }
  }
  return out;
}

/** The project folder of a session's working folder: the part before its worktree (`/.claude/worktrees/<name>`). */
export function projectRootOf(dir: string): string {
  const at = dir.indexOf('/.claude/worktrees/');
  const root = at > 0 ? dir.slice(0, at) : dir;
  return root.length > 1 ? root.replace(/\/+$/, '') : root;
}

/**
 * t-d461e003 — pure: the board's folder on this machine from its own sessions of that board (`localCwd` = the board,
 * their `dir`), relative to `home` (`../` when it lives out of it: the setup does `cd "$HOME"/<it>`). The live ones
 * first; among them, the folder most of them use. A string = why none.
 */
export function boardFolderFrom(
  folders: readonly { readonly sid: string; readonly localCwd?: string; readonly dir?: string }[],
  live: ReadonlySet<string>,
  home: string,
  pasta: string,
  boardName: string,
  machine: string,
): { readonly homeRelativeDir: string } | string {
  const ofBoard = folders.filter((folder) => folder.localCwd === pasta && folder.dir);
  const pool = ofBoard.some((folder) => live.has(folder.sid)) ? ofBoard.filter((folder) => live.has(folder.sid)) : ofBoard;
  const counts = new Map<string, number>();
  for (const folder of pool) {
    const root = projectRootOf(folder.dir!);
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [root, count] of counts) if (best === null || count > counts.get(best)!) best = root;
  if (best === null) return `nenhuma sessão desta máquina (${machine}) mostra a pasta do quadro ${boardName}, e sem ela não sei onde abrir aqui. Abra a primeira sessão desse quadro nesta máquina pelo PC.`;
  return { homeRelativeDir: relative(home, best) || '.' };
}

/** Pure — why this machine has no room for one more session; `null` = room. */
export function roomRefusal(facts: { readonly freeBytes: number; readonly loadPerCpu: number }): string | null {
  const gib = facts.freeBytes / 1024 ** 3;
  if (gib < 1.5) return `memória livre ${gib.toFixed(1).replace('.', ',')} GB`;
  if (facts.loadPerCpu >= 2) return `carga ${facts.loadPerCpu.toFixed(1).replace('.', ',')} por CPU`;
  return null;
}

/** Pure — the script that starts the session's tmux, detached, and says whether it is alive. */
export function tmuxStartScript(sid: string): string {
  if (!SID_PATTERN.test(sid)) throw new Error('Id de sessão inválido.');
  const name = shQuote(`donel-${sid}`);
  return [
    'set -u',
    `S="$HOME/.donel/s/${sid}"`,
    'export LANG="${LANG:-C.UTF-8}" LC_ALL="${LC_ALL:-C.UTF-8}"',
    `tmux -u -L ${REMOTE_TMUX_SOCKET} -f "$HOME/.donel/tmux.conf" new-session -d -s ${name} "bash -l $S/claude.sh" </dev/null >/dev/null 2>&1 || exit 1`,
    `tmux -L ${REMOTE_TMUX_SOCKET} has-session -t ${name}`,
    '',
  ].join('\n');
}

/** The key of one opening: the same board, role, request and name is the same opening. */
export function openingKey(pasta: string, roleId: string, pedido: string, name: string): string {
  return createHash('sha256').update(JSON.stringify([pasta, roleId, pedido, name])).digest('hex').slice(0, 32);
}

interface OpenedEntry {
  readonly at: number;
  readonly sid: string;
  readonly answer: string;
}

function readOpened(file: string, now: number): Record<string, OpenedEntry> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isRecord(raw)) return {};
    const kept: Record<string, OpenedEntry> = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (isRecord(entry) && typeof entry.at === 'number' && typeof entry.sid === 'string' && typeof entry.answer === 'string' && now - entry.at < REPEAT_MS) {
        kept[key] = { at: entry.at, sid: entry.sid, answer: entry.answer };
      }
    }
    return kept;
  } catch {
    return {};
  }
}

function writePrivate(file: string, content: string): void {
  writeFileSync(`${file}.tmp`, content, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

function placeStatesOf(places: readonly unknown[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const place of places) if (isRecord(place) && typeof place.id === 'string') states.set(place.id, typeof place.estado === 'string' ? place.estado : '');
  return states;
}

/**
 * Pure — the picture the new session answers from until the PC pictures it: who it is (its place `session:<sid>`, as
 * the PC will name it), and the board of the freshest picture with the new place in it. Opened by the Líder único
 * (`openedBy` absent or `lider`): no arrow, he reaches the top of a board. Opened by a place of that board (its Líder):
 * his opening arrow to the new place, as retrato-local.ts draws it.
 */
export function syntheticPicture(input: {
  readonly sid: string;
  readonly name: string;
  readonly role: Pick<OpenKitRole, 'id' | 'name'>;
  readonly pasta: string;
  readonly projectName: string;
  readonly roda: string;
  readonly base: { readonly listar: readonly unknown[]; readonly board?: MindscapeBoard } | undefined;
  readonly at: number;
  /** The opener's place; absent = the Líder único. */
  readonly openedBy?: string;
}): PictureSession {
  const lugar = `session:${input.sid}`;
  const opener = input.openedBy ?? LEADER_OF_ALL;
  const others = (input.base?.listar ?? []).map((place) => {
    if (!isRecord(place)) return place;
    const { voce: _voce, podeMandar: _podeMandar, ...rest } = place;
    return rest;
  });
  const listar = [...others, { id: lugar, papel: input.role.id, papelNome: input.role.name, nome: input.name, estado: 'trabalhando', voce: true, abertaPor: opener }];
  const base = input.base?.board;
  const arrow = base && opener !== LEADER_OF_ALL && base.cards[opener]?.kind === 'session';
  const board: MindscapeBoard | undefined = base
    ? {
        ...base,
        cards: { ...base.cards, [lugar]: { kind: 'session', id: lugar, sessionId: input.sid, previous: [], roleId: input.role.id, by: 'session', x: 0, y: 0 } },
        ...(arrow ? { links: [...base.links, { id: `aberta:${opener}>${lugar}`, from: opener, to: lugar, arrow: true, by: 'session', opened: true }] } : {}),
      }
    : undefined;
  return {
    quemSou: { nome: input.name, projeto: input.projectName, pasta: input.pasta, lugar, papel: input.role.id, papelNome: input.role.name, orquestrador: false, roda: input.roda },
    listar,
    ...(board ? { board } : {}),
    at: input.at,
    // Made here, not the PC's answer: it never says the PC is on (retrato-local.ts `pcSeenAt`).
    local: true,
  };
}

/**
 * At the daemon's boot: a folder still marked `criando` whose tmux is not alive was an opening cut midway (the daemon
 * died); it is removed, so the PC never finds half of it. Returns the removed sids.
 */
export function sweepUnfinishedOpenings(sessionsDir: string, live: ReadonlySet<string>): string[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const sid of names) {
    if (!SID_PATTERN.test(sid) || live.has(sid) || !existsSync(join(sessionsDir, sid, CREATING_MARK))) continue;
    rmSync(join(sessionsDir, sid), { recursive: true, force: true });
    removed.push(sid);
  }
  return removed;
}

/**
 * The PC's push carried a session opened here with the PC off under its place `session:<sid>`: its card exists now,
 * and the mark `abertaSemPc` leaves its meta (the probe asks it again from then on). Returns the sids cleared.
 */
export function clearAdoptedMarks(sessionsDir: string, pushed: BoardPicture): string[] {
  const cleared: string[] = [];
  for (const [sid, session] of Object.entries(pushed.sessoes)) {
    if (!SID_PATTERN.test(sid) || session.at !== undefined || session.quemSou.lugar !== `session:${sid}`) continue;
    const file = join(sessionsDir, sid, META_FILE);
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!isRecord(raw) || raw.abertaSemPc !== true) continue;
      const { abertaSemPc: _mark, ...rest } = raw;
      writePrivate(file, `${JSON.stringify(rest)}\n`);
      cleared.push(sid);
    } catch {
      // no meta: nothing to clear
    }
  }
  return cleared;
}

const fail = (text: string): BrowserToolOutcome => ({ kind: 'error', text });

/** t-d461e003 — an opening another machine's registro hands this one (abrir-satelite.ts): the board by its key. */
export interface OpeningOrder {
  readonly pasta: string;
  readonly papel: string;
  readonly pedido: string;
  readonly nome?: string;
  readonly tarefa?: string;
}

/** t-49dee38d — the session the Oráculo opens in place of one past the context limit (renovar-local.ts). */
export interface SuccessorCall {
  /** The folder sid of the session that leaves. */
  readonly de: string;
  /** The new session's first message ("read the handoff"). */
  readonly firstPrompt: string;
  /** The board place the picture gives the old session, used only when its meta names none (`place:` ids only). */
  readonly placeId?: string;
}

export type SuccessorOutcome = { readonly kind: 'aberta'; readonly sid: string } | { readonly kind: 'erro'; readonly text: string };

/** A board place id: the app's (`place:<uuid>`), or `session:<sid>`, the one an opening here names (`open` below). */
const PLACE_ID = /^(?:place|session):[A-Za-z0-9-]{1,64}$/;

/** The fields of the old session's meta a successor inherits; never its keys. `null` = no readable meta. */
interface SuccessorFacts {
  readonly leaderOfAll: boolean;
  readonly roleId?: string;
  readonly placeId?: string;
  readonly localCwd?: string;
  readonly projectName?: string;
  readonly name?: string;
  readonly openedBy?: string;
  readonly launchArgs: readonly string[];
  readonly dir?: string;
}

function readSuccessorFacts(sessionsDir: string, sid: string): SuccessorFacts | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, META_FILE), 'utf8')) as unknown;
    if (!isRecord(raw)) return null;
    const text = (key: string): string | undefined => (typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : undefined);
    const placeId = text('placeId');
    const dir = readDirFile(sessionsDir, sid);
    return {
      leaderOfAll: raw.leaderOfAll === true,
      ...(text('roleId') ? { roleId: text('roleId') } : {}),
      ...(placeId && PLACE_ID.test(placeId) ? { placeId } : {}),
      ...(text('localCwd') ? { localCwd: text('localCwd') } : {}),
      ...(text('projectName') ? { projectName: text('projectName') } : {}),
      ...(text('name') ? { name: text('name') } : {}),
      ...(text('openedBy') ? { openedBy: text('openedBy') } : {}),
      launchArgs: Array.isArray(raw.launchArgs) ? raw.launchArgs.filter((arg): arg is string => typeof arg === 'string') : [],
      ...(dir ? { dir } : {}),
    };
  } catch {
    return null;
  }
}

/** The role text the old session was born with (`role.md` of its folder; no key there). `null` = none. */
function readOldRoleText(sessionsDir: string, sid: string): string | null {
  try {
    return readFileSync(join(sessionsDir, sid, 'role.md'), 'utf8');
  } catch {
    return null;
  }
}

/** Drops `--worktree <name>` (the setup makes the worktree, as for every remote launch). */
function withoutWorktree(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--worktree' || arg === '-w') {
      if (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) i += 1;
      continue;
    }
    if (arg.startsWith('--worktree=')) continue;
    out.push(arg);
  }
  return out;
}

export interface OpenLocal extends GateAbrir {
  /** The Líder único's opening, checked on the machine that took it (the satellite's `aberturas`). */
  openFor(order: OpeningOrder): Promise<BrowserToolOutcome>;
  /** t-49dee38d — the successor of a session past the context limit (renovar-local.ts); never ends the old one. */
  openSuccessor(call: SuccessorCall): Promise<SuccessorOutcome>;
}

export function createOpenLocal(deps: OpenLocalDeps): OpenLocal {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? ((line: string) => console.log(line));
  const openedFile = join(deps.oraculoDir, OPENED_FILE);
  const kitOf = deps.kit ?? (() => readOpenKit(deps.oraculoDir));
  // One opening at a time: the repeat check and the making of the folder never interleave.
  let line: Promise<unknown> = Promise.resolve();

  async function freePorts(taken: ReadonlySet<number>): Promise<[number, number] | null> {
    const picked: number[] = [];
    for (let attempt = 0; attempt < 40 && picked.length < 2; attempt += 1) {
      const port = PORT_MIN + Math.floor(random() * PORT_SPAN);
      // A port of another session's meta is its tunnel's, down only while the PC is off.
      if (taken.has(port) || picked.includes(port)) continue;
      if (await deps.portFree(port)) picked.push(port);
    }
    return picked.length === 2 ? [picked[0]!, picked[1]!] : null;
  }

  async function scopeSettingsOf(role: OpenKitRole): Promise<RoleScopeSettings | null> {
    if (role.scopeSettings !== null || !role.scopeNeedsInventory || !role.scope) return role.scopeSettings;
    try {
      const listed = await deps.run(buildRemoteInventoryScript());
      return buildRoleScopeSettings(role.scope, parseRemoteInventoryOutput(listed.stdout) ?? EMPTY_INVENTORY, MCP_SERVER_NAME);
    } catch (error) {
      log(`[oraculo] abrir: escopo do papel ${role.id} não montou (sessão com tudo): ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * t-d461e003 — `sid` is a board Líder alive in this machine's tmux: its session in the picture names a place that
   * `boardLeaders` of its own board names. Its place and board; `null` = not one.
   */
  async function boardLeaderCaller(sid: string): Promise<{ readonly lugar: string; readonly pasta: string } | null> {
    const picture = deps.picture();
    const who = picture?.sessoes[sid]?.quemSou;
    if (!who || who.liderUnico === true || typeof who.lugar !== 'string' || typeof who.pasta !== 'string' || !who.lugar || !who.pasta) return null;
    if (!boardLeaders(picturedBoards(picture).get(who.pasta)?.board).includes(who.lugar)) return null;
    if (!(await deps.liveSessions()).has(sid)) return null;
    return { lugar: who.lugar, pasta: who.pasta };
  }

  /** The role of the kit for `papel`, or why not (never a Líder without the PC). */
  function roleOf(kit: OpenKit, papel: string): OpenKitRole | string {
    if (papel === LEADER_ROLE_ID) return 'Não abri: com o PC desligado não abro um Líder (o Líder do quadro o dono põe pelo PC). Abra com outro papel.';
    const role = kit.roles.find((candidate) => candidate.id === papel);
    return role ?? `Papel "${papel}" não está no kit que o PC deixou (${kit.roles.map((candidate) => candidate.id).join(', ') || 'nenhum'}).`;
  }

  async function open(sid: string, call: OpenCall): Promise<BrowserToolOutcome> {
    const leader = await deps.leader();
    const boardLeaderOf = leader?.sid === sid ? null : await boardLeaderCaller(sid);
    if (leader?.sid !== sid && !boardLeaderOf) return fail(NOT_THE_LEADER);
    const opener = boardLeaderOf?.lugar ?? LEADER_OF_ALL;
    const kit = kitOf();
    if (!kit) return fail(NO_KIT);
    const role = roleOf(kit, call.papel);
    if (typeof role === 'string') return fail(role);
    const label = kit.place.label;
    if (boardLeaderOf && call.quadro && call.quadro !== boardLeaderOf.pasta && call.quadro !== lastSegment(boardLeaderOf.pasta)) return fail(ONLY_OWN_BOARD(lastSegment(boardLeaderOf.pasta)));
    const quadro = boardLeaderOf?.pasta ?? call.quadro;
    const boards = picturedBoards(deps.picture());
    const found = quadro ? [...boards].find(([pasta]) => pasta === quadro || lastSegment(pasta) === quadro) : undefined;
    // t-d461e003 — a board this machine does not picture, but another machine's satellite does: the Líder único's
    // opening goes there (abrir-satelite.ts), which checks `onde` against that machine.
    if (quadro && !found && !boardLeaderOf && deps.remote) {
      const forwarded = await deps.remote({ ...call, quadro });
      if (forwarded) return forwarded;
    }
    const where = call.onde?.trim().toLowerCase();
    const mine = [label, kit.place.id, ...(deps.names ?? [])].map((name) => name.toLowerCase());
    if (where && where !== 'aqui' && where !== 'auto' && !mine.includes(where)) return fail(`Com o PC desligado só abro nesta máquina (${label}): use "aqui", "auto" ou "${label}".`);
    if (!quadro) return fail('Com o PC desligado, diga o quadro em "quadro" (nome ou pasta).');
    if (!found) {
      const names = [...boards.keys()].map(lastSegment).join(', ') || 'nenhum';
      return fail(`Com o PC desligado, conheço só os quadros do último retrato (${names}); "${quadro}" não está entre eles. Tente quando o PC ligar.`);
    }
    return openOn(kit, role, found, opener, call, !boardLeaderOf);
  }

  /**
   * t-d461e003 — an opening the Líder único asked on the personal VPS for a board of this machine (the satellite took
   * it from the registro, which checked who asked): the same rules from the board on, opened by the Líder único.
   */
  async function openFor(order: OpeningOrder): Promise<BrowserToolOutcome> {
    const kit = kitOf();
    if (!kit) return fail(NO_KIT);
    const role = roleOf(kit, order.papel);
    if (typeof role === 'string') return fail(role);
    const found = [...picturedBoards(deps.picture())].find(([pasta]) => pasta === order.pasta);
    if (!found) return fail(`Não abri: o quadro ${lastSegment(order.pasta)} não está mais no retrato de ${kit.place.label}.`);
    return openOn(kit, role, found, LEADER_OF_ALL, order, true);
  }

  async function openOn(
    kit: OpenKit,
    role: OpenKitRole,
    [pasta, base]: [string, { readonly listar: readonly unknown[]; readonly board?: MindscapeBoard }],
    opener: string,
    call: { readonly pedido: string; readonly nome?: string; readonly tarefa?: string },
    /** The Líder único's request (a live board Líder gets it instead); `false` = that Líder himself opens. */
    toBoardLeader: boolean,
  ): Promise<BrowserToolOutcome> {
    const label = kit.place.label;
    const kitBoard = kit.boards.find((board) => board.localCwd === pasta);
    if (!kitBoard) return fail(`O kit que o PC deixou não traz a pasta do quadro ${lastSegment(pasta)}. Tente quando o PC ligar.`);
    const name = call.nome ?? role.name;
    const key = openingKey(pasta, role.id, call.pedido, name);
    const at = now();
    const opened = readOpened(openedFile, at);
    const repeat = opened[key];
    if (repeat && existsSync(join(deps.sessionsDir, repeat.sid))) return { kind: 'text', text: repeat.answer };

    // A board with a live Líder: the request goes to him (he hands it out), never a session past him; he himself opens
    // (boardLeaderOf, t-d461e003). With the PC off
    // (the only case this runs) the picture is frozen: a board Líder that closed after it still reads "parada". So he
    // counts as live only with his session (the one whose `quemSou.lugar` is his place) alive in this machine's tmux;
    // one with no session in the picture, or out of the tmux, lives on the PC that is off or closed (t-d461e003).
    const states = placeStatesOf(base.listar);
    const hearing = hearingPlaceIds(states);
    const tmuxNow = await deps.liveSessions();
    const sessions = Object.entries(deps.picture()?.sessoes ?? {});
    const aliveHere = (placeId: string): boolean => sessions.some(([folder, session]) => session.quemSou.lugar === placeId && tmuxNow.has(folder));
    const boardLeader = toBoardLeader ? boardLeaders(base.board).find((id) => hearing.has(id) && aliveHere(id)) : undefined;
    if (boardLeader) {
      const words = `pedido do Líder único (papel ${role.id}, "${name}"), com o PC desligado: ${call.pedido}`;
      const to = await deps.deliver({
        projectPath: pasta,
        placeId: boardLeader,
        text: `◆ Oráculo: ${words}`,
        leaderText: `◆ Oráculo, quadro ${kitBoard.name}: ${words}`,
        key: `abrir:${key}`,
      });
      const how = to === null ? ' Ele não está nesta máquina: recebe quando o PC ligar.' : '';
      return { kind: 'text', text: `Entregue ao Líder do quadro ${kitBoard.name} (${boardLeader}), que reparte o pedido; não abri sessão nova.${how}` };
    }

    const noRoom = deps.room();
    if (noRoom) return fail(`Não abri: esta máquina está sem vaga agora (${noRoom}). Tente de novo em alguns minutos.`);
    const folders = readFolders(deps.sessionsDir);
    const live = await deps.liveSessions();
    if (kit.openCap !== null) {
      const openNow = folders.filter((folder) => folder.openedBy === opener && folder.localCwd === pasta && live.has(folder.sid)).length;
      if (openNow >= kit.openCap) return fail(`Não abri: limite ${kit.openCap}, abertas ${openNow} neste quadro; feche uma e tente de novo.`);
    }

    const folderOf = deps.folderFromSessions !== undefined ? boardFolderFrom(folders, live, deps.folderFromSessions, pasta, kitBoard.name, label) : { homeRelativeDir: kitBoard.homeRelativeDir };
    if (typeof folderOf === 'string') return fail(`Não abri: ${folderOf}`);

    const newSid = newId();
    if (!SID_PATTERN.test(newSid)) return fail('Id de sessão inválido.');
    const ports = await freePorts(new Set(folders.flatMap((folder) => folder.ports)));
    if (!ports) return fail('Não abri: não achei porta livre nesta máquina.');
    const [hookPort, mcpPort] = ports;
    const scopeSettings = await scopeSettingsOf(role);
    const worktree = worktreeNameFor(name, new Date(at), folders.flatMap((folder) => (folder.worktree ? [folder.worktree] : [])));
    const launcherArgs = [...role.launcherArgs, '-n', name];
    const plan = planRemoteLaunch({
      sid: newSid,
      launcherArgs,
      extraArgs: ['--session-id', newSid],
      launchArgs: [...launcherArgs, '--worktree', worktree],
      facts: { roleId: role.id },
      role: { promptText: role.promptText, scope: role.scope, scopeSettings },
      // The hooks go to the PC's bridge through the tunnel it opens when it adopts the session; until then they fail fast.
      hooks: { on: true, port: hookPort, token: randomBytes(16).toString('hex'), statusLine: null },
      mcp: { port: mcpPort, token: randomBytes(32).toString('hex') },
      localCwd: pasta,
      projectName: kitBoard.name,
      name,
      openedBy: opener,
      // t-49dee38d — the place this opening answers (`session:<sid>`, the same the picture and the PC give it): a
      // renewal here keeps it, and retrato-local hands it to the successor. The session's own identity is unchanged.
      placeId: `session:${newSid}`,
      createdAt: new Date(at).toISOString(),
      homeRelativeDir: folderOf.homeRelativeDir,
      worktree,
      repoUrl: kitBoard.repoUrl,
      branch: kitBoard.branch,
      openedWithoutPc: true,
    });

    const folder = join(deps.sessionsDir, newSid);
    const undo = (why: string): BrowserToolOutcome => {
      rmSync(folder, { recursive: true, force: true });
      deps.forgetSession?.(newSid);
      log(`[oraculo] abrir: ${name} (${role.id}) no quadro ${kitBoard.name} não abriu: ${why}`);
      return fail(`Não abri: ${why}`);
    };
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(join(folder, CREATING_MARK), `${new Date(at).toISOString()}\n`, { mode: 0o600 });
      // The picture first (the folder must exist for it to stay): the Líder can give the new place a task at once.
      deps.setSession(newSid, syntheticPicture({ sid: newSid, name, role, pasta, projectName: kitBoard.name, roda: label, base, at, openedBy: opener }));
      writeFileSync(join(folder, 'pedido'), call.pedido, { mode: 0o600 });
    } catch (error) {
      return undo(`não consegui preparar a pasta da sessão (${error instanceof Error ? error.message : String(error)}).`);
    }
    const setup = await deps.run(plan.setupScript(newSid)).catch((error: unknown): ScriptRun => ({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
    const answer = parseRemoteSetupOutput(setup.stdout, setup.code, setup.stderr);
    if (answer.kind !== 'new') return undo(answer.kind === 'error' ? answer.message : 'a pasta da sessão já estava em uso.');
    const tmux = await deps.run(tmuxStartScript(newSid)).catch((): ScriptRun => ({ code: null, stdout: '', stderr: '' }));
    if (tmux.code !== 0) return undo('o tmux da sessão não subiu nesta máquina.');
    rmSync(join(folder, CREATING_MARK), { force: true });

    const lugar = `session:${newSid}`;
    const text = JSON.stringify({
      quadro: kitBoard.name,
      lugar,
      nome: name,
      papel: role.id,
      roda: label,
      porque: `O PC está desligado: abri direto em ${label}, com o seu pedido. O lugar aparece no quadro quando o PC ligar.`,
      ...(call.tarefa ? { aviso: `A tarefa ${call.tarefa} não foi ligada ao lugar novo: passe-a com tarefa_transferir para "${lugar}".` } : {}),
    });
    try {
      writePrivate(openedFile, JSON.stringify({ ...readOpened(openedFile, now()), [key]: { at, sid: newSid, answer: text } }));
    } catch (error) {
      log(`[oraculo] abrir: não guardei a abertura ${lugar} contra repetição: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`[oraculo] abrir: ${name} (${role.id}) aberta no quadro ${kitBoard.name} como ${lugar}, com o PC desligado.`);
    return { kind: 'text', text };
  }

  /**
   * t-49dee38d — a new session in place of `call.de`: its place, role, worktree, name and model, with `renovaDe` and the
   * handoff as its first message. The same order as an opening (the folder with its mark, the setup, the tmux last); a
   * failure removes only the NEW folder. Never touches the old session's folder or tmux.
   */
  async function openSuccessor(call: SuccessorCall): Promise<SuccessorOutcome> {
    const refuse = (text: string): SuccessorOutcome => ({ kind: 'erro', text });
    if (!SID_PATTERN.test(call.de)) return refuse('id de sessão inválido');
    const facts = readSuccessorFacts(deps.sessionsDir, call.de);
    if (!facts) return refuse('sem o meta da sessão que sai');
    if (facts.leaderOfAll) return refuse('o Líder único não é renovado pelo Oráculo');
    if (!facts.localCwd) return refuse('o meta da sessão que sai não diz o quadro');
    const noRoom = deps.room();
    if (noRoom) return refuse(`sem vaga nesta máquina (${noRoom})`);
    const kit = kitOf();
    const kitBoard = kit?.boards.find((board) => board.localCwd === facts.localCwd);
    const kitRole = facts.roleId ? kit?.roles.find((role) => role.id === facts.roleId) : undefined;
    const home = deps.home ?? homedir();
    const homeRelativeDir = facts.dir ? relative(home, projectRootOf(facts.dir)) || '.' : kitBoard?.homeRelativeDir;
    if (!homeRelativeDir) return refuse('não sei a pasta do projeto da sessão que sai');
    const name = facts.name ?? kitRole?.name ?? 'sessão';
    // The same argv as the old session, minus what names its conversation; a meta without one: the role's, as an opening.
    const fromOld = withoutWorktree(facts.launchArgs);
    const launcherArgs = fromOld.length ? renewalLaunchArgs(fromOld, null, { name }) : [...(kitRole?.launcherArgs ?? []), '-n', name];
    const worktree = remoteSpawnWorktree(facts.launchArgs, facts.dir ?? null);
    const placeId = facts.placeId ?? (call.placeId && PLACE_ID.test(call.placeId) ? call.placeId : undefined);
    const role = kitRole
      ? { promptText: kitRole.promptText, scope: kitRole.scope, scopeSettings: await scopeSettingsOf(kitRole) }
      : { promptText: facts.roleId ? readOldRoleText(deps.sessionsDir, call.de) : null, scope: undefined, scopeSettings: null };

    const at = now();
    const newSid = newId();
    if (!SID_PATTERN.test(newSid) || newSid === call.de) return refuse('id de sessão inválido');
    const folders = readFolders(deps.sessionsDir);
    const ports = await freePorts(new Set(folders.flatMap((folder) => folder.ports)));
    if (!ports) return refuse('não achei porta livre nesta máquina');
    const [hookPort, mcpPort] = ports;
    const plan = planRemoteLaunch({
      sid: newSid,
      launcherArgs,
      extraArgs: ['--session-id', newSid],
      launchArgs: [...launcherArgs, ...(worktree ? ['--worktree', worktree] : [])],
      facts: facts.roleId ? { roleId: facts.roleId } : {},
      role,
      hooks: { on: true, port: hookPort, token: randomBytes(16).toString('hex'), statusLine: null },
      mcp: { port: mcpPort, token: randomBytes(32).toString('hex') },
      localCwd: facts.localCwd,
      projectName: facts.projectName ?? kitBoard?.name ?? lastSegment(facts.localCwd),
      name,
      ...(facts.openedBy ? { openedBy: facts.openedBy } : {}),
      ...(placeId ? { placeId } : {}),
      renovaDe: call.de,
      createdAt: new Date(at).toISOString(),
      homeRelativeDir,
      worktree,
      repoUrl: kitBoard?.repoUrl ?? null,
      branch: kitBoard?.branch ?? null,
      openedWithoutPc: true,
    });

    const folder = join(deps.sessionsDir, newSid);
    const undo = (why: string): SuccessorOutcome => {
      rmSync(folder, { recursive: true, force: true });
      log(`[oraculo] abrir: a sucessora de ${call.de.slice(0, 8)} não abriu: ${why}`);
      return refuse(why);
    };
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(join(folder, CREATING_MARK), `${new Date(at).toISOString()}\n`, { mode: 0o600 });
      writeFileSync(join(folder, 'pedido'), call.firstPrompt, { mode: 0o600 });
    } catch (error) {
      return undo(`não consegui preparar a pasta da sessão (${error instanceof Error ? error.message : String(error)})`);
    }
    const setup = await deps.run(plan.setupScript(newSid)).catch((error: unknown): ScriptRun => ({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
    const answer = parseRemoteSetupOutput(setup.stdout, setup.code, setup.stderr);
    if (answer.kind !== 'new') return undo(answer.kind === 'error' ? answer.message : 'a pasta da sessão já estava em uso');
    const tmux = await deps.run(tmuxStartScript(newSid)).catch((): ScriptRun => ({ code: null, stdout: '', stderr: '' }));
    if (tmux.code !== 0) return undo('o tmux da sessão não subiu nesta máquina');
    rmSync(join(folder, CREATING_MARK), { force: true });
    log(
      `[oraculo] abrir: sucessora ${newSid.slice(0, 8)} de ${call.de.slice(0, 8)} aberta (${placeId ?? 'sem lugar no meta'}, papel ${facts.roleId ?? 'nenhum'}, worktree ${worktree ?? 'nenhuma'}), com o PC fora.`,
    );
    return { kind: 'aberta', sid: newSid };
  }

  const inLine = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = line.then(work);
    line = turn.catch(() => undefined);
    return turn;
  };
  return {
    abrir: (sid, _mine, call) => inLine(() => open(sid, call)),
    openFor: (order) => inLine(() => openFor(order)),
    openSuccessor: (call) => inLine(() => openSuccessor(call)),
  };
}
