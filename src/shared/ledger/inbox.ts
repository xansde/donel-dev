// Ledger v5, fatia 1 (docs/planos/ledger-v5.md, 1.8) — the box "Esperando você": everything that waits for the owner,
// as typed items, each with its verb. A pure READING of the v4 ledger: nothing here is written, no field, no mark, no
// new version (another channel and the VPS copy the file byte by byte). `waitsForOwner` keeps its meaning (the
// Supabase mirror reads it); this list is wider and lives apart.
//
// What v4 lets us derive (the other kinds of 1.8 need the v5 states):
//   decidir-entrega  delivered, high risk, not a letter          → the owner decides (the card)
//   aprovar-carta    a Slack letter waiting for the owner        → the owner sends it or not (the card)
//   entrega-parada   delivered, low risk, no decision for 24 h   → the owner decides in the Revisor's place (the card)
//   para-repassar    not closed, its owner place is gone         → someone has to take it over or cancel it
//   carta-parada     a letter accepted and not sent for 30 min   → it still has to go out
//   conferir-envio   a send with no answer, or one that failed (a letter, or a post of an agent's own bot)
//   amostra-revisor  the daily sample of the Revisor's accepts (D2)
// Order: what blocks someone, then the due date, then the age.

import { LEADER_OF_ALL } from '../mindscape/leader';
import {
  agentBotOutcome,
  awaitsSend,
  inDailySample,
  isCancelled,
  isClosed,
  lastDecision,
  lastDelivery,
  slackSendState,
  type LedgerDoc,
  type LedgerTask,
} from './contract';

/** The places of the boards that could be read: project folder → place id → state (`sessao_listar`'s `estado`). */
export type PlaceStates = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** A place that has not started is gone only after this long (a place made a moment ago is still opening). */
export const NOT_STARTED_GRACE_MS = 30 * 60 * 1000;

/**
 * Why the owner place of `task` can no longer do the work (closed, out of the board, never started); `null` = alive or
 * unknown (its board is not in `places`). The one rule of `tarefa_listar`'s orphans (`ledger-store.ts`) and of the box.
 */
export function ownerGoneIn(places: PlaceStates | undefined, task: LedgerTask, now: number): string | null {
  // The Líder único has no place on any board (t-52b31719): a task it owns is alive, never orphan.
  if (task.ownerPlaceId === LEADER_OF_ALL) return null;
  const states = places?.get(task.projectPath);
  if (!states) return null;
  const state = states.get(task.ownerPlaceId);
  if (state === undefined) return 'o lugar dono saiu do quadro';
  if (state === 'fechada') return 'o lugar dono está fechado';
  const since = task.events.at(-1)?.at ?? task.createdAt;
  if (state === 'nao-comecou' && now - since >= NOT_STARTED_GRACE_MS) return 'o lugar dono não começou';
  return null;
}

/**
 * Why a task is orphan (not closed, its owner place gone); `null` = alive, closed or unknown. A delivered task waits
 * for whoever decides, and an accepted letter never sent waits for its send: neither waits for its owner place.
 */
export function orphanReasonIn(places: PlaceStates | undefined, task: LedgerTask, now: number): string | null {
  return isClosed(task) || task.state === 'entregue' || awaitsSend(task) ? null : ownerGoneIn(places, task, now);
}

export type OwnerInboxKind = 'decidir-entrega' | 'aprovar-carta' | 'entrega-parada' | 'para-repassar' | 'carta-parada' | 'conferir-envio' | 'amostra-revisor';

/** Kinds where someone (a session, the person a letter is for) stands still until the owner acts. */
const BLOCKS: Readonly<Record<OwnerInboxKind, boolean>> = {
  'decidir-entrega': true,
  'aprovar-carta': true,
  'entrega-parada': true,
  'para-repassar': true,
  'carta-parada': true,
  'conferir-envio': false,
  'amostra-revisor': false,
};

/** A low-risk delivery the Revisor did not decide in this long goes up to the owner. */
export const STALE_DELIVERY_MS = 24 * 60 * 60 * 1000;
/** An accepted letter is normally sent in seconds; still unsent after this long, it is stuck. */
export const STUCK_LETTER_MS = 30 * 60 * 1000;
/** The answer of a send comes in seconds; no answer after this long means nobody knows if it arrived. */
export const SEND_ANSWER_GRACE_MS = 10 * 60 * 1000;

