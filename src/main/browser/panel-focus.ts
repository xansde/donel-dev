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
// What tells the commit's focus from the owner's click on the page: the commit's comes a few milliseconds before
// `did-navigate` (measured: 1 to 12 ms). A focus that arrives while a navigation is pending is held as a candidate;
// if the navigation commits (or fails, or stops) within `STEAL_WINDOW_MS`, it was the commit and the focus goes back
// to the last place the owner had it; otherwise it was the owner and the page keeps it. "The last place" follows
// every focus of the main window's page and of the panels, not only the one at the start of the navigation: the
// owner may come back to the chat, or click another panel, while the page loads. The give-back runs one tick later:
// a `focus()` inside the `focus` event is undone by Chromium (measured). Navigations the owner starts from the
// panel's own bar (address, back, forward, reload) keep the page's focus, as before.
//
// Limit, named: the focus does leave for a moment (one `blur` in the main window per navigation), so a key typed in
// that tick is lost and an `onBlur` of the renderer still fires.

/** A page that can hold the keyboard focus: the main window's `webContents` or a panel tab's (a `WebContents` fits). */
export interface FocusPage {
  isDestroyed(): boolean;
  isFocused(): boolean;
  focus(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** How long before the commit a focus of the page still counts as the commit's (the owner's click comes earlier). */
export const STEAL_WINDOW_MS = 250;
/** A navigation the owner asked for from the panel's bar starts within this long. */
const OWNER_NAVIGATION_MS = 2_000;

export interface PanelFocusDeps {
  /** Runs `fn` after the current focus change settles (default: `setImmediate`). */
  defer?(fn: () => void): void;
  now?(): number;
}

interface PanelState {
  pending: boolean;
  ownerUntil: number;
  candidate: { readonly previous: FocusPage | null; readonly timer: ReturnType<typeof setTimeout> } | null;
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
    if (this.current === null && page.isFocused()) this.current = page;
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
      if (!isMainFrame || isSameDocument) return;
      const byOwner = this.now() <= state.ownerUntil;
      state.ownerUntil = 0;
      state.pending = !byOwner;
    });
    page.on('focus', () => {
      if (!state.pending) {
        this.current = page;
        return;
      }
      // Chromium may blur and focus the new document twice: the first candidate holds the place to go back to.
      if (state.candidate !== null) return;
      const previous = this.current;
      const timer = setTimeout(() => {
        // No commit right after: the owner clicked the page.
        state.candidate = null;
        if (page.isFocused()) this.current = page;
      }, STEAL_WINDOW_MS);
      state.candidate = { previous, timer };
    });
    const settled = (): void => {
      state.pending = false;
      const candidate = state.candidate;
      if (candidate === null) return;
      clearTimeout(candidate.timer);
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
    page.on('did-stop-loading', settled);
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
