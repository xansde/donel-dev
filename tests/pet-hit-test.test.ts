// T028 (015-jobu-pet, US1) - the click test by alpha (R9, FR-006). The pet window ignores the mouse
// (`setIgnoreMouseEvents(true, { forward: true })`) and receives only the forwarded `mousemove`; the
// screen decides from the pixel under the pointer whether the Jobu is there. These are the pure parts
// of that decision: the alpha of an image, the pointer to pixel mapping through whatever rectangle the
// drawing occupies, and the threshold. The canvas that reads the real PNG is the only DOM part and is
// covered by the `@pet` smoke.
import { describe, expect, it } from 'vitest';
import { drawingMetrics } from '../src/shared/pet/art';
import { PET_HIT_ALPHA, alphaAt, alphaOfRgba, isOpaqueAt, maskCellAt, maskSizeFor, type AlphaMask, type PixelRect } from '../src/renderer/src/pet/hitTest';

/** A mask made of rows of alpha values, e.g. `maskOf(['00FF', '00FF'])` is 4x2 with the right half opaque. */
function maskOf(rows: readonly string[], levels: Readonly<Record<string, number>> = { '0': 0, F: 255 }): AlphaMask {
  const width = rows[0]?.length ?? 0;
  const alpha = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width);
    [...row].forEach((cell, x) => {
      const level = levels[cell];
      if (level === undefined) throw new Error(`no alpha level for "${cell}"`);
      alpha[y * width + x] = level;
    });
  });
  return { width, height: rows.length, alpha };
}

const rect = (left: number, top: number, width: number, height: number): PixelRect => ({ left, top, width, height });

describe('alphaOfRgba: only the fourth byte of each pixel', () => {
  it('takes the alpha of every pixel, in order', () => {
    // two pixels: (10,20,30,40) and (50,60,70,80), then one more row of two: 255 and 0
    const rgba = [10, 20, 30, 40, 50, 60, 70, 80, 1, 2, 3, 255, 4, 5, 6, 0];
    expect([...alphaOfRgba(rgba, 2, 2)]).toEqual([40, 80, 255, 0]);
  });

  it('accepts what getImageData returns (a Uint8ClampedArray)', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 7, 0, 0, 0, 9]);
    expect([...alphaOfRgba(data, 2, 1)]).toEqual([7, 9]);
  });

  it('gives exactly width x height values, ignoring any extra bytes', () => {
    expect(alphaOfRgba(new Array(40).fill(255), 3, 2)).toHaveLength(6);
  });

  it('refuses data shorter than the image says, instead of reading garbage', () => {
    expect(() => alphaOfRgba([0, 0, 0, 255], 2, 1)).toThrow(RangeError);
  });
});

