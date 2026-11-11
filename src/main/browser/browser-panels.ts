import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebContentsView, net, session as electronSession, type BrowserWindow, type Session, type WebContents } from 'electron';
import { guardBrowserPanelNavigation } from '../navigation-guard';
import { canServeLocalFile, isAllowedLocalFileUrl, isAllowedPanelUrl } from '../../shared/browser/url';
import type { BrowserPanelState, BrowserRect, BrowserTabInfo } from '../../shared/browser/ipc';
import { cleanUserAgent, uniqueDownloadName } from './panel-helpers';
import { browserFullscreenKey } from '../../shared/browser/fullscreen';

// Navegador interno — the `WebContentsView`s of the panel (docs/design/navegador-interno.md).
//
// One browser per PTY (session tab), with up to `MAX_TABS_PER_BROWSER` tabs of its own (V2: a popup opens a new tab
// instead of replacing the page). Each tab is one view; only the active one is shown. The renderer owns the layout:
// it sends the rect of the panel's viewport and the view is pinned there with `setBounds`; `null` hides it (tab
// hidden, panel closed, a React menu or modal on top). The view is a child of the main window, sandboxed, without
// preload, in its own partition (`persist:donel-browser`, never the user's Chrome cookies). The app never reads what
// is typed in it: the Chromium keeps the partition's cookies, the code here never touches them.

export const BROWSER_PARTITION = 'persist:donel-browser';
/** Ceiling of live browsers. Creating one more destroys the least recently used hidden, idle one. */
export const MAX_BROWSER_VIEWS = 4;
/** Tabs of one browser. A popup past this replaces the page, as in the V1. */
export const MAX_TABS_PER_BROWSER = 4;
/** A hidden, idle browser is destroyed after this long (its PTY can open another one). */
export const IDLE_DESTROY_MS = 15 * 60_000;
const SWEEP_EVERY_MS = 60_000;
/** Size a view gets while it was never shown (the agent may drive a hidden panel). */
const HIDDEN_DEFAULT_BOUNDS: BrowserRect = { x: 0, y: 0, width: 1280, height: 800 };
/** Only these permissions are granted to pages; everything else (camera, mic, location, notifications...) is denied. */
const GRANTED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export interface BrowserTab {
  readonly id: number;
  readonly view: WebContentsView;
  readonly contents: WebContents;
}

export class BrowserPanelEntry {
  tabs: BrowserTab[] = [];
  activeTabId = 0;
  visible = false;
  lastBounds: BrowserRect = HIDDEN_DEFAULT_BOUNDS;

  constructor(
    readonly ptyId: string,
    public lastUsedAt: number,
  ) {}

  get active(): BrowserTab {
    return this.tabs.find((tab) => tab.id === this.activeTabId) ?? this.tabs[this.tabs.length - 1];
  }

  /** The page of the active tab. */
  get contents(): WebContents {
    return this.active.contents;
  }
}

export interface BrowserPanelsDeps {
  getWindow(): BrowserWindow | null;
  /** `<userData>/browser-downloads` — the only place a download lands. */
  downloadsDir(): string;
  onState(state: BrowserPanelState): void;
  /** The main frame of this PTY's page committed a navigation (the service decides whether it is the agent's). */
  onNavigated?(ptyId: string, url: string): void;
  onDownload?(ptyId: string, fileName: string): void;
  /** `true` while this PTY's browser must not be destroyed (agent tool running, owner in control). */
  isPinned?(ptyId: string): boolean;
  /** `true` to refuse a top-level navigation or a popup (the vigia de domínio, while an agent tool runs). */
  blockNavigation?(ptyId: string, url: string): boolean;
  /** F11 on the page: the panel toggles its full screen (the key is taken, the window stays as it is). */
  onFullscreenKey?(ptyId: string): void;
  now?: () => number;
}

export class BrowserPanels {
  private readonly entries = new Map<string, BrowserPanelEntry>();
  private sessionReady: Session | null = null;
  /** Local files opened on purpose (`load`): the only ones the partition's `file:` handler serves. */
  private readonly openedLocalFiles = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private nextTabId = 1;
  private readonly now: () => number;

  constructor(private readonly deps: BrowserPanelsDeps) {
    this.now = deps.now ?? Date.now;
  }

  get(ptyId: string): BrowserPanelEntry | null {
    const entry = this.entries.get(ptyId) ?? null;
    if (!entry) return null;
    if (entry.tabs.some((tab) => tab.contents.isDestroyed())) entry.tabs = entry.tabs.filter((tab) => !tab.contents.isDestroyed());
    if (entry.tabs.length === 0) {
      this.entries.delete(ptyId);
      return null;
    }
    return entry;
  }

