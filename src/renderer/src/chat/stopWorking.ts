// T068 (014-chat) - "Parar" and the Esc key. The send protocol (contracts/send-protocol.md section 9) forbids
// Esc on the PTY outside Parar / "interromper e mandar": it is written ONLY when the screen proves the CLI is
// mid-turn ("esc to interrupt" in the footer) - otherwise Esc would clear the input box or close a menu.

import { isWorking } from '../../../shared/chat/screen';
import type { LineInput } from '../../../shared/chat/screen';

export const ESC = '\x1b';

/** The slice of `TerminalPaneHandle` the stop needs. */
export interface StoppableTerminal {
  readScreen(): { readonly lines: readonly LineInput[] };
  write(data: string): boolean;
}

/** Writes Esc iff the screen shows "esc to interrupt". Returns whether it was written. */
export function stopWorking(terminal: StoppableTerminal | null): boolean {
  if (terminal === null) return false;
  if (!isWorking(terminal.readScreen().lines)) return false;
  return terminal.write(ESC);
}

/**
 * Esc on the chat view (FR-008 / D-C24): menus, fields and the side panel come first (they handle their own Esc
 * and call `preventDefault`); a pending question takes it next (phase 4); Parar is the last case. This phase
 * only owns the last one.
 */
export function shouldStopOnEsc(input: { defaultPrevented: boolean; working: boolean; openPendings: number }): boolean {
  return !input.defaultPrevented && input.working && input.openPendings === 0;
}
