import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebContentsView, session as electronSession, type BrowserWindow, type Session, type WebContents } from 'electron';
import { guardBrowserPanelNavigation } from '../navigation-guard';
import { isAllowedPanelUrl } from '../../shared/browser/url';
import type { BrowserPanelState, BrowserRect } from '../../shared/browser/ipc';
import { cleanUserAgent, uniqueDownloadName } from './panel-helpers';

// Navegador interno — the `WebContentsView`s of the panel (docs/design/navegador-interno.md).
//
// One view per PTY (session tab). The renderer owns the layout: it sends the rect of the panel's viewport and
// the view is pinned there with `setBounds`; `null` hides it (tab hidden, panel closed, a React menu or modal
// on top). The view is a child of the main window, sandboxed, without preload, in its own partition
// (`persist:donel-browser`, never the user's Chrome cookies). The app never reads what is typed in it: the
// Chromium keeps the partition's cookies, the code here never touches them.

export const BROWSER_PARTITION = 'persist:donel-browser';
/** Ceiling of live views. Creating one more destroys the least recently used hidden, idle one. */
export const MAX_BROWSER_VIEWS = 4;
/** A hidden, idle view is destroyed after this long (its PTY can open another one). */
export const IDLE_DESTROY_MS = 15 * 60_000;
const SWEEP_EVERY_MS = 60_000;
/** Size a view gets while it was never shown (the agent may drive a hidden panel). */
const HIDDEN_DEFAULT_BOUNDS: BrowserRect = { x: 0, y: 0, width: 1280, height: 800 };
/** Only these permissions are granted to pages; everything else (camera, mic, location, notifications...) is denied. */
const GRANTED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export interface BrowserPanelEntry {
  readonly ptyId: string;
  readonly view: WebContentsView;
  readonly contents: WebContents;
  visible: boolean;
  lastUsedAt: number;
  lastBounds: BrowserRect;
}

export interface BrowserPanelsDeps {
  getWindow(): BrowserWindow | null;
  /** `<userData>/browser-downloads` — the only place a download lands. */
  downloadsDir(): string;
  onState(state: BrowserPanelState): void;
  /** The main frame of this PTY's page committed a navigation (the service decides whether it is the agent's). */
  onNavigated?(ptyId: string, url: string): void;
  onDownload?(ptyId: string, fileName: string): void;
  /** The view of this PTY was destroyed (session gone, idle sweep, ceiling): the service drops its CDP driver. */
  onDestroyed?(ptyId: string): void;
  /** `true` while this PTY's browser must not be destroyed (agent tool running, owner in control). */
  isPinned?(ptyId: string): boolean;
  now?: () => number;
}

