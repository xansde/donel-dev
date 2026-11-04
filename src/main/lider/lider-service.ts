// Item 18 (PDA mindscape-openrig) — the floating window of the conversation with the Jobu as Líder.
//
// An ordinary, framed, resizable `BrowserWindow` (the OS gives dragging, resizing and moving to another monitor for
// free) that loads the same `index.html` at `#lider`, with the same preload. It remembers its place and size
// (`liderWindow` in config.json), can stay on top, and comes back onto a screen when the monitors change.
//
// The main only relays: the main window reports which tab is the Líder (`lider:report`), the floating window
// reads the conversation through the chat hub (it broadcasts to every window) and its messages go to the main
// window (`lider:deliver`), which owns the hidden terminal and the send machine of the tab.

import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  EMPTY_LIDER_REPORT,
  LIDER_CHANNELS,
  LIDER_WINDOW_DEFAULT,
  LIDER_WINDOW_MIN,
  fitOnScreens,
  isValidLiderReport,
  isValidLiderSendPayload,
  type LiderReport,
  type LiderSendResult,
  type LiderState,
  type LiderWindowBounds,
  type LiderWindowPrefs,
  type Rect,
} from '../../shared/lider/ipc';
import { guardNavigation } from '../navigation-guard';

export interface LiderServiceDeps {
  getMainWindow(): BrowserWindow | null;
  config(): LiderWindowPrefs;
  persist(next: LiderWindowPrefs): void;
  /** Where the Jobu is, to open the window next to him the first time. `null` = no Jobu. */
  petBounds(): Rect | null;
}

export interface LiderService {
  /** Opens the window, or closes it when it is open (the click on the Jobu, the item of his menu). */
  toggle(): void;
  dispose(): void;
}

const DELIVER_TIMEOUT_MS = 10_000;

