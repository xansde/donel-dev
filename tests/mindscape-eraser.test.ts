import { describe, expect, it } from 'vitest';
import { eraseBoard, eraseDoc, erasePolyline } from '../src/shared/mindscape/eraser';
import {
  addLink,
  addOwnerCard,
  emptyMindscapeDoc,
  ensureBoard,
  writeSessionNote,
  type MindscapeBoard,
  type MindscapeDoc,
  type MindscapeDrawing,
} from '../src/shared/mindscape/model';

// Mindscape desenho, fatia 04 — the eraser takes away only the touched piece
// of a pencil stroke or a loose line; a rect, an ellipse and a link go whole
// when their stroke is touched; a post-it never goes.

const ATLAS = 'C:/work/atlas';

/** A straight horizontal stroke from (0, 0) to (100, 0), one point every 10 units. */
const STRAIGHT = Array.from({ length: 11 }, (_, index) => [index * 10, 0]).flat();

function length(run: number[]): number {
  let total = 0;
  for (let index = 2; index < run.length; index += 2) total += Math.hypot(run[index]! - run[index - 2]!, run[index + 1]! - run[index - 1]!);
  return total;
}

describe('erasePolyline', () => {
  it('the eraser in the middle of a straight stroke leaves two runs', () => {
    const runs = erasePolyline(STRAIGHT, [50, -20, 50, 20], 5);
    expect(runs).toHaveLength(2);
    const [left, right] = runs as [number[], number[]];
    expect(left.slice(0, 2)).toEqual([0, 0]);
    expect(left.slice(-2)).toEqual([45, 0]);
    expect(right.slice(0, 2)).toEqual([55, 0]);
    expect(right.slice(-2)).toEqual([100, 0]);
  });

  it('a single press (one point) also cuts', () => {
    expect(erasePolyline(STRAIGHT, [50, 0], 5)).toHaveLength(2);
  });

  it('the eraser at one end leaves a single, shorter run', () => {
    const runs = erasePolyline(STRAIGHT, [0, -20, 0, 20], 5);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.slice(0, 2)).toEqual([5, 0]);
    expect(runs[0]!.slice(-2)).toEqual([100, 0]);
    const end = erasePolyline(STRAIGHT, [100, -20, 100, 20], 5);
    expect(end).toHaveLength(1);
    expect(end[0]!.slice(-2)).toEqual([95, 0]);
  });

  it('far from the stroke, the whole stroke comes back (the same array)', () => {
    const runs = erasePolyline(STRAIGHT, [50, 80, 60, 80], 5);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBe(STRAIGHT);
  });

  it('cuts a stroke where it crosses the eraser path between samples', () => {
    // A long eraser stroke crossing the line diagonally: it is densified, no gap.
    const runs = erasePolyline(STRAIGHT, [20, -100, 80, 100], 3);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.slice(-2)[0]).toBeLessThan(50);
    expect(runs[1]![0]).toBeGreaterThan(50);
  });

  it('a run shorter than 1 unit goes away', () => {
    // Erases from 0.5 to 99.6: what is left at each end is under 1 unit.
    const runs = erasePolyline([0, 0, 100, 0], [0.5 + 5, 0, 94.6, 0], 5);
    expect(runs).toEqual([]);
    for (const run of erasePolyline(STRAIGHT, [30, 0, 70, 0], 5)) expect(length(run)).toBeGreaterThanOrEqual(1);
  });

  it('the whole stroke under the eraser goes away', () => {
    expect(erasePolyline([0, 0, 4, 0], [2, 0], 5)).toEqual([]);
  });

  it('runs on a polyline with turns keep the vertices that survive, cut points rounded to 0.1', () => {
    // An L: (0,0) → (100,0) → (100,100). The eraser at the corner.
    const runs = erasePolyline([0, 0, 100, 0, 100, 100], [100, 0], 10);
    expect(runs).toEqual([
      [0, 0, 90, 0],
      [100, 10, 100, 100],
    ]);
    const odd = erasePolyline([0, 0, 30, 0], [10, 3], 4);
    for (const run of odd) for (const value of run) expect(Math.round(value * 10) / 10).toBe(value);
  });
});

