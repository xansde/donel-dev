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
//   only relayed it (and froze). The notices the PC gave after a task (a delivery, a "travada", a "precisa-do-dono" to
//   whoever hears the session) go to the recados queue when there is one, else to the PC's relay (`fila.json`), which
//   today's app delivers when it answers (`relayNotice`). The tool list promises this gate's `tarefa_*` definitions
//   (the key, the reason) only to a session whose tasks are answered here; any other keeps the PC's. A task born of an
//   owner's request is linked to it on his phone here too (`linkPedido`).
// - a forward that connected and then hears nothing for 10 min is a 502; one the gate answered itself is let go.
// - `sessao_enviar` goes to the recados queue (`GateRecados`) when there is one; what the picture cannot send (a
//   target off this machine, a place or an arrow newer than the picture) goes on to the PC, and with the PC off the
//   recados answer from the picture (a target off this machine: the PC's relay).
// - the tunnel must connect within `CONNECT_MS` (else: the PC is off, nothing was sent). The tunnel's listener is the
//   VPS's own sshd (`ssh -R`): with the tunnel alive it takes the connection at once even when the PC's app is frozen
//   or closed, so this only tells a tunnel that is down; a frozen app is what the answers here are for. What can be
//   answered here without harm (initialize, the tool list, ping, notifications, `sessao_quem_sou`, `sessao_listar`)
//   is answered here when the PC is silent for `LOCAL_ANSWER_MS`. Any other tool waits for the PC as before; a 502
//   stays a 502.
// - `POST /recados/<evento>`: the VPS's user-level hooks, loopback only, no MCP token.
// - Etapa 2 (t-c3fbe852): the Líder único's `tarefa_*` still go to the PC (it sees every board, the PC's too); with the
//   PC off (nothing listens on the tunnel) they are answered here as the Líder único (`lider`), on the boards the
//   picture has (`leaderCallerFromPicture`, the same rules as the PC's `leaderLedgerCallerOf`). With the PC silent only
//   the reads (`tarefa_listar`, `tarefa_ver`) are answered here: a write may still run there.
// - t-1a3f7150 (docs/adr/0009): a `sessao_abrir` that reached nothing (the tunnel refused: the PC is off) opens the
//   session on this machine (`GateAbrir`, abrir-local.ts). Never with the PC silent or on: it may be running there.
// - O Oráculo sem o PC (19/11, o dono: "O Oráculo é o básico"): with the PC away (`pcAway`, no push nor probe answer
//   for over 5 min), or for a session the PC does not know (its picture made here, `local`, retrato-local.ts), nothing
//   goes to the tunnel: an ssh tunnel whose PC is gone connects and never answers, and every write hung 10 min. The
//   call is answered here as with the PC off: the `tarefa_*` (the Líder único's too), `sessao_quem_sou`,
//   `sessao_listar`, `sessao_enviar` by the arrows, `sessao_abrir` by abrir-local; the other tools say the PC is off.
//   A tunnel that refused (`desligado`) answers from the picture with this session made here (`pictureWithoutPc`).

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
import { leaderCallerOffBoard, runLedgerTool, urgentLedgerNotice, type LedgerCaller, type LedgerService, type LedgerToolAnswer } from '../main/ledger-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import { CARD_TOOLS, isCardToolName, type CardToolCall } from '../shared/board/tools';
import { canReach, demandOwnerRefusal, hearingPlaceIds, isBoardOrchestrator, LEADER_OF_ALL_FROM, whoHears } from '../shared/mindscape/reach';
import { LEADER_ROLE_ID } from '../shared/roles';
import type { BoardStore } from './board-client';
import { runCardTool } from './board-tools';
import type { GateRecados } from './gate-recados';
import type { GateAbrir } from './gate-abrir';

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
  /** When this session was pictured by the probe (sonda.ts); absent = the PC's push, as old as the picture's `at`. */
  readonly at?: number;
  /**
   * t-c3fbe852 — the `at` of the last PC push that carried this session (stamped by `mergePicture`). A session the PC
   * stopped sending keeps its old entry, and this tells it apart from one the PC still shows.
   */
  readonly pcAt?: number;
  /**
   * O Oráculo sem o PC (19/11) — made on this VPS, not by the PC (retrato-local.ts, or a `sessao_abrir` here with the
   * PC off): the PC does not know this session, so its calls are answered here and never wait on its tunnel.
   */
  readonly local?: boolean;
  /**
   * t-d461e003 — a session of another machine (its gate's name), from the picture its satellite sent
   * (retrato-satelite.ts): it lives there, so a message to it waits in that machine's queue, never in this tmux.
   */
  readonly maquina?: string;
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
  // The PC's own sessions (no probe `at`) carry when it last showed them.
  const stamped = Object.fromEntries(Object.entries(next.sessoes).map(([folder, session]) => [folder, session.at === undefined ? { ...session, pcAt: next.at } : session]));
  const sessoes = Object.fromEntries(Object.entries({ ...(previous?.sessoes ?? {}), ...stamped }).filter(([folder]) => folderExists(folder)));
  return { at: next.at, sessoes };
}

