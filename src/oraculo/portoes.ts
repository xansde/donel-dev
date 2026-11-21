// Canal do Donel fora do PC (t-e195b35c, §1 Satélite) — the gate of another machine (the Homologações runs the same
// bundle as a satellite, `DONEL_PORTAO_SATELITE`) records its sessions' tasks HERE, on the personal VPS's Oráculo, with
// its own credential. Each machine has `<dir>/portoes/<name>.sha256` (the token's sha256, written by
// `scripts/oraculo-vps.sh portao <name>`); deleting the file revokes it, with no restart (read at each call).
//
// The credential reaches only `POST /v1/portao/*` (api.ts); the PC's token does not reach them. Two routes:
//
// - `ferramenta` `{sessao, call: {name, arguments}, chave?, arquivos?}`: the same path as this machine's gate — who the
//   session is from its picture (`callerFromPicture`; the Líder único is refused), the call parsed again from its raw
//   arguments (never trusted as it came), the renewal step of the recados (`antesDaTarefa`), then `runLedgerTool`.
//   A proof file of the session is on the satellite: it comes in `arquivos` (path → base64), and no path is ever read
//   on this machine. Answers `{ok, text, image?, tarefa?}`: `tarefa` is the task the call left, for the satellite's
//   notices after it (item 5: the delivery to the Revisores of outside the chain, the verdict to the Dev).
// - `ligacao` `{sessao, para}`: may this session send to `para` with no arrow, by the review link of item 5 (a delivery
//   of this board waiting for a verdict, between who delivered it and a live Revisor of outside the chain)? `{ligado}`.
// - `aviso` `{aviso: OwnerMessage}`: a notice the satellite's recados could not deliver there (the target runs on
//   another machine, or it is the Líder único) goes to this daemon's relay, which the PC delivers when it answers.
//   `{ok, entregue}` (t-3f32edb1): `'lider'` or `{placeId}` = a queue here has it; `null` = the PC's relay.
// - `retrato` `{retrato}` (t-d461e003): the picture of that machine's sessions, made there (retrato-satelite.ts); an
//   older one than the one kept is ignored (`{ok, guardado}`).
// - `recados` `{entregues?: [id]}` (t-d461e003): the satellite took those; answers what still waits for that machine
//   (`{recados: [{id, message}]}`): the messages for its sessions (the Líder único's to the Dalton, with the PC off).
// - `abrir` `{call}` (t-d461e003, only this machine's own gate): the Líder único's `sessao_abrir` on a board another
//   machine pictures, queued for it (`{ok, text}`; `{conhecido: false}` = no machine has that board).
// - `aberturas` `{respostas?, kit?, telas?}` (t-d461e003): the satellite's answers to the openings it made; what still
//   waits for it, and the kit of roles when its hash changed (`{aberturas, kit?, telas}`, abrir-satelite.ts). t-69eefa2c:
//   `telas` in = the screens it captured for the orders asked of it; `telas` out = the screen orders waiting for it.
// - `tela` `{pasta, lugar}` (t-69eefa2c, only this machine's own gate): the Líder único's `sessao_ver_tela` of a place
//   of another machine, asked of its satellite (tela-satelite.ts); `{ok, text}`, or `{conhecido: false}`.
// - `renovar` `{sessao, tarefa}` (t-8406f473): the renewal before a card move of the entregador apart (its board is
//   there, the ledger here): the task of a closed place whose successor is the session follows it. `{ok}`.
// - `fila` `{aviso: OwnerMessage}` (passo 9, only this machine's own entregador, `isLocalGate`): a message of its
//   sessions for a place of another machine goes into that machine's queue here (the registro alone writes them);
//   `{maquina}`, or `{maquina: null}` when no fresh picture has that place (the entregador then takes its old way).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maxProofBytes, PROOF_FILE_TYPES } from '../shared/ledger/contract';
import { reviewLink } from '../shared/ledger/revisao';
import { listedPlaces } from '../shared/mindscape/address';
import { isLedgerToolName, parseLedgerToolCall, type LedgerToolCall } from '../shared/ledger/tools';
import { runLedgerTool, type LedgerCaller, type LedgerService, type RemoteProofFetch } from '../main/ledger-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { OracleRequest, OracleResponse } from './api';
import type { GateRecados } from './gate-recados';
import { callerFromPicture, leaderTaskContext, ledgerCallRefusal, withLiveOwner, type BoardPicture, type LiveOwnerSource, type PictureSession } from './portao';
import { parseRemotePicture, type RemotePictures } from './retrato-satelite';
import { openCallOf, openingsBodyOf, type RemoteOpenings } from './abrir-satelite';
import { screenAnswersOf, type RemoteScreens } from './tela-satelite';

