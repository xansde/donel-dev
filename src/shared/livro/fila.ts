// F9 do ledger bom (docs/planos/ledger-bom.md) — priority, parent and board limit as entries of the journal (only
// the format and the projection; the screen that writes them waits for the owner's letter). Pure, no fs.
//
//   priorizada        tarefa, { quadro, posicao }  position in the board's queue (1 = first); `posicao: null` undoes
//   agrupada          tarefa, { pai }              the task becomes a child of `pai`; `pai: null` ungroups it
//   limite-do-quadro  { quadro, limite }           how many lines the board runs at once; `limite: null` = no limit
//
// Nothing is edited: the last entry of a key wins and every entry stays in the journal; undoing is one more entry.
// An entry the rules refuse (`recusaFila`) stays in the journal as refused and changes nothing (the F2 rule). The
// writer asks `recusaFila` before appending; the projection asks it again, so a journal written by an older writer
// still projects the same.
//
// The entry here is the structural part of the F1 entry (`src/shared/livro`, by the F1 slice): any F1 entry with
// these `tipo`s is a `LancamentoFila`.

import { isClosed, type LedgerDoc } from '../ledger/contract';

export const FILA_TIPOS = ['priorizada', 'agrupada', 'limite-do-quadro'] as const;
export type FilaTipo = (typeof FILA_TIPOS)[number];

export interface LancamentoFila {
  readonly seq: number;
  readonly em: number;
  readonly quem: string;
  readonly tipo: FilaTipo;
  readonly tarefa?: string;
  readonly dados: unknown;
}

export interface Prioridade {
  readonly quadro: string;
  readonly posicao: number;
  /** The entry that set it (the newest wins a tie). */
  readonly seq: number;
}

export interface EstadoFila {
  /** task → its current priority (undone = absent). */
  readonly prioridade: ReadonlyMap<string, Prioridade>;
  /** child → parent. */
  readonly pais: ReadonlyMap<string, string>;
  /** board → limit (no limit = absent). */
  readonly limites: ReadonlyMap<string, number>;
  readonly recusados: readonly { readonly seq: number; readonly motivo: string }[];
}

const MAX_ID_CHARS = 80;
const MAX_POSICAO = 10_000;
const MAX_LIMITE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_CHARS;
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function unknownField(dados: Record<string, unknown>, known: readonly string[]): string | null {
  const extra = Object.keys(dados).find((key) => !known.includes(key));
  return extra === undefined ? null : `campo desconhecido em dados: ${extra}`;
}

/** Why the rules refuse `entry` on top of `state`; `null` = it is good. */
export function recusaFila(state: EstadoFila, entry: LancamentoFila): string | null {
  const { dados } = entry;
  if (!isRecord(dados)) return 'dados não é um objeto';
  switch (entry.tipo) {
    case 'priorizada': {
      const extra = unknownField(dados, ['quadro', 'posicao']);
      if (extra) return extra;
      if (!isId(entry.tarefa)) return 'priorizada precisa da tarefa';
      if (!isId(dados.quadro)) return 'priorizada precisa do quadro';
      if (dados.posicao !== null && !isWhole(dados.posicao, 1, MAX_POSICAO)) return `posição é um inteiro de 1 a ${MAX_POSICAO}, ou nula para desfazer`;
      if (dados.posicao === null && !state.prioridade.has(entry.tarefa)) return `a tarefa ${entry.tarefa} não tem prioridade para desfazer`;
      return null;
    }
    case 'agrupada': {
      const extra = unknownField(dados, ['pai']);
      if (extra) return extra;
      if (!isId(entry.tarefa)) return 'agrupada precisa da tarefa';
      const current = state.pais.get(entry.tarefa);
      if (dados.pai === null) return current === undefined ? `a tarefa ${entry.tarefa} não está agrupada` : null;
      if (!isId(dados.pai)) return 'agrupada precisa do pai';
      if (current !== undefined) return `a tarefa ${entry.tarefa} já está agrupada sob ${current}; desagrupe antes de mudar o pai`;
      if (dados.pai === entry.tarefa) return 'uma tarefa não é pai de si mesma';
      const parentOfParent = state.pais.get(dados.pai);
      if (parentOfParent !== undefined) return `o pai ${dados.pai} já é filha de ${parentOfParent}; agrupe sob ${parentOfParent}`;
      if ([...state.pais.values()].includes(entry.tarefa)) return `a tarefa ${entry.tarefa} já é pai de outras; ela não vira filha`;
      return null;
    }
    case 'limite-do-quadro': {
      const extra = unknownField(dados, ['quadro', 'limite']);
      if (extra) return extra;
      if (entry.tarefa !== undefined) return 'limite do quadro não leva tarefa';
      if (!isId(dados.quadro)) return 'limite do quadro precisa do quadro';
      if (dados.limite !== null && !isWhole(dados.limite, 0, MAX_LIMITE)) return `limite é um inteiro de 0 a ${MAX_LIMITE}, ou nulo para tirar`;
      return null;
    }
    default:
      return `tipo desconhecido: ${String((entry as { tipo?: unknown }).tipo)}`;
  }
}

/** The state of the queue: the journal folded in `seq` order, the refused entries kept apart. */
export function projetarFila(journal: readonly LancamentoFila[]): EstadoFila {
  const prioridade = new Map<string, Prioridade>();
  const pais = new Map<string, string>();
  const limites = new Map<string, number>();
  const recusados: { seq: number; motivo: string }[] = [];
  const state: EstadoFila = { prioridade, pais, limites, recusados };
  for (const entry of [...journal].sort((a, b) => a.seq - b.seq)) {
    if (!(FILA_TIPOS as readonly string[]).includes(entry.tipo)) continue; // another slice's entry
    const motivo = recusaFila(state, entry);
    if (motivo) {
      recusados.push({ seq: entry.seq, motivo });
      continue;
    }
    const dados = entry.dados as Record<string, unknown>;
    const tarefa = entry.tarefa!;
    if (entry.tipo === 'priorizada') {
      if (dados.posicao === null) prioridade.delete(tarefa);
      else prioridade.set(tarefa, { quadro: dados.quadro as string, posicao: dados.posicao as number, seq: entry.seq });
    } else if (entry.tipo === 'agrupada') {
      if (dados.pai === null) pais.delete(tarefa);
      else pais.set(tarefa, dados.pai as string);
    } else if (dados.limite === null) limites.delete(dados.quadro as string);
    else limites.set(dados.quadro as string, dados.limite as number);
  }
  return state;
}

/**
 * The board's queue: its open tasks with no parent (a child goes with its parent), the prioritized first by
 * position (the newest priority wins a tie), then the rest oldest first.
 */
export function filaDoQuadro(ledger: LedgerDoc, state: EstadoFila, quadro: string): string[] {
  const tasks = Object.values(ledger.tasks).filter((task) => task.projectPath === quadro && !isClosed(task) && !task.slack && !state.pais.has(task.id));
  const rank = (id: string): Prioridade | undefined => {
    const priority = state.prioridade.get(id);
    return priority?.quadro === quadro ? priority : undefined;
  };
  return tasks
    .sort((a, b) => {
      const pa = rank(a.id);
      const pb = rank(b.id);
      if (pa && pb) return pa.posicao - pb.posicao || pb.seq - pa.seq;
      if (pa || pb) return pa ? -1 : 1;
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    })
    .map((task) => task.id);
}
