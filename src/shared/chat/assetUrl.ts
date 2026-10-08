// T046 (014-chat) - `donel-asset:` URLs (research.md R21). Pure: building them
// (renderer) and parsing them (main) share this file so the two cannot drift.
//
//   donel-asset://image/<ptyId>?p=<transcript path>&o=<offset>&l=<length>&b=<blockIndex>
//   donel-asset://attachment/<sessionId>/<fileName>
//
// Parsing only decides the SHAPE of the request; whether the path is allowed is
// decided by the main process (assets-protocol.ts + linkPolicy.ts).

import type { LineRef } from './rows';

export const ASSET_SCHEME = 'donel-asset';

export type ParsedAssetUrl =
  | { readonly kind: 'image'; readonly ptyId: string; readonly ref: LineRef; readonly blockIndex: number }
  | { readonly kind: 'attachment'; readonly sessionId: string; readonly fileName: string };

export function buildImageAssetUrl(ptyId: string, ref: LineRef, blockIndex: number): string {
  const q = new URLSearchParams({ p: ref.path, o: String(ref.offset), l: String(ref.length), b: String(blockIndex) });
  return `${ASSET_SCHEME}://image/${encodeURIComponent(ptyId)}?${q.toString()}`;
}

export function buildAttachmentAssetUrl(sessionId: string, fileName: string): string {
  return `${ASSET_SCHEME}://attachment/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`;
}

const nonNegInt = (v: string | null): number | null => {
  if (v === null || !/^\d{1,15}$/.test(v)) return null;
  return Number(v);
};

/** `null` = malformed (never a path decision). */
export function parseAssetUrl(url: string): ParsedAssetUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${ASSET_SCHEME}:`) return null;
  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  try {
    if (u.hostname === 'image' && segments.length === 1) {
      const path = u.searchParams.get('p');
      const offset = nonNegInt(u.searchParams.get('o'));
      const length = nonNegInt(u.searchParams.get('l'));
      const blockIndex = nonNegInt(u.searchParams.get('b'));
      if (path === null || path === '' || offset === null || length === null || blockIndex === null || length === 0) return null;
      return { kind: 'image', ptyId: decodeURIComponent(segments[0]!), ref: { path, offset, length }, blockIndex };
    }
    if (u.hostname === 'attachment' && segments.length === 2) {
      return { kind: 'attachment', sessionId: decodeURIComponent(segments[0]!), fileName: decodeURIComponent(segments[1]!) };
    }
  } catch {
    return null; // malformed percent-encoding
  }
  return null;
}
