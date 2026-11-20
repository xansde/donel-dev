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
// the one written in the folder's meta (`placeId`: the app's `place:`, or the `session:` an opening here named, t-49dee38d), and only when that place is on the pictured board
// of the folder, is not closed and no other live session holds it. Never by tab name, role or opener (corte do Líder
// único, 19/11: "matar a sessão errada é pior do que perder o lugar"); a renewal without `placeId` stays `session:<sid>`.
//
// t-49dee38d (20/11; condição do Líder único r-ded62192: "um dono só") — the place passes to the successor the renewal
// opened (`renovaDe` = the holder, the same role) once the holder's renewal mark says its handoff was ready
// (`markHandedOver`), and while the successor lives; again down a chain (A → B → C, all here with the PC away). The one
// it passed from loses the place (`session:<sid>`) and is marked `renovadaPara`: the gate refuses its ledger writes, and
// recados to the place go to the successor. The successor gone (a give-up closed it), the holder has the place again.
// r3 (revisão do #540): who owns is decided over EVERY live folder here, also with the PC back mid-renewal (the
// successor is pictured here until the PC pictures it, and a PC picture of it as `session:<nova>` yields to the old
// one's mark); and a `session:<A>` place an opening here named passes to A's successor though no board carries it.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import type { MindscapeBoard, MindscapeLink } from '../shared/mindscape/model';
import { LEADER_ROLE_ID } from '../shared/roles';
import { PICTURE_FRESH_MS } from './lider-local';
import { picturedBoards, renewedText, type BoardPicture, type PictureSession } from './portao';
import { parseTmuxLs, type TmuxRun } from './recados';
import { markHandedOver, RENEW_MARK } from './renovar-local';

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
  /** t-d461e003 — the board place it was launched for (`placeId` of the meta: a `place:` id, or the `session:` one of an opening here). */
  readonly placeId?: string;
  /** t-49dee38d — the sid this folder renewed (`renovaDe` of the meta, written by abrir-local `openSuccessor`). */
  readonly renovaDe?: string;
  /** t-49dee38d — its renewal mark says it handed its place over (`markHandedOver`). */
  readonly handedOver?: boolean;
}

/**
 * A board place id: the app's (`place:<uuid>`), or `session:<sid>` — the place an opening with the PC off names and
 * writes in its meta (abrir-local), so its renewal keeps it. Either one passes only the checks of `inheritedPlaces`
 * (on the pictured board, not closed, no live session holding it).
 */
const PLACE_ID = /^(?:place|session):[A-Za-z0-9-]{1,64}$/;

/** What the picture made here says besides the folders: this machine's label and the roles' names (the PC's kit). */
export interface LocalPictureExtras {
  readonly roda?: string;
  readonly roleName?: (roleId: string) => string | undefined;
  /** The sids alive here (tmux and a readable meta): a stored session not among them no longer holds its place. Absent = all. */
  readonly alive?: (sid: string) => boolean;
  /** t-49dee38d — the live sids whose renewal mark says they handed their place over (`LocalFolder.handedOver`). Absent = none. */
  readonly handedOver?: (sid: string) => boolean;
  /**
   * t-49dee38d (r3) — every live folder here, pictured or not, for who owns each place: the old one marked the place as
   * handed over whatever the PC pictures of its successor (none yet, or `session:<nova>`). Absent = the folders given.
   */
  readonly liveFolders?: readonly LocalFolder[];
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
      const renovaDe = typeof raw.renovaDe === 'string' && SID_PATTERN.test(raw.renovaDe) && raw.renovaDe !== sid ? { renovaDe: raw.renovaDe } : {};
      const handedOver = readHandedOver(sessionsDir, sid) ? { handedOver: true } : {};
      out.push({ sid, ...(raw.leaderOfAll === true ? { leaderOfAll: true } : {}), ...text('localCwd'), ...text('projectName'), ...text('name'), ...text('roleId'), ...text('openedBy'), ...text('createdAt'), ...placeId, ...renovaDe, ...handedOver });
    } catch {
      // no meta (closed, or not made yet): not a session here
    }
  }
  return out;
}

