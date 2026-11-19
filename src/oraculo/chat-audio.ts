// t-268ed62a — the owner's voice messages from the phone chat, transcribed here, on the VPS (contract v1.2,
// ~/seazone/_scratch/celular-tailnet/contrato-audio.md). The phone gets its "ok" as soon as the audio is on disk
// (celular-v2.ts); this queue turns it into words, one audio at a time, by the resident transcriber on 127.0.0.1
// (`DONEL_WHISPER_URL`, default :8179 here; the PC's OpenWhispr stays on :8178), and kicks the chat round so the
// Líder gets it in seconds.
//
// What it keeps: every audio ends `transcrito` or `falhou`, once (the store refuses a second answer); a restart puts
// the ones still `transcrevendo` back in the queue (`start`); the log never carries the owner's words.

import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { TranscribeError, type Transcribe } from '../main/celular/transcrever';
import { CHAT_AUDIO_DIR, CHAT_AUDIO_MIMES, duracaoTexto, type CelularLocalStore } from './celular-local';

/** The daemon's transcriber (the PC's OpenWhispr is :8178). */
export const DAEMON_WHISPER_URL = 'http://127.0.0.1:8179';
export const CHAT_AUDIO_TIMEOUT_MS = 60_000;
/** A connection refused is the transcriber restarting: tried again this many times, then `falhou`. */
const CONNECTION_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;
/** The audio is kept this long (the owner's words never vanish while he might ask for them). */
export const CHAT_AUDIO_KEEP_MS = 7 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 60 * 60_000;

/** The owner reads this in the app, beside the audio; the Líder reads it in the notice. */
const MOTIVOS: Record<TranscribeError['kind'], string> = {
  conexao: 'o transcritor da VPS não respondeu',
  tempo: 'a transcrição passou de 1 minuto',
  recusou: 'o transcritor recusou o áudio',
  'sem-texto': 'o transcritor não devolveu texto',
};
const SEM_FALA = 'não ouvi fala no áudio';
const SEM_ARQUIVO = 'o arquivo do áudio não está na VPS';

export interface ChatAudioWorker {
  /** Requeues the audios a restart left `transcrevendo` and starts the 7-day sweep. */
  start(): void;
  stop(): void;
  /** A new audio (the same id twice is one job). */
  enqueue(id: string): void;
  /** Resolves when the queue is empty (tests). */
  idle(): Promise<void>;
}

export function createChatAudioWorker(deps: {
  readonly store: CelularLocalStore;
  readonly transcribe: Transcribe;
  readonly kick: (fila: 'chat') => void;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  readonly retryDelayMs?: number;
  readonly readFile?: (path: string) => Uint8Array;
}): ChatAudioWorker {
  const now = deps.now ?? Date.now;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path));
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const queued = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let sweepTimer: NodeJS.Timeout | null = null;

  async function transcribeWithRetries(bytes: Uint8Array, fileName: string, type: string): Promise<{ texto: string } | { motivo: string }> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const texto = (await deps.transcribe(bytes, { fileName, type })).trim();
        return texto ? { texto } : { motivo: SEM_FALA };
      } catch (error) {
        const kind = error instanceof TranscribeError ? error.kind : 'conexao';
        if (kind === 'conexao' && attempt < CONNECTION_RETRIES && !stopped) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return { motivo: MOTIVOS[kind] };
      }
    }
  }

  async function run(id: string): Promise<void> {
    queued.delete(id);
    const job = deps.store.audiosPendentes().find((pending) => pending.id === id);
    if (!job || stopped) return;
    const started = now();
    let bytes: Uint8Array | null = null;
    try {
      bytes = readFile(job.file);
    } catch {
      // gone (a hand on the folder): said to the owner and the Líder, never a row waiting forever
    }
    const result = bytes ? await transcribeWithRetries(bytes, `${id}.${CHAT_AUDIO_MIMES[job.mime] ?? 'bin'}`, job.mime) : { motivo: SEM_ARQUIVO };
    // Stopped mid-way (the daemon going down): the row stays `transcrevendo` and the next boot transcribes it again.
    if (stopped) return;
    const done = deps.store.concluirAudio(id, result);
    const waited = Math.max(0, started - Date.parse(job.criada_em));
    deps.log(
      `[chat-audio] ${id.slice(0, 8)} ${duracaoTexto(job.duracao_ms)} espera=${waited}ms transcricao=${now() - started}ms ${'texto' in result ? 'transcrito' : `falhou (${result.motivo})`}${done ? '' : ' (já concluído)'}`,
    );
    if (done) deps.kick('chat');
  }

  function enqueue(id: string): void {
    if (stopped || queued.has(id)) return;
    queued.add(id);
    chain = chain.then(() => run(id)).catch((error: unknown) => deps.log(`[chat-audio] ${id.slice(0, 8)} erro: ${error instanceof Error ? error.message : String(error)}`));
  }

  return {
    start() {
      stopped = false;
      for (const pending of deps.store.audiosPendentes()) enqueue(pending.id);
      const sweep = (): void => sweepChatAudio(deps.store.audioDir, deps.store, now(), deps.log);
      sweep();
      sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
      sweepTimer.unref?.();
    },
    stop() {
      stopped = true;
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = null;
    },
    enqueue,
    async idle() {
      let current: Promise<void>;
      do {
        current = chain;
        await current;
      } while (current !== chain);
    },
  };
}

/** Deletes the audio older than 7 days, never one still waiting for its transcription. */
export function sweepChatAudio(audioDir: string, store: Pick<CelularLocalStore, 'audiosPendentes'>, nowMs: number, log: (line: string) => void): void {
  let names: string[];
  try {
    names = readdirSync(audioDir);
  } catch {
    return;
  }
  const waiting = new Set(store.audiosPendentes().map((pending) => pending.file));
  let removed = 0;
  for (const name of names) {
    const file = join(audioDir, name);
    if (waiting.has(file)) continue;
    try {
      if (nowMs - statSync(file).mtimeMs > CHAT_AUDIO_KEEP_MS) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      // gone meanwhile
    }
  }
  if (removed) log(`[chat-audio] faxina: ${removed} áudio(s) com mais de 7 dias apagado(s) de ${CHAT_AUDIO_DIR}/`);
}
