// Saída iii (18/11, o Supabase do dono estourou o plano free) — the phone app's queues on THIS machine instead of the
// Supabase: the owner's decisions, the tasks he asks for and his chat with the Líder único. One JSON file
// (`<dir>/celular-local.json`, 600, temp → rename), written only by this daemon. The same three queue interfaces the
// consumers already read (`DecisoesQueue`, `TarefasPedidasQueue`, `ChatCelularQueue`), so what applies a decision, makes
// a task or delivers a message to the Líder is today's code, unchanged; only where the rows wait moved.
//
// What it keeps (what would vanish or duplicate without the owner seeing): a row the phone sent is on disk before the
// phone hears "ok"; the same id sent again (the network fell, the phone's own queue retried) is the same row, never a
// second one; the same id with other content is refused, never swapped in silence; a row taken and not marked comes
// back after its reservation (10 min), as the SQL queue did.
//
// t-268ed62a — an owner's voice message (contract v1.2): the bytes land in `<dir>/chat-audio/<id>.<ext>` before the
// row, and the row waits as `transcrevendo` (never taken to the Líder) until the daemon's transcriber (chat-audio.ts)
// turns it into `transcrito` or `falhou`. Then it is one delivery like any line: the words, or the notice with where
// the audio is kept. Never both.
//
// t-a1ad1ca2 — an owner's file (contract v1.4): the bytes land in `<dir>/chat-arquivos/<id>-<clean name>` before the
// row; the row is one delivery to the Líder that says what the file is and where it is kept.
//
// t-b03fdec8 — a voice message of any length (contract v1.6, contrato-audio-longo.md): the phone uploads it in parts of
// 60 s while the owner speaks, each one on disk (`<dir>/chat-audio/<id>/<n>.part`) before its "ok". The row shows up as
// `subindo` at the first part and is never taken to the Líder until the `fim` (or 30 min without a part, closed by the
// daemon as interrupted) joins the parts in order into `<id>.<ext>`. Then it is the same `transcrevendo` line as above.
// What reached the VPS is never dropped: a hole in the middle is kept as a gap the transcription marks.
//
// t-753e8199 — the owner corrects an audio's transcription (contract v1.3): the line's text becomes his, and the
// correction is a row of its own in `correcoes` (never a line of the conversation), one delivery to the Líder under its
// OWN id and marker. The marker is what brings the Líder's answer back to the phone (answersIn reads the last time a
// marker was read): under the audio's marker, the correction would take the audio's answer, or lose its own to an
// audio already answered. His answer is kept against the correction and shown on the phone as an answer to the audio.

import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DecisaoRow, DecisoesQueue, Lado } from './decisoes';
import type { TarefaPedidaRow, TarefasPedidasQueue } from './tarefas-pedidas';
import { CHAT_MAX_TEXT, type ChatCelularQueue, type ChatCelularRow } from './chat-celular';
import { phoneMarker } from '../main/lider/celular-chat';
import { CHAT_ARQUIVO_DIR, nomeLimpo, tamanhoTexto } from './chat-arquivo';
import { abreComCabecalho, audioHeader } from './chat-audio-longo';

export const CELULAR_LOCAL_FILE = 'celular-local.json';
const RESERVE_MS = 10 * 60_000;
const MAX_CLOSED = 500;
const MAX_CHAT = 2000;
const MAX_RESULTADO = 300;

export const CHAT_AUDIO_DIR = 'chat-audio';
/** The formats the phone records (contract v1.2), and the file's extension. */
export const CHAT_AUDIO_MIMES: Readonly<Record<string, string>> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/aac': 'aac', 'audio/wav': 'wav' };

/** Contract v1.6: only a container that joins by concatenation goes in parts (mp4 keeps its index at the end). */
export const CHAT_AUDIO_PARTE_MIMES: readonly string[] = ['audio/webm', 'audio/ogg'];
/** Each part is 60 s of the same recording (the phone's `timeslice`). */
export const CHAT_AUDIO_PARTE_MS = 60_000;
/** 2 h on the VPS (contract v1.6): the part that passes it is refused. */
export const CHAT_AUDIO_MAX_PARTES = 120;
export const CHAT_AUDIO_MAX_MS = CHAT_AUDIO_MAX_PARTES * CHAT_AUDIO_PARTE_MS;
/**
 * The Líder único on this VPS reads his queue typed by `tmux send-keys -l`, which refuses a command past ~16.3 KB
 * ("command too long"). A transcription whose message passes this many UTF-8 bytes goes as its beginning, its end and
 * the path of the whole `.txt` (contract v1.6 said ~40 thousand characters; the tmux ceiling is what holds).
 */
export const CHAT_AUDIO_MAX_LIDER_BYTES = 12_000;
/** The beginning and the end of a cut transcription, in UTF-8 bytes each. */
const CORTE_PONTA_BYTES = 4_500;
/** "07:00": when the audio a continuation goes on began (contract v1.8). */
const HORA_SAO_PAULO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const SEM_PARTE_0 = 'sem-parte-0';

export type Insert = { readonly ok: true; readonly nova: boolean } | { readonly ok: false; readonly erro: 'conflito' };
export type ParteInsert =
  | { readonly ok: true; readonly nova: boolean; readonly recebidas: number }
  | { readonly ok: false; readonly erro: 'conflito' | 'fechado' | 'continua-invalido' }
  /** Contract v1.8: the VPS closed it after 30 min; the phone sends what it lacks as a new audio (`recebidas`: the parts it has). */
  | { readonly ok: false; readonly erro: 'fechado-auto'; readonly recebidas: number[] }
  /** Contract v1.8 (#527 review): the earlier audio already has its continuation, `id`. */
  | { readonly ok: false; readonly erro: 'ja-continuado'; readonly id: string };
export type FimAudio =
  /** `fechado: 'auto'`: the VPS had closed it after 30 min, and the `fim` asks for no part it lacks (contract v1.8). */
  | { readonly ok: true; readonly nova: boolean; readonly estado: ChatAudio['estado']; readonly fechado?: 'auto' }
  | { readonly ok: false; readonly erro: 'conflito' | 'nao-encontrada' | 'continua-invalido' }
  | { readonly ok: false; readonly erro: 'faltam-partes'; readonly faltam: number[] }
  | { readonly ok: false; readonly erro: 'fechado-auto'; readonly recebidas: number[] }
  | { readonly ok: false; readonly erro: 'ja-continuado'; readonly id: string };
