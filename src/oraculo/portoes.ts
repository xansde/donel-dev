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
// - `retrato` `{retrato}` (t-d461e003): the picture of that machine's sessions, made there (retrato-satelite.ts); an
//   older one than the one kept is ignored (`{ok, guardado}`).
// - `recados` `{entregues?: [id]}` (t-d461e003): the satellite took those; answers what still waits for that machine
//   (`{recados: [{id, message}]}`): the messages for its sessions (the Líder único's to the Dalton, with the PC off).

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
import { callerFromPicture, leaderTaskContext, ledgerCallRefusal, type BoardPicture, type PictureSession } from './portao';
import { parseRemotePicture, type RemotePictures } from './retrato-satelite';

export const GATES_DIR = 'portoes';
export const GATE_PATH_PREFIX = '/v1/portao/';
export const GATE_TOOL_PATH = '/v1/portao/ferramenta';
export const GATE_NOTICE_PATH = '/v1/portao/aviso';
export const GATE_LINK_PATH = '/v1/portao/ligacao';
export const GATE_PICTURE_PATH = '/v1/portao/retrato';
export const GATE_INBOX_PATH = '/v1/portao/recados';
/** A machine's picture (each board once, with its arrows): up to this. */
export const MAX_GATE_PICTURE_BYTES = 16 * 1024 * 1024;
const GATE_PATHS: ReadonlySet<string> = new Set([GATE_TOOL_PATH, GATE_NOTICE_PATH, GATE_LINK_PATH, GATE_PICTURE_PATH, GATE_INBOX_PATH]);
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
  return { projectPath, placeId, text, leaderText, ...(typeof key === 'string' ? { key } : {}) };
}

export interface GateToolRoutesDeps {
  /** The daemon's (guarded) ledger. */
  readonly ledger: () => LedgerService;
  /** The recados of this daemon: only the renewal step before a task (`antesDaTarefa`) is used here. */
  readonly recados?: Pick<GateRecados, 'antesDaTarefa'> | null;
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
      return run(name, body, resolved.caller, resolved.call, resolved.onBoard, resolved.aroundCaller);
    }
    const call = parsed.call;
    const caller = callerFromPicture(sessao);
    if (typeof caller === 'string') return json(200, { ok: false, text: caller });
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
    if (path === GATE_TOOL_PATH) {
      try {
        return await tool(name, body);
      } catch (error) {
        log(`[oraculo] portão ${name}: erro na ferramenta: ${error instanceof Error ? error.message : String(error)}`);
        return json(500, { error: 'erro no Oráculo' });
      }
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
    if (!deps.notice) return null;
    const message = noticeOf(body.aviso);
    if (!message) return json(400, { error: 'aviso inválido' });
    await deps.notice(message);
    return json(200, { ok: true });
  };
}
