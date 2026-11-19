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
// t-753e8199 — the owner corrects an audio's transcription (contract v1.3): the line's text becomes his, and the
// correction is a row of its own in `correcoes` (never a line of the conversation), one delivery to the Líder under its
// OWN id and marker. The marker is what brings the Líder's answer back to the phone (answersIn reads the last time a
// marker was read): under the audio's marker, the correction would take the audio's answer, or lose its own to an
// audio already answered. His answer is kept against the correction and shown on the phone as an answer to the audio.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DecisaoRow, DecisoesQueue, Lado } from './decisoes';
import type { TarefaPedidaRow, TarefasPedidasQueue } from './tarefas-pedidas';
import type { ChatCelularQueue, ChatCelularRow } from './chat-celular';
import { phoneMarker } from '../main/lider/celular-chat';
import { CHAT_ARQUIVO_DIR, nomeLimpo, tamanhoTexto } from './chat-arquivo';

export const CELULAR_LOCAL_FILE = 'celular-local.json';
const RESERVE_MS = 10 * 60_000;
const MAX_CLOSED = 500;
const MAX_CHAT = 2000;
const MAX_RESULTADO = 300;

export const CHAT_AUDIO_DIR = 'chat-audio';
/** The formats the phone records (contract v1.2), and the file's extension. */
export const CHAT_AUDIO_MIMES: Readonly<Record<string, string>> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/aac': 'aac', 'audio/wav': 'wav' };

export type Insert = { readonly ok: true; readonly nova: boolean } | { readonly ok: false; readonly erro: 'conflito' };
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
  estado: 'transcrevendo' | 'transcrito' | 'falhou';
  readonly duracao_ms: number;
  readonly mime: string;
  readonly sha256: string;
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
  readonly audio?: { readonly estado: ChatAudio['estado']; readonly duracao_ms: number; readonly motivo: string | null; readonly corrigida?: true };
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
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createCelularLocalStore(filePath: string, now: () => number = Date.now): CelularLocalStore {
  let data = load();
  const audioDir = join(dirname(filePath), CHAT_AUDIO_DIR);
  const audioFile = (id: string, mime: string): string => join(audioDir, `${id}.${CHAT_AUDIO_MIMES[mime] ?? 'bin'}`);
  const arquivoDir = join(dirname(filePath), CHAT_ARQUIVO_DIR);
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
  const leaderText = (row: ChatLocal): string => {
    if (!row.audio) return row.texto;
    const length = duracaoTexto(row.audio.duracao_ms);
    if (row.audio.estado === 'transcrito') return `🎙 Áudio de ${length} (transcrição): ${row.texto}`;
    return `🎙 Áudio de ${length} que não consegui transcrever (${row.audio.motivo ?? 'sem motivo'}). Está guardado na VPS em ${audioFile(row.id, row.audio.mime)}.`;
  };
  /** Contract v1.4: the whole message the Líder reads, with the phone's marker (his answer goes back by it). */
  const arquivoText = (row: ChatLocal, arquivo: ChatArquivo): string => {
    const legenda = row.texto.trim();
    return `📎 O dono mandou um arquivo pelo celular ${phoneMarker(row.id)}: ${oneLine(arquivo.nome)} (${tamanhoTexto(arquivo.tamanho)}, ${oneLine(arquivo.mime)}), em ${join(arquivoDir, arquivo.guardado)}.${legenda ? ` ${legenda}` : ''}`;
  };
  const asChatRow = (row: ChatLocal): ChatCelularRow =>
    row.arquivo ? { id: row.id, texto: arquivoText(row, row.arquivo), criada_em: row.criada_em, inteiro: true } : { id: row.id, texto: leaderText(row), criada_em: row.criada_em };
  /** A voice line goes to the Líder only once it is words (or a failure): one delivery, never two. */
  const waitingAudio = (row: ChatLocal): boolean => row.audio?.estado === 'transcrevendo';
  /** Contract v1.3: under the correction's own marker (see the head of this file). */
  const correcaoRow = (row: CorrecaoLocal): ChatCelularRow => ({
    id: row.id,
    texto: `✏️ O dono corrigiu a transcrição do áudio ${phoneMarker(row.id)}: ${row.texto}`,
    criada_em: row.criada_em,
    inteiro: true,
  });
  const isCorrecao = (id: string): boolean => (data.correcoes ?? []).some((row) => row.id === id);
  /** The owner's row the queue knows by `id`: a line of his, or a correction. */
  const ownerRow = (next: LocalFile, id: string): ChatLocal | CorrecaoLocal | undefined =>
    next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono') ?? next.correcoes?.find((candidate) => candidate.id === id);

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
      if (isCorrecao(id)) return { ok: false, erro: 'conflito' };
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = data.chat.find((row) => row.id === id);
      if (existing) return existing.autor === 'dono' && existing.audio?.sha256 === sha256 ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
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
    audioEstado(id) {
      return data.chat.find((row) => row.id === id)?.audio?.estado ?? null;
    },
    audiosPendentes() {
      return data.chat
        .filter((row) => row.autor === 'dono' && waitingAudio(row))
        .map((row) => ({ id: row.id, file: audioFile(row.id, row.audio!.mime), mime: row.audio!.mime, duracao_ms: row.audio!.duracao_ms, criada_em: row.criada_em }));
    },
    concluirAudio(id, result) {
      let done = false;
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono');
        if (!row?.audio || row.audio.estado !== 'transcrevendo') return false;
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
        ...(row.audio ? { audio: { estado: row.audio.estado, duracao_ms: row.audio.duracao_ms, motivo: row.audio.motivo ?? null, ...(row.audio.corrigida ? { corrigida: true as const } : {}) } } : {}),
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
