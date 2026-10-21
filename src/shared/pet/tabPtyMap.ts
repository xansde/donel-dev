// T011 (015-jobu-pet, R4/C2) - the renderer's tab id is `tab-N`; the ptyId is a different string,
// and it changes when a tab is resumed. The main, the chat channels and the pet only know ptyIds.
// This is the one mapping between the two, plus the `pet:tabs` payload built on it.

import type { PetTabsPayload } from './ipc';

/** The slice of a renderer tab these functions read. */
export interface PetTabLike {
  readonly id: string;
  readonly sessionType: 'claude' | 'shell';
  /** Set on the tab of an isolated login: a bare `claude` for `/login`, not a work session. */
  readonly accountLoginId?: string;
}

export interface TabPtyMap {
  /** tab.id -> ptyId; a tab without a PTY is not in it. */
  readonly tabToPty: ReadonlyMap<string, string>;
  /** ptyId -> tab.id. */
  readonly ptyToTab: ReadonlyMap<string, string>;
  ptyIdOf(tabId: string): string | null;
  tabIdOf(ptyId: string): string | null;
}

/** Rebuilt from scratch on every call: "Retomar" gives the same tab a new ptyId, and the old one must stop resolving. */
export function tabPtyMap(tabs: readonly { readonly id: string }[], ptyIdOf: (tabId: string) => string | null | undefined): TabPtyMap {
  const tabToPty = new Map<string, string>();
  const ptyToTab = new Map<string, string>();
  for (const tab of tabs) {
    const ptyId = ptyIdOf(tab.id);
    if (typeof ptyId !== 'string' || ptyId === '') continue;
    tabToPty.set(tab.id, ptyId);
    ptyToTab.set(ptyId, tab.id);
  }
  return {
    tabToPty,
    ptyToTab,
    ptyIdOf: (tabId) => tabToPty.get(tabId) ?? null,
    tabIdOf: (ptyId) => ptyToTab.get(ptyId) ?? null,
  };
}

/**
 * What the renderer tells the main (`pet:tabs`): only `claude` tabs that have a PTY, in tab order,
 * with the name the tab shows. Plain terminals are never sessions, and neither is the tab of an
 * isolated login (no hooks, so no semaphore). `activePtyId` is the active tab's ptyId only when
 * that tab is one of the listed sessions, so a shell in front never counts as a session "seen".
 */
export function buildPetTabsPayload<T extends PetTabLike>(
  tabs: readonly T[],
  ptyIdOf: (tabId: string) => string | null | undefined,
  resolveName: (tab: T) => string,
  activeTabId: string,
): PetTabsPayload {
  const sessions: { ptyId: string; name: string }[] = [];
  let activePtyId: string | null = null;
  for (const tab of tabs) {
    if (tab.sessionType !== 'claude' || tab.accountLoginId !== undefined) continue;
    const ptyId = ptyIdOf(tab.id);
    if (typeof ptyId !== 'string' || ptyId === '') continue;
    sessions.push({ ptyId, name: resolveName(tab) });
    if (tab.id === activeTabId) activePtyId = ptyId;
  }
  return { activePtyId, sessions };
}
