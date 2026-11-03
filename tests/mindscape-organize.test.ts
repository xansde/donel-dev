import { describe, expect, it } from 'vitest';
import { ORGANIZE_COLUMN_GAP, ORGANIZE_NOTE_GAP, ORGANIZE_PAIR_GAP, organizeBoard, organizeColumnOf } from '../src/shared/mindscape/organize';
import { NOTE_CARD_HEIGHT, SESSION_CARD_HEIGHT, SESSION_CARD_WIDTH, type MindscapeCard, type MindscapeDoc } from '../src/shared/mindscape/model';

const P = 'C:\\proj\\atlas';

function docOf(cards: MindscapeCard[]): MindscapeDoc {
  return {
    schemaVersion: 2,
    boards: { [P]: { projectPath: P, pan: { x: 0, y: 0 }, zoom: 1, cards: Object.fromEntries(cards.map((card) => [card.id, card])), links: [], drawings: [] } },
  };
}
const session = (id: string, x: number, y: number): MindscapeCard => ({ kind: 'session', id: `session:${id}`, sessionId: id, x, y });
const note = (id: string, x: number, y: number): MindscapeCard => ({ kind: 'session-note', id: `note:${id}`, sessionId: id, sessionName: id, text: 't', writtenAt: 1, x, y });
const owner = (id: string, x: number, y: number): MindscapeCard => ({ kind: 'owner', id, text: 'meu', color: 'none', createdAt: 1, x, y });
const pos = (doc: MindscapeDoc, id: string): { x: number; y: number } => {
  const card = doc.boards[P]!.cards[id]!;
  return { x: card.x, y: card.y };
};

describe('organizeColumnOf', () => {
  it('permission, error and an unseen finished turn need the owner', () => {
    expect(organizeColumnOf('permission', 'dimmed')).toBe('attention');
    expect(organizeColumnOf('error', 'dimmed')).toBe('attention');
    expect(organizeColumnOf('waiting', 'highlighted')).toBe('attention');
  });
  it('working is working; a seen waiting or a done one is waiting', () => {
    expect(organizeColumnOf('working', 'normal')).toBe('working');
    expect(organizeColumnOf('waiting', 'dimmed')).toBe('waiting');
    expect(organizeColumnOf('done', 'dimmed')).toBe('waiting');
  });
});

describe('organizeBoard', () => {
  it('stacks each session with its note right below, from the top-left of what it moves', () => {
    const doc = docOf([session('a', 500, 300), note('a', 900, 900), session('b', 200, 400)]);
    const next = organizeBoard(doc, P, [
      { sessionId: 'a', column: 'attention' },
      { sessionId: 'b', column: 'attention' },
    ]);
    expect(pos(next, 'session:a')).toEqual({ x: 200, y: 300 });
    expect(pos(next, 'note:a')).toEqual({ x: 200, y: 300 + SESSION_CARD_HEIGHT + ORGANIZE_NOTE_GAP });
    const afterA = 300 + SESSION_CARD_HEIGHT + ORGANIZE_NOTE_GAP + NOTE_CARD_HEIGHT + ORGANIZE_PAIR_GAP;
    expect(pos(next, 'session:b')).toEqual({ x: 200, y: afterA });
  });

  it('columns go left to right in fixed order and an empty column takes no space', () => {
    const doc = docOf([session('w', 0, 0), session('c', 0, 0)]);
    const next = organizeBoard(doc, P, [
      { sessionId: 'c', column: 'closed' },
      { sessionId: 'w', column: 'working' },
    ]);
    expect(pos(next, 'session:w')).toEqual({ x: 0, y: 0 });
    expect(pos(next, 'session:c')).toEqual({ x: SESSION_CARD_WIDTH + ORGANIZE_COLUMN_GAP, y: 0 });
  });

  it('uses the measured size of a card when it has one', () => {
    const doc = docOf([session('a', 0, 0), note('a', 0, 0), session('b', 0, 0)]);
    const next = organizeBoard(
      doc,
      P,
      [
        { sessionId: 'a', column: 'waiting' },
        { sessionId: 'b', column: 'waiting' },
      ],
      { 'session:a': { w: 230, h: 80 }, 'note:a': { w: 230, h: 150 } },
    );
    expect(pos(next, 'note:a')).toEqual({ x: 0, y: 80 + ORGANIZE_NOTE_GAP });
    expect(pos(next, 'session:b')).toEqual({ x: 0, y: 80 + ORGANIZE_NOTE_GAP + 150 + ORGANIZE_PAIR_GAP });
  });

  it('never moves what is not listed: the owner post-its, a favorite and its note', () => {
    const doc = docOf([session('a', 100, 100), session('fav', 40, 40), note('fav', 60, 60), owner('o', 10, 10)]);
    const next = organizeBoard(doc, P, [{ sessionId: 'a', column: 'working' }]);
    expect(pos(next, 'session:fav')).toEqual({ x: 40, y: 40 });
    expect(pos(next, 'note:fav')).toEqual({ x: 60, y: 60 });
    expect(pos(next, 'o')).toEqual({ x: 10, y: 10 });
    expect(pos(next, 'session:a')).toEqual({ x: 100, y: 100 });
  });

  it('nothing to move, or a board that does not exist: the same document', () => {
    const doc = docOf([session('a', 1, 2)]);
    expect(organizeBoard(doc, P, [])).toBe(doc);
    expect(organizeBoard(doc, 'C:\\outro', [{ sessionId: 'a', column: 'working' }])).toBe(doc);
  });

  it('an entry with no card on the board is skipped', () => {
    const doc = docOf([session('a', 5, 5)]);
    const next = organizeBoard(doc, P, [
      { sessionId: 'ghost', column: 'attention' },
      { sessionId: 'a', column: 'attention' },
    ]);
    expect(pos(next, 'session:a')).toEqual({ x: 5, y: 5 });
  });
});
