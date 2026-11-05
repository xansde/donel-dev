// Ledger no celular — o servidor HTTP da PWA. Ouve SÓ no endereço Tailscale do PC (recusa subir em qualquer
// outro, inclusive 0.0.0.0 e 127.0.0.1) e recusa conexão que não venha da Tailscale. Tudo em /api exige o
// token de sessão do celular, menos o pareamento (que exige o código de uso único). Os arquivos da PWA não
// têm dado nenhum e saem sem token.
//
// O `createMobileHandler` é puro (pedido → resposta) para o teste não precisar de rede; o `startMobileServer`
// só põe o socket em volta.

import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import type { DecisaoCelular } from '../../shared/celular';
import { isRequestId } from '../../shared/ledger/contract';
import type { CelularAuth } from './auth';
import type { MobileLedgerPort } from './ledger-port';
import { isTailscaleAddress } from './tailscale';

export const MOBILE_PORT = 47815;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MOTIVO = 2000;

export interface MobileAsset {
  readonly contentType: string;
  readonly body: string;
}

export interface MobileRequest {
  readonly method: string;
  /** Caminho com query, como veio (`/api/prova?item=..`). */
  readonly url: string;
  readonly authorization?: string;
  readonly body: string;
}

export type MobileBody = string | Uint8Array | { readonly filePath: string };

export interface MobileResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: MobileBody;
}

export interface MobileHandlerDeps {
  readonly auth: CelularAuth;
  readonly ledger: () => MobileLedgerPort;
  /** `/` → index.html etc. */
  readonly assets: Readonly<Record<string, MobileAsset>>;
  /** Raiz das provas copiadas pelo ledger; prova em arquivo fora dela não sai. `null` = nenhuma em arquivo. */
  readonly provasRoot: string | null;
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function json(status: number, value: unknown): MobileResponse {
  return { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) };
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isInside(root: string, filePath: string): boolean {
  const rel = relative(resolve(root), resolve(filePath));
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

export function createMobileHandler(deps: MobileHandlerDeps): (request: MobileRequest) => MobileResponse {
  function decide(body: string): MobileResponse {
    const input = parseJson(body);
    if (!input) return json(400, { erro: 'pedido-invalido' });
    const { pedidoId, itemId, decisao, motivo } = input;
    // O pedidoId vai gravado com a decisão no ledger: um reenvio (a rede caiu, o app reiniciou) recebe a mesma
    // resposta sem gravar de novo. Recusa não fica guardada: uma falha passageira pode dar certo no reenvio.
    if (!isRequestId(pedidoId)) return json(400, { erro: 'pedido-invalido' });
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 200) return json(400, { erro: 'pedido-invalido' });
    if (decisao !== 'aceitar' && decisao !== 'rejeitar') return json(400, { erro: 'pedido-invalido' });
    const reason = typeof motivo === 'string' ? motivo.trim().slice(0, MAX_MOTIVO) : '';
    if (decisao === 'rejeitar' && reason.length === 0) return json(400, { erro: 'motivo-obrigatorio' });
    const outcome = deps.ledger().decidir({
      pedidoId,
      itemId,
      decisao: decisao as DecisaoCelular,
      motivo: decisao === 'rejeitar' ? reason : null,
    });
    return outcome.ok
      ? json(200, { ok: true, estado: outcome.estado })
      : json(outcome.reason === 'nao-encontrada' ? 404 : 409, { erro: outcome.reason, mensagem: outcome.message });
  }

  function proof(query: URLSearchParams): MobileResponse {
    const itemId = query.get('item') ?? '';
    const provaId = query.get('prova') ?? '';
    const source = itemId && provaId ? deps.ledger().prova(itemId, provaId) : null;
    if (!source) return json(404, { erro: 'nao-encontrada' });
    const headers = { ...BASE_HEADERS, 'Content-Type': source.mediaType, 'Content-Security-Policy': "sandbox; default-src 'none'" };
    if ('bytes' in source) return { status: 200, headers, body: source.bytes };
    if (!deps.provasRoot || !isInside(deps.provasRoot, source.filePath)) return json(404, { erro: 'nao-encontrada' });
    return { status: 200, headers, body: { filePath: source.filePath } };
  }

  return (request) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url, 'http://celular.invalid');
    } catch {
      return json(400, { erro: 'pedido-invalido' });
    }
    const path = parsed.pathname;
    const method = request.method.toUpperCase();

    if (!path.startsWith('/api/')) {
      const asset = method === 'GET' ? deps.assets[path === '/' ? '/index.html' : path] : undefined;
      if (!asset) return json(404, { erro: 'nao-encontrada' });
      const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': asset.contentType };
      if (asset.contentType.startsWith('text/html')) headers['Content-Security-Policy'] = PAGE_CSP;
      return { status: 200, headers, body: asset.body };
    }

    if (path === '/api/parear' && method === 'POST') {
      const input = parseJson(request.body);
      const paired = input ? deps.auth.pair(String(input.codigo ?? ''), String(input.aparelho ?? '')) : null;
      return paired ? json(200, { token: paired.token }) : json(403, { erro: 'codigo-invalido' });
    }

    if (!deps.auth.verify(bearer(request.authorization))) return json(401, { erro: 'nao-pareado' });

    if (path === '/api/fila' && method === 'GET') return json(200, { itens: deps.ledger().pendentes() });
    if (path === '/api/decidir' && method === 'POST') return decide(request.body);
    if (path === '/api/prova' && method === 'GET') return proof(parsed.searchParams);
    return json(404, { erro: 'nao-encontrada' });
  };
}

// ---------------------------------------------------------------------------
// Socket

export interface MobileServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Sobe o servidor em `host:port`. Lança se `host` não for um endereço Tailscale. */
export function startMobileServer(options: {
  readonly host: string;
  readonly port: number;
  readonly handler: (request: MobileRequest) => MobileResponse;
}): Promise<MobileServer> {
  const { host, port, handler } = options;
  if (!isTailscaleAddress(host)) return Promise.reject(new Error(`recusado: ${host} não é um endereço da Tailscale`));

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isTailscaleAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return;
      let response: MobileResponse;
      try {
        response = handler({
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      } catch (error) {
        console.error('[donel-dev] celular: erro no pedido:', error);
        res.writeHead(500, BASE_HEADERS).end();
        return;
      }
      const { body } = response;
      if (typeof body === 'string' || body instanceof Uint8Array) {
        res.writeHead(response.status, response.headers).end(body);
        return;
      }
      const stream = createReadStream(body.filePath);
      stream.once('open', () => {
        res.writeHead(response.status, response.headers);
        stream.pipe(res);
      });
      stream.once('error', () => {
        if (!res.headersSent) res.writeHead(404, BASE_HEADERS);
        res.end();
      });
    });
  };

  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer(onRequest);
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      server.on('error', (error) => console.error('[donel-dev] celular: erro no servidor:', error));
      resolvePromise({
        url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
