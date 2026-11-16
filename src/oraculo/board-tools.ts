// Quadro de tarefas (t-1e354d15) — runs the `card_*` tools for a VPS session, at the daemon's gate. Who calls comes
// from the board picture the PC left (place, folder, conversation, whether the owner made it the board's Líder), never
// from the arguments. The rules are checked here first (src/shared/board/rules.ts) for a clear refusal, and again by
// the database (`board.move_card`), which is the one that counts.

import { createHash } from 'node:crypto';
import { checkMove, STAGE_LABELS, type Justification, type Stage } from '../shared/board/rules';
import type { CardJustificationArg, CardToolCall } from '../shared/board/tools';
import { BoardError, type BoardStore, type CardRow } from './board-client';

export interface CardCaller {
  readonly placeId: string;
  /** The folder of the caller's board (the key of the Mindscape board, as the PC writes it). */
  readonly projectPath: string;
  /** Its conversation, to wake or resume it. */
  readonly sessionId?: string;
  /** The board's Líder, as the owner put it (`isBoardOrchestrator`). */
  readonly isLeader: boolean;
}

export type CardOutcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly text: string };

const fail = (text: string): CardOutcome => ({ ok: false, text });

function toJustification(j: CardJustificationArg): Justification {
  return { text: j.texto, link: j.link, due: Date.parse(j.prazo) };
}

function cardLine(card: CardRow): string {
  const who = card.place_id ? ` · ${card.place_id}` : '';
  const why = card.justification ? ` · parado: ${card.justification} (${card.justification_link}, até ${card.justification_due})` : '';
  return `${card.id} v${card.version} [${STAGE_LABELS[card.stage]}] ${card.title}${who}${card.note ? ` — ${card.note}` : ''}${why}`;
}

function cardText(card: CardRow): string {
  return JSON.stringify(
    {
      id: card.id,
      coluna: card.stage,
      nomeDaColuna: STAGE_LABELS[card.stage],
      versao: card.version,
      titulo: card.title,
      frente: card.front,
      nota: card.note,
      lugar: card.place_id,
      ...(card.justification ? { justificativa: { texto: card.justification, link: card.justification_link, prazo: card.justification_due } } : {}),
      ...(card.owner_reason ? { motivoDono: card.owner_reason } : {}),
      ...(card.done_summary ? { resumo: card.done_summary } : {}),
    },
    null,
    1,
  );
}

async function moveChecked(
  store: BoardStore,
  caller: CardCaller,
  projectId: string,
  id: string,
  to: Stage | 'same',
  extra: { nota?: string; justificativa?: CardJustificationArg; motivoDono?: string; resumo?: string; lugar?: string; versao?: number },
  now: number,
): Promise<CardOutcome> {
  const card = await store.getCard(id);
  if (!card) return fail(`cartão ${id} não existe`);
  if (card.project_id !== projectId) return fail(`o cartão ${id} é de outro projeto (${card.project_id}); mexa só nos do seu`);
  const target: Stage = to === 'same' ? card.stage : to;
  if (to === 'same' && target !== 'doing' && target !== 'blocked') return fail('justificar vale para cartão em Fazendo ou Travado');
  const lane = await store.getLane(projectId);
  const expectedVersion = extra.versao ?? card.version;
  // In the same stage (a note edit) what the card already carries still counts, as in `board.move_card`.
  const same = target === card.stage;
  const kept: Justification | undefined =
    same && card.justification && card.justification_link && card.justification_due
      ? { text: card.justification, link: card.justification_link, due: Date.parse(card.justification_due) }
      : undefined;
  const justification = extra.justificativa ? toJustification(extra.justificativa) : kept;
  const ownerReason = extra.motivoDono ?? (same ? card.owner_reason ?? undefined : undefined);
  const doneSummary = extra.resumo ?? (same ? card.done_summary ?? undefined : undefined);
  const check = checkMove({
    card: { id: card.id, projectId: card.project_id, stage: card.stage, stageSince: Date.parse(card.stage_since), placeId: card.place_id, version: card.version },
    to: target,
    actor: caller.placeId,
    lane,
    now,
    expectedVersion,
    ...(justification ? { justification } : {}),
    ...(ownerReason ? { ownerReason: ownerReason as never } : {}),
    ...(doneSummary ? { doneSummary } : {}),
    ...(extra.lugar ? { assignPlace: extra.lugar } : {}),
  });
  if (!check.ok) return fail(check.error);
  const moved = await store.moveCard({
    p_card_id: card.id,
    p_to: target,
    p_actor: caller.placeId,
    p_expected_version: expectedVersion,
    ...(extra.nota ? { p_note: extra.nota } : {}),
    ...(extra.justificativa
      ? { p_justification: extra.justificativa.texto, p_justification_link: extra.justificativa.link, p_justification_due: new Date(Date.parse(extra.justificativa.prazo)).toISOString() }
      : {}),
    ...(extra.motivoDono ? { p_owner_reason: extra.motivoDono } : {}),
    ...(extra.resumo ? { p_done_summary: extra.resumo } : {}),
    ...(extra.lugar ? { p_place_id: extra.lugar } : {}),
    ...(caller.sessionId ? { p_session_id: caller.sessionId } : {}),
  });
  return { ok: true, text: cardText(moved) };
}

