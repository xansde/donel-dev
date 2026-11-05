// T020 (015-jobu-pet) - the `pet:*` handlers of the main. Two checks on every message, in this
// order: WHO sent it (`pet:tabs` only from the main window, the gestures only from the pet window)
// and WHAT it carries (`isValid...`, src/shared/pet/ipc.ts). A message that fails either is dropped
// without an answer: the pet channels are all `send`, nobody waits for a reply.
//
// It handles `pet:tabs`, `pet:ready`, `pet:interactive`, since US3 `pet:click`, `pet:open` and `pet:list-open`,
// and since US5 the rest of the contract: `pet:context-menu`, `pet:drag-start|move|end` and `pet:resize-step`.
// Every channel of `PET_CHANNELS` that comes from a window has a listener here.

import {
  PET_CHANNELS,
  isValidPetContextMenuPayload,
  isValidPetDragPayload,
  isValidPetInteractivePayload,
  isValidPetListOpenPayload,
  isValidPetOpenPayload,
  isValidPetResizeStepPayload,
  isValidPetTabsPayload,
  isValidPetTalkPayload,
  isValidPetTalkResizePayload,
} from '../../shared/pet/ipc';
import type { PetService } from './pet-service';

/** The slice of Electron's `ipcMain` used here. */
export interface PetIpcMainLike {
  on(channel: string, listener: (event: { sender: { id: number } }, ...args: unknown[]) => void): void;
}

/** What the handlers need from the service. */
export type PetIpcService = Pick<
  PetService,
  | 'onTabs'
  | 'isPetSender'
  | 'handleReady'
  | 'handleInteractive'
  | 'handleClick'
  | 'handleOpen'
  | 'handleListOpen'
  | 'handleTalk'
  | 'handleTalkResize'
  | 'handleContextMenu'
  | 'handleDragStart'
  | 'handleDragMove'
  | 'handleDragEnd'
  | 'handleResizeStep'
>;

export interface PetIpcDeps {
  readonly ipcMain: PetIpcMainLike;
  /** `null` before the main window is shown and after it closed: the messages are dropped. */
  readonly getService: () => PetIpcService | null;
  /** The sender is the web contents of the main window. */
  readonly isMainSender: (sender: { id: number }) => boolean;
}

/** Runs `action`; a failure is logged and goes no further (an IPC listener that throws is an uncaught exception in the main). */
function guarded(channel: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error(`[donel-dev] ${channel} falhou:`, error);
  }
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  deps.ipcMain.on(PET_CHANNELS.tabs, (event, payload) => {
    if (!deps.isMainSender(event.sender)) return;
    if (!isValidPetTabsPayload(payload)) return;
    guarded(PET_CHANNELS.tabs, () => deps.getService()?.onTabs(payload));
  });

  deps.ipcMain.on(PET_CHANNELS.ready, (event) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    guarded(PET_CHANNELS.ready, () => service.handleReady());
  });

  deps.ipcMain.on(PET_CHANNELS.interactive, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetInteractivePayload(payload)) return;
    guarded(PET_CHANNELS.interactive, () => service.handleInteractive(payload.interactive));
  });

  deps.ipcMain.on(PET_CHANNELS.click, (event) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    guarded(PET_CHANNELS.click, () => service.handleClick());
  });

  deps.ipcMain.on(PET_CHANNELS.open, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetOpenPayload(payload)) return;
    guarded(PET_CHANNELS.open, () => service.handleOpen(payload.target));
  });

  deps.ipcMain.on(PET_CHANNELS.listOpen, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetListOpenPayload(payload)) return;
    guarded(PET_CHANNELS.listOpen, () => service.handleListOpen(payload.open));
  });

  deps.ipcMain.on(PET_CHANNELS.talk, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetTalkPayload(payload)) return;
    guarded(PET_CHANNELS.talk, () => service.handleTalk(payload.open));
  });

  deps.ipcMain.on(PET_CHANNELS.talkResize, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetTalkResizePayload(payload)) return;
    guarded(PET_CHANNELS.talkResize, () => service.handleTalkResize(payload));
  });

  deps.ipcMain.on(PET_CHANNELS.contextMenu, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetContextMenuPayload(payload)) return;
    guarded(PET_CHANNELS.contextMenu, () => service.handleContextMenu(payload === undefined ? null : { x: payload.screenX, y: payload.screenY }));
  });

  // The three phases of a drag carry the pointer in screen coordinates; the main turns them into the place of the window.
  const dragHandlers = [
    [PET_CHANNELS.dragStart, 'handleDragStart'],
    [PET_CHANNELS.dragMove, 'handleDragMove'],
    [PET_CHANNELS.dragEnd, 'handleDragEnd'],
  ] as const;
  for (const [channel, method] of dragHandlers) {
    deps.ipcMain.on(channel, (event, payload) => {
      const service = deps.getService();
      if (service === null || !service.isPetSender(event.sender)) return;
      if (!isValidPetDragPayload(payload)) return;
      guarded(channel, () => service[method]({ x: payload.screenX, y: payload.screenY }));
    });
  }

  deps.ipcMain.on(PET_CHANNELS.resizeStep, (event, payload) => {
    const service = deps.getService();
    if (service === null || !service.isPetSender(event.sender)) return;
    if (!isValidPetResizeStepPayload(payload)) return;
    guarded(PET_CHANNELS.resizeStep, () => service.handleResizeStep(payload.direction));
  });
}
