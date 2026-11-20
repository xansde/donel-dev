// Quadro de tarefas (t-8406f473, recado r-a01b8ca6 do Líder único, 20/11): "cartões importados do Oráculo ficam com dono
// 'lider' mesmo depois de tarefa_transferir para uma sessão, e não fecham quando a tarefa é aceita ou cancelada. [...]
// Conserto: o cartão segue o dono da tarefa a cada tarefa_transferir, e vai a Feito ou Cancelado quando a tarefa é
// aceita ou cancelada."
//
// The card of an Oráculo task (`oraculo_id`) follows that task. Pure: the board-cron reads the board and the Oráculo's
// ledger (read-only) and applies what this returns (src/board-cron/segue-oraculo.ts), every round and once by hand
// (`board-cron.mjs sincronizar [--seco]`). The task is the truth for WHO does it and WHETHER it is over; the card keeps
// what the board alone knows (Travado with its justification, Esperando você with its reason). Rules:
//
// - No `oraculo_id`, or the task is not in the ledger: nothing.
// - The task closed (`isClosed`): the card goes to Feito, with the task's owner as its place, unless it is there already.
//   The board has no "Cancelado" column (the stages are fixed in rules.ts, the SQL and the page): a cancelled task's
//   card goes to Feito with the summary "cancelada no Oráculo: <motivo>", an accepted one with "aceita no Oráculo", a
//   rejected Slack letter with "carta rejeitada no Oráculo: <motivo>". The summary says which. A card of a closed task
//   is never reopened here (more work on it is a new task).
// - The task is live: the card's place is the task's owner (`ownerPlaceId`), on every transfer; to give a task's card
//   to another place, transfer the task. The stage follows only where the task says something the card contradicts:
//   - em-execucao or entregue (the owner assumed it): Entrada or A fazer → Fazendo;
//   - aberta (transferred and not assumed yet): Fazendo or Travado of the previous owner → A fazer of the new one;
//   - rejeitada (devolvida, not cancelled): Entrada → A fazer, to redo; a card in Fazendo or Travado stays (the owner
//     is redoing it);
//   - Esperando você is never moved (the Líder's and the owner's);
//   - Feito reopens only when the task moved after the card closed (assumida, rejeitada or transferida newer than the
//     card's `stage_since`): em-execucao/entregue → Fazendo, aberta/rejeitada → A fazer. A delivery after the card
//     went to Feito does not reopen it.
//   An accepted Slack letter still to be sent (`awaitsSend`) is live with no stage to follow: only its place.
// - Nothing to change: null (no write, no version).
//
// Who moves is `servico:oraculo`, as the Líder (the triage is his, as `servico:assumir`); the note says why. The session
// of the new place is the round's own resolution (place → the session alive here that holds it), filled after the move.

import { eventNote, isCancelled, isClosed, lastDecision, type LedgerTask } from '../ledger/contract';
import type { Stage } from './rules';

export const ORACULO_ACTOR = 'servico:oraculo';

/** What the follow reads of a card (a board row in epoch ms). */
export interface FollowCard {
  readonly id: string;
  readonly projectId: string;
  readonly stage: Stage;
  /** Epoch ms of its last stage change. */
  readonly stageSince: number;
  readonly placeId: string | null;
  readonly sessionId: string | null;
  readonly version: number;
  readonly oraculoId: string | null;
}

/** One change to a card: a move (compare-and-swap on `expectedVersion`), then its session when there is one. */
export interface FollowStep {
  readonly cardId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly from: Stage;
  readonly to: Stage;
  readonly fromPlace: string | null;
  /** The task's owner: the card's place after the move. */
  readonly place: string;
  /** The session of `place` to fill after the move (the move as the service leaves none); absent = none known. */
  readonly session?: string;
  /** Only for Feito. */
  readonly doneSummary?: string;
  /** Why (the card's note, at most 200 characters). */
  readonly note: string;
}

const MAX_REASON = 120;

/** The first line of a person's text, cut short for a note or a summary. */
function shortReason(text: string | undefined): string {
  const line = (text ?? '').split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  const chars = Array.from(line);
  return chars.length > MAX_REASON ? `${chars.slice(0, MAX_REASON - 1).join('')}…` : line;
}

