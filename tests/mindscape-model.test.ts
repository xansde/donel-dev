import { describe, expect, it } from 'vitest';
import {
  emptyMindscapeDoc,
  ensureBoard,
  parseMindscapeDoc,
  placeSessionCard,
  SESSION_CARD_HEIGHT,
  SESSION_CARD_WIDTH,
  type MindscapeCard,
  type MindscapeDoc,
} from '../src/shared/mindscape/model';

// Mindscape, fatia 01 — the pure model: one board per project, a session card
// per live `claude` session, and the guard for whatever comes from disk.

const ATLAS = 'C:/work/atlas';
const BEACON = 'C:/work/beacon';

function overlaps(a: MindscapeCard, b: MindscapeCard): boolean {
  return a.x < b.x + SESSION_CARD_WIDTH && b.x < a.x + SESSION_CARD_WIDTH && a.y < b.y + SESSION_CARD_HEIGHT && b.y < a.y + SESSION_CARD_HEIGHT;
}

describe('ensureBoard', () => {
  it('creates an empty board for a project that has none', () => {
    const doc = ensureBoard(emptyMindscapeDoc(), ATLAS);
    expect(doc.boards[ATLAS]).toEqual({ projectPath: ATLAS, pan: { x: 0, y: 0 }, cards: {}, links: [] });
  });

  it('is idempotent: an existing board comes back as the same document', () => {
    const once = ensureBoard(emptyMindscapeDoc(), ATLAS);
    const twice = ensureBoard(once, ATLAS);
    expect(twice).toBe(once);
  });

  it('keeps the other boards untouched', () => {
    const withAtlas = ensureBoard(emptyMindscapeDoc(), ATLAS);
    const withBoth = ensureBoard(withAtlas, BEACON);
    expect(withBoth.boards[ATLAS]).toBe(withAtlas.boards[ATLAS]);
    expect(Object.keys(withBoth.boards)).toEqual([ATLAS, BEACON]);
  });
});

describe('placeSessionCard', () => {
  it('creates the board and a session card on the first session of the project', () => {
    const doc = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1');
    const card = doc.boards[ATLAS]?.cards['session:s1'];
    expect(card).toMatchObject({ kind: 'session', id: 'session:s1', sessionId: 's1' });
  });

  it('gives grid positions that do not overlap', () => {
    let doc: MindscapeDoc = emptyMindscapeDoc();
    for (const id of ['s1', 's2', 's3', 's4', 's5', 's6']) doc = placeSessionCard(doc, ATLAS, id);
    const cards = Object.values(doc.boards[ATLAS]?.cards ?? {});
    expect(cards).toHaveLength(6);
    for (const a of cards) {
      for (const b of cards) {
        if (a !== b) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it('does not land on a card the owner moved into the first slot', () => {
    const first = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1');
    const slot = first.boards[ATLAS]!.cards['session:s1']!;
    // s1 moved away; an owner card now sits where the first slot is.
    const board = first.boards[ATLAS]!;
    const moved: MindscapeDoc = {
      ...first,
      boards: {
        [ATLAS]: {
          ...board,
          cards: {
            'session:s1': { ...slot, x: 900, y: 900 },
            o1: { kind: 'owner', id: 'o1', text: 'x', color: 'none', createdAt: 1, x: slot.x, y: slot.y },
          },
        },
      },
    };
    const next = placeSessionCard(moved, ATLAS, 's2');
    const placed = next.boards[ATLAS]!.cards['session:s2']!;
    expect(overlaps(placed, next.boards[ATLAS]!.cards.o1!)).toBe(false);
  });

  it('keeps the position already saved (same document back)', () => {
    const doc = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1');
    const board = doc.boards[ATLAS]!;
    const saved: MindscapeDoc = {
      ...doc,
      boards: { [ATLAS]: { ...board, cards: { 'session:s1': { ...board.cards['session:s1']!, x: 777, y: 333 } } } },
    };
    const again = placeSessionCard(saved, ATLAS, 's1');
    expect(again).toBe(saved);
    expect(again.boards[ATLAS]!.cards['session:s1']).toMatchObject({ x: 777, y: 333 });
  });
});

describe('parseMindscapeDoc', () => {
  it('returns the empty document for garbage or absence', () => {
    for (const raw of [undefined, null, 42, 'lixo', [], { boards: 'no' }, { schemaVersion: 'x' }]) {
      expect(parseMindscapeDoc(raw)).toEqual(emptyMindscapeDoc());
    }
  });

  it('round-trips a valid document', () => {
    let doc = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1');
    doc = placeSessionCard(doc, BEACON, 's2');
    expect(parseMindscapeDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('drops an owner card whose color is permission, keeping the valid ones', () => {
    const raw = {
      schemaVersion: 1,
      boards: {
        [ATLAS]: {
          projectPath: ATLAS,
          pan: { x: 5, y: 6 },
          cards: {
            ok: { kind: 'owner', id: 'ok', text: 'oi', color: 'accent', createdAt: 1, x: 1, y: 2 },
            bad: { kind: 'owner', id: 'bad', text: 'oi', color: 'permission', createdAt: 1, x: 1, y: 2 },
            junk: { kind: 'session', id: 'session:z' },
          },
          links: [{ id: 'l1', from: 'ok', to: 'bad', arrow: true }, 'junk'],
        },
      },
    };
    const doc = parseMindscapeDoc(raw);
    expect(Object.keys(doc.boards[ATLAS]!.cards)).toEqual(['ok']);
    expect(doc.boards[ATLAS]!.pan).toEqual({ x: 5, y: 6 });
    expect(doc.boards[ATLAS]!.links).toEqual([{ id: 'l1', from: 'ok', to: 'bad', arrow: true }]);
  });
});
