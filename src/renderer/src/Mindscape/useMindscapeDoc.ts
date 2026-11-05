import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_HISTORY, recordHistory, redoHistory, undoHistory, type BoardHistory, type HistoryStep } from '../../../shared/mindscape/history';
import type { MindscapeSaveResult } from '../../../shared/mindscape/channels';
import { emptyMindscapeDoc, type MindscapeBoard, type MindscapeDoc } from '../../../shared/mindscape/model';
import {
  decideAfterSave,
  mindscapeAlert,
  shouldFlushOnClose,
  type MindscapeAlert,
  type MindscapeLoadStatus,
  type MindscapeSaveStatus,
} from '../../../shared/mindscape/persistence';

/** Debounce of the whole-document save (design: 500 ms). */
const SAVE_DEBOUNCE_MS = 500;

export interface MindscapeDocHandle {
  readonly doc: MindscapeDoc;
  /** `false` until the boot load returns — nothing may be written before it, or the file would be overwritten with an empty board. */
  readonly loaded: boolean;
  /**
   * The warning of the Mindscape screen: the load failed (nothing is written
   * until it loads), the save gave up after its retries, or the file belongs to
   * a newer channel. `null` when all is well.
   */
  readonly alert: MindscapeAlert | null;
  /** "Tentar de novo" of the alert: reads the file again (failed load) or writes the last version again (failed save). */
  readonly retry: () => void;
  /**
   * Desenho, fatia 02 — an owner action on the board of `projectPath`: applies
   * the pure reducer and records `{ before, after }` of that board in its
   * history. Returning the same document is a no-op (no render, no save, no entry).
   */
  readonly apply: (projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc) => void;
  /** A session event (or a move of the view): applies the reducer without touching the history. */
  readonly applySession: (reducer: (doc: MindscapeDoc) => MindscapeDoc) => void;
  /** Ctrl+Z on the board of `projectPath`; `false` with nothing to undo. */
  readonly undo: (projectPath: string) => boolean;
  /** Ctrl+Shift+Z on the board of `projectPath`; `false` with nothing to redo. */
  readonly redo: (projectPath: string) => boolean;
}

/**
 * Mindscape V1 — the renderer owns the document in memory; the main only
 * writes it. Lives in the App (not in the screen) so the board keeps being
 * fed while the Mindscape is closed. A failed load leaves the board empty and
 * read-only (never saved over the file); a failed save is retried
 * (`decideAfterSave`) and the last version stays pending, also for the close.
 */
