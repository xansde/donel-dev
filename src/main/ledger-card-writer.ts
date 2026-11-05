// Cartas forma A, fatia 5 (spec docs/specs/cartas-forma-a.md, Parte B) — the owner writes on a card. The words
// go, at once, to the session that owns the task; when it is closed (or never started), to the Líder único; with
// nobody open, they stay on the card (`deliveredTo: null`). Who is open is the renderer's to say (it owns the tabs):
// `deliver` crosses the board bridge to `AgentBridge.deliverOwnerMessage`, the same send driver as `sessao_enviar`.
//
// A message that vanishes or arrives twice is what this guards: the same request (the phone resent it, two clicks)
// sends once — an in-flight request is joined, and one already recorded answers from the ledger without sending.
// The send comes BEFORE the record because the record says where it went; a disk that refuses the write after the
// send is reported as such ("enviado, mas não gravou"), never retried into a second message.

import { randomUUID } from 'node:crypto';
import { commentOfRequest, commentRefusal, lastDelivery, type LedgerDeliveredTo, type LedgerTask } from '../shared/ledger/contract';
import type { PlaceNameOf } from '../shared/ledger/labels';
import type { LedgerService } from './ledger-store';

/** What the main asks the renderer to deliver: to the place, or (closed) to the Líder único. */
export interface OwnerMessage {
  readonly projectPath: string;
  readonly placeId: string;
  /** For the session that owns the task. */
  readonly text: string;
  /** For the Líder único, naming the place and the board. */
  readonly leaderText: string;
}

export type DeliverOwnerMessage = (message: OwnerMessage) => Promise<LedgerDeliveredTo>;

export type CardWriteResult = { readonly ok: true; readonly deliveredTo: LedgerDeliveredTo; readonly at: number } | { readonly ok: false; readonly reason: string };

export interface CardWriterDeps {
  readonly service: () => LedgerService | null;
  readonly deliver: DeliverOwnerMessage;
  readonly placeName?: PlaceNameOf;
}

export interface CardWriter {
  /** The owner writes on the card (no decision): recorded as `comentada`, sent at once. */
  write(input: { readonly id: string; readonly text: string; readonly requestId?: string }): Promise<CardWriteResult>;
  /** The owner's words that went WITH a decision (already recorded as its text): only sent. */
  tell(task: LedgerTask, text: string): Promise<LedgerDeliveredTo>;
}

function folder(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
}

/** The card's human title, for the message (the agent sees the id on the next line). */
function cardTitle(task: LedgerTask): string {
  const title = lastDelivery(task)?.forOwner?.title ?? task.title ?? task.request;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

export function ownerMessage(task: LedgerTask, text: string, placeName?: PlaceNameOf): OwnerMessage {
  const answer = `(responda entregando a tarefa ${task.id} de novo, ou com tarefa_ver para reler)`;
  const owner = placeName?.(task.projectPath, task.ownerPlaceId)?.trim() || 'o lugar dono';
  return {
    projectPath: task.projectPath,
    placeId: task.ownerPlaceId,
    text: `◆ Do dono, na carta «${cardTitle(task)}»: ${text}\n${answer}`,
    leaderText: `◆ Do dono, na carta «${cardTitle(task)}», para ${owner} (${task.ownerPlaceId}) do quadro ${folder(task.projectPath)}, que está fechada: ${text}\n${answer}`,
  };
}

export function createCardWriter(deps: CardWriterDeps): CardWriter {
  const inFlight = new Map<string, Promise<CardWriteResult>>();

  const send = (message: OwnerMessage): Promise<LedgerDeliveredTo> => deps.deliver(message).catch(() => null);

  async function run(input: { readonly id: string; readonly text: string; readonly requestId?: string }): Promise<CardWriteResult> {
    const service = deps.service();
    if (!service) return { ok: false, reason: 'O Oráculo Harrow não abriu neste app.' };
    let task: LedgerTask | undefined;
    try {
      task = service.load().doc.tasks[input.id];
    } catch (error) {
      return { ok: false, reason: `Não consegui ler o Oráculo Harrow (${error instanceof Error ? error.message : String(error)}).` };
    }
    if (!task) return { ok: false, reason: 'Esta carta não existe mais.' };
    const previous = input.requestId ? commentOfRequest(task, input.requestId) : undefined;
    if (previous) return { ok: true, deliveredTo: previous.deliveredTo ?? null, at: previous.at };
    const why = commentRefusal(task, { kind: 'dono' }, input.text);
    if (why) return { ok: false, reason: `Não enviei: ${why}` };
    const text = input.text.trim();
    const deliveredTo = await send(ownerMessage(task, text, deps.placeName));
    const result = service.apply({ kind: 'dono' }, { op: 'comentar', id: task.id, text, ...(input.requestId ? { requestId: input.requestId } : {}), deliveredTo });
    if (!result.ok) return { ok: false, reason: deliveredTo ? `Enviado, mas não gravou na carta: ${result.reason}` : `Não gravou: ${result.reason}` };
    const recorded = input.requestId ? commentOfRequest(result.task, input.requestId) : result.task.events.at(-1);
    return { ok: true, deliveredTo, at: recorded?.at ?? Date.now() };
  }

  return {
    write(input) {
      const key = input.requestId ?? randomUUID();
      const running = inFlight.get(key);
      if (running) return running;
      const promise = run(input).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    tell(task, text) {
      return text.trim() ? send(ownerMessage(task, text.trim(), deps.placeName)) : Promise.resolve(null);
    },
  };
}
