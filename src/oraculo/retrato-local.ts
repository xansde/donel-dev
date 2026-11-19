// O Oráculo sem o PC (19/11, pedido do dono: "Eu mandei não precisar de aplicativo no computador... O Oráculo é o
// básico") — the picture this VPS makes of its own sessions, from what it already has here: the sessions alive in its
// tmux (`tmux -L donel`), the fields of each session folder's meta (`meta.json` of `~/.donel/s/<sid>`: `leaderOfAll`,
// `localCwd`, `roleId`, `name`, `openedBy`, `createdAt`; never its keys), and the boards of the last picture the PC left
// (`retrato.json`: places and arrows).
//
// Which live sessions the PC's picture does not carry get one made here (`local: true`):
// - all of them, with the PC away (`pcAway`: no push and no answer to the probe for over `PC_AWAY_MS`);
// - with the PC on, one born over `UNKNOWN_AFTER_MS` ago (its folder's `createdAt`) that the PC still has not pictured:
//   the PC pushes every 30 s and the probe asks the unpictured ones first, so this one the PC does not know (the Líder
//   único opened in this tmux at 07h34 of 19/11, whose tunnel connects and never answers);
// - the one whose tunnel refused the call (`withoutPc(sid)`): nothing of the PC serves it.
// A session the PC pictures is never made here: its picture rules, and the next push or probe replaces a local one.
//
// The Líder único (meta `leaderOfAll`) as the PC shows him (`liderUnico`, no place). Any other session as the place
// `session:<sid>` (the name the PC gives a live conversation it finds on its return) on its board (`localCwd`), opened
// by `openedBy`: from a place of that board, with its opening arrow (the hierarchy the reach rules read); from the Líder
// único, at the top of the board. The new places (and those `sessao_abrir` opened here with the PC off) enter the board
// of every session of that board, so the arrows hold both ways. Nothing here is written to `retrato.json`.
//
// t-d461e003 (19/11, 15h04) — a session the app renewed (its context full: a new sid, the same place) keeps its place.
// The PC's picture knows the place by the old sid, and the new folder is one it never pictured (the PC left right
// after): it became `session:<sid>`, and with it "Só o lugar dono" on its tasks. Before `session:<sid>`, the place is
// the one the app wrote in the folder's meta (`placeId`, `^place:`), else the one place of its board in the picture
// with the same tab name, role and opener, not closed, and not the place of another live session (one candidate only;
// two folders after the same place get none).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import type { MindscapeBoard, MindscapeLink } from '../shared/mindscape/model';
import { LEADER_ROLE_ID } from '../shared/roles';
import { PICTURE_FRESH_MS } from './lider-local';
import { picturedBoards, type BoardPicture, type PictureSession } from './portao';
import { parseTmuxLs, type TmuxRun } from './recados';

const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
/** No push nor probe answer for this long: the PC is away. */
export const PC_AWAY_MS = 2 * PICTURE_FRESH_MS + 60_000;
/** A live session the PC has not pictured this long after it was born: the PC does not know it. */
export const UNKNOWN_AFTER_MS = 5 * 60_000;
/** A folder still being made by `sessao_abrir` with the PC off (abrir-local.ts): its own picture is kept there. */
const CREATING_MARK = 'criando';

/** The fields of a session folder's meta this needs (never its keys). */
export interface LocalFolder {
  readonly sid: string;
  readonly leaderOfAll?: boolean;
  readonly localCwd?: string;
  readonly projectName?: string;
  readonly name?: string;
  readonly roleId?: string;
  readonly openedBy?: string;
  readonly createdAt?: string;
  /** t-d461e003 — the board place the app launched it for (`placeId` of the meta, only a `place:` id). */
  readonly placeId?: string;
}

/** A board place id the app gives (`place:<uuid>`); never a `session:` one, which names a sid. */
const PLACE_ID = /^place:[A-Za-z0-9-]{1,64}$/;