export const GATES_DIR = 'portoes';
export const GATE_PATH_PREFIX = '/v1/portao/';
export const GATE_TOOL_PATH = '/v1/portao/ferramenta';
export const GATE_NOTICE_PATH = '/v1/portao/aviso';
export const GATE_LINK_PATH = '/v1/portao/ligacao';
export const GATE_PICTURE_PATH = '/v1/portao/retrato';
export const GATE_INBOX_PATH = '/v1/portao/recados';
/** t-d461e003 — the Líder único's opening on another machine's board (only the local gate: the entregador apart). */
export const GATE_OPEN_PATH = '/v1/portao/abrir';
/** t-d461e003 — a satellite's openings: its answers in, the orders waiting for it out (abrir-satelite.ts). */
export const GATE_OPENINGS_PATH = '/v1/portao/aberturas';
export const GATE_QUEUE_PATH = '/v1/portao/fila';
/** t-8406f473 — the renewal before a card move of the entregador apart (its board is there, the ledger here). */
export const GATE_RENEW_PATH = '/v1/portao/renovar';
/** t-69eefa2c — the Líder único's look at a screen of another machine (only the local gate: the entregador apart). */
export const GATE_SCREEN_PATH = '/v1/portao/tela';
/** A machine's picture (each board once, with its arrows): up to this. */
export const MAX_GATE_PICTURE_BYTES = 16 * 1024 * 1024;
const GATE_PATHS: ReadonlySet<string> = new Set([GATE_TOOL_PATH, GATE_NOTICE_PATH, GATE_LINK_PATH, GATE_PICTURE_PATH, GATE_INBOX_PATH, GATE_OPEN_PATH, GATE_OPENINGS_PATH, GATE_QUEUE_PATH, GATE_RENEW_PATH, GATE_SCREEN_PATH]);
/** The tool route's body may carry the delivery's proof files (base64): up to this. */
export const MAX_GATE_BODY_BYTES = 64 * 1024 * 1024;
const GATE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;
const json = (status: number, value: unknown): OracleResponse => ({ status, headers: JSON_HEADERS, body: JSON.stringify(value) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** name → sha256 (hex) of every machine's gate with a well-formed file; a bad name or hash is skipped. */
export function readGateHashes(dir: string): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(join(dir, GATES_DIR));
  } catch {
    return hashes;
  }
  for (const file of names) {
    const name = file.endsWith('.sha256') ? file.slice(0, -'.sha256'.length) : '';
    if (!GATE_NAME.test(name)) continue;
    try {
      const hash = readFileSync(join(dir, GATES_DIR, file), 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hash)) hashes.set(name, hash);
    } catch {
      // unreadable: not a gate
    }
  }
  return hashes;
}

/**
 * Passo 9 (t-5358d400) — the gate of this machine's own entregador (its unit apart from the registro): the mark
 * `<dir>/portoes/<name>.local` beside its hash (read at each call; deleting it takes the Líder único off that gate).
 * Only that gate may carry the Líder único, who lives on this machine; a satellite's never does.
 */
export function isLocalGate(dir: string, name: string): boolean {
  return GATE_NAME.test(name) && existsSync(join(dir, GATES_DIR, `${name}.local`));
}

/** A session's picture as the satellite sent it: the shape `callerFromPicture` reads, or `null`. */
function pictureOf(value: unknown): PictureSession | null {
  if (!isRecord(value) || !isRecord(value.quemSou) || !Array.isArray(value.listar)) return null;
  if (value.board !== undefined && (!isRecord(value.board) || !isRecord(value.board.cards) || !Array.isArray(value.board.links))) return null;
  return value as unknown as PictureSession;
}

