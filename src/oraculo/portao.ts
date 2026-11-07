// Oráculo na VPS (docs/planos/oraculo-na-vps.md, fatia 4) — the MCP gate of the VPS's sessions. A session prepared
// after the daemon was installed calls `http://127.0.0.1:<gate>/s/<sid>/mcp` instead of its reverse tunnel. The gate:
//
// - checks the session's own token (`~/.donel/s/<sid>/meta.json`, `mcpToken`), loopback only;
// - with the PC on (the tunnel answers), passes the call on as it came: the app answers as today;
// - with the PC off (nothing listens on the tunnel), answers itself with the same tool list: `sessao_quem_sou` and
//   `sessao_listar` from the last picture of the board the PC left (the board lives on the PC and does not change
//   while it is off), and the `tarefa_*` tools on this daemon's ledger, as that place. A proof file is read here, on
//   the VPS. Every other tool says the PC is off.

import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { handleMcpPayload, parseMcpBody, type BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { MindscapeBoard } from '../shared/mindscape/model';
import type { LedgerToolCall } from '../shared/ledger/tools';
import { askedByRefusal } from '../shared/ledger/tools';
import { runLedgerTool, type LedgerCaller, type LedgerService } from '../main/ledger-store';

export const GATE_PORT = 47817;
const MAX_BODY_BYTES = 1024 * 1024;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const FORWARD_TIMEOUT_MS = 10 * 60_000;

/** One VPS session as the PC last saw it on its board. */
export interface PictureSession {
  /** The answer of `sessao_quem_sou` (lugar, papel, pasta…). */
  readonly quemSou: Record<string, unknown>;
  /** The answer of `sessao_listar`. */
  readonly listar: readonly unknown[];
  /** The board as saved (who opened whom), for the reach rules of the ledger. */
  readonly board?: MindscapeBoard;
}

/** What the PC pushes (`POST /v1/retrato`): every VPS session it has open. */
export interface BoardPicture {
  readonly at: number;
  readonly sessoes: Readonly<Record<string, PictureSession>>;
}

/**
 * The PC's new picture over the last one: a session the PC could not read this round keeps its last picture, and a
 * session whose folder is gone (`~/.donel/s/<folder>`, closed) leaves it, so the file does not grow forever.
 */
export function mergePicture(previous: BoardPicture | null, next: BoardPicture, folderExists: (folder: string) => boolean): BoardPicture {
  const sessoes = Object.fromEntries(Object.entries({ ...(previous?.sessoes ?? {}), ...next.sessoes }).filter(([folder]) => folderExists(folder)));
  return { at: next.at, sessoes };
}

export interface GateRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string;
  /** The MCP headers to pass on (lowercase). */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GateResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Passes a call to the session's tunnel; `'desligado'` = nothing answered there (the PC is off). */
export type GateForward = (port: number, request: GateRequest) => Promise<GateResponse | 'desligado'>;

export interface GateDeps {
  /** `~/.donel/s`. */
  readonly sessionsDir: string;
  readonly ledger: () => LedgerService;
  readonly picture: () => BoardPicture | null;
  readonly forward: GateForward;
  readonly serverVersion: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;
const PC_OFF = 'O PC está desligado: esta ferramenta volta quando ele ligar. Com o PC desligado, esta sessão tem sessao_quem_sou, sessao_listar e as tarefa_* do Oráculo.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readMeta(sessionsDir: string, sid: string): { mcpToken: string; mcpPort: number } | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
    if (!isRecord(raw) || typeof raw.mcpToken !== 'string' || !raw.mcpToken || typeof raw.mcpPort !== 'number') return null;
    return { mcpToken: raw.mcpToken, mcpPort: raw.mcpPort };
  } catch {
    return null;
  }
}

