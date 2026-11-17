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
//   decisao-parada   t-66ee824e: a decision of the owner stopped outside a card — the last andamento says
//                    "precisa-do-dono", or the task sits with the Líder único, or a high-risk one sits with someone who
//                    does not do the work (a board's Líder, Curador, Pesquisa, a service), for DECISION_STOPPED_MS
// Order: what blocks someone, then the due date, then the age.

import { LEADER_OF_ALL } from '../mindscape/leader';
import { isProgressEvent, progressOf } from './andamento';
import {
  agentBotOutcome,
  awaitsSend,
  inDailySample,
  isCancelled,
  isClosed,
  isServicePlace,
  registersForOthers,
  lastDecision,
  lastDelivery,
  lastWorkAt,
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
  // Nor does a headless service (t-a1ea2798): no board has its place.
  if (task.ownerPlaceId === LEADER_OF_ALL || isServicePlace(task.ownerPlaceId)) return null;
  const states = places?.get(task.projectPath);
  if (!states) return null;
  const state = states.get(task.ownerPlaceId);
  if (state === undefined) return 'o lugar dono saiu do quadro';
  if (state === 'fechada') return 'o lugar dono está fechado';
  // A front mark is no work: naming the front of a task never starts the grace of its owner place again.
  const since = lastWorkAt(task);
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

export type OwnerInboxKind =
  | 'decidir-entrega'
  | 'aprovar-carta'
  | 'entrega-parada'
  | 'para-repassar'
  | 'carta-parada'
  | 'conferir-envio'
  | 'amostra-revisor'
  | 'decisao-parada';

/** Kinds where someone (a session, the person a letter is for) stands still until the owner acts. */
const BLOCKS: Readonly<Record<OwnerInboxKind, boolean>> = {
  'decidir-entrega': true,
  'aprovar-carta': true,
  'entrega-parada': true,
  'para-repassar': true,
  'carta-parada': true,
  'conferir-envio': false,
  'amostra-revisor': false,
  'decisao-parada': true,
};

/** A low-risk delivery the Revisor did not decide in this long goes up to the owner. */
export const STALE_DELIVERY_MS = 24 * 60 * 60 * 1000;
/** An accepted letter is normally sent in seconds; still unsent after this long, it is stuck. */
export const STUCK_LETTER_MS = 30 * 60 * 1000;
/** The answer of a send comes in seconds; no answer after this long means nobody knows if it arrived. */
export const SEND_ANSWER_GRACE_MS = 10 * 60 * 1000;

/** A task with the Líder único, or a high-risk one with someone who does not do the work, is a stopped decision after this long. */
export const DECISION_STOPPED_MS = 2 * 60 * 60 * 1000;

/** The kinds decided on the card (`LedgerCards`): the box and the table open the card on them. */
export const CARD_KINDS: ReadonlySet<OwnerInboxKind> = new Set<OwnerInboxKind>(['decidir-entrega', 'aprovar-carta', 'entrega-parada', 'amostra-revisor']);

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

/** The role each place signed its events with (a task does not keep its owner's role). */
function placeRoles(doc: LedgerDoc): ReadonlyMap<string, string> {
  const roles = new Map<string, string>();
  for (const task of Object.values(doc.tasks)) for (const event of task.events) if (event.by.kind === 'lugar' && event.by.roleId) roles.set(event.by.placeId, event.by.roleId);
  return roles;
}

/** The last thing done on the task, leaving out the app's own end-of-turn records (they say nothing was decided). */
function lastMoveAt(task: LedgerTask): number {
  let at = task.createdAt;
  for (const event of task.events) if (progressOf(event)?.estado !== 'turno-encerrado') at = Math.max(at, event.at);
  return at;
}

/** Why `task` is a decision of the owner stopped outside a card (t-66ee824e), or `null`. Not for a delivered task: that one is a card. */
function stoppedDecision(task: LedgerTask, now: number, roles: ReadonlyMap<string, string>): { since: number; why: string } | null {
  if (isClosed(task) || task.state === 'entregue' || task.slack) return null;
  for (let i = task.events.length - 1; i >= 0; i -= 1) {
    const event = task.events[i]!;
    if (!isProgressEvent(event)) continue;
    const progress = progressOf(event);
    if (!progress || progress.estado === 'turno-encerrado') continue;
    // Said by whoever had it before a transfer: the place that got it decides again (often the Líder already did).
    if (event.by.kind !== 'lugar' || event.by.placeId !== task.ownerPlaceId) break;
    if (progress.estado === 'precisa-do-dono') return { since: event.at, why: progress.precisa ? `pediu você: ${progress.precisa}` : 'a sessão disse que precisa de você' };
    break;
  }
  const idle = now - lastMoveAt(task);
  if (idle < DECISION_STOPPED_MS) return null;
  if (task.ownerPlaceId === LEADER_OF_ALL) return { since: lastMoveAt(task), why: 'parada com o Líder único, sem carta' };
  const notDoer = isServicePlace(task.ownerPlaceId) || registersForOthers(roles.get(task.ownerPlaceId));
  if (task.risk === 'alto' && (task.state === 'aberta' || task.state === 'em-execucao') && notDoer)
    return { since: lastMoveAt(task), why: 'risco alto parado com quem não executa, sem carta' };
  return null;
}

/** The one item of `task`, or `null` when nothing of it waits for the owner. */
function itemOf(doc: LedgerDoc, task: LedgerTask, now: number, places: PlaceStates | undefined, roles: ReadonlyMap<string, string>): OwnerInboxItem | null {
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
  const stopped = stoppedDecision(task, now, roles);
  if (stopped) return item('decisao-parada', stopped.since, stopped.why);
  const orphan = orphanReasonIn(places, task, now);
  return orphan ? item('para-repassar', task.events.at(-1)?.at ?? task.createdAt, orphan) : null;
}

/**
 * The box of one board (`projectPath`), or of every board (`null`), in its order. `places` gives the orphans: a board
 * missing from it is unknown, and none of its tasks is called orphan.
 */
export function ownerInbox(doc: LedgerDoc, projectPath: string | null, now: number, places?: PlaceStates): OwnerInboxItem[] {
  const items: OwnerInboxItem[] = [];
  const roles = placeRoles(doc);
  for (const task of Object.values(doc.tasks)) {
    if (projectPath !== null && task.projectPath !== projectPath) continue;
    const item = itemOf(doc, task, now, places, roles);
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
