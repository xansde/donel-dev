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

const OWNER_COLORS: readonly OwnerCardColor[] = ['none', 'accent', 'donel-accent'];

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

const GRID_ORIGIN = { x: 40, y: 40 };
const GRID_GAP = 24;
const GRID_COLUMNS = 4;

export function emptyMindscapeDoc(): MindscapeDoc {
  return { schemaVersion: MINDSCAPE_SCHEMA_VERSION, boards: {} };
}

export function sessionCardId(sessionId: string): `session:${string}` {
  return `session:${sessionId}`;
}

/** Creates the board of `projectPath` when missing; same document back when it exists. */
export function ensureBoard(doc: MindscapeDoc, projectPath: string): MindscapeDoc {
  if (doc.boards[projectPath]) return doc;
  return {
    ...doc,
    boards: { ...doc.boards, [projectPath]: { projectPath, pan: { x: 0, y: 0 }, cards: {}, links: [] } },
  };
}

function overlapsAny(x: number, y: number, cards: readonly MindscapeCard[]): boolean {
  return cards.some(
    (card) =>
      x < card.x + SESSION_CARD_WIDTH && card.x < x + SESSION_CARD_WIDTH && y < card.y + SESSION_CARD_HEIGHT && card.y < y + SESSION_CARD_HEIGHT,
  );
}

function freeGridSlot(cards: readonly MindscapeCard[]): { x: number; y: number } {
  for (let index = 0; ; index += 1) {
    const x = GRID_ORIGIN.x + (index % GRID_COLUMNS) * (SESSION_CARD_WIDTH + GRID_GAP);
    const y = GRID_ORIGIN.y + Math.floor(index / GRID_COLUMNS) * (SESSION_CARD_HEIGHT + GRID_GAP);
    if (!overlapsAny(x, y, cards)) return { x, y };
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
