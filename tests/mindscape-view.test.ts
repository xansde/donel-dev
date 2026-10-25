import { describe, expect, it } from 'vitest';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen } from '../src/shared/mindscape/view';

// Mindscape desenho, fatia 01 — screen ↔ board: `screen = board × zoom + pan`.
// The gestures convert through it from the start (zoom stays 1 until fatia 05).

describe('screenToWorld / worldToScreen', () => {
  const views = [
    { pan: { x: 0, y: 0 }, zoom: 1 },
    { pan: { x: 120, y: -45 }, zoom: 1 },
    { pan: { x: -300, y: 80 }, zoom: 2.5 },
    { pan: { x: 7, y: 9 }, zoom: 0.25 },
  ];

  it('is the identity at zoom 1 without pan', () => {
    expect(screenToWorld({ x: 30, y: 40 }, views[0]!)).toEqual({ x: 30, y: 40 });
  });

  it('subtracts the pan and divides by the zoom', () => {
    expect(screenToWorld({ x: 120, y: -45 }, views[1]!)).toEqual({ x: 0, y: 0 });
    expect(screenToWorld({ x: -50, y: 105 }, views[2]!)).toEqual({ x: 100, y: 10 });
  });

  it('round-trips: screenToWorld(worldToScreen(p)) gives p back', () => {
    for (const view of views) {
      for (const point of [{ x: 0, y: 0 }, { x: 33.3, y: -12.5 }, { x: 1000, y: 777 }]) {
        const back = screenToWorld(worldToScreen(point, view), view);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });
});

describe('clampZoom', () => {
  it('holds the zoom between 25% and 400%', () => {
    expect(MIN_ZOOM).toBe(0.25);
    expect(MAX_ZOOM).toBe(4);
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('falls back to 100% for a non-finite zoom', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
