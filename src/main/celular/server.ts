// Ledger no celular — o servidor HTTP da PWA. Ouve SÓ no endereço Tailscale do PC (recusa subir em qualquer
// outro, inclusive 0.0.0.0 e 127.0.0.1) e recusa conexão que não venha da Tailscale. Tudo em /api exige o
// token de sessão do celular, menos o pareamento (que exige o código de uso único). Os arquivos da PWA não
// têm dado nenhum e saem sem token.
//
// O `createMobileHandler` é puro (pedido → resposta) para o teste não precisar de rede; o `startMobileServer`
// só põe o socket em volta.

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import type { DecisaoCelular } from '../../shared/celular';
import { HTML_MEDIA_TYPE, isRequestId } from '../../shared/ledger/contract';
import type { CelularAuth } from './auth';
import type { MobileLedgerPort } from './ledger-port';
import { MAX_PEDIDO_CHARS, type MobilePedidosPort } from './pedidos';
import { isAudioId, MAX_AUDIO_BYTES } from './transcrever';
import { isTailscaleAddress } from './tailscale';

export const MOBILE_PORT = 47815;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MOTIVO = 2000;
const MAX_OPCAO = 80;

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
  /** Só no envio do áudio do pedido (`POST /api/pedidos/audio`): o corpo cru. */
  readonly bytes?: Uint8Array;
}

/** O único caminho que recebe corpo binário (e maior que 64 KB). */
export const AUDIO_PATH = '/api/pedidos/audio';

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
  /** Relógio dos bilhetes do protótipo (o teste avança). */
  readonly now?: () => number;
  /** Aviso no celular (Web Push). Ausente = sem avisos. */
  readonly push?: {
    /** A chave pública VAPID (base64url) que o celular passa ao se inscrever. */
    publicKey(): string;
    /** Guarda a inscrição deste aparelho; `false` = inscrição inválida (endereço fora dos serviços de push). */
    subscribe(deviceId: string, subscription: unknown): boolean;
  };
  /** Pedir pelo Oráculo (pedido solto ao Líder único). Ausente = sem o botão Pedir. */
  readonly pedidos?: MobilePedidosPort;
}

/** Bilhete do protótipo: uso único, preso a um item e uma prova, vence em 60 s. */
export const TICKET_TTL_MS = 60_000;

/**
 * O protótipo (HTML do agente) roda isolado: `sandbox allow-scripts` SEM `allow-same-origin` (origem opaca: não lê
 * o token do celular nem chama a API), sem rede, sem nada de fora, sem formulário, sem navegar a página de cima.
 */
export const PROTOTYPE_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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

/** Quase tudo responde na hora; escrever na carta espera a entrega da mensagem (a sessão dona ou o Líder). */
export type MobileHandler = (request: MobileRequest) => MobileResponse | Promise<MobileResponse>;