/** Contract v1.7: the owner threw the recording away (`apagadas`: the parts deleted from disk). */
export type CancelAudio = { readonly ok: true; readonly nova: boolean; readonly apagadas: number } | { readonly ok: false; readonly erro: 'conflito' | 'ja-enviado' };
/** A run of parts received in a row, and where its bytes are in the joined file. */
export interface AudioTrecho {
  readonly n0: number;
  readonly n1: number;
  readonly inicio: number;
  readonly fim: number;
}
/** The id of a cancelled recording is kept this long (contract v1.7): a late part never brings it back. */
export const CHAT_AUDIO_LAPIDE_MS = 7 * 86_400_000;
/** `antes`: the line's text the correction replaced (what the glossary learns from), only when `nova`. */
export type Correcao =
  | { readonly ok: true; readonly nova: boolean; readonly antes?: string }
  | { readonly ok: false; readonly erro: 'conflito' | 'nao-e-audio' | 'nao-encontrada' };

interface Reservable {
  reservada_ate?: number;
}

export interface DecisaoLocal extends Reservable {
  readonly pedido: string;
  readonly tarefa: string;
  readonly lado: Lado;
  readonly opcao: string | null;
  readonly comentario: string | null;
  readonly paginas: unknown;
  readonly criada_em: string;
  readonly entrega_vista: string | null;
  readonly assinatura: string | null;
  aplicada_em?: string;
  resultado?: string;
}

export interface PedidaLocal extends Reservable {
  readonly pedido: string;
  readonly titulo: string;
  readonly texto: string;
  readonly criterio: string | null;
  readonly prazo: string | null;
  readonly frente: string | null;
  readonly criada_em: string;
  aplicada_em?: string;
  resultado?: string;
  tarefa?: string | null;
}

export interface ChatAudio {
  /** `subindo`: parts still coming (contract v1.6), never taken to the Líder. */
  estado: 'subindo' | 'transcrevendo' | 'transcrito' | 'falhou';
  duracao_ms: number;
  readonly mime: string;
  /** The whole file's; `""` while the parts come. */
  sha256: string;
  /** Contract v1.6 only: each part's sha256 by its number (the idempotence of `(id, n)`). */
  partes?: Record<string, string>;
  /** Contract v1.6: when the last part came (the 30 min without `fim`). */
  ultima_parte_em?: number;
  /** Contract v1.6: the number of parts the recording had (the `fim`'s, or what the VPS had when it closed it). */
  total?: number;
  interrompido?: boolean;
  /** Contract v1.6: the runs of parts in the joined file (more than one = a hole). */
  trechos?: AudioTrecho[];
  /** Contract v1.6: "feitos/total" while the pieces are transcribed. */
  pedacos?: string;
  /**
   * Contract v1.8: the audio this one continues (the phone's `fim` with `continua`): the rest of a recording the VPS
   * closed after 30 min, sent by the phone as a new audio. The Líder reads it as the same speech.
   */
  continua?: string;
  /** A continuation of an audio that failed without part 0 that does not carry all of that audio's parts (#527 review). */
  anterior_incompleto?: true;
  /** Closed by the VPS after 30 min without a part: no part enters it any more (`fechado-auto`), and only it is continued. */
  automatico?: true;
  /** The joined file opens with the earlier audio's part 0 header, this many bytes: the worker puts it before every run. */
  cabecalho?: number;
  motivo?: string;
  /** The owner corrected the transcription (contract v1.3). */
  corrigida?: true;
}

export interface ChatArquivo {
  /** The name the phone sent (shown); the file is kept under `guardado`. */
  readonly nome: string;
  readonly mime: string;
  readonly tamanho: number;
  readonly sha256: string;
  /** `<id>-<clean name>`, inside `chat-arquivos/`. */
  readonly guardado: string;
}

export interface ChatLocal extends Reservable {
  readonly id: string;
  readonly autor: 'dono' | 'lider';
  /** For a voice message: `""` while it is transcribed, then the transcription (`""` if it failed). */
  texto: string;
  readonly em_resposta_a: string | null;
  readonly criada_em: string;
  entregue_em?: string;
  resultado?: string;
  /** Absent on a typed line (and on every line of a file from before the audio). */
  audio?: ChatAudio;
  /** Only on a line that came as a file; `texto` is its caption (`""` without one). */
  arquivo?: ChatArquivo;
}

/** The owner's correction of an audio's transcription: one delivery to the Líder, under its own id. */
export interface CorrecaoLocal extends Reservable {
  readonly id: string;
  /** The audio line it corrects. */
  readonly audio: string;
  readonly texto: string;
  readonly criada_em: string;
  entregue_em?: string;
  resultado?: string;
}

interface LocalFile {
  versao: 1;
  decisoes: DecisaoLocal[];
  pedidas: PedidaLocal[];
  chat: ChatLocal[];
  /** Absent in a file from before the corrections. */
  correcoes?: CorrecaoLocal[];
  /** Contract v1.7: the cancelled recordings' ids (only the id and when), kept 7 days. */
  lapides?: Array<{ readonly id: string; readonly em: number }>;
}

/** One line of the conversation as `celular.lider_conversa` showed it. */
export interface ConversaLinha {
  readonly id: string;
  readonly autor: 'dono' | 'lider';
  readonly texto: string;
  readonly em_resposta_a: string | null;
  readonly criada_em: string;
  readonly estado: 'na-fila' | 'com-o-lider' | 'respondida' | 'recusada' | null;
  readonly entregue_em: string | null;
  /** Only on a line that came as audio. */
  readonly audio?: {
    readonly estado: ChatAudio['estado'];
    readonly duracao_ms: number;
    readonly motivo: string | null;
    readonly corrigida?: true;
    /** Contract v1.6 (only on an audio sent in parts): the parts the VPS has, whether it was cut, the pieces done. */
    readonly partes?: number;
    readonly interrompido?: boolean;
    readonly pedacos?: string;
  };
  /** Only on a line that came as a file. */
  readonly arquivo?: { readonly nome: string; readonly mime: string; readonly tamanho: number };
}

/** A voice message still waiting for its transcription. */
export interface AudioPendente {
  readonly id: string;
  readonly file: string;
  readonly mime: string;
  readonly duracao_ms: number;
  readonly criada_em: string;
  /** Contract v1.6: sent in parts (the worker transcribes it in pieces). */
  readonly partes?: {
    readonly total: number;
    readonly interrompido: boolean;
    readonly trechos: readonly AudioTrecho[];
    /** A continuation's (v1.8): the bytes of the earlier audio's header at the start of the joined file. */
    readonly cabecalho?: number;
  };
}

