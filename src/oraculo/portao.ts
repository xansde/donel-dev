// Oráculo na VPS (docs/planos/oraculo-na-vps.md, fatia 4) — the MCP gate of the VPS's sessions. A session prepared
// after the daemon was installed calls `http://127.0.0.1:<gate>/s/<sid>/mcp` instead of its reverse tunnel. The gate:
//
// - checks the session's own token (`~/.donel/s/<sid>/meta.json`, `mcpToken`), loopback only;
// - with the PC on (the tunnel answers), passes the call on as it came: the app answers as today;
// - with the PC off (nothing listens on the tunnel), answers itself with the same tool list: `sessao_quem_sou` and
//   `sessao_listar` from the last picture of the board the PC left (the board lives on the PC and does not change
//   while it is off), and the `tarefa_*` tools on this daemon's ledger, as that place. A proof file is read here, on
//   the VPS. Every other tool says the PC is off.
// - quadro de tarefas (t-1e354d15): when the board is configured, the `card_*` tools are answered HERE, PC on or off
//   (the board lives in the owner's Supabase, not on the PC), and the PC's tool list gets them appended.
//
// Canal do Donel fora do PC (t-e195b35c, docs/planos/canal-fora-do-pc.md; the freeze of 18/11, 08h13-08h45, when the
// PC's app froze with the tunnel alive and every VPS session hung on it):
// - with the session's picture, every `tarefa_*` is answered HERE, PC on or off: the ledger is this daemon's, the PC
//   only relayed it (and froze). The PC's tool list gets this gate's `tarefa_*` definitions (the key, the reason).
// - `sessao_enviar` goes to the recados queue (`GateRecados`) when there is one; a target off this machine goes on.
// - the tunnel must connect within `CONNECT_MS` (else: the PC is off, nothing was sent); what can be answered here
//   without harm (initialize, the tool list, ping, notifications, `sessao_quem_sou`, `sessao_listar`) is answered here
//   when the PC is silent for `LOCAL_ANSWER_MS`. Any other tool waits for the PC as before; a 502 stays a 502.
// - `POST /recados/<evento>`: the VPS's user-level hooks, loopback only, no MCP token.

