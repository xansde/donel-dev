// Mindscape (V1) — pure model of the board. One `MindscapeBoard` per project
// (`projectPath` = the tab `cwd`), persisted whole in `<userData>/mindscape.json`
// by the main (`src/main/mindscape-store.ts`). Design: docs/design/mindscape.md.
//
// Session cards only persist their position: state, name and color come live
// from the open tabs. Reducers never mutate; "nothing changed" returns the
// same object, so the renderer can skip a save by identity.

import type { TabColorToken } from '../tabAppearance';

export const MINDSCAPE_SCHEMA_VERSION = 1;

export type OwnerCardColor = Exclude<TabColorToken, 'permission'>;

export const OWNER_COLORS: readonly OwnerCardColor[] = ['none', 'accent', 'donel-accent'];

export type MindscapeCard =
  | { kind: 'session'; id: `session:${string}`; sessionId: string; x: number; y: number }
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
  | { kind: 'owner'; id: string; text: string; color: OwnerCardColor; createdAt: number; x: number; y: number };

export interface MindscapeLink {
  id: string;
  from: string;
  to: string;
  arrow: boolean;
}

export interface MindscapeBoard {
  projectPath: string;
  pan: { x: number; y: number };
  cards: Record<string, MindscapeCard>;
  links: MindscapeLink[];
}

export interface MindscapeDoc {
  schemaVersion: 1;
  boards: Record<string, MindscapeBoard>;
}

/** Card footprint used by the automatic grid (matches the CSS of `MindscapeCard`). */
export const SESSION_CARD_WIDTH = 230;
export const SESSION_CARD_HEIGHT = 96;
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
    boards: { ...doc.boards, [projectPath]: { projectPath, pan: { x: 0, y: 0 }, cards: {}, links: [] } },
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

/**
 * Gives the session a card on its project board (creating the board on the
 * first session — rule 9). A card that already exists keeps its position and
 * the same document comes back.
 */
export function placeSessionCard(doc: MindscapeDoc, projectPath: string, sessionId: string): MindscapeDoc {
  const id = sessionCardId(sessionId);
  const withBoard = ensureBoard(doc, projectPath);
  const board = withBoard.boards[projectPath]!;
  if (board.cards[id]) return withBoard;
  const slot = freeGridSlot(Object.values(board.cards));
  return {
    ...withBoard,
    boards: {
      ...withBoard.boards,
      [projectPath]: { ...board, cards: { ...board.cards, [id]: { kind: 'session', id, sessionId, ...slot } } },
    },
  };
}

/** The project of the board that holds the session card (or the note) of `sessionId`. */
export function findSessionBoard(doc: MindscapeDoc, sessionId: string): string | undefined {
  const sessionKey = sessionCardId(sessionId);
  const noteKey = noteCardId(sessionId);
  return Object.values(doc.boards).find((board) => board.cards[sessionKey] || board.cards[noteKey])?.projectPath;
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
  const position = existing ? { x: existing.x, y: existing.y } : noteSlot(Object.values(board.cards), board.cards[sessionCardId(note.sessionId)]);
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

/** Drag of the background: the view offset of the board, persisted with it. */
export function setBoardPan(doc: MindscapeDoc, projectPath: string, pan: { x: number; y: number }): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !Number.isFinite(pan.x) || !Number.isFinite(pan.y)) return doc;
  if (board.pan.x === pan.x && board.pan.y === pan.y) return doc;
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, pan: { x: pan.x, y: pan.y } } } };
}

export interface OwnerCardInput {
  /** Unique id, made by the caller (`crypto.randomUUID()` in the renderer) so the reducer stays pure. */
  readonly id: string;
  readonly createdAt: number;
  /** Top-left of the grid to search for a free spot (the visible corner of the view); default: the board grid. */
  readonly origin?: { x: number; y: number };
}

/** "Novo post-it" — an owner card, empty text and no color, on the first free spot from `origin`. An id in use → same document. */
export function addOwnerCard(doc: MindscapeDoc, projectPath: string, input: OwnerCardInput): MindscapeDoc {
  const withBoard = ensureBoard(doc, projectPath);
  const board = withBoard.boards[projectPath]!;
  if (!input.id || board.cards[input.id]) return doc;
  const slot = freeGridSlot(Object.values(board.cards), NOTE_FOOTPRINT, input.origin ?? GRID_ORIGIN);
  return replaceCard(withBoard, board, { kind: 'owner', id: input.id, text: '', color: 'none', createdAt: input.createdAt, ...slot });
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
}

/**
 * Links two cards of the board, arrow on. A card to itself, a card missing
 * from the board, an id in use or a pair already linked (either way) → same document.
 */
export function addLink(doc: MindscapeDoc, projectPath: string, input: LinkInput): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !input.id || input.from === input.to) return doc;
  if (!board.cards[input.from] || !board.cards[input.to]) return doc;
  const taken = board.links.some(
    (link) =>
      link.id === input.id ||
      (link.from === input.from && link.to === input.to) ||
      (link.from === input.to && link.to === input.from),
  );
  if (taken) return doc;
  return replaceLinks(doc, board, [...board.links, { id: input.id, from: input.from, to: input.to, arrow: true }]);
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

function parseCard(key: string, raw: unknown): MindscapeCard | null {
  if (!isRecord(raw) || raw.id !== key || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null;
  const { x, y } = raw;
  switch (raw.kind) {
    case 'session':
      if (!isNonEmptyString(raw.sessionId) || key !== sessionCardId(raw.sessionId)) return null;
      return { kind: 'session', id: sessionCardId(raw.sessionId), sessionId: raw.sessionId, x, y };
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
      return { kind: 'owner', id: key, text: raw.text, color: raw.color as OwnerCardColor, createdAt: raw.createdAt, x, y };
    default:
      return null;
  }
}

function parseLink(raw: unknown): MindscapeLink | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.from) || !isNonEmptyString(raw.to)) return null;
  if (typeof raw.arrow !== 'boolean') return null;
  return { id: raw.id, from: raw.from, to: raw.to, arrow: raw.arrow };
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
  return { projectPath: key, pan, cards, links };
}

/**
 * Sanitizes an untrusted document. Garbage or absence → empty document; bad
 * boards, cards and links are dropped one by one (an owner card colored
 * `permission` is not accepted — rule 6).
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
