import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyMindscapeDoc, type MindscapeDoc } from '../../../shared/mindscape/model';

/** Debounce of the whole-document save (design: 500 ms). */
const SAVE_DEBOUNCE_MS = 500;

export interface MindscapeDocHandle {
  readonly doc: MindscapeDoc;
  /** `false` until the boot load returns — nothing may be written before it, or the file would be overwritten with an empty board. */
  readonly loaded: boolean;
  /** Applies a pure reducer; returning the same document is a no-op (no render, no save). */
  readonly update: (reducer: (doc: MindscapeDoc) => MindscapeDoc) => void;
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

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        flush();
      }
    },
    [flush],
  );

  const update = useCallback(
    (reducer: (current: MindscapeDoc) => MindscapeDoc): void => {
      const next = reducer(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      setDoc(next);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  return { doc, loaded, update };
}
