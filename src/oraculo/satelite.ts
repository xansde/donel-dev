// Canal do Donel fora do PC (t-e195b35c, §1 Satélite) — the gate of the Homologações (`DONEL_PORTAO_SATELITE`) has
// no ledger: its sessions' `tarefa_*` are recorded on the personal VPS's Oráculo, through `POST /v1/portao/ferramenta`
// with this machine's gate token (`<dir>/portao.token`, 600; src/oraculo/portoes.ts reads it there).
//
// The call goes as the session sent it, with or without its `chave`: without one, the Oráculo keys the write by who
// calls and what it asks (`withCallKey`), so the same call repeated (a lost answer, a gate restarted in the middle, a
// model that tries again) answers the first write, as on the personal VPS's own gate and on the PC. A cut after the call
// went out is tried once more, the same body. A connection that never opened = nothing was sent: the session hears it
// and tries again. A proof file of the session is read here (the same checks as the local gate) and goes with the call;
// no path is read on the other machine.
//
// Item 5 (Dev and Revisor of outside the chain) with the ledger on the other machine: the Oráculo answers a call with
// the task it left (`tarefa`), kept here a while (`createSatelliteTaskMemory`) for the recados' notices after it (the
// delivery to the Revisores, the verdict to the Dev); the review link of a `sessao_enviar` with no arrow is asked of it
// (`POST /v1/portao/ligacao`, `createSatelliteReviewLink`).

import { promises as fsp } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { checkLocalProofFile, nodeLedgerProofFs, type LedgerCaller, type LedgerToolAnswer } from '../main/ledger-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { LedgerTask } from '../shared/ledger/contract';
import type { LedgerToolCall } from '../shared/ledger/tools';
import type { GateLedgerContext, PictureSession } from './portao';
import { GATE_LINK_PATH, GATE_NOTICE_PATH, GATE_TOOL_PATH } from './portoes';

export const SATELLITE_TIMEOUT_MS = 15_000;
/** The proof files of one delivery, together (base64 grows it by a third; the route takes 64 MB). */
const MAX_FILES_BYTES = 40 * 1024 * 1024;
export const SATELLITE_DOWN = 'O Oráculo da VPS pessoal não respondeu; nada foi gravado. Tente de novo.';
const SATELLITE_LOST = 'O Oráculo da VPS pessoal não respondeu a tempo; a chamada pode ter sido gravada. Repita a mesma chamada, igual: o registro reconhece a repetição e devolve a primeira gravação.';
const NO_TOKEN = 'Este portão não tem a credencial do Oráculo da VPS pessoal (portao.token); nada foi gravado. Avise o Líder do quadro.';

/** What one POST gave: an answer, a connection that never opened (nothing sent), or a cut after it went out. */
export type SatellitePost = { readonly status: number; readonly body: string } | 'sem-conexao' | 'caiu';

export function postJson(url: string, token: string, body: string, timeoutMs: number): Promise<SatellitePost> {
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const finish = (value: SatellitePost): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let outgoing: ReturnType<typeof httpRequest>;
    try {
      outgoing = httpRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => finish('caiu'));
      });
    } catch {
      resolve('sem-conexao');
      return;
    }
    const timer = setTimeout(() => {
      outgoing.destroy(new Error('timeout'));
      finish(connected ? 'caiu' : 'sem-conexao');
    }, timeoutMs);
    outgoing.on('socket', (socket) => {
      if (!socket.connecting) connected = true;
      socket.once('connect', () => {
        connected = true;
      });
    });
    outgoing.on('error', () => finish(connected ? 'caiu' : 'sem-conexao'));
    outgoing.end(body);
  });
}

export interface SatelliteDeps {
  /** The personal VPS's Oráculo API (`http://<tailscale>:47816`). */
  readonly url: string;
  /** This machine's gate token; `null` = none (read at each call: writing the file turns it on). */
  readonly token: () => string | null;
  readonly timeoutMs?: number;
  readonly post?: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost>;
}

/** The tasks the personal VPS's Oráculo answered with, the last ones (the notices after a call read them). */
export function createSatelliteTaskMemory(max = 200): { remember(task: LedgerTask): void; taskOf(id: string): LedgerTask | undefined } {
  const tasks = new Map<string, LedgerTask>();
  return {
    remember(task) {
      tasks.delete(task.id);
      tasks.set(task.id, task);
      if (tasks.size > max) tasks.delete(tasks.keys().next().value as string);
    },
    taskOf: (id) => tasks.get(id),
  };
}

/** The proof files the delivery names, read here; a string = why not. */
async function proofFiles(call: LedgerToolCall): Promise<Record<string, string> | string> {
  if (call.tool !== 'tarefa_entregar') return {};
  const files: Record<string, string> = {};
  let total = 0;
  for (const proof of call.provas) {
    if (proof.tipo !== 'arquivo' || files[proof.caminho] !== undefined) continue;
    const checked = await checkLocalProofFile(nodeLedgerProofFs, proof.caminho);
    if ('error' in checked) return checked.error;
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(checked.real);
    } catch {
      return `Não consegui ler "${proof.caminho}" nesta máquina.`;
    }
    total += bytes.byteLength;
    if (total > MAX_FILES_BYTES) return `As provas em arquivo desta entrega passam de ${MAX_FILES_BYTES / 1024 / 1024} MB juntas: mande o vídeo grande como link.`;
    files[proof.caminho] = bytes.toString('base64');
  }
  return files;
}

