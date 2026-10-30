import { describe, expect, it } from 'vitest';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, screenToWorld, stepZoom, wheelPan, wheelZoomFactor, worldToScreen, zoomAt, zoomPercent } from '../src/shared/mindscape/view';

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

// Fatia 05 — zoom from 25% to 400% centered on the mouse, the wheel factor,
// the "− 100% +" steps and the wheel moving the view.

describe('zoomAt', () => {
  it('keeps the board point under the mouse in place', () => {
    const view = { pan: { x: 40, y: -20 }, zoom: 1 };
    const mouse = { x: 300, y: 200 };
    const under = screenToWorld(mouse, view);
    for (const next of [2, 0.5, 3.7, 1.1]) {
      const zoomed = zoomAt(view, mouse, next);
      expect(zoomed.zoom).toBe(next);
      const back = worldToScreen(under, zoomed);
      expect(back.x).toBeCloseTo(mouse.x, 9);
      expect(back.y).toBeCloseTo(mouse.y, 9);
    }
  });

  it('holds the zoom between 0.25 and 4, still keeping the point under the mouse', () => {
    const view = { pan: { x: 0, y: 0 }, zoom: 2 };
    const mouse = { x: 120, y: 80 };
    const under = screenToWorld(mouse, view);
    const up = zoomAt(view, mouse, 9);
    expect(up.zoom).toBe(4);
    expect(worldToScreen(under, up).x).toBeCloseTo(mouse.x, 9);
    const down = zoomAt(view, mouse, 0.01);
    expect(down.zoom).toBe(0.25);
    expect(worldToScreen(under, down).y).toBeCloseTo(mouse.y, 9);
  });

  it('gives the same view back when the zoom does not change (already at the limit)', () => {
    const view = { pan: { x: 5, y: 6 }, zoom: 4 };
    expect(zoomAt(view, { x: 10, y: 10 }, 8)).toBe(view);
    expect(zoomAt(view, { x: 10, y: 10 }, Number.NaN)).toBe(view);
  });
});

describe('wheelZoomFactor', () => {
  it('is 1.1^(−delta/100): above 1 for a negative delta (wheel up), below 1 for a positive one', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.1, 9);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.1, 9);
    expect(wheelZoomFactor(-30)).toBeGreaterThan(1);
    expect(wheelZoomFactor(12)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('is 1 for a delta that is not a finite number', () => {
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
    expect(wheelZoomFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('walks 10 percentage points from the shown percentage', () => {
    expect(stepZoom(1, -10)).toBe(0.9);
    expect(stepZoom(1, 10)).toBe(1.1);
    expect(stepZoom(0.8, -10)).toBe(0.7);
    expect(stepZoom(1.21, -10)).toBe(1.11);
    expect(stepZoom(1.2149, 10)).toBe(1.31);
  });

  it('stops at 25% and 400%', () => {
    expect(stepZoom(0.3, -10)).toBe(0.25);
    expect(stepZoom(0.25, -10)).toBe(0.25);
    expect(stepZoom(3.95, 10)).toBe(4);
  });

  it('shows the zoom as a whole percentage', () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(1.2149)).toBe(121);
    expect(zoomPercent(0.25)).toBe(25);
  });
});

describe('wheelPan', () => {
  const pan = { x: 10, y: 20 };

  it('moves the view vertically with the wheel and horizontally with deltaX (touchpad)', () => {
    expect(wheelPan(pan, 0, 100, false)).toEqual({ x: 10, y: -80 });
    expect(wheelPan(pan, 30, -40, false)).toEqual({ x: -20, y: 60 });
  });

  it('with Shift, the wheel moves the view horizontally (whether Chromium already swapped the axes or not)', () => {
    expect(wheelPan(pan, 0, 100, true)).toEqual({ x: -90, y: 20 });
    expect(wheelPan(pan, 100, 0, true)).toEqual({ x: -90, y: 20 });
  });

  it('gives the same pan back for no movement or a non-finite delta', () => {
    expect(wheelPan(pan, 0, 0, false)).toBe(pan);
    expect(wheelPan(pan, Number.NaN, 10, false)).toBe(pan);
  });
});