/** Feito's summary for a closed task. */
function closedSummary(task: LedgerTask): string {
  const decision = lastDecision(task);
  const reason = decision ? shortReason(eventNote(decision)) : '';
  if (isCancelled(task)) return reason ? `cancelada no Oráculo: ${reason}` : 'cancelada no Oráculo';
  if (task.state === 'aceita') return 'aceita no Oráculo';
  return reason ? `carta rejeitada no Oráculo: ${reason}` : 'carta rejeitada no Oráculo';
}

const TRANSFER = '⟦transferida de ';

/** The task moved after `since`: assumed, rejected or transferred (a delivery or a comment does not count). */
function movedSince(task: LedgerTask, since: number): boolean {
  return task.events.some(
    (event) => event.at > since && (event.kind === 'assumida' || event.kind === 'rejeitada' || (event.kind === 'criada' && (event.text ?? '').startsWith(TRANSFER))),
  );
}

/** The stage the live task asks of the card; the card's own when it says nothing. */
function liveStage(card: FollowCard, task: LedgerTask, placeChanges: boolean): Stage {
  if (card.stage === 'waiting_owner') return card.stage;
  const working = task.state === 'em-execucao' || task.state === 'entregue';
  if (card.stage === 'done') {
    if (!movedSince(task, card.stageSince)) return card.stage;
    if (working) return 'doing';
    return task.state === 'aberta' || task.state === 'rejeitada' ? 'todo' : card.stage;
  }
  if (working) return card.stage === 'inbox' || card.stage === 'todo' ? 'doing' : card.stage;
  if (task.state === 'aberta') return placeChanges && (card.stage === 'doing' || card.stage === 'blocked') ? 'todo' : card.stage;
  if (task.state === 'rejeitada') return card.stage === 'inbox' ? 'todo' : card.stage;
  return card.stage;
}

function liveNote(card: FollowCard, task: LedgerTask, to: Stage, placeChanges: boolean, owner: string): string {
  const parts: string[] = [];
  if (to !== card.stage) {
    if (to === 'doing') parts.push(task.state === 'entregue' ? 'entregue no Oráculo' : 'assumida no Oráculo');
    else if (task.state === 'rejeitada') {
      const decision = lastDecision(task);
      const reason = decision ? shortReason(eventNote(decision)) : '';
      parts.push(reason ? `devolvida no Oráculo: ${reason}` : 'devolvida no Oráculo');
    } else parts.push('aberta no Oráculo, falta assumir');
  }
  if (placeChanges || parts.length === 0) parts.push(`dono da tarefa: ${owner}`);
  return parts.join(' · ');
}

/**
 * What the card of `task` must change to follow it, or null. `sessionOf`: the session alive here that holds a place on
 * a project (the round's resolver); missing = only the card's own session is kept.
 */
export function planTaskFollow(card: FollowCard, task: LedgerTask | undefined, sessionOf?: (projectId: string, placeId: string) => string | undefined): FollowStep | null {
  if (!card.oraculoId || !task || task.id !== card.oraculoId) return null;
  const owner = task.ownerPlaceId?.trim();
  if (!owner) return null;
  const placeChanges = owner !== card.placeId;
  const base = { cardId: card.id, taskId: task.id, expectedVersion: card.version, from: card.stage, fromPlace: card.placeId, place: owner };
  if (isClosed(task)) {
    if (card.stage === 'done') return null;
    const summary = closedSummary(task);
    return { ...base, to: 'done', doneSummary: summary, note: placeChanges ? `${summary} · dono da tarefa: ${owner}` : summary };
  }
  const to = liveStage(card, task, placeChanges);
  if (to === card.stage && !placeChanges) return null;
  // The move as the service drops the session (it is not the place's own move): the new place's session, or the one
  // the card already had when the place is the same.
  const session = to === 'done' ? undefined : placeChanges ? sessionOf?.(card.projectId, owner) : (card.sessionId ?? sessionOf?.(card.projectId, owner));
  return { ...base, to, note: liveNote(card, task, to, placeChanges, owner), ...(session ? { session } : {}) };
}
