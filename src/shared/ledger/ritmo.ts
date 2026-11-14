// Ritmo do Oráculo (t-23f0297d, dono 13/11: "não ver ele crescendo num ritmo constante. Dá a entender que você
// esquece de levar as demandas pra lá") — what counts as a launch in the ledger, its rhythm per hour, and the notice
// to the Líder único when the ledger goes quiet while sessions work. Pure: the clock and the working sessions come in.
//
// A launch is work someone wrote down: a task born, a progress record, a delivery, a decision, a task passed on, a
// task taken, the owner's words on a card, a Slack send. NOT a launch: the app's own end-of-turn record (it writes
// itself, so it would hide the silence) and the bookkeeping marks on a task (its front, the owner's priority).

import { progressOf } from './andamento';
import type { LedgerDoc, LedgerEvent } from './contract';

export type LaunchKind = 'criada' | 'andamento' | 'entrega' | 'decisao' | 'outro';
export const LAUNCH_KINDS: readonly LaunchKind[] = ['criada', 'andamento', 'entrega', 'decisao', 'outro'];

/** Quiet this long, with a session working: the Líder único hears it. */
export const SILENCE_ALERT_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** What an event is as a launch; `null` = not a launch. `index` is its place in the task's events (0 = the birth). */
export function launchKindOf(event: LedgerEvent, index: number): LaunchKind | null {
  switch (event.kind) {
    case 'criada':
      if (index === 0) return 'criada';
      // A later `criada` is a mark: a transfer is work passed on; a front, an "asked by" or a priority is bookkeeping.
      return (event.text ?? '').startsWith('⟦transferida') ? 'outro' : null;
    case 'comentada': {
      const progress = progressOf(event);
      if (progress) return progress.estado === 'turno-encerrado' ? null : 'andamento';
      return 'outro';
    }
    case 'entregue':
      return 'entrega';
    case 'aceita':
    case 'rejeitada':
    case 'conferida':
      return 'decisao';
    default:
      return 'outro';
  }
}

export interface Launch {
  readonly at: number;
  readonly kind: LaunchKind;
  readonly taskId: string;
}

/** Every launch at or after `since`, oldest first. */
export function launchesSince(doc: LedgerDoc, since: number): Launch[] {
  const out: Launch[] = [];
  for (const task of Object.values(doc.tasks)) {
    task.events.forEach((event, index) => {
      if (event.at < since) return;
      const kind = launchKindOf(event, index);
      if (kind) out.push({ at: event.at, kind, taskId: task.id });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The newest launch (ms), or `null` when the ledger has none. */
export function lastLaunchAt(doc: LedgerDoc): number | null {
  let last: number | null = null;
  for (const task of Object.values(doc.tasks)) {
    task.events.forEach((event, index) => {
      if ((last === null || event.at > last) && launchKindOf(event, index)) last = event.at;
    });
  }
  return last;
}

export interface RhythmHour {
  /** Start of the hour (ms). */
  readonly start: number;
  readonly counts: Readonly<Record<LaunchKind, number>>;
  readonly total: number;
}

function zero(): Record<LaunchKind, number> {
  return { criada: 0, andamento: 0, entrega: 0, decisao: 0, outro: 0 };
}

/** The last `hours` whole hours up to the one of `now` (local clock), oldest first, with the launches of each. */
export function hourlyRhythm(doc: LedgerDoc, now: number, hours: number): RhythmHour[] {
  const current = new Date(now);
  current.setMinutes(0, 0, 0);
  const first = current.getTime() - (hours - 1) * HOUR_MS;
  const buckets = Array.from({ length: hours }, (_, i) => ({ start: first + i * HOUR_MS, counts: zero() }));
  for (const launch of launchesSince(doc, first)) {
    const bucket = buckets[Math.floor((launch.at - first) / HOUR_MS)];
    if (bucket) bucket.counts[launch.kind] += 1;
  }
  return buckets.map((bucket) => ({ ...bucket, total: LAUNCH_KINDS.reduce((sum, kind) => sum + bucket.counts[kind], 0) }));
}

export interface SilenceInput {
  readonly lastLaunchAt: number | null;
  /** Sessions of this app in "trabalhando" now. */
  readonly working: number;
  readonly now: number;
  /** The `lastLaunchAt` the Líder único already heard about (one notice per silence). */
  readonly alertedFor: number | null;
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m ? ` ${String(m).padStart(2, '0')} min` : ''}` : `${m} min`;
}

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * The notice to the Líder único, or `null`: only past `SILENCE_ALERT_MS` without a launch, with at least one session
 * working, and once per silence (a new launch starts another). An empty ledger has nothing to be late on.
 */
export function silenceNotice(input: SilenceInput): string | null {
  const { lastLaunchAt: last, working, now, alertedFor } = input;
  if (last === null || working <= 0 || now - last < SILENCE_ALERT_MS || alertedFor === last) return null;
  const sessions = working === 1 ? '1 sessão trabalhando' : `${working} sessões trabalhando`;
  return `◆ Oráculo parado: ${duration(now - last)} sem lançamento novo (o último foi às ${clock(last)}), com ${sessions}. Leve ao Oráculo o que está em curso: tarefa nova com tarefa_criar e andamento com tarefa_andamento.`;
}
