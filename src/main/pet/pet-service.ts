// T020/T027 (015-jobu-pet, R1/R2/R14/R19/R21) - the pet in the main process. It owns the window of the
// pet and the 1 s tick, takes the signals the main already has - the tabs the renderer reports, the
// focus of the main window, what the session semaphore says of each tab - feeds them to the pure core
// (src/shared/pet/petState.ts) and sends the view to the pet window only when it changes. Electron stays
// out of this file: the window, the screen, the clock, the timer, the config and the main window all come
// in through `PetServiceDeps`, so the whole life cycle is tested with fakes.
//
// The core is fed ALWAYS, with the pet on or off: it is a handful of cheap reductions, and that way
// turning the pet on finds the current state of the sessions (US5, scenario 9) with the real age of
// every wait, instead of starting blind. What exists only while the pet is on is what costs: the
// window, the tick and the sending of views. Turning it on (`enable`) tells the core to `resume`, so
// the hours it spent without a clock do not turn into a waffle.
//
// EXTENSION POINTS: `onSessionExited` gets its `byUser` meaning in US2 (the `ended` bubble); the gesture
// handlers next to `handleInteractive` arrive with US3 and US5.
//
// With `pet.enabled = false` (the default) the app is the one of before the pet: no window, no timer,
// no message to anybody.

import type { PetPrefs } from '../../shared/config';
import { PET_CHANNELS, type PetTabsPayload } from '../../shared/pet/ipc';
import { createPetState, reducePet, toPetSemaphore } from '../../shared/pet/petState';
import { toPetView } from '../../shared/pet/petView';
import {
  alignFor,
  clampSize,
  defaultPlacement,
  displayNearestPoint,
  isDocked,
  isPlacementVisible,
  windowBoundsFor,
} from '../../shared/pet/placement';
import type {
  FocusSignal,
  PetDisplay,
  PetInput,
  PetPoint,
  PetRect,
  PetSemaphore,
  PetState,
  PetUi,
  PetView,
  SemaphorePublicState,
  WatchedSession,
} from '../../shared/pet/types';

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

/** What the semaphore manager publishes on every update (`SemaphoreUpdate`, src/main/session-semaphore-manager.ts): the service reads only these two. */
export interface PetSemaphoreUpdate {
  readonly ptyId: string;
  readonly state: SemaphorePublicState;
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
   * The session semaphore published a state for a tab (`semaphoreManager.onUpdate`). Every hook
   * emits, most of them repeating the state: only a change reaches the core.
   */
  onSemaphoreUpdate(update: PetSemaphoreUpdate): void;
  /**
   * The semaphore just registered a new session (`registerSession`) and announced it as `working`
   * only because that is how it is born (R2): forget that, so a tab nobody has used is `idle`.
   * Called right after `registerSession`, so the next update is a real one.
   */
  onSessionRegistered(ptyId: string): void;
  /**
   * A PTY exited, and whether the owner asked for it (C3). The semaphore also says `done` for a
   * session it registered; this makes the end certain whatever the order of the two. `byUser` is for
   * US2 (T032): the `ended` bubble only when the process ended by itself.
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
  let disposed = false;
  let window: PetWindowHandle | null = null;
  let tickHandle: unknown = null;
  let petReady = false;
  let lastSentJson: string | null = null;

  let tabs: PetTabsPayload = { activePtyId: null, sessions: [] };
  let donelFocused = deps.getMainWindow()?.isFocused() ?? false;
  let ui: PetUi = { size: clampSize(deps.config().size), docked: false, align: 'center' };

  /**
   * What the semaphore last said of each tab. A ptyId that is not here is `idle` (R2: registered,
   * no update yet). Kept with the pet on or off, so the core can be fed at any moment.
   */
  const semaphoreByPty = new Map<string, PetSemaphore>();
  let state: PetState = createPetState();

  /** The tabs of `pet:tabs` crossed with the semaphore: what the core calls "the watched sessions". */
  function sessionsInput(): PetInput {
    const sessions: WatchedSession[] = tabs.sessions.map(({ ptyId, name }) => ({
      ptyId,
      name,
      semaphore: semaphoreByPty.get(ptyId) ?? 'idle',
      blockedKind: null, // EXTENSION POINT (US2, T032): the kind of the open pending, from the chat
    }));
    return { type: 'sessions', sessions };
  }

  function focusInput(): PetInput {
    const focus: FocusSignal = { activePtyId: tabs.activePtyId, donelFocused };
    return { type: 'focus', focus };
  }

  function reduce(...inputs: PetInput[]): void {
    const now = deps.now();
    for (const input of inputs) state = reducePet(state, input, now);
  }

  /** A session that is dead and no longer has a tab is forgotten; an update for a tab that has not been reported yet is kept. */
  function pruneSemaphores(): void {
    const listed = new Set(tabs.sessions.map((session) => session.ptyId));
    for (const [ptyId, semaphore] of semaphoreByPty) {
      if (semaphore === 'done' && !listed.has(ptyId)) semaphoreByPty.delete(ptyId);
    }
  }

  reduce(focusInput());

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
    const view = toPetView(state, deps.now(), ui);
    const json = JSON.stringify(view);
    if (!force && json === lastSentJson) return;
    lastSentJson = json;
    window.sendView(view);
  }

  /** Reduces the inputs and, if the window is there, sends the view when it changed. */
  function feed(...inputs: PetInput[]): void {
    reduce(...inputs);
    pushView(false);
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
    // The core had no clock while the pet was off: its timed parts start from now.
    reduce({ type: 'resume' });
    tickHandle = deps.setInterval(() => feed({ type: 'tick' }), PET_TICK_MS);
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
      pruneSemaphores();
      // The list first, then the focus: whatever the owner is looking at counts as seen against the
      // list as it is now (a tab closed in the same breath is not "visited").
      feed(sessionsInput(), focusInput());
    },

    onMainFocusChanged(focused) {
      if (disposed) return;
      donelFocused = focused;
      feed(focusInput());
    },

    onSemaphoreUpdate(update) {
      if (disposed) return;
      const next = toPetSemaphore(update.state);
      if (semaphoreByPty.get(update.ptyId) === next) return;
      semaphoreByPty.set(update.ptyId, next);
      feed(sessionsInput());
    },

    onSessionRegistered(ptyId) {
      if (disposed) return;
      if (semaphoreByPty.delete(ptyId)) feed(sessionsInput());
    },

    onSessionExited(ptyId, _byUser) {
      if (disposed) return;
      // A plain terminal never had a semaphore and never shows up in `pet:tabs`: nothing to record.
      const known = semaphoreByPty.has(ptyId) || tabs.sessions.some((session) => session.ptyId === ptyId);
      if (!known || semaphoreByPty.get(ptyId) === 'done') return;
      semaphoreByPty.set(ptyId, 'done');
      feed(sessionsInput());
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