export function createMobileHandler(deps: MobileHandlerDeps): MobileHandler {
  const now = deps.now ?? Date.now;
  const tickets = new Map<string, { readonly itemId: string; readonly provaId: string; readonly expiresAt: number }>();

  /** O protótipo como arquivo dentro das provas, ou `null`. */
  function prototypeFile(itemId: string, provaId: string): string | null {
    const source = itemId && provaId ? deps.ledger().prova(itemId, provaId) : null;
    if (!source || 'bytes' in source || source.mediaType !== HTML_MEDIA_TYPE) return null;
    return deps.provasRoot && isInside(deps.provasRoot, source.filePath) ? source.filePath : null;
  }

  function ticket(query: URLSearchParams): MobileResponse {
    const itemId = query.get('item') ?? '';
    const provaId = query.get('prova') ?? '';
    if (!prototypeFile(itemId, provaId)) return json(404, { erro: 'nao-encontrada' });
    const at = now();
    for (const [key, value] of tickets) if (value.expiresAt <= at) tickets.delete(key);
    const bilhete = randomBytes(24).toString('base64url');
    tickets.set(bilhete, { itemId, provaId, expiresAt: at + TICKET_TTL_MS });
    return json(200, { bilhete });
  }

  /** O iframe não manda o token: o bilhete (de uso único) é a autorização. Usado ou vencido = 404. */
  function prototype(query: URLSearchParams): MobileResponse {
    const bilhete = query.get('b') ?? '';
    const entry = tickets.get(bilhete);
    tickets.delete(bilhete);
    const filePath = entry && entry.expiresAt > now() ? prototypeFile(entry.itemId, entry.provaId) : null;
    if (!filePath) return json(404, { erro: 'nao-encontrada' });
    return {
      status: 200,
      // O mesmo cabeçalho base, menos o X-Frame-Options DENY: este documento existe para ir dentro da carta.
      headers: { ...BASE_HEADERS, 'X-Frame-Options': 'SAMEORIGIN', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PROTOTYPE_CSP },
      body: { filePath },
    };
  }

  function decide(body: string): MobileResponse {
    const input = parseJson(body);
    if (!input) return json(400, { erro: 'pedido-invalido' });
    const { pedidoId, itemId, decisao, motivo, opcao, texto } = input;
    // O pedidoId vai gravado com a decisão no ledger: um reenvio (a rede caiu, o app reiniciou) recebe a mesma
    // resposta sem gravar de novo. Recusa não fica guardada: uma falha passageira pode dar certo no reenvio.
    if (!isRequestId(pedidoId)) return json(400, { erro: 'pedido-invalido' });
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 200) return json(400, { erro: 'pedido-invalido' });
    if (decisao !== 'aceitar' && decisao !== 'rejeitar') return json(400, { erro: 'pedido-invalido' });
    if (opcao !== undefined && (typeof opcao !== 'string' || opcao.trim().length === 0 || opcao.length > MAX_OPCAO)) return json(400, { erro: 'pedido-invalido' });
    const reason = typeof motivo === 'string' ? motivo.trim().slice(0, MAX_MOTIVO) : '';
    // Uma opção que fecha como rejeitada já é o motivo (o ledger confere que ela existe e fecha assim).
    if (decisao === 'rejeitar' && reason.length === 0 && opcao === undefined) return json(400, { erro: 'motivo-obrigatorio' });
    const outcome = deps.ledger().decidir({
      pedidoId,
      itemId,
      decisao: decisao as DecisaoCelular,
      motivo: decisao === 'rejeitar' ? reason : null,
      ...(typeof opcao === 'string' ? { opcao } : {}),
      ...(typeof texto === 'string' && texto.trim() ? { texto: texto.trim().slice(0, MAX_MOTIVO) } : {}),
    });
    return outcome.ok
      ? json(200, { ok: true, estado: outcome.estado })
      : json(outcome.reason === 'nao-encontrada' ? 404 : 409, { erro: outcome.reason, mensagem: outcome.message });
  }

  async function comment(body: string): Promise<MobileResponse> {
    const input = parseJson(body);
    if (!input) return json(400, { erro: 'pedido-invalido' });
    const { pedidoId, itemId, texto } = input;
    // O pedidoId vai gravado com o que o dono escreveu: um reenvio responde o mesmo recibo, sem mandar de novo.
    if (!isRequestId(pedidoId)) return json(400, { erro: 'pedido-invalido' });
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 200) return json(400, { erro: 'pedido-invalido' });
    if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_MOTIVO) return json(400, { erro: 'texto-obrigatorio' });
    const outcome = await deps.ledger().comentar({ pedidoId, itemId, texto });
    return outcome.ok ? json(200, { ok: true, recibo: outcome.recibo }) : json(409, { erro: 'recusada', mensagem: outcome.mensagem });
  }

  function createPedido(pedidos: MobilePedidosPort, body: string): MobileResponse {
    const input = parseJson(body);
    if (!input) return json(400, { erro: 'pedido-invalido' });
    const { pedidoId, texto, audioId } = input;
    // O pedidoId é do celular: um reenvio (a rede caiu) recebe o mesmo pedido, sem entrar duas vezes na fila.
    if (!isRequestId(pedidoId)) return json(400, { erro: 'pedido-invalido' });
    if (typeof texto !== 'string' || !texto.trim()) return json(400, { erro: 'texto-obrigatorio' });
    if (texto.length > MAX_PEDIDO_CHARS) return json(400, { erro: 'texto-longo', mensagem: `Até ${MAX_PEDIDO_CHARS} caracteres.` });
    if (audioId !== undefined && !isAudioId(audioId)) return json(400, { erro: 'pedido-invalido' });
    const outcome = pedidos.criar({ pedidoId, texto, ...(typeof audioId === 'string' ? { audioId } : {}) });
    return outcome.ok ? json(200, { ok: true, pedido: outcome.pedido }) : json(409, { erro: 'recusado', mensagem: outcome.mensagem });
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

    if (path === '/api/prova-html' && method === 'GET') return prototype(parsed.searchParams);

    if (path === '/api/parear' && method === 'POST') {
      const input = parseJson(request.body);
      const paired = input ? deps.auth.pair(String(input.codigo ?? ''), String(input.aparelho ?? '')) : null;
      return paired ? json(200, { token: paired.token }) : json(403, { erro: 'codigo-invalido' });
    }

    const device = deps.auth.verify(bearer(request.authorization));
    if (!device) return json(401, { erro: 'nao-pareado' });

    if (path === '/api/avisos/chave' && method === 'GET') return deps.push ? json(200, { chave: deps.push.publicKey() }) : json(404, { erro: 'sem-avisos' });
    if (path === '/api/avisos/inscrever' && method === 'POST') {
      if (!deps.push) return json(404, { erro: 'sem-avisos' });
      const input = parseJson(request.body);
      const keys = input && typeof input.keys === 'object' && input.keys !== null ? (input.keys as Record<string, unknown>) : {};
      return deps.push.subscribe(device.id, { endpoint: input?.endpoint, p256dh: keys.p256dh, auth: keys.auth }) ? json(200, { ok: true }) : json(400, { erro: 'inscricao-invalida' });
    }

    if (path === '/api/fila' && method === 'GET') return json(200, { itens: deps.ledger().pendentes() });
    if (path === '/api/decidir' && method === 'POST') return decide(request.body);
    if (path === '/api/comentar' && method === 'POST') return comment(request.body);
    if (path === '/api/prova' && method === 'GET') return proof(parsed.searchParams);
    if (path === '/api/prova-bilhete' && method === 'GET') return ticket(parsed.searchParams);

    const pedidos = deps.pedidos;
    if (pedidos && path === '/api/pedidos' && method === 'GET') return json(200, { itens: pedidos.listar() });
    if (pedidos && path === '/api/pedidos' && method === 'POST') return createPedido(pedidos, request.body);
    if (pedidos && path === AUDIO_PATH && method === 'POST') {
      const started = pedidos.transcrever(request.bytes ?? new Uint8Array());
      return started.ok ? json(200, { audioId: started.audioId }) : json(400, { erro: 'audio-invalido', mensagem: started.mensagem });
    }
    if (pedidos && path === AUDIO_PATH && method === 'GET') {
      const audioId = parsed.searchParams.get('id') ?? '';
      const status = isAudioId(audioId) ? pedidos.transcricao(audioId) : null;
      return status ? json(200, status) : json(404, { erro: 'nao-encontrada' });
    }
    return json(404, { erro: 'nao-encontrada' });
  };
}

