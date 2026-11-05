// Mindscape, lugar principal — "Organizar" (docs/refinamentos/mindscape-lugar-principal.md, rule 7).
// One gesture lays the session cards out in columns, each with the note it wrote right below:
// parada com pendência · terminou e você não viu · trabalhando · em espera · fechadas (item 04 added
// the first one). Only what the caller lists moves (it leaves the favorites out, rule 6); the owner's
// post-its, drawings and prints never move, and the links follow the cards by themselves. Pure: the
// screen applies it as one history entry (Ctrl+Z undoes).

import type { SessionHighlight } from './highlight';
import { NOTE_CARD_HEIGHT, SESSION_CARD_HEIGHT, SESSION_CARD_WIDTH, noteCardId, type MindscapeDoc } from './model';
import { isStalledWithNeed, type SessionAxes } from './sessionAxes';

/** `stalled` = parada com pendência; `attention` = terminou e você não viu. */
export type OrganizeColumn = 'stalled' | 'attention' | 'working' | 'waiting' | 'closed';

/** Left to right. */
export const ORGANIZE_COLUMNS: readonly OrganizeColumn[] = ['stalled', 'attention', 'working', 'waiting', 'closed'];

export const ORGANIZE_COLUMN_GAP = 48;
/** Between a session card and its note. */
export const ORGANIZE_NOTE_GAP = 12;
/** Between one session (with its note) and the next in the same column. */
export const ORGANIZE_PAIR_GAP = 32;

export interface OrganizeEntry {
  /** The place (session card). */
  readonly cardId: string;
  /** Its conversation of the moment, whose note goes right below; absent while it has not started. */
  readonly sessionId?: string;
  readonly column: OrganizeColumn;
}

/**
 * The column of a session with an open tab (a dormant one is always `closed`). Item 04: from its three
 * axes — stopped with something open → `stalled`; the process gone with nothing open → `closed`;
 * "desconhecido" waits with the stopped ones (never counted as working).
 */
export function organizeColumnOf(axes: SessionAxes, highlight: SessionHighlight): OrganizeColumn {
  if (isStalledWithNeed(axes)) return 'stalled';
  if (axes.process === 'fechada') return 'closed';
  if (axes.activity === 'trabalhando') return 'working';
  return highlight === 'highlighted' ? 'attention' : 'waiting';
}

type Sizes = Readonly<Record<string, { readonly w: number; readonly h: number }>>;

/**
 * Lays out `entries` (already in the order wanted inside each column). Starts at the top-left of
 * the cards it moves; a column with no entry takes no space; an entry without a card is skipped.
 */
export function organizeBoard(doc: MindscapeDoc, projectPath: string, entries: readonly OrganizeEntry[], sizes: Sizes = {}): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  const present = entries.filter((entry) => board.cards[entry.cardId]);
  if (present.length === 0) return doc;

  const noteOf = (entry: OrganizeEntry): string | undefined => (entry.sessionId ? noteCardId(entry.sessionId) : undefined);
  const moved = present.flatMap((entry) => [board.cards[entry.cardId], board.cards[noteOf(entry) ?? '']]).filter((card) => card !== undefined);
  const originX = Math.min(...moved.map((card) => card.x));
  const originY = Math.min(...moved.map((card) => card.y));

  const cards = { ...board.cards };
  let x = originX;
  for (const column of ORGANIZE_COLUMNS) {
    const inColumn = present.filter((entry) => entry.column === column);
    if (inColumn.length === 0) continue;
    let y = originY;
    for (const entry of inColumn) {
      const placeId = entry.cardId;
      cards[placeId] = { ...cards[placeId]!, x, y };
      y += (sizes[placeId]?.h ?? SESSION_CARD_HEIGHT) + ORGANIZE_NOTE_GAP;
      const noteId = noteOf(entry);
      const note = noteId ? cards[noteId] : undefined;
      if (noteId && note) {
        cards[noteId] = { ...note, x, y };
        y += (sizes[noteId]?.h ?? NOTE_CARD_HEIGHT) + ORGANIZE_PAIR_GAP;
      } else {
        y += ORGANIZE_PAIR_GAP - ORGANIZE_NOTE_GAP;
      }
    }
    x += SESSION_CARD_WIDTH + ORGANIZE_COLUMN_GAP;
  }
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, cards } } };
}