export interface GateRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string;
  /** The MCP headers to pass on (lowercase). */
  readonly headers: Readonly<Record<string, string>>;
  /** The request's Host header (never passed on): `/local/*` answers only `127.0.0.1:<port>` (no DNS rebinding). */
  readonly host?: string;
  readonly body: string;
}

export interface GateResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Passes a call to the session's tunnel; `'desligado'` = nothing answered there (the PC is off). `signal`: the gate
 * answered the call itself (the PC was silent), so the pending forward is let go.
 */
export type GateForward = (port: number, request: GateRequest, signal?: AbortSignal) => Promise<GateResponse | 'desligado'>;

/** What a `tarefa_*` answered by the gate came with: the session's picture and its raw arguments. */
export interface GateLedgerContext {
  readonly mine: PictureSession;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface GateDeps {
  /** `~/.donel/s`. */
  readonly sessionsDir: string;
  /**
   * Saída iii (18/11) — `/local/*` on this loopback server, no MCP token (like the hooks): what a script of this user
   * on this machine asks the daemon (a new phone's key, the Líder's answer to the phone). `null` = not one of them.
   */
  readonly local?: (method: string, path: string, body: string) => Promise<GateResponse | null>;
  readonly ledger: () => LedgerService;
  readonly picture: () => BoardPicture | null;
  readonly forward: GateForward;
  readonly serverVersion: string;
  /** The task board's client; absent or null = no `card_*` tools (the board is off). */
  readonly cards?: () => BoardStore | null;
  readonly now?: () => number;
  /** The recados queue (`sessao_enviar` here, the notices after a task, the hooks' route); absent = none. */
  readonly recados?: GateRecados;
  /** t-1a3f7150 — `sessao_abrir` with the PC off (nothing listens on the tunnel) opens here; absent = the PC is off. */
  readonly abrir?: GateAbrir;
  /** O Oráculo sem o PC — the PC has not answered for long (retrato-local.ts `pcAway`): nothing goes to the tunnels. */
  readonly pcAway?: () => boolean;
  /** The picture with session `sid` made here when the PC's has none (its tunnel refused); absent = `picture()`. */
  readonly pictureWithoutPc?: (sid: string) => BoardPicture | null;
  /** Pedir pelo Oráculo: the task born of an owner's request (`pedidoDoDono`) shows on his phone as "virou tarefa". */
  readonly linkPedido?: (pedidoId: string, tarefa: { readonly id: string; readonly titulo: string }) => void;
  /**
   * Without the recados queue: a notice the PC gave after a task (`urgentLedgerNotice`), for the PC's relay
   * (`fila.json`), which today's app delivers to that place, or to the Líder único, when it answers. Absent = logged.
   */
  readonly relayNotice?: (message: OwnerMessage) => void;
  /**
   * Runs a `tarefa_*` as `caller`; default: `runLedgerTool` on this daemon's ledger. `context`: the session's picture
   * and the call's arguments as the session sent them (the satellite passes them on to the ledger's machine).
   */
  readonly runLedger?: (caller: LedgerCaller, call: LedgerToolCall, context: GateLedgerContext) => Promise<LedgerToolAnswer>;
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
 * A field of a `tarefa_*` tool only this gate honors (today's app on the PC drops it): the key everywhere, the owner's
 * reason of `tarefa_andamento` (the `motivo` of rejeitar, cancelar and transferir is theirs, and required).
 */
function gateOnlyField(tool: string, field: string): boolean {
  return field === 'chave' || (tool === 'tarefa_andamento' && field === 'motivo');
}

/** A `tarefa_*` definition without the fields only this gate honors: what a session whose tasks go to the PC sees. */
function withoutGateFields(tool: unknown): unknown {
  if (!isRecord(tool) || typeof tool.name !== 'string' || !isLedgerToolName(tool.name) || !isRecord(tool.inputSchema) || !isRecord(tool.inputSchema.properties)) return tool;
  const name = tool.name;
  const properties = Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([field]) => !gateOnlyField(name, field)));
  return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
}

/** A tool list answer (the PC's or this gate's) with each tool mapped; `null` = not a tool list. */
function mapToolList(answer: GateResponse, map: (tools: unknown[]) => unknown[]): GateResponse | null {
  const parsed = singleMessage(answer.body);
  const result = parsed && isRecord(parsed.result) ? parsed.result : null;
  if (!parsed || !result || !Array.isArray(result.tools)) return null;
  return { ...answer, body: JSON.stringify({ ...parsed, result: { ...result, tools: map(result.tools) } }) };
}

/**
 * The PC's answer to `tools/list` as this gate serves it: the board's tools appended (the PC does not know them) and,
 * when `tasksHere` (this session's `tarefa_*` are answered by this gate), the `tarefa_*` definitions are this gate's,
 * with the fields an older app does not know. Otherwise they stay the PC's: the schema never promises the key or the
 * reason to a call that goes to an app that drops them (revisão do #483).
 */
export function withGateTools(requestBody: string, answer: GateResponse, withCards: boolean, tasksHere = true): GateResponse {
  if (answer.status !== 200 || singleMessage(requestBody)?.method !== 'tools/list') return answer;
  return mapToolList(answer, (tools) => servedTools(tools, withCards, tasksHere)) ?? answer;
}

function servedTools(tools: readonly unknown[], withCards: boolean, tasksHere: boolean): unknown[] {
  const ledgerTools = new Map<string, unknown>(LEDGER_TOOLS.map((tool) => [tool.name, tool]));
  const served: unknown[] = tasksHere ? tools.map((tool: unknown) => (isRecord(tool) && typeof tool.name === 'string' && ledgerTools.has(tool.name) ? ledgerTools.get(tool.name) : tool)) : [...tools];
  const names = new Set(served.map((tool) => (isRecord(tool) ? tool.name : null)));
  return withCards ? [...served, ...CARD_TOOLS.filter((tool) => !names.has(tool.name))] : served;
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

/** The boards the picture has (each from its freshest session): folder → its places and its saved board. */
export function picturedBoards(picture: BoardPicture | null): Map<string, { readonly listar: readonly unknown[]; readonly board?: MindscapeBoard }> {
  const fresh = new Map<string, { at: number; listar: readonly unknown[]; board?: MindscapeBoard }>();
  for (const session of Object.values(picture?.sessoes ?? {})) {
    const pasta = session.quemSou.pasta;
    if (session.quemSou.liderUnico === true || typeof pasta !== 'string' || !pasta) continue;
    const at = session.at ?? picture?.at ?? 0;
    const known = fresh.get(pasta);
    if (!known || at > known.at || (!known.board && session.board)) fresh.set(pasta, { at, listar: session.listar, ...(session.board ? { board: session.board } : {}) });
  }
  return new Map([...fresh].map(([pasta, { listar, board }]) => [pasta, { listar, ...(board ? { board } : {}) }]));
}

/**
 * t-c3fbe852 — the Líder único as the ledger's caller with the PC off, from the picture: the board named by `quadro`
 * (by name or folder; for a tool that acts on a task id, the task's board), the places he reaches on it, and every
 * pictured board for a list of all. The PC's own rules (`leaderLedgerCallerOf`): a new task names its board and a
 * place he reaches, and goes to the board's live Líder. A string = why not.
 */
export function leaderCallerFromPicture(
  picture: BoardPicture | null,
  call: LedgerToolCall,
  taskBoard: (id: string) => string | undefined,
): { readonly caller: LedgerCaller; readonly call: LedgerToolCall } | string {
  const boards = picturedBoards(picture);
  const quadro =
    call.tool === 'tarefa_criar' || call.tool === 'tarefa_listar' || call.tool === 'tarefa_novidades'
      ? call.quadro
      : call.tool === 'tarefa_transferir' || call.tool === 'tarefa_cancelar' || call.tool === 'tarefa_frente'
        ? taskBoard(call.id)
        : undefined;
  const sessionOf = (projectPath: string, placeId: string): string | undefined => {
    const card = boards.get(projectPath)?.board?.cards[placeId];
    return card?.kind === 'session' ? card.sessionId : undefined;
  };
  const base = { placeId: LEADER_OF_ALL, roleId: LEADER_ROLE_ID, sessionOf };
  const everyBoard = new Map([...boards].map(([pasta, { listar }]) => [pasta, placeStatesOf(listar)]));
  if (!quadro) {
    if (call.tool === 'tarefa_criar') return 'Você é o Líder único e não tem quadro: diga qual em "quadro" (nome ou pasta).';
    if (call.tool !== 'tarefa_listar') return { caller: { ...base, projectPath: '', boardPlaceIds: [] }, call };
    return { caller: { ...base, projectPath: '', boardPlaceIds: [], placeStates: everyBoard }, call: { ...call, todos: true } };
  }
  const found = [...boards].find(([pasta]) => pasta === quadro || lastSegment(pasta) === quadro);
  if (!found) {
    const offBoard = call.tool === 'tarefa_criar' || call.tool === 'tarefa_listar' || call.tool === 'tarefa_novidades' ? null : leaderCallerOffBoard(base, quadro, call.tool);
    if (offBoard) return { caller: offBoard, call };
    const names = [...boards.keys()].map(lastSegment).join(', ') || 'nenhum';
    return `Com o PC desligado, conheço só os quadros do último retrato (${names}); "${quadro}" não está entre eles. Tente quando o PC ligar.`;
  }
  const [pasta, { listar, board }] = found;
  const states = placeStatesOf(listar);
  const doc = { schemaVersion: 8, boards: board ? { [pasta]: board } : {} } as const;
  const reached = [...states.keys()].filter((id) => !board || canReach(doc, LEADER_OF_ALL_FROM, { projectPath: pasta, placeId: id }).ok);
  if (call.tool === 'tarefa_criar') {
    if (!call.dono || !reached.includes(call.dono)) return `O Líder único não faz a tarefa: diga em "dono" um lugar que você alcança neste quadro (${reached.join(', ') || 'nenhum'}).`;
    const refusal = demandOwnerRefusal(board, hearingPlaceIds(states), call.dono);
    if (refusal) return refusal;
  }
  const placeStates = call.tool === 'tarefa_listar' && call.todos ? new Map([...everyBoard, [pasta, states]]) : new Map([[pasta, states]]);
  return { caller: { ...base, projectPath: pasta, boardPlaceIds: reached, placeStates, ...(board ? { board } : {}) }, call };
}

/**
 * The Líder único's `tarefa_*` from the picture: his caller and call (`leaderCallerFromPicture`), and what the steps
 * around it see, the task's board (its places and arrows), as a session of that board does: the Líder's own picture has
 * none, and his caller has no board for a step on a task id (the PC's rule). `taskBoard` may throw (= not known).
 * A string = why not. Passo 9: the registro runs the same for the entregador of its machine (portoes.ts).
 */
export function leaderTaskContext(
  picture: BoardPicture | null,
  mine: PictureSession,
  asked: LedgerToolCall,
  taskBoard: (id: string) => string | undefined,
): { readonly caller: LedgerCaller; readonly call: LedgerToolCall; readonly onBoard: PictureSession; readonly aroundCaller: LedgerCaller } | string {
  const boardOf = (id: string): string | undefined => {
    try {
      return taskBoard(id);
    } catch {
      return undefined;
    }
  };
  const resolved = leaderCallerFromPicture(picture, asked, boardOf);
  if (typeof resolved === 'string') return resolved;
  const { caller, call } = resolved;
  if (call.tool === 'tarefa_criar' && call.quemPediu) {
    const refused = askedByRefusal(call.quemPediu);
    if (refused) return refused;
  }
  const pasta = caller.projectPath || ('id' in call && typeof call.id === 'string' ? boardOf(call.id) : undefined);
  const pictured = pasta ? picturedBoards(picture).get(pasta) : undefined;
  const onBoard: PictureSession = { quemSou: mine.quemSou, listar: pictured?.listar ?? [], ...(pictured?.board ? { board: pictured.board } : {}) };
  const aroundCaller: LedgerCaller = pasta ? { ...caller, projectPath: pasta, ...(pictured?.board ? { board: pictured.board } : {}) } : caller;
  return { caller, call, onBoard, aroundCaller };
}

/** The board `quadro` names (its folder or its last segment) among the boards the picture has. */
function pictureBoard(picture: BoardPicture | null, quadro: string): [string, { readonly listar: readonly unknown[]; readonly board?: MindscapeBoard }] | undefined {
  return [...picturedBoards(picture)].find(([pasta]) => pasta === quadro || lastSegment(pasta) === quadro);
}

/** The places without the caller's own marks (`voce`, `podeMandar`: they were another session's). */
function placesAsListed(listar: readonly unknown[]): unknown[] {
  return listar.map((place) => {
    if (!isRecord(place)) return place;
    const { voce: _voce, podeMandar: _podeMandar, ...rest } = place;
    return rest;
  });
}

/** O Oráculo sem o PC — the Líder único's `sessao_listar`: the places of the board he names, from the picture. */
function leaderList(picture: BoardPicture | null, quadro: string | undefined): BrowserToolOutcome {
  const names = [...picturedBoards(picture).keys()].map(lastSegment).join(', ') || 'nenhum';
  if (!quadro) return { kind: 'error', text: `Você é o Líder único: diga o quadro em "quadro" (com o PC fora, conheço: ${names}).` };
  const found = pictureBoard(picture, quadro);
  if (!found) return { kind: 'error', text: `Com o PC fora, conheço só os quadros do último retrato (${names}); "${quadro}" não está entre eles.` };
  return { kind: 'text', text: JSON.stringify(placesAsListed(found[1].listar), null, 1) };
}

/** This session's `tarefa_*` are answered by this gate: it has a picture that says its place (not the Líder único). */
function tasksAnsweredHere(mine: PictureSession | null): mine is PictureSession {
  return mine !== null && typeof callerFromPicture(mine) !== 'string';
}

function nameOf(who: Record<string, unknown>): string {
  for (const key of ['papelNome', 'nome', 'papel'] as const) if (typeof who[key] === 'string' && who[key]) return who[key] as string;
  return 'sessão';
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * The notice the PC gave after a task answered here (a delivery for acceptance, a "travada", a "precisa-do-dono"), as
 * a message of the PC's relay: to whoever hears the session (`whoHears`, from its picture), the Líder único when nobody
 * on the board does. The same words and key as the recados queue's notice to a place off its machine, so the two never
 * make it twice. `null` = nothing to tell, or a repeat (the first call told it).
 */
export function relayedTaskNotice(mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall, answerText: string): OwnerMessage | null {
  const urgent = urgentLedgerNotice(call, answerText);
  if (!urgent) return null;
  let answer: { id?: unknown; repetida?: unknown; tarefa?: { ultimoEvento?: { em?: unknown } } };
  try {
    answer = JSON.parse(answerText) as typeof answer;
  } catch {
    return null;
  }
  if (typeof answer.id !== 'string' || answer.repetida === true) return null;
  const live = hearingPlaceIds(placeStatesOf(mine.listar));
  const target = whoHears(mine.board, caller.placeId, (id) => live.has(id));
  const em = answer.tarefa?.ultimoEvento?.em;
  const eventAt = typeof em === 'string' && Number.isFinite(Date.parse(em)) ? Date.parse(em) : Date.now();
  const words = `${nameOf(mine.quemSou)} (${caller.placeId}) ${urgent}`;
  const board = lastSegment(caller.projectPath);
  return {
    projectPath: caller.projectPath,
    placeId: target === LEADER_OF_ALL ? '' : target,
    text: `◆ Oráculo: ${words}`,
    leaderText: `◆ Oráculo, quadro ${board}${target === LEADER_OF_ALL ? '' : ` (para ${target}, que não está aberta)`}: ${words}`,
    key: `aviso:${call.tool}:${answer.id}:${target}:${eventAt}`,
  };
}

/** O Oráculo sem o PC — the tools answered here with the PC away (the ledger's and the session tools of the arrows). */
const ANSWERED_WITHOUT_PC: ReadonlySet<string> = new Set([...LEDGER_TOOLS.map((tool) => tool.name), 'sessao_quem_sou', 'sessao_listar', 'sessao_enviar', 'sessao_abrir']);

/** A call that may be answered here when the PC is silent: it only reads, or it is the handshake. */
function answersWithoutPc(message: Record<string, unknown>, mine: PictureSession | null): boolean {
  const method = message.method;
  if (method === 'initialize' || method === 'ping' || method === 'tools/list' || (typeof method === 'string' && method.startsWith('notifications/'))) return true;
  const call = toolCallOf(message);
  if (!call || !mine) return false;
  // t-c3fbe852 — the Líder único's reads of the ledger (a write may still run on the PC: those wait for it).
  if (mine.quemSou.liderUnico === true && (call.name === 'tarefa_listar' || call.name === 'tarefa_ver')) return true;
  return call.name === 'sessao_quem_sou' || (call.name === 'sessao_listar' && call.args.quadro === undefined);
}

/** Why a session's `tarefa_*` is refused before it runs (the Líder único's board choice, a place as "quem pediu"). */
export function ledgerCallRefusal(call: LedgerToolCall): string | null {
  if ((call.tool === 'tarefa_criar' || call.tool === 'tarefa_listar' || call.tool === 'tarefa_novidades') && call.quadro) return 'Só o Líder único escolhe o quadro. Esta sessão usa sempre o próprio quadro (chame sem "quadro").';
  return call.tool === 'tarefa_criar' && call.quemPediu ? askedByRefusal(call.quemPediu) : null;
}

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** How the PC is for a call answered here: off (nothing listens), silent (it did not answer in time), or on. */
type PcState = 'desligado' | 'sem-resposta' | 'ligado';

export function createGateHandler(deps: GateDeps): (request: GateRequest) => Promise<GateResponse> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const runLedger = deps.runLedger ?? ((caller: LedgerCaller, call: LedgerToolCall) => runLedgerTool(deps.ledger(), caller, call));
  const localAnswerMs = deps.timeouts?.localAnswerMs ?? LOCAL_ANSWER_MS;

  /** Answers the call here. `passOn`: the recados queue said the target is not on this machine (`useRecados`). */
  async function local(
    sid: string,
    body: string,
    cards: BoardStore | null,
    pc: PcState,
    useRecados = false,
    picture: BoardPicture | null = deps.picture(),
  ): Promise<{ readonly response: GateResponse; readonly passOn: boolean }> {
    const parsed = parseMcpBody(body);
    if (!parsed.ok) return { response: { status: 400, headers: JSON_HEADERS, body: JSON.stringify(parsed.response) }, passOn: false };
    const mine = picture?.sessoes[sid] ?? null;
    const label = pc === 'sem-resposta' ? `não respondeu em ${Math.round(localAnswerMs / 1000)} s` : pc;
    const pcNow = picture ? `${label}; quadro de ${hhmm(mine?.at ?? picture.at)}` : label;
    let passOn = false;

    const board = async (call: BoardToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: NO_PICTURE };
      if (call.tool === 'sessao_abrir' && pc === 'desligado' && deps.abrir) return deps.abrir.abrir(sid, mine, call);
      if (call.tool === 'sessao_enviar' && useRecados && deps.recados) {
        // With the PC off the recados never pass it on: the picture answers, a target off this machine goes to the relay.
        const sent = await deps.recados.enviar(sid, mine, call, pc === 'desligado' ? 'desligado' : 'ligado');
        if (sent !== 'repassar') return sent;
        passOn = true;
        return { kind: 'error', text: PC_OFF };
      }
      if (call.tool === 'sessao_quem_sou') return { kind: 'text', text: JSON.stringify({ ...mine.quemSou, pc: pcNow }, null, 1) };
      // The Líder único has no board of his own: he names it, and the picture has its places.
      if (call.tool === 'sessao_listar' && mine.quemSou.liderUnico === true && pc !== 'ligado') return leaderList(picture, call.quadro);
      if (call.tool === 'sessao_listar' && !call.quadro) return { kind: 'text', text: JSON.stringify(mine.listar, null, 1) };
      return { kind: 'error', text: PC_OFF };
    };

    /** The notices after a task step: they never hold the answer, nor fail it. */
    const afterTask = (mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall, answerText: string): void => {
      const failed = (error: unknown): void => log(`[oraculo] portão: aviso depois de ${call.tool} falhou: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (deps.recados) {
          void Promise.resolve(deps.recados.depoisDaTarefa(sid, mine, caller, call, answerText) as unknown).catch(failed);
        } else {
          const notice = relayedTaskNotice(mine, caller, call, answerText);
          if (notice && deps.relayNotice) deps.relayNotice(notice);
          else if (notice) log(`[oraculo] portão: aviso de ${call.tool} sem relay: ${notice.text.slice(0, 80)}`);
        }
      } catch (error) {
        failed(error);
      }
    };

    /** The renewal step before a task step (a failure is a log line). */
    const beforeTask = async (mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall): Promise<void> => {
      if (!deps.recados) return;
      try {
        await deps.recados.antesDaTarefa(caller, mine, call);
      } catch (error) {
        log(`[oraculo] portão: antes de ${call.tool} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    const ledger = async (call: LedgerToolCall): Promise<BrowserToolOutcome> => {
      if (!mine) return { kind: 'error', text: NO_PICTURE };
      if (mine.quemSou.liderUnico === true && pc !== 'ligado') return leaderLedger(mine, call);
      const caller = callerFromPicture(mine);
      if (typeof caller === 'string') return { kind: 'error', text: caller };
      const refused = ledgerCallRefusal(call);
      if (refused) return { kind: 'error', text: refused };
      await beforeTask(mine, caller, call);
      // No `remote`: the proof files named by a VPS session are here, on this machine.
      const raw = toolCallOf(singleMessage(body));
      const result = await runLedger(caller, call, { mine, args: raw?.name === call.tool ? raw.args : {} });
      if (!result.ok) return { kind: 'error', text: result.text };
      // As the PC does (executeLedgerTool): the owner's phone shows "virou tarefa" with its name.
      if (call.tool === 'tarefa_criar' && call.pedidoDoDono && deps.linkPedido) {
        try {
          const created = JSON.parse(result.text) as { id?: unknown };
          if (typeof created.id === 'string') deps.linkPedido(call.pedidoDoDono, { id: created.id, titulo: call.titulo ?? call.pedido.slice(0, 80) });
        } catch (error) {
          log(`[oraculo] portão: ligar o pedido ${call.pedidoDoDono} à tarefa falhou: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      afterTask(mine, caller, call, result.text);
      return result.image ? { kind: 'image', base64: result.image.base64, mimeType: result.image.mimeType, text: result.text } : { kind: 'text', text: result.text };
    };

    /** t-c3fbe852 — the Líder único's `tarefa_*` with the PC off, on the boards the picture has. */
    const leaderLedger = async (mine: PictureSession, asked: LedgerToolCall): Promise<BrowserToolOutcome> => {
      const resolved = leaderTaskContext(picture, mine, asked, (id) => deps.ledger().load().doc.tasks[id]?.projectPath);
      if (typeof resolved === 'string') return { kind: 'error', text: resolved };
      const { caller, call, onBoard, aroundCaller } = resolved;
      await beforeTask(onBoard, aroundCaller, call);
      const raw = toolCallOf(singleMessage(body));
      const result = await runLedger(caller, call, { mine, args: raw?.name === call.tool ? raw.args : {} });
      if (!result.ok) return { kind: 'error', text: result.text };
      if (call.tool === 'tarefa_criar' && call.pedidoDoDono && deps.linkPedido) {
        try {
          const created = JSON.parse(result.text) as { id?: unknown };
          if (typeof created.id === 'string') deps.linkPedido(call.pedidoDoDono, { id: created.id, titulo: call.titulo ?? call.pedido.slice(0, 80) });
        } catch (error) {
          log(`[oraculo] portão: ligar o pedido ${call.pedidoDoDono} à tarefa falhou: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      afterTask(onBoard, aroundCaller, call, result.text);
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
    // The list a session keeps for good: no key nor reason promised while its tasks would go to the PC.
    if (!tasksAnsweredHere(mine) && singleMessage(body)?.method === 'tools/list') return { response: mapToolList(response, (tools) => tools.map(withoutGateFields)) ?? response, passOn };
    return { response, passOn };
  }

  return async (request) => {
    const hook = HOOK_PATH.exec(request.path);
    if (hook) {
      // The loopback is the server's check; the hooks carry no MCP token.
      if (!deps.recados || request.method !== 'POST') return { status: 404, headers: {}, body: '' };
      return deps.recados.hook(hook[1]!, request.headers, request.body);
    }
    if (request.path.startsWith('/local/') && deps.local) {
      // A page in a browser of this machine could reach the loopback: only a script's JSON POST to 127.0.0.1 passes
      // (a cross-site form cannot send application/json; a rebound name never says 127.0.0.1).
      const localHost = /^(127\.0\.0\.1|localhost):\d+$/.test(request.host ?? '');
      const isJson = (request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json');
      if (!localHost || !isJson) return { status: 403, headers: {}, body: '' };
      return (await deps.local(request.method, request.path, request.body)) ?? { status: 404, headers: {}, body: '' };
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
    const picture = deps.picture();
    const mine = picture?.sessoes[sid] ?? null;
    // The board answers here even with the PC on: it is not the PC's.
    if (cards && call && isCardToolName(call.name)) return (await local(sid, request.body, cards, 'ligado', false, picture)).response;
    // O Oráculo sem o PC: a session the PC does not know is answered here, whatever it calls; with the PC away, what can
    // be answered here is (any other tool still tries the PC, as before). The tunnel is never waited on for these.
    if (mine?.local === true || (call && ANSWERED_WITHOUT_PC.has(call.name) && deps.pcAway?.() === true)) {
      if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, body: '' };
      return (await local(sid, request.body, cards, 'desligado', true, picture)).response;
    }
    // The ledger is this daemon's: with the session's picture its tasks never wait on the PC (the Líder único's, and a
    // picture that does not say the place, still go to the PC, which knows them). The notices the PC gave after a task
    // go to the recados queue or, without it, to the PC's relay (revisão do #483).
    if (call && isLedgerToolName(call.name) && tasksAnsweredHere(mine)) return (await local(sid, request.body, cards, 'ligado')).response;
    if (call?.name === 'sessao_enviar' && mine && deps.recados) {
      const sent = await local(sid, request.body, cards, 'ligado', true);
      if (!sent.passOn) return sent.response;
    }
    const letGo = new AbortController();
    const forwarding = deps.forward(meta.mcpPort, request, letGo.signal).catch((): GateResponse => BAD_GATEWAY);
    let forwarded: GateResponse | 'desligado';
    if (message && answersWithoutPc(message, mine)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silent = new Promise<'sem-resposta'>((resolve) => {
        timer = setTimeout(() => resolve('sem-resposta'), localAnswerMs);
      });
      const first = await Promise.race([forwarding, silent]);
      clearTimeout(timer);
      if (first === 'sem-resposta') {
        letGo.abort();
        log(`[oraculo] portão: o PC não respondeu ${String(message.method)} da sessão ${sid} em ${localAnswerMs} ms; respondi daqui.`);
        return (await local(sid, request.body, cards, 'sem-resposta')).response;
      }
      forwarded = first;
    } else {
      forwarded = await forwarding;
    }
    if (forwarded !== 'desligado') return withGateTools(request.body, forwarded, cards !== null, tasksAnsweredHere(mine));
    if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, body: '' };
    // Nothing reached the PC: a `sessao_enviar` the recados passed on is theirs again, now with the PC off. A session the
    // PC has no picture of is made here (nothing of the PC serves it).
    return (await local(sid, request.body, cards, 'desligado', true, mine ? picture : (deps.pictureWithoutPc?.(sid) ?? picture))).response;
  };
}

export interface TunnelForwardOptions {
  /** The TCP connection must complete within this (default `CONNECT_MS`). */
  readonly connectMs?: number;
  /** Silence on the connection once connected (default 10 min: a tool may run that long on the PC); then a 502. */
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
  return (port, request, signal) =>
    new Promise((resolve) => {
      let settled = false;
      const socket = open(port);
      const finish = (value: GateResponse | 'desligado'): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', letGo);
        socket.setTimeout(0);
        resolve(value);
      };
      // The gate answered it itself: drop the connection (a 502 nobody reads).
      const letGo = (): void => {
        socket.destroy();
        finish(BAD_GATEWAY);
      };
      if (signal?.aborted) return letGo();
      signal?.addEventListener('abort', letGo, { once: true });
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
        // The socket is handed to the request already connected, so the request's own `timeout` never fires (revisão
        // do #483): the silence is watched on the socket itself. A PC that took the call and froze is a 502, never
        // the PC off: the call may have run there.
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timeout')));
        socket.once('error', () => finish(BAD_GATEWAY));
        const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
        for (const [name, value] of Object.entries(request.headers)) if (!name.startsWith('x-donel-')) headers[name] = value;
        if (request.authorization) headers.Authorization = request.authorization;
        if (request.body) headers['Content-Length'] = String(Buffer.byteLength(request.body));
        const outgoing = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: request.method, headers, createConnection: () => socket }, (res) => {
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
          ...(typeof req.headers.host === 'string' ? { host: req.headers.host } : {}),
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
        // The port it listens on (port 0 = one the system picked): `<dir>/portao` tells it to who delivers here.
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
