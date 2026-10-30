import { describe, expect, it } from 'vitest';
import {
  addDrawing,
  appendPencilPoint,
  bringToFront,
  moveItems,
  PENCIL_MAX_POINTS,
  removeItems,
  sendToBack,
  setDrawingsStyle,
  STROKE_WIDTH,
  translateDrawing,
  updateDrawing,
} from '../src/shared/mindscape/drawings';
import {
  addLink,
  addOwnerCard,
  emptyMindscapeDoc,
  ensureBoard,
  noteCardId,
  placeSessionCard,
  sessionCardId,
  writeSessionNote,
  type InkDrawing,
  type MindscapeDoc,
  type MindscapeDrawing,
} from '../src/shared/mindscape/model';

// Mindscape desenho, fatia 01 — the owner's drawings (rect, ellipse, loose
// line/arrow) in board units; the array order is the layer (0 = at the back).

const ATLAS = 'C:/work/atlas';

function doc(): MindscapeDoc {
  return ensureBoard(emptyMindscapeDoc(), ATLAS);
}

const rect: MindscapeDrawing = { kind: 'rect', id: 'd1', color: 'none', stroke: 'medium', x: 10, y: 20, w: 100, h: 50 };

describe('addDrawing', () => {
  it('appends the drawing on top of the others', () => {
    const line: MindscapeDrawing = { kind: 'line', id: 'd2', color: 'accent', stroke: 'thin', arrow: true, x1: 0, y1: 0, x2: 40, y2: 30 };
    const next = addDrawing(addDrawing(doc(), ATLAS, rect), ATLAS, line);
    expect(next.boards[ATLAS]!.drawings).toEqual([rect, line]);
  });

  it('normalizes a box drawn from the bottom right to the top left', () => {
    const next = addDrawing(doc(), ATLAS, { kind: 'ellipse', id: 'd1', color: 'donel-accent', stroke: 'thick', x: 110, y: 70, w: -100, h: -50 });
    expect(next.boards[ATLAS]!.drawings).toEqual([{ kind: 'ellipse', id: 'd1', color: 'donel-accent', stroke: 'thick', x: 10, y: 20, w: 100, h: 50 }]);
  });

  it('refuses an id already in use, a missing board and an invalid drawing (same document back)', () => {
    const once = addDrawing(doc(), ATLAS, rect);
    expect(addDrawing(once, ATLAS, { ...rect, x: 999 })).toBe(once);
    const base = doc();
    expect(addDrawing(base, 'C:/work/vega', rect)).toBe(base);
    expect(addDrawing(base, ATLAS, { ...rect, w: 0 })).toBe(base);
    expect(addDrawing(base, ATLAS, { ...rect, x: Number.NaN })).toBe(base);
    expect(addDrawing(base, ATLAS, { ...rect, id: '' })).toBe(base);
  });

  it('keeps the other boards untouched', () => {
    const both = ensureBoard(doc(), 'C:/work/beacon');
    const next = addDrawing(both, ATLAS, rect);
    expect(next.boards['C:/work/beacon']).toBe(both.boards['C:/work/beacon']);
  });
});

describe('STROKE_WIDTH', () => {
  it('maps the three strokes to board units', () => {
    expect(STROKE_WIDTH).toEqual({ thin: 1.5, medium: 3, thick: 5 });
  });
});

// ---------------------------------------------------------------------------
// Fatia 03 — selection: move, remove, style and layer of several items at once.
// ---------------------------------------------------------------------------

const lineD: MindscapeDrawing = { kind: 'line', id: 'l1', color: 'none', stroke: 'thin', arrow: false, x1: 0, y1: 0, x2: 40, y2: 30 };
const ellipseD: MindscapeDrawing = { kind: 'ellipse', id: 'e1', color: 'accent', stroke: 'thick', x: 300, y: 300, w: 60, h: 40 };