export function useMindscapeDoc(): MindscapeDocHandle {
  const [doc, setDoc] = useState<MindscapeDoc>(emptyMindscapeDoc);
  const [loadStatus, setLoadStatus] = useState<MindscapeLoadStatus>('loading');
  const [saveStatus, setSaveStatus] = useState<MindscapeSaveStatus>('saved');
  /** Bumped by "Tentar de novo" after a failed load: runs the load again. */
  const [loadRound, setLoadRound] = useState(0);
  const docRef = useRef(doc);
  const loadStatusRef = useRef<MindscapeLoadStatus>('loading');
  /** The last version the main confirmed on disk (or the one it loaded). */
  const savedDocRef = useRef(doc);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Each save takes a number; only the answer of the latest one decides (an older answer is stale). */
  const saveSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadStatusRef.current = 'loading';
    setLoadStatus('loading');
    window.donel.mindscape
      .load()
      .then((loadedDoc) => {
        if (cancelled) return;
        docRef.current = loadedDoc;
        savedDocRef.current = loadedDoc;
        setDoc(loadedDoc);
        loadStatusRef.current = 'ready';
        setLoadStatus('ready');
      })
      .catch(() => {
        // Never "loaded with an empty board": the next save would erase the file.
        if (cancelled) return;
        loadStatusRef.current = 'failed';
        setLoadStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [loadRound]);

  const clearRetry = useCallback((): void => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const save = useCallback(
    (retriesDone: number): void => {
      if (loadStatusRef.current !== 'ready') return;
      const seq = ++saveSeqRef.current;
      const sent = docRef.current;
      const settle = (result: MindscapeSaveResult | null): void => {
        if (seq !== saveSeqRef.current) return;
        const decision = decideAfterSave(result, retriesDone);
        if (decision.status === 'saved') savedDocRef.current = sent;
        setSaveStatus(decision.status);
        if (decision.retryInMs !== null) {
          clearRetry();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            save(retriesDone + 1);
          }, decision.retryInMs);
        }
      };
      window.donel.mindscape.save(sent).then(settle, () => settle(null));
    },
    [clearRetry],
  );

  const flush = useCallback((): void => {
    timerRef.current = null;
    clearRetry();
    save(0);
  }, [clearRetry, save]);

  useEffect(() => {
    const flushPending = (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      // Inside the debounce window, or a save still failing/retrying: the last version goes now.
      if (shouldFlushOnClose(loadStatusRef.current, docRef.current, savedDocRef.current)) flush();
    };
    // Closing the app inside the debounce window would drop the last change.
    window.addEventListener('beforeunload', flushPending);
    return () => {
      window.removeEventListener('beforeunload', flushPending);
      flushPending();
      clearRetry();
    };
  }, [flush, clearRetry]);

  const commit = useCallback(
    (next: MindscapeDoc): void => {
      // A board that did not load is read-only: nothing it holds may reach the file.
      if (loadStatusRef.current !== 'ready') return;
      docRef.current = next;
      setDoc(next);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback((): void => {
    if (loadStatusRef.current === 'failed') {
      setLoadRound((round) => round + 1);
      return;
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    flush();
  }, [flush]);

  /** `projectPath → { undo, redo }`, in memory only: lives with the App, so it survives a mode change, and starts empty at every launch. */
  const historyRef = useRef<Record<string, BoardHistory>>({});

  const applySession = useCallback(
    (reducer: (current: MindscapeDoc) => MindscapeDoc): void => {
      const next = reducer(docRef.current);
      if (next !== docRef.current) commit(next);
    },
    [commit],
  );

  const apply = useCallback(
    (projectPath: string, reducer: (current: MindscapeDoc) => MindscapeDoc): void => {
      // Not loaded: no change and no history entry (commit would refuse it anyway).
      if (loadStatusRef.current !== 'ready') return;
      const previous = docRef.current;
      const next = reducer(previous);
      if (next === previous) return;
      const before = previous.boards[projectPath];
      const after = next.boards[projectPath];
      // Only a change of that board is an entry (a board that does not exist yet has nothing to go back to).
      if (before && after && before !== after) {
        historyRef.current = { ...historyRef.current, [projectPath]: recordHistory(historyRef.current[projectPath] ?? EMPTY_HISTORY, { before, after }) };
      }
      commit(next);
    },
    [commit],
  );

  const step = useCallback(
    (projectPath: string, move: (history: BoardHistory, current: MindscapeBoard) => HistoryStep | null): boolean => {
      const current = docRef.current.boards[projectPath];
      if (!current || loadStatusRef.current !== 'ready') return false;
      const result = move(historyRef.current[projectPath] ?? EMPTY_HISTORY, current);
      if (!result) return false;
      historyRef.current = { ...historyRef.current, [projectPath]: result.history };
      commit({ ...docRef.current, boards: { ...docRef.current.boards, [projectPath]: result.board } });
      return true;
    },
    [commit],
  );

  const undo = useCallback((projectPath: string): boolean => step(projectPath, undoHistory), [step]);
  const redo = useCallback((projectPath: string): boolean => step(projectPath, redoHistory), [step]);

  const alert = mindscapeAlert(loadStatus, saveStatus);
  return { doc, loaded: loadStatus === 'ready', alert, retry, apply, applySession, undo, redo };
}
