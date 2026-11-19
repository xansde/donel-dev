// Passo 9 (t-5358d400), PR 3 — the owner's chat with the Líder único in the entregador apart. Its rows wait in
// `<dir>/chat-local.json` (the same format as `celular-local.json`, chat only), written by the entregador alone; the
// decisions and the tasks he asks for stay in `celular-local.json`, the registro's. The consumer, the transcriber and the
// Líder's answer (`/local/celular/chat-responder`) run here, so the conversation goes on with the registro down.
//
// `oraculo.mjs --separar-chat` moves the chat rows from `celular-local.json` to `chat-local.json`, with both daemons
// stopped (the original is kept as `celular-local.json.antes-separar-<hora>`); `--juntar-chat` brings them back. Each row
// lives in one file at a time, under its own id: the phone sending the same id again finds it, never a second one.

import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import type { MobileHandler } from '../main/celular/server';
import { createChatAudioWorker, CHAT_AUDIO_TIMEOUT_MS, DAEMON_WHISPER_URL } from './chat-audio';
import { startChatArquivoSweep } from './chat-arquivo';
import { createChatCelularConsumer, createChatCelularQueue, parseChatReplies, type ChatCelularReplies } from './chat-celular';
import { chatResponder } from './chat-responder';
import { CELULAR_LOCAL_FILE, createCelularLocalStore, type CelularLocalStore } from './celular-local';
import { createCelularV2Handler } from './celular-v2';
import { isChatRoute } from './celular-frente';
import { readBoardConfig } from './board-client';
import { DECISOES_CONFIG_FILE } from './decisoes';
import type { GlossarioStore } from './glossario';
import type { GateRecadosHandle } from './recados';
import type { Relay } from './relay';
import { whisperServerTranscriber } from '../main/celular/transcrever';

/** The chat's rows with the entregador apart. */
export const CHAT_LOCAL_FILE = 'chat-local.json';
/** The consumer's wait for the Líder's answers (one consumer runs at a time: the registro's, or the entregador's). */
export const CHAT_REPLIES_FILE = 'chat-celular-respostas.json';

/**
 * The end of the Líder's transcript read for his answers to the phone: enough to hold the turn that read one. A turn
 * that reads a phone message and answers it after long tool calls passes 600 KB (19/11: the #dcd0176a was read 628 KB
 * before his answer). Read only while a message waits for him.
 */
export const CHAT_TAIL_BYTES = 2 * 1024 * 1024;

/** The last `bytes` of a file; `null` = unreadable. */
export async function readTail(path: string, bytes: number): Promise<string | null> {
  try {
    const handle = await openFile(path, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** The phone chat's wait for answers on disk (temp → rename, 600); an unreadable file starts empty. */
export function repliesStore(file: string): { load(): ChatCelularReplies | null; save(state: ChatCelularReplies): void } {
  return {
    load: () => {
      try {
        return parseChatReplies(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    save: (state) => {
      writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}

/** `"fila": "local"` in decisoes.json (read at each call): the phone app's queues live on this machine. */
export function phoneQueueLocal(dir: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dir, DECISOES_CONFIG_FILE), 'utf8')) as { fila?: unknown }).fila === 'local';
  } catch {
    return false;
  }
}

interface QueueFile {
  versao: 1;
  decisoes: unknown[];
  pedidas: unknown[];
  chat: Array<{ id: string }>;
  /** The owner's transcription corrections waiting for the Líder (#512): the chat's queue, so they move with it. */
  correcoes?: Array<{ id: string }>;
}

function readQueueFile(file: string): QueueFile | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const raw = JSON.parse(text) as QueueFile;
  if (raw?.versao !== 1 || !Array.isArray(raw.decisoes) || !Array.isArray(raw.pedidas) || !Array.isArray(raw.chat) || (raw.correcoes !== undefined && !Array.isArray(raw.correcoes))) throw new Error(`${file} não é a fila local do celular`);
  return raw;
}

function writeQueueFile(file: string, data: QueueFile): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file);
}

const stamp = (now: number): string => new Date(now).toISOString().replace(/[:.]/g, '-');