/** The renewal mark of `sid` (only its step fields are looked at) says it handed its place over. */
function readHandedOver(sessionsDir: string, sid: string): boolean {
  try {
    return markHandedOver(JSON.parse(readFileSync(join(sessionsDir, sid, RENEW_MARK), 'utf8')) as unknown);
  } catch {
    return false;
  }
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
  const everyFolder = [...missing, ...(extras.liveFolders ?? []).filter((folder) => !missing.some((one) => one.sid === folder.sid))];
  const { places: inherited, renewed } = inheritedPlaces(stored, everyFolder, extras);
  for (const folder of missing) {
    if (folder.leaderOfAll || !folder.localCwd) continue;
    newPlaces.push({
      sid: folder.sid,
      pasta: folder.localCwd,
      lugar: inherited.get(folder.sid) ?? renewedLugar(folder.sid, renewed),
      ...(folder.roleId ? { papel: folder.roleId } : {}),
      ...(folder.name ? { nome: folder.name } : {}),
      ...(folder.openedBy ? { abertaPor: folder.openedBy } : {}),
    });
  }
  // A successor the PC pictured as a loose conversation (`session:<nova>`) while the old one handed it the place: the
  // old one's mark rules, so the place is the successor's (r3, revisão do #540: never two owners). r4: also with the old
  // one already closed (no `renewed` left): a live successor (`renovaDe`) the PC adopted as `session:<itself>` keeps the
  // place it inherited, which `inheritedPlaces` gave it only with no other live owner; else the place has no owner.
  const takenOver = new Map<string, string>();
  const successors = new Set([...renewed.values()].map((handed) => handed.sid));
  const renewing = new Set(everyFolder.flatMap((folder) => (folder.renovaDe !== undefined ? [folder.sid] : [])));
  for (const [sid, session] of Object.entries(known)) {
    const place = inherited.get(sid);
    const adopted = renewing.has(sid) && session.quemSou.lugar === `session:${sid}`;
    if (!place || !(successors.has(sid) || adopted) || session.quemSou.liderUnico === true || session.quemSou.lugar === place || typeof session.quemSou.pasta !== 'string') continue;
    takenOver.set(sid, place);
    newPlaces.push({ sid, pasta: session.quemSou.pasta, lugar: place, ...(typeof session.quemSou.papel === 'string' ? { papel: session.quemSou.papel } : {}), ...(typeof session.quemSou.nome === 'string' ? { nome: session.quemSou.nome } : {}) });
  }
  const leaders = missing.filter((folder) => folder.leaderOfAll);
  if (!newPlaces.length && !leaders.length && !renewed.size) return stored;

  const placesOf = (pasta: unknown): NewPlace[] => (typeof pasta === 'string' ? newPlaces.filter((place) => place.pasta === pasta) : []);
  const sessoes: Record<string, PictureSession> = {};
  for (const [sid, session] of Object.entries(known)) {
    const extra = placesOf(session.quemSou.pasta).filter((place) => place.sid !== sid);
    const handedTo = renewed.get(sid);
    if (handedTo && session.quemSou.liderUnico !== true) {
      // It handed its place over: no place of its own now, only the word of who answers for it.
      const lugar = renewedLugar(sid, renewed);
      sessoes[sid] = {
        ...session,
        quemSou: { ...session.quemSou, lugar, renovada: renewedText(handedTo.sid) },
        listar: listarWith(session.listar, extra, lugar ?? undefined),
        ...(session.board ? { board: boardWith(session.board, extra) } : {}),
        renovadaPara: handedTo.sid,
      };
      continue;
    }
    const taken = takenOver.get(sid);
    if (taken) {
      const onBoard = placesOf(session.quemSou.pasta);
      sessoes[sid] = { ...session, quemSou: { ...session.quemSou, lugar: taken }, listar: listarWith(session.listar, onBoard, taken), ...(session.board ? { board: boardWith(session.board, onBoard) } : {}) };
      continue;
    }
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
    const handedTo = renewed.get(folder.sid);
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
        ...(handedTo ? { renovada: renewedText(handedTo.sid) } : {}),
      },
      listar: listarWith(base?.listar ?? [], onBoard, mine.lugar),
      ...(base?.board ? { board: boardWith(base.board, onBoard) } : {}),
      at: now,
      local: true,
      ...(handedTo ? { renovadaPara: handedTo.sid } : {}),
    };
  }
  return { at: stored?.at ?? 0, sessoes };
}