export class BrowserPanels {
  private readonly entries = new Map<string, BrowserPanelEntry>();
  private sessionReady: Session | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: BrowserPanelsDeps) {
    this.now = deps.now ?? Date.now;
  }

  get(ptyId: string): BrowserPanelEntry | null {
    const entry = this.entries.get(ptyId) ?? null;
    if (entry && entry.contents.isDestroyed()) {
      this.entries.delete(ptyId);
      return null;
    }
    return entry;
  }

  /** The view of this PTY, created (hidden) when it does not exist. Throws when the window is gone or the ceiling is full. */
  ensure(ptyId: string): BrowserPanelEntry {
    const existing = this.get(ptyId);
    if (existing) {
      existing.lastUsedAt = this.now();
      return existing;
    }
    const window = this.deps.getWindow();
    if (!window) throw new Error('A janela do Donel não está aberta.');
    this.makeRoom();

    const ses = this.partition();
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        // The agent drives pages that are not on screen: a hidden panel must not freeze timers.
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents;
    const entry: BrowserPanelEntry = { ptyId, view, contents, visible: false, lastUsedAt: this.now(), lastBounds: HIDDEN_DEFAULT_BOUNDS };
    this.entries.set(ptyId, entry);

    guardBrowserPanelNavigation(contents, {
      isAllowed: isAllowedPanelUrl,
      openInPanel: (url) => {
        void contents.loadURL(url).catch(() => undefined);
      },
    });
    const emit = (): void => this.emitState(ptyId);
    contents.on('did-start-loading', emit);
    contents.on('did-stop-loading', emit);
    contents.on('page-title-updated', emit);
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) emit();
    });
    contents.on('did-navigate', (_event, url) => {
      emit();
      this.deps.onNavigated?.(ptyId, url);
    });
    contents.on('render-process-gone', emit);

    window.contentView.addChildView(view);
    view.setBounds(HIDDEN_DEFAULT_BOUNDS);
    view.setVisible(false);
    this.startSweep();
    return entry;
  }

  /** Pins the view on `rect` (CSS pixels of the main window's page) or hides it (`null`). */
  setBounds(ptyId: string, rect: BrowserRect | null): void {
    const entry = this.get(ptyId);
    if (!entry) return;
    entry.lastUsedAt = this.now();
    if (rect === null) {
      if (entry.visible) {
        entry.visible = false;
        entry.view.setVisible(false);
      }
      return;
    }
    // The renderer measures CSS pixels; the view is placed in DIPs. They differ only by the page zoom.
    const zoom = this.deps.getWindow()?.webContents.getZoomFactor() ?? 1;
    const bounds: BrowserRect = {
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.max(1, Math.round(rect.width * zoom)),
      height: Math.max(1, Math.round(rect.height * zoom)),
    };
    entry.lastBounds = bounds;
    entry.view.setBounds(bounds);
    if (!entry.visible) {
      entry.visible = true;
      entry.view.setVisible(true);
    }
  }

  state(ptyId: string): BrowserPanelState | null {
    const entry = this.get(ptyId);
    if (!entry) return null;
    const { contents } = entry;
    const url = contents.getURL();
    return {
      ptyId,
      url: url === '' ? 'about:blank' : url,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    };
  }

  /** Loads an already validated URL. Resolves when the load finishes or fails (never rejects). */
  async load(ptyId: string, url: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.ensure(ptyId);
    if (!isAllowedPanelUrl(url)) return { ok: false, error: 'Endereço não permitido.' };
    try {
      await entry.contents.loadURL(url);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ERR_ABORTED is a load replaced by another one (a redirect done in JS, a second click): not a failure.
      if (/ERR_ABORTED/.test(message)) return { ok: true };
      return { ok: false, error: message.replace(/\s*\(-?\d+\)\s*loading.*$/s, '') };
    }
  }

  history(ptyId: string, action: 'back' | 'forward' | 'reload' | 'stop'): boolean {
    const entry = this.get(ptyId);
    if (!entry) return false;
    entry.lastUsedAt = this.now();
    const nav = entry.contents.navigationHistory;
    switch (action) {
      case 'back':
        if (!nav.canGoBack()) return false;
        nav.goBack();
        return true;
      case 'forward':
        if (!nav.canGoForward()) return false;
        nav.goForward();
        return true;
      case 'reload':
        entry.contents.reload();
        return true;
      case 'stop':
        entry.contents.stop();
        return true;
    }
  }

  /** JPEG of the page, even while the view is hidden (`stayHidden`). */
  async capture(ptyId: string, maxWidth = 1280, quality = 80): Promise<Buffer | null> {
    const entry = this.get(ptyId);
    if (!entry) return null;
    try {
      let image = await entry.contents.capturePage(undefined, { stayHidden: true });
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      if (width > maxWidth) image = image.resize({ width: maxWidth, quality: 'good' });
      return image.toJPEG(quality);
    } catch {
      return null;
    }
  }

  destroy(ptyId: string): void {
    const entry = this.entries.get(ptyId);
    if (!entry) return;
    this.entries.delete(ptyId);
    const window = this.deps.getWindow();
    try {
      window?.contentView.removeChildView(entry.view);
    } catch {
      // the window is already gone
    }
    if (!entry.contents.isDestroyed()) entry.contents.close();
    if (this.entries.size === 0) this.stopSweep();
    this.deps.onDestroyed?.(ptyId);
  }

  destroyAll(): void {
    for (const ptyId of [...this.entries.keys()]) this.destroy(ptyId);
    this.stopSweep();
  }

  /** Destroys hidden views idle for longer than `IDLE_DESTROY_MS`. Exposed for the sweep timer. */
  sweepIdle(): void {
    const cutoff = this.now() - IDLE_DESTROY_MS;
    for (const entry of [...this.entries.values()]) {
      if (!entry.visible && entry.lastUsedAt < cutoff && !this.deps.isPinned?.(entry.ptyId)) this.destroy(entry.ptyId);
    }
  }

  private emitState(ptyId: string): void {
    const state = this.state(ptyId);
    if (state) this.deps.onState(state);
  }

  /** Below the ceiling, or destroys the least recently used hidden, unpinned view. */
  private makeRoom(): void {
    if (this.entries.size < MAX_BROWSER_VIEWS) return;
    const candidates = [...this.entries.values()]
      .filter((entry) => !entry.visible && !this.deps.isPinned?.(entry.ptyId))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const victim = candidates[0];
    if (!victim) throw new Error(`Já há ${MAX_BROWSER_VIEWS} navegadores abertos em uso; feche o painel de outra aba.`);
    this.destroy(victim.ptyId);
  }

  private partition(): Session {
    if (this.sessionReady) return this.sessionReady;
    const ses = electronSession.fromPartition(BROWSER_PARTITION);
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(GRANTED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_contents, permission) => GRANTED_PERMISSIONS.has(permission));
    ses.on('will-download', (_event, item, contents) => {
      const dir = this.deps.downloadsDir();
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        item.cancel();
        return;
      }
      const name = uniqueDownloadName(dir, item.getFilename());
      item.setSavePath(join(dir, name));
      const owner = [...this.entries.values()].find((entry) => entry.contents === contents);
      item.once('done', (_e, state) => {
        if (state === 'completed' && owner) this.deps.onDownload?.(owner.ptyId, name);
      });
    });
    this.sessionReady = ses;
    return ses;
  }

  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepIdle(), SWEEP_EVERY_MS);
    this.sweepTimer.unref?.();
  }

  private stopSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}
