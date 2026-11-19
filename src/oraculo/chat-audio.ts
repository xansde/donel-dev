// t-268ed62a — the owner's voice messages from the phone chat, transcribed here, on the VPS (contract v1.2,
// ~/seazone/_scratch/celular-tailnet/contrato-audio.md). The phone gets its "ok" as soon as the audio is on disk
// (celular-v2.ts); this queue turns it into words, one audio at a time, by the resident transcriber on 127.0.0.1
// (`DONEL_WHISPER_URL`, default :8179 here; the PC's OpenWhispr stays on :8178), and kicks the chat round so the
// Líder gets it in seconds.
//
// t-b03fdec8 — an audio sent in parts (contract v1.6) is transcribed in pieces of ~5 min, one at a time through the
// limiter (chat-audio-longo.ts), and still ends as ONE text for the Líder (kept whole in `<id>.txt` too). An audio whose
// parts stopped coming is closed here after 30 min without one, as interrupted, with what came.
//
// What it keeps: every audio ends `transcrito` or `falhou`, once (the store refuses a second answer); a restart puts
// the ones still `transcrevendo` back in the queue (`start`); the log never carries the owner's words.

import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TranscribeError, type Transcribe } from '../main/celular/transcrever';
import { CHAT_AUDIO_DIR, CHAT_AUDIO_MIMES, CHAT_AUDIO_PARTE_MS, duracaoTexto, transcricaoFile, type AudioPendente, type CelularLocalStore } from './celular-local';
import { audioHeader, emendar, ffmpegMidia, limitedTranscriber, minutosTexto, planPedacos, type AudioMidia, type Pedaco, type TranscribePedaco } from './chat-audio-longo';

/** The daemon's transcriber (the PC's OpenWhispr is :8178). */
export const DAEMON_WHISPER_URL = 'http://127.0.0.1:8179';
export const CHAT_AUDIO_TIMEOUT_MS = 60_000;
/** A connection refused is the transcriber restarting: tried again this many times, then `falhou`. */
const CONNECTION_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;
/** The audio is kept this long (the owner's words never vanish while he might ask for them). */
export const CHAT_AUDIO_KEEP_MS = 7 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 60 * 60_000;
/** Contract v1.6: an audio in parts with no part and no `fim` for this long is closed by the VPS, as interrupted. */
export const CHAT_AUDIO_SEM_FIM_MS = 30 * 60_000;
const CLOSE_EVERY_MS = 60_000;
/**
 * A piece the limiter had no slot for (or that ran out of time) is tried again this much later, the audio left
 * `transcrevendo` and the worker free for the others; after this many tries it is marked as not transcribed.
 */
