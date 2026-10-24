import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Copiar" with feedback (T051, D-C9: copying must really copy). Writes through
 * the main-process clipboard (`window.donel.clipboard`, plan decision 6 — never
 * `navigator.clipboard`). `copied` stays true for `resetMs` after a success.
 */
export function useCopyFeedback(resetMs = 1500): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await window.donel.clipboard.writeText(text);
      } catch {
        return; // a clipboard failure must not break the conversation
      }
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );

  return { copied, copy };
}
