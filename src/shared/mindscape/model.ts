// Mindscape — pure model of the board (V1 + mindscape-desenho). One `MindscapeBoard` per project
// (`projectPath` = the tab `cwd`), persisted whole in `<userData>/mindscape.json`
// by the main (`src/main/mindscape-store.ts`). Design: docs/design/mindscape.md.
//
// Session cards are PLACES (v3, item 12a of the OpenRig plan): a stable id with
// the conversation of the moment, the previous ones and the role of the place.
// State, name and color still come live from the open tabs. Reducers never mutate; "nothing changed" returns the
// same object, so the renderer can skip a save by identity.

import type { TabColorToken } from '../tabAppearance';
import { isRoleId } from '../roles';
import { isImageId } from './images';
import { clampZoom } from './view';

/**
 * 2 since mindscape-desenho (drawings + zoom). Not an additive-safe change: the
 * V1 parse drops unknown fields, so a V1 channel would write over the drawings
 * — with 2 it falls into the store guard (reads, never writes).
 * 3 since the place (item 12a): a session card has its own id, the conversation
 * of the moment, the previous ones and a role. A v2 channel would drop a place
 * that has not started yet and every conversation after a renewal.
 * 7 since the link both ways (08/11): two arrows between the same two cards, one each way (Dev ⇄ Revisor). The
 * link has the same shape, but a v6 channel drops the arrow the other way whenever it rewires links (a place with a
 * post-it taking a new conversation, as after a /clear); with 7 it reads and never writes.
 * 8 since the parallel of a place (09/11, t-cccce5e4: "cada líder deverá ter a configuração de quanto aceita puxar e
 * tocar em paralelo"): `parallel` on a place card, set only by the owner. A v7 channel would drop it.
 */
export const MINDSCAPE_SCHEMA_VERSION = 8;
/** The most demands a place can be set to take in parallel. */
export const MAX_PARALLEL = 20;

/**
 * 4 since the board by MCP (item 08 + B37): what a session made on the board carries `by: 'session'`
 * (owner-kind post-it, place, drawing, link), so the session may later move, edit or remove ONLY that.
 * A v3 channel would drop the mark and hand the session's items to the owner.
 */
export type MadeBy = 'session';

/**
 * 5 since the reach of a board (`sessao_fechar`, owner 04/11): `reach: 'all'` lets the Líder of that board
 * direct sessions on every board. A v4 channel would drop it and shrink the Líder back to its own board.
 * The rule that reads it lives in `reach.ts`. Same version: the `opened` mark on the arrow `sessao_abrir` makes.
 */
export type BoardReach = 'own' | 'all';

/**
 * 6 since the pods (cadeiras, fatia 4; dono 07/11: a chair is a role on the board, and the pod arranges its own
 * chairs). A pod is a named group of chairs inside the board's rig: the owner names it, gives it a mission, moves it
 * and puts chairs in it; the chairs are laid out by the pod (never by hand). `x`/`y` are its corner in board units (like
 * a card); the rig is the frame around the pods. A role sits in one pod at most. A v5 channel would drop the pods.
 */
export interface MindscapePod {
  readonly id: string;
  readonly name: string;
  readonly mission?: string;
  /** The chairs of the pod: role ids, in the owner's order. */
  readonly roleIds: readonly string[];
  readonly x: number;
  readonly y: number;
}

export const MAX_POD_NAME_CHARS = 40;
export const MAX_POD_MISSION_CHARS = 200;

export type OwnerCardColor = Exclude<TabColorToken, 'permission'>;

export const OWNER_COLORS: readonly OwnerCardColor[] = ['none', 'accent', 'donel-accent'];

/**
 * The session card is a PLACE (item 12a). Its `id` is stable and is not a
 * conversation: a migrated card keeps its old `session:<first conversation>`
 * id, a place made on the board is `place:<uuid>`. `sessionId` is the
 * conversation of the moment, absent while the place "has not started yet";
 * `previous` holds the ones it had before (renewal in flight, `/clear`, fork in
 * the same tab), oldest first. `roleId` names `<userData>/papeis/<id>.md` and
 * only changes while the place has not started (`setPlaceRole`).
 */
export interface SessionPlaceCard {
  kind: 'session';
  id: string;
  sessionId?: string;
  previous: string[];
  roleId?: string;
  /** v4 — made by a session through the MCP (not by the owner). */
  by?: MadeBy;
  /** v8 — how many demands this place (a Líder, a Coordenador) takes in parallel; absent = no limit. Owner only. */
  parallel?: number;
  x: number;
  y: number;
}

export type MindscapeCard =
  | SessionPlaceCard
  | {
      kind: 'session-note';
      id: `note:${string}`;
      sessionId: string;
      sessionName: string;
      text: string;
      writtenAt: number;
      x: number;
      y: number;
    }
  | { kind: 'owner'; id: string; text: string; color: OwnerCardColor; createdAt: number; x: number; y: number; by?: MadeBy };

export interface MindscapeLink {
  id: string;
  from: string;
  to: string;
  arrow: boolean;
  by?: MadeBy;
  /** v5 — the arrow `sessao_abrir` makes from the opener to the session it opened (mother → daughter). With
   *  the owner's arrows, the only ones that count as hierarchy (`reach.ts`); an arrow a session draws with
   *  `quadro_aplicar` authorizes `sessao_enviar` but never puts it above anyone. */
  opened?: true;
}

