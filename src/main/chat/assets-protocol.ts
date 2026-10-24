// T046 (014-chat) - `donel-asset:` protocol (research.md R21; ipc-chat.md §4).
// Serves transcript image blocks (by LineRef + blockIndex) and attachments (by
// id) to <img> without sending base64 through IPC. Every path is validated here
// with the T044 policy; the renderer never gets to name a path outside the
// roots. `resolveAsset` is pure over injected deps (tested without Electron).

import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { ASSET_SCHEME, parseAssetUrl } from '../../shared/chat/assetUrl';
import { isAssetPathAllowed } from '../../shared/chat/linkPolicy';
import type { LineRef } from '../../shared/chat/rows';
import { readLineRef } from './transcript-pager';

export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
/** SVG is deliberately absent: it can carry script. */
const SERVED_MEDIA_TYPES = new Set(Object.values(IMAGE_TYPES));

export interface AssetResolverDeps {
  /** Folders the tab's transcript files may live in (session dir + subagents). Empty = unknown tab. */
  transcriptRoots(ptyId: string): readonly string[];
  readonly attachmentsRoot: string;
  /** Test seam; defaults to `readLineRef`. */
  readLine?(ref: LineRef): Promise<string>;
}

export type AssetResolution =
  | { readonly status: 'ok'; readonly bytes: Buffer; readonly mediaType: string }
  | { readonly status: 'bad-request' | 'forbidden' | 'not-found' };

/** One path segment with no separators, drive marks or dot-dot. */
const isPlainSegment = (s: string): boolean => s !== '' && s !== '.' && s !== '..' && !/[\\/:\0]/.test(s);

const fail = (status: 'bad-request' | 'forbidden' | 'not-found'): AssetResolution => ({ status });

export async function resolveAsset(url: string, deps: AssetResolverDeps): Promise<AssetResolution> {
  const parsed = parseAssetUrl(url);
  if (parsed === null) return fail('bad-request');

  if (parsed.kind === 'image') {
    const { ref } = parsed;
    if (extname(ref.path).toLowerCase() !== '.jsonl') return fail('forbidden');
    if (!isAssetPathAllowed(ref.path, deps.transcriptRoots(parsed.ptyId))) return fail('forbidden');
    let text: string;
    try {
      text = await (deps.readLine ?? readLineRef)(ref);
    } catch {
      return fail('not-found');
    }
    const block = imageBlockOf(text, parsed.blockIndex);
    return block === null ? fail('not-found') : { status: 'ok', ...block };
  }

  // attachment: <attachmentsRoot>/<sessionId>/<fileName>
  const mediaType = IMAGE_TYPES[extname(parsed.fileName).toLowerCase()];
  if (mediaType === undefined) return fail('forbidden');
  if (!isPlainSegment(parsed.sessionId) || !isPlainSegment(parsed.fileName)) return fail('forbidden');
  const path = join(deps.attachmentsRoot, parsed.sessionId, parsed.fileName);
  if (!isAssetPathAllowed(path, [deps.attachmentsRoot])) return fail('forbidden');
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return fail('not-found');
    if (stat.size > MAX_ASSET_BYTES) return fail('forbidden');
    return { status: 'ok', bytes: await fs.readFile(path), mediaType };
  } catch {
    return fail('not-found');
  }
}

/** The `blockIndex`-th block of `message.content` (or of a queued `attachment.prompt`), when it is a base64 image of a served type. */
function imageBlockOf(lineText: string, blockIndex: number): { bytes: Buffer; mediaType: string } | null {
  let line: unknown;
  try {
    line = JSON.parse(lineText);
  } catch {
    return null;
  }
  // A user line carries the blocks in `message.content`; a prompt queued mid-round, in `attachment.prompt`.
  const holder = line as { message?: { content?: unknown }; attachment?: { prompt?: unknown } } | null;
  const content = holder?.message?.content ?? holder?.attachment?.prompt;
  if (!Array.isArray(content)) return null;
  const block = content[blockIndex] as { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } } | undefined;
  if (block?.type !== 'image' || block.source?.type !== 'base64') return null;
  const { media_type: mediaType, data } = block.source;
  if (typeof mediaType !== 'string' || typeof data !== 'string' || !SERVED_MEDIA_TYPES.has(mediaType)) return null;
  return { bytes: Buffer.from(data, 'base64'), mediaType };
}

// ---------------------------------------------------------------------------
// Electron wiring (not unit-tested: needs the app). The `protocol` module is
// injected so this file stays importable under vitest.
// ---------------------------------------------------------------------------

/** The slice of Electron's `protocol` used here. */
export interface ProtocolLike {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void;
  handle(scheme: string, handler: (request: { url: string }) => Promise<Response>): void;
}

/** Must run before `app.ready`: gives the scheme the privileges <img> needs. */
export function registerAssetScheme(protocol: ProtocolLike): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** After `app.ready`. Responses are never cached across sessions. */
export function registerAssetsProtocol(protocol: ProtocolLike, deps: AssetResolverDeps): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const res = await resolveAsset(request.url, deps);
    if (res.status === 'ok') {
      return new Response(new Uint8Array(res.bytes), { headers: { 'content-type': res.mediaType, 'cache-control': 'no-store' } });
    }
    const code = res.status === 'bad-request' ? 400 : res.status === 'forbidden' ? 403 : 404;
    return new Response(null, { status: code });
  });
}