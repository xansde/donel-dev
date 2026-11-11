import { useSyncExternalStore } from 'react';
import { nextBrowserFullscreen } from '../../../shared/browser/fullscreen';
import type { BrowserFullscreenAction } from '../../../shared/browser/fullscreen';
import type { BrowserAgentRules, BrowserControlState, BrowserLogEntry, BrowserPanelState } from '../../../shared/browser/ipc';
import { leaderTargetForRequest } from '../../../shared/browser/directory';

// Navegador integrado — renderer-side state of each session's browser, keyed by `ptyId` (the same key the main
// uses for the view and for the MCP token). One store for the whole window: the preload channels accept a
// single subscriber each (subscribeChannel), so the store is that subscriber and fans out to the components.

/** Lines of the footer log kept per session (D13). */
export const MAX_LOG_LINES = 50;

export interface PtyBrowserView {
  /** The panel is open in its tab (the view itself only shows while the tab is the active one). */
  readonly open: boolean;
  readonly state: BrowserPanelState | null;
  /** Who drives (agent or owner); `null` until the first change. */
  readonly control: BrowserControlState | null;
  /** What the agent did, oldest first. */
  readonly log: readonly BrowserLogEntry[];
  /** Log lines that arrived while the panel was closed (badge of the "Navegador" button). */
  readonly unseen: number;
  /** What the owner allows the agent here; `null` until the panel first asks. */
  readonly rules: BrowserAgentRules | null;
  /** The panel takes the whole window (navegador em tela cheia); only while it is open. */
  readonly fullscreen: boolean;
}

const EMPTY: PtyBrowserView = { open: false, state: null, control: null, log: [], unseen: 0, rules: null, fullscreen: false };

/** Navegador do Líder: the Líder's tab and the browser of another session it is showing (`null` = its own). */
export interface LeaderBrowserView {
  readonly leaderPtyId: string | null;
  readonly targetPtyId: string | null;
}

class BrowserStore {
  private readonly byPty = new Map<string, PtyBrowserView>();
  private readonly listeners = new Set<() => void>();
  private wired = false;
  private leader: LeaderBrowserView = { leaderPtyId: null, targetPtyId: null };

  /** Every browser the renderer knows, for the Líder's list. */
  all(): ReadonlyMap<string, PtyBrowserView> {
    return this.byPty;
  }

  getLeader(): LeaderBrowserView {
    return this.leader;
  }

  /** The Líder's tab registers itself (its PTY) while it is mounted; `null` when it goes away. */
  setLeader(leaderPtyId: string | null): void {
    if (this.leader.leaderPtyId === leaderPtyId) return;
    this.leader = { leaderPtyId, targetPtyId: leaderPtyId ? this.leader.targetPtyId : null };
    this.emit();
  }

  /** Shows another session's browser on the Líder's panel (`null` = back to its own) and opens the panel. */
  showOnLeader(targetPtyId: string | null): void {
    const { leaderPtyId } = this.leader;
    if (!leaderPtyId) return;
    const target = targetPtyId === leaderPtyId ? null : targetPtyId;
    this.leader = { leaderPtyId, targetPtyId: target };
    if (!this.get(leaderPtyId).open) this.setOpen(leaderPtyId, true);
    if (target && !this.get(target).open) this.setOpen(target, true);
    this.emit();
  }

  /** Reads every browser that exists (sessions of other boards and places included). */
  loadAll(): void {
    void window.donel.browser
      .list?.()
      .then((result) => {
        for (const state of result.states) this.patch(state.ptyId, { state });
        for (const control of result.controls) this.patch(control.ptyId, { control });
      })
      .catch(() => undefined);
  }

  get(ptyId: string): PtyBrowserView {
    return this.byPty.get(ptyId) ?? EMPTY;
  }

