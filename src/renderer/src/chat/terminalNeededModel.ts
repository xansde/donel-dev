// T070 (014-chat, R16) - the TIMING half of "o terminal precisa de você" for the sources the renderer sees
// on the xterm screen. Pure: `useTerminalNeededReporter` feeds it the facts and a clock.
//
// Sources here (the hook `Notification` source lives in the main process):
//   - blockingScreen / modelDialog on screen for MORE than 2 s with no open pending (a pending is the
//     panel's job; the 2 s filter keeps a dialog that opens and is answered at once from flashing a strip);
//   - "Transcript saving is off" (immediate - the chat cannot read the conversation);
//   - a sent command marked `opensScreen` (immediate; held until the screen came and went, or a grace period).
// It goes away when the input box is back with no dialog.

import type { TerminalNeededReason } from '../../../shared/chat/rows';
import type { BlockingScreenKind } from '../../../shared/chat/screen';

export const SCREEN_DIALOG_DELAY_MS = 2000;
/** How long an `opensScreen` mark waits for the screen to show up before giving up on it. */
export const OPENS_SCREEN_GRACE_MS = 3000;

export interface ScreenFacts {
  readonly blocking: BlockingScreenKind | null;
  readonly modelDialog: boolean;
  readonly transcriptSavingOff: boolean;
  /** `isReadyForInput(screen)`. */
  readonly inputReady: boolean;
  readonly hasOpenPending: boolean;
}

export interface TerminalNeededState {
  readonly candidate: { readonly reason: TerminalNeededReason; readonly since: number } | null;
  readonly opens: { readonly markedAt: number; readonly sawScreen: boolean } | null;
  readonly reported: TerminalNeededReason | null;
}

export const INITIAL_TERMINAL_NEEDED: TerminalNeededState = { candidate: null, opens: null, reported: null };

export interface TerminalNeededResult {
  readonly state: TerminalNeededState;
  readonly reason: TerminalNeededReason | null;
  /** Re-evaluate after this many ms even with no screen change (a timer is pending); `null` = none. */
  readonly recheckInMs: number | null;
}

function screenReason(facts: ScreenFacts): TerminalNeededReason | null {
  if (facts.blocking === 'permission') return 'permission-dialog';
  if (facts.blocking !== null || facts.modelDialog) return 'interactive-screen';
  return null;
}

export function evaluateTerminalNeeded(
  state: TerminalNeededState,
  facts: ScreenFacts,
  now: number,
  markOpensScreen: boolean,
): TerminalNeededResult {
  if (facts.hasOpenPending) {
    return { state: INITIAL_TERMINAL_NEEDED, reason: null, recheckInMs: null };
  }

  const onScreen = screenReason(facts);
  let candidate = state.candidate;
  if (onScreen === null) candidate = null;
  else if (candidate === null || candidate.reason !== onScreen) candidate = { reason: onScreen, since: now };

  let opens = markOpensScreen ? { markedAt: now, sawScreen: false } : state.opens;
  if (opens !== null) {
    if (!facts.inputReady || onScreen !== null) opens = { ...opens, sawScreen: true };
    const settled = facts.inputReady && onScreen === null && (opens.sawScreen || now - opens.markedAt > OPENS_SCREEN_GRACE_MS);
    if (settled) opens = null;
  }

  const waits: number[] = [];
  let reason: TerminalNeededReason | null = null;
  if (candidate !== null) {
    const remaining = candidate.since + SCREEN_DIALOG_DELAY_MS + 1 - now;
    if (remaining <= 0) reason = candidate.reason;
    else waits.push(remaining);
  }
  if (reason === null && opens !== null) {
    reason = 'interactive-screen';
    if (!opens.sawScreen) waits.push(Math.max(1, opens.markedAt + OPENS_SCREEN_GRACE_MS + 1 - now));
  }
  if (reason === null && facts.transcriptSavingOff) reason = 'unrecognized';
  // Once shown, the strip stays until the box is back with no dialog: the detectors blink while the CLI redraws.
  if (reason === null && state.reported !== null && !(facts.inputReady && onScreen === null)) reason = state.reported;

  return {
    state: { candidate, opens, reported: reason },
    reason,
    recheckInMs: waits.length === 0 ? null : Math.min(...waits),
  };
}