describe('maskSizeFor: the canvas the alpha is read from', () => {
  it('is the drawing at that size, in whole pixels', () => {
    expect(maskSizeFor(140)).toEqual({ width: 116, height: 140 });
    expect(maskSizeFor(80)).toEqual({ width: 66, height: 80 });
    expect(maskSizeFor(320)).toEqual({ width: 264, height: 320 });
    expect(maskSizeFor(260)).toEqual({ width: 215, height: 260 });
    // rounded to the nearest pixel, not up: 107.25 and 74.25 stay at 107 and 74
    expect(maskSizeFor(130)).toEqual({ width: 107, height: 130 });
    expect(maskSizeFor(90)).toEqual({ width: 74, height: 90 });
  });

  it('is never smaller than one pixel', () => {
    expect(maskSizeFor(0)).toEqual({ width: 1, height: 1 });
    expect(maskSizeFor(-5)).toEqual({ width: 1, height: 1 });
  });

  it('follows the drawing: its width is the width of the drawing at that size, within half a pixel', () => {
    for (const size of [80, 100, 140, 200, 260, 320]) {
      expect(Math.abs(maskSizeFor(size).width - drawingMetrics(size).width)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('maskCellAt: from the pointer to a cell of the mask', () => {
  const mask = maskOf(['0000', '0000', '0000']); // 4 x 3

  it('maps the pointer through the rectangle the drawing occupies, whatever its position', () => {
    // the drawing is drawn at (100, 50), 40 x 30: a cell is 10 x 10
    const where = rect(100, 50, 40, 30);
    expect(maskCellAt(mask, where, 100, 50)).toEqual({ column: 0, row: 0 });
    expect(maskCellAt(mask, where, 109.9, 59.9)).toEqual({ column: 0, row: 0 });
    expect(maskCellAt(mask, where, 110, 60)).toEqual({ column: 1, row: 1 });
    expect(maskCellAt(mask, where, 139.9, 79.9)).toEqual({ column: 3, row: 2 });
  });

  it('scales when the rectangle is not the size of the mask (the drawing is fractional, the mask is whole)', () => {
    // 115.5 wide, mask 116 wide: the cell is a hair narrower than a pixel
    const wide = maskOf(['0'.repeat(116)]);
    const where = rect(0, 0, 115.5, 1);
    expect(maskCellAt(wide, where, 0, 0.5)?.column).toBe(0);
    expect(maskCellAt(wide, where, 57.75, 0.5)?.column).toBe(58);
    expect(maskCellAt(wide, where, 115.49, 0.5)?.column).toBe(115);
  });

  it('is outside on every edge that is not part of the drawing: the left and top edges are in, the right and bottom are out', () => {
    const where = rect(100, 50, 40, 30);
    expect(maskCellAt(mask, where, 99.99, 60)).toBeNull();
    expect(maskCellAt(mask, where, 120, 49.99)).toBeNull();
    expect(maskCellAt(mask, where, 140, 60)).toBeNull();
    expect(maskCellAt(mask, where, 120, 80)).toBeNull();
    expect(maskCellAt(mask, where, 100, 50)).not.toBeNull();
  });

  it('never answers a cell outside the mask, even with rounding noise at the far edge', () => {
    const where = rect(0, 0, 40, 30);
    const cell = maskCellAt(mask, where, 39.9999999999, 29.9999999999);
    expect(cell).toEqual({ column: 3, row: 2 });
  });

  it('is null for a rectangle with no area (the image is not laid out yet) and for a pointer that is not a number', () => {
    expect(maskCellAt(mask, rect(0, 0, 0, 30), 0, 0)).toBeNull();
    expect(maskCellAt(mask, rect(0, 0, 40, 0), 0, 0)).toBeNull();
    expect(maskCellAt(mask, rect(0, 0, 40, 30), Number.NaN, 5)).toBeNull();
    expect(maskCellAt(mask, rect(0, 0, 40, 30), 5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('is null for an empty mask', () => {
    expect(maskCellAt({ width: 0, height: 0, alpha: new Uint8Array(0) }, rect(0, 0, 10, 10), 5, 5)).toBeNull();
  });
});

describe('alphaAt and isOpaqueAt: is the Jobu under the pointer?', () => {
  // the left half of the drawing is the Jobu, the right half is the transparent void
  const mask = maskOf(['FF00', 'FF00', 'FF00']);
  const where = rect(100, 50, 40, 30);

  it('reads the alpha of the cell under the pointer', () => {
    expect(alphaAt(mask, where, 105, 55)).toBe(255);
    expect(alphaAt(mask, where, 135, 55)).toBe(0);
  });

  it('is 0 outside the drawing', () => {
    expect(alphaAt(mask, where, 10, 10)).toBe(0);
    expect(alphaAt(mask, where, 140, 60)).toBe(0);
  });

  it('is a hit over the opaque part and a miss over the transparent void', () => {
    expect(isOpaqueAt(mask, where, 105, 55)).toBe(true);
    expect(isOpaqueAt(mask, where, 115, 70)).toBe(true);
    expect(isOpaqueAt(mask, where, 125, 70)).toBe(false);
    expect(isOpaqueAt(mask, where, 130, 55)).toBe(false);
    expect(isOpaqueAt(mask, where, 139, 79)).toBe(false);
  });

  it('is a miss anywhere outside the rectangle, even next to opaque pixels', () => {
    expect(isOpaqueAt(mask, where, 99, 55)).toBe(false);
    expect(isOpaqueAt(mask, where, 105, 49)).toBe(false);
    expect(isOpaqueAt(mask, where, 105, 80)).toBe(false);
  });

  it('is a miss with no mask yet: the click goes through rather than being swallowed', () => {
    expect(isOpaqueAt(null, where, 105, 55)).toBe(false);
  });

  it('counts a pixel only ABOVE the threshold: 40 is the void, 41 is the Jobu', () => {
    expect(PET_HIT_ALPHA).toBe(40);
    const edge = maskOf(['abc'], { a: 0, b: 40, c: 41 });
    const strip = rect(0, 0, 3, 1);
    expect(isOpaqueAt(edge, strip, 0.5, 0.5)).toBe(false);
    expect(isOpaqueAt(edge, strip, 1.5, 0.5)).toBe(false);
    expect(isOpaqueAt(edge, strip, 2.5, 0.5)).toBe(true);
  });

  it('takes the threshold as a parameter', () => {
    const faint = maskOf(['a'], { a: 30 });
    const one = rect(0, 0, 1, 1);
    expect(isOpaqueAt(faint, one, 0.5, 0.5)).toBe(false);
    expect(isOpaqueAt(faint, one, 0.5, 0.5, 10)).toBe(true);
  });

  it('follows the drawing when it grows: the same pointer hits at 140 and misses at 80, where the rectangle is smaller', () => {
    // the Jobu fills the left half; the rectangle is anchored at its bottom center, so it shrinks around that point
    const left = maskOf(['F0', 'F0']);
    const anchor = { x: 240, y: 340 };
    const at = (size: number): PixelRect => {
      const m = drawingMetrics(size);
      return rect(anchor.x - m.anchorX, anchor.y - m.anchorY, m.width, m.height);
    };
    // 40 px left of the anchor and 100 px above it: inside the left half of the big drawing, outside the small one
    expect(isOpaqueAt(left, at(260), anchor.x - 40, anchor.y - 100)).toBe(true);
    expect(isOpaqueAt(left, at(80), anchor.x - 40, anchor.y - 100)).toBe(false);
  });
});

describe('the base point: the pointer near the bottom edge of the window, at the anchor column', () => {
  it('lands in the middle column of the mask and a few rows above the base of the bust', () => {
    const size = 140;
    const m = drawingMetrics(size);
    const { width, height } = maskSizeFor(size);
    const mask: AlphaMask = { width, height, alpha: new Uint8Array(width * height) };
    // The drawing's rectangle in a 480 x 340 window: the anchor (the base point) is the bottom center
    // of the window, and the PNG's own bottom edge is 3.5 px below the window.
    const where = rect(240 - m.anchorX, 340 - m.anchorY, m.width, m.height);
    expect(where.top + where.height).toBeCloseTo(340 + m.inset, 9);
    // 2 px above the window edge, in the anchor column: column 58 of 116, row 134 of 140. The base of
    // the bust is at row 136.5 of the mask (312 of 320 PNG rows), so this is still the bust.
    expect(maskCellAt(mask, where, 240, 338)).toEqual({ column: Math.floor(width / 2), row: 134 });
    expect(Math.floor((height * 312) / 320)).toBe(136);
  });
});
