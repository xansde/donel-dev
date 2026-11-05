// 014-chat (alfa-4) - the CLI fires no Stop hook when Esc cancels the round, so the chat would stay "trabalhando".
// Right after a Parar/Esc that reached the terminal, the SCREEN may end the round: the proof of the turn
// (`isWorking`: "esc to interrupt" or the spinner row) is gone and the input box is back. Only inside that window;
// outside it nothing is inferred from the screen. Pure.

/** How long after a stop request the screen may still end the round. */
export const STOP_WINDOW_MS = 30_000;

export interface StopWindow {
  /** `Date.now()` of the Parar / Esc press. */
  readonly at: number;
  /** The screen proved the round over. */
  readonly confirmed: boolean;
  /** The box was read once after the confirmation with text in it (see `box`). */
  readonly boxRead: boolean;
}

export const openStopWindow = (at: number): StopWindow => ({ at, confirmed: false, boxRead: false });

export interface ScreenReading {
  /** `isWorking`: "esc to interrupt" in the footer or the spinner row above the box. */
  readonly working: boolean;
  /** Input box back (empty or typed), no dialog on screen. */
  readonly ready: boolean;
  /** Text in the box; `null` when unreadable. */
  readonly boxText: string | null;
}

export interface StopWindowStep {
  readonly window: StopWindow | null;
  /** Text found in the box right after the stop was confirmed: candidate for "texto devolvido". */
  readonly box: string | null;
}

export function stepStopWindow(window: StopWindow | null, screen: ScreenReading, now: number): StopWindowStep {
  if (window === null) return { window: null, box: null };
  if (screen.working) {
    // Working again after a confirmed stop = a new round: the window is spent. Before the confirmation it is the
    // stop still being processed.
    if (window.confirmed) return { window: null, box: null };
    return { window: now - window.at > STOP_WINDOW_MS ? null : window, box: null };
  }
  if (!window.confirmed && now - window.at > STOP_WINDOW_MS) return { window: null, box: null };
  if (!screen.ready) return { window, box: null };
  const hasBox = screen.boxText !== null && screen.boxText !== '';
  if (hasBox && !window.boxRead) return { window: { ...window, confirmed: true, boxRead: true }, box: screen.boxText };
  return { window: window.confirmed ? window : { ...window, confirmed: true }, box: null };
}
