import { useSyncExternalStore } from 'react';
import type { BrowserPanelState } from '../../../shared/browser/ipc';

// Navegador interno — renderer-side state of each session's browser, keyed by `ptyId` (the same key the main
// uses for the view and for the MCP token). One store for the whole window: the preload channels accept a
// single subscriber each (subscribeChannel), so the store is that subscriber and fans out to the components.

export interface PtyBrowserView {
  /** The panel is open in its tab (the view itself only shows while the tab is the active one). */
  readonly open: boolean;
  readonly state: BrowserPanelState | null;
}

const EMPTY: PtyBrowserView = { open: false, state: null };

class BrowserStore {
  private readonly byPty = new Map<string, PtyBrowserView>();
  private readonly listeners = new Set<() => void>();
  private wired = false;

  get(ptyId: string): PtyBrowserView {
    return this.byPty.get(ptyId) ?? EMPTY;
  }

  subscribe(listener: () => void): () => void {
    this.wire();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOpen(ptyId: string, open: boolean): void {
    this.patch(ptyId, { open });
    if (!open) return;
    void window.donel.browser
      .open(ptyId)
      .then((state) => this.patch(ptyId, { state }))
      .catch(() => this.patch(ptyId, { open: false }));
  }

  toggle(ptyId: string): void {
    this.setOpen(ptyId, !this.get(ptyId).open);
  }

  protected patch(ptyId: string, partial: Partial<PtyBrowserView>): void {
    this.byPty.set(ptyId, { ...this.get(ptyId), ...partial });
    for (const listener of [...this.listeners]) listener();
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    window.donel.browser.onState((state) => this.patch(state.ptyId, { state }));
    window.donel.browser.onOpenRequest((request) => this.setOpen(request.ptyId, true));
  }
}

export const browserStore = new BrowserStore();

/** The browser of one session (`null` ptyId = a tab without PTY yet). */
export function usePtyBrowser(ptyId: string | null): PtyBrowserView {
  return useSyncExternalStore(
    (listener) => browserStore.subscribe(listener),
    () => (ptyId ? browserStore.get(ptyId) : EMPTY),
  );
}
