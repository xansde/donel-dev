// Livro F5 — faxina por lançamento, só simulação (docs/planos/ledger-bom.md). Pure: it reads views of the tasks and
// returns, for every orphan, stale delivery and old open task, the destination it WOULD get, with the reason and the
// lançamento that would record it. Nothing is written, nothing is deleted: archiving is a `cancelar` with a reason,
// the task stays in the history.
//
// The rules, first match wins:
// - orphan (owner place closed, out of the board or never started):
//   1. a repeat (F7, `repetidas.ts`) of a root still open → joins the root (`agrupar`, the F9 lançamento);
//      of an accepted root → archived only when it is provably the same work (same text AND same criterion), low
//      risk and not in progress; a sister (same request, another criterion) only joins;
//      of a cancelled root → no special case (it may be the replacement);
//   2. low risk, not in progress, nobody touched it for ARCHIVE_AGE_MS → archived by age;
//   3. a live place above the owner on the board (the rule of today, `firstLiveAbove`) → passed to it;
//   4. else → back to the Líder of the board.
//   High risk never ends by itself (the nightly faxina's rule), and work in progress is never archived: it may be
//   half done in a branch.
// - delivered with no decision for STALE_DELIVERED_MS → back to the Líder of the board (who decides low risk or takes
//   the card to the owner); a fresher delivery stays.
// - open with a live owner, not started for OLD_OPEN_MS → back to the Líder of the board to reprioritize or pass on
//   (a repeat joins its root first); a fresher one stays.

import type { LedgerRisk, LedgerViewState } from './contract';
import { normalizeRequest, repeatGroups, rootOf, type PedidoView } from './repetidas';

const HOUR = 60 * 60 * 1000;
export const ARCHIVE_AGE_MS = 72 * HOUR;
export const STALE_DELIVERED_MS = 24 * HOUR;
export const OLD_OPEN_MS = 48 * HOUR;
/** Who takes what goes back: resolved by the writer to the Líder of the task's board (the `sessao_enviar` name). */
export const LEADER_OF_BOARD = 'lider-quadro';

export interface FaxinaView extends PedidoView {
  readonly state: LedgerViewState;
  /** Nothing more happens to it (accepted, cancelled, a rejected Slack letter). */
  readonly closed: boolean;
  readonly orphan: boolean;
  readonly risk: LedgerRisk;
  readonly ownerPlaceId: string;
  /** The newest moment the task is known to have moved (ms). */
  readonly lastWorkAt: number;
  readonly slack: boolean;
  readonly title?: string;
}

export type FaxinaCategoria = 'orfa' | 'entregue-parada' | 'aberta-velha';
export type FaxinaDestino = 'juntar' | 'arquivar' | 'repassar' | 'devolver-ao-lider';

/** The input of a lançamento (`EntryInput` of `src/shared/livro/` without id, em and quem, which the writer gives). */
export interface LancamentoProposto {
  /** The `LedgerOp` name; `agrupar` is the F9 one. */
  readonly tipo: 'transferir' | 'cancelar' | 'agrupar';
  readonly tarefa: string;
  readonly dados: { readonly to: string; readonly reason: string } | { readonly reason: string } | { readonly pai: string; readonly reason: string };
  /** Deterministic: running the cleanup twice on the same day never doubles a lançamento. */
  readonly chave: string;
}

export interface FaxinaProposta {
  readonly id: string;
  readonly categoria: FaxinaCategoria;
  readonly destino: FaxinaDestino;
  /** The place, the root or `LEADER_OF_BOARD`; empty for an archive. */
  readonly para: string;
  readonly motivo: string;
  readonly lancamento: LancamentoProposto;
}

export interface FaxinaFica {
  readonly id: string;
  readonly categoria: 'entregue-recente' | 'aberta-recente';
  readonly motivo: string;
}

export interface FaxinaContagens {
  readonly orfas: number;
  readonly entregues: number;
  readonly entreguesParadas: number;
  readonly entreguesRecentes: number;
  readonly abertas: number;
  readonly abertasOrfas: number;
  readonly abertasVelhas: number;
  readonly abertasRecentes: number;
}

export interface FaxinaSimulada {
  readonly propostas: readonly FaxinaProposta[];
  readonly ficam: readonly FaxinaFica[];
  readonly contagens: FaxinaContagens;
}

export interface FaxinaOptions {
  readonly now: number;
  /** The first live place above the task's owner on its board; absent or `null` = none known. */
  readonly abovePlace?: (task: FaxinaView) => string | null;
}

export function ageText(ms: number): string {
  const days = Math.floor(ms / (24 * HOUR));
  if (days >= 2) return `${days} dias`;
  return `${Math.max(1, Math.floor(ms / HOUR))} h`;
}

function lancamento(task: FaxinaView, destino: FaxinaDestino, para: string, reason: string, now: number): LancamentoProposto {
  const chave = `faxina:${task.id}:${destino}:${new Date(now).toISOString().slice(0, 10)}`;
  if (destino === 'arquivar') return { tipo: 'cancelar', tarefa: task.id, dados: { reason }, chave };
  if (destino === 'juntar') return { tipo: 'agrupar', tarefa: task.id, dados: { pai: para, reason }, chave };
  return { tipo: 'transferir', tarefa: task.id, dados: { to: para, reason }, chave };
}

