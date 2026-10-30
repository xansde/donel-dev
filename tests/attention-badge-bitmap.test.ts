// notificacoes-completas — the taskbar badge is drawn at runtime (no binary asset): a red disc with the count in white,
// as raw BGRA premultiplied pixels for `nativeImage.createFromBitmap`.
import { describe, expect, it } from 'vitest';
import { renderBadgeBitmap } from '../src/shared/attention/badgeBitmap';

function pixel(bitmap: Uint8Array, size: number, x: number, y: number): { b: number; g: number; r: number; a: number } {
  const at = (y * size + x) * 4;
  return { b: bitmap[at], g: bitmap[at + 1], r: bitmap[at + 2], a: bitmap[at + 3] };
}

function inkCount(bitmap: Uint8Array): number {
  let count = 0;
  for (let at = 0; at < bitmap.length; at += 4) if (bitmap[at] === 255 && bitmap[at + 1] === 255 && bitmap[at + 2] === 255) count += 1;
  return count;
}

describe('renderBadgeBitmap', () => {
  it('has size x size pixels of 4 bytes', () => {
    expect(renderBadgeBitmap('1', 16)).toHaveLength(16 * 16 * 4);
    expect(renderBadgeBitmap('9+', 32)).toHaveLength(32 * 32 * 4);
  });

  it('the corners are transparent and the edge of the disc is opaque red (BGRA order)', () => {
    const size = 32;
    const bitmap = renderBadgeBitmap('1', size);
    expect(pixel(bitmap, size, 0, 0).a).toBe(0);
    expect(pixel(bitmap, size, size - 1, size - 1).a).toBe(0);
    // inside the disc, left of the glyph
    expect(pixel(bitmap, size, 4, 16)).toEqual({ b: 0x4d, g: 0x48, r: 0xe5, a: 255 });
  });

  it('the edge is smoothed (partial alpha), and premultiplied: no colour channel is above alpha', () => {
    const size = 32;
    const bitmap = renderBadgeBitmap('3', size);
    let partial = 0;
    for (let at = 0; at < bitmap.length; at += 4) {
      const a = bitmap[at + 3];
      if (a > 0 && a < 255) partial += 1;
      expect(Math.max(bitmap[at], bitmap[at + 1], bitmap[at + 2])).toBeLessThanOrEqual(a);
    }
    expect(partial).toBeGreaterThan(0);
  });

  it('the label is inked in white, centred, and fits inside the disc at 16 px too', () => {
    for (const size of [16, 20, 24, 32]) {
      for (const label of ['1', '8', '9+']) {
        const bitmap = renderBadgeBitmap(label, size);
        expect(inkCount(bitmap)).toBeGreaterThan(0);
        // every white pixel is fully covered by the disc
        for (let at = 0; at < bitmap.length; at += 4) {
          if (bitmap[at] === 255 && bitmap[at + 1] === 255 && bitmap[at + 2] === 255) expect(bitmap[at + 3]).toBe(255);
        }
      }
    }
  });

  it('different counts draw different pictures', () => {
    expect(renderBadgeBitmap('1', 32)).not.toEqual(renderBadgeBitmap('2', 32));
    expect(renderBadgeBitmap('9', 32)).not.toEqual(renderBadgeBitmap('9+', 32));
  });
});