  subscribe(listener: () => void): () => void {
    this.wire();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOpen(ptyId: string, open: boolean): void {
    this.patch(ptyId, open ? { open, unseen: 0 } : { open, fullscreen: false });
    if (!open) return;
    void window.donel.browser
      .open(ptyId)
      .then((state) => this.patch(ptyId, { state }))
      .catch(() => this.patch(ptyId, { open: false }));
    void window.donel.browser.getRules(ptyId).then((rules) => {
      if (rules) this.patch(ptyId, { rules });
    });
  }

  toggle(ptyId: string): void {
    this.setOpen(ptyId, !this.get(ptyId).open);
  }

  /** Navegador em tela cheia: the button, F11 or Esc. */
  fullscreen(ptyId: string, action: BrowserFullscreenAction): void {
    const current = this.get(ptyId);
    const fullscreen = nextBrowserFullscreen(current, action);
    if (fullscreen !== current.fullscreen) this.patch(ptyId, { fullscreen });
  }

  /** "Assumir": the main answers with the new generation and broadcasts the control state. */
  takeOver(ptyId: string): void {
    void window.donel.browser.takeOver(ptyId).catch(() => undefined);
  }

  /** "Devolver ao agente" with the generation the panel is showing (a stale one is ignored by the main). */
  handBack(ptyId: string): void {
    const control = this.get(ptyId).control;
    if (control && control.owner === 'human') window.donel.browser.handBack(ptyId, control.generation);
  }

  protected patch(ptyId: string, partial: Partial<PtyBrowserView>): void {
    this.byPty.set(ptyId, { ...this.get(ptyId), ...partial });
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private appendLog(entry: BrowserLogEntry): void {
    const current = this.get(entry.ptyId);
    const log = [...current.log, entry].slice(-MAX_LOG_LINES);
    this.patch(entry.ptyId, { log, unseen: current.open ? 0 : current.unseen + 1 });
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    window.donel.browser.onState((state) => this.patch(state.ptyId, { state }));
    window.donel.browser.onOpenRequest((request) => {
      this.setOpen(request.ptyId, true);
      // A session asking for the owner's hand may have no tab on screen (opened by another session): its
      // browser goes to the Líder's tab too.
      const target = leaderTargetForRequest(this.leader.leaderPtyId, request.ptyId);
      if (target) this.showOnLeader(target);
    });
    window.donel.browser.onControl((control) => this.patch(control.ptyId, { control }));
    window.donel.browser.onLog((entry) => this.appendLog(entry));
    window.donel.browser.onRules((rules) => this.patch(rules.ptyId, { rules }));
    window.donel.browser.onFullscreenKey((request) => this.fullscreen(request.ptyId, 'toggle'));
    this.loadAll();
  }
}

export const browserStore = new BrowserStore();

let leaderSnapshotKey = '';
let leaderSnapshot: { readonly leader: LeaderBrowserView; readonly views: ReadonlyMap<string, PtyBrowserView> } | null = null;

/** The Líder's view plus every browser (a new object only when something changed, for useSyncExternalStore). */
export function useAllBrowsers(): { readonly leader: LeaderBrowserView; readonly views: ReadonlyMap<string, PtyBrowserView> } {
  return useSyncExternalStore(
    (listener) => browserStore.subscribe(listener),
    () => {
      const leader = browserStore.getLeader();
      const views = browserStore.all();
      const key = `${leader.leaderPtyId}|${leader.targetPtyId}|${[...views.values()].map((v) => `${v.state?.url}|${v.control?.owner}|${v.control?.generation}|${v.open}`).join(';')}|${views.size}`;
      if (!leaderSnapshot || key !== leaderSnapshotKey) {
        leaderSnapshotKey = key;
        leaderSnapshot = { leader, views: new Map(views) };
      }
      return leaderSnapshot;
    },
  );
}

/** The browser of one session (`null` ptyId = a tab without PTY yet). */
export function usePtyBrowser(ptyId: string | null): PtyBrowserView {
  return useSyncExternalStore(
    (listener) => browserStore.subscribe(listener),
    () => (ptyId ? browserStore.get(ptyId) : EMPTY),
  );
}