function keepAside(file: string, suffix: string): string {
  const aside = `${file}.${suffix}`;
  copyFileSync(file, aside);
  chmodSync(aside, 0o400);
  return aside;
}

/**
 * The chat rows of `celular-local.json` go to `chat-local.json` (both daemons stopped; the caller checks). The original
 * is kept aside; `chat-local.json` is written first, so a cut halfway leaves the rows in both files, never in none.
 */
export function separarChat(dir: string, now: number = Date.now()): { readonly mensagens: number; readonly guardado: string | null } {
  const chatFile = join(dir, CHAT_LOCAL_FILE);
  if (existsSync(chatFile)) throw new Error(`${chatFile} já existe: o chat já está separado (rode --juntar-chat antes)`);
  const celularFile = join(dir, CELULAR_LOCAL_FILE);
  const celular = readQueueFile(celularFile);
  const guardado = celular ? keepAside(celularFile, `antes-separar-${stamp(now)}`) : null;
  writeQueueFile(chatFile, { versao: 1, decisoes: [], pedidas: [], chat: celular?.chat ?? [], correcoes: celular?.correcoes ?? [] });
  if (celular) writeQueueFile(celularFile, { ...celular, chat: [], correcoes: [] });
  return { mensagens: celular?.chat.length ?? 0, guardado };
}

/**
 * The way back: the chat rows of `chat-local.json` return to `celular-local.json` (both daemons stopped). A row of the
 * same id is the newer copy and replaces the old one (never two lines of one id); `chat-local.json` is set aside.
 */
export function juntarChat(dir: string, now: number = Date.now()): { readonly mensagens: number; readonly guardado: string | null } {
  const chatFile = join(dir, CHAT_LOCAL_FILE);
  const chat = readQueueFile(chatFile);
  if (!chat) throw new Error(`não há ${chatFile}: o chat não está separado`);
  const celularFile = join(dir, CELULAR_LOCAL_FILE);
  const celular = readQueueFile(celularFile);
  const guardado = celular ? keepAside(celularFile, `antes-juntar-${stamp(now)}`) : null;
  const merged = <T extends { id: string }>(old: readonly T[] | undefined, moved: readonly T[] | undefined): T[] => {
    const ids = new Set((moved ?? []).map((row) => row.id));
    return [...(old ?? []).filter((row) => !ids.has(row.id)), ...(moved ?? [])];
  };
  writeQueueFile(celularFile, {
    ...celular,
    versao: 1,
    decisoes: celular?.decisoes ?? [],
    pedidas: celular?.pedidas ?? [],
    chat: merged(celular?.chat, chat.chat),
    correcoes: merged(celular?.correcoes, chat.correcoes),
  });
  renameSync(chatFile, `${chatFile}.juntado-${stamp(now)}`);
  return { mensagens: chat.chat.length, guardado };
}

const answer = (status: number, value: unknown) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
const notFound = (): ReturnType<MobileHandler> => ({ status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ erro: 'nao-encontrada' }) });

export interface EntregadorChat {
  /** The phone's chat routes (`/api/v2/chat…`, `ping`); off (no `"fila": "local"`) = 404, as the registro's server. */
  readonly handler: MobileHandler;
  /** `/local/celular/chat-responder` (chat_lider.py); `null` = not this route. */
  readonly responder: (method: string, path: string, body: string) => Promise<{ status: number; headers: Record<string, string>; body: string } | null>;
  start(): void;
  stop(): void;
}

