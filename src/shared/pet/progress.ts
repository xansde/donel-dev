// Painel de progresso do Jobu — the owner's asks, by front of work (owner, 07/11: "Não consigo saber quais demandas
// que eu solicitei você está tocando ou não. [...] Essas coisas deveriam ser compiladas por frentes"). Pure: the
// clock comes in, nothing is read or written. The screen is `src/renderer/src/pet/JobuProgress.tsx`.
//
// - only the asks of the owner (`quem pediu` = dono, or a task the owner made himself); Slack letters, signals and
//   asks of other people stay out;
// - grouped by the front the Líder named (`frenteOf`); a task with none goes to "Sem frente", always last;
// - four states, each with who has it: esperando você (a high-risk delivery: his card), travado (rejected, nobody
//   took it again), tocando (under way, or delivered and waiting for the Revisor), parado (nobody took it, nobody
//   said a word for a day, or delivered and nobody checked for 12 h);
// - what ended leaves the list: an accepted task only counts in "concluídas hoje", a cancelled one vanishes, and a
//   front with nothing alive leaves too;
// - the bar of a front counts the steps of its asks alive and accepted today, 3 each: assumed, delivered, accepted.

import { ASKED_BY_OWNER, frenteOf, isCancelled, lastDelivery, lastWorkAt, requestedByOf, type LedgerDoc, type LedgerTask } from '../ledger/contract';
import { LEADER_OF_ALL } from '../mindscape/leader';

/** Assumed, delivered, accepted. */
export const PROGRESS_STEPS = 3;
/** Under way with no event for this long: "sem notícia", not "tocando". */
export const SILENT_MS = 24 * 60 * 60 * 1000;
/** Delivered (low risk) and nobody decided for this long: "parado". */
export const UNCHECKED_MS = 12 * 60 * 60 * 1000;

export type FrontTaskState = 'esperando' | 'travado' | 'tocando' | 'parado';
const STATE_ORDER: Readonly<Record<FrontTaskState, number>> = { esperando: 0, travado: 1, tocando: 2, parado: 3 };

export interface FrontTask {
  readonly id: string;
  /** The task's title, or the first sentence of the request. */
  readonly title: string;
  readonly state: FrontTaskState;
  /** Who has it, in words: "Dev", "você decide na carta", "ninguém assumiu". */
  readonly who: string;
  /** `AAAA-MM-DD`. */
  readonly due: string;
  /** The deadline day is over. */
  readonly late: boolean;
  /** The newest event of the task (ms). */
  readonly changedAt: number;
}

export interface Front {
  /** The front's name; `''` = "Sem frente". */
  readonly name: string;
  /** The asks alive, what needs the owner first. */
  readonly tasks: readonly FrontTask[];
  readonly counts: Readonly<Record<FrontTaskState, number>>;
  /** Asks of this front accepted today. */
  readonly doneToday: number;
  readonly steps: number;
  readonly totalSteps: number;
  readonly changedAt: number;
}

export interface DoneTask {
  readonly id: string;
  readonly title: string;
  readonly front: string;
}

export interface JobuProgress {
  readonly fronts: readonly Front[];
  readonly counts: Readonly<Record<FrontTaskState, number>>;
  /** The owner's asks accepted today (local day of `now`). */
  readonly doneToday: readonly DoneTask[];
  /** The newest event of anything shown (ms); `null` = nothing to show. Drives the "something changed" dot. */
  readonly changedAt: number | null;
}

