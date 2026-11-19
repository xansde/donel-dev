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

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { DecisaoRow, DecisoesQueue, Lado } from './decisoes';
import type { TarefaPedidaRow, TarefasPedidasQueue } from './tarefas-pedidas';
import type { ChatCelularQueue, ChatCelularRow } from './chat-celular';

export const CELULAR_LOCAL_FILE = 'celular-local.json';
const RESERVE_MS = 10 * 60_000;
const MAX_CLOSED = 500;
const MAX_CHAT = 2000;
const MAX_RESULTADO = 300;

export type Insert = { readonly ok: true; readonly nova: boolean } | { readonly ok: false; readonly erro: 'conflito' };

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

export interface ChatLocal extends Reservable {
  readonly id: string;
  readonly autor: 'dono' | 'lider';
  readonly texto: string;
  readonly em_resposta_a: string | null;
  readonly criada_em: string;
  entregue_em?: string;
  resultado?: string;
}

interface LocalFile {
  versao: 1;
  decisoes: DecisaoLocal[];
  pedidas: PedidaLocal[];
  chat: ChatLocal[];
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
}

export interface CelularLocalStore {
  readonly decisoes: DecisoesQueue;
  readonly pedidas: TarefasPedidasQueue;
  readonly chat: ChatCelularQueue;
  addDecisao(row: Omit<DecisaoLocal, 'criada_em'>): Insert;
  addPedida(row: Omit<PedidaLocal, 'criada_em'>): Insert;
  addChat(id: string, texto: string): Insert;
  /** The decision on `tarefa` still waiting to be applied (the card's "na fila"), newest first. */
  pendingDecision(tarefa: string): { readonly lado: Lado; readonly opcao: string | null; readonly criada_em: string } | null;
  /** The owner's requests, newest first (`celular.tarefas_pedidas_v`). */
  pedidasView(limit: number): Array<{ pedido: string; titulo: string; criada_em: string; aplicada_em: string | null; resultado: string | null; tarefa: string | null }>;
  /** The conversation, oldest first, the last `limit` lines (`celular.lider_conversa`). */
  conversa(limit: number): ConversaLinha[];
  /** The state of one of the owner's lines. */
  chatEstado(id: string): ConversaLinha['estado'];
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

export function createCelularLocalStore(filePath: string, now: () => number = Date.now): CelularLocalStore {
  let data = load();

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
    if (!isRecord(raw) || raw.versao !== 1 || !Array.isArray(raw.decisoes) || !Array.isArray(raw.pedidas) || !Array.isArray(raw.chat)) {
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
    if (data.chat.length > MAX_CHAT) {
      // Never an owner's line still waiting for the Líder.
      const excess = data.chat.length - MAX_CHAT;
      let dropped = 0;
      data.chat = data.chat.filter((row) => {
        if (dropped >= excess || (row.autor === 'dono' && !row.entregue_em)) return true;
        dropped += 1;
        return false;
      });
    }
  }

  function save(): void {
    prune();
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, filePath);
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

  const asChatRow = (row: ChatLocal): ChatCelularRow => ({ id: row.id, texto: row.texto, criada_em: row.criada_em });

  const chat: ChatCelularQueue = {
    async tomar(limit) {
      const taken: ChatCelularRow[] = [];
      commit((next) => {
        for (const row of next.chat) {
          if (taken.length >= limit) break;
          if (row.autor !== 'dono' || row.entregue_em || row.resultado || !free(row)) continue;
          row.reservada_ate = now() + RESERVE_MS;
          taken.push(asChatRow(row));
        }
        return taken.length > 0;
      });
      return taken;
    },
    async entregue(id, resultado) {
      let marked = false;
      commit((next) => {
        const row = next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono');
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
        const row = next.chat.find((candidate) => candidate.id === id && candidate.autor === 'dono');
        if (!row || row.entregue_em || row.resultado) return false;
        row.resultado = resultado.slice(0, MAX_RESULTADO);
        delete row.reservada_ate;
        parked = true;
      });
      return parked;
    },
    async estacionadas(resultado, limit) {
      return data.chat.filter((row) => row.autor === 'dono' && !row.entregue_em && row.resultado === resultado.slice(0, MAX_RESULTADO)).slice(0, limit).map(asChatRow);
    },
    async responder(id, emRespostaA, texto) {
      commit((next) => {
        if (next.chat.some((row) => row.id === id)) return false;
        next.chat.push({ id, autor: 'lider', texto, em_resposta_a: emRespostaA, criada_em: iso() });
      });
    },
  };

  function estadoDe(row: ChatLocal, answered: ReadonlySet<string>): ConversaLinha['estado'] {
    if (row.autor !== 'dono') return null;
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
      commit((next) => next.decisoes.push({ ...input, criada_em: iso() }));
      return { ok: true, nova: true };
    },
    addPedida(input) {
      const existing = data.pedidas.find((row) => row.pedido === input.pedido);
      if (existing) return sameContent(existing, input, PEDIDA_KEYS) ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      commit((next) => next.pedidas.push({ ...input, criada_em: iso() }));
      return { ok: true, nova: true };
    },
    addChat(id, texto) {
      const existing = data.chat.find((row) => row.id === id);
      if (existing) return existing.autor === 'dono' && existing.texto === texto ? { ok: true, nova: false } : { ok: false, erro: 'conflito' };
      commit((next) => next.chat.push({ id, autor: 'dono', texto, em_resposta_a: null, criada_em: iso() }));
      return { ok: true, nova: true };
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
      return data.chat.slice(-limit).map((row) => ({
        id: row.id,
        autor: row.autor,
        texto: row.texto,
        em_resposta_a: row.em_resposta_a,
        criada_em: row.criada_em,
        estado: estadoDe(row, answered),
        entregue_em: row.entregue_em ?? null,
      }));
    },
    chatEstado(id) {
      const row = data.chat.find((candidate) => candidate.id === id);
      return row ? estadoDe(row, answeredIds()) : null;
    },
  };
}