  /** The PTYs that have a browser now. */
  ptyIds(): string[] {
    return [...this.entries.keys()].filter((ptyId) => this.get(ptyId) !== null);
  }

  /** The browser of this PTY, created (hidden) when it does not exist. Throws when the window is gone or the ceiling is full. */
  ensure(ptyId: string): BrowserPanelEntry {
    const existing = this.get(ptyId);
    if (existing) {
      existing.lastUsedAt = this.now();
      return existing;
    }
    const window = this.deps.getWindow();
    if (!window) throw new Error('A janela do Donel não está aberta.');
    this.makeRoom();

    const entry = new BrowserPanelEntry(ptyId, this.now());
    this.entries.set(ptyId, entry);
    entry.activeTabId = this.createTab(entry, window).id;
    this.startSweep();
    return entry;
  }

  /** A popup of this browser: a new tab, active. Past the ceiling, the page of the active tab is replaced. */
  openTab(ptyId: string, url: string): void {
    const entry = this.get(ptyId);
    if (!entry || this.deps.blockNavigation?.(ptyId, url)) return;
    const window = this.deps.getWindow();
    if (!window || entry.tabs.length >= MAX_TABS_PER_BROWSER) {
      void entry.contents.loadURL(url).catch(() => undefined);
      return;
    }
    const tab = this.createTab(entry, window);
    this.activate(entry, tab.id);
    void tab.contents.loadURL(url).catch(() => undefined);
  }

  /** Shows tab `tabId`. `false` when it does not exist. */
  switchTab(ptyId: string, tabId: number): boolean {
    const entry = this.get(ptyId);
    if (!entry || !entry.tabs.some((tab) => tab.id === tabId)) return false;
    entry.lastUsedAt = this.now();
    this.activate(entry, tabId);
    return true;
  }

  /** Closes tab `tabId`; the last one stays (the browser itself closes with the panel or the session). */
  closeTab(ptyId: string, tabId: number): 'closed' | 'last' | 'unknown' {
    const entry = this.get(ptyId);
    const tab = entry?.tabs.find((candidate) => candidate.id === tabId);
    if (!entry || !tab) return 'unknown';
    if (entry.tabs.length === 1) return 'last';
    entry.lastUsedAt = this.now();
    const index = entry.tabs.indexOf(tab);
    const wasActive = entry.activeTabId === tabId;
    entry.tabs = entry.tabs.filter((candidate) => candidate !== tab);
    this.dispose(tab);
    if (wasActive) this.activate(entry, entry.tabs[Math.min(index, entry.tabs.length - 1)].id);
    else this.emitState(ptyId);
    return 'closed';
  }

  /** The address `navegador_voltar` would land on, or `null` when there is none. */
  backUrl(ptyId: string): string | null {
    const nav = this.get(ptyId)?.contents.navigationHistory;
    if (!nav || !nav.canGoBack()) return null;
    return nav.getEntryAtIndex(nav.getActiveIndex() - 1)?.url ?? null;
  }

  /** The address of the active tab (`about:blank` when empty). */
  currentUrl(ptyId: string): string {
    return this.get(ptyId)?.contents.getURL() || 'about:blank';
  }

  /** The tabs of this browser, in order. */
  tabs(ptyId: string): BrowserTabInfo[] {
    const entry = this.get(ptyId);
    if (!entry) return [];
    return entry.tabs.map((tab) => {
      const url = tab.contents.getURL();
      return { id: tab.id, url: url === '' ? 'about:blank' : url, title: tab.contents.getTitle(), active: tab.id === entry.active.id };
    });
  }