/** The chat in the entregador apart: `chat-local.json`, its consumer to the Líder único here, the transcriber. */
export function createEntregadorChat(deps: {
  readonly dir: string;
  readonly home: string;
  readonly recados: Pick<GateRecadosHandle, 'deliverLocal' | 'stateOf' | 'transcriptOf'>;
  /** Where a message goes when the Líder único is not here: the registro's relay, through the notices on disk. */
  readonly relay: Pick<Relay, 'send' | 'pending' | 'byKey'>;
  /** The paired phone that signed (the registro's `celular.json`, read only). */
  readonly verify: (message: string, signatureHex: string) => { readonly name: string } | null;
  /** What the transcriber learns from the owner's corrections: apart, written by the entregador alone. */
  readonly glossario: GlossarioStore;
  readonly log?: (line: string) => void;
}): EntregadorChat {
  const { dir } = deps;
  const log = deps.log ?? ((line: string) => console.log(line));
  let store: CelularLocalStore | null = null;
  const chatFile = join(dir, CHAT_LOCAL_FILE);
  try {
    store = createCelularLocalStore(chatFile);
    // Separated without --separar-chat: the rows still in celular-local.json would wait for nobody.
    const left = readQueueFile(join(dir, CELULAR_LOCAL_FILE));
    if (!existsSync(chatFile) && (left?.chat.length ?? 0) + (left?.correcoes?.length ?? 0) > 0) {
      log(`[chat-celular] o chat ainda está em ${CELULAR_LOCAL_FILE}: rode oraculo.mjs --separar-chat com os dois parados. O chat fica desligado aqui.`);
      store = null;
    }
  } catch (error) {
    log(`[chat-celular] ${CHAT_LOCAL_FILE} ilegível; o chat do celular fica desligado: ${error instanceof Error ? error.message : String(error)}`);
    store = null;
  }
  const local = (): boolean => store !== null && phoneQueueLocal(dir);
  let consumer: ReturnType<typeof createChatCelularConsumer> | null = null;
  const kick = (): void => void consumer?.round().catch((error: unknown) => log(`[celular-v2] rodada chat falhou: ${error instanceof Error ? error.message : String(error)}`));
  let audioWorker: ReturnType<typeof createChatAudioWorker> | null = null;
  if (store) {
    try {
      audioWorker = createChatAudioWorker({
        store,
        transcribe: whisperServerTranscriber({ url: process.env.DONEL_WHISPER_URL || DAEMON_WHISPER_URL, timeoutMs: CHAT_AUDIO_TIMEOUT_MS }),
        kick,
        log,
      });
    } catch (error) {
      log(`[chat-audio] transcritor desligado: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const v2 = store
    ? createCelularV2Handler({
        verify: deps.verify,
        doc: () => null,
        store,
        readProof: async () => ({ kind: 'sumiu' }),
        arvoreFile: join(deps.home, '.donel', 'estado-derivado', 'arvore.json'),
        kick,
        audio: (id) => audioWorker?.enqueue(id),
        glossario: deps.glossario,
        log,
      })
    : null;
  const replyScript = process.env.DONEL_CHAT_RESPONDER || join(deps.home, 'bin', 'rotinas', 'chat-lider', 'chat_lider.py');
  consumer = createChatCelularConsumer({
    queue: () => {
      if (local() && store) return store.chat;
      const config = readBoardConfig(join(dir, DECISOES_CONFIG_FILE));
      return config ? createChatCelularQueue(config) : null;
    },
    relay: deps.relay,
    waitMs: 0,
    local: {
      deliver: deps.recados.deliverLocal,
      state: deps.recados.stateOf,
      tail: async (sid: string) => {
        const path = await deps.recados.transcriptOf(sid);
        return path ? readTail(path, CHAT_TAIL_BYTES) : null;
      },
    },
    store: repliesStore(join(dir, CHAT_REPLIES_FILE)),
    replyHint: (shortId) => `Para responder no celular: ssh ${userInfo().username}@${hostname()} python3 ${replyScript} responder ${shortId} - <<'FIM'\n<sua resposta>\nFIM`,
    log,
  });
  let stopSweep: (() => void) | null = null;
  return {
    handler: (request) => (isChatRoute(request.url) && local() && v2 ? v2(request) : notFound()),
    responder: async (method, path, body) => {
      if (method !== 'POST' || path !== '/local/celular/chat-responder') return null;
      if (!store) return answer(503, { erro: 'a fila do celular está desligada' });
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        // an empty body is an empty object
      }
      const replied = chatResponder(store, input);
      return answer(replied.status, replied.body);
    },
    start() {
      consumer?.start();
      audioWorker?.start();
      if (store) stopSweep = startChatArquivoSweep(store.arquivoDir, log);
    },
    stop() {
      consumer?.stop();
      audioWorker?.stop();
      stopSweep?.();
      stopSweep = null;
    },
  };
}
