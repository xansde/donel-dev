// t-b03fdec8 — a voice message of any length (contract v1.6, ~/seazone/_scratch/celular-tailnet/contrato-audio-longo.md):
// the joined file is cut into pieces of ~5 min and each piece goes to the resident transcriber (127.0.0.1:8179, the
// same one as the short audio) one at a time, through the VPS's limiter (`limitador.py pesado`: a free slot and the
// build-pesado.lock queue), so a 2 h audio never runs beside a build. The words come back in order, as ONE text.
//
// - Cut: the silence nearest to 5 min between 4 and 6 min (ffmpeg `silencedetect`); with no silence there, a dry cut at
//   5 min with 2 s of overlap, and the splice drops the words both pieces heard.
// - A hole (parts that never reached the VPS) splits the file into runs; each later run gets part 0's header (the
//   container's start) so ffmpeg reads it, and the text marks the hole where it was.
// - What a piece could not give is marked where it was; nothing that came is dropped.
//
// Only the owner's audio and words go through here: the log has sizes and times, never the text.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TranscribeError } from '../main/celular/transcrever';

/** A piece's target length, the window its cut looks for a silence in, and the overlap of a dry cut (seconds). */
export const PEDACO_ALVO_S = 300;
export const PEDACO_MIN_S = 240;
export const PEDACO_MAX_S = 360;
export const SOBREPOSICAO_S = 2;

export interface Pedaco {
  readonly inicio: number;
  readonly fim: number;
  /** Starts inside the previous piece (a dry cut): its first words may repeat the previous piece's last ones. */
  readonly sobrepoe: boolean;
}

/** Pure: where to cut `duracao` seconds, given the silences `[start, end]` ffmpeg found. */
export function planPedacos(duracao: number, silencios: ReadonlyArray<readonly [number, number]>): Pedaco[] {
  const pedacos: Pedaco[] = [];
  let inicio = 0;
  let sobrepoe = false;
  while (duracao - inicio > PEDACO_MAX_S) {
    const alvo = inicio + PEDACO_ALVO_S;
    let corte: number | null = null;
    for (const [start, end] of silencios) {
      const meio = (start + end) / 2;
      if (meio < inicio + PEDACO_MIN_S || meio > inicio + PEDACO_MAX_S) continue;
      if (corte === null || Math.abs(meio - alvo) < Math.abs(corte - alvo)) corte = meio;
    }
    if (corte !== null) {
      pedacos.push({ inicio, fim: corte, sobrepoe });
      inicio = corte;
      sobrepoe = false;
    } else {
      pedacos.push({ inicio, fim: alvo, sobrepoe });
      inicio = alvo - SOBREPOSICAO_S;
      sobrepoe = true;
    }
  }
  pedacos.push({ inicio, fim: duracao, sobrepoe });
  return pedacos;
}

/** Pure: the silences in ffmpeg's `silencedetect` lines (a silence still open at the end runs to `fimPadrao`). */
export function parseSilencios(stderr: string, fimPadrao: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let aberto: number | null = null;
  for (const match of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Number(match[2]);
    if (!Number.isFinite(at)) continue;
    if (match[1] === 'start') aberto = at;
    else if (aberto !== null) {
      out.push([aberto, at]);
      aberto = null;
    }
  }
  if (aberto !== null) out.push([aberto, fimPadrao]);
  return out;
}

const palavraNormal = (word: string): string =>
  word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Pure: `a` and then `b`. When `b` began inside `a` (a dry cut), the longest run of 2 to 20 words that ends `a` and
 * starts `b` (case, accent and punctuation aside) is said once. A single word is never dropped: a repetition is better
 * than a lost word.
 */
export function emendar(a: string, b: string, sobrepoe: boolean): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (!sobrepoe) return `${left} ${right}`;
  const wa = left.split(/\s+/);
  const wb = right.split(/\s+/);
  const na = wa.map(palavraNormal);
  const nb = wb.map(palavraNormal);
  for (let k = Math.min(20, wa.length, wb.length); k >= 2; k -= 1) {
    let same = true;
    for (let i = 0; i < k; i += 1) {
      if (na[na.length - k + i] !== nb[i] || !nb[i]) {
        same = false;
        break;
      }
    }
    if (same) return wb.length === k ? left : `${left} ${wb.slice(k).join(' ')}`;
  }
  return `${left} ${right}`;
}

/** "~M min", at least 1. */
export const minutosTexto = (ms: number): string => `~${Math.max(1, Math.round(ms / 60_000))} min`;

/**
 * The container's start in part 0, which a later run needs before its bytes to be read: in webm the bytes before the
 * first Cluster; in ogg the first two pages (OpusHead and OpusTags). `null` = not found (the run goes without it).
 */
export function audioHeader(bytes: Uint8Array, mime: string): Uint8Array | null {
  if (mime === 'audio/webm') {
    const cluster = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
    return cluster > 0 ? bytes.subarray(0, cluster) : null;
  }
  if (mime === 'audio/ogg') {
    let offset = 0;
    for (let page = 0; page < 2; page += 1) {
      if (offset + 27 > bytes.length || String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'OggS') return null;
      const segments = bytes[offset + 26]!;
      if (offset + 27 + segments > bytes.length) return null;
      let size = 27 + segments;
      for (let i = 0; i < segments; i += 1) size += bytes[offset + 27 + i]!;
      offset += size;
    }
    return offset <= bytes.length ? bytes.subarray(0, offset) : null;
  }
  return null;
}

/** Whether a part opens with the container's header (webm: the EBML magic; ogg: a first page, BOS). */
export function abreComCabecalho(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'audio/webm') return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === 'audio/ogg') return bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 4)) === 'OggS' && (bytes[5]! & 0x02) !== 0;
  return false;
}

