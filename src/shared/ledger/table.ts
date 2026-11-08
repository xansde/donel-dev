// Ledger v5, fatia 3 (docs/planos/ledger-v5.md, D5: tela B) — the readable table of the Oráculo: one row per task,
// in the words of the mirror (`tarefaRow`, mirror.ts), so the app and the Supabase table tell the same story. Only
// reads the v4 document: nothing here writes, and nothing new goes into `ledger.json`.
//
// What the mirror has not and the table adds, all derived: "com quem está" (the next step, in words), the filters,
// the search text and the timeline of the side panel.

import {
  awaitsSend,
  doneByOf,
  eventNote,
  isAgentBotRecord,
  isCancelled,
  isClosed,
  lastDelivery,
  slackSendState,
  transfersOf,
  waitsForOwner,
  type LedgerDoc,
  type LedgerProof,
  type LedgerTask,
} from './contract';
import { CARD_KINDS, type OwnerInboxKind } from './inbox';
import { actorName, placeLabel, tarefaRow, type MaskNote, type PlaceInfoOf, type TarefaRow } from './mirror';

export type LedgerTableFilter = 'esperando-voce' | 'sem-executor' | 'cartas' | 'tudo';

/** The ready filters, in the order of the prototype. "Travadas" needs rounds, which v4 does not keep (fatia 14). */
export const LEDGER_TABLE_FILTERS: readonly { readonly id: LedgerTableFilter; readonly label: string }[] = [
  { id: 'esperando-voce', label: 'Esperando você' },
  { id: 'sem-executor', label: 'Sem executor' },
  { id: 'cartas', label: 'Cartas' },
  { id: 'tudo', label: 'Tudo' },
];

/** What "quem pediu" says when nobody said (the mirror's words). */
export const NOT_RECORDED = 'não registrado';

const ROLE_ONLY = /^(dev|revisor|pesquisa|l[ií]der|curador)(\s*\(sem nome\))?$/i;

export interface LedgerTableRow {
  readonly task: LedgerTask;
  /** The mirror's row of this task (same words as the Supabase table). */
  readonly row: TarefaRow;
  /** "Quem pediu" as shown: never a role alone ("Dev"), which says nothing; then it is `NOT_RECORDED`. */
  readonly askedBy: string;
  /** Nobody said who asked: the cell is red. */
  readonly askedMissing: boolean;
  /** "Com quem está": the next step, in words ("você decide", "Revisor confere", "falta assumir"). */
  readonly withWhom: string;
  /** It is in the box "Esperando você" (fatia 1); without the box, `waitsForOwner`. */
  readonly waitsForOwner: boolean;
  /** The owner decides it on the card (a card kind of the box). */
  readonly onCard: boolean;
  /** Nothing more happens to it. */
  readonly closed: boolean;
  /** The last step (ms): the order of the table, newest first. */
  readonly lastActivityAt: number;
  /** Lower-case text the search looks in. */
  readonly searchText: string;
}

/** The next step of a task, in words. */
function withWhomOf(doc: LedgerDoc, task: LedgerTask, owner: string): string {
  if (task.slack) {
    if (task.state === 'entregue') return 'você aprova a carta';
    if (awaitsSend(task)) return 'ninguém enviou ainda';
    if (task.state === 'aceita' && !isCancelled(task)) {
      const send = slackSendState(task);
      if (send === 'sem-confirmacao') return 'envio sem confirmação: conferir';
      if (send === 'esgotada') return 'envio falhou duas vezes';
    }
  }
  if (waitsForOwner(doc, task)) return task.state === 'aceita' ? 'você confere o aceite do Revisor' : 'você decide';
  if (isClosed(task) || isAgentBotRecord(task)) return '—';
  if (task.state === 'entregue') return 'Revisor confere';
  if (task.state === 'aberta') return `falta assumir · ${owner}`;
  if (task.state === 'rejeitada') return `${owner} refaz`;
  return owner;
}

