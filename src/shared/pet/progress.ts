// Painel de progresso do Jobu (owner's ask, 05/11) — what each front of work has done and when it should end, from the
// ledger (`src/shared/ledger/`). Pure: the clock comes in, nothing is read or written. The screen is
// `src/renderer/src/pet/JobuProgress.tsx`.
//
// The estimate is honest and simple, and every line says where it came from:
// - only what is going on now is shown (owner, 05/11): an accepted task leaves the panel at once, and every sum;
// - the bar is the lifecycle of a task in the ledger, in 3 steps: assumed, delivered, accepted. Nothing else is counted,
//   so no percentage exists that the ledger cannot back. A rejected task goes back to 1 of 3 (it has to be redone);
// - the end date of a task nobody took is its deadline (`due`); of a task under way, the pace of the steps it already
//   walked (time since it was created ÷ steps done) times the steps left. It says when that pace ends after the deadline;
// - a board is the sum of its tasks: its bar counts every step of every task, its end is the latest end of a task.

import { type LedgerDoc, type LedgerTask, type LedgerTaskState } from '../ledger/contract';

/** Assumed, delivered, accepted. */
export const PROGRESS_STEPS = 3;

/** The states the panel shows: everything but `aceita`. */
export type ProgressTaskState = Exclude<LedgerTaskState, 'aceita'>;
type ActiveTask = LedgerTask & { readonly state: ProgressTaskState };

export interface ProgressTask {
  readonly id: string;
  readonly title: string;
  readonly state: ProgressTaskState;
  /** Steps done, 0..2 (the third, the accept, takes the task off the panel). */
  readonly steps: number;
  /** What the step means, in words: `entregue, esperando decisão`. */
  readonly stepLabel: string;
  /** The estimated end (ms). */
  readonly endsAt: number;
  /** The estimate ends after the deadline (or the deadline has passed). */
  readonly late: boolean;
  /** Where the estimate came from, said to the owner. */
  readonly source: string;
  /** The sessions (roles of the places) that acted on the task, in order: `lider · dev · revisor`. */
  readonly places: readonly string[];
  /** Deliveries made so far (a second one is a rework). */
  readonly deliveries: number;
  /** The newest event of the task (ms). */
  readonly changedAt: number;
}

export interface ProgressBoard {
  readonly projectPath: string;
  readonly title: string;
  readonly steps: number;
  readonly totalSteps: number;
  /** The latest end of a task. */
  readonly endsAt: number;
  readonly late: boolean;
  readonly tasks: readonly ProgressTask[];
  readonly changedAt: number;
}

export interface JobuProgress {
  readonly boards: readonly ProgressBoard[];
  /** The newest event of any task shown (ms); `null` = nothing to show. Drives the "something changed" dot. */
  readonly changedAt: number | null;
}

/** The end of the deadline day, local time (the owner reads `06/11` as the whole of that day). */
export function dueEndsAt(due: string): number {
  const [year, month, day] = due.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function stepsOf(state: ProgressTaskState): number {
  switch (state) {
    case 'aberta':
      return 0;
    case 'em-execucao':
    case 'rejeitada':
      return 1;
    case 'entregue':
      return 2;
  }
}

const STEP_LABEL: Readonly<Record<ProgressTaskState, string>> = {
  aberta: 'aberta, ninguém assumiu',
  'em-execucao': 'em execução',
  rejeitada: 'rejeitada, volta para refazer',
  entregue: 'entregue, esperando decisão',
};

/** `40 min`, `3 h`, `2 d`. */
export function durationLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function dayLabel(at: number): string {
  const date = new Date(at);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `hoje 18:40`, `amanhã 09:10`, `07/11` — the date of an estimate, as near as it is worth saying. */
export function endLabel(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const dayIndex = (d: Date): number => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  const diff = dayIndex(date) - dayIndex(today);
  if (diff === 0) return `hoje ${time}`;
  if (diff === 1) return `amanhã ${time}`;
  if (diff === -1) return `ontem ${time}`;
  return dayLabel(at);
}

function placesOf(task: LedgerTask): string[] {
  const places: string[] = [];
  for (const event of task.events) {
    if (event.by.kind !== 'lugar') continue;
    const name = event.by.roleId ?? 'lugar';
    if (places[places.length - 1] !== name) places.push(name);
  }
  return places;
}

function boardTitle(projectPath: string): string {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop();
  return name ?? 'sem quadro';
}

/** The progress of one task at `now`. */
function taskProgress(task: ActiveTask, now: number): ProgressTask {
  const steps = stepsOf(task.state);
  const dueAt = dueEndsAt(task.due);
  const deliveries = task.events.filter((event) => event.kind === 'entregue').length;
  const changedAt = task.events.reduce((latest, event) => Math.max(latest, event.at), task.createdAt);
  const base = { id: task.id, title: task.request, state: task.state, steps, stepLabel: STEP_LABEL[task.state], places: placesOf(task), deliveries, changedAt };

  if (steps === 0) {
    const overdue = now > dueAt;
    return { ...base, endsAt: dueAt, late: overdue, source: overdue ? 'pelo prazo, que já venceu; ninguém assumiu' : 'pelo prazo; ninguém assumiu ainda' };
  }
  const elapsed = Math.max(0, now - task.createdAt);
  const endsAt = now + (elapsed / steps) * (PROGRESS_STEPS - steps);
  const rework = deliveries > 1 ? ` · ${deliveries}ª entrega` : task.state === 'rejeitada' || (task.state === 'em-execucao' && deliveries > 0) ? ' · refazendo' : '';
  const versusDue = now > dueAt ? `prazo ${dayLabel(dueAt)} já venceu` : endsAt > dueAt ? `passa do prazo ${dayLabel(dueAt)}` : `prazo ${dayLabel(dueAt)}`;
  return {
    ...base,
    endsAt,
    late: endsAt > dueAt,
    source: `pelo ritmo: ${steps} de ${PROGRESS_STEPS} etapas em ${durationLabel(elapsed)}${rework}; ${versusDue}`,
  };
}

function isActive(task: LedgerTask): task is ActiveTask {
  return task.state !== 'aceita';
}

/** The panel at `now`: one board per front with a task going on, its tasks under it (the nearest end first). */
export function jobuProgress(doc: LedgerDoc, now: number): JobuProgress {
  const byBoard = new Map<string, ProgressTask[]>();
  for (const task of Object.values(doc.tasks)) {
    if (!isActive(task)) continue;
    const list = byBoard.get(task.projectPath) ?? [];
    list.push(taskProgress(task, now));
    byBoard.set(task.projectPath, list);
  }
  const boards: ProgressBoard[] = [...byBoard].map(([projectPath, tasks]) => {
    tasks.sort((a, b) => a.endsAt - b.endsAt || a.id.localeCompare(b.id));
    return {
      projectPath,
      title: boardTitle(projectPath),
      steps: tasks.reduce((sum, task) => sum + task.steps, 0),
      totalSteps: tasks.length * PROGRESS_STEPS,
      endsAt: Math.max(...tasks.map((task) => task.endsAt)),
      late: tasks.some((task) => task.late),
      tasks,
      changedAt: Math.max(...tasks.map((task) => task.changedAt)),
    };
  });
  boards.sort((a, b) => b.changedAt - a.changedAt || a.projectPath.localeCompare(b.projectPath));
  return { boards, changedAt: boards.length ? Math.max(...boards.map((board) => board.changedAt)) : null };
}
