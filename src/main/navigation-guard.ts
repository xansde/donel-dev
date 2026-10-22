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
