// Cartas forma A, fatia 4 (spec docs/specs/cartas-forma-a.md, A2.4) — the `donel-prova:` protocol: the desktop card
// shows a proof of the Oráculo Harrow (the prototype in HTML, a video) straight from `<userData>/ledger-provas/`.
//
//   donel-prova://prova/<file name>
//
// Only a name the main gave (`isProofFileName`: no folder, no `..`, a known extension) and only inside the proofs
// folder: this is a navigation guard, the renderer never names a path. The HTML of an agent goes out with the
// prototype CSP (sandbox with scripts only, no network, nothing from outside), and the card's iframe is
// `sandbox="allow-scripts"` too: without `allow-same-origin` it never reaches `window.donel`. The scheme lives in
// the default session only, so the internal browser (its own partition) cannot load it.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { HTML_MEDIA_TYPE, isProofFileName, maxProofBytes, PROOF_FILE_TYPES } from '../shared/ledger/contract';
import { PROOF_SCHEME } from '../shared/ledger/channels';
import type { ProtocolLike } from './chat/assets-protocol';

/**
 * The phone's prototype CSP (`celular/server.ts`) minus `frame-ancestors 'self'`: here the card that frames the
 * proof is the app's own page, whose origin is not `donel-prova:`, so `'self'` would block it. Who may frame it is
 * already closed by the scheme living only in the app's session.
 */
export const DESKTOP_PROTOTYPE_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** Prints and videos never run anything. */
const MEDIA_CSP = "sandbox; default-src 'none'";

export type ProofResolution = { readonly ok: true; readonly path: string; readonly mediaType: string; readonly csp: string } | { readonly ok: false };

/** Pure: which file of `proofsDir` a `donel-prova:` URL names, or nothing. */
export function resolveProofUrl(url: string, proofsDir: string): ProofResolution {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== `${PROOF_SCHEME}:` || parsed.hostname !== 'prova' || parsed.search || parsed.hash) return { ok: false };
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!isProofFileName(name)) return { ok: false };
  const mediaType = PROOF_FILE_TYPES[name.split('.').pop()!]!;
  return { ok: true, path: join(proofsDir, name), mediaType, csp: mediaType === HTML_MEDIA_TYPE ? DESKTOP_PROTOTYPE_CSP : MEDIA_CSP };
}

/** Before `app.ready`, with the other privileged schemes. */
export function proofSchemePrivileges(): { scheme: string; privileges: Record<string, boolean> } {
  return { scheme: PROOF_SCHEME, privileges: { standard: true, secure: true, stream: true } };
}

/** After `app.ready`. */
export function registerProofProtocol(protocol: ProtocolLike, proofsDir: string): void {
  protocol.handle(PROOF_SCHEME, async (request) => {
    const resolved = resolveProofUrl(request.url, proofsDir);
    if (!resolved.ok) return new Response(null, { status: 403 });
    try {
      const stat = await fs.lstat(resolved.path);
      if (!stat.isFile() || stat.size > maxProofBytes(resolved.mediaType)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(await fs.readFile(resolved.path)), {
        headers: {
          'content-type': resolved.mediaType === HTML_MEDIA_TYPE ? 'text/html; charset=utf-8' : resolved.mediaType,
          'content-security-policy': resolved.csp,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
