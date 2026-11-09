// Livro F5/F7 — the input of the simulations: the list of the day (`tarefa_listar` with every board and every state)
// joined with a v4 copy of the ledger. The list brings today's state and the orphan mark the Oráculo computed with the
// boards and the live sessions; it has no board and no creation date, so these come from the copy. A task born after
// the copy has no board (`null`) and, as its last move, the newest of what the list tells (delivery, transfers) and
// the instant of the copy: it is at most that old, never older, so no rule takes it for an old task by mistake.

import { isClosed, lastWorkAt, type LedgerDoc, type LedgerRisk, type LedgerViewState } from './contract';
import type { FaxinaView } from './faxina-simulada';
import type { PedidoView } from './repetidas';

interface ListingTask {
  readonly id: string;
  readonly estado: LedgerViewState;
  readonly pedido: string;
  readonly dono: string;
  readonly risco: LedgerRisk;
  readonly criterio?: string;
  readonly titulo?: string;
  readonly orfa?: string;
  readonly cartaSlack?: unknown;
  readonly entrega?: { readonly em?: string };
  readonly transferencias?: readonly { readonly em?: string }[];
}

function tasksOf(listing: unknown): ListingTask[] {
  const tasks = (listing as { tarefas?: unknown } | null)?.tarefas;
  if (!Array.isArray(tasks)) throw new Error('A lista não tem "tarefas": esperava a saída de tarefa_listar.');
  return tasks as ListingTask[];
}

/** The instant of the copy: its newest move. */
export function copyInstant(copy: LedgerDoc): number {
  return Object.values(copy.tasks).reduce((latest, task) => Math.max(latest, lastWorkAt(task)), 0);
}

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

export function viewsFromListing(listing: unknown, copy: LedgerDoc | null): FaxinaView[] {
  const notBefore = copy ? copyInstant(copy) : 0;
  return tasksOf(listing).map((task): FaxinaView => {
    const old = copy?.tasks[task.id];
    const told = Math.max(ms(task.entrega?.em), ...(task.transferencias ?? []).map((t) => ms(t.em)));
    const slack = task.cartaSlack !== undefined;
    return {
      id: task.id,
      board: old?.projectPath ?? null,
      request: task.pedido,
      createdAt: old?.createdAt ?? null,
      ...(old ? {} : { bornAfter: notBefore }),
      ...(task.criterio ? { criterion: task.criterio } : {}),
      state: task.estado,
      closed: task.estado === 'aceita' || task.estado === 'cancelada' || (task.estado === 'rejeitada' && slack),
      orphan: task.orfa !== undefined,
      risk: task.risco,
      ownerPlaceId: task.dono,
      lastWorkAt: Math.max(told, old ? lastWorkAt(old) : notBefore),
      slack,
      ...(task.titulo ? { title: task.titulo } : {}),
    };
  });
}

/** The requests of a v4 copy, for F7 on the copy alone. */
export function pedidosFromLedger(doc: LedgerDoc): (PedidoView & { readonly closed: boolean; readonly title?: string })[] {
  return Object.values(doc.tasks).map((task) => ({
    id: task.id,
    board: task.projectPath,
    request: task.request,
    createdAt: task.createdAt,
    criterion: task.doneWhen,
    closed: isClosed(task),
    ...(task.title ? { title: task.title } : {}),
  }));
}
