// Navigation guard shared by every window that exposes `window.donel` (the main window and the Jobu window; T045 of
// 014-chat, R21). A link that navigated such a window would hand the app over to an external page. Navigating to
// another URL is always denied (only a reload of the page itself passes, for the HMR of dev) and new windows are
// always denied - external links leave through the IPC `chat:open-external` (http/https).

import type { WebContents } from 'electron';

/** `true` when `target` is the page the window already shows (the fragment does not count). */
export function isSameDocument(target: string, current: string): boolean {
  const strip = (url: string): string => url.split('#')[0] ?? url;
  return strip(target) === strip(current);
}

/** Installs the guard on a window's `webContents`. */
export function guardNavigation(contents: Pick<WebContents, 'on' | 'getURL' | 'setWindowOpenHandler'>): void {
  const deny = (event: { preventDefault(): void }, url: string): void => {
    if (!isSameDocument(url, contents.getURL())) event.preventDefault();
  };
  contents.on('will-navigate', deny);
  contents.on('will-redirect', deny);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ---------------------------------------------------------------------------------------------------------------
// Named exception: the views of the internal browser (navegador interno, docs/design/navegador-interno.md).
//
// These views are NOT windows of the app: they have no preload, no `window.donel`, `sandbox: true` and their own
// partition. That is the only reason they may navigate at all. The guard above stays exactly as it is for every
// window that exposes `window.donel`; this one is installed ONLY on a browser panel view, by
// `main/browser/browser-panels.ts`. It lets http/https/about:blank through, blocks every other scheme
// (`file://` included), sends popups (`window.open`, `target=_blank`) into the same panel and refuses `<webview>`.

export interface BrowserPanelGuardDeps {
  /** Which URLs the panel may show (`isAllowedPanelUrl` of shared/browser/url.ts). */
  isAllowed(url: string): boolean;
  /** A popup asked to open `url` (already allowed): the panel loads it in place of a new window. */
  openInPanel(url: string): void;
  /** A navigation was blocked (diagnostics only; the URL never reaches a log). */
  onBlocked?(url: string): void;
}

/** Installs the browser panel guard on a panel view's `webContents`. */
export function guardBrowserPanelNavigation(contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>, deps: BrowserPanelGuardDeps): void {
  const filter = (event: { preventDefault(): void }, url: string): void => {
    if (deps.isAllowed(url)) return;
    event.preventDefault();
    deps.onBlocked?.(url);
  };
  contents.on('will-navigate', filter);
  contents.on('will-redirect', filter);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (deps.isAllowed(url)) deps.openInPanel(url);
    else deps.onBlocked?.(url);
    return { action: 'deny' };
  });
}
