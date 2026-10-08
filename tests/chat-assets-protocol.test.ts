// T046 (014-chat) - `donel-asset:` resolution (pure part). Real temp files; no Electron.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAttachmentAssetUrl, buildImageAssetUrl, parseAssetUrl } from '../src/shared/chat/assetUrl';
import { resolveAsset, type AssetResolverDeps } from '../src/main/chat/assets-protocol';

let dir: string;
let sessionsDir: string;
let attachmentsRoot: string;
const PNG = Buffer.from('iVBORw0KGgo=', 'base64');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-assets-'));
  sessionsDir = join(dir, 'projects', 'p');
  attachmentsRoot = join(dir, 'chat-attachments');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(join(attachmentsRoot, 's1'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function deps(): AssetResolverDeps {
  return {
    transcriptRoots: (ptyId) => (ptyId === 'pty-1' ? [sessionsDir] : []),
    attachmentsRoot,
  };
}

function writeTranscript(): { path: string; offset: number; length: number } {
  const first = JSON.stringify({ type: 'user', uuid: 'u0', message: { role: 'user', content: 'hi' } });
  const second = JSON.stringify({
    type: 'user',
    uuid: 'u1',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
      ],
    },
  });
  const path = join(sessionsDir, 's.jsonl');
  writeFileSync(path, `${first}\n${second}\n`);
  return { path, offset: Buffer.byteLength(first) + 1, length: Buffer.byteLength(second) };
}

describe('asset URL', () => {
  it('round-trips image and attachment urls', () => {
    const ref = { path: 'C:\\x y\\s.jsonl', offset: 12, length: 99 };
    const parsed = parseAssetUrl(buildImageAssetUrl('pty-1', ref, 3));
    expect(parsed).toEqual({ kind: 'image', ptyId: 'pty-1', ref, blockIndex: 3 });
    expect(parseAssetUrl(buildAttachmentAssetUrl('s1', 'a b.png'))).toEqual({ kind: 'attachment', sessionId: 's1', fileName: 'a b.png' });
  });

  it('rejects malformed urls', () => {
    expect(parseAssetUrl('https://image/pty-1')).toBeNull();
    expect(parseAssetUrl('donel-asset://image/pty-1')).toBeNull();
    expect(parseAssetUrl('donel-asset://image/pty-1?p=a&o=-1&l=2&b=0')).toBeNull();
    expect(parseAssetUrl('donel-asset://other/x')).toBeNull();
    expect(parseAssetUrl('not a url')).toBeNull();
  });
});

describe('resolveAsset', () => {
  it('serves an image block by LineRef + blockIndex', async () => {
    const ref = writeTranscript();
    const url = buildImageAssetUrl('pty-1', ref, 1);
    const res = await resolveAsset(url, deps());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.mediaType).toBe('image/png');
    expect(Buffer.compare(res.bytes, PNG)).toBe(0);
  });

  it('refuses a transcript path outside the pty roots and an unknown pty', async () => {
    const ref = writeTranscript();
    const outside = join(dir, 'other.jsonl');
    writeFileSync(outside, 'x\n');
    expect((await resolveAsset(buildImageAssetUrl('pty-1', { ...ref, path: outside }, 1), deps())).status).toBe('forbidden');
    expect((await resolveAsset(buildImageAssetUrl('pty-2', ref, 1), deps())).status).toBe('forbidden');
    expect((await resolveAsset(buildImageAssetUrl('pty-1', { ...ref, path: join(sessionsDir, '..', '..', 'x.jsonl') }, 1), deps())).status).toBe('forbidden');
  });

  it('refuses a non-image block and a block that does not exist', async () => {
    const ref = writeTranscript();
    expect((await resolveAsset(buildImageAssetUrl('pty-1', ref, 0), deps())).status).toBe('not-found');
    expect((await resolveAsset(buildImageAssetUrl('pty-1', ref, 9), deps())).status).toBe('not-found');
  });

  it('serves an attachment by id and refuses traversal', async () => {
    writeFileSync(join(attachmentsRoot, 's1', 'a.png'), PNG);
    writeFileSync(join(dir, 'secret.png'), PNG);
    const ok = await resolveAsset(buildAttachmentAssetUrl('s1', 'a.png'), deps());
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') expect(ok.mediaType).toBe('image/png');
    expect((await resolveAsset(buildAttachmentAssetUrl('s1', '..\\..\\secret.png'), deps())).status).toBe('forbidden');
    expect((await resolveAsset(buildAttachmentAssetUrl('..', 'secret.png'), deps())).status).not.toBe('ok');
    expect((await resolveAsset('donel-asset://attachment/%2e%2e/secret.png', deps())).status).not.toBe('ok');
    expect((await resolveAsset(buildAttachmentAssetUrl('s1', 'missing.png'), deps())).status).toBe('not-found');
    expect((await resolveAsset(buildAttachmentAssetUrl('s1', 'a.exe'), deps())).status).toBe('forbidden');
  });

  it('answers bad-request for a malformed url', async () => {
    expect((await resolveAsset('donel-asset://image/pty-1', deps())).status).toBe('bad-request');
  });
});