  /** Pins the active view on `rect` (CSS pixels of the main window's page) or hides it (`null`). */
  setBounds(ptyId: string, rect: BrowserRect | null): void {
    const entry = this.get(ptyId);
    if (!entry) return;
    entry.lastUsedAt = this.now();
    const { view } = entry.active;
    if (rect === null) {
      if (entry.visible) {
        entry.visible = false;
        view.setVisible(false);
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
    view.setBounds(bounds);
    if (!entry.visible) {
      entry.visible = true;
      view.setVisible(true);
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
      tabs: this.tabs(ptyId),
    };
  }

  /**
   * Loads an already validated URL in the active tab. Resolves when the load finishes or fails (never rejects).
   * The only door to a local file (page, image or PDF): a page never navigates to `file:` by itself.
   */
  async load(ptyId: string, url: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.ensure(ptyId);
    const local = isAllowedLocalFileUrl(url);
    if (!isAllowedPanelUrl(url) && !local) return { ok: false, error: 'Endereço não permitido.' };
    if (local) this.openedLocalFiles.add(url);
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

  /** JPEG of the active page, even while the view is hidden (`stayHidden`). */
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
    for (const tab of entry.tabs) this.dispose(tab);
    if (this.entries.size === 0) this.stopSweep();
  }

  destroyAll(): void {
    for (const ptyId of [...this.entries.keys()]) this.destroy(ptyId);
    this.stopSweep();
  }

  /** Destroys hidden browsers idle for longer than `IDLE_DESTROY_MS`. Exposed for the sweep timer. */
  sweepIdle(): void {
    const cutoff = this.now() - IDLE_DESTROY_MS;
    for (const entry of [...this.entries.values()]) {
      if (!entry.visible && entry.lastUsedAt < cutoff && !this.deps.isPinned?.(entry.ptyId)) this.destroy(entry.ptyId);
    }
  }

  private createTab(entry: BrowserPanelEntry, window: BrowserWindow): BrowserTab {
    const { ptyId } = entry;
    const view = new WebContentsView({
      webPreferences: {
        session: this.partition(),
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
    const tab: BrowserTab = { id: this.nextTabId++, view, contents };
    entry.tabs.push(tab);

    guardBrowserPanelNavigation(contents, {
      isAllowed: isAllowedPanelUrl,
      openInPanel: (url) => this.openTab(ptyId, url),
    });
    // Links, scripts and redirects: `loadURL` itself is checked before it is called.
    contents.on('will-navigate', (event, url) => {
      if (this.deps.blockNavigation?.(ptyId, url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame && this.deps.blockNavigation?.(ptyId, url)) event.preventDefault();
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
    // Navegador em tela cheia: with the focus on the page the key never reaches the app's renderer. Esc stays
    // with the page (a site's dialog); F11 is the panel's.
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const action = browserFullscreenKey({ key: input.key, repeat: input.isAutoRepeat, defaultPrevented: false, fullscreen: false, focus: 'page' });
      if (action !== 'toggle') return;
      event.preventDefault();
      this.deps.onFullscreenKey?.(ptyId);
    });
    // A page may close itself (`window.close()` of a popup): the neighbor tab takes over.
    contents.once('destroyed', () => this.onTabGone(ptyId, tab));

    window.contentView.addChildView(view);
    view.setBounds(entry.lastBounds);
    view.setVisible(false);
    return tab;
  }

  private onTabGone(ptyId: string, tab: BrowserTab): void {
    const entry = this.entries.get(ptyId);
    if (!entry || !entry.tabs.includes(tab)) return;
    const index = entry.tabs.indexOf(tab);
    const wasActive = entry.activeTabId === tab.id;
    entry.tabs = entry.tabs.filter((candidate) => candidate !== tab);
    this.removeFromWindow(tab);
    if (entry.tabs.length === 0) {
      this.entries.delete(ptyId);
      return;
    }
    if (wasActive) this.activate(entry, entry.tabs[Math.min(index, entry.tabs.length - 1)].id);
    else this.emitState(ptyId);
  }

  private activate(entry: BrowserPanelEntry, tabId: number): void {
    const previous = entry.tabs.find((tab) => tab.id === entry.activeTabId);
    const next = entry.tabs.find((tab) => tab.id === tabId);
    if (!next) return;
    if (previous && previous !== next) previous.view.setVisible(false);
    entry.activeTabId = tabId;
    if (entry.visible) {
      next.view.setBounds(entry.lastBounds);
      next.view.setVisible(true);
    }
    this.emitState(entry.ptyId);
  }

  private removeFromWindow(tab: BrowserTab): void {
    try {
      this.deps.getWindow()?.contentView.removeChildView(tab.view);
    } catch {
      // the window is already gone
    }
  }

  private dispose(tab: BrowserTab): void {
    this.removeFromWindow(tab);
    if (!tab.contents.isDestroyed()) tab.contents.close();
  }

  private emitState(ptyId: string): void {
    const state = this.state(ptyId);
    if (state) this.deps.onState(state);
  }

  /** Below the ceiling, or destroys the least recently used hidden, unpinned browser. */
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
    // A local page runs script: without this handler it could fetch any file of the disk. Serve only what was opened.
    ses.protocol.handle('file', (request) =>
      canServeLocalFile(request.url, this.openedLocalFiles)
        ? net.fetch(request.url, { bypassCustomProtocolHandlers: true })
        : new Response('Arquivo não liberado pelo Donel Dev.', { status: 403 }),
    );
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
      const owner = [...this.entries.values()].find((entry) => entry.tabs.some((tab) => tab.contents === contents));
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
