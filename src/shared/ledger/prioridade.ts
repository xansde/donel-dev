// Prioridade do dono (t-5c0df1df, 09/11: "o líder de cada board busca novas demandas lá, de acordo com a prioridade
// dada"). The owner orders his asks in "Seus pedidos" (src/renderer/src/pet/JobuProgress.tsx); each place in his list
// is a `priorizada` mark on the task (`priorityOf`, contract.ts). The ledger only records it: nothing is pulled or
// handed out by it. The Líder of each board reads its open tasks in that order with `tarefa_listar` and hands the next
// one to whoever is free. Pure, no fs.

import { isClosed, priorityOf, type LedgerDoc, type LedgerTask } from './contract';

/** Ordered by the owner first (his place; a tie, the oldest task), then the rest oldest first. */
export function byOwnerPriority(a: LedgerTask, b: LedgerTask): number {
  const pa = priorityOf(a);
  const pb = priorityOf(b);
  if (pa !== undefined && pb !== undefined) return pa - pb || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  if (pa !== undefined || pb !== undefined) return pa !== undefined ? -1 : 1;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
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
