// Abrir sessão com o PC desligado (t-1a3f7150, fatia 3; docs/adr/0009) — the Líder único alive in this machine's tmux
// calls `sessao_abrir` while nothing listens on its tunnel, and this daemon opens the session itself, in this machine's
// tmux, with the same files the PC would make (`planRemoteLaunch`, the one plan of a remote launch) and the place
// `session:<sid>` the PC gives a live conversation it finds on its return (`freePlaceId`). The board itself
// (`mindscape.json`) is never written here.
//
// Rules (the board Líder's decisions, 18/11): only the Líder único local opens; any role but `lider`; the board is
// named and must be in the picture and in the PC's kit (`abrir.json`, open-kit.ts); a board with a live Líder gets
// the request instead (its Líder hands it out); the kit's `openCap` is counted on this machine's folders opened by the
// Líder; no room (memory, load), no opening.
//
// Order: the folder with its `criando` mark → the synthetic picture (so the Líder's `tarefa_criar` for the new place
// passes the reach rules) → the first message and the setup (files and meta) → the tmux, last; the mark leaves at the
// end. A failure removes the folder. A repeat of the same call (board, role, request, name) within 10 min answers the
// same place (`abertas.json`). At boot, a folder still `criando` without its tmux is removed.
//
// The session folder holds keys: nothing read from a meta here is ever shown or logged.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { worktreeNameFor, worktreeNameFromArgs } from '../shared/sessionWorktree';
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
      });
    } catch {
      // no meta yet (being made) or unreadable: not counted
    }
  }
  return out;
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
 * the PC will name it), and the board of the freshest picture with the new place in it (no arrow: the Líder único
 * reaches the top of a board).
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
}): PictureSession {
  const lugar = `session:${input.sid}`;
  const others = (input.base?.listar ?? []).map((place) => {
    if (!isRecord(place)) return place;
    const { voce: _voce, podeMandar: _podeMandar, ...rest } = place;
    return rest;
  });
  const listar = [...others, { id: lugar, papel: input.role.id, papelNome: input.role.name, nome: input.name, estado: 'trabalhando', voce: true, abertaPor: LEADER_OF_ALL }];
  const base = input.base?.board;
  const board: MindscapeBoard | undefined = base
    ? { ...base, cards: { ...base.cards, [lugar]: { kind: 'session', id: lugar, sessionId: input.sid, previous: [], roleId: input.role.id, by: 'session', x: 0, y: 0 } } }
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

export function createOpenLocal(deps: OpenLocalDeps): GateAbrir {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? ((line: string) => console.log(line));
  const openedFile = join(deps.oraculoDir, OPENED_FILE);
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

  async function open(sid: string, call: OpenCall): Promise<BrowserToolOutcome> {
    const leader = await deps.leader();
    if (!leader || leader.sid !== sid) return fail(NOT_THE_LEADER);
    const kit = readOpenKit(deps.oraculoDir);
    if (!kit) return fail(NO_KIT);
    if (call.papel === LEADER_ROLE_ID) return fail('Não abri: com o PC desligado não abro um Líder (o Líder do quadro o dono põe pelo PC). Abra com outro papel.');
    const role = kit.roles.find((candidate) => candidate.id === call.papel);
    if (!role) return fail(`Papel "${call.papel}" não está no kit que o PC deixou (${kit.roles.map((candidate) => candidate.id).join(', ') || 'nenhum'}).`);
    const label = kit.place.label;
    const where = call.onde?.trim().toLowerCase();
    const mine = [label, kit.place.id, ...(deps.names ?? [])].map((name) => name.toLowerCase());
    if (where && where !== 'aqui' && where !== 'auto' && !mine.includes(where)) return fail(`Com o PC desligado só abro nesta máquina (${label}): use "aqui", "auto" ou "${label}".`);
    if (!call.quadro) return fail('Com o PC desligado, diga o quadro em "quadro" (nome ou pasta).');
    const boards = picturedBoards(deps.picture());
    const found = [...boards].find(([pasta]) => pasta === call.quadro || lastSegment(pasta) === call.quadro);
    if (!found) {
      const names = [...boards.keys()].map(lastSegment).join(', ') || 'nenhum';
      return fail(`Com o PC desligado, conheço só os quadros do último retrato (${names}); "${call.quadro}" não está entre eles. Tente quando o PC ligar.`);
    }
    const [pasta, base] = found;
    const kitBoard = kit.boards.find((board) => board.localCwd === pasta);
    if (!kitBoard) return fail(`O kit que o PC deixou não traz a pasta do quadro ${lastSegment(pasta)}. Tente quando o PC ligar.`);
    const name = call.nome ?? role.name;
    const key = openingKey(pasta, role.id, call.pedido, name);
    const at = now();
    const opened = readOpened(openedFile, at);
    const repeat = opened[key];
    if (repeat && existsSync(join(deps.sessionsDir, repeat.sid))) return { kind: 'text', text: repeat.answer };

    // A board with a live Líder: the request goes to him (he hands it out), never a session past him.
    const states = placeStatesOf(base.listar);
    const hearing = hearingPlaceIds(states);
    const boardLeader = boardLeaders(base.board).find((id) => hearing.has(id));
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
      const openNow = folders.filter((folder) => folder.openedBy === LEADER_OF_ALL && folder.localCwd === pasta && live.has(folder.sid)).length;
      if (openNow >= kit.openCap) return fail(`Não abri: limite ${kit.openCap}, abertas ${openNow} neste quadro; feche uma e tente de novo.`);
    }

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
      openedBy: LEADER_OF_ALL,
      createdAt: new Date(at).toISOString(),
      homeRelativeDir: kitBoard.homeRelativeDir,
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
      deps.setSession(newSid, syntheticPicture({ sid: newSid, name, role, pasta, projectName: kitBoard.name, roda: label, base, at }));
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
      porque: 'O PC está desligado: abri direto nesta máquina, com o seu pedido. O lugar aparece no quadro quando o PC ligar.',
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

  return {
    abrir(sid, _mine, call) {
      const turn = line.then(() => open(sid, call));
      line = turn.catch(() => undefined);
      return turn;
    },
  };
}
