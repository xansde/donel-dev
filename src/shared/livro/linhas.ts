// F8 do ledger bom (docs/planos/ledger-bom.md) — the lines in progress per board, a pure derivation with no writes and
// nothing the owner sees yet. It counts each board in the three candidate definitions the letter puts to the owner,
// next to what the machine measured fits, so he picks one with numbers:
//
//   1. emExecucao — tasks in `em-execucao` (someone said "I took it");
//   2. sessaoViva — live sessions of the board owning a task with work left (open, running or rejected): a session
//      that closes leaves this count at the next call, with no write;
//   3. pedidoRaiz — open tasks with no parent (F9 groups children under a parent; a child is not a line of its own).
//
// Slack letters are not work lines (their send is the letter's own). Liveness is the faxina's rule (faxina.ts): a
// place is live when its conversation is open in a session (`liveSessionIds`).

import type { MindscapeDoc } from '../mindscape/model';
import { isClosed, requestedByOf, ASKED_BY_OWNER, type LedgerDoc, type LedgerTask } from '../ledger/contract';

/** What one machine measured (item 03 of the plan): RAM, the verify peak and, when known, the accounts' quota. */
export interface CapacidadeMedida {
  readonly ramTotalMb: number;
  /** RAM kept for the system and the app. */
  readonly reservaMb: number;
  /** The verify/build peak (one at a time, by the queue). */
  readonly picoVerifyMb: number;
  /** One session, working. */
  readonly ramPorSessaoMb: number;
  /** Sessions the accounts' quota allows at once; absent = not a limit. */
  readonly cotaSessoes?: number;
}

export interface LinhasDoQuadro {
  readonly quadro: string;
  readonly emExecucao: number;
  readonly sessaoViva: number;
  readonly pedidoRaiz: number;
  /** Of `pedidoRaiz`, the ones the owner asked for ("Seus pedidos"). */
  readonly pedidoRaizDoDono: number;
  /** How many sessions fit on the machine, by RAM and quota; `null` = no measure given. */
  readonly cabem: number | null;
}

export interface LinhasInput {
  readonly ledger: LedgerDoc;
  readonly boards: MindscapeDoc;
  readonly liveSessionIds: ReadonlySet<string>;
  readonly capacidade?: CapacidadeMedida;
  /** F9: the parent of a grouped task; absent = no grouping yet. */
  readonly paiDe?: (taskId: string) => string | undefined;
}

export function cabemNaMaquina(capacidade: CapacidadeMedida): number {
  const byRam = Math.max(0, Math.floor((capacidade.ramTotalMb - capacidade.reservaMb - capacidade.picoVerifyMb) / capacidade.ramPorSessaoMb));
  return capacidade.cotaSessoes === undefined ? byRam : Math.min(byRam, capacidade.cotaSessoes);
}

const hasWorkLeft = (task: LedgerTask): boolean => task.state === 'aberta' || task.state === 'em-execucao' || task.state === 'rejeitada';

/** One row per board with a live line in any definition, biggest first. */
export function linhasPorQuadro(input: LinhasInput): LinhasDoQuadro[] {
  const { ledger, boards, liveSessionIds, paiDe } = input;
  const cabem = input.capacidade ? cabemNaMaquina(input.capacidade) : null;
  const rows = new Map<string, { emExecucao: number; places: Set<string>; pedidoRaiz: number; pedidoRaizDoDono: number }>();
  const rowOf = (quadro: string) => {
    let row = rows.get(quadro);
    if (!row) rows.set(quadro, (row = { emExecucao: 0, places: new Set(), pedidoRaiz: 0, pedidoRaizDoDono: 0 }));
    return row;
  };
  for (const task of Object.values(ledger.tasks)) {
    if (isClosed(task) || task.slack) continue;
    const row = rowOf(task.projectPath);
    if (task.state === 'em-execucao') row.emExecucao += 1;
    if (!paiDe?.(task.id)) {
      row.pedidoRaiz += 1;
      if (requestedByOf(task)?.toLowerCase() === ASKED_BY_OWNER) row.pedidoRaizDoDono += 1;
    }
    if (!hasWorkLeft(task)) continue;
    const card = boards.boards[task.projectPath]?.cards[task.ownerPlaceId];
    if (card?.kind === 'session' && card.sessionId !== undefined && liveSessionIds.has(card.sessionId)) row.places.add(task.ownerPlaceId);
  }
  return [...rows]
    .map(([quadro, row]) => ({ quadro, emExecucao: row.emExecucao, sessaoViva: row.places.size, pedidoRaiz: row.pedidoRaiz, pedidoRaizDoDono: row.pedidoRaizDoDono, cabem }))
    .sort((a, b) => b.pedidoRaiz - a.pedidoRaiz || a.quadro.localeCompare(b.quadro));
}

/** The table for the letter, one line per board (plain text, no code for the owner to read). */
export function tabelaLinhas(rows: readonly LinhasDoQuadro[]): string {
  const name = (quadro: string): string => quadro.split(/[\\/]/).filter(Boolean).at(-1) ?? '(sem quadro)';
  const header = 'quadro | em execução | sessão viva com tarefa | pedido-raiz aberto (do dono) | cabem na máquina';
  return [header, ...rows.map((row) => `${name(row.quadro)} | ${row.emExecucao} | ${row.sessaoViva} | ${row.pedidoRaiz} (${row.pedidoRaizDoDono}) | ${row.cabem ?? '—'}`)].join('\n');
}