/** The proof files the satellite read for this call, served to `importProof` by path; any other path is refused. */
function proofFetchOf(files: Record<string, unknown>): RemoteProofFetch {
  return async (path) => {
    const data = files[path];
    if (typeof data !== 'string') return { ok: false, error: `"${path}": o arquivo não veio da máquina da sessão. Mande de novo.` };
    const ext = /\.([A-Za-z0-9]{2,5})$/.exec(path)?.[1]?.toLowerCase() ?? '';
    const mediaType = PROOF_FILE_TYPES[ext];
    if (!mediaType) return { ok: false, error: `"${path}": a prova em arquivo é print, vídeo ou protótipo HTML (${Object.keys(PROOF_FILE_TYPES).join(', ')}).` };
    const bytes = Buffer.from(data, 'base64');
    if (bytes.byteLength > maxProofBytes(mediaType)) return { ok: false, error: `"${path}" passa de ${maxProofBytes(mediaType) / 1024 / 1024} MB.` };
    return { ok: true, bytes, ext, mediaType };
  };
}

/** An `OwnerMessage` as the satellite (or the registro, to the entregador) sent it, or `null`. */
export function noticeOf(value: unknown): OwnerMessage | null {
  if (!isRecord(value)) return null;
  const { projectPath, placeId, text, leaderText, key } = value;
  if (typeof projectPath !== 'string' || typeof placeId !== 'string' || typeof text !== 'string' || typeof leaderText !== 'string') return null;
  if (key !== undefined && typeof key !== 'string') return null;
  if (text.length > 20_000 || leaderText.length > 20_000) return null;
  // Recado vencido: when it was first queued, so its age goes on counting in the next queue.
  const sentAt = typeof value.sentAt === 'number' && Number.isFinite(value.sentAt) && value.sentAt > 0 ? value.sentAt : undefined;
  return { projectPath, placeId, text, leaderText, ...(typeof key === 'string' ? { key } : {}), ...(sentAt !== undefined ? { sentAt } : {}) };
}

export interface GateToolRoutesDeps {
  /** The daemon's (guarded) ledger. */
  readonly ledger: () => LedgerService;
  /** The recados of this daemon: only the renewal steps (before a task, before a card move) are used here. */
  readonly recados?: Pick<GateRecados, 'antesDaTarefa' | 'antesDoCartao'> | null;
  /** The owner's phone shows "virou tarefa" (as this machine's gate does). */
  readonly linkPedido?: (pedidoId: string, tarefa: { readonly id: string; readonly titulo: string }) => void;
  /** A notice for the PC to deliver (this daemon's relay). Absent = the `aviso` route answers 404. */
  readonly notice?: (message: OwnerMessage) => Promise<unknown>;
  /** t-d461e003 — the other machines' pictures and queues (retrato-satelite.ts). Absent = `retrato`/`recados` answer 404. */
  readonly pictures?: Pick<RemotePictures, 'accept' | 'inbox'>;
  /**
   * Passo 9 — the Líder único's `tarefa_*` from the entregador of this machine (`isLocal`, never a satellite's gate), on
   * the boards of this registro's own picture. Absent = the Líder único is refused, as on every gate before the split.
   */
  readonly leader?: { readonly isLocal: (name: string) => boolean; readonly picture: () => BoardPicture | null };
  /**
   * t-d461e003 — the openings on other machines' boards (abrir-satelite.ts): `abrir` only from this machine's own gate
   * (`isLocal`, the entregador apart), `aberturas` from a satellite. Absent = both answer 404.
   */
  readonly openings?: { readonly queue: RemoteOpenings; readonly isLocal: (name: string) => boolean };
  /**
   * t-69eefa2c — the screens of other machines' sessions (tela-satelite.ts): `tela` only from this machine's own gate,
   * their orders and answers in the `aberturas` exchange. Absent = `tela` answers 404 and `aberturas` carries none.
   */
  readonly screens?: { readonly queue: RemoteScreens; readonly isLocal: (name: string) => boolean };
  /**
   * Passo 9 — the entregador apart queues here a message for a place of another machine (`fila`), only from the gate
   * marked local. Absent = the route answers 404 (no entregador apart: it queues itself).
   */
  readonly remoteQueue?: { readonly isLocal: (name: string) => boolean; readonly queue: (message: OwnerMessage) => Promise<string | null> };
  /** t-d461e003 — an owner session alive in this machine's tmux or another's fresh picture is never orphan (`withLiveOwner`). */
  readonly liveOwner?: LiveOwnerSource;
  readonly log?: (line: string) => void;
}

/** The routes of a gate's credential (`name`: whose); `null` = not one of them. */
export type GateRoutes = (name: string, request: OracleRequest, path: string) => Promise<OracleResponse | null>;