/**
 * The place of a session that handed its own over: `session:<sid>`, the name of a live conversation with no place; none
 * when that is the very place it handed over (a place an opening here named after it), so two never hold it.
 */
function renewedLugar(sid: string, renewed: ReadonlyMap<string, { readonly place: string }>): string {
  const own = `session:${sid}`;
  return renewed.get(sid)?.place === own ? `renovada:${sid}` : own;
}

/**
 * t-d461e003 — the place each renewed folder of `folders` keeps (sid → place id), from the boards of `stored`. Only a
 * folder that names its place (`placeId`) gets one, and only that one: when it is on the pictured board of the folder
 * (a card or a listed place), is not closed and no other live session of the picture holds it. Two folders claiming the
 * same place get neither. In any doubt the folder stays `session:<sid>`: losing the place is fine, a wrong one never is.
 *
 * t-49dee38d (20/11; condição do Líder único r-ded62192: "um dono só") — the successor `openSuccessor` opened lives
 * beside the old one until its first turn, and that first turn reports on the place's task. One owner per place: the
 * single live holder (a session of the picture, else the single folder claiming it that renewed no other claimant),
 * then down the chain while the owner's renewal mark says it handed over (`handedOver`) and exactly one live folder
 * claiming the place renewed it (`renovaDe`) with the SAME role. The chain's last one owns the place; each before it is
 * `renewed` (sid → the owner and the place): it keeps no place, and its ledger writes are refused. Held by more than one
 * session of the picture, or claimed by two folders that renewed nobody here: nobody inherits.
 */
function inheritedPlaces(
  stored: BoardPicture | null,
  folders: readonly LocalFolder[],
  extras: LocalPictureExtras,
): { places: Map<string, string>; renewed: Map<string, { readonly sid: string; readonly place: string }> } {
  const boards = picturedBoards(stored);
  const handedOver = (sid: string): boolean => folders.some((folder) => folder.sid === sid && folder.handedOver === true) || extras.handedOver?.(sid) === true;
  /** Board folder + place → the live sessions of the picture holding it, with their role. */
  const held = new Map<string, { readonly sid: string; readonly role?: string }[]>();
  for (const [sid, session] of Object.entries(stored?.sessoes ?? {})) {
    if (typeof session.quemSou.lugar !== 'string' || !(extras.alive?.(sid) ?? true)) continue;
    const key = `${String(session.quemSou.pasta)}\n${session.quemSou.lugar}`;
    const role = typeof session.quemSou.papel === 'string' ? { role: session.quemSou.papel } : {};
    held.set(key, [...(held.get(key) ?? []), { sid, ...role }]);
  }
  const renewedBy = new Map(folders.flatMap((folder) => (folder.renovaDe ? [[folder.sid, folder.renovaDe] as const] : [])));
  /** `of` is gone, or `folder` renewed it (directly or down a chain of renewals here). */
  const carriedOver = (folder: LocalFolder, of: string): boolean => {
    if (folder.renovaDe === undefined) return false;
    if (!(extras.alive?.(of) ?? true)) return true;
    const seen = new Set<string>([folder.sid]);
    for (let sid: string | undefined = folder.renovaDe; sid !== undefined && !seen.has(sid); sid = renewedBy.get(sid)) {
      if (sid === of) return true;
      seen.add(sid);
    }
    return false;
  };
  const claims = new Map<string, LocalFolder[]>();
  for (const folder of folders) {
    if (folder.leaderOfAll || !folder.localCwd || !folder.placeId) continue;
    const pictured = boards.get(folder.localCwd);
    const listed = (pictured?.listar ?? []).find((place): place is Record<string, unknown> => isRecord(place) && place.id === folder.placeId);
    // r3 (revisão do #540) — a `session:` place an opening here named (abrir-local) is on no board the PC left: the
    // folder's own, or the one a renewal here carried over (`renovaDe`: its session closed, or one this folder renewed).
    const localPlace = folder.placeId.startsWith('session:') && (folder.placeId === `session:${folder.sid}` || carriedOver(folder, folder.placeId.slice('session:'.length)));
    const onBoard = Boolean(listed) || pictured?.board?.cards[folder.placeId]?.kind === 'session' || localPlace;
    if (!onBoard || listed?.estado === 'fechada') continue;
    const key = `${folder.localCwd}\n${folder.placeId}`;
    claims.set(key, [...(claims.get(key) ?? []), folder]);
  }
  const places = new Map<string, string>();
  const renewed = new Map<string, { readonly sid: string; readonly place: string }>();
  for (const [key, claimants] of claims) {
    const place = key.slice(key.indexOf('\n') + 1);
    const holders = held.get(key) ?? [];
    const members = new Set([...holders.map((holder) => holder.sid), ...claimants.map((folder) => folder.sid)]);
    const isRoot = (sid: string): boolean => !members.has(renewedBy.get(sid) ?? '');
    // The single live holder that renewed no other one of them (a successor the PC pictured on the place is not one).
    const holderRoots = holders.filter((holder) => isRoot(holder.sid));
    const roots = claimants.filter((folder) => isRoot(folder.sid));
    const first = holders.length
      ? holderRoots.length === 1
        ? holderRoots[0]
        : undefined
      : roots.length === 1
        ? { sid: roots[0]!.sid, ...(roots[0]!.roleId ? { role: roots[0]!.roleId } : {}) }
        : undefined;
    if (!first) continue;
    const chain = [first.sid];
    let owner = first;
    while (owner.role !== undefined && handedOver(owner.sid)) {
      const from = owner;
      const next = claimants.filter((folder) => folder.renovaDe === from.sid && folder.roleId === from.role);
      if (next.length !== 1 || chain.includes(next[0]!.sid)) break;
      owner = { sid: next[0]!.sid, role: from.role };
      chain.push(owner.sid);
    }
    places.set(owner.sid, place);
    for (const sid of chain.slice(0, -1)) renewed.set(sid, { sid: owner.sid, place });
  }
  return { places, renewed };
}

