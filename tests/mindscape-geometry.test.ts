import { describe, expect, it } from 'vitest';
import { cardAtPoint } from '../src/shared/mindscape/geometry';

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
