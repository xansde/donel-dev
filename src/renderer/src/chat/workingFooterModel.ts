// T068 (014-chat) - what the live footer ("pé de trabalho", G2) says. Pure: the component only draws.

import { toGerund } from '../../../shared/chat/gerund';
import type { ConversationRow, LiveAction, LiveState } from '../../../shared/chat/rows';

export interface FooterAction {
  readonly verb: string;
  readonly target?: string;
}

export type FooterModel =
  | {
      readonly kind: 'working';
      /** Gerund ("Lendo"); absent when the hooks gave no current action. */
      readonly verb?: string;
      readonly target?: string;
      /** > 0 only when no action is running and subagents remain: "Aguardando N subagentes" (D-C18). */
      readonly waitingSubagents: number;
      /** Set while a pending is open: the round is held on the owner ("esperando você — <what>"). */
      readonly waitingFor?: 'question' | 'permission' | 'plan';
      /** When the current action started (ISO): the footer shows how long THIS tool has been running. */
      readonly actionStartedAt?: string;
      /** Subagents still running next to the current action ("+ N subagentes"). */
      readonly alsoSubagents?: number;
      /** No tool and no subagent running: the Claude is thinking or writing ("pensando"). */
      readonly thinking?: true;
    }
  | { readonly kind: 'interrupted'; readonly after: FooterAction | null };

export interface FooterInput {
  readonly live: LiveState | null;
  readonly rows: readonly ConversationRow[];
  /** The last action the footer saw while working (the "parou depois de" part of "Interrompido"). */
  readonly lastAction: LiveAction | null;
  /**
   * The screen shows "esc to interrupt" (`null` = unknown). The CLI fires no Stop hook on a user interrupt, so
   * `status` can stay `working`: the marker in the transcript plus a screen that stopped working is the proof.
   */
  readonly screenWorking?: boolean | null;
  /** The screen proved the round over after a Parar/Esc (`stopWindow.ts`): no Stop hook will come. */
  readonly endedByScreen?: boolean;
}

/** The interruption is the latest event of the conversation: no `user` row after the `[Request interrupted...]` notice. */
function endsInterrupted(rows: readonly ConversationRow[]): boolean {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.kind === 'user') return false;
    if (row.kind === 'notice' && row.notice === 'interrupted') return true;
  }
  return false;
}

const toFooterAction = (action: LiveAction): FooterAction => ({
  verb: action.summary.verb,
  ...(action.summary.target !== undefined ? { target: action.summary.target } : {}),
});

export function deriveFooter({ live, rows, lastAction, screenWorking = null, endedByScreen = false }: FooterInput): FooterModel | null {
  if (live === null) return null;
  const interruptedNow = screenWorking !== true && endsInterrupted(rows);
  if (interruptedNow && (live.status === 'working' || live.status === 'idle')) {
    return { kind: 'interrupted', after: lastAction === null ? null : toFooterAction(lastAction) };
  }
  if (live.status === 'working' && endedByScreen) return null;
  if (live.status === 'working') {
    const action = live.currentAction;
    if (action !== null) {
      const { verb, target } = action.summary;
      const subagents = live.activeSubagents.length;
      return {
        kind: 'working',
        verb: toGerund(verb),
        ...(target !== undefined ? { target } : {}),
        waitingSubagents: 0,
        actionStartedAt: action.startedAt,
        ...(subagents > 0 ? { alsoSubagents: subagents } : {}),
      };
    }
    if (live.activeSubagents.length > 0) return { kind: 'working', waitingSubagents: live.activeSubagents.length };
    return { kind: 'working', waitingSubagents: 0, thinking: true };
  }
  // A pending is open (the status turned to waiting-for-you): the round is held, not over, and Parar must stay
  // reachable - it answers the pending with `interrupt` (T078/T081).
  const pending = live.pendings[0];
  if (pending !== undefined) return { kind: 'working', waitingSubagents: 0, waitingFor: pending.kind };
  return null;
}

/** What the footer says while a pending is open; same wording as the "Esperando você" label on the tab. */
export const WAITING_FOR_LABEL: Record<'question' | 'permission' | 'plan', string> = {
  question: 'pergunta',
  permission: 'permissão',
  plan: 'plano',
};

/** m:ss, minutes unbounded. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** How long the footer says "parando…" before admitting the Claude did not stop. */
export const STOP_TIMEOUT_MS = 5000;

export type StopFeedback = 'none' | 'stopping' | 'stuck';

/**
 * What Parar / Esc shows while the round still runs: nothing before a request, "parando…" (button off) until the
 * round ends or the timeout, then `stuck` (button back + a discreet "o Claude não parou" hint). A request is the
 * `Date.now()` of the press; one that wrote nothing is stored already expired (`expiredStopRequest`).
 */
export function stopFeedback(requestedAt: number | null, now: number): StopFeedback {
  if (requestedAt === null) return 'none';
  return now - requestedAt < STOP_TIMEOUT_MS ? 'stopping' : 'stuck';
}

/** A press that reached nothing (the screen did not show "esc to interrupt"): no point waiting 5 s to say so. */
export const expiredStopRequest = (now: number): number => now - STOP_TIMEOUT_MS;

export const STOP_STUCK_HINT = 'o Claude não parou — tente de novo ou abra o terminal';

/** A press that wrote nothing is stored already expired. */
export const isExpiredStop = (requestedAt: number, now: number): boolean => now - requestedAt >= STOP_TIMEOUT_MS;