function answerOf(post: { readonly status: number; readonly body: string }, onTask?: (task: LedgerTask) => void): LedgerToolAnswer {
  let parsed: { ok?: unknown; text?: unknown; image?: { base64?: unknown; mimeType?: unknown }; error?: unknown; tarefa?: unknown } = {};
  try {
    parsed = JSON.parse(post.body) as typeof parsed;
  } catch {
    // below
  }
  if (post.status === 200 && typeof parsed.ok === 'boolean' && typeof parsed.text === 'string') {
    const task = parsed.tarefa as { id?: unknown; state?: unknown; events?: unknown } | undefined;
    if (onTask && task && typeof task.id === 'string' && typeof task.state === 'string' && Array.isArray(task.events)) onTask(task as LedgerTask);
    const image = parsed.image && typeof parsed.image.base64 === 'string' && typeof parsed.image.mimeType === 'string' ? { base64: parsed.image.base64, mimeType: parsed.image.mimeType } : undefined;
    return { ok: parsed.ok, text: parsed.text, ...(image ? { image } : {}) };
  }
  const why = typeof parsed.error === 'string' ? `: ${parsed.error}` : '';
  return { ok: false, text: `O Oráculo da VPS pessoal recusou a chamada (HTTP ${post.status}${why}).` };
}

/** `runLedger` of the satellite's gate: the call goes to the personal VPS's Oráculo. */
export function createSatelliteLedger(
  deps: SatelliteDeps & { readonly onTask?: (task: LedgerTask) => void },
): (caller: LedgerCaller, call: LedgerToolCall, context: GateLedgerContext) => Promise<LedgerToolAnswer> {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? SATELLITE_TIMEOUT_MS;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_TOOL_PATH}`;
  return async (_caller, call, context) => {
    const token = deps.token();
    if (!token) return { ok: false, text: NO_TOKEN };
    const args = context.args;
    const files = await proofFiles(call);
    if (typeof files === 'string') return { ok: false, text: files };
    const body = JSON.stringify({ sessao: context.mine, call: { name: call.tool, arguments: args }, ...(Object.keys(files).length ? { arquivos: files } : {}) });
    // A big delivery takes longer to go up: a second more per MB.
    const wait = timeoutMs + Math.floor(Buffer.byteLength(body) / (1024 * 1024)) * 1000;
    const first = await post(url, token, body, wait);
    if (first === 'sem-conexao') return { ok: false, text: SATELLITE_DOWN };
    if (first !== 'caiu') return answerOf(first, deps.onTask);
    // Cut after it went out: the same body (the session's key, or the Oráculo's key of the same call), never a second write.
    const again = await post(url, token, body, wait);
    if (typeof again === 'object') return answerOf(again, deps.onTask);
    return { ok: false, text: SATELLITE_LOST };
  };
}

/**
 * The review link (item 5) of a `sessao_enviar` with no arrow, asked of the personal VPS's Oráculo, which has the
 * deliveries waiting for a verdict. `null` = it did not answer: the gate passes the message on to the PC, which decides.
 */
export function createSatelliteReviewLink(deps: SatelliteDeps): (mine: PictureSession, from: string, to: string) => Promise<boolean | null> {
  const post = deps.post ?? postJson;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_LINK_PATH}`;
  return async (mine, from, to) => {
    const token = deps.token();
    if (!token || mine.quemSou.lugar !== from) return null;
    const result = await post(url, token, JSON.stringify({ sessao: mine, para: to }), deps.timeoutMs ?? 5_000);
    if (typeof result !== 'object' || result.status !== 200) return null;
    try {
      const answer = JSON.parse(result.body) as { ligado?: unknown };
      return typeof answer.ligado === 'boolean' ? answer.ligado : null;
    } catch {
      return null;
    }
  };
}

/** The satellite's recados `relay`: a notice for another machine (or the Líder único) to the personal VPS's relay. */
export function createSatelliteNotice(deps: SatelliteDeps): (message: OwnerMessage) => Promise<unknown> {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? SATELLITE_TIMEOUT_MS;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_NOTICE_PATH}`;
  return async (message) => {
    const token = deps.token();
    if (!token) throw new Error('sem portao.token');
    const body = JSON.stringify({ aviso: message });
    // The relay joins a repeat of the same key: one more try after a cut is safe.
    let result = await post(url, token, body, timeoutMs);
    if (result === 'caiu') result = await post(url, token, body, timeoutMs);
    if (typeof result !== 'object' || result.status !== 200) throw new Error(`aviso não entrou no Oráculo da VPS pessoal (${typeof result === 'object' ? `HTTP ${result.status}` : result})`);
    return result;
  };
}
