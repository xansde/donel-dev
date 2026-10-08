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

export function deriveFooter({ live, rows, lastAction, screenWorking = null }: FooterInput): FooterModel | null {
  if (live === null) return null;
  const interruptedNow = screenWorking !== true && endsInterrupted(rows);
  if (interruptedNow && (live.status === 'working' || live.status === 'idle')) {
    return { kind: 'interrupted', after: lastAction === null ? null : toFooterAction(lastAction) };
  }
  if (live.status === 'working') {
    const action = live.currentAction;
    if (action !== null) {
      const { verb, target } = action.summary;
      return { kind: 'working', verb: toGerund(verb), ...(target !== undefined ? { target } : {}), waitingSubagents: 0 };
    }
    return { kind: 'working', waitingSubagents: live.activeSubagents.length };
  }
  // A pending is open (the status turned to waiting-for-you): the round is held, not over, and Parar must stay
  // reachable - it answers the pending with `interrupt` (T078/T081).
  if (live.pendings.length > 0) return { kind: 'working', waitingSubagents: 0 };
  return null;
}

/** m:ss, minutes unbounded. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}
