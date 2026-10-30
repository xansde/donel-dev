import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMindscapeImages, mindscapeImagesDir, nodeMindscapeImagesFs } from '../src/main/mindscape-images';
import { isImageId, MAX_PRINT_BYTES } from '../src/shared/mindscape/images';

// Mindscape desenho, fatia 06 — the main side of the print: `save` checks the
// type, the size and the magic number again and names the file itself; `read`
// only builds a path from an imageId in the pattern; the boot sweep takes away
// only what no board references and is older than 1 hour, and never runs on a
// missing, invalid or newer document. Real temp folder; fs injected.

let root: string;
let dir: string;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]);

function images(overrides: Partial<Parameters<typeof createMindscapeImages>[0]> = {}) {
  return createMindscapeImages({ dir, now: () => NOW, randomHex: () => '0a1b2c3d', ...overrides });
}

function arrayBufferOf(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-mindscape-images-'));
  dir = join(root, 'mindscape-images');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('mindscapeImagesDir', () => {
  it('sits beside mindscape.json (beside DONEL_MINDSCAPE_FILE in the smoke)', () => {
    expect(mindscapeImagesDir(join(root, 'mindscape.json'))).toBe(join(root, 'mindscape-images'));
    expect(mindscapeImagesDir(join(root, 'sub', 'mindscape-06.json'))).toBe(join(root, 'sub', 'mindscape-images'));
  });
});

describe('save', () => {
  it('writes the bytes under a name in the pattern, made by the main', async () => {
    const result = await images().save({ bytes: arrayBufferOf(PNG), mediaType: 'image/png' });
    expect(result).toEqual({ ok: true, imageId: `img-${NOW.toString(36)}-0a1b2c3d.png` });
    if (!result.ok) throw new Error('not saved');
    expect(isImageId(result.imageId)).toBe(true);
    expect(readFileSync(join(dir, result.imageId))).toEqual(PNG);
  });

  it('takes a Uint8Array too, and names JPEG .jpg and WebP .webp', async () => {
    const jpeg = await images({ randomHex: () => '00000001' }).save({ bytes: new Uint8Array(JPEG), mediaType: 'image/jpeg' });
    const webp = await images({ randomHex: () => '00000002' }).save({ bytes: arrayBufferOf(WEBP), mediaType: 'image/webp' });
    expect(jpeg).toMatchObject({ ok: true, imageId: expect.stringMatching(/\.jpg$/) });
    expect(webp).toMatchObject({ ok: true, imageId: expect.stringMatching(/\.webp$/) });
    expect(readdirSync(dir).sort()).toHaveLength(2);
  });

  it('refuses a type out of the list (GIF comes as PNG from the renderer; SVG carries script)', async () => {
    expect(await images().save({ bytes: arrayBufferOf(GIF), mediaType: 'image/gif' })).toEqual({ ok: false, reason: 'type' });
    expect(await images().save({ bytes: arrayBufferOf(PNG), mediaType: 'image/svg+xml' })).toEqual({ ok: false, reason: 'type' });
    expect(await images().save({ bytes: arrayBufferOf(PNG) })).toEqual({ ok: false, reason: 'type' });
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses more than 10 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_PRINT_BYTES - PNG.length + 1)]);
    expect(await images().save({ bytes: arrayBufferOf(big), mediaType: 'image/png' })).toEqual({ ok: false, reason: 'too-big' });
    const limit = Buffer.concat([PNG, Buffer.alloc(MAX_PRINT_BYTES - PNG.length)]);
    expect(await images().save({ bytes: arrayBufferOf(limit), mediaType: 'image/png' })).toMatchObject({ ok: true });
  });

  it('refuses bytes that are not the image they say they are, empty bytes and a payload without bytes', async () => {
    expect(await images().save({ bytes: arrayBufferOf(JPEG), mediaType: 'image/png' })).toEqual({ ok: false, reason: 'not-image' });
    expect(await images().save({ bytes: new ArrayBuffer(0), mediaType: 'image/png' })).toEqual({ ok: false, reason: 'not-image' });
    expect(await images().save({ bytes: 'png', mediaType: 'image/png' })).toEqual({ ok: false, reason: 'not-image' });
    expect(await images().save(null)).toEqual({ ok: false, reason: 'type' });
    expect(existsSync(dir)).toBe(false);
  });

  it('a write that fails → write-failed', async () => {
    const failing = { ...nodeMindscapeImagesFs, writeFile: async () => Promise.reject(new Error('disk full')) };
    expect(await images({ fs: failing }).save({ bytes: arrayBufferOf(PNG), mediaType: 'image/png' })).toEqual({ ok: false, reason: 'write-failed' });
  });
});

