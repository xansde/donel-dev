// Pedir pelo Oráculo, por voz — o celular grava, converte para WAV (16 kHz, mono) e manda ao PC. O áudio fica
// guardado em `<userData>/pedidos-audio/` e é transcrito NESTE PC pelo servidor whisper.cpp local que o OpenWhispr
// já mantém no ar (127.0.0.1:8178, o modelo que ele baixou). Nada sai da máquina: sem chave de API, sem nuvem.
// Com o PC ocupado a transcrição leva minutos, então ela é um trabalho: o celular manda, recebe o id e pergunta
// até ficar pronto. O dono lê, corrige e só então envia o pedido (o texto, não o áudio, é o que o Líder lê).

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** ~4 min de fala em WAV 16 kHz mono 16 bits. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** O servidor do OpenWhispr. `DONEL_WHISPER_URL` troca (outro whisper.cpp local). */
export const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8178';
/** Com a RAM cheia, 8 s de fala levaram 2 min (medido em 06/11). */
const TRANSCRIBE_TIMEOUT_MS = 6 * 60_000;
/** Um resultado que o celular não buscou some depois disto. */
const JOB_TTL_MS = 30 * 60_000;

/** Confere o cabeçalho RIFF/WAVE PCM: o PC só guarda e transcreve áudio que ele sabe o que é. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE' && ascii(12, 16) === 'fmt ';
}

export type Transcribe = (wav: Uint8Array) => Promise<string>;

/** Pede a transcrição ao servidor whisper.cpp (`POST /inference`, multipart). Só endereço local. */
export function whisperServerTranscriber(options: {
  readonly url?: string;
  readonly fetchFn?: typeof fetch;
  readonly language?: string;
}): Transcribe {
  const url = options.url ?? DEFAULT_WHISPER_URL;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') throw new Error('O servidor de transcrição tem de ser deste PC.');
  const fetchFn = options.fetchFn ?? fetch;
  return async (wav) => {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'pedido.wav');
    form.append('response_format', 'json');
    form.append('language', options.language ?? 'pt');
    let response: Response;
    try {
      response = await fetchFn(`${url.replace(/\/$/, '')}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new Error(timedOut ? 'A transcrição demorou demais. O áudio ficou guardado; escreva o pedido.' : 'O OpenWhispr não está aberto neste PC. Abra o OpenWhispr ou escreva o pedido.');
    }
    if (!response.ok) throw new Error(`O transcritor recusou o áudio (${response.status}).`);
    const body = (await response.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (!body || typeof body.text !== 'string') throw new Error('O transcritor não devolveu texto.');
    return body.text.replace(/\s+/g, ' ').trim();
  };
}

export type TranscriptionStatus =
  | { readonly estado: 'transcrevendo' }
  | { readonly estado: 'pronto'; readonly texto: string }
  | { readonly estado: 'falhou'; readonly mensagem: string };

export interface TranscriptionJobs {
  /** Guarda o áudio e põe na fila de transcrição. `audioId` é também o nome do arquivo. */
  start(wav: Uint8Array): { readonly ok: true; readonly audioId: string } | { readonly ok: false; readonly mensagem: string };
  status(audioId: string): TranscriptionStatus | null;
  /** O áudio existe na pasta (o pedido só aponta para áudio que o PC guardou). */
  has(audioId: string): boolean;
  fileOf(audioId: string): string;
}

const AUDIO_ID = /^[0-9a-f]{24}$/;
export const isAudioId = (value: unknown): value is string => typeof value === 'string' && AUDIO_ID.test(value);

export function createTranscriptionJobs(deps: {
  readonly dir: string;
  readonly writeFile: (path: string, bytes: Uint8Array) => void;
  readonly exists: (path: string) => boolean;
  readonly transcribe: Transcribe;
  readonly now?: () => number;
}): TranscriptionJobs {
  const now = deps.now ?? Date.now;
  const jobs = new Map<string, { status: TranscriptionStatus; at: number }>();
  // Uma de cada vez: o servidor whisper processa em série e o PC já anda curto de RAM.
  let chain: Promise<void> = Promise.resolve();
  const fileOf = (audioId: string): string => join(deps.dir, `${audioId}.wav`);

  function prune(): void {
    for (const [id, job] of jobs) if (job.status.estado !== 'transcrevendo' && now() - job.at > JOB_TTL_MS) jobs.delete(id);
  }

  return {
    start(wav) {
      if (wav.length > MAX_AUDIO_BYTES) return { ok: false, mensagem: 'Áudio longo demais (até uns 4 minutos).' };
      if (!isWav(wav)) return { ok: false, mensagem: 'O áudio não chegou em WAV.' };
      prune();
      const audioId = randomBytes(12).toString('hex');
      try {
        deps.writeFile(fileOf(audioId), wav);
      } catch {
        return { ok: false, mensagem: 'Não consegui guardar o áudio no PC.' };
      }
      jobs.set(audioId, { status: { estado: 'transcrevendo' }, at: now() });
      chain = chain.then(async () => {
        let status: TranscriptionStatus;
        try {
          const texto = await deps.transcribe(wav);
          status = texto ? { estado: 'pronto', texto } : { estado: 'falhou', mensagem: 'Não ouvi fala nenhuma no áudio.' };
        } catch (error) {
          status = { estado: 'falhou', mensagem: error instanceof Error ? error.message : 'A transcrição falhou.' };
        }
        jobs.set(audioId, { status, at: now() });
      });
      return { ok: true, audioId };
    },
    status: (audioId) => jobs.get(audioId)?.status ?? null,
    has: (audioId) => isAudioId(audioId) && deps.exists(fileOf(audioId)),
    fileOf,
  };
}
