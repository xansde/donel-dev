// T088 (014-chat) - image attachments of the composer (main side): validation, unique name, per-session
// folder, cleanup on tab close and the boot sweep by age. Real temp folders; no Electron.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AttachmentStore,
  MAX_IMAGE_BYTES,
  extensionFor,
  looksLikeImage,
  validateImage,
} from '../src/main/chat/attachments';

let root: string;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'donel-att-')), 'chat-attachments');
});
afterEach(() => rmSync(dirname(root), { recursive: true, force: true }));

describe('validateImage', () => {
  it('accepts a PNG whose bytes match its type', () => {
    expect(validateImage(PNG, 'image/png')).toEqual({ ok: true, mediaType: 'image/png' });
  });
  it('rejects a type outside the allow-list (SVG carries script)', () => {
    expect(validateImage(PNG, 'image/svg+xml')).toMatchObject({ ok: false });
    expect(validateImage(PNG, 'application/pdf')).toMatchObject({ ok: false });
  });
  it('rejects bytes that do not look like the declared type', () => {
    expect(validateImage(JPEG, 'image/png')).toMatchObject({ ok: false });
    expect(validateImage(Buffer.from('hello world'), 'image/png')).toMatchObject({ ok: false });
  });
  it('rejects empty and too-large payloads', () => {
    expect(validateImage(Buffer.alloc(0), 'image/png')).toMatchObject({ ok: false });
    expect(validateImage(Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]), 'image/png')).toMatchObject({ ok: false });
  });
  it('knows the signature of every served type', () => {
    expect(looksLikeImage(Buffer.from('GIF89a......'), 'image/gif')).toBe(true);
    expect(looksLikeImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp')).toBe(true);
    expect(extensionFor('image/jpeg')).toBe('jpg');
  });
});

describe('AttachmentStore.save', () => {
  it('writes under <root>/<sessionId>/ with a generated name and returns the absolute path', async () => {
    const store = new AttachmentStore({ root });
    const out = await store.save('pty-1', 's1', PNG, 'image/png');
    expect(out.path.startsWith(join(root, 's1'))).toBe(true);
    expect(basename(out.path)).toMatch(/^img-[0-9a-z]+-[0-9a-f]+\.png$/);
    expect(out.id).toBe(basename(out.path));
    expect(readFileSync(out.path).equals(PNG)).toBe(true);
  });
  it('gives two saves of the same bytes two different files', async () => {
    const store = new AttachmentStore({ root });
    const a = await store.save('pty-1', 's1', PNG, 'image/png');
    const b = await store.save('pty-1', 's1', PNG, 'image/png');
    expect(a.path).not.toBe(b.path);
    expect(readdirSync(join(root, 's1'))).toHaveLength(2);
  });
  it('refuses an invalid session id (never a path from outside)', async () => {
    const store = new AttachmentStore({ root });
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'c:x']) {
      await expect(store.save('pty-1', bad, PNG, 'image/png')).rejects.toThrow();
    }
    expect(existsSync(root)).toBe(false);
  });
  it('refuses invalid content without creating the folder', async () => {
    const store = new AttachmentStore({ root });
    await expect(store.save('pty-1', 's1', Buffer.from('nope'), 'image/png')).rejects.toThrow(/imagem/);
    expect(existsSync(join(root, 's1'))).toBe(false);
  });
});

describe('cleanup', () => {
  it('releasePty removes the folders written for that tab and only those', async () => {
    const store = new AttachmentStore({ root });
    await store.save('pty-1', 's1', PNG, 'image/png');
    await store.save('pty-1', 's1b', JPEG, 'image/jpeg');
    await store.save('pty-2', 's2', PNG, 'image/png');
    await store.releasePty('pty-1');
    expect(existsSync(join(root, 's1'))).toBe(false);
    expect(existsSync(join(root, 's1b'))).toBe(false);
    expect(existsSync(join(root, 's2'))).toBe(true);
  });
  it('releasePty on an unknown tab is a no-op', async () => {
    const store = new AttachmentStore({ root });
    await expect(store.releasePty('ghost')).resolves.toBeUndefined();
  });
  it('sweepOlderThan deletes only files past the age and drops emptied folders', async () => {
    mkdirSync(join(root, 'old'), { recursive: true });
    mkdirSync(join(root, 'mixed'), { recursive: true });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const put = (rel: string, ageDays: number): void => {
      const file = join(root, rel);
      writeFileSync(file, PNG);
      const t = new Date(now - ageDays * day);
      utimesSync(file, t, t);
    };
    put('old/a.png', 9);
    put('mixed/b.png', 8);
    put('mixed/c.png', 1);
    const store = new AttachmentStore({ root, now: () => now });
    await store.sweepOlderThan(7 * day);
    expect(existsSync(join(root, 'old'))).toBe(false);
    expect(readdirSync(join(root, 'mixed'))).toEqual(['c.png']);
  });
  it('sweepOlderThan tolerates a missing root', async () => {
    const store = new AttachmentStore({ root });
    await expect(store.sweepOlderThan(1000)).resolves.toBeUndefined();
  });
});
