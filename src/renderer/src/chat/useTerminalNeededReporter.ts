// T070 (014-chat, R16) - reads the xterm screen of one tab and reports to the main process what needs the
// terminal (`ChatStore.reportScreenState`). The hub combines this with the hook `Notification` source into
// `LiveState.terminalNeeded`. The timing rules are pure and live in `terminalNeededModel.ts`.

import { useEffect, useRef } from 'react';
import type { LiveState, TerminalNeededReason } from '../../../shared/chat/rows';
import { blockingScreen, isReadyForInput, modelDialog, transcriptSavingOff } from '../../../shared/chat/screen';
import type { LineInput } from '../../../shared/chat/screen';
import { getChatStore } from './ChatStore';
import { INITIAL_TERMINAL_NEEDED, evaluateTerminalNeeded, type ScreenFacts } from './terminalNeededModel';

/** The slice of `TerminalPaneHandle` the reporter needs. */
export interface ScreenSource {
  readScreen(): { readonly lines: readonly LineInput[] };
  onScreenUpdate(listener: () => void): () => void;
}

const markListeners = new Map<string, Set<() => void>>();

/**
 * The send driver calls this right after it sends a command it knows opens a screen (`/model`, `/config`...):
 * the strip shows at once, without waiting for the 2 s screen filter, and goes away when the box is back.
 */
export function markOpensScreen(ptyId: string): void {
  for (const listener of [...(markListeners.get(ptyId) ?? [])]) listener();
}

function subscribeMark(ptyId: string, listener: () => void): () => void {
  let set = markListeners.get(ptyId);
  if (set === undefined) {
    set = new Set();
    markListeners.set(ptyId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) markListeners.delete(ptyId);
  };
}

export function readScreenFacts(lines: readonly LineInput[], hasOpenPending: boolean): ScreenFacts {
  return {
    blocking: blockingScreen(lines)?.kind ?? null,
    modelDialog: modelDialog(lines) !== null,
    transcriptSavingOff: transcriptSavingOff(lines),
    inputReady: isReadyForInput(lines),
    hasOpenPending,
  };
}

export function useTerminalNeededReporter(handle: ScreenSource | null, ptyId: string | null, live: LiveState | null): void {
  const openPendings = live?.pendings.length ?? 0;
  const pendingsRef = useRef(openPendings);
  pendingsRef.current = openPendings;
  const evaluateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (handle === null || ptyId === null) return undefined;
    const store = getChatStore();
    let state = INITIAL_TERMINAL_NEEDED;
    let reported: TerminalNeededReason | null = null;
    let markPending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const result = evaluateTerminalNeeded(state, readScreenFacts(handle.readScreen().lines, pendingsRef.current > 0), Date.now(), markPending);
      markPending = false;
      state = result.state;
      if (result.reason !== reported) {
        reported = result.reason;
        store.reportScreenState(ptyId, result.reason);
      }
      if (result.recheckInMs !== null) timer = setTimeout(evaluate, result.recheckInMs);
    };
    evaluateRef.current = evaluate;

    const offScreen = handle.onScreenUpdate(evaluate);
    const offMark = subscribeMark(ptyId, () => {
      markPending = true;
      evaluate();
    });
    evaluate();
    return () => {
      offScreen();
      offMark();
      if (timer !== null) clearTimeout(timer);
      evaluateRef.current = null;
      if (reported !== null) store.reportScreenState(ptyId, null);
    };
  }, [handle, ptyId]);

  // An open pending suppresses the strip: re-evaluate when one opens or closes, not only on screen output.
  useEffect(() => {
    evaluateRef.current?.();
  }, [openPendings]);
}
