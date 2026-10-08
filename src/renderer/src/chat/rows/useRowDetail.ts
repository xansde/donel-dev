import { useCallback, useEffect, useRef, useState } from 'react';
import type { RowDetail, RowDetailPart } from '../../../../shared/chat/ipc';

/** Resolves a row's heavy detail on demand (wired to `chat:row-detail` by the container). */
export type RequestRowDetail = (rowId: string, part: RowDetailPart) => Promise<RowDetail>;

export type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly detail: RowDetail }
  | { readonly status: 'error' };

/**
 * Lazy loader of the detail parts of ONE row. Each part loads once; asking again
 * while loading or ready is a no-op, a failed part can be retried.
 */
export function useRowDetail(
  requestDetail: RequestRowDetail,
  rowId: string,
): { states: Partial<Record<RowDetailPart, DetailState>>; load: (part: RowDetailPart) => void } {
  const [states, setStates] = useState<Partial<Record<RowDetailPart, DetailState>>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    (part: RowDetailPart) => {
      const current = statesRef.current[part];
      if (current && current.status !== 'error') return;
      setStates((previous) => ({ ...previous, [part]: { status: 'loading' } }));
      requestDetail(rowId, part).then(
        (detail) => {
          if (alive.current) setStates((previous) => ({ ...previous, [part]: { status: 'ready', detail } }));
        },
        () => {
          if (alive.current) setStates((previous) => ({ ...previous, [part]: { status: 'error' } }));
        },
      );
    },
    [requestDetail, rowId],
  );

  return { states, load };
}
