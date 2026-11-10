// Prioridade do dono (t-5c0df1df, 09/11: "o líder de cada board busca novas demandas lá, de acordo com a prioridade
// dada"). The owner orders his asks in "Seus pedidos" (src/renderer/src/pet/JobuProgress.tsx); each place in his list
// is a `priorizada` mark on the task (`priorityOf`, contract.ts). The ledger only records it: nothing is pulled or
// handed out by it. The Líder of each board reads its open tasks in that order with `tarefa_listar` and hands the next
// one to whoever is free. Pure, no fs.

import { isClosed, priorityOf, type LedgerDoc, type LedgerTask } from './contract';
import { jobuProgress } from '../pet/progress';

/** Ordered by the owner first (his place; a tie, the oldest task), then the rest oldest first. */
export function byOwnerPriority(a: LedgerTask, b: LedgerTask): number {
  const pa = priorityOf(a);
  const pb = priorityOf(b);
  if (pa !== undefined && pb !== undefined) return pa - pb || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  if (pa !== undefined || pb !== undefined) return pa !== undefined ? -1 : 1;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/**
 * 09/11 (R6/R4 of #364) — the board queue IS the owner's list as "Seus pedidos" draws it, top down: an ask he did not
 * order yet sits at the end of its front, as on the panel, and an ordered ask moved to another front goes where the
 * panel puts it. Each owner's ask → its place in that list; the other tasks are not in it.
 */
export function panelPlaces(doc: LedgerDoc, now: number): Map<string, number> {
  const places = new Map<string, number>();
  for (const front of jobuProgress(doc, now).fronts) for (const task of front.tasks) places.set(task.id, places.size + 1);
  return places;
}

/** The board queue's order: the owner's asks as the panel draws them, then the rest by `byOwnerPriority`. */
export function byPanelThenPriority(places: ReadonlyMap<string, number>): (a: LedgerTask, b: LedgerTask) => number {
  return (a, b) => {
    const pa = places.get(a.id);
    const pb = places.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined || pb !== undefined) return pa !== undefined ? -1 : 1;
    return byOwnerPriority(a, b);
  };
}

/** A task the Líder may hand out: open (nobody took it), not a Slack letter. */
export function inBoardQueue(task: LedgerTask): boolean {
  return task.state === 'aberta' && !task.slack;
}

/**
 * The owner's whole list in the order he wants it (`order`: task ids, first = most important) → the marks to write:
 * only the tasks whose place changed, so moving one ask writes two marks. Unknown, closed and repeated ids are skipped
 * and do not take a place.
 */
export function priorityWrites(doc: LedgerDoc, order: readonly string[]): { id: string; posicao: number }[] {
  const seen = new Set<string>();
  const alive = order.filter((id) => {
    const task = doc.tasks[id];
    if (!task || seen.has(id) || isClosed(task) || task.slack) return false;
    seen.add(id);
    return true;
  });
  return alive.flatMap((id, index) => (priorityOf(doc.tasks[id]!) === index + 1 ? [] : [{ id, posicao: index + 1 }]));
}