export interface CelularLocalStore {
  readonly decisoes: DecisoesQueue;
  readonly pedidas: TarefasPedidasQueue;
  readonly chat: ChatCelularQueue;
  addDecisao(row: Omit<DecisaoLocal, 'criada_em'>): Insert;
  addPedida(row: Omit<PedidaLocal, 'criada_em'>): Insert;
  addChat(id: string, texto: string): Insert;
  /**
   * A voice message: the bytes go to disk (600, temp → rename) and then the row, as `transcrevendo`. The same id with
   * the same bytes is the same row (`nova: false`, nothing written); other bytes, or a typed line's id: conflict.
   */
  addChatAudio(id: string, audio: { readonly mime: string; readonly duracao_ms: number }, bytes: Uint8Array): Insert;
  /**
   * Contract v1.6: part `n` of the voice message `id`, on disk (600, temp → rename) before the row. The same `(id, n)`
   * with the same bytes is `nova: false`; other bytes, another mime, or the id of a line that is not an audio in parts:
   * conflict; a new part after the `fim`: `fechado` (`fechado-auto` when the VPS closed it, contract v1.8). `continua`
   * (optional, #527 review): the earlier audio this one goes on, kept on the line from the first part that brings it.
   */
  addChatAudioParte(id: string, n: number, mime: string, bytes: Uint8Array, continua?: string): ParteInsert;
  /**
   * Contract v1.6: the end of a recording in parts. Without every part `0..partes-1` and not `interrompido`:
   * `faltam-partes`. Else the parts that came are joined in order into `<id>.<ext>` and the line waits as
   * `transcrevendo` (or `falhou` without part 0). The same `fim` again: `nova: false`. `continua` (contract v1.8): the
   * audio the VPS closed after 30 min that this one goes on; without its own header, part 0 takes that audio's. After
   * the VPS's own close: `fechado: 'auto'`, or `fechado-auto` when the `fim` counts parts past what it closed with.
   */
  fecharAudioPartes(id: string, fim: { readonly partes: number; readonly duracao_ms: number; readonly interrompido: boolean; readonly automatico?: boolean; readonly continua?: string }): FimAudio;
  /**
   * Contract v1.7: the owner cancelled the recording. Its parts leave the disk at once, its line leaves the conversation,
   * nothing goes to the Líder, and the id is kept 7 days so a late part or `fim` is a conflict. After any `fim` (the
   * phone's or the VPS's own after 30 min): `ja-enviado`, nothing deleted.
   */
  cancelarAudio(id: string): CancelAudio;
  /** The audios in parts still open (`subindo`), with when their last part came. */
  audiosAbertos(): Array<{ readonly id: string; readonly ultima_parte_em: number; readonly partes: number }>;
  /** Where the parts of `id` wait for the `fim`. */
  partesDir(id: string): string;
  /** The transcription's progress of a long audio ("feitos/total"); only while it is `transcrevendo`. */
  andamentoAudio(id: string, pedacos: string): void;
  /** The state of a voice line (`null` = no such line, or a typed one). */
  audioEstado(id: string): ChatAudio['estado'] | null;
  /** The voice lines still waiting for their transcription, oldest first. */
  audiosPendentes(): AudioPendente[];
  /** The transcriber's answer: the words, or why not. Only once per line (`false` = not waiting any more). */
  concluirAudio(id: string, result: { readonly texto: string } | { readonly motivo: string }): boolean;
  /** Where a line's audio is kept. */
  audioFile(id: string, mime: string): string;
  /** `<dir>/chat-audio`, beside the queue's file. */
  readonly audioDir: string;
  /**
   * A file: the bytes go to disk (600, temp → rename) under a clean name and then the row. The same id with the same
   * bytes is the same row (`nova: false`, nothing written); other bytes, or another line's id: conflict.
   */
  addChatArquivo(id: string, arquivo: { readonly nome: string; readonly mime: string; readonly legenda: string }, bytes: Uint8Array): Insert;
  /** `<dir>/chat-arquivos`, beside the queue's file. */
  readonly arquivoDir: string;
  /**
   * The owner corrects the transcription of `audio` (only a transcribed voice line of his): its text becomes `texto`
   * and the correction waits as one delivery to the Líder. The same id with the same text is the same correction
   * (`nova: false`); with another text, or the id of a line: conflict. Two corrections of a line: the last one holds.
   */
  corrigirAudio(id: string, audio: string, texto: string): Correcao;
  /** The decision on `tarefa` still waiting to be applied (the card's "na fila"), newest first. */
  pendingDecision(tarefa: string): { readonly lado: Lado; readonly opcao: string | null; readonly criada_em: string } | null;
  /** The owner's requests, newest first (`celular.tarefas_pedidas_v`). */
  pedidasView(limit: number): Array<{ pedido: string; titulo: string; criada_em: string; aplicada_em: string | null; resultado: string | null; tarefa: string | null }>;
  /** The conversation, oldest first, the last `limit` lines (`celular.lider_conversa`). */
  conversa(limit: number): ConversaLinha[];
  /** The state of one of the owner's lines. */
  chatEstado(id: string): ConversaLinha['estado'];
  /** A line of the Líder: an answer, or a loose one (`emRespostaA` null). The same id twice is one line. */
  liderDiz(id: string, emRespostaA: string | null, texto: string): void;
}

