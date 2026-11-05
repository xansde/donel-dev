// Item 18 (PDA mindscape-openrig) — the link between the main window and the bubble of the Líder on the Jobu.
//
// The conversation with the Líder is a comic bubble that comes out of the Jobu (the pet window, src/main/pet): no
// window of its own. The main only relays: the main window reports which tab is the Líder (`lider:report`), the bubble
// reads the conversation through the chat hub (it broadcasts to every window) and its messages go to the main window
// (`lider:deliver`), which owns the hidden terminal and the send machine of the tab.

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  EMPTY_LIDER_REPORT,
  LIDER_CHANNELS,
  isValidLiderReport,
  isValidLiderSendPayload,
  type LiderReport,
  type LiderSendResult,
  type LiderState,
} from '../../shared/lider/ipc';

/** The slice of the main window the link uses. */
export interface LiderMainWindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  readonly webContents: WebContents;
}

export interface LiderServiceDeps {
  getMainWindow(): LiderMainWindowLike | null;
  /** The web contents of the pet window (where the bubble lives), or `null` with no Jobu. */
  petWebContents(): WebContents | null;
}

export interface LiderService {
  dispose(): void;
}

const DELIVER_TIMEOUT_MS = 10_000;

export function createLiderService(deps: LiderServiceDeps): LiderService {
  let report: LiderReport = EMPTY_LIDER_REPORT;
  const waiting = new Map<string, (result: LiderSendResult) => void>();

  const stateOf = (): LiderState => report;
  const pushState = (): void => {
    const pet = deps.petWebContents();
    if (pet !== null && !pet.isDestroyed()) pet.send(LIDER_CHANNELS.state, stateOf());
  };

  const fromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const main = deps.getMainWindow();
    return main !== null && !main.isDestroyed() && event.sender.id === main.webContents.id;
  };
  const fromPetWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const pet = deps.petWebContents();
    return pet !== null && !pet.isDestroyed() && event.sender.id === pet.id;
  };

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

  ipcMain.handle(LIDER_CHANNELS.getState, (event): LiderState | null => (fromPetWindow(event) ? stateOf() : null));

  ipcMain.handle(LIDER_CHANNELS.send, (event, payload: unknown): Promise<LiderSendResult> => {
    if (!fromPetWindow(event)) return Promise.resolve({ ok: false, reason: 'Janela desconhecida.' });
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

  ipcMain.on(LIDER_CHANNELS.showTab, (event) => {
    if (!fromPetWindow(event)) return;
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    if (report.tabId !== null) main.webContents.send(LIDER_CHANNELS.activateTab, { tabId: report.tabId });
  });

  return {
    dispose() {
      for (const channel of [LIDER_CHANNELS.report, LIDER_CHANNELS.delivered, LIDER_CHANNELS.showTab]) ipcMain.removeAllListeners(channel);
      ipcMain.removeHandler(LIDER_CHANNELS.getState);
      ipcMain.removeHandler(LIDER_CHANNELS.send);
      for (const resolve of waiting.values()) resolve({ ok: false, reason: 'O Donel fechou.' });
      waiting.clear();
    },
  };
}