export interface OwnerInboxItem {
  readonly kind: OwnerInboxKind;
  readonly task: LedgerTask;
  /** Since when it waits for the owner (ms). */
  readonly since: number;
  readonly blocks: boolean;
  /** What happened, for the kinds the card does not explain: the orphan's reason, the send's state. */
  readonly why?: string;
}

function lastSendAt(task: LedgerTask): number {
  for (let i = task.events.length - 1; i >= 0; i -= 1) if (task.events[i]!.kind === 'enviada') return task.events[i]!.at;
  return task.createdAt;
}

const SEND_WHY = { 'sem-confirmacao': 'saiu sem resposta do Slack', falhou: 'o Slack recusou o envio', esgotada: 'o Slack recusou o envio duas vezes' } as const;

/** The one item of `task`, or `null` when nothing of it waits for the owner. */
function itemOf(doc: LedgerDoc, task: LedgerTask, now: number, places: PlaceStates | undefined): OwnerInboxItem | null {
  const item = (kind: OwnerInboxKind, since: number, why?: string): OwnerInboxItem => ({ kind, task, since, blocks: BLOCKS[kind], ...(why ? { why } : {}) });
  if (isCancelled(task)) return null;
  if (task.state === 'entregue') {
    const deliveredAt = lastDelivery(task)?.at ?? task.createdAt;
    if (task.slack) return item('aprovar-carta', deliveredAt);
    if (task.risk === 'alto') return item('decidir-entrega', deliveredAt);
    return now - deliveredAt >= STALE_DELIVERY_MS ? item('entrega-parada', deliveredAt) : null;
  }
  if (task.slack && task.state === 'aceita') {
    const send = slackSendState(task);
    const acceptedAt = lastDecision(task)?.at ?? task.createdAt;
    if (send === 'nenhum') return now - acceptedAt >= STUCK_LETTER_MS ? item('carta-parada', acceptedAt) : null;
    if (send === 'sem-confirmacao') return now - lastSendAt(task) >= SEND_ANSWER_GRACE_MS ? item('conferir-envio', lastSendAt(task), SEND_WHY[send]) : null;
    if (send === 'falhou' || send === 'esgotada') return item('conferir-envio', lastSendAt(task), SEND_WHY[send]);
    return null;
  }
  const bot = agentBotOutcome(task);
  if (bot === 'falhou' || bot === 'sem-confirmacao') return item('conferir-envio', lastDelivery(task)?.at ?? task.createdAt, bot === 'falhou' ? 'o envio pelo bot do agente falhou' : 'saiu pelo bot do agente sem resposta do Slack');
  if (inDailySample(doc, task)) return item('amostra-revisor', lastDecision(task)?.at ?? task.createdAt);
  const orphan = orphanReasonIn(places, task, now);
  return orphan ? item('para-repassar', task.events.at(-1)?.at ?? task.createdAt, orphan) : null;
}

/**
 * The box of one board (`projectPath`), or of every board (`null`), in its order. `places` gives the orphans: a board
 * missing from it is unknown, and none of its tasks is called orphan.
 */
export function ownerInbox(doc: LedgerDoc, projectPath: string | null, now: number, places?: PlaceStates): OwnerInboxItem[] {
  const items: OwnerInboxItem[] = [];
  for (const task of Object.values(doc.tasks)) {
    if (projectPath !== null && task.projectPath !== projectPath) continue;
    const item = itemOf(doc, task, now, places);
    if (item) items.push(item);
  }
  return items.sort((a, b) => Number(b.blocks) - Number(a.blocks) || a.task.due.localeCompare(b.task.due) || a.since - b.since || a.task.id.localeCompare(b.task.id));
}

/** The strip's line: how many wait, and since when the oldest one waits (`null` = none). */
export function inboxSummary(items: readonly OwnerInboxItem[]): { readonly total: number; readonly oldestSince: number | null } {
  return { total: items.length, oldestSince: items.length ? Math.min(...items.map((item) => item.since)) : null };
}

/** The projects whose place states the box needs (tasks not closed). */
export function inboxBoards(doc: LedgerDoc): string[] {
  return [...new Set(Object.values(doc.tasks).filter((task) => !isClosed(task)).map((task) => task.projectPath))];
}
