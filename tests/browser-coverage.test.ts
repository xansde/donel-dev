// Navegador interno — the panel hides its native view while something of the app covers the viewport.
import { describe, expect, it } from 'vitest';
import { coverSamplePoints, isViewportCovered } from '../src/renderer/src/browser/coverage';

function fakeElement(children: object[] = []): Element {
  return { contains: (other: unknown) => children.includes(other as object) } as unknown as Element;
}

describe('coverSamplePoints', () => {
  it('samples the center and the four corners, inset from the edges', () => {
    expect(coverSamplePoints({ x: 100, y: 50, width: 400, height: 300 })).toEqual([
      { x: 300, y: 200 },
      { x: 108, y: 58 },
      { x: 492, y: 58 },
      { x: 108, y: 342 },
      { x: 492, y: 342 },
    ]);
  });
});

describe('isViewportCovered', () => {
  const rect = { x: 0, y: 0, width: 400, height: 300 };

  it('is not covered when every point hits the viewport or something inside it', () => {
    const snapshot = {};
    const viewport = fakeElement([snapshot]);
    expect(isViewportCovered(viewport, rect, (x) => (x > 200 ? snapshot : viewport) as Element)).toBe(false);
  });

  it('is covered when a menu or modal is on top of any sampled point', () => {
    const viewport = fakeElement();
    const menu = fakeElement();
    expect(isViewportCovered(viewport, rect, (x, y) => (x > 300 && y < 100 ? menu : viewport))).toBe(true);
  });

  it('ignores points outside the window', () => {
    const viewport = fakeElement();
    expect(isViewportCovered(viewport, rect, () => null)).toBe(false);
  });
});
