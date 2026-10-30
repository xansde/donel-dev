import { describe, expect, it } from 'vitest';
import { cardAtPoint, drawingBounds, hitTestDrawings, itemsInsideRect, linkEndpoints, resizeDrawing } from '../src/shared/mindscape/geometry';
import type { MindscapeDrawing } from '../src/shared/mindscape/model';
import { linkEndpoints as roughLinkEndpoints } from '../src/renderer/src/Mindscape/roughShapes';

// Mindscape desenho, fatia 01 — the pure hit-test of the arrow/line ends: which
// post-it is under the pointer, from the last drawn (on top) to the first.

const rects = [
  { id: 'session:s1', x: 0, y: 0, w: 230, h: 96 },
  { id: 'o1', x: 200, y: 50, w: 230, h: 270 },
];

describe('cardAtPoint', () => {
  it('returns the card under the point', () => {
    expect(cardAtPoint({ x: 10, y: 10 }, rects)).toBe('session:s1');
    expect(cardAtPoint({ x: 400, y: 300 }, rects)).toBe('o1');
  });

  it('returns the card on top when two overlap (the last one drawn)', () => {
    expect(cardAtPoint({ x: 215, y: 60 }, rects)).toBe('o1');
  });

  it('counts the border as inside', () => {
    expect(cardAtPoint({ x: 230, y: 0 }, rects)).toBe('session:s1');
  });

  it('returns null on the background', () => {
    expect(cardAtPoint({ x: 600, y: 600 }, rects)).toBeNull();
    expect(cardAtPoint({ x: 10, y: 10 }, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fatia 03 — hit-test of the drawings, lasso, boxes and handles.
// ---------------------------------------------------------------------------

/** Medium stroke (3 units): tolerance = 1.5 + slack. */
const rectA: MindscapeDrawing = { kind: 'rect', id: 'ra', color: 'none', stroke: 'medium', x: 0, y: 0, w: 100, h: 100 };
const rectB: MindscapeDrawing = { kind: 'rect', id: 'rb', color: 'none', stroke: 'medium', x: 50, y: 0, w: 100, h: 100 };
const ellipse: MindscapeDrawing = { kind: 'ellipse', id: 'el', color: 'none', stroke: 'medium', x: 300, y: 0, w: 200, h: 100 };
const line: MindscapeDrawing = { kind: 'line', id: 'li', color: 'none', stroke: 'thin', arrow: true, x1: 0, y1: 300, x2: 100, y2: 400 };
const SLACK = 6;

describe('hitTestDrawings', () => {
  it('hits the contour of a rect and misses its middle (rects have no fill)', () => {
    expect(hitTestDrawings([rectA], { x: 100, y: 50 }, SLACK)).toBe('ra');
    expect(hitTestDrawings([rectA], { x: 104, y: 50 }, SLACK)).toBe('ra');
    expect(hitTestDrawings([rectA], { x: 30, y: 50 }, SLACK)).toBeNull();
    expect(hitTestDrawings([rectA], { x: 110, y: 50 }, SLACK)).toBeNull();
  });

  it('returns the one on top (the last in the array) when two are hit', () => {
    // (50, 0) is a corner of B and on the top edge of A.
    expect(hitTestDrawings([rectA, rectB], { x: 50, y: 0 }, SLACK)).toBe('rb');
    expect(hitTestDrawings([rectB, rectA], { x: 50, y: 0 }, SLACK)).toBe('ra');
  });

  it('hits the contour of an ellipse and misses its center', () => {
    expect(hitTestDrawings([ellipse], { x: 400, y: 1 }, SLACK)).toBe('el');
    expect(hitTestDrawings([ellipse], { x: 500, y: 50 }, SLACK)).toBe('el');
    expect(hitTestDrawings([ellipse], { x: 400, y: 50 }, SLACK)).toBeNull();
  });

  it('hits a line within the tolerance and misses it outside', () => {
    expect(hitTestDrawings([line], { x: 50, y: 350 }, SLACK)).toBe('li');
    expect(hitTestDrawings([line], { x: 55, y: 350 }, SLACK)).toBe('li');
    expect(hitTestDrawings([line], { x: 60, y: 350 }, SLACK)).toBeNull();
    // Past the end of the segment.
    expect(hitTestDrawings([line], { x: 110, y: 410 }, SLACK)).toBeNull();
  });

  it('a thicker stroke widens the tolerance; the slack is passed in board units', () => {
    const thick: MindscapeDrawing = { ...rectA, stroke: 'thick' };
    expect(hitTestDrawings([rectA], { x: 108, y: 50 }, SLACK)).toBeNull();
    expect(hitTestDrawings([thick], { x: 108, y: 50 }, SLACK)).toBe('ra');
    expect(hitTestDrawings([rectA], { x: 108, y: 50 }, 7)).toBe('ra');
  });

  it('returns null with no drawings', () => {
    expect(hitTestDrawings([], { x: 0, y: 0 }, SLACK)).toBeNull();
  });
});

describe('drawingBounds', () => {
  it('is the box of a rect or ellipse, and the min/max box of a line drawn backwards', () => {
    expect(drawingBounds(rectA)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(drawingBounds(ellipse)).toEqual({ x: 300, y: 0, w: 200, h: 100 });
    expect(drawingBounds({ ...line, x1: 100, y1: 400, x2: 0, y2: 300 })).toEqual({ x: 0, y: 300, w: 100, h: 100 });
  });
});

describe('itemsInsideRect', () => {
  const cards = [
    { id: 'o1', x: 10, y: 10, w: 50, h: 50 },
    { id: 'o2', x: 400, y: 400, w: 230, h: 270 },
  ];

  it('picks only what stays whole inside the lasso', () => {
    const inside = itemsInsideRect({ x: -5, y: -5, w: 160, h: 420 }, cards, [rectA, rectB, ellipse, line]);
    expect(inside).toEqual({ cards: ['o1'], drawings: ['ra', 'rb', 'li'] });
    // rectB (50..150) is cut by a lasso that ends at x = 120.
    expect(itemsInsideRect({ x: -5, y: -5, w: 125, h: 110 }, cards, [rectA, rectB]).drawings).toEqual(['ra']);
  });

  it('accepts a lasso drawn backwards (negative w/h)', () => {
    expect(itemsInsideRect({ x: 155, y: 415, w: -160, h: -420 }, cards, [rectA, line])).toEqual({ cards: ['o1'], drawings: ['ra', 'li'] });
  });

  it('returns nothing on an empty spot', () => {
    expect(itemsInsideRect({ x: 2000, y: 2000, w: 10, h: 10 }, cards, [rectA])).toEqual({ cards: [], drawings: [] });
  });
});

describe('resizeDrawing', () => {
  it('drags a corner of a rect or ellipse with the opposite corner fixed', () => {
    expect(resizeDrawing(rectA, 'se', { x: 150, y: 120 })).toEqual({ ...rectA, w: 150, h: 120 });
    expect(resizeDrawing(rectA, 'nw', { x: -20, y: 10 })).toEqual({ ...rectA, x: -20, y: 10, w: 120, h: 90 });
    expect(resizeDrawing(ellipse, 'ne', { x: 520, y: -10 })).toEqual({ ...ellipse, y: -10, w: 220, h: 110 });
    expect(resizeDrawing(ellipse, 'sw', { x: 350, y: 60 })).toEqual({ ...ellipse, x: 350, w: 150, h: 60 });
  });

  it('flips when the corner crosses the fixed one', () => {
    expect(resizeDrawing(rectA, 'se', { x: -50, y: -40 })).toEqual({ ...rectA, x: -50, y: -40, w: 50, h: 40 });
  });

  it('never goes under 4 units', () => {
    expect(resizeDrawing(rectA, 'se', { x: 1, y: 2 })).toEqual({ ...rectA, w: 4, h: 4 });
    expect(resizeDrawing(rectA, 'se', { x: 0, y: 0 })).toEqual({ ...rectA, w: 4, h: 4 });
    expect(resizeDrawing(rectA, 'nw', { x: 99, y: 100 })).toEqual({ ...rectA, x: 96, y: 96, w: 4, h: 4 });
  });

  it('moves one end of a loose line, the other stays', () => {
    expect(resizeDrawing(line, 'end', { x: 200, y: 300 })).toEqual({ ...line, x2: 200, y2: 300 });
    expect(resizeDrawing(line, 'start', { x: 50, y: 50 })).toEqual({ ...line, x1: 50, y1: 50 });
  });

  it('keeps a line at least 4 units long', () => {
    expect(resizeDrawing(line, 'end', { x: 1, y: 300 })).toEqual({ ...line, x2: 4, y2: 300 });
    expect(resizeDrawing(line, 'end', { x: 0, y: 300 })).toMatchObject({ x1: 0, y1: 300 });
    const short = resizeDrawing(line, 'end', { x: 0, y: 300 });
    expect(short.kind === 'line' && Math.hypot(short.x2 - short.x1, short.y2 - short.y1)).toBeCloseTo(4, 5);
  });

  it('a handle that does not belong to the drawing changes nothing', () => {
    expect(resizeDrawing(line, 'se', { x: 500, y: 500 })).toBe(line);
    expect(resizeDrawing(rectA, 'end', { x: 500, y: 500 })).toBe(rectA);
  });
});

describe('linkEndpoints', () => {
  it('lives in geometry.ts and roughShapes re-exports the same function', () => {
    expect(roughLinkEndpoints).toBe(linkEndpoints);
    expect(linkEndpoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 })).toEqual({ x1: 100, y1: 50, x2: 300, y2: 50 });
  });
});