function board(drawings: MindscapeDrawing[]): MindscapeBoard {
  return { ...ensureBoard(emptyMindscapeDoc(), ATLAS).boards[ATLAS]!, drawings };
}

function ids(prefix = 'n'): () => string {
  let count = 0;
  return () => `${prefix}${++count}`;
}

const pencil: MindscapeDrawing = { kind: 'pencil', id: 'p1', color: 'accent', stroke: 'thin', points: STRAIGHT };
const rect: MindscapeDrawing = { kind: 'rect', id: 'r1', color: 'none', stroke: 'medium', x: 200, y: 0, w: 100, h: 100 };
const ellipse: MindscapeDrawing = { kind: 'ellipse', id: 'e1', color: 'none', stroke: 'medium', x: 400, y: 0, w: 100, h: 100 };
const arrow: MindscapeDrawing = { kind: 'line', id: 'a1', color: 'donel-accent', stroke: 'thick', arrow: true, x1: 0, y1: 300, x2: 100, y2: 300 };

describe('eraseBoard', () => {
  it('splits a pencil stroke: the first piece keeps the id, the others get newId', () => {
    const next = eraseBoard(board([pencil]), [50, -20, 50, 20], 4, ids());
    expect(next.drawings.map((drawing) => drawing.id)).toEqual(['p1', 'n1']);
    expect(next.drawings.every((drawing) => drawing.kind === 'pencil' && drawing.color === 'accent' && drawing.stroke === 'thin')).toBe(true);
  });

  it('keeps the layer: the pieces take the place of the stroke in the array', () => {
    const next = eraseBoard(board([rect, pencil, ellipse]), [50, -20, 50, 20], 4, ids());
    expect(next.drawings.map((drawing) => drawing.id)).toEqual(['r1', 'p1', 'n1', 'e1']);
  });

  it('the eraser radius grows by half the stroke (it erases the ink it touches)', () => {
    // Thick stroke (5): radius 4 + 2.5 reaches a stroke 6 units away.
    const thick: MindscapeDrawing = { ...pencil, stroke: 'thick' };
    expect(eraseBoard(board([thick]), [50, 6], 4, ids()).drawings).toHaveLength(2);
    expect(eraseBoard(board([pencil]), [50, 6], 4, ids()).drawings).toHaveLength(1);
  });

  it('a split arrow keeps the head only on the piece with the original end', () => {
    const next = eraseBoard(board([arrow]), [50, 300], 4, ids());
    expect(next.drawings).toHaveLength(2);
    const [first, last] = next.drawings as [MindscapeDrawing, MindscapeDrawing];
    expect(first).toMatchObject({ kind: 'line', id: 'a1', arrow: false, x1: 0, y1: 300 });
    expect(last).toMatchObject({ kind: 'line', id: 'n1', arrow: true, x2: 100, y2: 300 });
    // Erasing the end with the head: what is left has no head.
    const headless = eraseBoard(board([arrow]), [100, 300], 4, ids());
    expect(headless.drawings).toEqual([expect.objectContaining({ id: 'a1', arrow: false, x1: 0 })]);
  });

  it('takes a rect or an ellipse away whole when the eraser touches the contour, not in the middle', () => {
    expect(eraseBoard(board([rect, ellipse]), [200, 50], 4, ids()).drawings.map((drawing) => drawing.id)).toEqual(['e1']);
    expect(eraseBoard(board([rect, ellipse]), [500, 50], 4, ids()).drawings.map((drawing) => drawing.id)).toEqual(['r1']);
    const middle = board([rect, ellipse]);
    expect(eraseBoard(middle, [250, 50, 260, 60], 4, ids())).toBe(middle);
    expect(eraseBoard(middle, [450, 50], 4, ids())).toBe(middle);
  });

  it('takes away the link it touches and never a post-it', () => {
    let doc: MindscapeDoc = addOwnerCard(emptyMindscapeDoc(), ATLAS, { id: 'o1', createdAt: 1, origin: { x: 0, y: 0 } });
    doc = addOwnerCard(doc, ATLAS, { id: 'o2', createdAt: 2, origin: { x: 600, y: 0 } });
    doc = addLink(doc, ATLAS, { id: 'l1', from: 'o1', to: 'o2' });
    const start = doc.boards[ATLAS]!;
    const o1 = start.cards.o1!;
    const o2 = start.cards.o2!;
    const sizes = { o1: { w: 100, h: 100 }, o2: { w: 100, h: 100 } };
    // The link runs at the middle height of the cards, between their facing edges.
    const midY = o1.y + 50;
    const midX = (o1.x + 100 + o2.x) / 2;
    const cut = eraseBoard(start, [midX, midY], 4, ids(), sizes);
    expect(cut.links).toEqual([]);
    expect(Object.keys(cut.cards).sort()).toEqual(['o1', 'o2']);
    // Over the post-it itself: nothing goes.
    expect(eraseBoard(start, [o1.x + 50, o1.y + 50, o1.x + 60, o1.y + 80], 4, ids(), sizes)).toBe(start);
    // Away from the segment: the link stays.
    expect(eraseBoard(start, [midX, midY + 40], 4, ids(), sizes)).toBe(start);
    // Without the size of an end (not on screen) the link is not drawn, so it is not erased.
    expect(eraseBoard(start, [midX, midY], 4, ids(), { o1: sizes.o1 })).toBe(start);
  });

  it('nothing touched → the same board', () => {
    const untouched = board([pencil, rect, arrow]);
    expect(eraseBoard(untouched, [900, 900, 950, 950], 4, ids())).toBe(untouched);
  });
});

