import { describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  mergeSessionFacts,
  recordHistory,
  redoHistory,
  undoHistory,
  type BoardHistory,
} from '../src/shared/mindscape/history';
import type { MindscapeBoard, MindscapeCard, MindscapeLink } from '../src/shared/mindscape/model';

// Mindscape desenho, fatia 02 — Ctrl+Z / Ctrl+Shift+Z: per-board stacks of
// { before, after } snapshots, capped at 100; undo/redo bring back the
// snapshot, merged with what the session did meanwhile (a session event never
// "goes back" with an undo).

const ATLAS = 'C:/work/atlas';

function board(extra: Partial<MindscapeBoard> = {}): MindscapeBoard {
  return { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings: [], ...extra };
}

function cards(...list: MindscapeCard[]): Record<string, MindscapeCard> {
  return Object.fromEntries(list.map((card) => [card.id, card]));
}

const session: MindscapeCard = { kind: 'session', id: 'session:s1', sessionId: 's1', x: 40, y: 40 };
const owner: MindscapeCard = { kind: 'owner', id: 'o1', text: 'ver deploy', color: 'none', createdAt: 1, x: 300, y: 40 };
const note = (text: string, writtenAt: number, x = 300, y = 300): MindscapeCard => ({
  kind: 'session-note',
  id: 'note:s1',
  sessionId: 's1',
  sessionName: `sessão ${writtenAt}`,
  text,
  writtenAt,
  x,
  y,
});
const rect = { kind: 'rect' as const, id: 'd1', color: 'none' as const, stroke: 'medium' as const, x: 10, y: 20, w: 100, h: 50 };

describe('recordHistory / undoHistory / redoHistory', () => {
  it('undo gives the before back and redo the after', () => {
    const before = board();
    const after = board({ drawings: [rect] });
    const recorded = recordHistory(EMPTY_HISTORY, { before, after });

    const undone = undoHistory(recorded, after);
    expect(undone).not.toBeNull();
    expect(undone!.board).toEqual(before);
    expect(undone!.history.undo).toHaveLength(0);
    expect(undone!.history.redo).toHaveLength(1);

    const redone = redoHistory(undone!.history, undone!.board);
    expect(redone).not.toBeNull();
    expect(redone!.board).toEqual(after);
    expect(redone!.history.undo).toHaveLength(1);
    expect(redone!.history.redo).toHaveLength(0);
  });

  it('undoes in reverse order, one entry at a time', () => {
    const b0 = board();
    const b1 = board({ drawings: [rect] });
    const b2 = board({ drawings: [rect], cards: cards(owner) });
    let history = recordHistory(recordHistory(EMPTY_HISTORY, { before: b0, after: b1 }), { before: b1, after: b2 });
    const first = undoHistory(history, b2)!;
    expect(first.board).toEqual(b1);
    history = first.history;
    const second = undoHistory(history, first.board)!;
    expect(second.board).toEqual(b0);
  });

  it('returns null with nothing to undo or redo', () => {
    expect(undoHistory(EMPTY_HISTORY, board())).toBeNull();
    expect(redoHistory(EMPTY_HISTORY, board())).toBeNull();
  });

  it(`keeps at most ${HISTORY_LIMIT} entries: the 101st drops the oldest`, () => {
    expect(HISTORY_LIMIT).toBe(100);
    let history: BoardHistory = EMPTY_HISTORY;
    const boards = Array.from({ length: 102 }, (_, index) => board({ pan: { x: index, y: 0 } }));
    for (let index = 0; index < 101; index += 1) history = recordHistory(history, { before: boards[index]!, after: boards[index + 1]! });
    expect(history.undo).toHaveLength(100);
    expect(history.undo[0]!.before).toBe(boards[1]);
    expect(history.undo[99]!.after).toBe(boards[101]);
  });

  it('a new action after an undo empties the redo stack', () => {
    const b0 = board();
    const b1 = board({ drawings: [rect] });
    const undone = undoHistory(recordHistory(EMPTY_HISTORY, { before: b0, after: b1 }), b1)!;
    expect(undone.history.redo).toHaveLength(1);
    const next = recordHistory(undone.history, { before: b0, after: board({ cards: cards(owner) }) });
    expect(next.redo).toHaveLength(0);
    expect(next.undo).toHaveLength(1);
  });

  it('never mutates the history it receives', () => {
    const recorded = recordHistory(EMPTY_HISTORY, { before: board(), after: board({ drawings: [rect] }) });
    const snapshot = JSON.stringify(recorded);
    undoHistory(recorded, board({ drawings: [rect] }));
    recordHistory(recorded, { before: board(), after: board() });
    expect(JSON.stringify(recorded)).toBe(snapshot);
    expect(EMPTY_HISTORY).toEqual({ undo: [], redo: [] });
  });
});

