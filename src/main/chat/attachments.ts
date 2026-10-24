// T088 (014-chat) - image attachments of the composer (`chat:save-image`, data-model.md §11, research R4).
// A pasted/dropped image is written to `<userData>/chat-attachments/<sessionId>/` under a name WE generate and
// the absolute path goes back to the renderer, which hands it to the send machine (one bracketed paste each).
// The renderer never names a path or a file: only bytes and a media type come in, and both are checked here.
// Cleanup: the folders a tab wrote die with its PTY (`releasePty`) and the boot sweeps whatever is older than 7 days.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/** A screenshot of a big monitor is a few MB; 20 MB is generous and still bounded. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** SVG is deliberately absent: it can carry script. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const extensionFor = (mediaType: string): string | undefined => EXTENSIONS[mediaType];

/** Magic-number check: the bytes must be what the renderer said they are. */
export function looksLikeImage(bytes: Uint8Array, mediaType: string): boolean {
  const at = (i: number): number => bytes[i] ?? -1;
  const ascii = (offset: number, text: string): boolean => [...text].every((ch, i) => at(offset + i) === ch.charCodeAt(0));
  switch (mediaType) {
    case 'image/png':
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b);
    case 'image/jpeg':
      return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    case 'image/gif':
      return ascii(0, 'GIF87a') || ascii(0, 'GIF89a');
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    default:
      return false;
  }
}

export type ImageValidation = { readonly ok: true; readonly mediaType: string } | { readonly ok: false; readonly reason: string };

export function validateImage(bytes: Uint8Array, mediaType: unknown): ImageValidation {
  if (typeof mediaType !== 'string' || EXTENSIONS[mediaType] === undefined) return { ok: false, reason: 'tipo de imagem não aceito' };
  if (bytes.byteLength === 0) return { ok: false, reason: 'imagem vazia' };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'imagem grande demais (limite de 20 MB)' };
  if (!looksLikeImage(bytes, mediaType)) return { ok: false, reason: 'o arquivo não parece uma imagem do tipo informado' };
  return { ok: true, mediaType };
}

/** One path segment with no separators, drive marks or dot-dot. */
const isPlainSegment = (s: unknown): s is string => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !/[\\/:\0]/.test(s);

export interface AttachmentStoreDeps {
  /** `<userData>/chat-attachments` */
  readonly root: string;
  readonly now?: () => number;
}

export interface SavedImage {
  readonly id: string;
  readonly path: string;
}

export class AttachmentStore {
  private readonly root: string;
  private readonly now: () => number;
  /** Session folders written by each tab, so closing the tab can remove them. */
  private readonly written = new Map<string, Set<string>>();

  constructor(deps: AttachmentStoreDeps) {
    this.root = deps.root;
    this.now = deps.now ?? Date.now;
  }

  async save(ptyId: string, sessionId: string, bytes: Uint8Array, mediaType: unknown): Promise<SavedImage> {
    if (!isPlainSegment(sessionId)) throw new Error('chat:save-image: sessão inválida');
    const checked = validateImage(bytes, mediaType);
    if (!checked.ok) throw new Error(`chat:save-image: ${checked.reason}`);
    const dir = join(this.root, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const name = `img-${this.now().toString(36)}-${randomBytes(4).toString('hex')}.${EXTENSIONS[checked.mediaType]}`;
    const path = join(dir, name);
    await fs.writeFile(path, bytes, { flag: 'wx' });
    let sessions = this.written.get(ptyId);
    if (sessions === undefined) {
      sessions = new Set();
      this.written.set(ptyId, sessions);
    }
    sessions.add(sessionId);
    return { id: name, path };
  }

  /** The tab's PTY is gone: its folders go with it. */
  async releasePty(ptyId: string): Promise<void> {
    const sessions = this.written.get(ptyId);
    this.written.delete(ptyId);
    if (sessions === undefined) return;
    for (const sessionId of sessions) {
      await fs.rm(join(this.root, sessionId), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Boot sweep: files older than `maxAgeMs` go; session folders left empty go too. */
  async sweepOlderThan(maxAgeMs: number): Promise<void> {
    let sessions: string[];
    try {
      sessions = await fs.readdir(this.root);
    } catch {
      return;
    }
    const limit = this.now() - maxAgeMs;
    for (const session of sessions) {
      const dir = join(this.root, session);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue; // not a folder
      }
      let remaining = files.length;
      for (const file of files) {
        try {
          const stat = await fs.stat(join(dir, file));
          if (stat.isFile() && stat.mtimeMs < limit) {
            await fs.unlink(join(dir, file));
            remaining -= 1;
          }
        } catch {
          // vanished or locked: leave it for the next boot
        }
      }
      if (remaining <= 0) await fs.rmdir(dir).catch(() => undefined);
    }
  }
}