/** atlas with a session card, a note written by the session, an owner post-it, three drawings and two links. */
function full(): MindscapeDoc {
  let next = placeSessionCard(doc(), ATLAS, 's1');
  next = writeSessionNote(next, ATLAS, { sessionId: 's1', sessionName: 'atlas', text: 'pronto', writtenAt: 5 });
  next = addOwnerCard(next, ATLAS, { id: 'o1', createdAt: 1 });
  for (const drawing of [rect, lineD, ellipseD]) next = addDrawing(next, ATLAS, drawing);
  next = addLink(next, ATLAS, { id: 'k1', from: 'o1', to: sessionCardId('s1') });
  return addLink(next, ATLAS, { id: 'k2', from: noteCardId('s1'), to: sessionCardId('s1') });
}

function drawingIds(next: MindscapeDoc): string[] {
  return next.boards[ATLAS]!.drawings.map((drawing) => drawing.id);
}

describe('moveItems', () => {
  it('moves cards and drawings together by the same offset', () => {
    const base = full();
    const before = base.boards[ATLAS]!;
    const session = sessionCardId('s1');
    const next = moveItems(base, ATLAS, { cards: ['o1', session], drawings: ['d1', 'l1'] }, 15, -5);
    const after = next.boards[ATLAS]!;
    expect(after.cards.o1).toMatchObject({ x: before.cards.o1!.x + 15, y: before.cards.o1!.y - 5 });
    expect(after.cards[session]).toMatchObject({ x: before.cards[session]!.x + 15, y: before.cards[session]!.y - 5 });
    expect(after.drawings[0]).toEqual({ ...rect, x: 25, y: 15 });
    expect(after.drawings[1]).toEqual({ ...lineD, x1: 15, y1: -5, x2: 55, y2: 25 });
    // Not in the selection: untouched.
    expect(after.drawings[2]).toBe(before.drawings[2]);
    expect(after.cards[noteCardId('s1')]).toBe(before.cards[noteCardId('s1')]);
  });

  it('returns the same document with no offset, no known id, a non-finite offset or a missing board', () => {
    const base = full();
    expect(moveItems(base, ATLAS, { cards: ['o1'], drawings: ['d1'] }, 0, 0)).toBe(base);
    expect(moveItems(base, ATLAS, { cards: ['nope'], drawings: ['nada'] }, 10, 10)).toBe(base);
    expect(moveItems(base, ATLAS, { cards: ['o1'], drawings: [] }, Number.NaN, 10)).toBe(base);
    expect(moveItems(base, 'C:/work/vega', { cards: ['o1'], drawings: [] }, 10, 10)).toBe(base);
  });
});

describe('removeItems', () => {
  it('archives the owner post-it and the one written by the session, ignores the session post-it and takes the drawings out', () => {
    const next = removeItems(full(), ATLAS, { cards: ['o1', noteCardId('s1'), sessionCardId('s1')], drawings: ['d1', 'e1'] });
    const after = next.boards[ATLAS]!;
    expect(Object.keys(after.cards)).toEqual([sessionCardId('s1')]);
    expect(drawingIds(next)).toEqual(['l1']);
    // The links of the archived cards go with them (archiveCard).
    expect(after.links).toEqual([]);
  });

  it('returns the same document when only a session post-it (or nothing known) is selected', () => {
    const base = full();
    expect(removeItems(base, ATLAS, { cards: [sessionCardId('s1')], drawings: [] })).toBe(base);
    expect(removeItems(base, ATLAS, { cards: ['nope'], drawings: ['nada'] })).toBe(base);
    expect(removeItems(base, 'C:/work/vega', { cards: ['o1'], drawings: ['d1'] })).toBe(base);
  });
});

