// Navegador interno — the panel never takes the keyboard focus from the owner (t-af678813: "enquanto estou digitando
// no donel dev, a caixa de digitação é deselecionada").
//
// Measured in Electron 43 (xvfb, 15/11): when a panel view commits a main-frame, cross-document navigation
// (`navegador_abrir`, a click on a link, Enter that submits a form, reload, back, a redirect, a popup's first page),
// the view takes the keyboard focus of the window at commit, even while it is hidden. The caret leaves the chat or
// the terminal mid-word. CDP clicks, typing and keys do not move the focus, nor same-document navigations, frames,
// or anything while the window is inactive. Electron has no switch to keep a view from taking it, so the keeper
// gives it back.
//
// What tells the commit's focus from the owner's click on the page: the owner's comes with a mouse press on the
// page (`input-event` `mouseDown`, right after the `focus`, measured). A focus that arrives while a navigation is
// pending is held as a candidate; a mouse press on the page makes it the owner's, and the page keeps it; otherwise,
// when the navigation commits (or fails, or stops), the focus goes back to the last place the owner had it. Not a
// time window: a busy renderer commits up to 600 ms after the focus (measured), and a busy main process runs a timer
// late. Keys do not count: while the focus is stolen, the owner's typing lands on the page. "The last place" follows
// every focus of the main window's page and of the panels, not only the one at the start of the navigation: the
// owner may come back to the chat, or click another panel, while the page loads. The give-back runs one tick later:
// a `focus()` inside the `focus` event is undone by Chromium (measured). Navigations the owner starts from the
// panel's own bar (address, back, forward, reload) keep the page's focus, as before.
//
// Limits, named: the focus does leave for a moment (one `blur` in the main window per navigation), so a key typed in
// that tick is lost and an `onBlur` of the renderer still fires. An agent's CDP click on the page in the few
// milliseconds between the commit's focus and `did-navigate` would count as the owner's.

/** A page that can hold the keyboard focus: the main window's `webContents` or a panel tab's (a `WebContents` fits). */
export interface FocusPage {
  isDestroyed(): boolean;
  isFocused(): boolean;
  focus(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** A navigation the owner asked for from the panel's bar starts within this long. */
const OWNER_NAVIGATION_MS = 1_000;
/** Input events that mean the owner's hand on the page (never keys: see above). */
const OWNER_POINTER_EVENTS = new Set(['mouseDown', 'touchStart', 'gestureTapDown']);

export interface PanelFocusDeps {
  /** Runs `fn` after the current focus change settles (default: `setImmediate`). */
  defer?(fn: () => void): void;
  now?(): number;
}

interface PanelState {
  pending: boolean;
  ownerUntil: number;
  /** A focus that arrived while a navigation was pending: where the focus was before it. */
  candidate: { readonly previous: FocusPage | null } | null;
}

export class PanelFocusKeeper {
  /** The last page the owner put the focus on (main window or a panel). */
  private current: FocusPage | null = null;
  private readonly watched = new WeakSet<FocusPage>();
  private readonly panels = new WeakMap<FocusPage, PanelState>();
  private readonly defer: (fn: () => void) => void;
  private readonly now: () => number;

  constructor(deps: PanelFocusDeps = {}) {
    this.defer = deps.defer ?? ((fn) => void setImmediate(fn));
    this.now = deps.now ?? Date.now;
  }

  /** The main window's page: where the chat and the terminal live. */
  watchWindow(page: FocusPage): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    // A new main window (macOS reopens it from the Dock) replaces the old one, which may be destroyed.
    if (page.isFocused() || this.current === null || this.current.isDestroyed()) this.current = page;
    page.on('focus', () => {
      this.current = page;
    });
  }

  /** A panel tab's page. */
  watchPanel(page: FocusPage): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    const state: PanelState = { pending: false, ownerUntil: 0, candidate: null };
    this.panels.set(page, state);

    page.on('did-start-navigation', (_event: unknown, _url: string, isSameDocument: boolean, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      const byOwner = state.ownerUntil > 0 && this.now() <= state.ownerUntil;
      state.ownerUntil = 0;
      if (isSameDocument) return;
      state.pending = !byOwner;
    });
    page.on('focus', () => {
      if (!state.pending) {
        this.current = page;
        return;
      }
      // Chromium may blur and focus the new document twice: the first candidate holds the place to go back to.
      if (state.candidate === null) state.candidate = { previous: this.current };
    });
    page.on('input-event', (_event: unknown, input: { type?: string }) => {
      if (state.candidate === null || !OWNER_POINTER_EVENTS.has(input.type ?? '')) return;
      // The owner clicked the page while it loads: the focus is theirs.
      state.candidate = null;
      this.current = page;
    });
    const settled = (): void => {
      state.pending = false;
      const candidate = state.candidate;
      if (candidate === null) return;
      state.candidate = null;
      const back = candidate.previous;
      if (back === null || back === page) {
        this.current = page;
        return;
      }
      this.defer(() => {
        // Still on the page (nobody moved it meanwhile) and the old place is still there.
        if (!page.isDestroyed() && page.isFocused() && !back.isDestroyed()) back.focus();
      });
    };
    page.on('did-navigate', settled);
    page.on('did-stop-loading', () => {
      // A mark the owner left without a navigation (stop, a load refused before it started) dies with the load.
      state.ownerUntil = 0;
      settled();
    });
    page.on('did-fail-load', (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) settled();
    });
  }

  /** The owner asked this page to navigate (panel bar, or a popup of the page they are using): the page may take the focus. */
  ownerNavigates(page: FocusPage): void {
    const state = this.panels.get(page);
    if (state) state.ownerUntil = this.now() + OWNER_NAVIGATION_MS;
  }
}
