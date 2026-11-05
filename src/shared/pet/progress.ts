// Painel de progresso do Jobu (owner's ask, 05/11) — what each front of work has done and when it should end, from the
// ledger (`src/shared/ledger/`). Pure: the clock comes in, nothing is read or written. The screen is
// `src/renderer/src/pet/JobuProgress.tsx`.
//
// The estimate is honest and simple, and every line says where it came from:
// - the bar is the lifecycle of a task in the ledger, in 3 steps: assumed, delivered, accepted. Nothing else is counted,
//   so no percentage exists that the ledger cannot back. A rejected task goes back to 1 of 3 (it has to be redone);
// - the end date of a task nobody took is its deadline (`due`); of a task under way, the pace of the steps it already
//   walked (time since it was created ÷ steps done) times the steps left; of an accepted one, the moment it was accepted.
//   It says when that pace ends after the deadline;
// - a board is the sum of its tasks: its bar counts every step of every task, its end is the latest end of a task left.

import { lastDecision, type LedgerDoc, type LedgerTask, type LedgerTaskState } from '../ledger/contract';

/** Assumed, delivered, accepted. */
export const PROGRESS_STEPS = 3;
/** An accepted task stays on the panel for a day, so a finished front is seen as finished before it goes. */
export const PROGRESS_DONE_KEEP_MS = 24 * 60 * 60 * 1000;

export interface ProgressTask {
  readonly id: string;
  readonly title: string;
  readonly state: LedgerTaskState;
  /** Steps done, 0..PROGRESS_STEPS. */
  readonly steps: number;
  /** What the step means, in words: `entregue, esperando decisão`. */
  readonly stepLabel: string;
  /** The estimated end (ms); for an accepted task, when it was accepted. */
  readonly endsAt: number;
  /** The estimate ends after the deadline (or the deadline has passed and it is not done). */
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
  /** The latest end of a task left; when every task is done, the latest accept. */
  readonly endsAt: number;
  readonly late: boolean;
  readonly done: number;
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

function stepsOf(state: LedgerTaskState): number {
  switch (state) {
    case 'aberta':
      return 0;
    case 'em-execucao':
    case 'rejeitada':
      return 1;
    case 'entregue':
      return 2;
    case 'aceita':
      return 3;
  }
}

const STEP_LABEL: Readonly<Record<LedgerTaskState, string>> = {
  aberta: 'aberta, ninguém assumiu',
  'em-execucao': 'em execução',
  rejeitada: 'rejeitada, volta para refazer',
  entregue: 'entregue, esperando decisão',
  aceita: 'aceita',
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
export function taskProgress(task: LedgerTask, now: number): ProgressTask {
  const steps = stepsOf(task.state);
  const dueAt = dueEndsAt(task.due);
  const deliveries = task.events.filter((event) => event.kind === 'entregue').length;
  const changedAt = task.events.reduce((latest, event) => Math.max(latest, event.at), task.createdAt);
  const base = { id: task.id, title: task.request, state: task.state, steps, stepLabel: STEP_LABEL[task.state], places: placesOf(task), deliveries, changedAt };

  if (task.state === 'aceita') {
    const at = lastDecision(task)?.at ?? changedAt;
    return { ...base, endsAt: at, late: at > dueAt, source: `concluída; prazo era ${dayLabel(dueAt)}` };
  }
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

/** Shown: every task not accepted yet, and the accepted ones for a day after the accept. */
function shown(task: LedgerTask, now: number): boolean {
  if (task.state !== 'aceita') return true;
  const at = lastDecision(task)?.at ?? task.createdAt;
  return now - at < PROGRESS_DONE_KEEP_MS;
}

/** The panel at `now`: one board per front, its tasks under it (the ones left first, the nearest end first). */
export function jobuProgress(doc: LedgerDoc, now: number): JobuProgress {
  const byBoard = new Map<string, ProgressTask[]>();
  for (const task of Object.values(doc.tasks)) {
    if (!shown(task, now)) continue;
    const list = byBoard.get(task.projectPath) ?? [];
    list.push(taskProgress(task, now));
    byBoard.set(task.projectPath, list);
  }
  const boards: ProgressBoard[] = [...byBoard].map(([projectPath, tasks]) => {
    tasks.sort((a, b) => Number(a.state === 'aceita') - Number(b.state === 'aceita') || a.endsAt - b.endsAt || a.id.localeCompare(b.id));
    const left = tasks.filter((task) => task.state !== 'aceita');
    const ends = (left.length ? left : tasks).map((task) => task.endsAt);
    return {
      projectPath,
      title: boardTitle(projectPath),
      steps: tasks.reduce((sum, task) => sum + task.steps, 0),
      totalSteps: tasks.length * PROGRESS_STEPS,
      endsAt: Math.max(...ends),
      late: left.some((task) => task.late),
      done: tasks.length - left.length,
      tasks,
      changedAt: Math.max(...tasks.map((task) => task.changedAt)),
    };
  });
  boards.sort((a, b) => b.changedAt - a.changedAt || a.projectPath.localeCompare(b.projectPath));
  return { boards, changedAt: boards.length ? Math.max(...boards.map((board) => board.changedAt)) : null };
}
