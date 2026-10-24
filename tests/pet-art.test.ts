// T028 (015-jobu-pet, US1) - the geometry of the art against the art itself. The renderer draws the
// PNG with its anchor on the bottom edge of the window; if a re-cut of the sheet moved the anchor or
// changed the canvas, the Jobu would float or be cropped without any other test noticing. So the
// constants are checked against the manifest and the PNG headers on disk.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PET_ART, PET_FADE_RATIO, drawingMetrics } from '../src/shared/pet/art';
import { PET_DRAWING_ASPECT } from '../src/shared/pet/placement';
import { BLINK_POSE_NAMES, POSE_NAMES } from '../src/shared/pet/types';

const POSES_DIR = join(__dirname, '..', 'src', 'renderer', 'src', 'pet', 'assets', 'poses');

interface Manifest {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly anchor: { readonly x: number; readonly y: number };
  readonly poses: Readonly<Record<string, { readonly file: string }>>;
}

const manifest = JSON.parse(readFileSync(join(POSES_DIR, 'manifest.json'), 'utf8')) as Manifest;

/** Width and height of a PNG, from its IHDR chunk (bytes 16-23, big endian). */
function pngSize(file: string): { readonly width: number; readonly height: number } {
  const bytes = readFileSync(join(POSES_DIR, file));
  expect(bytes.subarray(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('PET_ART against the manifest the art was cut with', () => {
  it('has the canvas of the manifest', () => {
    expect(PET_ART.width).toBe(manifest.canvas.width);
    expect(PET_ART.height).toBe(manifest.canvas.height);
  });

  it('has the anchor of the manifest', () => {
    expect(PET_ART.anchorX).toBe(manifest.anchor.x);
    expect(PET_ART.anchorY).toBe(manifest.anchor.y);
  });

  it('agrees with the aspect the window geometry uses to size the drawing', () => {
    expect(PET_ART.width / PET_ART.height).toBeCloseTo(PET_DRAWING_ASPECT, 12);
  });

  it('puts the anchor in the middle of the canvas, so centering the drawing centers the anchor', () => {
    expect(PET_ART.anchorX * 2).toBe(PET_ART.width);
  });

  it('keeps some transparent padding under the anchor, never a negative one', () => {
    expect(PET_ART.anchorY).toBeLessThan(PET_ART.height);
  });
});

describe('the PNGs on disk', () => {
  const files = Object.entries(manifest.poses).map(([name, entry]) => ({ name, file: entry.file }));

  it('are the poses of the manifest, and the manifest lists no pose that is not drawn', () => {
    const onDisk = readdirSync(POSES_DIR).filter((name) => name.endsWith('.png')).sort();
    expect(files.map((entry) => entry.file).sort()).toEqual(onDisk);
  });

  it('only the poses the core knows have art (no stray name that no state can ever ask for)', () => {
    const known = new Set<string>([...POSE_NAMES, ...BLINK_POSE_NAMES]);
    for (const { name } of files) expect(known.has(name), `${name} is not a pose of the core`).toBe(true);
  });

  it.each(files)('$name ($file) has the canvas of the manifest, like every other pose', ({ file }) => {
    expect(pngSize(file)).toEqual({ width: manifest.canvas.width, height: manifest.canvas.height });
  });
});

describe('drawingMetrics: the drawing at a size', () => {
  it('at Médio (140): 115.5 x 140, the base 3.5 above the bottom of the PNG', () => {
    const m = drawingMetrics(140);
    expect(m.height).toBe(140);
    expect(m.width).toBeCloseTo(115.5, 9);
    expect(m.anchorX).toBeCloseTo(57.75, 9);
    expect(m.anchorY).toBeCloseTo(136.5, 9);
    expect(m.inset).toBeCloseTo(3.5, 9);
  });

  it('at the biggest size (320) the drawing is the PNG as it is: 8 px of padding under the anchor', () => {
    const m = drawingMetrics(320);
    expect(m).toMatchObject({ width: 264, height: 320, anchorX: 132, anchorY: 312, inset: 8 });
  });

  it('at the smallest size (80) everything scales with it', () => {
    const m = drawingMetrics(80);
    expect(m.width).toBeCloseTo(66, 9);
    expect(m.anchorY).toBeCloseTo(78, 9);
    expect(m.inset).toBeCloseTo(2, 9);
  });

  it('the anchor and the padding always add up to the height of the drawing', () => {
    for (const size of [80, 100, 140, 200, 260, 320]) {
      const m = drawingMetrics(size);
      expect(m.anchorY + m.inset).toBeCloseTo(m.height, 9);
    }
  });

  it('the anchor is always the middle of the drawing: the base point is where the Jobu is centered', () => {
    for (const size of [80, 140, 260, 320]) {
      const m = drawingMetrics(size);
      expect(m.anchorX * 2).toBeCloseTo(m.width, 9);
    }
  });

  it('the fade is the bottom 18% of the part above the anchor', () => {
    expect(PET_FADE_RATIO).toBe(0.18);
    const m = drawingMetrics(200);
    expect(m.fade).toBeCloseTo(m.anchorY * 0.18, 9);
  });
});