describe('read', () => {
  it('gives back the bytes and the media type of a saved print', async () => {
    const saved = await images().save({ bytes: arrayBufferOf(PNG), mediaType: 'image/png' });
    if (!saved.ok) throw new Error('not saved');
    const read = await images().read(saved.imageId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.mediaType).toBe('image/png');
    expect(Buffer.from(read.bytes)).toEqual(PNG);
  });

  it('refuses an imageId out of the pattern without touching the disk', async () => {
    writeFileSync(join(root, 'mindscape.json'), '{}');
    const touched: string[] = [];
    const spy = { ...nodeMindscapeImagesFs, readFile: async (path: string) => (touched.push(path), nodeMindscapeImagesFs.readFile(path)) };
    for (const bad of ['../mindscape.json', '..\\mindscape.json', 'img-a-0a1b2c3d.gif', '', 42, null]) {
      expect(await images({ fs: spy }).read(bad)).toEqual({ ok: false });
    }
    expect(touched).toEqual([]);
  });

  it('a missing file → ok: false', async () => {
    expect(await images().read('img-a-0a1b2c3d.png')).toEqual({ ok: false });
  });
});

describe('sweepOrphans', () => {
  const HOUR = 60 * 60 * 1000;
  const docWith = (...imageIds: string[]) =>
    JSON.stringify({
      schemaVersion: 2,
      boards: {
        'C:/work/atlas': {
          projectPath: 'C:/work/atlas',
          pan: { x: 0, y: 0 },
          zoom: 1,
          cards: {},
          links: [],
          drawings: imageIds.map((imageId, index) => ({ kind: 'image', id: `i${index}`, imageId, x: 0, y: 0, w: 10, h: 10 })),
        },
      },
    });

  function plant(name: string, ageMs: number): void {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, PNG);
    const seconds = (NOW - ageMs) / 1000;
    utimesSync(path, seconds, seconds);
  }

  beforeEach(() => {
    plant('img-a-00000001.png', 2 * HOUR); // referenced, old
    plant('img-a-00000002.png', 2 * HOUR); // orphan, old → goes
    plant('img-a-00000003.jpg', 10 * 60 * 1000); // orphan, recent (another channel may not have saved yet) → stays
    plant('notes.txt', 2 * HOUR); // not a print name → never touched
  });

  it('takes away only the unreferenced print older than 1 hour', async () => {
    const removed = await images().sweepOrphans(docWith('img-a-00000001.png'));
    expect(removed).toEqual(['img-a-00000002.png']);
    expect(readdirSync(dir).sort()).toEqual(['img-a-00000001.png', 'img-a-00000003.jpg', 'notes.txt']);
  });

  it('a v1 document (no prints) sweeps the old orphans', async () => {
    const v1 = JSON.stringify({ schemaVersion: 1, boards: {} });
    expect((await images().sweepOrphans(v1)).sort()).toEqual(['img-a-00000001.png', 'img-a-00000002.png']);
  });

  it('never runs with the document missing, invalid or of a newer version', async () => {
    for (const text of [null, '', '{not json', '[]', '"x"', JSON.stringify({ schemaVersion: 2 }), JSON.stringify({ schemaVersion: 3, boards: {} })]) {
      expect(await images().sweepOrphans(text), String(text)).toEqual([]);
    }
    expect(readdirSync(dir)).toHaveLength(4);
  });

  it('a missing folder is not an error', async () => {
    rmSync(dir, { recursive: true, force: true });
    expect(await images().sweepOrphans(docWith())).toEqual([]);
  });
});
