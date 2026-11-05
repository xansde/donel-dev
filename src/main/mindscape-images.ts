// Mindscape desenho, fatia 06 — the files of the prints, in
// `<userData>/mindscape-images/<imageId>` (beside `mindscape.json`; in the
// smoke, beside DONEL_MINDSCAPE_FILE). Only the main writes and names them:
// the renderer sends bytes and a media type, and gets back an imageId. Every
// check is made again here (type, size, magic number, imageId pattern before
// any path). The boot sweep is the only cleanup: never during a run, so a
// Ctrl+Z can bring a print back. Design: docs/design/mindscape-desenho.md, "Print".
//
// Reuses the magic-number check and the extensions of the chat attachments
// (`src/main/chat/attachments.ts`) without touching that file.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { extensionFor, looksLikeImage } from './chat/attachments';
import type { MindscapeReadImageResult, MindscapeSaveImageResult } from '../shared/mindscape/channels';
import { isImageId, isPrintStoredType, MAX_PRINT_BYTES, ORPHAN_MIN_AGE_MS, referencedImageIds } from '../shared/mindscape/images';
import { MINDSCAPE_SCHEMA_VERSION } from '../shared/mindscape/model';

/** The folder of the prints, beside the board file. */
export function mindscapeImagesDir(mindscapeFile: string): string {
  return join(dirname(mindscapeFile), 'mindscape-images');
}

/** The file system the store needs (injected: the vitest runs on a temp folder, a failure can be faked). */
export interface MindscapeImagesFs {
  /** Recursive. */
  mkdir(dir: string): Promise<void>;
  /** Exclusive create: never overwrites a file. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>;
  unlink(path: string): Promise<void>;
}

export const nodeMindscapeImagesFs: MindscapeImagesFs = {
  mkdir: async (dir) => {
    await fs.mkdir(dir, { recursive: true });
  },
  writeFile: (path, bytes) => fs.writeFile(path, bytes, { flag: 'wx' }),
  readFile: async (path) => new Uint8Array(await fs.readFile(path)),
  readdir: (dir) => fs.readdir(dir),
  stat: (path) => fs.stat(path),
  unlink: (path) => fs.unlink(path),
};

export interface MindscapeImagesDeps {
  /** `mindscapeImagesDir(...)`. */
  readonly dir: string;
  readonly fs?: MindscapeImagesFs;
  readonly now?: () => number;
  /** 8 lowercase hex characters (test seam). */
  readonly randomHex?: () => string;
}

export interface MindscapeImages {
  /** `mindscape:save-image` — payload `{ bytes, mediaType }`, never trusted. */
  save(payload: unknown): Promise<MindscapeSaveImageResult>;
  /** `mindscape:read-image` — an imageId out of the pattern never reaches the disk. */
  read(imageId: unknown): Promise<MindscapeReadImageResult>;
  /**
   * Boot sweep: with the raw text of `mindscape.json`, takes away the prints no
   * board references whose `mtime` is older than 1 hour. Missing, invalid or
   * newer document → nothing (an empty parse would take every print). Only
   * names in the imageId pattern are ever touched. Returns what went.
   */
  sweepOrphans(rawDocText: string | null): Promise<string[]>;
}

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The document the sweep may trust: valid JSON, with `boards`, and not of a newer schema. */
function sweepableDoc(text: string | null): unknown {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.boards)) return null;
  const version = raw.schemaVersion;
  if (typeof version === 'number' && version > MINDSCAPE_SCHEMA_VERSION) return null;
  return raw;
}

export function createMindscapeImages(deps: MindscapeImagesDeps): MindscapeImages {
  const io = deps.fs ?? nodeMindscapeImagesFs;
  const now = deps.now ?? Date.now;
  const randomHex = deps.randomHex ?? (() => randomBytes(4).toString('hex'));
  const { dir } = deps;

  return {
    save: async (payload) => {
      const mediaType = isRecord(payload) ? payload.mediaType : undefined;
      if (!isPrintStoredType(mediaType)) return { ok: false, reason: 'type' };
      const bytes = bytesOf((payload as Record<string, unknown>).bytes);
      if (!bytes) return { ok: false, reason: 'not-image' };
      if (bytes.byteLength > MAX_PRINT_BYTES) return { ok: false, reason: 'too-big' };
      if (bytes.byteLength === 0 || !looksLikeImage(bytes, mediaType)) return { ok: false, reason: 'not-image' };
      const imageId = `img-${now().toString(36)}-${randomHex()}.${extensionFor(mediaType)}`;
      // Belt and braces: the name we built must be one `read` would accept.
      if (!isImageId(imageId)) return { ok: false, reason: 'write-failed' };
      try {
        await io.mkdir(dir);
        await io.writeFile(join(dir, imageId), bytes);
        return { ok: true, imageId };
      } catch {
        return { ok: false, reason: 'write-failed' };
      }
    },

    read: async (imageId) => {
      if (!isImageId(imageId)) return { ok: false };
      const mediaType = MEDIA_TYPE_BY_EXTENSION[imageId.slice(imageId.lastIndexOf('.') + 1)];
      if (!mediaType) return { ok: false };
      try {
        return { ok: true, bytes: await io.readFile(join(dir, imageId)), mediaType };
      } catch {
        return { ok: false };
      }
    },

    sweepOrphans: async (rawDocText) => {
      const raw = sweepableDoc(rawDocText);
      if (raw === null) return [];
      const referenced = referencedImageIds(raw);
      let names: string[];
      try {
        names = await io.readdir(dir);
      } catch {
        return [];
      }
      const limit = now() - ORPHAN_MIN_AGE_MS;
      const removed: string[] = [];
      for (const name of names) {
        if (!isImageId(name) || referenced.has(name)) continue;
        const path = join(dir, name);
        try {
          const stat = await io.stat(path);
          if (!stat.isFile() || stat.mtimeMs >= limit) continue;
          await io.unlink(path);
          removed.push(name);
        } catch {
          // Best effort: a file that cannot go stays for the next boot.
        }
      }
      return removed;
    },
  };
}
