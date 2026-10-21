// T020 (015-jobu-pet, R1/R14/R19/R21) - the pet in the main process. It owns the window of the pet
// and the 1 s tick, takes the signals the main already has (the tabs the renderer reports, the focus
// of the main window) and sends the view to the pet window only when it changes. Electron stays out
// of this file: the window, the screen, the clock, the timer, the config and the main window all
// come in through `PetServiceDeps`, so the whole life cycle is tested with fakes.
//
// This phase (Foundational) opens and closes the window, runs the tick, keeps the signals and
// answers the `pet:ready` handshake with a trivial view. The user stories plug in at the seams
// marked "EXTENSION POINT": `buildView` (US1 swaps it for the reducer and `toPetView`), the signal
// methods `onSessionExited` (US2), and the gesture handlers next to `handleInteractive` (US3, US5).
//
// With `pet.enabled = false` (the default) this service holds nothing: no window, no timer, and every
// signal is stored and forgotten. The app behaves exactly as it did before the pet.

import type { PetPrefs } from '../../shared/config';
import { PET_CHANNELS, type PetTabsPayload } from '../../shared/pet/ipc';
import {
  alignFor,
  clampSize,
  defaultPlacement,
  displayNearestPoint,
  isDocked,
  isPlacementVisible,
  windowBoundsFor,
} from '../../shared/pet/placement';
import type { FocusSignal, PetDisplay, PetPoint, PetRect, PetUi, PetView } from '../../shared/pet/types';

/** The clock of the pet (R14): one second is enough, the list shows waiting time in minutes. */
export const PET_TICK_MS = 1000;

/** The slice of the main `BrowserWindow` the service uses. */
export interface PetMainWindowLike {
  isDestroyed(): boolean;
  isFocused(): boolean;
  readonly webContents: { send(channel: string, payload: unknown): void };
}

/** The pet window, as the service drives it (the real one is `createPetWindow`, pet-window.ts). */
export interface PetWindowHandle {
  /** `webContents.id` read at creation, so asking "who sent this?" never touches a destroyed window. */
  readonly webContentsId: number;
  isDestroyed(): boolean;
  sendView(view: PetView): void;
  /** `showInactive`: it appears without taking the focus from whatever the owner is doing. */
  showInactive(): void;
  hide(): void;
  /** `true` = the pet receives the mouse; `false` = every click goes through the transparent void (R9). */
  setInteractive(interactive: boolean): void;
  /** The window is focusable only while the list is open (R12). */
  setListOpen(open: boolean): void;
  /** Moves the window by its top-left corner, in DIP. */
  moveTo(point: PetPoint): void;
  applyBounds(bounds: PetRect): void;
  destroy(): void;
}

export interface CreatePetWindowOptions {
  readonly bounds: PetRect;
  /** Called once, when the window is gone (destroyed by the service or by something else). */
  readonly onClosed: () => void;
}

/** What a view is computed from: everything the service knows when the clock or a signal moves. */
export interface PetViewInputs {
  readonly tabs: PetTabsPayload;
  readonly focus: FocusSignal;
  readonly now: number;
  /** Size, docking and alignment, derived from the placement. */
  readonly ui: PetUi;
}

/** The view of this phase: asleep, nothing to report. The reducer and `toPetView` replace it (US1). */
export function buildTrivialView(inputs: PetViewInputs): PetView {
  return {
    pose: 'sleeping',
    badge: null,
    bubble: null,
    waiting: [],
    docked: inputs.ui.docked,
    align: inputs.ui.align,
    silenced: false,
    size: inputs.ui.size,
  };
}