describe('mergeSessionFacts', () => {
  it('keeps a session post-it that did not exist in the snapshot', () => {
    const snapshot = board({ drawings: [rect] });
    const current = board({ cards: cards(session) });
    expect(mergeSessionFacts(snapshot, current).cards).toEqual(cards(session));
  });

  it('a session post-it in both keeps the snapshot position (moving it is an owner action)', () => {
    const snapshot = board({ cards: cards(session) });
    const current = board({ cards: cards({ ...session, x: 500, y: 500 }) });
    expect(mergeSessionFacts(snapshot, current).cards[session.id]).toEqual(session);
  });

  it('the post-it written by the session keeps the current text, writtenAt and sessionName, at the snapshot position', () => {
    const snapshot = board({ cards: cards(note('antigo', 1, 10, 20)) });
    const current = board({ cards: cards(note('novo', 2, 600, 700)) });
    expect(mergeSessionFacts(snapshot, current).cards['note:s1']).toEqual(note('novo', 2, 10, 20));
  });

  it('keeps whole the post-it written by the session that was born after the snapshot', () => {
    const snapshot = board({ cards: cards(owner) });
    const current = board({ cards: cards(owner, note('novo', 2, 600, 700)) });
    expect(mergeSessionFacts(snapshot, current).cards['note:s1']).toEqual(note('novo', 2, 600, 700));
  });

  it('brings pan and zoom from the current board', () => {
    const snapshot = board({ pan: { x: 1, y: 2 }, zoom: 1 });
    const current = board({ pan: { x: 80, y: -40 }, zoom: 2 });
    const merged = mergeSessionFacts(snapshot, current);
    expect(merged.pan).toEqual({ x: 80, y: -40 });
    expect(merged.zoom).toBe(2);
  });

  it('drops a link whose card is not in the result', () => {
    const link: MindscapeLink = { id: 'l1', from: 'o1', to: 'session:s1', arrow: true };
    const kept: MindscapeLink = { id: 'l2', from: 'o1', to: 'o2', arrow: false };
    const owner2: MindscapeCard = { ...owner, id: 'o2' };
    // `session:s1` is in neither board, so the link to it cannot be drawn and goes away.
    const snapshot = board({ cards: cards(owner, owner2), links: [link, kept] });
    const current = board({ cards: cards(owner, owner2) });
    expect(mergeSessionFacts(snapshot, current).links).toEqual([kept]);
  });

  it('owner cards, links and drawings come from the snapshot', () => {
    const snapshot = board({ cards: cards(owner), drawings: [rect] });
    const current = board({ cards: cards({ ...owner, text: 'outro', x: 0 }), drawings: [] });
    const merged = mergeSessionFacts(snapshot, current);
    expect(merged.cards).toEqual(cards(owner));
    expect(merged.drawings).toEqual([rect]);
  });

  it('a session post-it removed by the action itself is not brought back (redo of "Arquivar")', () => {
    // Entry: archive of the note. Undo brought it back; redo has to archive it again.
    const withNote = board({ cards: cards(owner, note('texto', 5)) });
    const archived = board({ cards: cards(owner) });
    const recorded = recordHistory(EMPTY_HISTORY, { before: withNote, after: archived });
    const undone = undoHistory(recorded, archived)!;
    expect(undone.board.cards['note:s1']).toEqual(note('texto', 5));
    const redone = redoHistory(undone.history, undone.board)!;
    expect(redone.board.cards['note:s1']).toBeUndefined();
  });

  it('a session post-it rewritten after the archive stays on redo (it is a newer session fact)', () => {
    const withNote = board({ cards: cards(note('texto', 5)) });
    const archived = board();
    const undone = undoHistory(recordHistory(EMPTY_HISTORY, { before: withNote, after: archived }), archived)!;
    const rewritten = { ...undone.board, cards: cards(note('nova resposta', 9)) };
    const redone = redoHistory(undone.history, rewritten)!;
    expect(redone.board.cards['note:s1']).toEqual(note('nova resposta', 9));
  });
});
