// Oráculo na VPS — the socket around `createOracleApiHandler`. Listens ONLY on the place's Tailscale address and
// refuses a connection that does not come from the tailnet (the same rule as the phone's server). Besides the API,
// `GET /v1/eventos` is a server-sent-events stream: one `ledger` event per write, so the PC re-reads the ledger.

import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isTailscaleAddress } from '../main/celular/tailscale';
import { isBinaryRoute, MAX_JSON_BYTES, MAX_UPLOAD_BYTES, type OracleApiHandler } from './api';

export const ORACLE_PORT = 47816;
export const EVENTS_PATH = '/v1/eventos';
const HEARTBEAT_MS = 25_000;

export interface OracleServer {
  readonly url: string;
  /** Every open events stream hears it: `ledger` (re-read it) or `fila` (something for the PC to deliver). */
  notify(event: 'ledger' | 'fila'): void;
  close(): Promise<void>;
}

export function startOracleServer(options: { readonly host: string; readonly port: number; /** The PC's or a service's token (the handler then says which routes). */ readonly authorized: (authorization: string | undefined) => boolean; readonly handler: OracleApiHandler }): Promise<OracleServer> {
  const { host, port, handler, authorized } = options;
  if (!isTailscaleAddress(host)) return Promise.reject(new Error(`recusado: ${host} não é um endereço da Tailscale`));
  const streams = new Set<ServerResponse>();

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isTailscaleAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    // The token before the body: a caller without it never gets to send 50 MB into memory.
    if (!authorized(req.headers.authorization)) {
      res.writeHead(401).end();
      req.socket.destroy();
      return;
    }
    if (req.method === 'GET' && path === EVENTS_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      // On (re)connect the PC re-reads the ledger and drains the relay.
      res.write('event: ledger\ndata: {}\n\nevent: fila\ndata: {}\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    const isUpload = isBinaryRoute(req.method ?? 'GET', path);
    const maxBytes = isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooBig = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (tooBig) return;
      const raw = Buffer.concat(chunks);
      try {
        const response = await handler({
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          authorization: req.headers.authorization,
          body: isUpload ? '' : raw.toString('utf8'),
          ...(isUpload ? { bytes: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) } : {}),
        });
        const { body } = response;
        if (typeof body === 'string') {
          res.writeHead(response.status, response.headers).end(body);
          return;
        }
        const stream = createReadStream(body.filePath);
        stream.once('open', () => {
          res.writeHead(response.status, response.headers);
          stream.pipe(res);
        });
        stream.once('error', () => {
          if (!res.headersSent) res.writeHead(404);
          res.end();
        });
      } catch (error) {
        console.error('[oraculo] erro no pedido:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
  };

  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer(onRequest);
    const heartbeat = setInterval(() => {
      for (const stream of streams) stream.write(': vivo\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref();
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      server.on('error', (error) => console.error('[oraculo] erro no servidor:', error));
      resolvePromise({
        url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
        notify(event) {
          for (const stream of streams) stream.write(`event: ${event}\ndata: {}\n\n`);
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            for (const stream of streams) stream.end();
            streams.clear();
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