/** The end of the deadline day, local time (the owner reads `06/11` as the whole of that day). */
export function dueEndsAt(due: string): number {
  const [year, month, day] = due.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/** `hoje`, `amanhã`, `ontem`, `09/11`. */
export function dueLabel(due: string, now: number): string {
  const [year, month, day] = due.split('-').map(Number) as [number, number, number];
  const today = new Date(now);
  const diff = Math.round((new Date(year, month - 1, day).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

/** The owner asked for it: he said so (`quemPediu`), or he made the task himself. */
function askedByOwner(task: LedgerTask): boolean {
  const said = requestedByOf(task);
  return said ? said === ASKED_BY_OWNER : task.events[0]?.by.kind === 'dono';
}

/** A short name: the title, else the first sentence of the request (up to 60 characters). */
function shortTitle(task: LedgerTask): string {
  if (task.title) return task.title;
  const line = task.request.trim().replace(/^["“]/, '').split('\n')[0]!;
  const sentence = /^(.{8,60}?[?.!])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.length > 60 ? `${sentence.slice(0, 59)}…` : sentence;
}

const ROLE_NAMES: Readonly<Record<string, string>> = { dev: 'Dev', revisor: 'Revisor', pesquisa: 'Pesquisa', curador: 'Curador', lider: 'Líder' };

/** The role of the owner place, from what it did in the task. */
function ownerRole(task: LedgerTask): string {
  const roleId = task.events.find((event) => event.by.kind === 'lugar' && event.by.placeId === task.ownerPlaceId && event.by.roleId)?.by;
  const role = roleId?.kind === 'lugar' ? roleId.roleId?.split('-')[0] : undefined;
  return (role && ROLE_NAMES[role]) ?? 'quem assumiu';
}

function ago(ms: number, unit: 'h' | 'd'): string {
  return unit === 'h' ? `${Math.max(1, Math.round(ms / 3_600_000))} h` : `${Math.max(1, Math.floor(ms / 86_400_000))} d`;
}

function stepsOf(task: LedgerTask): number {
  switch (task.state) {
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

/** The state the owner reads, and who has the task. */
function stateOf(task: LedgerTask, changedAt: number, now: number): { state: FrontTaskState; who: string } {
  if (task.state === 'entregue') {
    if (task.risk === 'alto') return { state: 'esperando', who: 'você decide na carta' };
    const quiet = now - (lastDelivery(task)?.at ?? changedAt);
    return quiet >= UNCHECKED_MS ? { state: 'parado', who: `entregue há ${ago(quiet, 'h')}; ninguém conferiu` } : { state: 'tocando', who: 'entregue; o Revisor confere' };
  }
  if (task.state === 'rejeitada') return { state: 'travado', who: 'voltou da revisão; ninguém retomou' };
  if (task.ownerPlaceId === LEADER_OF_ALL) return { state: 'parado', who: 'com o Líder; ninguém assumiu' };
  if (task.state === 'aberta') return { state: 'parado', who: 'ninguém assumiu' };
  const quiet = now - changedAt;
  return quiet >= SILENT_MS ? { state: 'parado', who: `${ownerRole(task)}, sem notícia há ${ago(quiet, 'd')}` } : { state: 'tocando', who: ownerRole(task) };
}

function startOfDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const zeroCounts = (): Record<FrontTaskState, number> => ({ esperando: 0, travado: 0, tocando: 0, parado: 0 });

/** The panel at `now`. */
export function jobuProgress(doc: LedgerDoc, now: number): JobuProgress {
  const today = startOfDay(now);
  const byFront = new Map<string, { tasks: FrontTask[]; done: LedgerTask[] }>();
  const doneToday: DoneTask[] = [];
  const counts = zeroCounts();
  let changed: number | null = null;

  for (const task of Object.values(doc.tasks)) {
    if (task.slack || isCancelled(task) || !askedByOwner(task)) continue;
    const front = frenteOf(task) ?? '';
    // A front mark is no work: a silent task stays silent after the Líder names its front.
    const changedAt = lastWorkAt(task);
    const group = byFront.get(front) ?? { tasks: [], done: [] };
    if (task.state === 'aceita') {
      if (changedAt < today) continue;
      group.done.push(task);
      doneToday.push({ id: task.id, title: shortTitle(task), front });
    } else {
      const { state, who } = stateOf(task, changedAt, now);
      group.tasks.push({ id: task.id, title: shortTitle(task), state, who, due: task.due, late: now > dueEndsAt(task.due), changedAt });
      counts[state] += 1;
    }
    byFront.set(front, group);
    changed = Math.max(changed ?? 0, changedAt);
  }

  const fronts: Front[] = [...byFront]
    .filter(([, group]) => group.tasks.length > 0)
    .map(([name, group]) => {
      const tasks = [...group.tasks].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
      const frontCounts = zeroCounts();
      for (const task of tasks) frontCounts[task.state] += 1;
      const alive = tasks.map((task) => doc.tasks[task.id]!);
      return {
        name,
        tasks,
        counts: frontCounts,
        doneToday: group.done.length,
        steps: [...alive, ...group.done].reduce((sum, task) => sum + stepsOf(task), 0),
        totalSteps: (alive.length + group.done.length) * PROGRESS_STEPS,
        changedAt: Math.max(...tasks.map((task) => task.changedAt)),
      };
    });
  // What needs the owner first, then the newest; "Sem frente" always last.
  fronts.sort(
    (a, b) =>
      Number(a.name === '') - Number(b.name === '') ||
      Number(b.counts.esperando > 0) - Number(a.counts.esperando > 0) ||
      Number(b.counts.travado > 0) - Number(a.counts.travado > 0) ||
      b.changedAt - a.changedAt ||
      a.name.localeCompare(b.name),
  );
  return { fronts, counts, doneToday, changedAt: changed };
}