export function createGateToolRoutes(deps: GateToolRoutesDeps): GateRoutes {
  const log = deps.log ?? ((line: string) => console.log(line));

  async function tool(name: string, body: Record<string, unknown>): Promise<OracleResponse> {
    const sessao = pictureOf(body.sessao);
    const raw = isRecord(body.call) ? body.call : null;
    if (!sessao || !raw || typeof raw.name !== 'string' || !isLedgerToolName(raw.name) || (raw.arguments !== undefined && !isRecord(raw.arguments))) return json(400, { error: 'sessao ou call inválido' });
    const args: Record<string, unknown> = { ...((raw.arguments as Record<string, unknown> | undefined) ?? {}) };
    if (typeof body.chave === 'string' && args.chave === undefined) args.chave = body.chave;
    const parsed = parseLedgerToolCall(raw.name, args);
    if (!parsed.ok) return json(200, { ok: false, text: parsed.reason });
    if (sessao.quemSou.liderUnico === true && deps.leader?.isLocal(name)) {
      const resolved = leaderTaskContext(deps.leader.picture(), sessao, parsed.call, (id) => deps.ledger().load().doc.tasks[id]?.projectPath);
      if (typeof resolved === 'string') return json(200, { ok: false, text: resolved });
      return run(name, body, withLiveOwner(resolved.caller, deps.liveOwner), resolved.call, resolved.onBoard, resolved.aroundCaller);
    }
    const call = parsed.call;
    const pictured = callerFromPicture(sessao);
    if (typeof pictured === 'string') return json(200, { ok: false, text: pictured });
    const caller = withLiveOwner(pictured, deps.liveOwner);
    const refused = ledgerCallRefusal(call);
    if (refused) return json(200, { ok: false, text: refused });
    return run(name, body, caller, call, sessao, caller);
  }

  /** The renewal step (`around`: who and which board it sees), the call on the ledger, the owner's request linked. */
  async function run(name: string, body: Record<string, unknown>, caller: LedgerCaller, call: LedgerToolCall, aroundMine: PictureSession, around: LedgerCaller): Promise<OracleResponse> {
    if (deps.recados) {
      try {
        await deps.recados.antesDaTarefa(around, aroundMine, call);
      } catch (error) {
        log(`[oraculo] portão ${name}: antes de ${call.tool} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Always `remote`: a path is the session's machine's, never read here.
    const result = await runLedgerTool(deps.ledger(), caller, call, proofFetchOf(isRecord(body.arquivos) ? body.arquivos : {}));
    if (result.ok && call.tool === 'tarefa_criar' && call.pedidoDoDono && deps.linkPedido) {
      try {
        const created = JSON.parse(result.text) as { id?: unknown };
        if (typeof created.id === 'string') deps.linkPedido(call.pedidoDoDono, { id: created.id, titulo: call.titulo ?? call.pedido.slice(0, 80) });
      } catch (error) {
        log(`[oraculo] portão ${name}: ligar o pedido ${call.pedidoDoDono} à tarefa falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return json(200, { ok: result.ok, text: result.text, ...(result.image ? { image: result.image } : {}), ...(result.ok ? taskAfter(result.text) : {}) });
  }

  /** The task a call answered with an `id` left, as the ledger has it now. */
  function taskAfter(answerText: string): { tarefa?: unknown } {
    try {
      const answer = JSON.parse(answerText) as { id?: unknown };
      const task = typeof answer.id === 'string' ? deps.ledger().load().doc.tasks[answer.id] : undefined;
      return task ? { tarefa: task } : {};
    } catch {
      return {};
    }
  }

  function link(body: Record<string, unknown>): OracleResponse {
    const sessao = pictureOf(body.sessao);
    const from = sessao?.quemSou.lugar;
    if (!sessao || typeof from !== 'string' || typeof body.para !== 'string') return json(400, { error: 'sessao ou para inválido' });
    return json(200, { ligado: reviewLink(deps.ledger().load().doc, sessao.board, listedPlaces(sessao.listar), from, body.para) });
  }

  return async (name, request, path) => {
    if (request.method !== 'POST' || !GATE_PATHS.has(path)) return null;
    let body: unknown;
    try {
      body = JSON.parse(request.body);
    } catch {
      return json(400, { error: 'corpo não é JSON' });
    }
    if (!isRecord(body)) return json(400, { error: 'corpo não é um objeto' });
    if (path === GATE_LINK_PATH) {
      try {
        return link(body);
      } catch (error) {
        log(`[oraculo] portão ${name}: erro na ligação: ${error instanceof Error ? error.message : String(error)}`);
        return json(500, { error: 'erro no Oráculo' });
      }
    }
    if (path === GATE_RENEW_PATH) {
      const sessao = pictureOf(body.sessao);
      if (!sessao || typeof body.tarefa !== 'string' || !body.tarefa) return json(400, { error: 'sessao ou tarefa inválido' });
      const caller = callerFromPicture(sessao);
      if (typeof caller === 'string') return json(200, { ok: false, text: caller });
      try {
        await deps.recados?.antesDoCartao?.(caller, sessao, body.tarefa);
        return json(200, { ok: true });
      } catch (error) {
        log(`[oraculo] portão ${name}: renovação antes do cartão falhou: ${error instanceof Error ? error.message : String(error)}`);
        return json(500, { error: 'erro no Oráculo' });
      }
    }
    if (path === GATE_TOOL_PATH) {
      try {
        return await tool(name, body);
      } catch (error) {
        log(`[oraculo] portão ${name}: erro na ferramenta: ${error instanceof Error ? error.message : String(error)}`);
        return json(500, { error: 'erro no Oráculo' });
      }
    }
    if (path === GATE_OPEN_PATH || path === GATE_OPENINGS_PATH) {
      if (!deps.openings) return null;
      if (path === GATE_OPEN_PATH) {
        if (!deps.openings.isLocal(name)) return json(403, { error: 'só o portão desta máquina pede abertura' });
        const call = openCallOf(body.call);
        if (!call) return json(400, { error: 'call inválido' });
        const outcome = deps.openings.queue.request(call);
        return json(200, outcome ? { ok: outcome.kind !== 'error', text: outcome.text ?? '' } : { conhecido: false });
      }
      const input = openingsBodyOf(body);
      if (!input) return json(400, { error: 'respostas inválidas' });
      const telas = screenAnswersOf(body.telas);
      if (!telas) return json(400, { error: 'telas inválidas' });
      return json(200, { ...deps.openings.queue.exchange(name, input.respostas, input.kitHash), ...(deps.screens ? { telas: deps.screens.queue.exchange(name, telas) } : {}) });
    }
    if (path === GATE_SCREEN_PATH) {
      if (!deps.screens) return null;
      if (!deps.screens.isLocal(name)) return json(403, { error: 'só o portão desta máquina pede a tela de outra' });
      if (typeof body.pasta !== 'string' || !body.pasta || typeof body.lugar !== 'string' || !body.lugar) return json(400, { error: 'pasta ou lugar inválido' });
      const answer = await deps.screens.queue.ask(body.pasta, body.lugar);
      return json(200, answer ? { ok: answer.ok, text: answer.text } : { conhecido: false });
    }
    if (path === GATE_PICTURE_PATH || path === GATE_INBOX_PATH) {
      if (!deps.pictures) return null;
      if (path === GATE_PICTURE_PATH) {
        const picture = parseRemotePicture(body.retrato);
        if (!picture) return json(400, { error: 'retrato inválido' });
        return json(200, { ok: true, guardado: deps.pictures.accept(name, picture) });
      }
      const taken = body.entregues;
      if (taken !== undefined && (!Array.isArray(taken) || taken.length > 500 || !taken.every((id) => typeof id === 'string'))) return json(400, { error: 'entregues inválido' });
      return json(200, { recados: deps.pictures.inbox(name, (taken as string[] | undefined) ?? []) });
    }
    if (path === GATE_QUEUE_PATH) {
      if (!deps.remoteQueue) return null;
      if (!deps.remoteQueue.isLocal(name)) return json(403, { error: 'só o portão local põe recado na fila de outra máquina' });
      const message = noticeOf(body.aviso);
      if (!message || !message.key) return json(400, { error: 'aviso inválido' });
      return json(200, { maquina: await deps.remoteQueue.queue(message) });
    }
    if (!deps.notice) return null;
    const message = noticeOf(body.aviso);
    if (!message) return json(400, { error: 'aviso inválido' });
    const to = await deps.notice(message);
    // t-3f32edb1 — where it went (the Líder único's queue here, a place's, or the PC's relay = null): the satellite tells
    // its sender. A satellite of before reads only `ok`.
    return json(200, { ok: true, entregue: to === 'lider' ? to : isRecord(to) && typeof to.placeId === 'string' ? { placeId: to.placeId } : null });
  };
}
