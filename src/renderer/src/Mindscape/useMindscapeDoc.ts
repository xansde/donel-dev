import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_HISTORY, recordHistory, redoHistory, undoHistory, type BoardHistory, type HistoryStep } from '../../../shared/mindscape/history';
import { emptyMindscapeDoc, type MindscapeBoard, type MindscapeDoc } from '../../../shared/mindscape/model';

/** Debounce of the whole-document save (design: 500 ms). */
const SAVE_DEBOUNCE_MS = 500;

export interface MindscapeDocHandle {
  readonly doc: MindscapeDoc;
  /** `false` until the boot load returns — nothing may be written before it, or the file would be overwritten with an empty board. */
  readonly loaded: boolean;
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
 * fed while the Mindscape is closed.
 */
export function useMindscapeDoc(): MindscapeDocHandle {
  const [doc, setDoc] = useState<MindscapeDoc>(emptyMindscapeDoc);
  const [loaded, setLoaded] = useState(false);
  const docRef = useRef(doc);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.donel.mindscape
      .load()
      .then((loadedDoc) => {
        if (cancelled) return;
        docRef.current = loadedDoc;
        setDoc(loadedDoc);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback((): void => {
    timerRef.current = null;
    void window.donel.mindscape.save(docRef.current).catch(() => undefined);
  }, []);

  useEffect(() => {
    const flushPending = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        flush();
      }
    };
    // Closing the app inside the debounce window would drop the last change.
    window.addEventListener('beforeunload', flushPending);
    return () => {
      window.removeEventListener('beforeunload', flushPending);
      flushPending();
    };
  }, [flush]);

  const commit = useCallback(
    (next: MindscapeDoc): void => {
      docRef.current = next;
      setDoc(next);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

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
      if (!current) return false;
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

  return { doc, loaded, apply, applySession, undo, redo };
}