export interface PetServiceDeps {
  readonly getMainWindow: () => PetMainWindowLike | null;
  /** The current `pet` preferences: a getter, because the config changes under the service. */
  readonly config: () => PetPrefs;
  /** Saves the new `pet` preferences (the caller updates its config and writes the file). */
  readonly persist: (next: PetPrefs) => void;
  readonly createWindow: (options: CreatePetWindowOptions) => PetWindowHandle;
  readonly getDisplays: () => readonly PetDisplay[];
  readonly getPrimaryDisplay: () => PetDisplay;
  readonly now: () => number;
  readonly setInterval: (callback: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  /** EXTENSION POINT (US1): defaults to the trivial view. */
  readonly buildView?: (inputs: PetViewInputs) => PetView;
}

export interface PetService {
  /** Applies the saved preference: opens the window when `pet.enabled`. Called once, after the main window is shown (R21). */
  start(): void;
  /** The pet window exists. */
  isEnabled(): boolean;
  /** Preferences toggle (and "Esconder", later): saves, applies at once and tells the main window (R19). */
  setEnabled(enabled: boolean): void;
  /** `pet:tabs`, already validated and known to come from the main window. */
  onTabs(payload: PetTabsPayload): void;
  /** `focus` / `blur` of the main window. */
  onMainFocusChanged(focused: boolean): void;
  /**
   * EXTENSION POINT (US2, T032): a PTY exited, and whether the owner asked for it (C3). Nothing
   * consumes it in this phase.
   */
  onSessionExited(ptyId: string, byUser: boolean): void;
  /** Is this web contents the pet window? The IPC layer asks before it trusts a gesture. */
  isPetSender(sender: { readonly id: number }): boolean;
  /** `pet:ready`: the screen is subscribed. Answers with the current view and shows the window. */
  handleReady(): void;
  /** `pet:interactive`. */
  handleInteractive(interactive: boolean): void;
  /** The main window closed: the window and the tick go away and the service goes inert. */
  dispose(): void;
}

export function createPetService(deps: PetServiceDeps): PetService {
  const buildView = deps.buildView ?? buildTrivialView;

  let disposed = false;
  let window: PetWindowHandle | null = null;
  let tickHandle: unknown = null;
  let petReady = false;
  let lastSentJson: string | null = null;

  let tabs: PetTabsPayload = { activePtyId: null, sessions: [] };
  let donelFocused = deps.getMainWindow()?.isFocused() ?? false;
  let ui: PetUi = { size: clampSize(deps.config().size), docked: false, align: 'center' };

  /** Where the pet sits and how it looks around there: the remembered anchor if it is still on a screen, else the corner. */
  function resolvePlacement(prefs: PetPrefs): { bounds: PetRect; ui: PetUi } {
    const primary = deps.getPrimaryDisplay();
    const reported = deps.getDisplays();
    const displays = reported.length > 0 ? reported : [primary];
    const size = clampSize(prefs.size);
    const remembered = prefs.placement !== null && isPlacementVisible(prefs.placement, size, displays) ? prefs.placement : null;
    const anchor = remembered ?? defaultPlacement(primary, size);
    const display = displayNearestPoint(displays, anchor) ?? primary;
    return {
      bounds: windowBoundsFor(anchor, size),
      ui: { size, docked: isDocked(anchor, display), align: alignFor(anchor, display) },
    };
  }

  function pushView(force: boolean): void {
    if (window === null || !petReady || window.isDestroyed()) return;
    const focus: FocusSignal = { activePtyId: tabs.activePtyId, donelFocused };
    const view = buildView({ tabs, focus, now: deps.now(), ui });
    const json = JSON.stringify(view);
    if (!force && json === lastSentJson) return;
    lastSentJson = json;
    window.sendView(view);
  }

  function stopTick(): void {
    if (tickHandle === null) return;
    deps.clearInterval(tickHandle);
    tickHandle = null;
  }

  function enable(): void {
    if (disposed || window !== null) return;
    const placement = resolvePlacement(deps.config());
    ui = placement.ui;
    let created: PetWindowHandle;
    try {
      created = deps.createWindow({
        bounds: placement.bounds,
        onClosed: () => {
          // The window went away by itself. A "closed" that arrives late, from a window this service
          // already replaced, must not touch the new one.
          if (window !== created) return;
          window = null;
          petReady = false;
          lastSentJson = null;
          stopTick();
        },
      });
    } catch (error) {
      // The pet is a convenience: failing to open it never takes the app with it.
      console.error('[donel-dev] a janela do Jobu não abriu:', error);
      return;
    }
    window = created;
    petReady = false;
    lastSentJson = null;
    tickHandle = deps.setInterval(() => pushView(false), PET_TICK_MS);
  }

  function disable(): void {
    stopTick();
    const closing = window;
    window = null;
    petReady = false;
    lastSentJson = null;
    if (closing !== null && !closing.isDestroyed()) closing.destroy();
  }

  function notifyPrefsChanged(enabled: boolean): void {
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return;
    main.webContents.send(PET_CHANNELS.prefsChanged, { enabled });
  }

  return {
    start() {
      if (deps.config().enabled) enable();
    },

    isEnabled() {
      return window !== null;
    },

    setEnabled(enabled) {
      if (disposed) return;
      const current = deps.config();
      const changed = current.enabled !== enabled;
      if (changed) deps.persist({ ...current, enabled });
      if (enabled) enable();
      else disable();
      if (changed) notifyPrefsChanged(enabled);
    },

    onTabs(payload) {
      if (disposed) return;
      tabs = payload;
      pushView(false);
    },

    onMainFocusChanged(focused) {
      if (disposed) return;
      donelFocused = focused;
      pushView(false);
    },

    onSessionExited(_ptyId, _byUser) {
      // EXTENSION POINT (US2, T032): becomes the `sessionExited` event of the core.
    },

    isPetSender(sender) {
      return window !== null && sender.id === window.webContentsId;
    },

    handleReady() {
      if (disposed || window === null) return;
      petReady = true;
      pushView(true);
      window.showInactive();
    },

    handleInteractive(interactive) {
      if (disposed || window === null || window.isDestroyed()) return;
      window.setInteractive(interactive);
    },

    dispose() {
      disposed = true;
      disable();
    },
  };
}