/** Drawings use the owner's post-it palette (Sem cor / Azul / Dourado). */
export type DrawingColor = OwnerCardColor;
export type DrawingStroke = 'thin' | 'medium' | 'thick';

export const DRAWING_STROKES: readonly DrawingStroke[] = ['thin', 'medium', 'thick'];

/**
 * The owner's drawings, in board units (same as `card.x/y`). Loose arrow and
 * line are one kind (`arrow` on/off), like the link. Boxes always have a
 * positive `w`/`h` and no fill. The pencil stroke (fatia 04) keeps flattened
 * points `[x0, y0, x1, y1, …]`, rounded to 0.1. The print (fatia 06) has no
 * color nor stroke: only the `imageId` of its file in `mindscape-images/` and its box.
 */
export type MindscapeDrawing =
  | { kind: 'pencil'; id: string; color: DrawingColor; stroke: DrawingStroke; points: number[]; by?: MadeBy }
  | { kind: 'line'; id: string; color: DrawingColor; stroke: DrawingStroke; arrow: boolean; x1: number; y1: number; x2: number; y2: number; by?: MadeBy }
  | { kind: 'rect'; id: string; color: DrawingColor; stroke: DrawingStroke; x: number; y: number; w: number; h: number; by?: MadeBy }
  | { kind: 'ellipse'; id: string; color: DrawingColor; stroke: DrawingStroke; x: number; y: number; w: number; h: number; by?: MadeBy }
  | { kind: 'image'; id: string; imageId: string; x: number; y: number; w: number; h: number };

/** The drawings with ink (everything but the print): what the bar's color and stroke apply to. */
export type InkDrawing = Exclude<MindscapeDrawing, { kind: 'image' }>;

export interface MindscapeBoard {
  projectPath: string;
  pan: { x: number; y: number };
  /** 0.25 to 4; 1 = 100%. Changed by Ctrl+wheel, the pinch and the indicator (desenho, fatia 05). */
  zoom: number;
  cards: Record<string, MindscapeCard>;
  links: MindscapeLink[];
  /** Array order = layer (0 = at the back). All drawings stay under the links and the cards. */
  drawings: MindscapeDrawing[];
  /** v5 — absent = `'own'`: its sessions reach only this board. Only the owner changes it. */
  reach?: 'all';
  /** v6 — the pods of the board's rig; absent = none. Only the owner changes them. */
  pods?: MindscapePod[];
}

export interface MindscapeDoc {
  schemaVersion: 8;
  boards: Record<string, MindscapeBoard>;
}

/** Card footprint used by the automatic grid (matches the CSS of `MindscapeCard`). */
export const SESSION_CARD_WIDTH = 230;
export const SESSION_CARD_HEIGHT = 140;
/** Footprint of the post-it written by the session (8 clamped lines + author chip + meta + "Arquivar"). */
export const NOTE_CARD_WIDTH = 230;
export const NOTE_CARD_HEIGHT = 270;
/** The post-it written by the session keeps at most this many characters (design: cut in the store). */
export const MAX_SESSION_NOTE_CHARS = 4000;

const GRID_ORIGIN = { x: 40, y: 40 };
const GRID_GAP = 24;
const GRID_COLUMNS = 4;

export function emptyMindscapeDoc(): MindscapeDoc {
  return { schemaVersion: MINDSCAPE_SCHEMA_VERSION, boards: {} };
}

export function sessionCardId(sessionId: string): `session:${string}` {
  return `session:${sessionId}`;
}

export function noteCardId(sessionId: string): `note:${string}` {
  return `note:${sessionId}`;
}

/** Creates the board of `projectPath` when missing; same document back when it exists. */
export function ensureBoard(doc: MindscapeDoc, projectPath: string): MindscapeDoc {
  if (doc.boards[projectPath]) return doc;
  return {
    ...doc,
    boards: { ...doc.boards, [projectPath]: { projectPath, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings: [] } },
  };
}

interface Footprint {
  readonly w: number;
  readonly h: number;
}

const SESSION_FOOTPRINT: Footprint = { w: SESSION_CARD_WIDTH, h: SESSION_CARD_HEIGHT };
const NOTE_FOOTPRINT: Footprint = { w: NOTE_CARD_WIDTH, h: NOTE_CARD_HEIGHT };

/** Owner post-its use the same footprint as the note written by the session (same post-it shape). */
function footprintOf(card: MindscapeCard): Footprint {
  return card.kind === 'session' ? SESSION_FOOTPRINT : NOTE_FOOTPRINT;
}

function overlapsAny(x: number, y: number, size: Footprint, cards: readonly MindscapeCard[]): boolean {
  return cards.some((card) => {
    const other = footprintOf(card);
    return x < card.x + other.w && card.x < x + size.w && y < card.y + other.h && card.y < y + size.h;
  });
}

function freeGridSlot(
  cards: readonly MindscapeCard[],
  size: Footprint = SESSION_FOOTPRINT,
  origin: { x: number; y: number } = GRID_ORIGIN,
): { x: number; y: number } {
  for (let index = 0; ; index += 1) {
    const x = origin.x + (index % GRID_COLUMNS) * (SESSION_CARD_WIDTH + GRID_GAP);
    const y = origin.y + Math.floor(index / GRID_COLUMNS) * (SESSION_CARD_HEIGHT + GRID_GAP);
    if (!overlapsAny(x, y, size, cards)) return { x, y };
  }
}

