// T020/T027/T032/T038 (015-jobu-pet, R1/R2/R7/R14/R19/R21) - the pet in the main process. It owns the window of the
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
// What the core cannot know it is told here: the kind of the pending the chat opened (`onPendingOpened`),
// that a process exited and whether the owner asked for it (`onSessionExited`), and that an app has the
// whole screen (`onFullscreenChanged`, called by the watcher of US5). The gestures of the window next to
// `handleInteractive` - the click, the item of the list, the list opening - are answered here too (US3);
// the drag and the menu are US5.
//
// With `pet.enabled = false` (the default) the app is the one of before the pet: no window, no timer,
// no message to anybody.

import type { PetPrefs } from '../../shared/config';
import { decideClick } from '../../shared/pet/click';
import { PET_CHANNELS, type PetOpenTarget, type PetTabsPayload } from '../../shared/pet/ipc';
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
  BlockedKind,
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
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  setAlwaysOnTop(flag: boolean): void;
  readonly webContents: { send(channel: string, payload: unknown): void };
}

/**
 * R7: brings the Donel in front of whatever is there, for a click the owner made on the Jobu. A click on a
 * window of this very process is the gesture Windows lets take the foreground, so `restore`, `show` and
 * `focus` are enough; when the foreground lock refuses all the same, the reserve raises the window above
 * the others for an instant. Exported so the rule is tested with a fake window.
 */
export function bringMainWindowToFront(main: PetMainWindowLike): void {
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  if (!main.isFocused()) forceToForeground(main);
}

/** The reserve of R7, alone so that the day the alpha proves it is never needed it goes away in one place: on top, focus again, back to normal. */
function forceToForeground(main: PetMainWindowLike): void {
  main.setAlwaysOnTop(true);
  main.focus();
  main.setAlwaysOnTop(false);
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
  /** Tells the screen to close the list: the window lost the focus, and the page itself never hears about it. */
  requestCloseList(): void;
  /** Moves the window by its top-left corner, in DIP. */
  moveTo(point: PetPoint): void;
  applyBounds(bounds: PetRect): void;
  destroy(): void;
}

export interface CreatePetWindowOptions {
  readonly bounds: PetRect;
  /** Called once, when the window is gone (destroyed by the service or by something else). */
  readonly onClosed: () => void;
  /** The window lost the focus (the owner clicked elsewhere, or another window of the app was activated). */
  readonly onBlur: () => void;
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
   * session it registered, and the `SessionEnd` hook can say it before the process is gone: this makes
   * the end certain whatever the order of the two. The `ended` bubble only comes when the process ended
   * by itself (`byUser = false`) and the owner was not looking at its tab.
   */
  onSessionExited(ptyId: string, byUser: boolean): void;
  /**
   * The chat opened a pending (`pendingOpened` of the hub). The semaphore turns `permission` a moment
   * before, with the bubble already born as "quer permissão": this refines it into the real kind.
   */
  onPendingOpened(ptyId: string, kind: BlockedKind): void;
  /** An app took the whole screen, or gave it back (the watcher of US5): no bubble is born while it lasts. */
  onFullscreenChanged(active: boolean): void;
  /** Is this web contents the pet window? The IPC layer asks before it trusts a gesture. */
  isPetSender(sender: { readonly id: number }): boolean;
  /** `pet:ready`: the screen is subscribed. Answers with the current view and shows the window. */
  handleReady(): void;
  /** `pet:interactive`. */
  handleInteractive(interactive: boolean): void;
  /**
   * `pet:click`: a click on the drawing. One waiting: the Donel comes to the front on that tab. Nobody
   * waiting: the Donel comes to the front as it is. Several: nothing here, the list is the screen's (FR-023).
   * The answer is decided now, with the state of the main, not with the view the screen last drew.
   */
  handleClick(): void;
  /** `pet:open`: the Donel comes to the front and, for a session, activates its tab (an item of the list, or the bubble). */
  handleOpen(target: PetOpenTarget): void;
  /** `pet:list-open`: the window can take the focus while the list is open, so that Esc reaches it and its `blur` (a click elsewhere) closes the list (R12). */
  handleListOpen(open: boolean): void;
  /** The main window closed: the window and the tick go away and the service goes inert. */
  dispose(): void;
}