describe('setDrawingsStyle', () => {
  it('changes the color and the stroke of the given drawings only', () => {
    const next = setDrawingsStyle(full(), ATLAS, ['d1', 'l1'], { color: 'accent' });
    expect(next.boards[ATLAS]!.drawings.map((drawing) => (drawing as InkDrawing).color)).toEqual(['accent', 'accent', 'accent']);
    const thick = setDrawingsStyle(next, ATLAS, ['d1'], { stroke: 'thick' });
    expect(thick.boards[ATLAS]!.drawings.map((drawing) => (drawing as InkDrawing).stroke)).toEqual(['thick', 'thin', 'thick']);
    expect(thick.boards[ATLAS]!.drawings[1]).toBe(next.boards[ATLAS]!.drawings[1]);
  });

  it('returns the same document when nothing changes or the style is not one of the bar', () => {
    const base = full();
    expect(setDrawingsStyle(base, ATLAS, ['d1'], { color: 'none', stroke: 'medium' })).toBe(base);
    expect(setDrawingsStyle(base, ATLAS, ['nada'], { color: 'accent' })).toBe(base);
    expect(setDrawingsStyle(base, ATLAS, ['d1'], {})).toBe(base);
    expect(setDrawingsStyle(base, ATLAS, ['d1'], { color: 'permission' as never })).toBe(base);
    expect(setDrawingsStyle(base, ATLAS, ['d1'], { stroke: 'huge' as never })).toBe(base);
  });
});

