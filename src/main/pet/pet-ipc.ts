// T020 (015-jobu-pet) - the `pet:*` handlers of the main. Two checks on every message, in this
// order: WHO sent it (`pet:tabs` only from the main window, the gestures only from the pet window)
// and WHAT it carries (`isValid...`, src/shared/pet/ipc.ts). A message that fails either is dropped
// without an answer: the pet channels are all `send`, nobody waits for a reply.
//
// This phase handles `pet:tabs`, `pet:ready`, `pet:interactive`, and since US3 `pet:click`, `pet:open` and
// `pet:list-open`. The other gestures of the contract (context-menu, drag-*, resize-step) are registered by
// the stories that implement them (US5), next to the ones below.

import {
  PET_CHANNELS,
  isValidPetInteractivePayload,
  isValidPetListOpenPayload,
  isValidPetOpenPayload,
  isValidPetTabsPayload,
} from '../../shared/pet/ipc';
import type { PetService } from './pet-service';

/** The slice of Electron's `ipcMain` used here. */
export interface PetIpcMainLike {
  on(channel: string, listener: (event: { sender: { id: number } }, ...args: unknown[]) => void): void;
}

/** What the handlers need from the service. */
export type PetIpcService = Pick<PetService, 'onTabs' | 'isPetSender' | 'handleReady' | 'handleInteractive' | 'handleClick' | 'handleOpen' | 'handleListOpen'>;

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
}
