// Serviço da VPS — o Oráculo Harrow mora aqui (demanda donel-vps, fatia 02).
// O mesmo `LedgerService` do app (ledger-store.ts), sobre `~/.donel/ledger.json`,
// com uma API HTTP para o app do PC usar como cliente quando está ligado.
//
// Segurança, como o servidor do celular: ouve SÓ no endereço Tailscale da VPS,
// recusa conexão que não venha da faixa da Tailscale e exige o token do Oráculo
// (`Authorization: Bearer`). Do token só fica o sha256, em `~/.donel/oraculo.json`.
//
// Rotas (JSON):
//   GET  /v1/oraculo                 → LedgerSnapshot
//   POST /v1/oraculo/aplicar         { actor, op } → LedgerApplyResult
//   POST /v1/oraculo/ferramenta      { caller, call } → LedgerToolAnswer (o PC resolve o quadro e manda)
//   POST /v1/oraculo/anexo?nome=x    corpo = bytes de uma prova → { caminho } para usar em `tarefa_entregar`
//   GET  /v1/oraculo/prova/<arquivo> → bytes de uma prova copiada

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { isProofFileName, MAX_PROOF_FILE_BYTES, PROOF_FILE_TYPES, type LedgerActor, type LedgerOp } from '../../shared/ledger/contract';
import type { LedgerToolCall } from '../../shared/ledger/tools';
import { runLedgerTool, type LedgerCaller, type LedgerService } from '../../main/ledger-store';
import { isTailscaleAddress } from '../../main/celular/tailscale';

export const ORACULO_PORT = 47816;

export interface OraculoRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: Buffer;
}

export interface OraculoResponse {
  readonly status: number;
  readonly json?: unknown;
  readonly bytes?: Buffer;
  readonly contentType?: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Lê o hash do token; `null` sem token configurado (a API recusa tudo). */
export function readTokenHash(file: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { tokenHash?: unknown };
    return typeof parsed.tokenHash === 'string' && /^[0-9a-f]{64}$/.test(parsed.tokenHash) ? parsed.tokenHash : null;
  } catch {
    return null;
  }
}

/** Gera um token novo, grava só o hash e devolve o token para o dono copiar UMA vez. */
export function rotateToken(file: string): string {
  const token = randomBytes(32).toString('base64url');
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ tokenHash: hashToken(token) }, null, 2)}\n`, { mode: 0o600 });
  return token;
}

function bearerMatches(authorization: string | undefined, tokenHash: string | null): boolean {
  if (!tokenHash || !authorization?.startsWith('Bearer ')) return false;
  const given = Buffer.from(hashToken(authorization.slice('Bearer '.length).trim()), 'hex');
  const expected = Buffer.from(tokenHash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseJson(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface OraculoHandlerDeps {
  readonly service: LedgerService;
  readonly tokenHash: () => string | null;
  /** Onde os anexos enviados pelo PC esperam o `tarefa_entregar` copiá-los para `ledger-provas/`. */
  readonly attachmentsDir: string;
}

export function createOraculoHandler(deps: OraculoHandlerDeps): (request: OraculoRequest) => Promise<OraculoResponse> {
  return async (request) => {
    if (!bearerMatches(request.authorization, deps.tokenHash())) return { status: 401, json: { ok: false, reason: 'token' } };
    const url = new URL(request.url, 'http://oraculo');
    const path = url.pathname;

    if (request.method === 'GET' && path === '/v1/oraculo') {
      try {
        return { status: 200, json: deps.service.load() };
      } catch {
        return { status: 500, json: { ok: false, reason: 'oraculo-ilegivel' } };
      }
    }

    if (request.method === 'POST' && path === '/v1/oraculo/aplicar') {
      const body = parseJson(request.body);
      if (!body || typeof body.actor !== 'object' || typeof body.op !== 'object') return { status: 400, json: { ok: false, reason: 'pedido-invalido' } };
      return { status: 200, json: deps.service.apply(body.actor as LedgerActor, body.op as LedgerOp) };
    }

    if (request.method === 'POST' && path === '/v1/oraculo/ferramenta') {
      const body = parseJson(request.body);
      if (!body || typeof body.caller !== 'object' || typeof body.call !== 'object') return { status: 400, json: { ok: false, reason: 'pedido-invalido' } };
      return { status: 200, json: await runLedgerTool(deps.service, body.caller as LedgerCaller, body.call as LedgerToolCall) };
    }

    if (request.method === 'POST' && path === '/v1/oraculo/anexo') {
      const ext = extname(url.searchParams.get('nome') ?? '').slice(1).toLowerCase();
      if (!(ext in PROOF_FILE_TYPES)) return { status: 400, json: { ok: false, reason: 'tipo-de-arquivo' } };
      if (request.body.length === 0 || request.body.length > MAX_PROOF_FILE_BYTES) return { status: 413, json: { ok: false, reason: 'tamanho' } };
      mkdirSync(deps.attachmentsDir, { recursive: true, mode: 0o700 });
      const caminho = join(deps.attachmentsDir, `${randomUUID()}.${ext}`);
      writeFileSync(caminho, request.body, { mode: 0o600 });
      return { status: 200, json: { ok: true, caminho } };
    }

    const proofMatch = /^\/v1\/oraculo\/prova\/([^/]+)$/.exec(path);
    if (request.method === 'GET' && proofMatch) {
      const file = decodeURIComponent(proofMatch[1]);
      if (!isProofFileName(file)) return { status: 404, json: { ok: false, reason: 'prova' } };
      const ext = extname(file).slice(1).toLowerCase();
      const proofPath = deps.service.proofPath({ kind: 'arquivo', file, mediaType: PROOF_FILE_TYPES[ext] ?? 'application/octet-stream' });
      if (!proofPath) return { status: 404, json: { ok: false, reason: 'prova' } };
      try {
        return { status: 200, bytes: readFileSync(proofPath), contentType: PROOF_FILE_TYPES[ext] ?? 'application/octet-stream' };
      } catch {
        return { status: 404, json: { ok: false, reason: 'prova' } };
      }
    }

    return { status: 404, json: { ok: false, reason: 'rota' } };
  };
}

const MAX_BODY_BYTES = MAX_PROOF_FILE_BYTES + 1024;

export function startOraculoServer(options: { readonly address: string; readonly port?: number; readonly handler: (request: OraculoRequest) => Promise<OraculoResponse> }): Promise<Server> {
  if (!isTailscaleAddress(options.address)) return Promise.reject(new Error('o Oráculo só ouve no endereço Tailscale'));
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!isTailscaleAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
      options
        .handler({ method: req.method ?? 'GET', url: req.url ?? '/', authorization, body: Buffer.concat(chunks) })
        .then((response) => {
          if (response.bytes) {
            res.writeHead(response.status, { 'Content-Type': response.contentType ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(response.bytes);
          } else {
            res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(response.json ?? null));
          }
        })
        .catch(() => res.writeHead(500).end());
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? ORACULO_PORT, options.address, () => resolve(server));
  });
}