const ADIAR_MS = 10 * 60_000;
const MAX_ADIAMENTOS = 6;
/** The marks the Líder reads inside a long transcription (contract v1.6). */
export const MARCA_INTERROMPIDA = '(gravação interrompida)';
export const marcaBuraco = (ms: number): string => `(gravação interrompida; faltou o trecho de ${minutosTexto(ms)})`;
const marcaFalha = (ms: number, motivo: string): string => `(trecho de ${minutosTexto(ms)} não transcrito: ${motivo})`;

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
  /** Closes, as interrupted, the audios in parts with no part for 30 min (also every minute after `start`). */
  fecharParados(): void;
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
  /** The long path's ffmpeg (default: /usr/bin/ffmpeg at nice 10). */
  readonly midia?: AudioMidia;
  /** One piece of a long audio (default: curl to the transcriber through `limitador.py pesado`). */
  readonly transcribePedaco?: TranscribePedaco;
  /** How long a piece without a slot waits before the audio is tried again (tests). */
  readonly adiarMs?: number;
}): ChatAudioWorker {
  const now = deps.now ?? Date.now;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path));
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const queued = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let sweepTimer: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;
  let midia: AudioMidia | null = deps.midia ?? null;
  let transcribePedaco: TranscribePedaco | null = deps.transcribePedaco ?? null;
  const adiarMs = deps.adiarMs ?? ADIAR_MS;
  /** The pieces a postponed audio already has (in memory: a restart transcribes them again), by audio and piece. */
  const pedacosFeitos = new Map<string, Map<string, { texto: string } | { motivo: string }>>();
  const adiamentos = new Map<string, number>();
  const adiarTimers = new Set<NodeJS.Timeout>();

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

  async function pedacoWithRetries(file: string, quem: string): Promise<{ texto: string } | { motivo: string; adiar?: true }> {
    transcribePedaco ??= limitedTranscriber({ url: process.env.DONEL_WHISPER_URL || DAEMON_WHISPER_URL, tmpOut: (path) => `${path}.json` });
    for (let attempt = 0; ; attempt += 1) {
      try {
        return { texto: (await transcribePedaco(file, { type: 'audio/ogg', quem })).trim() };
      } catch (error) {
        const kind = error instanceof TranscribeError ? error.kind : 'conexao';
        if (kind === 'conexao' && attempt < CONNECTION_RETRIES && !stopped) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        // No slot in the limiter, or out of time: another try later, never a lost stretch of speech.
        if (kind === 'tempo') return { motivo: error instanceof TranscribeError ? error.message : MOTIVOS.tempo, adiar: true };
        return { motivo: MOTIVOS[kind] };
      }
    }
  }

  /**
   * Contract v1.6: each run of parts → wav → pieces of ~5 min → one at a time to the transcriber, in order. A hole
   * between runs, and a piece that gave nothing, are marked where they were. `null` = stopped mid-way (left as it is);
   * `'adiado'` = a piece had no slot: the audio stays `transcrevendo`, the pieces done are kept, and it comes back later.
   */
  async function transcribeLong(job: AudioPendente & { partes: NonNullable<AudioPendente['partes']> }, bytes: Uint8Array): Promise<{ texto: string } | { motivo: string } | 'adiado' | null> {
    midia ??= ffmpegMidia();
    const { trechos, total, interrompido } = job.partes;
    const work = mkdtempSync(join(deps.store.audioDir, `.trabalho-${job.id.slice(0, 8)}-`));
    try {
      // Part 0's header: at the start of the first run (a continuation's joined file opens with it too).
      const header = trechos[0] && (trechos[0].n0 === 0 || job.partes.cabecalho) ? audioHeader(bytes.subarray(trechos[0].inicio, trechos[0].fim), job.mime) : null;
      const ext = CHAT_AUDIO_MIMES[job.mime] ?? 'bin';
      // Every run decoded and planned first: the phone sees "feitos/total" from the start.
      const runs: Array<{ wav: string; pedacos: Pedaco[] } | { erro: string; ms: number }> = [];
      for (const [index, trecho] of trechos.entries()) {
        const body = bytes.subarray(trecho.inicio, trecho.fim);
        const input = join(work, `trecho-${index}.${ext}`);
        writeFileSync(input, index === 0 || !header ? body : header, { mode: 0o600 });
        if (index > 0 && header) appendFileSync(input, body);
        const wav = join(work, `trecho-${index}.wav`);
        try {
          const duracao = await midia.paraWav(input, wav);
          runs.push({ wav, pedacos: planPedacos(duracao, await midia.silencios(wav, duracao)) });
        } catch {
          runs.push({ erro: 'o ffmpeg não leu este trecho', ms: (trecho.n1 - trecho.n0 + 1) * CHAT_AUDIO_PARTE_MS });
        }
      }
      const feitosDoAudio = pedacosFeitos.get(job.id) ?? new Map<string, { texto: string } | { motivo: string }>();
      pedacosFeitos.set(job.id, feitosDoAudio);
      const totalPedacos = runs.reduce((sum, run) => sum + ('pedacos' in run ? run.pedacos.length : 0), 0);
      let feitos = 0;
      deps.store.andamentoAudio(job.id, `0/${totalPedacos}`);
      const partes: string[] = [];
      let falhas: string | null = null;
      let falou = false;
      for (const [index, run] of runs.entries()) {
        if (index > 0) partes.push(marcaBuraco((trechos[index]!.n0 - trechos[index - 1]!.n1 - 1) * CHAT_AUDIO_PARTE_MS));
        if ('erro' in run) {
          partes.push(marcaFalha(run.ms, run.erro));
          falhas ??= run.erro;
          continue;
        }
        let texto = '';
        let anteriorOk = false;
        for (const [n, pedaco] of run.pedacos.entries()) {
          if (stopped) return null;
          const file = join(work, `trecho-${index}-pedaco-${n}.ogg`);
          const key = `${index}:${pedaco.inicio.toFixed(3)}:${pedaco.fim.toFixed(3)}`;
          let result = feitosDoAudio.get(key);
          if (!result) {
            let got: { texto: string } | { motivo: string; adiar?: true };
            try {
              await midia.cortar(run.wav, pedaco.inicio, pedaco.fim, file);
              got = await pedacoWithRetries(file, `chat-audio:${job.id.slice(0, 8)}`);
            } catch {
              got = { motivo: 'o ffmpeg não cortou o pedaço' };
            }
            if (stopped) return null;
            if ('adiar' in got) {
              const tries = (adiamentos.get(job.id) ?? 0) + 1;
              if (tries <= MAX_ADIAMENTOS) {
                adiamentos.set(job.id, tries);
                return 'adiado';
              }
            }
            result = 'texto' in got ? got : { motivo: got.motivo };
            feitosDoAudio.set(key, result);
          }
          feitos += 1;
          deps.store.andamentoAudio(job.id, `${feitos}/${totalPedacos}`);
          if ('texto' in result) {
            if (result.texto) falou = true;
            texto = emendar(texto, result.texto, pedaco.sobrepoe && anteriorOk);
            anteriorOk = result.texto !== '';
          } else {
            falhas ??= result.motivo;
            texto = emendar(texto, marcaFalha((pedaco.fim - pedaco.inicio) * 1000, result.motivo), false);
            anteriorOk = false;
          }
        }
        if (texto) partes.push(texto);
      }
      const last = trechos[trechos.length - 1];
      if (last && total > last.n1 + 1) partes.push(marcaBuraco((total - last.n1 - 1) * CHAT_AUDIO_PARTE_MS));
      if (!falou) return { motivo: falhas ?? SEM_FALA };
      const texto = `${interrompido ? `${MARCA_INTERROMPIDA} ` : ''}${partes.join(' ')}`;
      return { texto };
    } finally {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        // the 7-day sweep takes it
      }
    }
  }

  async function run(id: string): Promise<void> {
    queued.delete(id);
    const job = deps.store.audiosPendentes().find((pending) => pending.id === id);
    if (!job || stopped) return;
    if (job.partes) return runLong({ ...job, partes: job.partes });
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

  async function runLong(job: AudioPendente & { partes: NonNullable<AudioPendente['partes']> }): Promise<void> {
    const started = now();
    let bytes: Uint8Array | null = null;
    try {
      bytes = readFile(job.file);
    } catch {
      // gone: said to the owner and the Líder
    }
    let result: { texto: string } | { motivo: string } | 'adiado' | null;
    try {
      result = bytes ? await transcribeLong(job, bytes) : { motivo: SEM_ARQUIVO };
    } catch (error) {
      result = { motivo: `a transcrição longa falhou (${error instanceof Error ? error.message.slice(0, 120) : 'erro'})` };
    }
    if (result === null || stopped) return;
    if (result === 'adiado') {
      deps.log(`[chat-audio] ${job.id.slice(0, 8)} sem vaga para um pedaço: tento de novo em ${Math.round(adiarMs / 60_000)} min (${adiamentos.get(job.id)}/${MAX_ADIAMENTOS})`);
      const timer = setTimeout(() => {
        adiarTimers.delete(timer);
        enqueue(job.id);
      }, adiarMs);
      timer.unref?.();
      adiarTimers.add(timer);
      return;
    }
    pedacosFeitos.delete(job.id);
    adiamentos.delete(job.id);
    if ('texto' in result) {
      // The whole text beside the audio, before the Líder hears of it (past ~40 thousand characters he reads it there).
      try {
        writeFileSync(transcricaoFile(deps.store.audioDir, job.id), `${result.texto}\n`, { mode: 0o600 });
      } catch (error) {
        deps.log(`[chat-audio] ${job.id.slice(0, 8)} não gravei o .txt: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const done = deps.store.concluirAudio(job.id, result);
    deps.log(
      `[chat-audio] ${job.id.slice(0, 8)} ${duracaoTexto(job.duracao_ms)} em partes (${job.partes.total}, trechos ${job.partes.trechos.length}${job.partes.interrompido ? ', interrompido' : ''}) transcricao=${now() - started}ms ${'texto' in result ? `transcrito (${result.texto.length} caracteres)` : `falhou (${result.motivo})`}${done ? '' : ' (já concluído)'}`,
    );
    if (done) deps.kick('chat');
  }

  function fecharParados(): void {
    for (const aberto of deps.store.audiosAbertos()) {
      if (now() - aberto.ultima_parte_em < CHAT_AUDIO_SEM_FIM_MS) continue;
      try {
        const closed = deps.store.fecharAudioPartes(aberto.id, { partes: 1, duracao_ms: 0, interrompido: true });
        if (!closed.ok || !closed.nova) continue;
        deps.log(`[chat-audio] ${aberto.id.slice(0, 8)} sem fim há 30 min: fechado como interrompido com ${aberto.partes} parte(s) (${closed.estado})`);
        if (closed.estado === 'transcrevendo') enqueue(closed.linha);
        else deps.kick('chat');
      } catch (error) {
        deps.log(`[chat-audio] ${aberto.id.slice(0, 8)} não fechei: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
      fecharParados();
      closeTimer = setInterval(fecharParados, CLOSE_EVERY_MS);
      closeTimer.unref?.();
      const sweep = (): void => sweepChatAudio(deps.store.audioDir, deps.store, now(), deps.log);
      sweep();
      sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
      sweepTimer.unref?.();
    },
    stop() {
      stopped = true;
      if (sweepTimer) clearInterval(sweepTimer);
      if (closeTimer) clearInterval(closeTimer);
      for (const timer of adiarTimers) clearTimeout(timer);
      adiarTimers.clear();
      sweepTimer = null;
      closeTimer = null;
    },
    enqueue,
    fecharParados,
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
export function sweepChatAudio(audioDir: string, store: Pick<CelularLocalStore, 'audiosPendentes' | 'audiosAbertos'>, nowMs: number, log: (line: string) => void): void {
  let names: string[];
  try {
    names = readdirSync(audioDir);
  } catch {
    return;
  }
  const waiting = new Set(store.audiosPendentes().map((pending) => pending.file));
  // The parts of an audio still coming (contract v1.6) are never swept.
  for (const aberto of store.audiosAbertos()) waiting.add(join(audioDir, aberto.id));
  let removed = 0;
  for (const name of names) {
    const file = join(audioDir, name);
    if (waiting.has(file)) continue;
    try {
      const stat = statSync(file);
      if (nowMs - stat.mtimeMs > CHAT_AUDIO_KEEP_MS) {
        if (stat.isDirectory()) rmSync(file, { recursive: true, force: true });
        else unlinkSync(file);
        removed += 1;
      }
    } catch {
      // gone meanwhile
    }
  }
  if (removed) log(`[chat-audio] faxina: ${removed} áudio(s) com mais de 7 dias apagado(s) de ${CHAT_AUDIO_DIR}/`);
}
