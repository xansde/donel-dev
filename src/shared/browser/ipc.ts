// Navegador interno — IPC contract between the main (owner of the `WebContentsView`s) and the renderer
// (owner of the panel's layout). Same `'<domain>:<action>'` naming as the other domains.
//
// One browser per PTY: the key everywhere is the `ptyId` of the session tab, the same id that names the MCP
// token of that session (docs/design/navegador-interno.md).

export const BROWSER_CHANNELS = {
  /** invoke(ptyId) -> `BrowserPanelState`. Creates the view if there is none yet. */
  open: 'browser:open',
  /** invoke(ptyId) -> `BrowserPanelState | null` (null = no view for this PTY). */
  get: 'browser:get',
  /** send(ptyId, rect | null). `null` hides the view (tab hidden, panel closed or covered by a menu). */
  setBounds: 'browser:setBounds',
  /** invoke(ptyId, typed) -> `BrowserNavigateResult`. */
  navigate: 'browser:navigate',
  /** send(ptyId, action). */
  history: 'browser:history',
  /** invoke(ptyId) -> data URL (JPEG) of the page, or null. Shown in place of the view while it is covered. */
  snapshot: 'browser:snapshot',
  /** main -> renderer: `BrowserPanelState` every time the page changes. */
  state: 'browser:state',
  /** main -> renderer: the browser of this PTY wants to be seen (`BrowserOpenRequest`). */
  openRequest: 'browser:openRequest',
} as const;

export interface BrowserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type BrowserHistoryAction = 'back' | 'forward' | 'reload' | 'stop';

export interface BrowserPanelState {
  readonly ptyId: string;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export type BrowserNavigateResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

export interface BrowserOpenRequest {
  readonly ptyId: string;
}

/** API exposed by the preload in `window.donel.browser`. Each `onX` has ONE subscriber (the renderer's browser store). */
export interface DonelBrowserApi {
  open(ptyId: string): Promise<BrowserPanelState>;
  get(ptyId: string): Promise<BrowserPanelState | null>;
  setBounds(ptyId: string, rect: BrowserRect | null): void;
  navigate(ptyId: string, typed: string): Promise<BrowserNavigateResult>;
  history(ptyId: string, action: BrowserHistoryAction): void;
  snapshot(ptyId: string): Promise<string | null>;
  onState(listener: (state: BrowserPanelState) => void): () => void;
  onOpenRequest(listener: (request: BrowserOpenRequest) => void): () => void;
}

/** Validates a rect that came over IPC (finite, non-negative size). */
export function parseBrowserRect(value: unknown): BrowserRect | null {
  if (value === null || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}
