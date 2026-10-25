import { describe, expect, it } from 'vitest';
import { addDrawing, STROKE_WIDTH } from '../src/shared/mindscape/drawings';
import { emptyMindscapeDoc, ensureBoard, type MindscapeDoc, type MindscapeDrawing } from '../src/shared/mindscape/model';

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