export function createLiderService(deps: LiderServiceDeps): LiderService {
  let win: BrowserWindow | null = null;
  let report: LiderReport = EMPTY_LIDER_REPORT;
  const waiting = new Map<string, (result: LiderSendResult) => void>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const live = (): BrowserWindow | null => (win !== null && !win.isDestroyed() ? win : null);
  const workAreas = (): Rect[] => screen.getAllDisplays().map((display) => display.workArea);
  const stateOf = (): LiderState => ({ ...report, alwaysOnTop: deps.config().alwaysOnTop });
  const pushState = (): void => live()?.webContents.send(LIDER_CHANNELS.state, stateOf());

  const fromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const main = deps.getMainWindow();
    return main !== null && !main.isDestroyed() && event.sender.id === main.webContents.id;
  };
  const fromLiderWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const current = live();
    return current !== null && event.sender.id === current.webContents.id;
  };

  function initialBounds(): LiderWindowBounds {
    const saved = deps.config().bounds;
    if (saved !== null) return fitOnScreens(saved, workAreas());
    const pet = deps.petBounds();
    const anchor = pet ? screen.getDisplayMatching(pet).workArea : screen.getPrimaryDisplay().workArea;
    const width = Math.min(LIDER_WINDOW_DEFAULT.width, anchor.width);
    const height = Math.min(LIDER_WINDOW_DEFAULT.height, anchor.height);
    if (pet) {
      // Above and to the left of the Jobu, so the bubble seems to come out of him.
      const x = Math.min(Math.max(pet.x + pet.width / 2 - width, anchor.x), anchor.x + anchor.width - width);
      const y = Math.min(Math.max(pet.y - height + pet.height / 3, anchor.y), anchor.y + anchor.height - height);
      return { x: Math.round(x), y: Math.round(y), width, height };
    }
    return { x: Math.round(anchor.x + (anchor.width - width) / 2), y: Math.round(anchor.y + (anchor.height - height) / 2), width, height };
  }

  function saveBoundsSoon(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const current = live();
      if (current === null || current.isMinimized() || current.isMaximized()) return;
      deps.persist({ ...deps.config(), bounds: current.getBounds() });
    }, 400);
  }

  function refit(): void {
    const current = live();
    if (current === null) return;
    const bounds = current.getBounds();
    const fitted = fitOnScreens(bounds, workAreas());
    if (fitted.x !== bounds.x || fitted.y !== bounds.y || fitted.width !== bounds.width || fitted.height !== bounds.height) current.setBounds(fitted);
  }

  function open(): void {
    const bounds = initialBounds();
    const created = new BrowserWindow({
      ...bounds,
      minWidth: LIDER_WINDOW_MIN.width,
      minHeight: LIDER_WINDOW_MIN.height,
      title: 'Jobu · Líder',
      alwaysOnTop: deps.config().alwaysOnTop,
      autoHideMenuBar: true,
      backgroundColor: '#16161a',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    created.setMenuBarVisibility(false);
    guardNavigation(created.webContents);
    created.once('ready-to-show', () => {
      if (!created.isDestroyed()) created.show();
    });
    created.on('move', saveBoundsSoon);
    created.on('resize', saveBoundsSoon);
    created.on('closed', () => {
      if (win === created) win = null;
    });
    const loaded = process.env.ELECTRON_RENDERER_URL
      ? created.loadURL(`${process.env.ELECTRON_RENDERER_URL}#lider`)
      : created.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'lider' });
    loaded.catch((error: unknown) => {
      if (!created.isDestroyed()) console.error('[donel-dev] a janela do Líder não carregou:', error);
    });
    win = created;
  }

  // ---- IPC ------------------------------------------------------------------

  ipcMain.on(LIDER_CHANNELS.report, (event, payload: unknown) => {
    if (!fromMainWindow(event) || !isValidLiderReport(payload)) return;
    report = payload;
    pushState();
  });

  ipcMain.on(LIDER_CHANNELS.delivered, (event, payload: unknown) => {
    if (!fromMainWindow(event) || typeof payload !== 'object' || payload === null) return;
    const { id, result } = payload as { id?: unknown; result?: unknown };
    if (typeof id !== 'string') return;
    const resolve = waiting.get(id);
    if (resolve === undefined) return;
    waiting.delete(id);
    const ok = typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === true;
    const reason = !ok && typeof (result as { reason?: unknown } | null)?.reason === 'string' ? (result as { reason: string }).reason : 'Não foi.';
    resolve(ok ? { ok: true } : { ok: false, reason });
  });

  ipcMain.handle(LIDER_CHANNELS.getState, (event): LiderState | null => (fromLiderWindow(event) ? stateOf() : null));

  ipcMain.handle(LIDER_CHANNELS.send, (event, payload: unknown): Promise<LiderSendResult> => {
    if (!fromLiderWindow(event)) return Promise.resolve({ ok: false, reason: 'Janela desconhecida.' });
    if (!isValidLiderSendPayload(payload)) return Promise.resolve({ ok: false, reason: 'Mensagem vazia ou longa demais.' });
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return Promise.resolve({ ok: false, reason: 'A janela do Donel está fechada.' });
    const id = randomUUID();
    return new Promise<LiderSendResult>((resolve) => {
      const timer = setTimeout(() => {
        if (waiting.delete(id)) resolve({ ok: false, reason: 'O Donel não respondeu.' });
      }, DELIVER_TIMEOUT_MS);
      waiting.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      main.webContents.send(LIDER_CHANNELS.deliver, { id, text: payload.text });
    });
  });

  ipcMain.on(LIDER_CHANNELS.setOnTop, (event, onTop: unknown) => {
    if (!fromLiderWindow(event) || typeof onTop !== 'boolean') return;
    deps.persist({ ...deps.config(), alwaysOnTop: onTop });
    live()?.setAlwaysOnTop(onTop);
    pushState();
  });

  ipcMain.on(LIDER_CHANNELS.showTab, (event) => {
    if (!fromLiderWindow(event)) return;
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    if (report.tabId !== null) main.webContents.send(LIDER_CHANNELS.activateTab, { tabId: report.tabId });
  });

  const onDisplays = (): void => refit();
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  return {
    toggle() {
      const current = live();
      if (current === null) {
        open();
        return;
      }
      if (current.isVisible() && !current.isMinimized()) {
        current.close();
        return;
      }
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
    },
    dispose() {
      screen.removeListener('display-added', onDisplays);
      screen.removeListener('display-removed', onDisplays);
      screen.removeListener('display-metrics-changed', onDisplays);
      for (const channel of [LIDER_CHANNELS.report, LIDER_CHANNELS.delivered, LIDER_CHANNELS.setOnTop, LIDER_CHANNELS.showTab]) ipcMain.removeAllListeners(channel);
      ipcMain.removeHandler(LIDER_CHANNELS.getState);
      ipcMain.removeHandler(LIDER_CHANNELS.send);
      live()?.destroy();
      win = null;
    },
  };
}
