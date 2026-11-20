// Oráculo na VPS — the socket around `createOracleApiHandler`. Listens ONLY on the place's Tailscale address and
// refuses a connection that does not come from the tailnet (the same rule as the phone's server). Besides the API,
// `GET /v1/eventos` is a server-sent-events stream: a `ledger` event after writes, so the PC re-reads the ledger.
// t-e195b35c (the freeze of 18/11, 08h13–08h45): 107 writes in 38 min each made the PC download the whole ledger again;
// now at most one `ledger` every `LEDGER_EVENT_WINDOW_MS` (the first at once, the rest of the window as one at its end).

import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isTailscaleAddress } from '../main/celular/tailscale';
import { isBinaryRoute, MAX_JSON_BYTES, MAX_UPLOAD_BYTES, type OracleApiHandler, type OracleCaller } from './api';
import { GATE_PICTURE_PATH, GATE_TOOL_PATH, MAX_GATE_BODY_BYTES, MAX_GATE_PICTURE_BYTES } from './portoes';

export const ORACLE_PORT = 47816;
export const EVENTS_PATH = '/v1/eventos';
const HEARTBEAT_MS = 25_000;
export const LEDGER_EVENT_WINDOW_MS = 2_000;

/**
 * At most one `send` per `windowMs`: a fire after a quiet window goes at once; the fires inside a window become ONE
 * send at its end (never lost, never one per fire).
 */
export function createThrottle(send: () => void, windowMs: number, now: () => number = Date.now): { fire(): void; dispose(): void } {
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const go = (): void => {
    lastAt = now();
    send();
  };
  return {
    fire() {
      if (timer) return;
      const wait = lastAt + windowMs - now();
      if (wait <= 0) {
        go();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        go();
      }, wait);
      timer.unref?.();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface OracleServer {
  readonly url: string;
  /** Every open events stream hears it: `ledger` (re-read it) or `fila` (something for the PC to deliver). */
  notify(event: 'ledger' | 'fila'): void;
  close(): Promise<void>;
}

export function startOracleServer(options: { readonly host: string; readonly port: number; /** Who the token is: the PC or a service (the handler then says which routes); `null` = nobody. */ readonly caller: (authorization: string | undefined) => OracleCaller | null; readonly handler: OracleApiHandler }): Promise<OracleServer> {
  const { host, port, handler, caller } = options;
  if (!isTailscaleAddress(host)) return Promise.reject(new Error(`recusado: ${host} não é um endereço da Tailscale`));
  const streams = new Set<ServerResponse>();
  const broadcast = (event: 'ledger' | 'fila'): void => {
    for (const stream of streams) stream.write(`event: ${event}\ndata: {}\n\n`);
  };
  const ledgerEvents = createThrottle(() => broadcast('ledger'), LEDGER_EVENT_WINDOW_MS);

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isTailscaleAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    // The token before the body: a caller without it never gets to send 50 MB into memory.
    const who = caller(req.headers.authorization);
    if (!who) {
      res.writeHead(401).end();
      req.socket.destroy();
      return;
    }
    if (req.method === 'GET' && path === EVENTS_PATH) {
      // The PC's only (t-a1ea2798 review): a service would hear the rhythm of every write, and an open stream
      // would outlive the service's revocation.
      if (who.kind !== 'pc') {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      // On (re)connect the PC re-reads the ledger and drains the relay.
      res.write('event: ledger\ndata: {}\n\nevent: fila\ndata: {}\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    const isUpload = isBinaryRoute(req.method ?? 'GET', path);
    // A gate's tool call may carry the delivery's proof files (t-e195b35c); only a gate's credential gets this far.
    // t-d461e003: and its machine's picture (each board with its arrows).
    const gateMax = who.kind !== 'portao' ? null : path === GATE_TOOL_PATH ? MAX_GATE_BODY_BYTES : path === GATE_PICTURE_PATH ? MAX_GATE_PICTURE_BYTES : null;
    const maxBytes = isUpload ? MAX_UPLOAD_BYTES : (gateMax ?? MAX_JSON_BYTES);
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
        url: `http://${host.includes(':') ? `[${host}]` : host}:${(server.address() as AddressInfo).port}`,
        notify(event) {
          if (event === 'ledger') ledgerEvents.fire();
          else broadcast(event);
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            ledgerEvents.dispose();
            for (const stream of streams) stream.end();
            streams.clear();
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
