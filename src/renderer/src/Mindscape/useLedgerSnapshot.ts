import { useEffect, useState } from 'react';
import type { LedgerSnapshot } from '../../../shared/ledger/channels';

/** The Oráculo as the main has it, kept fresh by its change events; `null` until read (or without the API). */
export function useLedgerSnapshot(enabled = true): LedgerSnapshot | null {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  useEffect(() => {
    const api = window.donel?.ledger;
    if (!enabled || !api) return undefined;
    let alive = true;
    api
      .load()
      .then((loaded) => {
        if (alive) setSnapshot(loaded);
      })
      .catch(() => undefined);
    const off = api.onChanged((next) => setSnapshot(next));
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return snapshot;
}
