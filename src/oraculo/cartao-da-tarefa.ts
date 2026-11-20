// Quadro de tarefas (t-1e354d15, t-8406f473 PR 1) — the card of an Oráculo task, opened when a session assumes it
// (`tarefa_assumir` answered at the gate). The Líder único (r-f4c27f39): "o cartão nasce sozinho no tarefa_assumir (o
// Oráculo cria em Fazendo, ligado à sessão), e a sessão só faz card_create à mão para trabalho sem tarefa".
//
// The card is the seed's (src/board-cron/semente.ts): `client_ref = oraculo:<id>`, the task's title, request, who
// asked and front. Found by that ref, or by `oraculo_id` (a card the Líder made by hand for the task):
// - in Entrada, A fazer or Travado (or Fazendo of another place: the task changed hands), it goes to Fazendo with the
//   caller's place, moved by `servico:assumir` as the Líder (the triage is his), then gets the caller's session;
// - in Fazendo of the caller's place, it only gets the session, when it has none;
// - in Feito or Esperando você, it is left alone;
// - none: born in A fazer with the caller's place and moved to Fazendo by the caller itself, with its session.
// A folder of no project (sem-projeto) gets no card. The caller never waits on this: the gate runs it after answering.

import { frenteOf, requestedByOf, type LedgerTask } from '../shared/ledger/contract';
import type { BoardStore, CardRow } from './board-client';

export const ASSUMIR_ACTOR = 'servico:assumir';
const NOTE = 'assumida no Oráculo';
const NO_PROJECT = 'sem-projeto';

export interface TaskCardCaller {
  readonly placeId: string;
  /** The caller's board folder (its project on the task board). */
  readonly projectPath: string;
  /** Its conversation, to wake or resume it. */
  readonly sessionId?: string;
}

export type TaskCardOutcome =
  | { readonly kind: 'criado' | 'movido' | 'sessao' | 'ja-estava'; readonly card: CardRow }
  | { readonly kind: 'sem-projeto' }
  | { readonly kind: 'parado'; readonly card: CardRow };

export const taskCardRef = (taskId: string): string => `oraculo:${taskId}`;

/** The live card of task `taskId`: by the seed's ref, else the newest not done with its `oraculo_id`. */
async function liveCardOf(store: BoardStore, taskId: string): Promise<CardRow | null> {
  const byRef = await store.cardByClientRef(taskCardRef(taskId));
  if (byRef && byRef.stage !== 'done') return byRef;
  const byTask = (await store.cardByOraculoId?.(taskId)) ?? null;
  return byTask ?? byRef;
}

async function withSession(store: BoardStore, card: CardRow, caller: TaskCardCaller): Promise<CardRow> {
  if (!caller.sessionId || card.session_id || card.place_id !== caller.placeId || !store.fillSession) return card;
  return (await store.fillSession(card.id, caller.placeId, caller.sessionId)) ? { ...card, session_id: caller.sessionId } : card;
}

/** Opens (or ties) the card of `task` for `caller`, who has just assumed it. Throws what the board throws. */
export async function openTaskCard(store: BoardStore, task: LedgerTask, caller: TaskCardCaller, again = false): Promise<TaskCardOutcome> {
  const projectId = await store.projectOf(caller.projectPath);
  if (projectId === NO_PROJECT) return { kind: NO_PROJECT };
  const existing = await liveCardOf(store, task.id);
  if (existing) {
    if (existing.stage === 'done' || existing.stage === 'waiting_owner') return { kind: 'parado', card: existing };
    if (existing.stage === 'doing' && existing.place_id === caller.placeId) {
      const filled = await withSession(store, existing, caller);
      return { kind: filled === existing ? 'ja-estava' : 'sessao', card: filled };
    }
    const moved = await store.moveCard({
      p_card_id: existing.id,
      p_to: 'doing',
      p_actor: ASSUMIR_ACTOR,
      p_expected_version: existing.version,
      p_note: NOTE,
      p_place_id: caller.placeId,
      ...(caller.sessionId ? { p_session_id: caller.sessionId } : {}),
      p_as_leader: true,
    });
    return { kind: 'movido', card: await withSession(store, moved, caller) };
  }
  const front = frenteOf(task);
  const created = await store.createCard({
    p_project_id: projectId,
    p_title: (task.title?.trim() || task.request.split('\n')[0]!.trim() || task.id).slice(0, 120),
    p_owner_request: task.request,
    p_criterion: task.doneWhen,
    p_requested_by: requestedByOf(task) ?? 'não registrado',
    p_actor: ASSUMIR_ACTOR,
    p_client_ref: taskCardRef(task.id),
    p_stage: 'todo',
    p_place_id: caller.placeId,
    ...(front ? { p_front: front.slice(0, 40) } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(task.due) ? { p_due: task.due } : {}),
    p_risk: task.risk === 'alto' ? 'alto' : 'baixo',
    p_oraculo_id: task.id,
    p_as_leader: true,
  });
  // A create cut before its move (or a ref another call just made) is finished like any card already there.
  if (created.stage !== 'todo' || created.place_id !== caller.placeId || created.version !== 1) {
    return again ? { kind: 'parado', card: created } : openTaskCard(store, task, caller, true);
  }
  const moved = await store.moveCard({
    p_card_id: created.id,
    p_to: 'doing',
    p_actor: caller.placeId,
    p_expected_version: created.version,
    p_note: NOTE,
    ...(caller.sessionId ? { p_session_id: caller.sessionId } : {}),
  });
  return { kind: 'criado', card: moved };
}