export function createPetService(deps: PetServiceDeps): PetService {
  let disposed = false;
  let window: PetWindowHandle | null = null;
  let tickHandle: unknown = null;
  let petReady = false;
  let lastSentJson: string | null = null;
  /** The list is open on the screen (what `pet:list-open` last said): only then does losing the focus mean "close it". */
  let listOpen = false;

  let tabs: PetTabsPayload = { activePtyId: null, sessions: [] };
  // In front of the owner: focused and not minimized (a minimized window can keep reporting the focus). The main
  // process keeps the signal after this, from the focus, blur, minimize, restore, show and hide of the window.
  const mainAtBirth = deps.getMainWindow();
  let donelFocused = mainAtBirth !== null && mainAtBirth.isFocused() && !mainAtBirth.isMinimized();
  let ui: PetUi = { size: clampSize(deps.config().size), docked: false, align: 'center' };

  /**
   * What the semaphore last said of each tab. A ptyId that is not here is `idle` (R2: registered,
   * no update yet). Kept with the pet on or off, so the core can be fed at any moment.
   */
  const semaphoreByPty = new Map<string, PetSemaphore>();
  /**
   * The kind of the pending the chat has open on a tab (R3), for as long as the tab stays in `permission`.
   * Without the chat there is none, and "quer permissão" is what the bubble says.
   */
  const pendingKindByPty = new Map<string, BlockedKind>();
  let state: PetState = createPetState();

  /** The tabs of `pet:tabs` crossed with the semaphore and the pendings: what the core calls "the watched sessions". */
  function sessionsInput(): PetInput {
    const sessions: WatchedSession[] = tabs.sessions.map(({ ptyId, name }) => {
      const semaphore = semaphoreByPty.get(ptyId) ?? 'idle';
      return { ptyId, name, semaphore, blockedKind: semaphore === 'permission' ? (pendingKindByPty.get(ptyId) ?? null) : null };
    });
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

  /** A session that is dead and no longer has a tab is forgotten, and so is a pending kind for a tab that is gone; an update for a tab that has not been reported yet is kept. */
  function pruneSemaphores(): void {
    const listed = new Set(tabs.sessions.map((session) => session.ptyId));
    for (const [ptyId, semaphore] of semaphoreByPty) {
      if (semaphore === 'done' && !listed.has(ptyId)) semaphoreByPty.delete(ptyId);
    }
    for (const ptyId of pendingKindByPty.keys()) {
      if (!listed.has(ptyId)) pendingKindByPty.delete(ptyId);
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

  /** What the screen would draw right now. */
  function currentView(): PetView {
    return toPetView(state, deps.now(), ui);
  }

  function pushView(force: boolean): void {
    if (window === null || !petReady || window.isDestroyed()) return;
    const view = currentView();
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
          listOpen = false;
          stopTick();
        },
        // Same guard: a blur that arrives late, from a window this service already replaced, is not news.
        onBlur: () => {
          if (window === created) closeListOnBlur();
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
    listOpen = false;
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
    listOpen = false;
    if (closing !== null && !closing.isDestroyed()) closing.destroy();
  }

  /**
   * The window lost the focus while the list was open - the owner clicked somewhere else (FR-023). The list is
   * the screen's state, so the screen is told to close it, and the window stops being focusable right away
   * instead of waiting for the screen's own report (`pet:list-open`, which will only repeat it).
   */
  function closeListOnBlur(): void {
    if (!listOpen || window === null || window.isDestroyed()) return;
    listOpen = false;
    window.requestCloseList();
    window.setListOpen(false);
  }

  /**
   * What a click on the Jobu, on his bubble or on an item of the list does here (R7): the bubble has served
   * and goes, the Donel comes to the front and, for a session, is told to activate its tab. Nothing happens
   * with no main window: the pet is only ever a guest of it.
   */
  function openTarget(target: PetOpenTarget): void {
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return;
    feed({ type: 'bubbleDismissed' });
    bringMainWindowToFront(main);
    if (target.kind === 'session') main.webContents.send(PET_CHANNELS.activateSession, { ptyId: target.ptyId });
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
      if (next !== 'permission') pendingKindByPty.delete(update.ptyId); // the pending is over, or never was one
      if (semaphoreByPty.get(update.ptyId) === next) return;
      semaphoreByPty.set(update.ptyId, next);
      feed(sessionsInput());
    },

    onSessionRegistered(ptyId) {
      if (disposed) return;
      if (semaphoreByPty.delete(ptyId)) feed(sessionsInput());
    },

    onSessionExited(ptyId, byUser) {
      if (disposed) return;
      // A plain terminal never had a semaphore and never shows up in `pet:tabs`: nothing to record.
      const listed = tabs.sessions.find((session) => session.ptyId === ptyId);
      if (listed === undefined && !semaphoreByPty.has(ptyId)) return;
      semaphoreByPty.set(ptyId, 'done');
      pendingKindByPty.delete(ptyId);
      // The exit goes first, while the core still has the session as the owner last saw it. It is announced
      // even if the semaphore already said `done` (the SessionEnd hook can come first): the core only
      // learns of the exit here.
      feed({ type: 'sessionExited', ptyId, name: listed?.name ?? ptyId, byUser, at: deps.now() }, sessionsInput());
    },

    onPendingOpened(ptyId, kind) {
      if (disposed) return;
      pendingKindByPty.set(ptyId, kind);
      feed(sessionsInput(), { type: 'pendingOpened', ptyId, kind, at: deps.now() });
    },

    onFullscreenChanged(active) {
      if (disposed) return;
      feed({ type: 'fullscreen', active });
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

    handleClick() {
      if (disposed || window === null || window.isDestroyed()) return;
      const decision = decideClick(currentView());
      if (decision.kind !== 'list') openTarget(decision);
    },

    handleOpen(target) {
      if (disposed || window === null || window.isDestroyed()) return;
      openTarget(target);
    },

    handleListOpen(open) {
      if (disposed || window === null || window.isDestroyed()) return;
      listOpen = open;
      window.setListOpen(open);
    },

    dispose() {
      disposed = true;
      disable();
    },
  };
}