const EMPTY = (): LocalFile => ({ versao: 1, decisoes: [], pedidas: [], chat: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fields that say what the owner sent: the same id must carry the same. */
function sameContent(a: object, b: object, keys: readonly string[]): boolean {
  const pick = (value: object): string => JSON.stringify(keys.map((key) => (value as Record<string, unknown>)[key] ?? null));
  return pick(a) === pick(b);
}

const DECISAO_KEYS = ['tarefa', 'lado', 'opcao', 'comentario', 'paginas', 'entrega_vista', 'assinatura'] as const;
const PEDIDA_KEYS = ['titulo', 'texto', 'criterio', 'prazo', 'frente'] as const;

/** A name or type from the phone inside the Líder's line: no line break nor control character. */
const oneLine = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/** `0:27`, `4:05`. */
export function duracaoTexto(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Pure: the beginning (or the end) of `text` that fits in `maxBytes` of UTF-8, never half a character. */
export function fitBytes(text: string, maxBytes: number, side: 'inicio' | 'fim'): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const chars = Array.from(text);
  const out: string[] = [];
  let bytes = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[side === 'inicio' ? i : chars.length - 1 - i]!;
    bytes += Buffer.byteLength(char);
    if (bytes > maxBytes) break;
    out.push(char);
  }
  return side === 'inicio' ? out.join('') : out.reverse().join('');
}

/** Where the whole transcription of a long audio is kept (beside the audio). */
export const transcricaoFile = (audioDir: string, id: string): string => join(audioDir, `${id}.txt`);

export function createCelularLocalStore(filePath: string, now: () => number = Date.now): CelularLocalStore {
  let data = load();
  const audioDir = join(dirname(filePath), CHAT_AUDIO_DIR);
  const audioFile = (id: string, mime: string): string => join(audioDir, `${id}.${CHAT_AUDIO_MIMES[mime] ?? 'bin'}`);
  const arquivoDir = join(dirname(filePath), CHAT_ARQUIVO_DIR);
  const partesDir = (id: string): string => join(audioDir, id);
  const parteFile = (id: string, n: number): string => join(partesDir(id), `${n}.part`);
  /** The audio and files of the chat rows the last prune dropped: deleted once the file without them is written. */
  let prunedAudio: string[] = [];

  function load(): LocalFile {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY();
      throw error;
    }
    // A file that is there but unreadable stops the daemon: writing over it would lose the owner's rows.
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || raw.versao !== 1 || !Array.isArray(raw.decisoes) || !Array.isArray(raw.pedidas) || !Array.isArray(raw.chat) || (raw.correcoes !== undefined && !Array.isArray(raw.correcoes))) {
      throw new Error(`${filePath} não é a fila local do celular`);
    }
    return raw as unknown as LocalFile;
  }

  function prune(): void {
    const keep = <T extends { aplicada_em?: string }>(rows: T[]): T[] => {
      const closed = rows.filter((row) => row.aplicada_em);
      if (closed.length <= MAX_CLOSED) return rows;
      const drop = new Set(closed.slice(0, closed.length - MAX_CLOSED));
      return rows.filter((row) => !drop.has(row));
    };
    data.decisoes = keep(data.decisoes);
    data.pedidas = keep(data.pedidas);
    if (data.lapides) data.lapides = data.lapides.filter((lapide) => now() - lapide.em < CHAT_AUDIO_LAPIDE_MS);
    if (data.correcoes) {
      // Never one still waiting for the Líder.
      const closed = data.correcoes.filter((row) => row.entregue_em);
      if (closed.length > MAX_CLOSED) {
        const drop = new Set(closed.slice(0, closed.length - MAX_CLOSED));
        data.correcoes = data.correcoes.filter((row) => !drop.has(row));
      }
    }
    if (data.chat.length > MAX_CHAT) {
      // Never an owner's line still waiting for the Líder.
      const excess = data.chat.length - MAX_CHAT;
      let dropped = 0;
      data.chat = data.chat.filter((row) => {
        if (dropped >= excess || (row.autor === 'dono' && !row.entregue_em)) return true;
        dropped += 1;
        if (row.audio) prunedAudio.push(audioFile(row.id, row.audio.mime));
        if (row.audio?.partes) prunedAudio.push(transcricaoFile(audioDir, row.id));
        if (row.arquivo) prunedAudio.push(join(arquivoDir, row.arquivo.guardado));
        return false;
      });
    }
  }

  function save(): void {
    prune();
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, filePath);
    for (const file of prunedAudio.splice(0)) {
      try {
        unlinkSync(file);
      } catch {
        // already gone (the 7- or 30-day sweep)
      }
    }
  }

  /** Changes are applied to a copy and kept only once written: a failed write leaves memory as the disk has it. */
  function commit(change: (next: LocalFile) => boolean | void): void {
    const before = data;
    data = JSON.parse(JSON.stringify(data)) as LocalFile;
    try {
      if (change(data) === false) {
        data = before;
        return;
      }
      save();
    } catch (error) {
      data = before;
      prunedAudio = [];
      throw error;
    }
  }

  const iso = (): string => new Date(now()).toISOString();
  const free = (row: Reservable): boolean => !row.reservada_ate || row.reservada_ate <= now();

  const decisoes: DecisoesQueue = {
    async tomar(limit) {
      const taken: DecisaoRow[] = [];
      commit((next) => {
        for (const row of next.decisoes) {
          if (taken.length >= limit) break;
          if (row.aplicada_em || !free(row)) continue;
          row.reservada_ate = now() + RESERVE_MS;
          const { reservada_ate: _r, aplicada_em: _a, resultado: _s, ...plain } = row;
          taken.push(plain);
        }
        return taken.length > 0;
      });
      return taken;
    },
    async marcar(pedido, resultado) {
      let marked = false;
      commit((next) => {
        const row = next.decisoes.find((candidate) => candidate.pedido === pedido);
        if (!row || row.aplicada_em) return false;
        row.aplicada_em = iso();
        row.resultado = resultado.slice(0, MAX_RESULTADO);
        delete row.reservada_ate;
        marked = true;
      });
      return marked;
    },
    // No mirror here: the phone reads the cards from the ledger itself.
    async atualizarTarefa() {},
  };

  const pedidas: TarefasPedidasQueue = {
    async tomar(limit) {
      const taken: TarefaPedidaRow[] = [];
      commit((next) => {
        for (const row of next.pedidas) {
          if (taken.length >= limit) break;
          if (row.aplicada_em || !free(row)) continue;
          row.reservada_ate = now() + RESERVE_MS;
          taken.push({ pedido: row.pedido, titulo: row.titulo, texto: row.texto, criterio: row.criterio, prazo: row.prazo, frente: row.frente, criada_em: row.criada_em });
        }
        return taken.length > 0;
      });
      return taken;
    },
    async marcar(pedido, resultado, tarefa) {
      let marked = false;
      commit((next) => {
        const row = next.pedidas.find((candidate) => candidate.pedido === pedido);
        if (!row || row.aplicada_em) return false;
        row.aplicada_em = iso();
        row.resultado = resultado.slice(0, MAX_RESULTADO);
        row.tarefa = tarefa;
        delete row.reservada_ate;
        marked = true;
      });
      return marked;
    },
    async espelhar() {},
  };

  /** What the Líder reads: a voice line says it came as audio, and how long; a failed one, where the audio is. */
  /** Contract v1.8: a continuation says which audio it goes on, and when that one began, so both read as one speech. */
  const continuacaoTexto = (row: ChatLocal): string => {
    const anterior = row.audio?.continua;
    if (!anterior) return '';
    const inicio = data.chat.find((candidate) => candidate.id === anterior)?.criada_em;
    const incompleto = row.audio?.anterior_incompleto ? '; trechos daquele áudio ficaram sem transcrição: o começo dele não chegou à VPS e este não os traz' : '';
    return `(continuação do áudio #${anterior.slice(0, 8)}${inicio ? ` de ${HORA_SAO_PAULO.format(new Date(inicio))}` : ''}${incompleto}) `;
  };
  const leaderText = (row: ChatLocal): string => {
    if (!row.audio) return row.texto;
    const length = duracaoTexto(row.audio.duracao_ms);
    if (row.audio.estado === 'transcrito') {
      const whole = `${continuacaoTexto(row)}🎙 Áudio de ${length} (transcrição): ${row.texto}`;
      // Past the tmux ceiling (with the queue's frame around it), the beginning, the end and where the whole text is.
      if (Buffer.byteLength(whole) + 200 <= CHAT_AUDIO_MAX_LIDER_BYTES) return whole;
      const head = fitBytes(row.texto, CORTE_PONTA_BYTES, 'inicio');
      const tail = fitBytes(row.texto, CORTE_PONTA_BYTES, 'fim');
      return `${continuacaoTexto(row)}🎙 Áudio de ${length} (transcrição longa, ${row.texto.length} caracteres; o texto inteiro está na VPS em ${transcricaoFile(audioDir, row.id)}, leia lá o meio). Começo: ${head} […] Fim: ${tail}`;
    }
    const motivo = row.audio.motivo === SEM_PARTE_0 ? 'o começo da gravação não chegou à VPS' : (row.audio.motivo ?? 'sem motivo');
    return `${continuacaoTexto(row)}🎙 Áudio de ${length}${row.audio.interrompido ? ' (gravação interrompida)' : ''} que não consegui transcrever (${motivo}). Está guardado na VPS em ${audioFile(row.id, row.audio.mime)}.`;
  };
  /** Contract v1.4: the whole message the Líder reads, with the phone's marker (his answer goes back by it). */
  const arquivoText = (row: ChatLocal, arquivo: ChatArquivo): string => {
    const legenda = row.texto.trim();
    return `📎 O dono mandou um arquivo pelo celular ${phoneMarker(row.id)}: ${oneLine(arquivo.nome)} (${tamanhoTexto(arquivo.tamanho)}, ${oneLine(arquivo.mime)}), em ${join(arquivoDir, arquivo.guardado)}.${legenda ? ` ${legenda}` : ''}`;
  };
  const asChatRow = (row: ChatLocal): ChatCelularRow => {
    if (row.arquivo) return { id: row.id, texto: arquivoText(row, row.arquivo), criada_em: row.criada_em, inteiro: true };
    const texto = leaderText(row);
    // A long transcription goes whole (contract v1.6), in the same form the queue gives a short line, never cut at 3500.
    if (row.audio && texto.length > CHAT_MAX_TEXT) return { id: row.id, texto: `◆ Do dono, pelo chat do celular ${phoneMarker(row.id)}: «${texto}»`, criada_em: row.criada_em, inteiro: true };
    return { id: row.id, texto, criada_em: row.criada_em };
  };
  /** A voice line goes to the Líder only once it is words (or a failure): one delivery, never two. */
  const waitingAudio = (row: ChatLocal): boolean => row.audio?.estado === 'transcrevendo' || row.audio?.estado === 'subindo';
  /** Contract v1.3: under the correction's own marker (see the head of this file). */
  const correcaoRow = (row: CorrecaoLocal): ChatCelularRow => ({
    id: row.id,
    texto: `✏️ O dono corrigiu a transcrição do áudio ${phoneMarker(row.id)}: ${row.texto}`,
    criada_em: row.criada_em,
    inteiro: true,
  });
  const isCorrecao = (id: string): boolean => (data.correcoes ?? []).some((row) => row.id === id);
  const temLapide = (id: string): boolean => (data.lapides ?? []).some((lapide) => lapide.id === id && now() - lapide.em < CHAT_AUDIO_LAPIDE_MS);
  /** The owner's row the queue knows by `id`: a line of his, or a correction. */
  const ownerRow = (next: LocalFile, id: string): ChatLocal | CorrecaoLocal | undefined =>
    next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono') ?? next.correcoes?.find((candidate) => candidate.id === id);

  /** Part 0's header, read from the start of the recording's joined file (`null` = it never had part 0, or it is gone). */
  const headerOf = (first: ChatLocal): Uint8Array | null => {
    const run = first.audio?.trechos?.[0];
    if (!first.audio || !run || run.n0 !== 0) return null;
    try {
      const fd = openSync(audioFile(first.id, first.audio.mime), 'r');
      try {
        const buffer = Buffer.alloc(Math.min(run.fim - run.inicio, 256 * 1024));
        const read = readSync(fd, buffer, 0, buffer.length, run.inicio);
        const header = audioHeader(buffer.subarray(0, read), first.audio.mime);
        return header ? Buffer.from(header) : null;
      } finally {
        closeSync(fd);
      }
    } catch {
      return null;
    }
  };
  /**
   * Contract v1.8 (and the #527 review): the audio `id` may continue. Only an audio the VPS closed after 30 min, in the
   * same format, and only once: a second id on the same earlier audio would be the same speech twice.
   */
  const anteriorDe = (id: string, continua: string, mime: string): ChatLocal | { readonly erro: 'continua-invalido' } | { readonly erro: 'ja-continuado'; readonly id: string } => {
    const anterior = data.chat.find((row) => row.id === continua && row.id !== id && row.autor === 'dono');
    if (!anterior?.audio?.partes || !anterior.audio.automatico || anterior.audio.mime !== mime) return { erro: 'continua-invalido' };
    const outro = data.chat.find((row) => row.id !== id && row.autor === 'dono' && row.audio?.continua === continua);
    if (outro) return { erro: 'ja-continuado', id: outro.id };
    return anterior;
  };
  const chat: ChatCelularQueue = {
    async tomar(limit) {
      const taken: ChatCelularRow[] = [];
      commit((next) => {
        for (const row of next.chat) {
          if (taken.length >= limit) break;
          if (row.autor !== 'dono' || row.entregue_em || row.resultado || waitingAudio(row) || !free(row)) continue;
          row.reservada_ate = now() + RESERVE_MS;
          taken.push(asChatRow(row));
        }
        for (const row of next.correcoes ?? []) {
          if (taken.length >= limit) break;
          if (row.entregue_em || row.resultado || !free(row)) continue;
          row.reservada_ate = now() + RESERVE_MS;
          taken.push(correcaoRow(row));
        }
        return taken.length > 0;
      });
      return taken;
    },
    async entregue(id, resultado) {
      let marked = false;
      commit((next) => {
        const row = ownerRow(next, id);
        if (!row || row.entregue_em) return false;
        row.entregue_em = iso();
        row.resultado = resultado.slice(0, MAX_RESULTADO);
        delete row.reservada_ate;
        marked = true;
      });
      return marked;
    },
    async estacionar(id, resultado) {
      let parked = false;
      commit((next) => {
        const row = ownerRow(next, id);
        if (!row || row.entregue_em || row.resultado) return false;
        row.resultado = resultado.slice(0, MAX_RESULTADO);
        delete row.reservada_ate;
        parked = true;
      });
      return parked;
    },
    async estacionadas(resultado, limit) {
      const parked = resultado.slice(0, MAX_RESULTADO);
      return [
        ...data.chat.filter((row) => row.autor === 'dono' && !row.entregue_em && !waitingAudio(row) && row.resultado === parked).map(asChatRow),
        ...(data.correcoes ?? []).filter((row) => !row.entregue_em && row.resultado === parked).map(correcaoRow),
      ]
        .sort((a, b) => a.criada_em.localeCompare(b.criada_em))
        .slice(0, limit);
    },
    async responder(id, emRespostaA, texto) {
      commit((next) => {
        if (next.chat.some((row) => row.id === id)) return false;
        next.chat.push({ id, autor: 'lider', texto, em_resposta_a: emRespostaA, criada_em: iso() });
      });
    },
    respondida(id) {
      return data.chat.some((row) => row.autor === 'lider' && row.em_resposta_a === id);
    },
  };

  function estadoDe(row: ChatLocal, answered: ReadonlySet<string>): ConversaLinha['estado'] {
    if (row.autor !== 'dono' || waitingAudio(row)) return null;
    if (answered.has(row.id)) return 'respondida';
    if (row.resultado?.startsWith('recusada')) return 'recusada';
    if (row.entregue_em) return 'com-o-lider';
    return 'na-fila';
  }

  const answeredIds = (): Set<string> => new Set(data.chat.filter((row) => row.autor === 'lider' && row.em_resposta_a).map((row) => row.em_resposta_a!));

  return {
    decisoes,
    pedidas,
    chat,
    addDecisao(input) {
      const existing = data.decisoes.find((row) => row.pedido === input.pedido);
      if (existing) return sameContent(existing, input, DECISAO_KEYS) ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      commit((next) => {
        next.decisoes.push({ ...input, criada_em: iso() });
      });
      return { ok: true, nova: true };
    },
    addPedida(input) {
      const existing = data.pedidas.find((row) => row.pedido === input.pedido);
      if (existing) return sameContent(existing, input, PEDIDA_KEYS) ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      commit((next) => {
        next.pedidas.push({ ...input, criada_em: iso() });
      });
      return { ok: true, nova: true };
    },
    addChat(id, texto) {
      if (isCorrecao(id)) return { ok: false, erro: 'conflito' };
      const existing = data.chat.find((row) => row.id === id);
      if (existing) return existing.autor === 'dono' && !existing.audio && !existing.arquivo && existing.texto === texto ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      commit((next) => {
        next.chat.push({ id, autor: 'dono', texto, em_resposta_a: null, criada_em: iso() });
      });
      return { ok: true, nova: true };
    },
    addChatAudio(id, audio, bytes) {
      if (isCorrecao(id) || temLapide(id)) return { ok: false, erro: 'conflito' };
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = data.chat.find((row) => row.id === id);
      if (existing) return existing.autor === 'dono' && !existing.audio?.partes && existing.audio?.sha256 === sha256 ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      // The bytes first: a row never points to an audio that is not on disk.
      const file = audioFile(id, audio.mime);
      mkdirSync(audioDir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, file);
      commit((next) => {
        next.chat.push({ id, autor: 'dono', texto: '', em_resposta_a: null, criada_em: iso(), audio: { estado: 'transcrevendo', duracao_ms: audio.duracao_ms, mime: audio.mime, sha256 } });
      });
      return { ok: true, nova: true };
    },
    addChatAudioParte(id, n, mime, bytes, continua) {
      if (isCorrecao(id) || temLapide(id)) return { ok: false, erro: 'conflito' };
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = data.chat.find((row) => row.id === id);
      if (existing) {
        const audio = existing.autor === 'dono' ? existing.audio : undefined;
        if (!audio?.partes || audio.mime !== mime) return { ok: false, erro: 'conflito' };
        // One earlier audio per recording: a part never moves it to another one (#527 review).
        if (continua !== undefined && audio.continua !== undefined && audio.continua !== continua) return { ok: false, erro: 'continua-invalido' };
        const known = audio.partes[String(n)];
        if (known) return known === sha256 ? { ok: true, nova: false, recebidas: Object.keys(audio.partes).length } : { ok: false, erro: 'conflito' };
        // Closed: a new part never opens another line. After the VPS's own close (30 min), the phone sends what it lacks
        // as a new audio that continues this one (contract v1.8).
        if (audio.estado !== 'subindo') {
          if (!audio.automatico) return { ok: false, erro: 'fechado' };
          return { ok: false, erro: 'fechado-auto', recebidas: Object.keys(audio.partes).map(Number).sort((x, y) => x - y) };
        }
      }
      // Contract v1.8 (#527 review): `continua` on a part, so a continuation the VPS closes before its `fim` still takes
      // the earlier audio's header and reads as a continuation.
      if (continua !== undefined && existing?.audio?.continua !== continua) {
        const anterior = anteriorDe(id, continua, mime);
        if ('erro' in anterior) return anterior.erro === 'ja-continuado' ? { ok: false, erro: 'ja-continuado', id: anterior.id } : { ok: false, erro: 'continua-invalido' };
      }
      // The bytes first: a row never counts a part that is not on disk.
      const file = parteFile(id, n);
      mkdirSync(partesDir(id), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, file);
      let recebidas = 0;
      commit((next) => {
        let row = next.chat.find((candidate) => candidate.id === id);
        if (!row) {
          row = { id, autor: 'dono', texto: '', em_resposta_a: null, criada_em: iso(), audio: { estado: 'subindo', duracao_ms: 0, mime, sha256: '', partes: {} } };
          next.chat.push(row);
        }
        const audio = row.audio!;
        if (continua !== undefined) audio.continua = continua;
        audio.partes![String(n)] = sha256;
        audio.ultima_parte_em = now();
        audio.duracao_ms = Object.keys(audio.partes!).length * CHAT_AUDIO_PARTE_MS;
        recebidas = Object.keys(audio.partes!).length;
      });
      return { ok: true, nova: true, recebidas };
    },
    fecharAudioPartes(id, fim) {
      if (temLapide(id)) return { ok: false, erro: 'conflito' };
      const found = data.chat.find((row) => row.id === id);
      if (!found) return fim.interrompido ? { ok: false, erro: 'nao-encontrada' } : { ok: false, erro: 'faltam-partes', faltam: Array.from({ length: fim.partes }, (_, n) => n) };
      if (found.autor !== 'dono' || !found.audio?.partes) return { ok: false, erro: 'conflito' };
      const audio = found.audio;
      // One earlier audio per recording: the `fim` never moves it to another one (#527 review).
      if (fim.continua !== undefined && audio.continua !== undefined && audio.continua !== fim.continua) return { ok: false, erro: 'continua-invalido' };
      if (audio.estado !== 'subindo') {
        if (fim.continua !== undefined && audio.continua !== fim.continua) return { ok: false, erro: 'continua-invalido' };
        if (!audio.automatico) return { ok: true, nova: false, estado: audio.estado };
        // Contract v1.8: the `fim` of an audio the VPS closed after 30 min. Asking for no part past what the VPS closed
        // with (the holes in it are marked in the text): it is done. Past it: the phone sends the rest as a new audio.
        const recebidas = Object.keys(audio.partes ?? {}).map(Number).sort((a, b) => a - b);
        const fechouCom = audio.total ?? (recebidas[recebidas.length - 1] ?? -1) + 1;
        if (fim.partes > fechouCom) return { ok: false, erro: 'fechado-auto', recebidas };
        return { ok: true, nova: false, estado: audio.estado, fechado: 'auto' };
      }
      // Contract v1.8: only an audio the VPS closed after 30 min is continued (the `fim`'s `continua`, or the parts').
      let anterior: ChatLocal | null = null;
      const continua = fim.continua ?? audio.continua;
      if (continua !== undefined) {
        const achado = fim.continua !== undefined && audio.continua !== fim.continua ? anteriorDe(id, continua, audio.mime) : (data.chat.find((row) => row.id === continua && row.autor === 'dono') ?? null);
        if (achado && 'erro' in achado) return achado.erro === 'ja-continuado' ? { ok: false, erro: 'ja-continuado', id: achado.id } : { ok: false, erro: 'continua-invalido' };
        anterior = achado;
      }
      const have = Object.keys(audio.partes ?? {}).map(Number).sort((a, b) => a - b);
      const got = new Set(have);
      // Parts past the `fim`'s count are not dropped: what reached the VPS is the owner's.
      const total = Math.max(fim.partes, (have[have.length - 1] ?? -1) + 1);
      const faltam = Array.from({ length: total }, (_, n) => n).filter((n) => !got.has(n));
      if (faltam.length && !fim.interrompido) return { ok: false, erro: 'faltam-partes', faltam };
      // A continuation whose first part has no header (the recorder never stopped): the earlier audio's part 0 header
      // goes before its bytes so ffmpeg reads it.
      const first = have.length ? readFileSync(parteFile(id, have[0]!)) : null;
      const proprio = first !== null && abreComCabecalho(first, audio.mime);
      const header = anterior && first && !proprio ? headerOf(anterior) : null;
      // Joined in order, the runs remembered (a hole between two is a gap the transcription marks).
      const trechos: AudioTrecho[] = [];
      const file = audioFile(id, audio.mime);
      const tmp = `${file}.tmp-${process.pid}`;
      const hash = createHash('sha256');
      writeFileSync(tmp, header ?? new Uint8Array(0), { mode: 0o600 });
      if (header) hash.update(header);
      let offset = header?.length ?? 0;
      for (const n of have) {
        const bytes = readFileSync(parteFile(id, n));
        appendFileSync(tmp, bytes);
        hash.update(bytes);
        const last = trechos[trechos.length - 1];
        if (last && last.n1 === n - 1) trechos[trechos.length - 1] = { ...last, n1: n, fim: offset + bytes.length };
        else trechos.push({ n0: n, n1: n, inicio: trechos.length === 0 ? 0 : offset, fim: offset + bytes.length });
        offset += bytes.length;
      }
      renameSync(tmp, file);
      const sha256 = hash.digest('hex');
      const semInicio = continua !== undefined ? !header && !proprio : !got.has(0);
      // The earlier audio failed without its part 0 and this one does not carry every part it had (the same bytes):
      // the Líder is told that stretches of it were never transcribed (#527 review).
      const meus = new Set(Object.values(audio.partes ?? {}));
      const incompleto = anterior?.audio?.estado === 'falhou' && anterior.audio.motivo === SEM_PARTE_0 && Object.values(anterior.audio.partes ?? {}).some((sha) => !meus.has(sha));
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === id)!;
        const a = row.audio!;
        a.estado = semInicio ? 'falhou' : 'transcrevendo';
        if (semInicio) a.motivo = SEM_PARTE_0;
        if (header) a.cabecalho = header.length;
        if (continua !== undefined) a.continua = continua;
        if (incompleto) a.anterior_incompleto = true;
        a.sha256 = sha256;
        a.total = total;
        a.interrompido = fim.interrompido;
        a.trechos = trechos;
        if (fim.automatico) a.automatico = true;
        a.duracao_ms = fim.duracao_ms > 0 ? fim.duracao_ms : have.length * CHAT_AUDIO_PARTE_MS;
      });
      // The parts are in the joined file now (kept 7 days, as every audio).
      try {
        rmSync(partesDir(id), { recursive: true, force: true });
      } catch {
        // the 7-day sweep takes it
      }
      return { ok: true, nova: true, estado: semInicio ? 'falhou' : 'transcrevendo' };
    },
    cancelarAudio(id) {
      if (temLapide(id)) return { ok: true, nova: false, apagadas: 0 };
      if (isCorrecao(id)) return { ok: false, erro: 'conflito' };
      const found = data.chat.find((row) => row.id === id);
      if (found) {
        if (found.autor !== 'dono' || !found.audio?.partes) return { ok: false, erro: 'conflito' };
        // Any `fim` came (the phone's, or the VPS's after 30 min): what the Líder has (or is about to have) never vanishes.
        if (found.audio.estado !== 'subindo') return { ok: false, erro: 'ja-enviado' };
      }
      // The parts leave the disk first: a row never outlives the decision to drop what it points to.
      const apagadas = found ? Object.keys(found.audio!.partes ?? {}).length : 0;
      rmSync(partesDir(id), { recursive: true, force: true });
      commit((next) => {
        next.chat = next.chat.filter((row) => row.id !== id);
        next.lapides = [...(next.lapides ?? []), { id, em: now() }];
      });
      return { ok: true, nova: true, apagadas };
    },
    audiosAbertos() {
      return data.chat
        .filter((row) => row.autor === 'dono' && row.audio?.estado === 'subindo')
        .map((row) => ({ id: row.id, ultima_parte_em: row.audio!.ultima_parte_em ?? Date.parse(row.criada_em), partes: Object.keys(row.audio!.partes ?? {}).length }));
    },
    partesDir,
    andamentoAudio(id, pedacos) {
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono');
        if (row?.audio?.estado !== 'transcrevendo' || row.audio.pedacos === pedacos) return false;
        row.audio.pedacos = pedacos;
      });
    },
    audioEstado(id) {
      return data.chat.find((row) => row.id === id)?.audio?.estado ?? null;
    },
    audiosPendentes() {
      return data.chat
        .filter((row) => row.autor === 'dono' && waitingAudio(row))
        .filter((row) => row.audio!.estado === 'transcrevendo')
        .map((row) => {
          const a = row.audio!;
          return {
            id: row.id,
            file: audioFile(row.id, a.mime),
            mime: a.mime,
            duracao_ms: a.duracao_ms,
            criada_em: row.criada_em,
            ...(a.partes
              ? {
                  partes: {
                    total: a.total ?? 0,
                    interrompido: a.interrompido === true,
                    trechos: a.trechos ?? [],
                    ...(a.cabecalho ? { cabecalho: a.cabecalho } : {}),
                  },
                }
              : {}),
          };
        });
    },
    concluirAudio(id, result) {
      let done = false;
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono');
        if (!row?.audio || row.audio.estado !== 'transcrevendo') return false;
        delete row.audio.pedacos;
        if ('texto' in result) {
          row.audio.estado = 'transcrito';
          row.texto = result.texto;
        } else {
          row.audio.estado = 'falhou';
          row.audio.motivo = result.motivo.slice(0, MAX_RESULTADO);
        }
        done = true;
      });
      return done;
    },
    audioFile,
    audioDir,
    addChatArquivo(id, arquivo, bytes) {
      if (isCorrecao(id)) return { ok: false, erro: 'conflito' };
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = data.chat.find((row) => row.id === id);
      if (existing) return existing.autor === 'dono' && existing.arquivo?.sha256 === sha256 ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      // The bytes first: a row never points to a file that is not on disk. The name is ours, never a path from the phone.
      const guardado = `${id}-${nomeLimpo(arquivo.nome)}`;
      const file = join(arquivoDir, guardado);
      mkdirSync(arquivoDir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, file);
      commit((next) => {
        next.chat.push({
          id,
          autor: 'dono',
          texto: arquivo.legenda,
          em_resposta_a: null,
          criada_em: iso(),
          arquivo: { nome: arquivo.nome, mime: arquivo.mime, tamanho: bytes.length, sha256, guardado },
        });
      });
      return { ok: true, nova: true };
    },
    arquivoDir,
    corrigirAudio(id, audio, texto) {
      const existing = data.correcoes?.find((row) => row.id === id);
      if (existing) return existing.audio === audio && existing.texto === texto ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      if (data.chat.some((row) => row.id === id)) return { ok: false, erro: 'conflito' };
      const line = data.chat.find((row) => row.id === audio);
      if (!line) return { ok: false, erro: 'nao-encontrada' };
      if (line.autor !== 'dono' || line.audio?.estado !== 'transcrito') return { ok: false, erro: 'nao-e-audio' };
      const antes = line.texto;
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === audio)!;
        row.texto = texto;
        row.audio!.corrigida = true;
        (next.correcoes ??= []).push({ id, audio, texto, criada_em: iso() });
      });
      return { ok: true, nova: true, antes };
    },
    pendingDecision(tarefa) {
      const rows = data.decisoes.filter((row) => row.tarefa === tarefa && !row.aplicada_em);
      const last = rows[rows.length - 1];
      return last ? { lado: last.lado, opcao: last.opcao, criada_em: last.criada_em } : null;
    },
    pedidasView(limit) {
      return [...data.pedidas]
        .reverse()
        .slice(0, limit)
        .map((row) => ({ pedido: row.pedido, titulo: row.titulo, criada_em: row.criada_em, aplicada_em: row.aplicada_em ?? null, resultado: row.resultado ?? null, tarefa: row.tarefa ?? null }));
    },
    conversa(limit) {
      const answered = answeredIds();
      // The Líder's answer to a correction shows on the phone as an answer to the audio it corrected.
      const audioOf = new Map((data.correcoes ?? []).map((row) => [row.id, row.audio]));
      return data.chat.slice(-limit).map((row) => ({
        id: row.id,
        autor: row.autor,
        texto: row.texto,
        em_resposta_a: row.em_resposta_a === null ? null : (audioOf.get(row.em_resposta_a) ?? row.em_resposta_a),
        criada_em: row.criada_em,
        estado: estadoDe(row, answered),
        entregue_em: row.entregue_em ?? null,
        ...(row.audio
          ? {
              audio: {
                estado: row.audio.estado,
                duracao_ms: row.audio.duracao_ms,
                motivo: row.audio.motivo ?? null,
                ...(row.audio.corrigida ? { corrigida: true as const } : {}),
                ...(row.audio.partes ? { partes: Object.keys(row.audio.partes).length, interrompido: row.audio.interrompido === true } : {}),
                ...(row.audio.pedacos ? { pedacos: row.audio.pedacos } : {}),
              },
            }
          : {}),
        ...(row.arquivo ? { arquivo: { nome: row.arquivo.nome, mime: row.arquivo.mime, tamanho: row.arquivo.tamanho } } : {}),
      }));
    },
    liderDiz(id, emRespostaA, texto) {
      commit((next) => {
        if (next.chat.some((row) => row.id === id)) return false;
        next.chat.push({ id, autor: 'lider', texto, em_resposta_a: emRespostaA, criada_em: iso() });
      });
    },
    chatEstado(id) {
      const row = data.chat.find((candidate) => candidate.id === id);
      return row ? estadoDe(row, answeredIds()) : null;
    },
  };
}
