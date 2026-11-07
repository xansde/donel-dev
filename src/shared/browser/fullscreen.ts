// Navegador em tela cheia — the panel takes the whole window of the app and comes back (a button in the panel,
// F11 or Esc). The page itself, the session and the `navegador_*` tools do not change: only where the panel sits.
//
// F11 toggles from anywhere while the panel of the active tab is open, the page included (the main forwards it
// from the view, see browser-panels.ts), and it is taken so the window does not go full screen as well. Esc only
// leaves from the panel's own chrome: a page keeps its Esc (a site's dialog) and a text field keeps its own (the
// address bar resets), and outside the panel Esc belongs to the chat (Parar).

export type BrowserFullscreenAction = 'toggle' | 'exit';

/** Where the key was pressed: the panel chrome, a text field of it, elsewhere in the app or the page. */
export type BrowserFullscreenKeyFocus = 'panel' | 'field' | 'app' | 'page';

export interface BrowserFullscreenKeyInput {
  readonly key: string;
  readonly repeat: boolean;
  readonly defaultPrevented: boolean;
  readonly fullscreen: boolean;
  readonly focus: BrowserFullscreenKeyFocus;
}

/** What a key does to the full screen of the browser, or `null` when it is not ours. */
export function browserFullscreenKey(input: BrowserFullscreenKeyInput): BrowserFullscreenAction | null {
  if (input.repeat || input.defaultPrevented) return null;
  if (input.key === 'F11') return 'toggle';
  if (input.key === 'Escape' && input.fullscreen && input.focus === 'panel') return 'exit';
  return null;
}

/** The full screen after `action`: only an open panel is in full screen. */
export function nextBrowserFullscreen(current: { readonly open: boolean; readonly fullscreen: boolean }, action: BrowserFullscreenAction): boolean {
  if (!current.open) return false;
  return action === 'toggle' ? !current.fullscreen : false;
}
