import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  MCP_ENDPOINT_PATH,
  checkMcpHttpRequest,
  handleMcpPayload,
  parseMcpBody,
  type BrowserToolCall,
  type BrowserToolOutcome,
} from '../../shared/browser/mcp';
import type { BoardToolCall } from '../../shared/mindscape/agent-tools';

// Navegador integrado — the app's local MCP server `donel` (docs/design/navegador-interno.md, D9).
//
// Streamable HTTP done by hand (no SDK, no new dependency): `127.0.0.1` on an ephemeral port, one POST per
// JSON-RPC message, answer `application/json`. Who may call and which browser a call drives is decided by
// `checkMcpHttpRequest` (shared/browser/mcp.ts): loopback Host, no Origin, bearer token of 128 bits per PTY.
// The protocol itself (initialize, tools/list, tools/call, ping) lives in `handleMcpPayload`.

const MAX_BODY_BYTES = 1024 * 1024;

export interface BrowserMcpServerDeps {
  /** Runs one validated tool call on the browser of `ptyId`. */
  execute(ptyId: string, call: BrowserToolCall): Promise<BrowserToolOutcome>;
  /** Quadro por MCP — runs one Mindscape tool for the tab of `ptyId`; absent = no board tools. */
  executeBoard?(ptyId: string, call: BoardToolCall): Promise<BrowserToolOutcome>;
  readonly serverVersion: string;
}

export interface BrowserMcpServer {
  /** `null` until `start()` resolves (or after it failed). */
  readonly port: number | null;
  start(): Promise<number>;
  /** A new 128-bit token for this PTY (replaces any previous one). */
  registerSession(ptyId: string, token?: string): string;
  unregisterSession(ptyId: string): void;
  stop(): Promise<void>;
}

function reply(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

export function createBrowserMcpServer(deps: BrowserMcpServerDeps): BrowserMcpServer {
  const ptyByToken = new Map<string, string>();
  const tokenByPty = new Map<string, string>();
  let server: Server | null = null;
  let port: number | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (port === null) return reply(res, 503, 'Not ready');
    const gate = checkMcpHttpRequest({ method: req.method ?? '', url: req.url ?? '', headers: req.headers }, port, (token) => ptyByToken.get(token) ?? null);
    if (!gate.ok) {
      // Drain whatever was sent so the socket can be reused, then refuse.
      req.resume();
      return reply(res, gate.status, gate.message, gate.headers ? { ...gate.headers } : {});
    }
    const body = await readBody(req);
    if (body === null) return reply(res, 413, 'Payload too large');
    const parsed = parseMcpBody(body);
    const answer = parsed.ok
      ? await handleMcpPayload(parsed.payload, {
          executor: (call) => deps.execute(gate.ptyId, call),
          ...(deps.executeBoard ? { boardExecutor: (call: BoardToolCall) => deps.executeBoard!(gate.ptyId, call) } : {}),
          serverVersion: deps.serverVersion,
        })
      : parsed.response;
    if (answer === null) {
      res.writeHead(202, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(answer));
  };

  return {
    get port() {
      return port;
    },
    start: () =>
      new Promise<number>((resolve, reject) => {
        if (server && port !== null) {
          resolve(port);
          return;
        }
        const created = createServer((req, res) => {
          handle(req, res).catch(() => reply(res, 500, 'Internal error'));
        });
        // A tool call may legitimately take long (`navegador_pedir_humano` waits up to 30 min for the owner).
        created.requestTimeout = 0;
        created.on('error', reject);
        created.listen(0, '127.0.0.1', () => {
          server = created;
          port = (created.address() as AddressInfo).port;
          resolve(port);
        });
      }),
    registerSession: (ptyId, knownToken) => {
      const previous = tokenByPty.get(ptyId);
      if (previous) ptyByToken.delete(previous);
      const token = knownToken ?? randomBytes(16).toString('hex');
      ptyByToken.set(token, ptyId);
      tokenByPty.set(ptyId, token);
      return token;
    },
    unregisterSession: (ptyId) => {
      const token = tokenByPty.get(ptyId);
      if (token) ptyByToken.delete(token);
      tokenByPty.delete(ptyId);
    },
    stop: () =>
      new Promise<void>((resolve) => {
        ptyByToken.clear();
        tokenByPty.clear();
        const current = server;
        server = null;
        port = null;
        if (!current) {
          resolve();
          return;
        }
        current.closeAllConnections?.();
        current.close(() => resolve());
      }),
  };
}

/** The URL the agent CLI is pointed at. */
export function browserMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`;
}
