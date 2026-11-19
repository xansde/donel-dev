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
//
// t-d461e003 (item 4, 19/11): with the PC away the personal VPS knew this machine's boards only from the PC's last
// picture. `createSatelliteSync` sends it this machine's own picture (retrato-local's, compact: retrato-satelite.ts) and
// takes the messages waiting there for this machine's sessions (the Líder único's to the Dalton), into its recados.

import { promises as fsp } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { checkLocalProofFile, nodeLedgerProofFs, type LedgerCaller, type LedgerToolAnswer } from '../main/ledger-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { ConfigIoDeps } from '../main/config-store';
import type { LedgerTask } from '../shared/ledger/contract';
import type { LedgerToolCall } from '../shared/ledger/tools';
import type { BoardPicture, GateLedgerContext, PictureSession } from './portao';
import { GATE_INBOX_PATH, GATE_LINK_PATH, GATE_NOTICE_PATH, GATE_PICTURE_PATH, GATE_TOOL_PATH } from './portoes';
import { compactPicture } from './retrato-satelite';
import { createRelay } from './relay';

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

export interface SatelliteNotices {
  /** Queues the notice on disk (a repeat of the same key joins it) and tries to send what waits; never throws for the network. */
  send(message: OwnerMessage): Promise<unknown>;
  /** One round: what waits goes to the personal VPS's relay, oldest first; the first failure ends the round. */
  flush(): Promise<void>;
  start(): void;
  stop(): void;
}

const NOTICE_RETRY_MS = 15_000;

/**
 * The satellite's recados `relay`: a notice for another machine (or the Líder único) to the personal VPS's relay. It
 * waits on disk first (`file`, the relay's own format: temp → rename, an unreadable file set aside), so a personal
 * VPS that is down or oscillating loses nothing: what waits goes every 15 s, and after a restart (revisão do #486).
 * The personal VPS's relay joins a repeat of the same key, so a send whose answer was lost is safe to send again.
 */
export function createSatelliteNotice(deps: SatelliteDeps & { readonly file: string; readonly io: ConfigIoDeps; readonly log?: (line: string) => void }): SatelliteNotices {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? SATELLITE_TIMEOUT_MS;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_NOTICE_PATH}`;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] satélite: ${line}`));
  const outbox = createRelay({ filePath: deps.file, io: deps.io });
  let flushing: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function round(): Promise<void> {
    const token = deps.token();
    if (!token) return;
    for (const item of outbox.pending()) {
      const result = await post(url, token, JSON.stringify({ aviso: { ...item.message, key: item.key } }), timeoutMs);
      if (typeof result !== 'object' || result.status !== 200) {
        log(`aviso ${item.id} espera: o Oráculo da VPS pessoal ${typeof result === 'object' ? `respondeu HTTP ${result.status}` : 'não respondeu'}.`);
        return;
      }
      outbox.ack(item.id, item.message.placeId ? { placeId: item.message.placeId } : 'lider');
    }
  }

  const flush = (): Promise<void> => {
    flushing ??= round()
      .catch((error: unknown) => log(`avisos pendentes: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        flushing = null;
      });
    return flushing;
  };

  return {
    async send(message) {
      const sent = await outbox.send(message, 0);
      await flush();
      return sent;
    },
    flush,
    start() {
      if (timer) return;
      timer = setInterval(() => void flush(), NOTICE_RETRY_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

const SYNC_MS = 10_000;
/** The same picture is sent again after this (the personal VPS may have restarted from an older file). */
const PICTURE_AGAIN_MS = 5 * 60_000;
/** A picture with every board's arrows takes longer to go up. */
const PICTURE_TIMEOUT_MS = 60_000;

export interface SatelliteSync {
  /** One round: the picture when it changed (or every 5 min), then the messages waiting for this machine. */
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * t-d461e003 — this machine's picture to the personal VPS's Oráculo, and the messages waiting there for its sessions:
 * each one goes to `deliver` (this machine's recados, keyed by the message's key: the same one handed twice joins the
 * first) and is said taken in the next call. An item `deliver` refuses (`false`, or it threw) stays there for the next
 * round. Never throws for the network.
 */
export function createSatelliteSync(
  deps: SatelliteDeps & {
    readonly picture: () => BoardPicture | null;
    /** This machine's live tmux sessions (folder sids): only they go in the picture. */
    readonly live: () => ReadonlySet<string>;
    readonly deliver: (message: OwnerMessage) => Promise<boolean>;
    readonly now?: () => number;
    readonly intervalMs?: number;
    readonly log?: (line: string) => void;
  },
): SatelliteSync {
  const post = deps.post ?? postJson;
  const now = deps.now ?? Date.now;
  const base = deps.url.replace(/\/+$/, '');
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] satélite: ${line}`));
  let sent: { body: string; at: number } | null = null;
  let taken: string[] = [];
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function sendPicture(token: string): Promise<void> {
    const { at: _at, ...rest } = compactPicture(deps.picture(), 0, deps.live());
    const body = JSON.stringify(rest);
    const at = now();
    if (sent && sent.body === body && at - sent.at < PICTURE_AGAIN_MS) return;
    const result = await post(`${base}${GATE_PICTURE_PATH}`, token, `{"retrato":{"at":${at},${body.slice(1)}}`, PICTURE_TIMEOUT_MS);
    if (typeof result === 'object' && result.status === 200) sent = { body, at };
    else log(`retrato não foi: o Oráculo da VPS pessoal ${typeof result === 'object' ? `respondeu HTTP ${result.status}` : 'não respondeu'}.`);
  }

  /** Says what was taken and reads what waits; `null` = no answer (what was taken is said again next time). */
  async function exchange(token: string): Promise<Array<{ id: string; message: OwnerMessage }> | null> {
    const saying = taken;
    const result = await post(`${base}${GATE_INBOX_PATH}`, token, JSON.stringify({ entregues: saying }), deps.timeoutMs ?? SATELLITE_TIMEOUT_MS);
    if (typeof result !== 'object' || result.status !== 200) return null;
    taken = taken.filter((id) => !saying.includes(id));
    try {
      const parsed = JSON.parse(result.body) as { recados?: unknown };
      if (!Array.isArray(parsed.recados)) return [];
      return parsed.recados.filter((item): item is { id: string; message: OwnerMessage } => {
        const message = (item as { message?: Record<string, unknown> } | null)?.message;
        return typeof (item as { id?: unknown })?.id === 'string' && !!message && typeof message.projectPath === 'string' && typeof message.placeId === 'string' && typeof message.text === 'string' && typeof message.leaderText === 'string';
      });
    } catch {
      return [];
    }
  }

  async function once(): Promise<void> {
    const token = deps.token();
    if (!token) return;
    await sendPicture(token);
    const waiting = await exchange(token);
    if (!waiting?.length) return;
    for (const item of waiting) {
      if (taken.includes(item.id)) continue;
      try {
        if (await deps.deliver(item.message)) taken.push(item.id);
      } catch (error) {
        log(`recado ${item.id} para ${item.message.placeId} fica para a próxima volta: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (taken.length) await exchange(token);
  }

  const round = (): Promise<void> => {
    running ??= once()
      .catch((error: unknown) => log(`volta do retrato e dos recados: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        running = null;
      });
    return running;
  };

  return {
    round,
    start() {
      if (timer) return;
      void round();
      timer = setInterval(() => void round(), deps.intervalMs ?? SYNC_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