/** Every task as a row of the table, the latest activity first. */
export function ledgerTableRows(
  doc: LedgerDoc,
  places: PlaceInfoOf | undefined,
  ownerName: string | undefined,
  /** The box "Esperando você": task id → its kind. Absent = the queue of `waitsForOwner`. */
  inbox?: ReadonlyMap<string, OwnerInboxKind>,
): LedgerTableRow[] {
  const masked: MaskNote[] = [];
  return Object.values(doc.tasks)
    .map((task): LedgerTableRow => {
      const row = tarefaRow(doc, task, places, masked, { ownerName });
      const roleOnly = ROLE_ONLY.test(row.quem_pediu.trim());
      const askedBy = roleOnly ? NOT_RECORDED : row.quem_pediu;
      const withWhom = withWhomOf(doc, task, row.quem_faz_agora);
      const lastActivityAt = task.events.reduce((latest, event) => Math.max(latest, event.at), task.createdAt);
      const searchText = [row.id, row.quadro, row.titulo, row.estado, askedBy, row.pedido, row.quem_faz_agora, row.quem_criou, withWhom, row.ultima_entrega ?? '', row.decisao ?? '']
        .join('\n')
        .toLowerCase();
      return {
        task,
        row,
        askedBy,
        askedMissing: askedBy === NOT_RECORDED,
        withWhom,
        waitsForOwner: inbox ? inbox.has(task.id) : row.esperando_dono,
        onCard: inbox ? inbox.has(task.id) && CARD_KINDS.has(inbox.get(task.id)!) : row.esperando_dono,
        closed: isClosed(task),
        lastActivityAt,
        searchText,
      };
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.task.id.localeCompare(b.task.id));
}

export function inFilter(row: LedgerTableRow, filter: LedgerTableFilter): boolean {
  switch (filter) {
    case 'esperando-voce':
      return row.waitsForOwner;
    case 'sem-executor':
      // v4 has no executor apart from the owner place: an open task is one nobody took yet.
      return row.task.state === 'aberta';
    case 'cartas':
      return row.task.slack !== undefined;
    case 'tudo':
      return true;
  }
}

export function filterCounts(rows: readonly LedgerTableRow[]): Readonly<Record<LedgerTableFilter, number>> {
  const counts: Record<LedgerTableFilter, number> = { 'esperando-voce': 0, 'sem-executor': 0, cartas: 0, tudo: 0 };
  for (const row of rows) for (const { id } of LEDGER_TABLE_FILTERS) if (inFilter(row, id)) counts[id] += 1;
  return counts;
}

/** Every word of `query` appears somewhere in the row (accents count as typed). */
export function matchesSearch(row: LedgerTableRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => row.searchText.includes(word));
}

// ---------------------------------------------------------------------------------------------------------------
// The side panel: the timeline

export interface LedgerTimelineEntry {
  readonly at: number;
  /** "Criada por Líder · Donel Dev", "Entregue por Dev · painel (2 provas)". */
  readonly text: string;
  /** What a person wrote with it (without the marks). */
  readonly note?: string;
  readonly proofs?: readonly LedgerProof[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The steps of a task, oldest first, in words. */
export function timelineOf(task: LedgerTask, places: PlaceInfoOf | undefined, ownerName: string): LedgerTimelineEntry[] {
  const project = task.projectPath;
  const who = (event: LedgerTask['events'][number]): string => actorName(event.by, project, places, ownerName);
  const transfers = transfersOf(task);
  return task.events.map((event): LedgerTimelineEntry => {
    const note = eventNote(event);
    const withNote = (text: string): LedgerTimelineEntry => ({ at: event.at, text, ...(note ? { note } : {}) });
    switch (event.kind) {
      case 'criada': {
        const transfer = transfers.find((each) => each.at === event.at);
        if (transfer) {
          const from = placeLabel(project, transfer.from, undefined, places);
          const to = placeLabel(project, transfer.to, undefined, places);
          return { at: event.at, text: `Passada de ${from} para ${to} por ${who(event)}`, ...(transfer.reason ? { note: transfer.reason } : {}) };
        }
        return withNote(`Criada por ${who(event)}`);
      }
      case 'assumida':
        return withNote(`Assumida por ${who(event)}`);
      case 'entregue': {
        const proofs = event.proofs ?? [];
        const doer = doneByOf(event);
        const by = doer ? `${who(event)}, feita por ${placeLabel(project, doer, undefined, places)}` : who(event);
        return { at: event.at, text: `Entregue por ${by} (${plural(proofs.length, 'prova', 'provas')})`, ...(note ? { note } : {}), proofs };
      }
      case 'aceita':
        return withNote(`Aceita por ${who(event)}${event.option ? ` · ${event.option}` : ''}`);
      case 'rejeitada':
        return withNote(`${event.text?.startsWith('⟦cancelada⟧') ? 'Cancelada' : 'Rejeitada'} por ${who(event)}${event.option ? ` · ${event.option}` : ''}`);
      case 'conferida':
        return withNote(`Conferida por ${who(event)}`);
      case 'comentada':
        return withNote(`${who(event)} escreveu na carta`);
      case 'enviada':
        return withNote(`Envio ao Slack (${who(event)})`);
    }
  });
}

/** The proofs of the current delivery. */
export function currentProofs(task: LedgerTask): readonly LedgerProof[] {
  return lastDelivery(task)?.proofs ?? [];
}