export async function runCardTool(store: BoardStore, caller: CardCaller, call: CardToolCall, now: number): Promise<CardOutcome> {
  try {
    const projectId = await store.projectOf(caller.projectPath);
    // The Líder is alive and is this lane's Líder: the database's rules ("Esperando você", "A fazer") read the lane.
    if (caller.isLeader && projectId !== 'sem-projeto') await store.touchLane(projectId, caller.placeId, caller.sessionId);
    switch (call.tool) {
      case 'card_create': {
        if ((call.coluna === 'todo' || call.lugar) && !caller.isLeader) return fail('só o Líder do quadro cria direto em "A fazer" ou dá o lugar; crie na Entrada');
        const card = await store.createCard({
          p_project_id: projectId,
          p_title: call.titulo,
          p_owner_request: call.pedido,
          p_requested_by: call.quemPediu,
          p_actor: caller.placeId,
          // A retry after a timeout (the insert may have committed) must not make a second card.
          p_client_ref: `auto:${createHash('sha256').update(`${projectId}\n${caller.placeId}\n${call.titulo}\n${call.pedido}`).digest('hex').slice(0, 32)}`,
          ...(call.criterio ? { p_criterion: call.criterio } : {}),
          ...(call.frente ? { p_front: call.frente } : {}),
          ...(call.coluna ? { p_stage: call.coluna } : {}),
          ...(call.lugar ? { p_place_id: call.lugar } : {}),
        });
        return { ok: true, text: cardText(card) };
      }
      case 'card_move':
        return await moveChecked(store, caller, projectId, call.id, call.para, call, now);
      case 'card_justify':
        return await moveChecked(store, caller, projectId, call.id, 'same', { justificativa: call.justificativa, ...(call.versao ? { versao: call.versao } : {}) }, now);
      case 'card_list': {
        const cards = await store.listCards(projectId, { ...(call.coluna ? { stage: call.coluna } : {}), ...(call.todos ? { includeDone: true } : {}) });
        if (cards.length === 0) return { ok: true, text: `Nenhum cartão em ${projectId}${call.coluna ? ` na coluna ${STAGE_LABELS[call.coluna]}` : ''}.` };
        const byFront = new Map<string, CardRow[]>();
        for (const card of cards) {
          const front = card.front ?? '(sem frente)';
          byFront.set(front, [...(byFront.get(front) ?? []), card]);
        }
        const blocks = [...byFront].map(([front, list]) => `## ${front}\n${list.map(cardLine).join('\n')}`);
        return { ok: true, text: `Projeto ${projectId}\n\n${blocks.join('\n\n')}` };
      }
    }
  } catch (error) {
    if (error instanceof BoardError) return fail(error.message);
    throw error;
  }
}
