import { join } from 'node:path';
import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import { BROWSER_CHANNELS, parseBrowserRect, type BrowserHistoryAction, type BrowserNavigateResult, type BrowserPanelState } from '../../shared/browser/ipc';
import { normalizeBrowserUrl } from '../../shared/browser/url';
import { BrowserPanels } from './browser-panels';

// Navegador interno — the main-side service: the views (browser-panels.ts) and the IPC of the panel.
// docs/design/navegador-interno.md.

export interface BrowserServiceDeps {
  readonly ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  readonly userDataDir: string;
  /** Only the main window's renderer may drive the panel. */
  isMainSender(sender: WebContents): boolean;
}

export interface BrowserService {
  /** A claude session was spawned: its browser may exist from now on. */
  registerPty(ptyId: string): void;
  /** The session's process left: its browser is destroyed. */
  releasePty(ptyId: string): void;
  destroyAll(): void;
}

const MAX_PTY_ID_LENGTH = 128;

function isPtyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PTY_ID_LENGTH;
}

export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const livePtys = new Set<string>();
  const send = (channel: string, payload: unknown): void => {
    const window = deps.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const panels = new BrowserPanels({
    getWindow: deps.getWindow,
    downloadsDir: () => join(deps.userDataDir, 'browser-downloads'),
    onState: (state) => send(BROWSER_CHANNELS.state, state),
  });

  const known = (sender: WebContents, ptyId: unknown): ptyId is string => deps.isMainSender(sender) && isPtyId(ptyId) && livePtys.has(ptyId);

  deps.ipcMain.handle(BROWSER_CHANNELS.open, (event, ptyId: unknown): BrowserPanelState => {
    if (!known(event.sender, ptyId)) throw new Error('Sessão desconhecida para o navegador.');
    panels.ensure(ptyId);
    const state = panels.state(ptyId);
    if (!state) throw new Error('O navegador não abriu.');
    return state;
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.get, (event, ptyId: unknown): BrowserPanelState | null => {
    if (!known(event.sender, ptyId)) return null;
    return panels.state(ptyId);
  });

  deps.ipcMain.on(BROWSER_CHANNELS.setBounds, (event, ptyId: unknown, rect: unknown) => {
    if (!known(event.sender, ptyId)) return;
    panels.setBounds(ptyId, rect === null ? null : parseBrowserRect(rect));
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.navigate, async (event, ptyId: unknown, typed: unknown): Promise<BrowserNavigateResult> => {
    if (!known(event.sender, ptyId)) return { ok: false, reason: 'Sessão desconhecida para o navegador.' };
    const target = normalizeBrowserUrl(typeof typed === 'string' ? typed : '');
    if (!target.ok) return target;
    const loaded = await panels.load(ptyId, target.url);
    return loaded.ok ? { ok: true, url: target.url } : { ok: false, reason: `A página não abriu: ${loaded.error}` };
  });

  deps.ipcMain.on(BROWSER_CHANNELS.history, (event, ptyId: unknown, action: unknown) => {
    if (!known(event.sender, ptyId)) return;
    if (action === 'back' || action === 'forward' || action === 'reload' || action === 'stop') panels.history(ptyId, action as BrowserHistoryAction);
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.snapshot, async (event, ptyId: unknown): Promise<string | null> => {
    if (!known(event.sender, ptyId)) return null;
    const jpeg = await panels.capture(ptyId, 1600, 70);
    return jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null;
  });

  return {
    registerPty: (ptyId) => {
      livePtys.add(ptyId);
    },
    releasePty: (ptyId) => {
      livePtys.delete(ptyId);
      panels.destroy(ptyId);
    },
    destroyAll: () => panels.destroyAll(),
  };
}
