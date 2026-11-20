// Quadro de tarefas (t-8406f473, recado r-a01b8ca6) — the cards of Oráculo tasks follow them (src/shared/board/task-follow.ts):
// every `ronda` before the vigia, and once by hand (`board-cron.mjs sincronizar [--seco]`). The Oráculo's ledger is read
// read-only; the board is written only through its own move (the rules hold) and `fillSession`.
//
// Why the round and not only the gate: a transfer, an accept or a cancel reaches the ledger by paths that never pass
// the daemon's gate (the PC's app, the Líder único's leaderLedger with the PC off, `servico:reconciliador`). The gate's
// `afterAssume` (cartao-da-tarefa.ts) still opens the card at once when its owner assumes it.

import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { LedgerTask } from '../shared/ledger/contract';
import { ORACULO_ACTOR, planTaskFollow, type FollowCard, type FollowStep } from '../shared/board/task-follow';
import { CARDS_WITH_TASK_SQL, CARDS_WITH_TASK_DONE_MS } from '../oraculo/board-sqlite';
import type { BoardStore, CardRow } from '../oraculo/board-client';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export function followCardOf(row: CardRow): FollowCard {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    stageSince: Date.parse(row.stage_since),
    placeId: row.place_id,
    sessionId: row.session_id,
    version: row.version,
    oraculoId: row.oraculo_id ?? null,
  };
}

/** The changes the cards `rows` need to follow their tasks (pure). */
export function planOracleSync(rows: readonly CardRow[], tasks: ReadonlyMap<string, LedgerTask>, sessionOf?: (projectId: string, placeId: string) => string | undefined): FollowStep[] {
  return rows.flatMap((row) => {
    const step = row.oraculo_id ? planTaskFollow(followCardOf(row), tasks.get(row.oraculo_id), sessionOf) : null;
    return step ? [step] : [];
  });
}

/** One line per change, for the log and `sincronizar --seco`. */
export function describeStep(step: FollowStep): string {
  const stage = step.from === step.to ? step.to : `${step.from} → ${step.to}`;
  const place = step.fromPlace === step.place ? step.place : `${step.fromPlace ?? 'sem lugar'} → ${step.place}`;
  return `${step.cardId} (${step.taskId}): ${stage}; lugar ${place}${step.session ? `; sessão ${step.session}` : ''}; ${step.doneSummary ? `resumo "${step.doneSummary}"` : `nota "${step.note}"`}`;
}

export interface SyncResult {
  readonly applied: number;
  readonly failed: number;
}

/**
 * Applies the steps: the move as `servico:oraculo` (the Líder's triage: the place is given to the task's owner), then
 * the session. A card that changed since it was read (the compare-and-swap) or a refusal is a log line; the next round
 * reads it again.
 */
export async function applyOracleSync(store: Pick<BoardStore, 'moveCard' | 'fillSession'>, steps: readonly FollowStep[], log: (line: string) => void): Promise<SyncResult> {
  let applied = 0;
  let failed = 0;
  for (const step of steps) {
    try {
      const moved = await store.moveCard({
        p_card_id: step.cardId,
        p_to: step.to,
        p_actor: ORACULO_ACTOR,
        p_expected_version: step.expectedVersion,
        p_note: step.note,
        p_place_id: step.place,
        ...(step.doneSummary ? { p_done_summary: step.doneSummary } : {}),
        p_as_leader: true,
      });
      if (step.session && !moved.session_id && store.fillSession) await store.fillSession(moved.id, step.place, step.session);
      applied += 1;
      log(`segue o Oráculo: ${describeStep(step)}`);
    } catch (error) {
      failed += 1;
      log(`segue o Oráculo: ${step.cardId} (${step.taskId}) não mudou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { applied, failed };
}

/** The cards of Oráculo tasks (live, and done in the last days), from the board's file opened read-only (`--seco`). */
export function readCardsWithTaskReadOnly(boardFile: string, now = Date.now()): CardRow[] {
  const db: DatabaseSync = new DatabaseSync(boardFile, { readOnly: true } as never);
  try {
    return db
      .prepare(CARDS_WITH_TASK_SQL)
      .all(new Date(now - CARDS_WITH_TASK_DONE_MS).toISOString())
      .map((row) => ({ ...(row as object) }) as CardRow);
  } finally {
    db.close();
  }
}