/** What the picture made here says besides the folders: this machine's label and the roles' names (the PC's kit). */
export interface LocalPictureExtras {
  readonly roda?: string;
  readonly roleName?: (roleId: string) => string | undefined;
  /** The sids alive here (tmux and a readable meta): a stored session not among them no longer holds its place. Absent = all. */
  readonly alive?: (sid: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The session folders of `live`, with the fields of their meta this needs; a folder without a readable meta is left out. */
export function readLocalFolders(sessionsDir: string, live: ReadonlySet<string>): LocalFolder[] {
  const out: LocalFolder[] = [];
  for (const sid of live) {
    if (!SID_PATTERN.test(sid) || existsSync(join(sessionsDir, sid, CREATING_MARK))) continue;
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
      if (!isRecord(raw)) continue;
      const text = (key: string): Record<string, string> => (typeof raw[key] === 'string' && raw[key] ? { [key]: raw[key] as string } : {});
      const placeId = typeof raw.placeId === 'string' && PLACE_ID.test(raw.placeId) ? { placeId: raw.placeId } : {};
      out.push({ sid, ...(raw.leaderOfAll === true ? { leaderOfAll: true } : {}), ...text('localCwd'), ...text('projectName'), ...text('name'), ...text('roleId'), ...text('openedBy'), ...text('createdAt'), ...placeId });
    } catch {
      // no meta (closed, or not made yet): not a session here
    }
  }
  return out;
}

/** When the PC last answered: its push, or a probe it answered through a session's tunnel (never a picture made here). */
export function pcSeenAt(stored: BoardPicture | null): number {
  if (!stored) return 0;
  let seen = stored.at;
  for (const session of Object.values(stored.sessoes)) if (session.local !== true && typeof session.at === 'number' && session.at > seen) seen = session.at;
  return seen;
}

/**
 * The PC has not answered for longer than `PC_AWAY_MS` (or never did): this VPS answers from its own picture. Over
 * `PICTURE_FRESH_MS` (2 min) on purpose: with the PC's push silent (since 18/11 15h28 only the probe brings its answers)
 * the probe asks a session again only once its picture is 2 min old, so with the PC well its newest answer is up to
 * ~2,5 min old; 2 min would flip the gate to "PC away" and back between two probes.
 */
export function pcAway(stored: BoardPicture | null, now: number): boolean {
  return now - pcSeenAt(stored) > PC_AWAY_MS;
}

/** A place this VPS knows the PC does not show: made here from a folder, or opened here with the PC off (abrir-local). */
interface NewPlace {
  readonly sid: string;
  readonly pasta: string;
  readonly lugar: string;
  readonly papel?: string;
  readonly nome?: string;
  readonly abertaPor?: string;
}

/** `board` with the new places as cards and the opening arrow of each one opened by a place of that board. */
function boardWith(board: MindscapeBoard, places: readonly NewPlace[]): MindscapeBoard {
  const cards = { ...board.cards };
  const links: MindscapeLink[] = [...board.links];
  // Every card first, then the arrows: an opener made here may come after the place it opened (revisão do #501).
  for (const place of places) {
    const card = cards[place.lugar];
    if (!card) cards[place.lugar] = { kind: 'session', id: place.lugar, sessionId: place.sid, previous: [], ...(place.papel ? { roleId: place.papel } : {}), by: 'session', x: 0, y: 0 };
    // A renewed place (t-d461e003): its card now carries the new conversation, the old one goes to `previous`.
    else if (card.kind === 'session' && card.sessionId !== place.sid) cards[place.lugar] = { ...card, sessionId: place.sid, previous: card.sessionId ? [...card.previous, card.sessionId] : card.previous };
  }
  for (const place of places) {
    const opener = place.abertaPor;
    if (!opener || opener === LEADER_OF_ALL || opener === place.lugar || cards[opener]?.kind !== 'session') continue;
    if (links.some((link) => link.from === opener && link.to === place.lugar && link.arrow)) continue;
    links.push({ id: `aberta:${opener}>${place.lugar}`, from: opener, to: place.lugar, arrow: true, by: 'session', opened: true });
  }
  return { ...board, cards, links };
}

/** `listar` with the new places that are not in it yet (`voce` only on `self`). */
function listarWith(listar: readonly unknown[], places: readonly NewPlace[], self?: string): unknown[] {
  const known = new Set(listar.map((place) => (isRecord(place) ? place.id : null)));
  const added = places
    .filter((place) => !known.has(place.lugar))
    .map((place) => ({
      id: place.lugar,
      ...(place.papel ? { papel: place.papel } : {}),
      ...(place.nome ? { nome: place.nome } : {}),
      estado: 'trabalhando',
      ...(place.abertaPor ? { abertaPor: place.abertaPor } : {}),
      ...(place.lugar === self ? { voce: true } : {}),
    }));
  const kept = self
    ? listar.map((place) => {
        if (!isRecord(place)) return place;
        const rest = place.voce === true ? (({ voce: _voce, podeMandar: _podeMandar, ...others }) => others)(place) : place;
        // A renewed place already listed (t-d461e003) is the caller itself.
        return place.id === self ? { ...rest, voce: true } : rest;
      })
    : [...listar];
  return [...kept, ...added];
}

/**
 * Pure — `stored` with each of `folders` it does not carry made here from its folder, and the new places (these and the
 * ones opened here with the PC off) on the board of every session of their board. Which folders: the caller's choice.
 */
export function withLocalSessions(stored: BoardPicture | null, folders: readonly LocalFolder[], now: number, extras: LocalPictureExtras = {}): BoardPicture | null {
  const known = stored?.sessoes ?? {};
  const missing = folders.filter((folder) => SID_PATTERN.test(folder.sid) && !known[folder.sid]);
  const newPlaces: NewPlace[] = [];
  // Opened here with the PC off (abrir-local): already in the stored picture, not yet on the others' boards.
  for (const [sid, session] of Object.entries(known)) {
    const who = session.quemSou;
    if (session.local !== true || typeof who.lugar !== 'string' || typeof who.pasta !== 'string') continue;
    const self = session.listar.find((place) => isRecord(place) && place.id === who.lugar);
    const abertaPor = isRecord(self) && typeof self.abertaPor === 'string' ? self.abertaPor : undefined;
    newPlaces.push({ sid, pasta: who.pasta, lugar: who.lugar, ...(typeof who.papel === 'string' ? { papel: who.papel } : {}), ...(typeof who.nome === 'string' ? { nome: who.nome } : {}), ...(abertaPor ? { abertaPor } : {}) });
  }
  const inherited = inheritedPlaces(stored, missing, extras.alive);
  for (const folder of missing) {
    if (folder.leaderOfAll || !folder.localCwd) continue;
    newPlaces.push({
      sid: folder.sid,
      pasta: folder.localCwd,
      lugar: folder.placeId ?? inherited.get(folder.sid) ?? `session:${folder.sid}`,
      ...(folder.roleId ? { papel: folder.roleId } : {}),
      ...(folder.name ? { nome: folder.name } : {}),
      ...(folder.openedBy ? { abertaPor: folder.openedBy } : {}),
    });
  }
  const leaders = missing.filter((folder) => folder.leaderOfAll);
  if (!newPlaces.length && !leaders.length) return stored;

  const placesOf = (pasta: unknown): NewPlace[] => (typeof pasta === 'string' ? newPlaces.filter((place) => place.pasta === pasta) : []);
  const sessoes: Record<string, PictureSession> = {};
  for (const [sid, session] of Object.entries(known)) {
    const extra = placesOf(session.quemSou.pasta).filter((place) => place.sid !== sid);
    if (!extra.length || session.quemSou.liderUnico === true) {
      sessoes[sid] = session;
      continue;
    }
    sessoes[sid] = { ...session, listar: listarWith(session.listar, extra), ...(session.board ? { board: boardWith(session.board, extra) } : {}) };
  }

  const boards = picturedBoards(stored);
  const roleName = (id: string | undefined): string | undefined => (id ? (extras.roleName?.(id) ?? id) : undefined);
  const roda = extras.roda ? { roda: extras.roda } : {};
  for (const folder of missing) {
    if (folder.leaderOfAll) {
      sessoes[folder.sid] = {
        quemSou: {
          nome: folder.name ?? 'Líder',
          papel: LEADER_ROLE_ID,
          papelNome: roleName(LEADER_ROLE_ID),
          liderUnico: true,
          lugar: null,
          alcance: 'Todos os quadros: o topo de cada um e quem está abaixo dele pelas setas. Diga o quadro em "quadro" nas ferramentas de quadro, de sessão e de tarefa.',
          ...roda,
          quadros: [...boards.keys()].map(lastSegment),
          retrato: 'feito nesta VPS (o PC está fora)',
        },
        listar: [],
        at: now,
        local: true,
      };
      continue;
    }
    const mine = newPlaces.find((place) => place.sid === folder.sid);
    if (!mine) continue;
    const base = boards.get(mine.pasta);
    const onBoard = placesOf(mine.pasta);
    sessoes[folder.sid] = {
      quemSou: {
        nome: folder.name ?? roleName(folder.roleId) ?? 'sessão',
        projeto: folder.projectName ?? lastSegment(mine.pasta),
        pasta: mine.pasta,
        lugar: mine.lugar,
        ...(folder.roleId ? { papel: folder.roleId, papelNome: roleName(folder.roleId) } : {}),
        orquestrador: false,
        ...roda,
        retrato: 'feito nesta VPS (o PC está fora): o lugar aparece no quadro quando o PC ligar',
      },
      listar: listarWith(base?.listar ?? [], onBoard, mine.lugar),
      ...(base?.board ? { board: boardWith(base.board, onBoard) } : {}),
      at: now,
      local: true,
    };
  }
  return { at: stored?.at ?? 0, sessoes };
}

/**
 * t-d461e003 — the place each renewed folder of `folders` keeps (sid → place id), from the boards of `stored`: the one
 * listed place of its board with the folder's tab name, role and opener, not closed, held by no other live session of
 * the picture, and claimed by no other folder. A folder that names its place (`placeId`) takes it and claims it.
 */
function inheritedPlaces(stored: BoardPicture | null, folders: readonly LocalFolder[], alive: ((sid: string) => boolean) | undefined): Map<string, string> {
  const boards = picturedBoards(stored);
  const held = new Set<string>();
  for (const [sid, session] of Object.entries(stored?.sessoes ?? {})) {
    if (typeof session.quemSou.lugar === 'string' && (alive?.(sid) ?? true)) held.add(`${String(session.quemSou.pasta)}\n${session.quemSou.lugar}`);
  }
  const claims = new Map<string, string[]>();
  const claim = (key: string, sid: string): void => {
    claims.set(key, [...(claims.get(key) ?? []), sid]);
  };
  for (const folder of folders) {
    if (folder.leaderOfAll || !folder.localCwd) continue;
    if (folder.placeId) {
      claim(`${folder.localCwd}\n${folder.placeId}`, '');
      continue;
    }
    if (!folder.name || !folder.roleId) continue;
    const matches = (boards.get(folder.localCwd)?.listar ?? []).filter(
      (place): place is Record<string, unknown> & { id: string } =>
        isRecord(place) &&
        typeof place.id === 'string' &&
        PLACE_ID.test(place.id) &&
        place.nome === folder.name &&
        place.papel === folder.roleId &&
        (typeof place.abertaPor === 'string' ? place.abertaPor : undefined) === folder.openedBy &&
        place.estado !== 'fechada' &&
        !held.has(`${folder.localCwd}\n${place.id}`),
    );
    if (matches.length === 1) claim(`${folder.localCwd}\n${matches[0]!.id}`, folder.sid);
  }
  const out = new Map<string, string>();
  for (const [key, sids] of claims) if (sids.length === 1 && sids[0]) out.set(sids[0], key.slice(key.indexOf('\n') + 1));
  return out;
}

/** Which of `folders` get a picture made here (see the header): all with the PC away, else the old ones and `forced`. */
export function foldersToPicture(stored: BoardPicture | null, folders: readonly LocalFolder[], now: number, forced?: string): LocalFolder[] {
  if (pcAway(stored, now)) return [...folders];
  return folders.filter((folder) => {
    if (folder.sid === forced) return true;
    const born = folder.createdAt ? Date.parse(folder.createdAt) : Number.NaN;
    return Number.isFinite(born) && now - born > UNKNOWN_AFTER_MS;
  });
}

/**
 * The picture for the daemon: `stored()` (what the PC pushed and the probe asked) with the live sessions made here
 * (`foldersToPicture`). This machine's tmux and the folders are read at most once every `ttlMs`; the picture is rebuilt
 * when the stored one changed, the list was read again or the chosen sessions changed.
 */
export function createLocalPicture(deps: {
  readonly stored: () => BoardPicture | null;
  readonly sessionsDir: string;
  /** This machine's live tmux sessions (folder sids), read synchronously; a failure = none. */
  readonly liveNow: () => ReadonlySet<string>;
  readonly extras?: () => LocalPictureExtras;
  readonly now?: () => number;
  readonly ttlMs?: number;
}): { get(): BoardPicture | null; away(): boolean; withoutPc(sid: string): BoardPicture | null } {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? 5_000;
  let folders: { at: number; list: LocalFolder[] } | null = null;
  let built: { stored: BoardPicture | null; list: LocalFolder[]; picked: string; picture: BoardPicture | null } | null = null;
  const liveFolders = (at: number): LocalFolder[] => {
    if (!folders || at - folders.at >= ttlMs) {
      let live: ReadonlySet<string>;
      try {
        live = deps.liveNow();
      } catch {
        live = new Set();
      }
      const list = readLocalFolders(deps.sessionsDir, live);
      // The same folders keep the same list: the picture is not rebuilt for nothing.
      folders = { at, list: folders && JSON.stringify(folders.list) === JSON.stringify(list) ? folders.list : list };
    }
    return folders.list;
  };
  const build = (forced?: string): BoardPicture | null => {
    const stored = deps.stored();
    const at = now();
    const list = liveFolders(at);
    const chosen = foldersToPicture(stored, list, at, forced).filter((folder) => !stored?.sessoes[folder.sid]);
    const picked = chosen.map((folder) => folder.sid).join(',');
    if (built && built.stored === stored && built.list === list && built.picked === picked) return built.picture;
    const alive = new Set(list.map((folder) => folder.sid));
    const picture = withLocalSessions(stored, chosen, at, { ...(deps.extras?.() ?? {}), alive: (sid) => alive.has(sid) });
    built = { stored, list, picked, picture };
    return picture;
  };
  return {
    away: () => pcAway(deps.stored(), now()),
    get: () => build(),
    withoutPc: (sid) => build(sid),
  };
}

/**
 * One synchronous `tmux -L donel ls` (the picture is read synchronously by the gate and the recados): this machine's
 * live Donel sessions, or `null` when tmux failed or took over 2 s (a machine under load), by the same rule as the
 * recados' (`parseTmuxLs`: only "no server running" is none). A read takes a few ms.
 */
export function readTmuxLive(run: () => TmuxRun = runTmuxLsSync): ReadonlySet<string> | null {
  const live = parseTmuxLs(run());
  return live && new Set([...live].filter((sid) => SID_PATTERN.test(sid)));
}

/**
 * `tmux -L donel ls`, at most 2 s. No tmux binary (`ENOENT`) is "no server" (no session, as before t-d461e003); a timeout
 * or any other failure is a failure (`parseTmuxLs` → `null`).
 */
export function runTmuxLsSync(exec: () => string = execTmuxLs): TmuxRun {
  try {
    return { code: 0, stdout: exec(), stderr: '' };
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return { code: 1, stdout: '', stderr: 'no server running: tmux not installed' };
    const stderr = (error as { stderr?: unknown }).stderr;
    return { code: 1, stdout: '', stderr: typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '' };
  }
}

function execTmuxLs(): string {
  return execFileSync('tmux', ['-L', 'donel', 'ls', '-F', '#{session_name}'], { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The live sessions for the picture: a tmux that failed keeps the last set it knew ("tmux ls que falha mantém o conjunto"). */
export function createTmuxLiveNow(read: () => ReadonlySet<string> | null = readTmuxLive): () => ReadonlySet<string> {
  let last: ReadonlySet<string> = new Set();
  return () => {
    last = read() ?? last;
    return last;
  };
}

/** This machine's live Donel sessions, kept `ttlMs` (5 s) by the picture; one memory for every caller of the process. */
export const tmuxLiveNow = createTmuxLiveNow();
