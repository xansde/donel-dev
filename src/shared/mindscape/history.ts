// Mindscape desenho, fatia 02 — Ctrl+Z / Ctrl+Shift+Z, pure. One history per
// board (the renderer keeps a `projectPath → BoardHistory` map in memory; it
// starts empty at every app launch). Each owner action records the board
// before and after it; the reducers are immutable, so a snapshot shares its
// structure and costs little. Undo/redo bring a snapshot back merged with what
// the session did meanwhile: a session event never "goes back".
// Design: docs/design/mindscape-desenho.md, "Ctrl+Z / Ctrl+Shift+Z".

import type { MindscapeBoard, MindscapeCard } from './model';

/** Entries kept per board; the oldest goes first. */
export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  readonly before: MindscapeBoard;
  readonly after: MindscapeBoard;
}

export interface BoardHistory {
  readonly undo: readonly HistoryEntry[];
  readonly redo: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: BoardHistory = Object.freeze({ undo: Object.freeze([]), redo: Object.freeze([]) }) as BoardHistory;

/** A new owner action: on top of the undo stack (capped), and the redo stack is emptied. */
export function recordHistory(history: BoardHistory, entry: HistoryEntry): BoardHistory {
  const undo = [...history.undo, entry];
  return { undo: undo.length > HISTORY_LIMIT ? undo.slice(undo.length - HISTORY_LIMIT) : undo, redo: [] };
}

export interface HistoryStep {
  readonly history: BoardHistory;
  /** The board to show: the snapshot merged with the session facts of `current`. */
  readonly board: MindscapeBoard;
}

/** Ctrl+Z: the last entry's `before`, with the session facts of `current`. Nothing to undo → `null`. */
export function undoHistory(history: BoardHistory, current: MindscapeBoard): HistoryStep | null {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return null;
  return {
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, entry] },
    board: mergeSessionFacts(entry.before, current, entry.after),
  };
}

/** Ctrl+Shift+Z: the last undone entry's `after`, with the session facts of `current`. Nothing to redo → `null`. */
export function redoHistory(history: BoardHistory, current: MindscapeBoard): HistoryStep | null {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return null;
  return {
    history: { undo: [...history.undo, entry], redo: history.redo.slice(0, -1) },
    board: mergeSessionFacts(entry.after, current, entry.before),
  };
}

/**
 * The board of `snapshot` (owner cards, drawings, links, positions) with the
 * session facts of `current`:
 * - a session post-it (or a post-it written by the session) that is in
 *   `current` and not in the snapshot stays whole;
 * - the post-it written by the session keeps the current `text`, `writtenAt`
 *   and `sessionName`, at the snapshot position;
 * - `pan` and `zoom` come from `current` (moving the view is not an action);
 * - a link whose card is not in the result is dropped.
 *
 * `counterpart` is the other side of the entry being undone/redone: a post-it
 * written by the session that is in it with the same `writtenAt` and not in the
 * snapshot was removed by the action itself ("Arquivar"), so it is not brought
 * back. Rewritten after that (a newer `writtenAt`), it is a newer session fact
 * and stays.
 */
export function mergeSessionFacts(snapshot: MindscapeBoard, current: MindscapeBoard, counterpart?: MindscapeBoard): MindscapeBoard {
  const cards: Record<string, MindscapeCard> = { ...snapshot.cards };
  for (const card of Object.values(current.cards)) {
    if (card.kind === 'owner') continue;
    const before = snapshot.cards[card.id];
    if (card.kind === 'session') {
      if (!before) cards[card.id] = card;
      continue;
    }
    if (before?.kind === 'session-note') {
      cards[card.id] = { ...card, x: before.x, y: before.y };
      continue;
    }
    const removedByAction = counterpart?.cards[card.id];
    if (removedByAction?.kind === 'session-note' && removedByAction.writtenAt === card.writtenAt) continue;
    cards[card.id] = card;
  }
  const links = snapshot.links.filter((link) => cards[link.from] && cards[link.to]);
  return { ...snapshot, pan: current.pan, zoom: current.zoom, cards, links: links.length === snapshot.links.length ? snapshot.links : links };
}