/**
 * Which of `folders` get a picture made here (see the header): all with the PC away, else the old ones, `forced` and a
 * successor this VPS opened (`renovaDe`: only abrir-local writes it, so the PC never launched it; r3, revisão do #540 —
 * with the PC back mid-renewal it is the place's owner before the PC pictures it).
 */
export function foldersToPicture(stored: BoardPicture | null, folders: readonly LocalFolder[], now: number, forced?: string): LocalFolder[] {
  if (pcAway(stored, now)) return [...folders];
  return folders.filter((folder) => {
    if (folder.sid === forced || folder.renovaDe !== undefined) return true;
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
    const handed = new Set(list.filter((folder) => folder.handedOver === true).map((folder) => folder.sid));
    const picture = withLocalSessions(stored, chosen, at, { ...(deps.extras?.() ?? {}), alive: (sid) => alive.has(sid), handedOver: (sid) => handed.has(sid), liveFolders: list });
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

/**
 * The live sessions as last read: a tmux that failed keeps the last set it knew ("tmux ls que falha mantém o conjunto");
 * `null` until one read worked (nothing known yet: the ledger's orphans decide nothing on it, t-d461e003).
 */
export function createTmuxLiveKnown(read: () => ReadonlySet<string> | null = readTmuxLive): () => ReadonlySet<string> | null {
  let last: ReadonlySet<string> | null = null;
  return () => {
    last = read() ?? last;
    return last;
  };
}

/** The live sessions for the picture: `createTmuxLiveKnown`, with none before the first read that worked. */
export function createTmuxLiveNow(read: () => ReadonlySet<string> | null = readTmuxLive): () => ReadonlySet<string> {
  return fromKnown(createTmuxLiveKnown(read));
}

function fromKnown(known: () => ReadonlySet<string> | null): () => ReadonlySet<string> {
  return () => known() ?? new Set();
}

/** This machine's live Donel sessions as last read; one memory for every caller of the process. */
export const tmuxLiveKnown = createTmuxLiveKnown();

/** This machine's live Donel sessions, kept `ttlMs` (5 s) by the picture; the same memory as `tmuxLiveKnown`. */
export const tmuxLiveNow = fromKnown(tmuxLiveKnown);