function placeStatesOf(places: readonly unknown[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const place of places) if (isRecord(place) && typeof place.id === 'string') states.set(place.id, typeof place.estado === 'string' ? place.estado : '');
  return states;
}

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export function createGateHandler(deps: GateDeps): (request: GateRequest) => Promise<GateResponse> {
  async function local(sid: string, body: string): Promise<GateResponse> {
    const parsed = parseMcpBody(body);
    if (!parsed.ok) return { status: 400, headers: JSON_HEADERS, body: JSON.stringify(parsed.response) };
    const picture = deps.picture();
    const mine = picture?.sessoes[sid] ?? null;
    const noPicture = 'Sem retrato do quadro desta sessão: o PC não mandou um desde que ela abriu, e com ele desligado não sei quem ela é. Tente quando o PC ligar.';
    const offline = picture ? `desligado; quadro de ${hhmm(picture.at)}` : 'desligado';

    const board = async (call: BoardToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: noPicture };
      if (call.tool === 'sessao_quem_sou') return { kind: 'text', text: JSON.stringify({ ...mine.quemSou, pc: offline }, null, 1) };
      if (call.tool === 'sessao_listar' && !call.quadro) return { kind: 'text', text: JSON.stringify(mine.listar, null, 1) };
      return { kind: 'error', text: PC_OFF };
    };

    const ledger = async (call: LedgerToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: noPicture };
      const who = mine.quemSou;
      if (who.liderUnico === true) return { kind: 'error', text: 'O Líder único decide pelos quadros do PC; com o PC desligado, as tarefas dele esperam.' };
      if ((call.tool === 'tarefa_criar' || call.tool === 'tarefa_listar') && call.quadro) return { kind: 'error', text: 'Só o Líder único escolhe o quadro. Esta sessão usa sempre o próprio quadro (chame sem "quadro").' };
      if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string') return { kind: 'error', text: noPicture };
      const refused = call.tool === 'tarefa_criar' && call.quemPediu ? askedByRefusal(call.quemPediu) : null;
      if (refused) return { kind: 'error', text: refused };
      const ids = mine.listar.map((place) => (isRecord(place) ? place.id : null)).filter((id): id is string => typeof id === 'string');
      const caller: LedgerCaller = {
        projectPath: who.pasta,
        placeId: who.lugar,
        ...(typeof who.papel === 'string' ? { roleId: who.papel } : {}),
        boardPlaceIds: ids,
        placeStates: new Map([[who.pasta, placeStatesOf(mine.listar)]]),
        ...(mine.board ? { board: mine.board } : {}),
      };
      // No `remote`: the proof files named by a VPS session are here, on this machine.
      const result = await runLedgerTool(deps.ledger(), caller, call);
      if (!result.ok) return { kind: 'error', text: result.text };
      return result.image ? { kind: 'image', base64: result.image.base64, mimeType: result.image.mimeType, text: result.text } : { kind: 'text', text: result.text };
    };

    const answer = await handleMcpPayload(parsed.payload, {
      executor: async () => ({ kind: 'error', text: PC_OFF }),
      boardExecutor: board,
      ledgerExecutor: ledger,
      openCap: () => null,
      serverVersion: deps.serverVersion,
    });
    return answer === null ? { status: 202, headers: {}, body: '' } : { status: 200, headers: JSON_HEADERS, body: JSON.stringify(answer) };
  }

  return async (request) => {
    const match = /^\/s\/([^/]+)\/mcp$/.exec(request.path);
    if (!match || !SID_PATTERN.test(match[1]!)) return { status: 404, headers: {}, body: '' };
    const sid = match[1]!;
    const meta = readMeta(deps.sessionsDir, sid);
    const bearer = request.authorization?.startsWith('Bearer ') ? request.authorization.slice('Bearer '.length) : '';
    if (!meta || !bearer || !sameToken(bearer, meta.mcpToken)) return { status: 401, headers: {}, body: '' };
    const forwarded = await deps.forward(meta.mcpPort, request);
    if (forwarded !== 'desligado') return forwarded;
    if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, body: '' };
    return local(sid, request.body);
  };
}

/** The real forward: the session's reverse tunnel on this machine (`127.0.0.1:<mcpPort>/mcp`), as its CLI would call. */
export const tunnelForward: GateForward = (port, request) =>
  new Promise((resolve) => {
    let answered = false;
    const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
    for (const [name, value] of Object.entries(request.headers)) headers[name] = value;
    if (request.authorization) headers.Authorization = request.authorization;
    if (request.body) headers['Content-Length'] = String(Buffer.byteLength(request.body));
    const outgoing = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: request.method, headers, timeout: FORWARD_TIMEOUT_MS }, (res) => {
      answered = true;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const passOn: Record<string, string> = {};
        for (const name of ['content-type', 'mcp-session-id', 'cache-control', 'allow']) {
          const value = res.headers[name];
          if (typeof value === 'string') passOn[name] = value;
        }
        resolve({ status: res.statusCode ?? 502, headers: passOn, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', () => resolve({ status: 502, headers: {}, body: '' }));
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
    // Only "nobody listens on the tunnel" (ECONNREFUSED: nothing was sent) is the PC off. Any other failure (a reset
    // after the call went out, a timeout, a pipe broken mid-answer) is a 502: the call may have run on the PC, and
    // running it again here would make a task or a delivery twice (revisão do #302).
    outgoing.on('error', (error: NodeJS.ErrnoException) => resolve(!answered && error.code === 'ECONNREFUSED' ? 'desligado' : { status: 502, headers: {}, body: '' }));
    outgoing.end(request.body);
  });

const PASS_HEADERS = ['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];

export function startGateServer(options: { readonly port: number; readonly handler: (request: GateRequest) => Promise<GateResponse> }): Promise<{ readonly port: number; close(): Promise<void> }> {
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const remote = req.socket.remoteAddress ?? '';
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (tooBig) return;
      const headers: Record<string, string> = {};
      for (const name of PASS_HEADERS) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      try {
        const answer = await options.handler({
          method: req.method ?? 'GET',
          path: (req.url ?? '/').split('?')[0] ?? '/',
          authorization: req.headers.authorization,
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(answer.status, answer.headers).end(answer.body);
      } catch (error) {
        console.error('[oraculo] portão: erro no pedido:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
  };
  return new Promise((resolve, reject) => {
    const server: Server = createServer(onRequest);
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        port: options.port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
