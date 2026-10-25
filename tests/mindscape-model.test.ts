import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addLink,
  addOwnerCard,
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
    expect(doc.boards[ATLAS]).toEqual({ projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings: [] });
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

// ---------------------------------------------------------------------------
// Mindscape desenho, fatia 01 — schema v2: drawings and zoom; v1 still reads.
// ---------------------------------------------------------------------------

const V1_SAMPLE = path.join(__dirname, 'fixtures/mindscape/v1-sample.json');

describe('parseMindscapeDoc — schema v2', () => {
  it('reads a v1 file with no drawings and zoom 1, and comes out as v2', () => {
    const doc = parseMindscapeDoc(JSON.parse(readFileSync(V1_SAMPLE, 'utf8')));
    expect(doc.schemaVersion).toBe(2);
    const board = doc.boards[ATLAS]!;
    expect(board.drawings).toEqual([]);
    expect(board.zoom).toBe(1);
    expect(board.pan).toEqual({ x: 12, y: -30 });
    expect(Object.keys(board.cards).sort()).toEqual(['o1', 'session:s1']);
    expect(board.links).toEqual([{ id: 'l1', from: 'o1', to: 'session:s1', arrow: true }]);
  });

  it('round-trips the drawings of a v2 document', () => {
    const drawings = [
      { kind: 'rect', id: 'd1', color: 'none', stroke: 'thin', x: 1, y: 2, w: 30, h: 40 },
      { kind: 'ellipse', id: 'd2', color: 'accent', stroke: 'medium', x: -5, y: 6, w: 7, h: 8 },
      { kind: 'line', id: 'd3', color: 'donel-accent', stroke: 'thick', arrow: true, x1: 0, y1: 0, x2: 50, y2: 60 },
    ];
    const raw = { schemaVersion: 2, boards: { [ATLAS]: { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings } } };
    expect(parseMindscapeDoc(raw).boards[ATLAS]!.drawings).toEqual(drawings);
  });

  it('drops invalid drawings one by one, keeping the valid ones', () => {
    const ok = { kind: 'rect', id: 'ok', color: 'accent', stroke: 'medium', x: 0, y: 0, w: 10, h: 10 };
    const drawings = [
      ok,
      { ...ok, id: 'bad-color', color: 'permission' },
      { ...ok, id: 'bad-stroke', stroke: 'huge' },
      { ...ok, id: 'bad-number', x: 'zero' },
      { ...ok, id: 'zero-w', w: 0 },
      { ...ok, id: 'neg-h', h: -3 },
      { kind: 'ellipse', id: 'no-h', color: 'none', stroke: 'thin', x: 0, y: 0, w: 4 },
      { kind: 'line', id: 'no-arrow', color: 'none', stroke: 'thin', x1: 0, y1: 0, x2: 1, y2: 1 },
      { kind: 'line', id: 'inf', color: 'none', stroke: 'thin', arrow: false, x1: 0, y1: 0, x2: 1e400, y2: 1 },
      { kind: 'triangle', id: 'unknown', color: 'none', stroke: 'thin' },
      { ...ok, id: '' },
      'junk',
    ];
    const raw = { schemaVersion: 2, boards: { [ATLAS]: { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings } } };
    expect(parseMindscapeDoc(raw).boards[ATLAS]!.drawings.map((drawing) => drawing.id)).toEqual(['ok']);
  });

  it('holds a zoom out of range at the limit and falls back to 1 when it is not a number', () => {
    const board = (zoom: unknown) => ({ schemaVersion: 2, boards: { [ATLAS]: { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom, cards: {}, links: [], drawings: [] } } });
    expect(parseMindscapeDoc(board(10)).boards[ATLAS]!.zoom).toBe(4);
    expect(parseMindscapeDoc(board(0.01)).boards[ATLAS]!.zoom).toBe(0.25);
    expect(parseMindscapeDoc(board('big')).boards[ATLAS]!.zoom).toBe(1);
  });
});

describe('addLink — arrow on the input', () => {
  function cards(): MindscapeDoc {
    return addOwnerCard(addOwnerCard(emptyMindscapeDoc(), ATLAS, { id: 'o1', createdAt: 1 }), ATLAS, { id: 'o2', createdAt: 2 });
  }

  it('is born with the arrow when `arrow` is left out (V1 behavior)', () => {
    expect(addLink(cards(), ATLAS, { id: 'l1', from: 'o1', to: 'o2' }).boards[ATLAS]!.links[0]!.arrow).toBe(true);
  });

  it('is born without the arrow with `arrow: false` (drawn with L)', () => {
    expect(addLink(cards(), ATLAS, { id: 'l1', from: 'o1', to: 'o2', arrow: false }).boards[ATLAS]!.links[0]!.arrow).toBe(false);
  });
});
