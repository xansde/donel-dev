import { useEffect, useMemo } from 'react';
import { buildBrowserDirectory, type BrowserDirectorySession } from '../../../shared/browser/directory';
import type { BrowserControlState, BrowserPanelState } from '../../../shared/browser/ipc';
import { BrowserPanel } from './BrowserPanel';
import { browserStore, useAllBrowsers } from './browserStore';

// Navegador do Líder (t-31e2b949) — the browser panel of the Líder's tab reaches the browser of any session, of any
// board and place: a list on top, the help requests highlighted, and the chosen browser in the panel (see, type,
// click, Assumir/Devolver), exactly as in that session's own tab. A help request from any session opens it here.

export interface LeaderBrowserPanelProps {
  readonly ownPtyId: string;
  readonly active: boolean;
  /** Every session the window knows (tabs on the bar and tabs opened by other sessions). */
  readonly sessions: readonly BrowserDirectorySession[];
}

export function LeaderBrowserPanel({ ownPtyId, active, sessions }: LeaderBrowserPanelProps) {
  const { leader, views } = useAllBrowsers();
  const ownOpen = views.get(ownPtyId)?.open ?? false;

  useEffect(() => {
    browserStore.setLeader(ownPtyId);
    return () => browserStore.setLeader(null);
  }, [ownPtyId]);

  useEffect(() => {
    if (ownOpen) browserStore.loadAll();
  }, [ownOpen]);

  const entries = useMemo(() => {
    const states: BrowserPanelState[] = [];
    const controls: BrowserControlState[] = [];
    for (const view of views.values()) {
      if (view.state) states.push(view.state);
      if (view.control) controls.push(view.control);
    }
    return buildBrowserDirectory({ leaderPtyId: ownPtyId, sessions, states, controls });
  }, [views, sessions, ownPtyId]);

  if (!ownOpen) return null;
  const target = leader.targetPtyId && entries.some((entry) => entry.ptyId === leader.targetPtyId) ? leader.targetPtyId : ownPtyId;

  return (
    <BrowserPanel
      key={target}
      ptyId={target}
      active={active}
      directory={{
        entries,
        ownPtyId,
        onPick: (ptyId) => browserStore.showOnLeader(ptyId),
        onClose: () => {
          browserStore.showOnLeader(null);
          browserStore.setOpen(ownPtyId, false);
        },
      }}
    />
  );
}
