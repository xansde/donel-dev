// Andamento no ledger (08/11) — where a session's record goes, and the compact read the Líder makes when it wants
// (`tarefa_novidades`), instead of one "◆ … terminou" per turn in its chat. Pure: the main gives the clock.

import { eventNote, isClosed, priorityMarkOf, transfersOf, viewState, type LedgerDoc, type LedgerEvent, type LedgerTask } from './contract';
import { isProgressEvent, progressOf, type LedgerProgress } from './andamento';

/** The latest moment something happened to the task. */
function lastActivity(task: LedgerTask): number {
  return task.events.at(-1)?.at ?? task.createdAt;
}

/** The task that takes a place's record: the one named, or its live task with the latest activity. */
export function progressTaskOf(doc: LedgerDoc, projectPath: string, placeId: string, id?: string): LedgerTask | { readonly reason: string } {
  if (id) {
    const task = doc.tasks[id];
    if (!task) return { reason: `Não existe tarefa "${id}" (veja tarefa_listar).` };
    if (task.projectPath !== projectPath) return { reason: 'A tarefa é de outro quadro; o andamento vai numa tarefa do seu quadro.' };
    return task;
  }
  const live = Object.values(doc.tasks).filter((task) => task.projectPath === projectPath && task.ownerPlaceId === placeId && !task.slack && !isClosed(task));
  if (!live.length) return { reason: 'Você não é dono de nenhuma tarefa viva neste quadro: crie uma com tarefa_criar (dono: você) e registre nela.' };
  return live.reduce((latest, task) => (lastActivity(task) > lastActivity(latest) ? task : latest));
}

/**
 * The app's own record at the end of a turn adds nothing when the session itself wrote one during that turn: a
 * record of its own (not `turno-encerrado`) by `placeId` at or after `turnSince` (the end of its previous turn).
 */
export function turnAlreadyRecorded(task: LedgerTask, placeId: string, turnSince: number | undefined): boolean {
  if (turnSince === undefined) return false;
  return task.events.some((event) => event.at >= turnSince && event.by.kind === 'lugar' && event.by.placeId === placeId && progressOf(event)?.estado !== 'turno-encerrado' && isProgressEvent(event));
}

/** How long ago, in a few words. */
export function agoText(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.round(hours / 24)} d`;
}

function cut(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** One record in one line: "estado; precisa: …; prova: …; próximo: …" (or the start of the turn). */
export function progressLineOf(progress: LedgerProgress): string {
  const parts: string[] = [progress.estado];
  if (progress.precisa) parts.push(`precisa: ${progress.precisa}`);
  if (progress.prova) parts.push(`prova: ${progress.prova}`);
  if (progress.proximo) parts.push(`próximo: ${progress.proximo}`);
  if (progress.resumo) parts.push(progress.resumo);
  return parts.join('; ');
}

function who(event: LedgerEvent): string {
  return event.by.kind === 'dono' ? 'o dono' : event.by.placeId;
}

/** What one event says, short. */
function eventLine(task: LedgerTask, event: LedgerEvent): string {
  const progress = progressOf(event);
  if (progress) return `andamento: ${progressLineOf(progress)}`;
  const note = eventNote(event);
  const tail = note ? `: ${cut(note, 160)}` : '';
  switch (event.kind) {
    case 'criada': {
      const transfer = transfersOf(task).find((each) => each.at === event.at);
      return transfer ? `passou de ${transfer.from} para ${transfer.to}${transfer.reason ? `: ${cut(transfer.reason, 160)}` : ''}` : `criada por ${who(event)}`;
    }
    case 'assumida':
      return 'assumida';
    case 'entregue':
      return `entregue para aceite${tail}`;
    case 'aceita':
      return `aceita por ${who(event)}${tail}`;
    case 'rejeitada':
      return `${viewState(task) === 'cancelada' && event === task.events.at(-1) ? 'cancelada' : 'rejeitada'} por ${who(event)}${tail}`;
    case 'comentada':
      return `${who(event)} escreveu na carta${tail}`;
    case 'conferida':
      return 'conferida pelo dono';
    case 'enviada':
      return `envio ao Slack${tail}`;
  }
}

export interface LedgerNewsGroup {
  readonly quadro: string;
  /** The place (session) whose work it is: the task's owner place. */
  readonly lugar: string;
  /** The latest record of that place, if any. */
  readonly agora?: string;
  readonly itens: readonly string[];
  /** Older items of this read left out (the full history in tarefa_ver). */
  readonly antes?: number;
}

export interface LedgerNews {
  readonly desde: number;
  readonly grupos: readonly LedgerNewsGroup[];
}

/** Items kept per place in one read: the latest ones. */
export const NEWS_ITEMS_PER_PLACE = 8;

/**
 * What changed in the ledger after `since`, grouped by session (the owner place of each task), latest place first.
 * `scope` = one board (project folder), or `null` for every board (the Líder único).
 */
export function ledgerNews(doc: LedgerDoc, scope: string | null, since: number, now: number): LedgerNews {
  const groups = new Map<string, { quadro: string; lugar: string; latest: number; items: { at: number; line: string }[]; agora?: string; agoraAt: number }>();
  for (const task of Object.values(doc.tasks)) {
    if (scope !== null && task.projectPath !== scope) continue;
    for (const event of task.events) {
      // The owner's order is read in tarefa_listar ("posicao"): moving one ask is no news of the session's work.
      if (event.at <= since || priorityMarkOf(task, event) !== undefined) continue;
      const key = `${task.projectPath}\n${task.ownerPlaceId}`;
      const group = groups.get(key) ?? { quadro: task.projectPath, lugar: task.ownerPlaceId, latest: 0, items: [], agoraAt: -1 };
      groups.set(key, group);
      group.latest = Math.max(group.latest, event.at);
      const label = `${task.id}${task.title ? ` «${cut(task.title, 60)}»` : ''}`;
      group.items.push({ at: event.at, line: `${agoText(event.at, now)} · ${label} · ${eventLine(task, event)}` });
      const progress = progressOf(event);
      if (progress && event.at > group.agoraAt) {
        group.agora = progressLineOf(progress);
        group.agoraAt = event.at;
      }
    }
  }
  const grupos = [...groups.values()]
    .sort((a, b) => b.latest - a.latest)
    .map((group) => {
      const items = group.items.sort((a, b) => a.at - b.at);
      const kept = items.slice(-NEWS_ITEMS_PER_PLACE);
      return {
        quadro: group.quadro,
        lugar: group.lugar,
        ...(group.agora ? { agora: group.agora } : {}),
        itens: kept.map((item) => item.line),
        ...(items.length > kept.length ? { antes: items.length - kept.length } : {}),
      };
    });
  return { desde: since, grupos };
}