/** What the long path needs from ffmpeg: injectable (the tests do not run it). */
export interface AudioMidia {
  /** Any audio ffmpeg reads → wav 16 kHz mono; resolves with its length in seconds. */
  paraWav(entrada: string, wav: string): Promise<number>;
  /** The silences of a wav. */
  silencios(wav: string, duracao: number): Promise<Array<[number, number]>>;
  /** `[inicio, fim)` of a wav into a file the transcriber takes (ogg/opus, well under its 8 MB). */
  cortar(wav: string, inicio: number, fim: number, saida: string): Promise<void>;
}

/** Exit codes: the limiter's "no slot" (EX_TEMPFAIL) and `timeout`'s. */
const SEM_VAGA = 75;
const TIMEOUT = 124;

const FFMPEG = '/usr/bin/ffmpeg';
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

function run(cmd: string, args: readonly string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      // Killed by our own timeout: the same as `timeout`'s 124 (a piece out of time), never a connection error.
      const killed = error && ((error as { killed?: unknown }).killed === true || typeof (error as { signal?: unknown }).signal === 'string');
      const code = !error ? 0 : killed ? TIMEOUT : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** ffmpeg at low priority (nice 10): decoding 10 min of opus takes about a second. */
export function ffmpegMidia(ffmpeg = process.env.DONEL_FFMPEG || FFMPEG): AudioMidia {
  const ff = (args: readonly string[]) => run('nice', ['-n', '10', ffmpeg, '-nostdin', '-hide_banner', ...args], FFMPEG_TIMEOUT_MS);
  return {
    async paraWav(entrada, wav) {
      const r = await ff(['-loglevel', 'error', '-y', '-i', entrada, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', wav]);
      if (r.code !== 0 || !existsSync(wav)) throw new Error(`o ffmpeg não leu o áudio (${r.code})`);
      // 16 kHz, mono, 16 bits, 44 bytes of header.
      const size = statSync(wav).size;
      return Math.max(0, (size - 44) / 32_000);
    },
    async silencios(wav, duracao) {
      const r = await ff(['-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.4', '-f', 'null', '-']);
      return r.code === 0 ? parseSilencios(r.stderr, duracao) : [];
    },
    async cortar(wav, inicio, fim, saida) {
      const r = await ff(['-loglevel', 'error', '-y', '-ss', inicio.toFixed(3), '-to', fim.toFixed(3), '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', '64k', saida]);
      if (r.code !== 0 || !existsSync(saida)) throw new Error(`o ffmpeg não cortou o pedaço (${r.code})`);
    },
  };
}

/** Transcribes one piece's file; `''` = no speech in it. Throws `TranscribeError`. */
export type TranscribePedaco = (file: string, meta: { readonly type: string; readonly quem: string }) => Promise<string>;


/**
 * Each piece through the limiter (`limitador.py pesado`): it waits for a slot and for the build-pesado.lock queue (one
 * heavy job at a time on the machine) and runs curl against the transcriber. Without the limiter on this machine,
 * curl straight (still one piece at a time: the worker is serial).
 */
/** How long curl waits for one piece: the transcriber is told (it discards an audio only 30 s before this). */
export const PEDACO_PACIENCIA_S = 900;

/** The curl of one piece (t-6306aec9): its patience goes in a header, so the transcriber does not drop it at 570 s. */
export function pedacoCurlArgs(url: string, file: string, type: string, out: string): string[] {
  return ['curl', '-sS', '--max-time', String(PEDACO_PACIENCIA_S), '-H', `X-Donel-Paciencia-S: ${PEDACO_PACIENCIA_S}`, '--fail-with-body', '-o', out, '-F', `file=@${file};type=${type}`, '-F', 'response_format=json', '-F', 'language=pt', `${url.replace(/\/$/, '')}/inference`];
}

export function limitedTranscriber(options: { readonly url: string; readonly limitador?: string; readonly tmpOut: (file: string) => string }): TranscribePedaco {
  const host = new URL(options.url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') throw new Error('O transcritor tem de ser desta máquina.');
  const limitador = options.limitador ?? (process.env.DONEL_LIMITADOR || join(homedir(), 'bin', 'rotinas', 'limitador', 'limitador.py'));
  return async (file, meta) => {
    const out = options.tmpOut(file);
    const curl = pedacoCurlArgs(options.url, file, meta.type, out);
    const limited = existsSync(limitador);
    const r = limited
      ? // Waits at most 15 min for each of its three gates (slot, build-pesado.lock, slot again) and runs 20: 65 min, under
        // this 70. No slot by then = exit 75, and the worker tries the piece again later, free for the other audios.
        await run('python3', ['-I', limitador, 'pesado', '--quem', meta.quem, '--mem', '512M', '--max-min', '20', '--espera-min', '15', '--', ...curl], 70 * 60_000)
      : await run(curl[0]!, curl.slice(1), 16 * 60_000);
    if (r.code === SEM_VAGA) throw new TranscribeError('tempo', 'a VPS ficou sem vaga para transcrever');
    if (r.code === TIMEOUT || r.code === 28) throw new TranscribeError('tempo', 'um pedaço demorou demais');
    if (r.code === 7) throw new TranscribeError('conexao', 'o transcritor da VPS não respondeu');
    let body: { text?: unknown } | null = null;
    try {
      body = JSON.parse(readFileSync(out, 'utf8')) as { text?: unknown };
    } catch {
      body = null;
    }
    if (r.code !== 0) throw new TranscribeError(r.code === 22 ? 'recusou' : 'conexao', `curl ${r.code}`);
    if (!body || typeof body.text !== 'string') throw new TranscribeError('sem-texto', 'o transcritor não devolveu texto');
    return body.text.replace(/\s+/g, ' ').trim();
  };
}