// ---------------------------------------------------------------------------
// Socket

export interface MobileServer {
  readonly url: string;
  close(): Promise<void>;
}

/** O `tailscale serve` deste PC: no Windows ele só alcança o 127.0.0.1, nunca o IP Tailscale do próprio PC. */
export const SERVE_PROXY_HOST = '127.0.0.1';

/**
 * Quem pode falar com o servidor: um aparelho da tailnet direto, ou o `tailscale serve` (no 127.0.0.1)
 * repassando um aparelho da tailnet. O serve carimba quem é (`Tailscale-User-Login`) e de onde veio
 * (`X-Forwarded-For`). Um programa deste PC poderia forjar os dois, mas ainda esbarra no token do pareamento,
 * como qualquer aparelho da tailnet.
 */
export function fromTailnet(remoteAddress: string | undefined, headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (isTailscaleAddress(remoteAddress)) return true;
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::ffff:127.0.0.1') return false;
  const forwarded = headers['x-forwarded-for'];
  const login = headers['tailscale-user-login'];
  return typeof forwarded === 'string' && isTailscaleAddress(forwarded.split(',')[0]) && typeof login === 'string' && login !== '';
}

/**
 * Sobe o servidor em `host:port` e, na mesma porta, em 127.0.0.1 para o `tailscale serve` (o endereço https).
 * Lança se `host` não for um endereço Tailscale.
 */
export function startMobileServer(options: {
  readonly host: string;
  readonly port: number;
  readonly handler: MobileHandler;
}): Promise<MobileServer> {
  const { host, port, handler } = options;
  if (!isTailscaleAddress(host)) return Promise.reject(new Error(`recusado: ${host} não é um endereço da Tailscale`));

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!fromTailnet(req.socket.remoteAddress, req.headers)) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const isAudio = req.method === 'POST' && (req.url ?? '').split('?')[0] === AUDIO_PATH;
    const maxBytes = isAudio ? MAX_AUDIO_BYTES : MAX_BODY_BYTES;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooBig = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (tooBig) return;
      let response: MobileResponse;
      const raw = Buffer.concat(chunks);
      try {
        response = await handler({
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          authorization: req.headers.authorization,
          body: isAudio ? '' : raw.toString('utf8'),
          ...(isAudio ? { bytes: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) } : {}),
        });
      } catch (error) {
        console.error('[donel-dev] celular: erro no pedido:', error);
        if (!res.headersSent) res.writeHead(500, BASE_HEADERS);
        res.end();
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

  const listen = (address: string): Promise<Server> =>
    new Promise((resolveListen, reject) => {
      const server: Server = createServer(onRequest);
      server.once('error', reject);
      server.listen(port, address, () => {
        server.off('error', reject);
        server.on('error', (error) => console.error('[donel-dev] celular: erro no servidor:', error));
        resolveListen(server);
      });
    });
  const closeServer = (server: Server): Promise<void> =>
    new Promise<void>((done) => {
      server.closeAllConnections?.();
      server.close(() => done());
    });

  return listen(host).then(async (server) => {
    const actualPort = (server.address() as { port: number }).port;
    // Sem o 127.0.0.1 (porta ocupada), o celular ainda alcança o PC pelo http; só o https fica sem caminho.
    const proxy = await new Promise<Server | null>((done) => {
      const extra: Server = createServer(onRequest);
      extra.once('error', (error) => {
        console.error('[donel-dev] celular: o 127.0.0.1 do tailscale serve não subiu:', error);
        done(null);
      });
      extra.listen(actualPort, SERVE_PROXY_HOST, () => done(extra));
    });
    return {
      url: `http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`,
      close: async () => {
        await Promise.all([closeServer(server), proxy ? closeServer(proxy) : Promise.resolve()]);
      },
    };
  });
}
