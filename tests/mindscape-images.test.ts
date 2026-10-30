import { describe, expect, it } from 'vitest';
import {
  fitImage,
  imageBoxAt,
  isImageId,
  isPrintInputType,
  isPrintStoredType,
  MAX_PRINT_BYTES,
  ORPHAN_MIN_AGE_MS,
  PRINT_MAX_WIDTH,
  referencedImageIds,
} from '../src/shared/mindscape/images';

// Mindscape desenho, fatia 06 — the pure side of the print: the imageId
// pattern (the only name the main builds a path from), the size a print is
// born with, the ids the boards still reference (the boot sweep) and the limits.

const ATLAS = 'C:/work/atlas';
const BEACON = 'C:/work/beacon';

describe('isImageId', () => {
  it('accepts img-<base36>-<8 hex>.<png|jpg|webp>', () => {
    expect(isImageId('img-lz3k9a-0a1b2c3d.png')).toBe(true);
    expect(isImageId('img-1-ffffffff.jpg')).toBe(true);
    expect(isImageId('img-abc123-00000000.webp')).toBe(true);
  });

  it('refuses dot-dot, separators, another extension and anything that is not the pattern', () => {
    for (const bad of [
      '../mindscape.json',
      'img-abc-0a1b2c3d.png/..',
      '..\\img-abc-0a1b2c3d.png',
      'sub/img-abc-0a1b2c3d.png',
      'img-abc-0a1b2c3d.gif',
      'img-abc-0a1b2c3d.svg',
      'img-abc-0a1b2c3d.PNG',
      'img-ABC-0a1b2c3d.png',
      'img-abc-0A1B2C3D.png',
      'img-abc-0a1b2c3.png',
      'img--0a1b2c3d.png',
      'img-abc-0a1b2c3d.png ',
      'C:img-abc-0a1b2c3d.png',
      '',
    ]) {
      expect(isImageId(bad), bad).toBe(false);
    }
    expect(isImageId(undefined)).toBe(false);
    expect(isImageId(42)).toBe(false);
  });
});

describe('limits and types', () => {
  it('10 MB, 480 of width, 1 hour of margin for the sweep', () => {
    expect(MAX_PRINT_BYTES).toBe(10 * 1024 * 1024);
    expect(PRINT_MAX_WIDTH).toBe(480);
    expect(ORPHAN_MIN_AGE_MS).toBe(60 * 60 * 1000);
  });

  it('the renderer takes PNG, JPEG, WebP and GIF; the main stores PNG, JPEG and WebP (a GIF becomes PNG first)', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(isPrintInputType(type), type).toBe(true);
    for (const type of ['image/svg+xml', 'image/bmp', 'application/pdf', '']) expect(isPrintInputType(type), type).toBe(false);
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(isPrintStoredType(type), type).toBe(true);
    for (const type of ['image/gif', 'image/svg+xml', '']) expect(isPrintStoredType(type), type).toBe(false);
    expect(isPrintStoredType(undefined)).toBe(false);
  });
});

describe('fitImage', () => {
  it('holds the width at 480, keeping the proportion', () => {
    expect(fitImage(1000, 500)).toEqual({ w: 480, h: 240 });
    expect(fitImage(1920, 1080)).toEqual({ w: 480, h: 270 });
  });

  it('a smaller image keeps its natural size', () => {
    expect(fitImage(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitImage(480, 900)).toEqual({ w: 480, h: 900 });
  });

  it('rounds to a tenth of a unit (what the file keeps)', () => {
    expect(fitImage(1000, 333)).toEqual({ w: 480, h: 159.8 });
  });

  it('a size that is not positive and finite → null', () => {
    expect(fitImage(0, 100)).toBeNull();
    expect(fitImage(100, -1)).toBeNull();
    expect(fitImage(Number.NaN, 100)).toBeNull();
    expect(fitImage(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('imageBoxAt', () => {
  it('centers the box on the point', () => {
    expect(imageBoxAt({ x: 300, y: 200 }, { w: 480, h: 240 })).toEqual({ x: 60, y: 80, w: 480, h: 240 });
  });

  it('rounds the corner to a tenth', () => {
    expect(imageBoxAt({ x: 10.04, y: 0 }, { w: 3, h: 3 })).toEqual({ x: 8.5, y: -1.5, w: 3, h: 3 });
  });
});

describe('referencedImageIds', () => {
  const image = (id: string, imageId: unknown) => ({ kind: 'image', id, imageId, x: 0, y: 0, w: 10, h: 10 });
  const board = (projectPath: string, drawings: unknown[]) => ({ projectPath, pan: { x: 0, y: 0 }, zoom: 1, cards: {}, links: [], drawings });

  it('joins the prints of every board', () => {
    const raw = {
      schemaVersion: 2,
      boards: {
        [ATLAS]: board(ATLAS, [image('i1', 'img-a-00000001.png'), { kind: 'rect', id: 'r1', color: 'none', stroke: 'thin', x: 0, y: 0, w: 5, h: 5 }]),
        [BEACON]: board(BEACON, [image('i2', 'img-b-00000002.jpg'), image('i3', 'img-a-00000001.png')]),
      },
    };
    expect([...referencedImageIds(raw)].sort()).toEqual(['img-a-00000001.png', 'img-b-00000002.jpg']);
  });

  it('ignores an imageId out of the pattern and garbage', () => {
    const raw = { boards: { [ATLAS]: board(ATLAS, [image('i1', '../x.png'), image('i2', 7), null, 'x']), [BEACON]: 'garbage' } };
    expect(referencedImageIds(raw).size).toBe(0);
    expect(referencedImageIds(null).size).toBe(0);
    expect(referencedImageIds({ boards: [] }).size).toBe(0);
  });

  it('keeps an image the parse would drop for another reason (the sweep errs on the side of keeping)', () => {
    const raw = { boards: { [ATLAS]: board(ATLAS, [{ ...image('i1', 'img-a-0000000a.webp'), w: 0 }]) } };
    expect([...referencedImageIds(raw)]).toEqual(['img-a-0000000a.webp']);
  });
});
