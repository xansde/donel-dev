import type { WebContents } from 'electron';

// Navegador interno — the panel never takes the keyboard focus from the owner (t-af678813: "enquanto estou digitando
// no donel dev, a caixa de digitação é deselecionada").
//
// Measured in Electron 43 (xvfb, 15/11): when a panel view commits a main-frame, cross-document navigation
// (`navegador_abrir`, a click on a link, Enter that submits a form, reload, back), the view takes the keyboard focus
// of the window, even while it is hidden. The caret leaves the chat or the terminal mid-word. CDP clicks, typing
// and keys do not move the focus, nor same-document navigations, frames, or anything while the window is inactive.
// Electron has no switch to keep a view from taking it, so the focus goes back to whoever had it when the
// navigation started, one tick later (a `focus()` inside the `focus` event is undone by Chromium, measured). A
// navigation started with the focus already on the page (the owner using it) is left alone, and so is any focus
// after the commit (the owner clicking the page).

/** Whoever can hold the keyboard focus: the main window's page or another browser view. */
export interface FocusHolder {
  isDestroyed(): boolean;
  focus(): void;
}

export interface PanelFocusDeps {
  /** The page that holds the keyboard focus now (`webContents.getFocusedWebContents()`); `null` = the app is inactive. */
  focused(): FocusHolder | null;
  /** Runs `fn` after the current focus change settles (default: `setImmediate`). */
  defer?(fn: () => void): void;
}

type PanelPage = FocusHolder & Pick<WebContents, 'on' | 'isFocused'>;

/** Installs the guard on a panel view's `webContents`. */
export function keepFocusOnNavigation(page: PanelPage, deps: PanelFocusDeps): void {
  let holder: FocusHolder | null = null;
  const defer = deps.defer ?? ((fn: () => void): void => void setImmediate(fn));
  page.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
    if (!isMainFrame || isSameDocument) return;
    const now = deps.focused();
    holder = now !== null && now !== page ? now : null;
  });
  page.on('focus', () => {
    const giveBack = holder;
    if (giveBack === null) return;
    defer(() => {
      // Still on the page (the owner did not click somewhere else meanwhile) and the old holder is still there.
      if (!page.isDestroyed() && page.isFocused() && !giveBack.isDestroyed()) giveBack.focus();
    });
  });
  const disarm = (): void => {
    holder = null;
  };
  page.on('did-navigate', disarm);
  page.on('did-stop-loading', disarm);
  page.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) disarm();
  });
}