describe('eraseDoc', () => {
  it('erases on the board of the project and keeps the post-it written by the session', () => {
    let doc: MindscapeDoc = { ...emptyMindscapeDoc(), boards: { [ATLAS]: board([pencil]) } };
    doc = writeSessionNote(doc, ATLAS, { sessionId: 's1', sessionName: 'atlas', text: 'oi', writtenAt: 1 });
    const next = eraseDoc(doc, ATLAS, [50, 0], 4, ids());
    expect(next.boards[ATLAS]!.drawings).toHaveLength(2);
    expect(next.boards[ATLAS]!.cards['note:s1']).toBe(doc.boards[ATLAS]!.cards['note:s1']);
  });

  it('nothing touched or a missing board → the same document', () => {
    const doc: MindscapeDoc = { ...emptyMindscapeDoc(), boards: { [ATLAS]: board([pencil]) } };
    expect(eraseDoc(doc, ATLAS, [500, 500], 4, ids())).toBe(doc);
    expect(eraseDoc(doc, 'C:/work/vega', [50, 0], 4, ids())).toBe(doc);
  });
});

describe('the print under the eraser (desenho, fatia 06)', () => {
  const print: MindscapeDrawing = { kind: 'image', id: 'im', imageId: 'img-a-0a1b2c3d.png', x: 400, y: 400, w: 200, h: 100 };

  it('goes whole when the eraser touches its area, even in the middle', () => {
    const start = board([pencil, print]);
    const next = eraseBoard(start, [500, 450], 4, ids());
    expect(next.drawings.map((drawing) => drawing.id)).toEqual(['p1']);
    // Just outside the edge, within the radius: it goes too.
    expect(eraseBoard(start, [398, 450], 4, ids()).drawings.map((drawing) => drawing.id)).toEqual(['p1']);
  });

  it('away from it, it stays', () => {
    const start = board([print]);
    expect(eraseBoard(start, [380, 450, 390, 300], 4, ids())).toBe(start);
  });
});