describe('bringToFront / sendToBack', () => {
  function five(): MindscapeDoc {
    let next = doc();
    for (const id of ['a', 'b', 'c', 'd', 'e']) next = addDrawing(next, ATLAS, { ...rect, id });
    return next;
  }

  it('moves the group to the top keeping its relative order', () => {
    expect(drawingIds(bringToFront(five(), ATLAS, ['d', 'b']))).toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('moves the group to the back keeping its relative order', () => {
    expect(drawingIds(sendToBack(five(), ATLAS, ['d', 'b']))).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('returns the same document when the group is already there, or unknown', () => {
    const base = five();
    expect(bringToFront(base, ATLAS, ['d', 'e'])).toBe(base);
    expect(sendToBack(base, ATLAS, ['a', 'b'])).toBe(base);
    expect(bringToFront(base, ATLAS, ['nada'])).toBe(base);
    expect(sendToBack(base, 'C:/work/vega', ['a'])).toBe(base);
  });
});

describe('updateDrawing', () => {
  it('replaces the drawing with the same id, normalizing the box', () => {
    const next = updateDrawing(full(), ATLAS, { ...rect, x: 110, w: -100 });
    expect(next.boards[ATLAS]!.drawings[0]).toEqual({ ...rect, x: 10, w: 100 });
    const resized = updateDrawing(full(), ATLAS, { ...rect, w: 200 });
    expect(resized.boards[ATLAS]!.drawings[0]).toEqual({ ...rect, w: 200 });
    expect(drawingIds(resized)).toEqual(['d1', 'l1', 'e1']);
  });

  it('returns the same document for an unknown id, an equal drawing or an invalid one', () => {
    const base = full();
    expect(updateDrawing(base, ATLAS, { ...rect, id: 'nada' })).toBe(base);
    expect(updateDrawing(base, ATLAS, { ...rect })).toBe(base);
    expect(updateDrawing(base, ATLAS, { ...rect, w: 0 })).toBe(base);
    expect(updateDrawing(base, 'C:/work/vega', rect)).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// Fatia 04 — the pencil: sampling of the stroke, and it moves with the selection.
// ---------------------------------------------------------------------------

describe('appendPencilPoint', () => {
  it('adds a point at least 2 units away from the last, rounded to 0.1', () => {
    expect(appendPencilPoint([0, 0], { x: 2.04, y: 0.06 })).toEqual([0, 0, 2, 0.1]);
    expect(appendPencilPoint([], { x: 1.234, y: 5.678 })).toEqual([1.2, 5.7]);
  });

  it('skips a point closer than 2 units (same array back)', () => {
    const points = [0, 0];
    expect(appendPencilPoint(points, { x: 1.9, y: 0 })).toBe(points);
    expect(appendPencilPoint(points, { x: 1, y: 1 })).toBe(points);
  });

  it('stops at 5.000 points per stroke', () => {
    const full = Array.from({ length: PENCIL_MAX_POINTS }, (_, index) => [index * 3, 0]).flat();
    expect(appendPencilPoint(full, { x: 1e6, y: 0 })).toBe(full);
    const almost = full.slice(0, -2);
    expect(appendPencilPoint(almost, { x: 1e6, y: 0 })).toHaveLength(PENCIL_MAX_POINTS * 2);
  });

  it('skips a non-finite point', () => {
    const points = [0, 0];
    expect(appendPencilPoint(points, { x: Number.NaN, y: 10 })).toBe(points);
  });
});

describe('the pencil stroke in the reducers', () => {
  const pencil: MindscapeDrawing = { kind: 'pencil', id: 'p1', color: 'accent', stroke: 'thin', points: [0, 0, 10, 5, 20, 0] };

  it('is added as it is and refused with an odd or too short points list', () => {
    expect(addDrawing(doc(), ATLAS, pencil).boards[ATLAS]!.drawings).toEqual([pencil]);
    const base = doc();
    expect(addDrawing(base, ATLAS, { ...pencil, points: [0, 0, 10] })).toBe(base);
    expect(addDrawing(base, ATLAS, { ...pencil, points: [0, 0] })).toBe(base);
  });

  it('moves with the selection: every point shifts', () => {
    expect(translateDrawing(pencil, 5, -2.5)).toEqual({ ...pencil, points: [5, -2.5, 15, 2.5, 25, -2.5] });
    const moved = moveItems(addDrawing(doc(), ATLAS, pencil), ATLAS, { cards: [], drawings: ['p1'] }, 1, 1);
    expect(moved.boards[ATLAS]!.drawings[0]).toEqual({ ...pencil, points: [1, 1, 11, 6, 21, 1] });
  });

  it('takes color and stroke from the bar and goes away with Delete', () => {
    const withPencil = addDrawing(doc(), ATLAS, pencil);
    expect(setDrawingsStyle(withPencil, ATLAS, ['p1'], { stroke: 'thick' }).boards[ATLAS]!.drawings[0]).toMatchObject({ kind: 'pencil', stroke: 'thick' });
    expect(removeItems(withPencil, ATLAS, { cards: [], drawings: ['p1'] }).boards[ATLAS]!.drawings).toEqual([]);
  });
});

describe('the print in the reducers (desenho, fatia 06)', () => {
  const print: MindscapeDrawing = { kind: 'image', id: 'im', imageId: 'img-a-0a1b2c3d.png', x: 10, y: 20, w: 300, h: 150 };

  it('addDrawing puts a valid print on top and refuses one with a bad imageId', () => {
    const next = addDrawing(doc(), ATLAS, print);
    expect(next.boards[ATLAS]!.drawings).toEqual([print]);
    expect(addDrawing(doc(), ATLAS, { ...print, imageId: '../x.png' })).toEqual(doc());
  });

  it('moveItems moves a print with the rest', () => {
    const start = addDrawing(addDrawing(doc(), ATLAS, print), ATLAS, rect);
    const next = moveItems(start, ATLAS, { cards: [], drawings: ['im', 'd1'] }, 5, -5);
    expect(next.boards[ATLAS]!.drawings.map((drawing) => [drawing.id, 'x' in drawing ? drawing.x : null, 'y' in drawing ? drawing.y : null])).toEqual([
      ['im', 15, 15],
      ['d1', 15, 15],
    ]);
  });

  it('setDrawingsStyle ignores a print (it has no color nor stroke)', () => {
    const start = addDrawing(doc(), ATLAS, print);
    expect(setDrawingsStyle(start, ATLAS, ['im'], { color: 'accent', stroke: 'thick' })).toBe(start);
    const both = addDrawing(start, ATLAS, rect);
    const styled = setDrawingsStyle(both, ATLAS, ['im', 'd1'], { color: 'accent' });
    expect(styled.boards[ATLAS]!.drawings[0]).toBe(both.boards[ATLAS]!.drawings[0]);
    expect(styled.boards[ATLAS]!.drawings[1]).toMatchObject({ id: 'd1', color: 'accent' });
  });

  it('removeItems takes a print away', () => {
    const start = addDrawing(doc(), ATLAS, print);
    expect(removeItems(start, ATLAS, { cards: [], drawings: ['im'] }).boards[ATLAS]!.drawings).toEqual([]);
  });
});
