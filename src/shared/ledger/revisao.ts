// Canal do Donel fora do PC (t-e195b35c, item 5) — the Dev and the Revisor of outside its chain talk directly while a
// delivery waits for a verdict, with no arrow drawn and no schema change, and both hear the delivery and the verdict
// at once. Pure: the rule of "out of the chain" is the one of `liveReviewersOutside`/`decideRefusal` (ledger-store.ts):
// a Revisor neither opened by nor below anyone who delivered or did the work.

import { isBelow, isLiveListedPlace, isOpenedBy, type ListedPlace } from '../mindscape/reach';
import type { MindscapeBoard } from '../mindscape/model';
import { doneByOf, isReviewerRole, lastDelivery, type LedgerDoc, type LedgerTask } from './contract';

/** The live places with a Revisor role on `board` out of the chain of every place of `from`. */
export function reviewersOutsideChain(board: MindscapeBoard, isLive: (placeId: string) => boolean, from: readonly string[]): string[] {
  return Object.values(board.cards)
    .filter((card) => card.kind === 'session' && isReviewerRole(card.roleId))
    .map((card) => card.id)
    .filter((id) => isLive(id) && from.every((placeId) => placeId !== id && !isOpenedBy(board, placeId, id) && !isBelow(board, placeId, id)));
}

/** Who delivered a task and who did its work (`feitoPor`), with its owner place: whom the verdict concerns. */
export function deliverersOf(task: LedgerTask): string[] {
  const delivery = lastDelivery(task);
  const ids = [task.ownerPlaceId, delivery?.by.kind === 'lugar' ? delivery.by.placeId : undefined, doneByOf(delivery)];
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
}

/**
 * `a` and `b` may talk with no arrow: a task of this board waits for a verdict (`entregue`), one of them is its owner or
 * who did the work, and the other is a live Revisor out of the chain of everyone who delivered it. Both ways.
 */
export function reviewLink(doc: LedgerDoc, board: MindscapeBoard | undefined, places: readonly ListedPlace[], a: string, b: string): boolean {
  if (!board || a === b) return false;
  const isLive = (id: string): boolean => isLiveListedPlace(places.find((place) => place.id === id));
  return Object.values(doc.tasks).some((task) => {
    if (task.state !== 'entregue' || task.projectPath !== board.projectPath) return false;
    const deliverers = deliverersOf(task);
    const sides = new Set([task.ownerPlaceId, doneByOf(lastDelivery(task))].filter((id): id is string => id !== undefined));
    const reviewers = reviewersOutsideChain(board, isLive, deliverers);
    return (sides.has(a) && reviewers.includes(b)) || (sides.has(b) && reviewers.includes(a));
  });
}

const titled = (task: LedgerTask): string => `${task.id}${task.title ? ` «${task.title}»` : ''}`;

/** To each Revisor of outside the chain, when a task is delivered for acceptance. */
export function reviewRequestNotice(from: string, task: LedgerTask): string {
  return `${from} entregou a tarefa ${titled(task)} para aceite, e você é Revisor de fora da cadeia de quem entregou. Leia a prova com tarefa_ver ${task.id} e decida com tarefa_aceitar ou tarefa_rejeitar (com o motivo). Para falar com quem entregou, sessao_enviar com "para": "${task.ownerPlaceId}".`;
}

/** To the owner of the task and to who did the work, when a Revisor decides it. */
export function verdictNotice(reviewer: string, accepted: boolean, task: LedgerTask, reason?: string): string {
  return accepted
    ? `o Revisor ${reviewer} aceitou ${titled(task)}. Ela está fechada.`
    : `o Revisor ${reviewer} devolveu ${titled(task)}: ${reason ?? 'sem motivo escrito'}. Corrija e entregue de novo com tarefa_entregar; para falar com ele, sessao_enviar.`;
}

/** Whom a verdict reaches: the owner place and who did the work, never the one that decided. */
export function verdictTargets(task: LedgerTask, decidedBy: string): string[] {
  return [...new Set([task.ownerPlaceId, doneByOf(lastDelivery(task))].filter((id): id is string => id !== undefined && id !== decidedBy))];
}