import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { join } from 'node:path';
import { handleMcpPayload, parseMcpBody, type BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { MindscapeBoard } from '../shared/mindscape/model';
import type { LedgerToolCall } from '../shared/ledger/tools';
import { askedByRefusal, isLedgerToolName, LEDGER_TOOLS } from '../shared/ledger/tools';
import { runLedgerTool, type LedgerCaller, type LedgerService, type LedgerToolAnswer } from '../main/ledger-store';
import { CARD_TOOLS, isCardToolName, type CardToolCall } from '../shared/board/tools';
import { isBoardOrchestrator } from '../shared/mindscape/reach';
import type { BoardStore } from './board-client';
import { runCardTool } from './board-tools';
import type { GateRecados } from './gate-recados';

export const GATE_PORT = 47817;
const MAX_BODY_BYTES = 1024 * 1024;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const FORWARD_TIMEOUT_MS = 10 * 60_000;
/** The tunnel's TCP connection must complete within this; else the PC is off (nothing was sent). */
export const CONNECT_MS = 2_000;
/** How long a call that can be answered here without harm waits for the PC before it is. */
export const LOCAL_ANSWER_MS = 3_000;
const HOOK_PATH = /^\/recados\/([a-z-]{1,40})$/;

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
  /** The task board's client; absent or null = no `card_*` tools (the board is off). */
  readonly cards?: () => BoardStore | null;
  readonly now?: () => number;
  /** The recados queue (`sessao_enviar` here, the notices after a task, the hooks' route); absent = none. */
  readonly recados?: GateRecados;
  /** Runs a `tarefa_*` as `caller`; default: `runLedgerTool` on this daemon's ledger. */
  readonly runLedger?: (caller: LedgerCaller, call: LedgerToolCall) => Promise<LedgerToolAnswer>;
  readonly timeouts?: { readonly localAnswerMs?: number };
  readonly log?: (line: string) => void;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;
const PC_OFF = 'O PC está desligado: esta ferramenta volta quando ele ligar. Com o PC desligado, esta sessão tem sessao_quem_sou, sessao_listar e as tarefa_* do Oráculo.';
const NO_PICTURE = 'Sem retrato do quadro desta sessão: o PC não mandou um desde que ela abriu, e com ele desligado não sei quem ela é. Tente quando o PC ligar.';
const LEADER_OF_ALL_WAITS = 'O Líder único decide pelos quadros do PC; com o PC desligado, as tarefas dele esperam.';
const BAD_GATEWAY: GateResponse = { status: 502, headers: {}, body: '' };

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

/** The one JSON-RPC message of a body, when it is a single one (the CLI never batches). */
function singleMessage(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The tool a single `tools/call` message names, with its arguments. */
function toolCallOf(message: Record<string, unknown> | null): { readonly name: string; readonly args: Record<string, unknown> } | null {
  if (message?.method !== 'tools/call' || !isRecord(message.params) || typeof message.params.name !== 'string') return null;
  return { name: message.params.name, args: isRecord(message.params.arguments) ? message.params.arguments : {} };
}

/**
 * The PC's answer to `tools/list` as this gate serves it: the `tarefa_*` definitions are this gate's (it answers them,
 * with fields an older app does not know), and the board's tools appended (the PC does not know them).
 */
export function withGateTools(requestBody: string, answer: GateResponse, withCards: boolean): GateResponse {
  if (answer.status !== 200 || singleMessage(requestBody)?.method !== 'tools/list') return answer;
  const parsed = singleMessage(answer.body);
  const result = parsed && isRecord(parsed.result) ? parsed.result : null;
  if (!parsed || !result || !Array.isArray(result.tools)) return answer;
  const ledgerTools = new Map<string, unknown>(LEDGER_TOOLS.map((tool) => [tool.name, tool]));
  const served: unknown[] = result.tools.map((tool: unknown) => (isRecord(tool) && typeof tool.name === 'string' && ledgerTools.has(tool.name) ? ledgerTools.get(tool.name) : tool));
  const names = new Set(served.map((tool) => (isRecord(tool) ? tool.name : null)));
  const tools = withCards ? [...served, ...CARD_TOOLS.filter((tool) => !names.has(tool.name))] : served;
  return { ...answer, body: JSON.stringify({ ...parsed, result: { ...result, tools } }) };
}

/**
 * Who the session is for the ledger, from its picture; a string = why not (the Líder único decides on the PC, or the
 * picture does not say the place).
 */
export function callerFromPicture(mine: PictureSession): LedgerCaller | string {
  const who = mine.quemSou;
  if (who.liderUnico === true) return LEADER_OF_ALL_WAITS;
  if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string') return NO_PICTURE;
  const pasta = who.pasta;
  const ids = mine.listar.map((place) => (isRecord(place) ? place.id : null)).filter((id): id is string => typeof id === 'string');
  return {
    projectPath: pasta,
    placeId: who.lugar,
    ...(typeof who.papel === 'string' ? { roleId: who.papel } : {}),
    boardPlaceIds: ids,
    placeStates: new Map([[pasta, placeStatesOf(mine.listar)]]),
    ...(mine.board ? { board: mine.board } : {}),
    sessionOf: (projectPath, placeId) => {
      const card = projectPath === pasta ? mine.board?.cards[placeId] : undefined;
      return card?.kind === 'session' ? card.sessionId : undefined;
    },
  };
}

/** A call that may be answered here when the PC is silent: it only reads, or it is the handshake. */
function answersWithoutPc(message: Record<string, unknown>, mine: PictureSession | null): boolean {
  const method = message.method;
  if (method === 'initialize' || method === 'ping' || method === 'tools/list' || (typeof method === 'string' && method.startsWith('notifications/'))) return true;
  const call = toolCallOf(message);
  if (!call || !mine) return false;
  return call.name === 'sessao_quem_sou' || (call.name === 'sessao_listar' && call.args.quadro === undefined);
}

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** How the PC is for a call answered here: off (nothing listens), silent (it did not answer in time), or on. */
type PcState = 'desligado' | 'sem-resposta' | 'ligado';

export function createGateHandler(deps: GateDeps): (request: GateRequest) => Promise<GateResponse> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const runLedger = deps.runLedger ?? ((caller: LedgerCaller, call: LedgerToolCall) => runLedgerTool(deps.ledger(), caller, call));
  const localAnswerMs = deps.timeouts?.localAnswerMs ?? LOCAL_ANSWER_MS;

  /** Answers the call here. `passOn`: the recados queue said the target is not on this machine (`useRecados`). */
  async function local(sid: string, body: string, cards: BoardStore | null, pc: PcState, useRecados = false): Promise<{ readonly response: GateResponse; readonly passOn: boolean }> {
    const parsed = parseMcpBody(body);
    if (!parsed.ok) return { response: { status: 400, headers: JSON_HEADERS, body: JSON.stringify(parsed.response) }, passOn: false };
    const picture = deps.picture();
    const mine = picture?.sessoes[sid] ?? null;
    const label = pc === 'sem-resposta' ? `não respondeu em ${Math.round(localAnswerMs / 1000)} s` : pc;
    const pcNow = picture ? `${label}; quadro de ${hhmm(picture.at)}` : label;
    let passOn = false;

    const board = async (call: BoardToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: NO_PICTURE };
      if (call.tool === 'sessao_enviar' && useRecados && deps.recados) {
        const sent = await deps.recados.enviar(sid, mine, call);
        if (sent !== 'repassar') return sent;
        passOn = true;
        return { kind: 'error', text: PC_OFF };
      }
      if (call.tool === 'sessao_quem_sou') return { kind: 'text', text: JSON.stringify({ ...mine.quemSou, pc: pcNow }, null, 1) };
      if (call.tool === 'sessao_listar' && !call.quadro) return { kind: 'text', text: JSON.stringify(mine.listar, null, 1) };
      return { kind: 'error', text: PC_OFF };
    };

    const ledger = async (call: LedgerToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: NO_PICTURE };
      const caller = callerFromPicture(mine);
      if (typeof caller === 'string') return { kind: 'error', text: caller };
      if ((call.tool === 'tarefa_criar' || call.tool === 'tarefa_listar' || call.tool === 'tarefa_novidades') && call.quadro) return { kind: 'error', text: 'Só o Líder único escolhe o quadro. Esta sessão usa sempre o próprio quadro (chame sem "quadro").' };
      const refused = call.tool === 'tarefa_criar' && call.quemPediu ? askedByRefusal(call.quemPediu) : null;
      if (refused) return { kind: 'error', text: refused };
      if (deps.recados) {
        try {
          await deps.recados.antesDaTarefa(caller, mine, call);
        } catch (error) {
          log(`[oraculo] portão: antes de ${call.tool} falhou: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // No `remote`: the proof files named by a VPS session are here, on this machine.
      const result = await runLedger(caller, call);
      if (!result.ok) return { kind: 'error', text: result.text };
      if (deps.recados) {
        // The notices never hold the answer, nor fail it.
        const failed = (error: unknown): void => log(`[oraculo] portão: aviso depois de ${call.tool} falhou: ${error instanceof Error ? error.message : String(error)}`);
        try {
          void Promise.resolve(deps.recados.depoisDaTarefa(sid, mine, caller, call, result.text) as unknown).catch(failed);
        } catch (error) {
          failed(error);
        }
      }
      return result.image ? { kind: 'image', base64: result.image.base64, mimeType: result.image.mimeType, text: result.text } : { kind: 'text', text: result.text };
    };

    const card = async (call: CardToolCall): Promise<BrowserToolOutcome> => {
      // With the PC on too: a session the PC has not pictured yet (it sends one every ~30 s).
      const notYet = 'Sem retrato do quadro desta sessão ainda: o app manda um a cada meio minuto. Tente de novo em um minuto.';
      if (!mine || !cards) return { kind: 'error', text: notYet };
      const who = mine.quemSou;
      if (who.liderUnico === true) return { kind: 'error', text: 'O Líder único não tem raia no quadro de tarefas: quem move os cartões é o Líder de cada quadro.' };
      if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string') return { kind: 'error', text: notYet };
      const place = mine.board?.cards[who.lugar];
      const outcome = await runCardTool(
        cards,
        {
          placeId: who.lugar,
          projectPath: who.pasta,
          ...(place?.kind === 'session' && place.sessionId ? { sessionId: place.sessionId } : {}),
          isLeader: mine.board ? isBoardOrchestrator(mine.board, who.lugar) : who.orquestrador === true,
          boardPlaces: new Set(mine.board ? Object.keys(mine.board.cards) : []),
        },
        call,
        (deps.now ?? Date.now)(),
      );
      return outcome.ok ? { kind: 'text', text: outcome.text } : { kind: 'error', text: outcome.text };
    };

    const answer = await handleMcpPayload(parsed.payload, {
      executor: async () => ({ kind: 'error', text: PC_OFF }),
      boardExecutor: board,
      ledgerExecutor: ledger,
      // Listed like the PC lists them (a tool list answered here is the session's for good); they run on the PC.
      hillClimbExecutor: async () => ({ kind: 'error', text: PC_OFF }),
      ...(cards ? { cardExecutor: card } : {}),
      openCap: () => null,
      serverVersion: deps.serverVersion,
    });
    const response: GateResponse = answer === null ? { status: 202, headers: {}, body: '' } : { status: 200, headers: JSON_HEADERS, body: JSON.stringify(answer) };
    return { response, passOn };
  }

  return async (request) => {
    const hook = HOOK_PATH.exec(request.path);
    if (hook) {
      // The loopback is the server's check; the hooks carry no MCP token.
      if (!deps.recados || request.method !== 'POST') return { status: 404, headers: {}, body: '' };
      return deps.recados.hook(hook[1]!, request.headers, request.body);
    }
    const match = /^\/s\/([^/]+)\/mcp$/.exec(request.path);
    if (!match || !SID_PATTERN.test(match[1]!)) return { status: 404, headers: {}, body: '' };
    const sid = match[1]!;
    const meta = readMeta(deps.sessionsDir, sid);
    const bearer = request.authorization?.startsWith('Bearer ') ? request.authorization.slice('Bearer '.length) : '';
    if (!meta || !bearer || !sameToken(bearer, meta.mcpToken)) return { status: 401, headers: {}, body: '' };
    const cards = deps.cards?.() ?? null;
    const message = request.method === 'POST' ? singleMessage(request.body) : null;
    const call = toolCallOf(message);
    const mine = deps.picture()?.sessoes[sid] ?? null;
    // The board answers here even with the PC on: it is not the PC's.
    if (cards && call && isCardToolName(call.name)) return (await local(sid, request.body, cards, 'ligado')).response;
    // The ledger is this daemon's: with the session's picture its tasks never wait on the PC (the Líder único's, and a
    // picture that does not say the place, still go to the PC, which knows them).
    if (call && isLedgerToolName(call.name) && mine && typeof callerFromPicture(mine) !== 'string') return (await local(sid, request.body, cards, 'ligado')).response;
    let recadosTried = false;
    if (call?.name === 'sessao_enviar' && mine && deps.recados) {
      const sent = await local(sid, request.body, cards, 'ligado', true);
      if (!sent.passOn) return sent.response;
      recadosTried = true;
    }
    const forwarding = deps.forward(meta.mcpPort, request).catch((): GateResponse => BAD_GATEWAY);
    let forwarded: GateResponse | 'desligado';
    if (message && answersWithoutPc(message, mine)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silent = new Promise<'sem-resposta'>((resolve) => {
        timer = setTimeout(() => resolve('sem-resposta'), localAnswerMs);
      });
      const first = await Promise.race([forwarding, silent]);
      clearTimeout(timer);
      if (first === 'sem-resposta') {
        log(`[oraculo] portão: o PC não respondeu ${String(message.method)} da sessão ${sid} em ${localAnswerMs} ms; respondi daqui.`);
        return (await local(sid, request.body, cards, 'sem-resposta')).response;
      }
      forwarded = first;
    } else {
      forwarded = await forwarding;
    }
    if (forwarded !== 'desligado') return withGateTools(request.body, forwarded, cards !== null);
    if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, body: '' };
    return (await local(sid, request.body, cards, 'desligado', !recadosTried)).response;
  };
}

export interface TunnelForwardOptions {
  /** The TCP connection must complete within this (default `CONNECT_MS`). */
  readonly connectMs?: number;
  /** The whole answer, once connected (default 10 min: a tool may run that long on the PC). */
  readonly timeoutMs?: number;
  /** Opens the connection (the tests give a socket that never connects). */
  readonly connect?: (port: number) => Socket;
}

/**
 * The real forward: the session's reverse tunnel on this machine (`127.0.0.1:<mcpPort>/mcp`), as its CLI would call.
 * Only "the connection never completed" (refused, unreachable, or not within `connectMs`: nothing was sent) is the PC
 * off. Any failure after it connected (a reset after the call went out, a timeout, a pipe broken mid-answer) is a
 * 502: the call may have run on the PC, and running it again here would make a task or a delivery twice (revisão do #302).
 */
export function createTunnelForward(options: TunnelForwardOptions = {}): GateForward {
  const connectMs = options.connectMs ?? CONNECT_MS;
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;
  const open = options.connect ?? ((port: number) => netConnect({ host: '127.0.0.1', port }));
  return (port, request) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value: GateResponse | 'desligado'): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const socket = open(port);
      const notConnected = (): void => {
        clearTimeout(connectTimer);
        socket.destroy();
        finish('desligado');
      };
      const connectTimer = setTimeout(notConnected, connectMs);
      socket.once('error', notConnected);
      socket.once('connect', () => {
        clearTimeout(connectTimer);
        socket.off('error', notConnected);
        const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
        for (const [name, value] of Object.entries(request.headers)) if (!name.startsWith('x-donel-')) headers[name] = value;
        if (request.authorization) headers.Authorization = request.authorization;
        if (request.body) headers['Content-Length'] = String(Buffer.byteLength(request.body));
        const outgoing = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: request.method, headers, timeout: timeoutMs, createConnection: () => socket }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const passOn: Record<string, string> = {};
            for (const name of ['content-type', 'mcp-session-id', 'cache-control', 'allow']) {
              const value = res.headers[name];
              if (typeof value === 'string') passOn[name] = value;
            }
            finish({ status: res.statusCode ?? 502, headers: passOn, body: Buffer.concat(chunks).toString('utf8') });
          });
          res.on('error', () => finish(BAD_GATEWAY));
        });
        outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
        outgoing.on('error', () => finish(BAD_GATEWAY));
        outgoing.end(request.body);
      });
    });
}

export const tunnelForward: GateForward = createTunnelForward();

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
      // The recados hooks say which session they come from (`X-Donel-Tmux`, ...).
      for (const [name, value] of Object.entries(req.headers)) if (name.startsWith('x-donel-') && typeof value === 'string') headers[name] = value;
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
