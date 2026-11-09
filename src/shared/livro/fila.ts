// F9 do ledger bom (docs/planos/ledger-bom.md) — priority, parent and board limit as entries of the journal (only
// the format and the projection; the screen that writes them waits for the owner's letter). Pure, no fs.
//
//   priorizada        tarefa = the task,  dados { quadro, posicao }  position in the board's queue (1 = first);
//                                                                    `posicao: null` undoes it
//   agrupada          tarefa = the child, dados { pai }              the child goes under `pai`; `pai: null` ungroups
//   limite-do-quadro  tarefa = the board (project folder), dados { limite }  lines the board runs at once;
//                                                                    `limite: null` = no limit
//
// Nothing is edited: the last entry of a key wins and every entry stays in the journal; undoing is one more entry.
// An entry the rules refuse stays in the journal as refused and changes nothing (the F2 rule, `projecao.ts`, which
// folds these entries with `passoFila`). The F1 entry (`formato.ts`) with these `tipo`s is a `LancamentoFila`.

import { isClosed, type LedgerDoc } from '../ledger/contract';

export const FILA_TIPOS = ['priorizada', 'agrupada', 'limite-do-quadro'] as const;
export type FilaTipo = (typeof FILA_TIPOS)[number];

export function isFilaTipo(tipo: string): tipo is FilaTipo {
  return (FILA_TIPOS as readonly string[]).includes(tipo);
}

export interface LancamentoFila {
  readonly seq: number;
  readonly tipo: FilaTipo;
  readonly tarefa: string;
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
}

export function emptyFila(): EstadoFila {
  return { prioridade: new Map(), pais: new Map(), limites: new Map() };
}

const MAX_ID_CHARS = 200;
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
  const { dados, tarefa } = entry;
  if (!isRecord(dados)) return 'dados não é um objeto';
  if (!isId(tarefa)) return entry.tipo === 'limite-do-quadro' ? 'limite do quadro leva o quadro em "tarefa"' : `${entry.tipo} precisa da tarefa`;
  switch (entry.tipo) {
    case 'priorizada': {
      const extra = unknownField(dados, ['quadro', 'posicao']);
      if (extra) return extra;
      if (!isId(dados.quadro)) return 'priorizada precisa do quadro';
      if (dados.posicao !== null && !isWhole(dados.posicao, 1, MAX_POSICAO)) return `posição é um inteiro de 1 a ${MAX_POSICAO}, ou nula para desfazer`;
      if (dados.posicao === null && !state.prioridade.has(tarefa)) return `a tarefa ${tarefa} não tem prioridade para desfazer`;
      return null;
    }
    case 'agrupada': {
      const extra = unknownField(dados, ['pai']);
      if (extra) return extra;
      const current = state.pais.get(tarefa);
      if (dados.pai === null) return current === undefined ? `a tarefa ${tarefa} não está agrupada` : null;
      if (!isId(dados.pai)) return 'agrupada precisa do pai';
      if (current !== undefined) return `a tarefa ${tarefa} já está agrupada sob ${current}; desagrupe antes de mudar o pai`;
      if (dados.pai === tarefa) return 'uma tarefa não é pai de si mesma';
      const parentOfParent = state.pais.get(dados.pai);
      if (parentOfParent !== undefined) return `o pai ${dados.pai} já é filha de ${parentOfParent}; agrupe sob ${parentOfParent}`;
      if ([...state.pais.values()].includes(tarefa)) return `a tarefa ${tarefa} já é pai de outras; ela não vira filha`;
      return null;
    }
    case 'limite-do-quadro': {
      const extra = unknownField(dados, ['limite']);
      if (extra) return extra;
      if (dados.limite !== null && !isWhole(dados.limite, 0, MAX_LIMITE)) return `limite é um inteiro de 0 a ${MAX_LIMITE}, ou nulo para tirar`;
      return null;
    }
    default:
      return `tipo desconhecido: ${String((entry as { tipo?: unknown }).tipo)}`;
  }
}

/** One entry on top of `state`: the new state, or why the rules refuse it (the state is not touched). */
export function passoFila(state: EstadoFila, entry: LancamentoFila): { readonly ok: true; readonly state: EstadoFila } | { readonly ok: false; readonly reason: string } {
  const reason = recusaFila(state, entry);
  if (reason) return { ok: false, reason };
  const dados = entry.dados as Record<string, unknown>;
  const { tarefa } = entry;
  if (entry.tipo === 'priorizada') {
    const prioridade = new Map(state.prioridade);
    if (dados.posicao === null) prioridade.delete(tarefa);
    else prioridade.set(tarefa, { quadro: dados.quadro as string, posicao: dados.posicao as number, seq: entry.seq });
    return { ok: true, state: { ...state, prioridade } };
  }
  if (entry.tipo === 'agrupada') {
    const pais = new Map(state.pais);
    if (dados.pai === null) pais.delete(tarefa);
    else pais.set(tarefa, dados.pai as string);
    return { ok: true, state: { ...state, pais } };
  }
  const limites = new Map(state.limites);
  if (dados.limite === null) limites.delete(tarefa);
  else limites.set(tarefa, dados.limite as number);
  return { ok: true, state: { ...state, limites } };
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
