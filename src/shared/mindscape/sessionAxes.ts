// Item 04 — cartão rico (docs/refinamentos/mindscape-cartao-rico.md). The state of a session card in
// THREE axes that never mix, plus "precisa de você" as a count with its reasons (never a state):
//   processo       aberta · sem ligação · fechada
//   atividade      trabalhando · parada · desconhecido
//   retomabilidade viva · retomável · sem retomada · desconhecido
// "Desconhecido" is honest: the app says it does not know instead of guessing (the `working` a session
// is born with, before any hook, is a guess; a closed session whose folder was not read yet, too).
// Pure: no React, no Electron.

import type { SemaphoreState } from '../index';

/** `sem ligação`: the process lives (a remote tmux) but the app lost its link to it; the app is relinking. */
export type ProcessAxis = 'aberta' | 'sem ligação' | 'fechada';
export type ActivityAxis = 'trabalhando' | 'parada' | 'desconhecido';
export type ResumeAxis = 'viva' | 'retomável' | 'sem retomada' | 'desconhecido';
export type NeedReason = 'permissão' | 'pergunta' | 'plano' | 'limite de uso' | 'erro';

export interface SessionAxesInput {
  /** The tab of the session is open (the card is live, not dormant). */
  readonly tabOpen: boolean;
  /** The semaphore of the tab; absent = no reading. `done`/`error` = the process left. */
  readonly state?: SemaphoreState;
  /** No hook heard yet (the `working` of the birth is a guess). */
  readonly unconfirmed?: boolean;
  /** Kinds of the open pendings of the chat (`question`, `permission`, `plan`). */
  readonly pendingKinds?: readonly string[];
  /** `StopFailure` code of the last turn (`rate_limit`…). */
  readonly turnFailure?: string;
  /** For a session whose process is gone: its conversation is in the project folder. `undefined` = not read. */
  readonly transcriptFound?: boolean;
  /**
   * Epoch ms of the last hook heard from the session, and the time of the reading. With both, a `working` that has
   * heard nothing for longer than `STALE_SIGNAL_MS` and has no call running reads "desconhecido": the `Stop` may
   * have been lost, and an old sample no longer decides (idea from OpenRig 80e568e9).
   */
  readonly lastEventAt?: number;
  readonly now?: number;
  /** Tool calls still running (any origin); a long build keeps the session "trabalhando". Absent = none. */
  readonly openCalls?: number;
  /**
   * The semaphore already read the signal as old (`SemaphoreUpdate.signalStale`): the same rule, judged by the main
   * process on its own clock, for a reader that only hears updates (the card of the board).
   */
  readonly signalStale?: boolean;
  /** Remote session whose ssh dropped while its process lives on the place (main/remote-link.ts). */
  readonly linkLost?: boolean;
}

export interface SessionAxes {
  readonly process: ProcessAxis;
  readonly activity: ActivityAxis;
  readonly resume: ResumeAxis;
  /** "Precisa de você": the reasons, in a stable order; `needs.length` is the count. */
  readonly needs: readonly NeedReason[];
}

/** A `working` with no hook for longer than this (and no call running) is no longer trusted. */
export const STALE_SIGNAL_MS = 30 * 60_000;

export function signalIsStale(input: Pick<SessionAxesInput, 'lastEventAt' | 'now' | 'openCalls'>): boolean {
  if (input.lastEventAt === undefined || input.now === undefined) return false;
  return (input.openCalls ?? 0) === 0 && input.now - input.lastEventAt > STALE_SIGNAL_MS;
}

const REASON_ORDER: readonly NeedReason[] = ['permissão', 'pergunta', 'plano', 'limite de uso', 'erro'];

const PENDING_REASON: Readonly<Record<string, NeedReason>> = { permission: 'permissão', question: 'pergunta', plan: 'plano' };

export function deriveSessionAxes(input: SessionAxesInput): SessionAxes {
  const exited = input.state === 'done' || input.state === 'error';
  const process: ProcessAxis = !input.tabOpen || exited ? 'fechada' : input.linkLost ? 'sem ligação' : 'aberta';

  let activity: ActivityAxis;
  if (process === 'fechada') activity = 'parada';
  else if (process === 'sem ligação' || input.state === undefined) activity = 'desconhecido'; // no hook can come through
  else if (input.state === 'working') activity = input.unconfirmed || input.signalStale || signalIsStale(input) ? 'desconhecido' : 'trabalhando';
  else activity = 'parada';

  const resume: ResumeAxis =
    process !== 'fechada' ? 'viva' : input.transcriptFound === undefined ? 'desconhecido' : input.transcriptFound ? 'retomável' : 'sem retomada';

  const reasons = new Set<NeedReason>();
  if (process === 'aberta' && input.state === 'permission') {
    const kinds = (input.pendingKinds ?? []).map((kind) => PENDING_REASON[kind]).filter((reason): reason is NeedReason => reason !== undefined);
    if (kinds.length === 0) reasons.add('permissão');
    for (const reason of kinds) reasons.add(reason);
  }
  if (input.turnFailure && input.state !== 'working') reasons.add(input.turnFailure === 'rate_limit' ? 'limite de uso' : 'erro');
  if (input.state === 'error') reasons.add('erro');
  const needs = REASON_ORDER.filter((reason) => reasons.has(reason));

  return { process, activity, resume, needs };
}

/** "Parada com pendência" (Organizar): stopped, with something open that only the owner can close. */
export function isStalledWithNeed(axes: SessionAxes): boolean {
  return axes.activity === 'parada' && axes.needs.length > 0;
}

/** The line of the axes on the card: "aberta · trabalhando · viva". */
export function axesLabel(axes: SessionAxes): string {
  return `${axes.process} · ${axes.activity} · ${axes.resume}`;
}

/** The "precisa de você" seal: "! 2 · pergunta, erro"; `null` when nothing needs the owner. */
export function needsLabel(needs: readonly NeedReason[]): string | null {
  return needs.length === 0 ? null : `! ${needs.length} · ${needs.join(', ')}`;
}