// ---------------------------------------------------------------------------
// Item 12a — the session card is a place; the conversation changes, the card stays.
// ---------------------------------------------------------------------------

/** Id of a place made on the board ("＋ Sessão com papel…"), from a uuid of the caller. */
export function placeCardId(uuid: string): `place:${string}` {
  return `place:${uuid}`;
}

/** The place had a conversation (now or before): its role is fixed from then on. */
export function placeHasStarted(card: SessionPlaceCard): boolean {
  return card.sessionId !== undefined || card.previous.length > 0;
}

function placesOf(board: MindscapeBoard): SessionPlaceCard[] {
  return Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session');
}

/** The place whose conversation of the moment is `sessionId`. */
export function placeOfSession(board: MindscapeBoard, sessionId: string): SessionPlaceCard | undefined {
  return placesOf(board).find((card) => card.sessionId === sessionId);
}

/** The place that has `sessionId` now or had it before. */
export function placeHolding(board: MindscapeBoard, sessionId: string): SessionPlaceCard | undefined {
  return placeOfSession(board, sessionId) ?? placesOf(board).find((card) => card.previous.includes(sessionId));
}

/** Id of a place born from a conversation: `session:<id>` (what v2 used), suffixed when an older place already took it. */
function freePlaceId(board: MindscapeBoard, sessionId: string): string {
  const base = sessionCardId(sessionId);
  if (!board.cards[base]) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}~${n}`;
    if (!board.cards[id]) return id;
  }
}

/** Links after cards were renamed (or merged into another): no link to itself, no duplicate pair (as in `addLink`). */
function rewireLinks(links: readonly MindscapeLink[], renamed: ReadonlyMap<string, string>): MindscapeLink[] {
  if (renamed.size === 0) return [...links];
  const out: MindscapeLink[] = [];
  for (const link of links) {
    const from = renamed.get(link.from) ?? link.from;
    const to = renamed.get(link.to) ?? link.to;
    if (from === to) continue;
    // The rule of `addLink`: an arrow the other way next to an arrow is not a duplicate (Dev ⇄ Revisor).
    const duplicate = out.some((other) => (other.from === from && other.to === to) || (other.from === to && other.to === from && !(other.arrow && link.arrow)));
    if (duplicate) continue;
    out.push(from === link.from && to === link.to ? link : { ...link, from, to });
  }
  return out;
}

/**
 * The place `placeId` takes the conversation `to`: the one it had goes to `previous` and its
 * post-it (`note:<old>`) passes to the new conversation in the same spot. A card that `to`
 * already got elsewhere on the board (placed before this move) gives way to the place, its
 * links passing to it. Same conversation, or not a place → same board.
 */
function moveConversation(board: MindscapeBoard, placeId: string, to: string): MindscapeBoard {
  const place = board.cards[placeId];
  if (place?.kind !== 'session' || place.sessionId === to) return board;
  const cards = { ...board.cards };
  const renamed = new Map<string, string>();
  for (const other of placesOf(board)) {
    if (other.id !== placeId && other.sessionId === to) {
      delete cards[other.id];
      renamed.set(other.id, placeId);
    }
  }
  const from = place.sessionId;
  const previous = [...place.previous.filter((id) => id !== to && id !== from), ...(from ? [from] : [])];
  cards[placeId] = { ...place, sessionId: to, previous };
  if (from) {
    const note = cards[noteCardId(from)];
    if (note?.kind === 'session-note') {
      delete cards[noteCardId(from)];
      cards[noteCardId(to)] = { ...note, id: noteCardId(to), sessionId: to };
      renamed.set(noteCardId(from), noteCardId(to));
    }
  }
  return { ...board, cards, links: rewireLinks(board.links, renamed) };
}

function withBoardReplaced(doc: MindscapeDoc, board: MindscapeBoard): MindscapeDoc {
  return { ...doc, boards: { ...doc.boards, [board.projectPath]: board } };
}

/** A live conversation of a tab, as the placement sees it. */
export interface LiveConversation {
  readonly projectPath: string;
  readonly sessionId: string;
  /** Role the tab was launched with (Launcher): only used when the conversation gets a new place. */
  readonly roleId?: string;
}

function placeOne(doc: MindscapeDoc, session: LiveConversation, liveIds: ReadonlySet<string>): MindscapeDoc {
  const withBoard = ensureBoard(doc, session.projectPath);
  const board = withBoard.boards[session.projectPath]!;
  if (placeOfSession(board, session.sessionId)) return withBoard;
  // An older conversation of a place came back (resumed from the list): the place takes it back,
  // unless the conversation it has now is open in another tab.
  const holder = placeHolding(board, session.sessionId);
  if (holder && !(holder.sessionId && liveIds.has(holder.sessionId))) {
    return withBoardReplaced(withBoard, moveConversation(board, holder.id, session.sessionId));
  }
  const id = freePlaceId(board, session.sessionId);
  const slot = freeGridSlot(Object.values(board.cards));
  const card: SessionPlaceCard = { kind: 'session', id, sessionId: session.sessionId, previous: [], ...(session.roleId ? { roleId: session.roleId } : {}), ...slot };
  return withBoardReplaced(withBoard, { ...board, cards: { ...board.cards, [id]: card } });
}

/**
 * Gives every live conversation a place on its project board (creating the board on the first
 * session — rule 9). A conversation that is already the one of a place keeps it, in its
 * position; nothing to do → same document.
 */
export function placeSessionCards(doc: MindscapeDoc, live: readonly LiveConversation[]): MindscapeDoc {
  const liveIds = new Set(live.map((session) => session.sessionId));
  return live.reduce((acc, session) => placeOne(acc, session, liveIds), doc);
}

/** One conversation: `placeSessionCards` with only it live. */
export function placeSessionCard(doc: MindscapeDoc, projectPath: string, sessionId: string, roleId?: string): MindscapeDoc {
  return placeSessionCards(doc, [{ projectPath, sessionId, ...(roleId ? { roleId } : {}) }]);
}

/** The project of the board that holds the place (or the note) of `sessionId`. */
export function findSessionBoard(doc: MindscapeDoc, sessionId: string): string | undefined {
  const noteKey = noteCardId(sessionId);
  return Object.values(doc.boards).find((board) => placeOfSession(board, sessionId) || board.cards[noteKey])?.projectPath;
}

/** Role of the place that has (or had) `sessionId`, on any board. */
export function roleOfSession(doc: MindscapeDoc, sessionId: string): string | undefined {
  for (const board of Object.values(doc.boards)) {
    const place = placeHolding(board, sessionId);
    if (place) return place.roleId;
  }
  return undefined;
}

/**
 * Sessão renovada em voo (B36), `/clear` and fork in the same tab: the conversation `to` is
 * added to the place of `from` — same card, same spot, same role, same links; the post-it
 * follows. Replaces `carrySessionCard` (before the place, the card itself was renamed).
 * Nothing to carry → same document.
 */
export function appendConversation(doc: MindscapeDoc, fromSessionId: string, toSessionId: string): MindscapeDoc {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return doc;
  let next = doc;
  for (const board of Object.values(doc.boards)) {
    const place = placeOfSession(board, fromSessionId);
    if (!place) continue;
    // `/resume` of a conversation that already has its own place: that place wakes up with the
    // tab, and this one goes dormant — a place is never emptied to make room for another.
    const holder = placeHolding(board, toSessionId);
    if (holder && holder.id !== place.id) continue;
    next = withBoardReplaced(next, moveConversation(board, place.id, toSessionId));
  }
  return next;
}

/**
 * The place `placeId` starts (or continues) with `sessionId` — the tab opened from a place
 * that had not started yet. Applied BEFORE the tab gets the id, like the renewal, so the board
 * never makes a second card. Missing place or same conversation → same document.
 */
export function setPlaceConversation(doc: MindscapeDoc, projectPath: string, placeId: string, sessionId: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !sessionId || board.cards[placeId]?.kind !== 'session') return doc;
  const next = moveConversation(board, placeId, sessionId);
  return next === board ? doc : withBoardReplaced(doc, next);
}

export interface PlaceInput {
  /** `place:<uuid>`, made by the caller so the reducer stays pure. */
  readonly id: string;
  readonly roleId?: string;
  /** Top-left of the grid to search for a free spot (the visible corner of the view). */
  readonly origin?: { x: number; y: number };
  /** v4 — made by a session through the MCP. */
  readonly by?: MadeBy;
}

/** "＋ Sessão com papel…" — a place that has not started yet, with its role. An id in use → same document. */
export function addPlace(doc: MindscapeDoc, projectPath: string, input: PlaceInput): MindscapeDoc {
  const withBoard = ensureBoard(doc, projectPath);
  const board = withBoard.boards[projectPath]!;
  if (!input.id || board.cards[input.id]) return doc;
  const slot = freeGridSlot(Object.values(board.cards), SESSION_FOOTPRINT, input.origin ?? GRID_ORIGIN);
  const card: SessionPlaceCard = { kind: 'session', id: input.id, previous: [], ...(input.roleId ? { roleId: input.roleId } : {}), ...(input.by ? { by: input.by } : {}), ...slot };
  return withBoardReplaced(withBoard, { ...board, cards: { ...board.cards, [input.id]: card } });
}

/**
 * Role of a place — only while it has not started (item 12: the role is fixed per place; another
 * role is another session, and the work is delegated). Started, missing or same role → same document.
 */
export function setPlaceRole(doc: MindscapeDoc, projectPath: string, placeId: string, roleId: string | undefined): MindscapeDoc {
  const board = doc.boards[projectPath];
  const card = board?.cards[placeId];
  if (!board || card?.kind !== 'session' || placeHasStarted(card) || card.roleId === roleId) return doc;
  const next: SessionPlaceCard = { ...card };
  if (roleId) next.roleId = roleId;
  else delete next.roleId;
  return withBoardReplaced(doc, { ...board, cards: { ...board.cards, [placeId]: next } });
}

/** v8 — how many demands a place takes in parallel (`null` = no limit). The owner's gesture; sessions never set it. */
export function setPlaceParallel(doc: MindscapeDoc, projectPath: string, placeId: string, parallel: number | null): MindscapeDoc {
  const board = doc.boards[projectPath];
  const card = board?.cards[placeId];
  if (!board || card?.kind !== 'session' || (card.parallel ?? null) === parallel) return doc;
  if (parallel !== null && !isParallel(parallel)) return doc;
  const next: SessionPlaceCard = { ...card };
  if (parallel === null) delete next.parallel;
  else next.parallel = parallel;
  return withBoardReplaced(doc, { ...board, cards: { ...board.cards, [placeId]: next } });
}

export interface SessionNoteInput {
  readonly sessionId: string;
  /** Name of the session at the end of the turn — kept so the note survives the tab closing. */
  readonly sessionName: string;
  readonly text: string;
  readonly writtenAt: number;
}

/** Where a new note goes: beside its session card (right, below, left), else the first free grid slot. */
function noteSlot(cards: readonly MindscapeCard[], session: MindscapeCard | undefined): { x: number; y: number } {
  if (session) {
    const candidates = [
      { x: session.x + SESSION_CARD_WIDTH + GRID_GAP, y: session.y },
      { x: session.x, y: session.y + SESSION_CARD_HEIGHT + GRID_GAP },
      { x: session.x - NOTE_CARD_WIDTH - GRID_GAP, y: session.y },
    ];
    const free = candidates.find((slot) => slot.x >= 0 && !overlapsAny(slot.x, slot.y, NOTE_FOOTPRINT, cards));
    if (free) return free;
  }
  return freeGridSlot(cards, NOTE_FOOTPRINT);
}

/**
 * The post-it written by the session (rule 2): one per session
 * (`note:<sessionId>`), overwritten at every end of turn. The first write
 * places it beside the session card; the next ones keep its position. Text is
 * cut at 4.000 characters.
 */
export function writeSessionNote(doc: MindscapeDoc, projectPath: string, note: SessionNoteInput): MindscapeDoc {
  const id = noteCardId(note.sessionId);
  const withBoard = ensureBoard(doc, projectPath);
  const board = withBoard.boards[projectPath]!;
  const text = note.text.slice(0, MAX_SESSION_NOTE_CHARS);
  const existing = board.cards[id];
  const position = existing ? { x: existing.x, y: existing.y } : noteSlot(Object.values(board.cards), placeOfSession(board, note.sessionId));
  const card: MindscapeCard = {
    kind: 'session-note',
    id,
    sessionId: note.sessionId,
    sessionName: note.sessionName,
    text,
    writtenAt: note.writtenAt,
    ...position,
  };
  return { ...withBoard, boards: { ...withBoard.boards, [projectPath]: { ...board, cards: { ...board.cards, [id]: card } } } };
}

/** Archive = remove the card from the board, with the links that touch it (no trash in V1). */
export function archiveCard(doc: MindscapeDoc, projectPath: string, cardId: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !board.cards[cardId]) return doc;
  const cards = { ...board.cards };
  delete cards[cardId];
  const links = board.links.filter((link) => link.from !== cardId && link.to !== cardId);
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, cards, links } } };
}

// ---------------------------------------------------------------------------
// Fatia 04 — free canvas: move cards, move the view, the owner's post-its.
// ---------------------------------------------------------------------------

function replaceCard(doc: MindscapeDoc, board: MindscapeBoard, card: MindscapeCard): MindscapeDoc {
  return { ...doc, boards: { ...doc.boards, [board.projectPath]: { ...board, cards: { ...board.cards, [card.id]: card } } } };
}

/** Drag of a card: only its x/y change. Missing card, same spot or a non-finite spot → same document. */
export function moveCard(doc: MindscapeDoc, projectPath: string, cardId: string, x: number, y: number): MindscapeDoc {
  const board = doc.boards[projectPath];
  const card = board?.cards[cardId];
  if (!board || !card || !Number.isFinite(x) || !Number.isFinite(y)) return doc;
  if (card.x === x && card.y === y) return doc;
  return replaceCard(doc, board, { ...card, x, y });
}

/**
 * Desenho, fatia 05 (replaces `setBoardPan`) — the view of the board (pan in
 * px of screen, zoom held between 25% and 400%), persisted with it and out of
 * the history (it goes through `applySession`). Missing board, a non-finite
 * value or the same view → same document.
 */
export function setBoardView(doc: MindscapeDoc, projectPath: string, view: { pan: { x: number; y: number }; zoom: number }): MindscapeDoc {
  const board = doc.boards[projectPath];
  const { pan } = view;
  if (!board || !Number.isFinite(pan.x) || !Number.isFinite(pan.y) || !Number.isFinite(view.zoom)) return doc;
  const zoom = clampZoom(view.zoom);
  if (board.pan.x === pan.x && board.pan.y === pan.y && board.zoom === zoom) return doc;
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, pan: { x: pan.x, y: pan.y }, zoom } } };
}

export interface OwnerCardInput {
  /** Unique id, made by the caller (`crypto.randomUUID()` in the renderer) so the reducer stays pure. */
  readonly id: string;
  readonly createdAt: number;
  /** Top-left of the grid to search for a free spot (the visible corner of the view); default: the board grid. */
  readonly origin?: { x: number; y: number };
  /** v4 — made by a session through the MCP. */
  readonly by?: MadeBy;
}

/** "Novo post-it" — an owner card, empty text and no color, on the first free spot from `origin`. An id in use → same document. */
export function addOwnerCard(doc: MindscapeDoc, projectPath: string, input: OwnerCardInput): MindscapeDoc {
  const withBoard = ensureBoard(doc, projectPath);
  const board = withBoard.boards[projectPath]!;
  if (!input.id || board.cards[input.id]) return doc;
  const slot = freeGridSlot(Object.values(board.cards), NOTE_FOOTPRINT, input.origin ?? GRID_ORIGIN);
  return replaceCard(withBoard, board, { kind: 'owner', id: input.id, text: '', color: 'none', createdAt: input.createdAt, ...(input.by ? { by: input.by } : {}), ...slot });
}

/** Inline edit of the owner's post-it. Same text, or a card that is not the owner's → same document. */
export function editOwnerCard(doc: MindscapeDoc, projectPath: string, cardId: string, text: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  const card = board?.cards[cardId];
  if (!board || !card || card.kind !== 'owner' || card.text === text) return doc;
  return replaceCard(doc, board, { ...card, text });
}

/** Color of the owner's post-it: Sem cor / Azul / Dourado only — `permission` is refused (rule 6). */
export function setOwnerColor(doc: MindscapeDoc, projectPath: string, cardId: string, color: OwnerCardColor): MindscapeDoc {
  const board = doc.boards[projectPath];
  const card = board?.cards[cardId];
  if (!board || !card || card.kind !== 'owner' || !OWNER_COLORS.includes(color) || card.color === color) return doc;
  return replaceCard(doc, board, { ...card, color });
}

// ---------------------------------------------------------------------------
// Fatia 05 — links between two post-its of the same board (rule 5).
// ---------------------------------------------------------------------------

function replaceLinks(doc: MindscapeDoc, board: MindscapeBoard, links: MindscapeLink[]): MindscapeDoc {
  return { ...doc, boards: { ...doc.boards, [board.projectPath]: { ...board, links } } };
}

export interface LinkInput {
  /** Unique id, made by the caller (`crypto.randomUUID()` in the renderer) so the reducer stays pure. */
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Arrow head at `to`; default `true` (V1). Drawing with `L` passes `false`. */
  readonly arrow?: boolean;
  /** v4 — made by a session through the MCP. */
  readonly by?: MadeBy;
  /** v5 — made by `sessao_abrir` (mother → daughter). */
  readonly opened?: true;
}

/**
 * Links two cards of the board, arrow on unless `arrow: false`. A card to itself, a card missing
 * from the board, an id in use or a pair already linked → same document. Already linked: the same way, or
 * either way when one of the two is a line (an arrow the other way next to an arrow is a link of its own).
 */
export function addLink(doc: MindscapeDoc, projectPath: string, input: LinkInput): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !input.id || input.from === input.to) return doc;
  if (!board.cards[input.from] || !board.cards[input.to]) return doc;
  // 08/11 — an arrow the other way next to an arrow is a link of its own (Dev ⇄ Revisor talk both ways); a line has no
  // way, so a line and anything between the same two cards is the same link. The file shape does not change.
  const arrow = input.arrow ?? true;
  const taken = board.links.some(
    (link) =>
      link.id === input.id ||
      (link.from === input.from && link.to === input.to) ||
      (link.from === input.to && link.to === input.from && !(arrow && link.arrow)),
  );
  if (taken) return doc;
  return replaceLinks(doc, board, [...board.links, { id: input.id, from: input.from, to: input.to, arrow, ...(input.by ? { by: input.by } : {}), ...(input.opened ? { opened: true as const } : {}) }]);
}

/** Switches the arrow of the link on/off. Missing link → same document. */
export function toggleLinkArrow(doc: MindscapeDoc, projectPath: string, linkId: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !board.links.some((link) => link.id === linkId)) return doc;
  return replaceLinks(
    doc,
    board,
    board.links.map((link) => (link.id === linkId ? { ...link, arrow: !link.arrow } : link)),
  );
}

/** Removes only the target link. Missing link → same document. */
export function removeLink(doc: MindscapeDoc, projectPath: string, linkId: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !board.links.some((link) => link.id === linkId)) return doc;
  return replaceLinks(
    doc,
    board,
    board.links.filter((link) => link.id !== linkId),
  );
}

/**
 * The links drawn on screen: both ends visible. A link to a session card
 * without an open tab stays in the board and comes back when the session does.
 */
export function visibleLinks(links: readonly MindscapeLink[], visibleCardIds: ReadonlySet<string>): MindscapeLink[] {
  return links.filter((link) => visibleCardIds.has(link.from) && visibleCardIds.has(link.to));
}

// ---------------------------------------------------------------------------
// Guard for whatever comes from disk (or from the renderer, in the main).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isParallel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PARALLEL;
}

function parseCard(key: string, raw: unknown): MindscapeCard | null {
  if (!isRecord(raw) || raw.id !== key || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null;
  const { x, y } = raw;
  switch (raw.kind) {
    case 'session': {
      // v1/v2: `session:<sessionId>`, always with the conversation. v3: the place's own id; no
      // conversation = "ainda não começou". A v2 card becomes a place with the same id, so its
      // position, its post-it and its links stay as they were.
      const sessionId = isNonEmptyString(raw.sessionId) ? raw.sessionId : undefined;
      if (raw.sessionId !== undefined && sessionId === undefined) return null;
      const previous = Array.isArray(raw.previous)
        ? [...new Set(raw.previous.filter(isNonEmptyString))].filter((id) => id !== sessionId)
        : [];
      const card: SessionPlaceCard = { kind: 'session', id: key, ...(sessionId ? { sessionId } : {}), previous, x, y };
      if (isRoleId(raw.roleId)) card.roleId = raw.roleId;
      if (raw.by === 'session') card.by = 'session';
      if (isParallel(raw.parallel)) card.parallel = raw.parallel;
      return card;
    }
    case 'session-note':
      if (!isNonEmptyString(raw.sessionId) || key !== `note:${raw.sessionId}`) return null;
      if (typeof raw.sessionName !== 'string' || typeof raw.text !== 'string' || !isFiniteNumber(raw.writtenAt)) return null;
      return {
        kind: 'session-note',
        id: `note:${raw.sessionId}`,
        sessionId: raw.sessionId,
        sessionName: raw.sessionName,
        text: raw.text,
        writtenAt: raw.writtenAt,
        x,
        y,
      };
    case 'owner':
      if (typeof raw.text !== 'string' || !isFiniteNumber(raw.createdAt)) return null;
      if (!OWNER_COLORS.includes(raw.color as OwnerCardColor)) return null;
      return { kind: 'owner', id: key, text: raw.text, color: raw.color as OwnerCardColor, createdAt: raw.createdAt, x, y, ...(raw.by === 'session' ? { by: 'session' as const } : {}) };
    default:
      return null;
  }
}

function parseLink(raw: unknown): MindscapeLink | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.from) || !isNonEmptyString(raw.to)) return null;
  if (typeof raw.arrow !== 'boolean') return null;
  return { id: raw.id, from: raw.from, to: raw.to, arrow: raw.arrow, ...(raw.by === 'session' ? { by: 'session' as const } : {}), ...(raw.opened === true ? { opened: true as const } : {}) };
}

/**
 * Guard of one drawing (disk, renderer or reducer input): wrong color, unknown
 * stroke, non-finite number, a box with `w`/`h` ≤ 0, a pencil stroke with odd
 * `points` or fewer than 2 points, or a print with an `imageId` out of the
 * pattern → `null`. The result carries only the known fields.
 */
export function parseDrawing(raw: unknown): MindscapeDrawing | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.id)) return null;
  if (raw.kind === 'image') {
    // Fatia 06 — the print: no color nor stroke; the imageId is the only name the main builds a path from.
    const { x, y, w, h, imageId } = raw;
    if (!isImageId(imageId) || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) return null;
    return { kind: 'image', id: raw.id, imageId, x, y, w, h };
  }
  if (!OWNER_COLORS.includes(raw.color as DrawingColor) || !DRAWING_STROKES.includes(raw.stroke as DrawingStroke)) return null;
  const base = { id: raw.id, color: raw.color as DrawingColor, stroke: raw.stroke as DrawingStroke, ...(raw.by === 'session' ? { by: 'session' as const } : {}) };
  switch (raw.kind) {
    case 'pencil': {
      const { points } = raw;
      if (!Array.isArray(points) || points.length < 4 || points.length % 2 !== 0 || !points.every(isFiniteNumber)) return null;
      return { kind: 'pencil', ...base, points: [...points] };
    }
    case 'line': {
      const { x1, y1, x2, y2, arrow } = raw;
      if (typeof arrow !== 'boolean' || !isFiniteNumber(x1) || !isFiniteNumber(y1) || !isFiniteNumber(x2) || !isFiniteNumber(y2)) return null;
      return { kind: 'line', ...base, arrow, x1, y1, x2, y2 };
    }
    case 'rect':
    case 'ellipse': {
      const { x, y, w, h } = raw;
      if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) return null;
      return { kind: raw.kind, ...base, x, y, w, h };
    }
    default:
      return null;
  }
}

function parseBoard(key: string, raw: unknown): MindscapeBoard | null {
  if (!isRecord(raw) || raw.projectPath !== key) return null;
  const pan = isRecord(raw.pan) && isFiniteNumber(raw.pan.x) && isFiniteNumber(raw.pan.y) ? { x: raw.pan.x, y: raw.pan.y } : { x: 0, y: 0 };
  const cards: Record<string, MindscapeCard> = {};
  if (isRecord(raw.cards)) {
    for (const [cardKey, cardRaw] of Object.entries(raw.cards)) {
      const card = parseCard(cardKey, cardRaw);
      if (card) cards[cardKey] = card;
    }
  }
  const links = Array.isArray(raw.links) ? raw.links.map(parseLink).filter((link): link is MindscapeLink => link !== null) : [];
  // v1 has neither: no drawings, 100%.
  const zoom = isFiniteNumber(raw.zoom) ? clampZoom(raw.zoom) : 1;
  const drawings = Array.isArray(raw.drawings) ? raw.drawings.map(parseDrawing).filter((drawing): drawing is MindscapeDrawing => drawing !== null) : [];
  const pods = parsePods(raw.pods);
  return { projectPath: key, pan, zoom, cards, links, drawings, ...(raw.reach === 'all' ? { reach: 'all' as const } : {}), ...(pods.length > 0 ? { pods } : {}) };
}

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

/** v6 — bad pods are dropped one by one; a repeated pod id keeps the first; a role taken by an earlier pod is dropped. */
function parsePods(raw: unknown): MindscapePod[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const taken = new Set<string>();
  const pods: MindscapePod[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_POD_NAME_CHARS) : '';
    if (!name || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y)) continue;
    const mission = typeof entry.mission === 'string' ? entry.mission.trim().slice(0, MAX_POD_MISSION_CHARS) : '';
    const roleIds = (Array.isArray(entry.roleIds) ? entry.roleIds : []).filter((roleId): roleId is string => isRoleId(roleId) && !taken.has(roleId));
    const unique = [...new Set(roleIds)];
    unique.forEach((roleId) => taken.add(roleId));
    ids.add(entry.id);
    pods.push({ id: entry.id, name, ...(mission ? { mission } : {}), roleIds: unique, x: roundTenth(entry.x), y: roundTenth(entry.y) });
  }
  return pods;
}

function withPods(doc: MindscapeDoc, board: MindscapeBoard, pods: MindscapePod[]): MindscapeDoc {
  const { pods: _old, ...rest } = board;
  return withBoardReplaced(doc, pods.length > 0 ? { ...rest, pods } : rest);
}

/** v6 — a new empty pod (the owner's "+ Pod"). An existing id or a missing board → same document. */
export function addPod(doc: MindscapeDoc, projectPath: string, pod: { id: string; name: string; x: number; y: number }): MindscapeDoc {
  const board = doc.boards[projectPath];
  const name = pod.name.trim().slice(0, MAX_POD_NAME_CHARS);
  if (!board || !name || (board.pods ?? []).some((candidate) => candidate.id === pod.id)) return doc;
  return withPods(doc, board, [...(board.pods ?? []), { id: pod.id, name, roleIds: [], x: roundTenth(pod.x), y: roundTenth(pod.y) }]);
}

/** v6 — the owner renames a pod or writes its mission (an empty mission removes it; an empty name is refused). */
export function updatePod(doc: MindscapeDoc, projectPath: string, podId: string, change: { name?: string; mission?: string }): MindscapeDoc {
  const board = doc.boards[projectPath];
  const pod = board?.pods?.find((candidate) => candidate.id === podId);
  if (!board || !pod) return doc;
  const name = change.name === undefined ? pod.name : change.name.trim().slice(0, MAX_POD_NAME_CHARS);
  const mission = change.mission === undefined ? (pod.mission ?? '') : change.mission.trim().slice(0, MAX_POD_MISSION_CHARS);
  if (!name || (name === pod.name && mission === (pod.mission ?? ''))) return doc;
  const { mission: _old, ...rest } = pod;
  const next: MindscapePod = { ...rest, name, ...(mission ? { mission } : {}) };
  return withPods(doc, board, board.pods!.map((candidate) => (candidate.id === podId ? next : candidate)));
}

/** v6 — the owner drags a pod (board units); its chairs follow, laid out by the pod. */
export function movePod(doc: MindscapeDoc, projectPath: string, podId: string, x: number, y: number): MindscapeDoc {
  const board = doc.boards[projectPath];
  const pod = board?.pods?.find((candidate) => candidate.id === podId);
  if (!board || !pod || !Number.isFinite(x) || !Number.isFinite(y)) return doc;
  const nx = roundTenth(x);
  const ny = roundTenth(y);
  if (nx === pod.x && ny === pod.y) return doc;
  return withPods(doc, board, board.pods!.map((candidate) => (candidate.id === podId ? { ...candidate, x: nx, y: ny } : candidate)));
}

/** v6 — puts a chair (a role) in a pod, taking it out of any other; `null` leaves it with no pod. */
export function setChairPod(doc: MindscapeDoc, projectPath: string, roleId: string, podId: string | null): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !isRoleId(roleId)) return doc;
  const pods = board.pods ?? [];
  if (podId !== null && !pods.some((pod) => pod.id === podId)) return doc;
  const current = pods.find((pod) => pod.roleIds.includes(roleId))?.id ?? null;
  if (current === podId) return doc;
  const next = pods.map((pod) => {
    const without = pod.roleIds.filter((id) => id !== roleId);
    return pod.id === podId ? { ...pod, roleIds: [...without, roleId] } : without.length === pod.roleIds.length ? pod : { ...pod, roleIds: without };
  });
  return withPods(doc, board, next);
}

/** v6 — removes a pod; its chairs stay on the board, with no pod. */
export function removePod(doc: MindscapeDoc, projectPath: string, podId: string): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board?.pods?.some((pod) => pod.id === podId)) return doc;
  return withPods(doc, board, board.pods.filter((pod) => pod.id !== podId));
}

/** The owner's toggle "Alcance" of a board. No board → same document. */
export function setBoardReach(doc: MindscapeDoc, projectPath: string, reach: BoardReach): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || (board.reach ?? 'own') === reach) return doc;
  const { reach: _old, ...rest } = board;
  return withBoardReplaced(doc, reach === 'all' ? { ...rest, reach: 'all' } : rest);
}

/**
 * Sanitizes an untrusted document, v1 to v7; always comes out as v7. Garbage
 * or absence → empty document; bad boards, cards, links and drawings are
 * dropped one by one (an owner card colored `permission` is not accepted — rule 6).
 */
export function parseMindscapeDoc(raw: unknown): MindscapeDoc {
  const doc = emptyMindscapeDoc();
  if (!isRecord(raw) || !isRecord(raw.boards)) return doc;
  for (const [key, boardRaw] of Object.entries(raw.boards)) {
    const board = parseBoard(key, boardRaw);
    if (board) doc.boards[key] = board;
  }
  return doc;
}
