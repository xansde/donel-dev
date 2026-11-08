import { useEffect, useState } from 'react';
import type { FactoryRigsView } from '../../../shared/homologacao/ipc';

/**
 * Mindscape de homologação, fatia 2 — the factory's rigs as the main last read them, kept fresh by its change events;
 * a new read is asked when the lens opens. `null` without the `homologacao` key (or its `rigs`).
 */
export function useFactoryRigs(enabled: boolean): FactoryRigsView | null {
  const [view, setView] = useState<FactoryRigsView | null>(null);
  useEffect(() => {
    const api = window.donel?.homologacao;
    if (!enabled || !api?.rigsGet) return undefined;
    let alive = true;
    const take = (next: FactoryRigsView | null): void => {
      if (alive) setView(next);
    };
    api.rigsGet().then(take).catch(() => undefined);
    api.rigsRefresh().then(take).catch(() => undefined);
    const off = api.onRigsChanged(take);
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return view;
}