/** Provably the same work: the same request text and the same criterion, both known. */
function sameWork(a: FaxinaView, b: FaxinaView): boolean {
  if (!a.criterion || !b.criterion) return false;
  return normalizeRequest(a.request) === normalizeRequest(b.request) && normalizeRequest(a.criterion) === normalizeRequest(b.criterion);
}

export function simularFaxina(items: readonly FaxinaView[], options: FaxinaOptions): FaxinaSimulada {
  const { now } = options;
  const byId = new Map(items.map((item) => [item.id, item]));
  const roots = rootOf(repeatGroups(items, { now }));
  const propostas: FaxinaProposta[] = [];
  const ficam: FaxinaFica[] = [];
  const propose = (task: FaxinaView, categoria: FaxinaCategoria, destino: FaxinaDestino, para: string, motivo: string): void => {
    propostas.push({ id: task.id, categoria, destino, para, motivo, lancamento: lancamento(task, destino, para, motivo, now) });
  };

  /**
   * Rule 1 for orphans and old open tasks: a copy of the same work as an accepted root (same text and criterion) is
   * archived (low risk, not in progress); any other repeat of a root still open or accepted joins it as a child. A
   * cancelled root may have been replaced by this very task: the repeat then follows the other rules.
   */
  const repeat = (task: FaxinaView, categoria: FaxinaCategoria): boolean => {
    const rootId = roots.get(task.id);
    const root = rootId ? byId.get(rootId) : undefined;
    if (!root || (root.closed && root.state !== 'aceita')) return false;
    const where = task.board !== null && root.board !== null ? 'no mesmo quadro' : 'o quadro de uma delas é desconhecido';
    if (root.state === 'aceita' && task.risk === 'baixo' && task.state !== 'em-execucao' && sameWork(task, root)) {
      propose(task, categoria, 'arquivar', '', `cópia de ${root.id}, que já foi aceita: o mesmo pedido e o mesmo critério (${where})`);
    } else {
      propose(task, categoria, 'juntar', root.id, `o mesmo pedido de ${root.id} (${where}): vira filha dela`);
    }
    return true;
  };

  let entreguesParadas = 0;
  let abertasOrfas = 0;
  let abertasVelhas = 0;
  for (const task of items) {
    if (task.closed) continue;
    const idle = now - task.lastWorkAt;
    if (task.orphan) {
      if (task.state === 'aberta') abertasOrfas += 1;
      if (repeat(task, 'orfa')) continue;
      if (task.risk === 'baixo' && task.state !== 'em-execucao' && idle >= ARCHIVE_AGE_MS) {
        propose(task, 'orfa', 'arquivar', '', `${task.state} há ${ageText(idle)} sem mexer e sem dono vivo (o lugar ${task.ownerPlaceId} saiu)`);
        continue;
      }
      const above = options.abovePlace?.(task) ?? null;
      const why = task.risk === 'alto' ? 'risco alto não se arquiva sozinho' : task.state === 'em-execucao' ? 'trabalho começado não se arquiva' : `parada há ${ageText(idle)}`;
      if (above) propose(task, 'orfa', 'repassar', above, `o lugar ${task.ownerPlaceId} saiu; ${above} é o primeiro vivo acima dele (${why})`);
      else propose(task, 'orfa', 'devolver-ao-lider', LEADER_OF_BOARD, `o lugar ${task.ownerPlaceId} saiu e não há lugar vivo conhecido acima (${why})`);
      continue;
    }
    if (task.state === 'entregue') {
      if (idle < STALE_DELIVERED_MS) {
        ficam.push({ id: task.id, categoria: 'entregue-recente', motivo: `entregue há ${ageText(idle)}: ainda dentro do prazo de decisão` });
        continue;
      }
      entreguesParadas += 1;
      const who = task.slack ? 'carta de Slack: só o dono decide, o Líder lembra o dono' : task.risk === 'alto' ? 'risco alto: o Líder leva a carta ao dono' : 'risco baixo: o Líder ou um Revisor decide';
      propose(task, 'entregue-parada', 'devolver-ao-lider', LEADER_OF_BOARD, `entregue há ${ageText(idle)} sem decisão (${who})`);
      continue;
    }
    if (task.state === 'aberta') {
      if (idle < OLD_OPEN_MS) {
        ficam.push({ id: task.id, categoria: 'aberta-recente', motivo: `aberta há ${ageText(idle)}, com dono vivo` });
        continue;
      }
      abertasVelhas += 1;
      if (repeat(task, 'aberta-velha')) continue;
      propose(task, 'aberta-velha', 'devolver-ao-lider', LEADER_OF_BOARD, `aberta há ${ageText(idle)} e o dono (vivo) não começou: o Líder reprioriza ou passa adiante`);
    }
  }

  const open = items.filter((item) => !item.closed);
  const entregues = open.filter((item) => item.state === 'entregue' && !item.orphan).length;
  const abertas = open.filter((item) => item.state === 'aberta').length;
  return {
    propostas,
    ficam,
    contagens: {
      orfas: open.filter((item) => item.orphan).length,
      entregues,
      entreguesParadas,
      entreguesRecentes: entregues - entreguesParadas,
      abertas,
      abertasOrfas,
      abertasVelhas,
      abertasRecentes: abertas - abertasOrfas - abertasVelhas,
    },
  };
}
