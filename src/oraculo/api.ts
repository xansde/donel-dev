// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — the API the PC's app talks to. The daemon runs today's
// `createLedgerService` over its own `ledger.json`; this handler is pure (request → response) so the test needs no
// network, and `server.ts` puts the socket around it. Every route needs the PC's token.

import { createHash, timingSafeEqual } from 'node:crypto';
import { MAX_PROOF_FILE_BYTES, PROOF_FILE_TYPES, isProofFileName, maxProofBytes, type LedgerActor, type LedgerOp } from '../shared/ledger/contract';
import type { LedgerService } from '../main/ledger-store';

export interface OracleRequest {
  readonly method: string;
  /** Path with query, as it came. */
  readonly url: string;
  readonly authorization?: string;
  readonly body: string;
  /** Only `PUT /v1/provas`: the raw bytes. */
  readonly bytes?: Uint8Array;
}

export type OracleBody = string | { readonly filePath: string };

export interface OracleResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: OracleBody;
}

export type OracleApiHandler = (request: OracleRequest) => Promise<OracleResponse>;

export const PROOF_UPLOAD_PATH = '/v1/provas';
/** The biggest body of a proof upload (the biggest proof the ledger takes). */
export const MAX_UPLOAD_BYTES = MAX_PROOF_FILE_BYTES;
/** Any other body (an op with the owner's letter fits well under it). */
export const MAX_JSON_BYTES = 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;

function json(status: number, value: unknown): OracleResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(value) };
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time check of `Bearer <token>`. */
export function bearerMatches(authorization: string | undefined, token: string): boolean {
  if (!authorization?.startsWith('Bearer ') || !token) return false;
  return timingSafeEqual(digest(authorization.slice('Bearer '.length)), digest(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActor(value: unknown): LedgerActor | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'dono') return { kind: 'dono' };
  if (value.kind !== 'lugar' || typeof value.placeId !== 'string' || !value.placeId.trim()) return null;
  return { kind: 'lugar', placeId: value.placeId, ...(typeof value.roleId === 'string' ? { roleId: value.roleId } : {}) };
}

export interface OracleApiDeps {
  readonly ledger: LedgerService;
  /** The PC's token (`pc.token`). */
  readonly token: string;
}

export function createOracleApiHandler(deps: OracleApiDeps): OracleApiHandler {
  const { ledger } = deps;
  return async (request) => {
    if (!bearerMatches(request.authorization, deps.token)) return json(401, { error: 'token' });
    const url = new URL(request.url, 'http://oraculo');
    const path = url.pathname;

    if (request.method === 'GET' && path === '/v1/ledger') {
      try {
        return json(200, ledger.load());
      } catch (error) {
        return json(500, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (request.method === 'POST' && path === '/v1/apply') {
      let body: unknown;
      try {
        body = JSON.parse(request.body);
      } catch {
        return json(400, { error: 'corpo não é JSON' });
      }
      const actor = isRecord(body) ? parseActor(body.actor) : null;
      const op = isRecord(body) && isRecord(body.op) && typeof body.op.op === 'string' ? (body.op as unknown as LedgerOp) : null;
      if (!actor || !op) return json(400, { error: 'actor ou op inválido' });
      try {
        const result = ledger.apply(actor, op);
        if (!result.ok) return json(200, result);
        return json(200, { ...result, snapshot: ledger.load() });
      } catch {
        // A malformed op from the PC (an older or newer app) throws inside the pure apply: nothing was written.
        return json(400, { error: 'op malformada' });
      }
    }

    if (request.method === 'PUT' && path === PROOF_UPLOAD_PATH) {
      const ext = (url.searchParams.get('ext') ?? '').toLowerCase();
      const mediaType = PROOF_FILE_TYPES[ext];
      const bytes = request.bytes;
      if (!mediaType || !bytes) return json(400, { error: 'a prova em arquivo é print, vídeo ou protótipo HTML' });
      if (bytes.byteLength > maxProofBytes(mediaType)) return json(400, { error: 'prova grande demais' });
      const proof = await ledger.importProof({ tipo: 'arquivo', caminho: `upload.${ext}` }, async () => ({ ok: true, bytes: Buffer.from(bytes), ext, mediaType }));
      return 'error' in proof ? json(400, proof) : json(200, proof);
    }

    if (request.method === 'GET' && path.startsWith(`${PROOF_UPLOAD_PATH}/`)) {
      const name = decodeURIComponent(path.slice(PROOF_UPLOAD_PATH.length + 1));
      const filePath = isProofFileName(name) ? ledger.proofPath({ kind: 'arquivo', file: name, mediaType: '' }) : null;
      if (!filePath) return json(404, { error: 'prova' });
      return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }, body: { filePath } };
    }

    return json(404, { error: 'rota' });
  };
}
