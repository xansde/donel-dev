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
// window, the tick, the sending of views, the listener of the monitors and the watcher of full screen. Turning it on
// (`enable`) tells the core to `resume`, so the hours it spent without a clock do not turn into a waffle.
//
// What the core cannot know it is told here: the kind of the pending the chat opened (`onPendingOpened`),
// that a process exited and whether the owner asked for it (`onSessionExited`), that the account changed
// (`onAccountSwitched`, US4) and that an app has the whole screen (`onFullscreenChanged`, called by the
// watcher of US5). The gestures of the window next to `handleInteractive` - the click, the item of the list,
// the list opening (US3) - are answered here too, and so are the ones of US5: the drag, the Ctrl + wheel, the
// right-click menu and what each item of it does (silence, hide, go home, the size, the capture, and since 016 the sweep).
// The sweep itself is not here: `runSweep` comes in through the deps, and this file only turns its totals into the bubble.
//
// Where the pet sits is its ANCHOR, the base of the drawing (src/shared/pet/placement.ts), and every move of
// the window is a `setBounds` with the whole rectangle (`applyBounds`), never a `setPosition`: on a screen
// scaled to 125% a `setPosition` makes a transparent window grow (measured: 300 of them turned 480x340 into
// 780x681), and a window that grows moves the base out from under the drawing.
//
// With `pet.enabled = false` (the default) the app is the one of before the pet: no window, no timer,
// no message to anybody.

import type { PetPrefs, PetTalkSize } from '../../shared/config';
import { blockCapture, captureAllowed, captureReleased, createCaptureState, releaseCapture, type CaptureState } from '../../shared/pet/capture';
import { decideClick } from '../../shared/pet/click';
import { dragAnchor, settleDrop } from '../../shared/pet/gestures';
import { PET_CHANNELS, type PetOpenTarget, type PetTabsPayload, type PetTalkResizePayload } from '../../shared/pet/ipc';
import { buildPetMenu, type PetMenuAction, type PetMenuEntry } from '../../shared/pet/menu';
import { PET_SILENCE_MS, assertNever, createPetState, isSilenced, reducePet, toPetSemaphore, waitingCount } from '../../shared/pet/petState';
import { toPetView } from '../../shared/pet/petView';
import {
  alignFor,
  clampSize,
  defaultPlacement,
  displayNearestPoint,
  isDocked,
  isPlacementVisible,
  stepSize,
  talkHeightFor,
  talkMaxWidthFor,
  talkWidthFor,
  windowBoundsFor,
} from '../../shared/pet/placement';
import type {
  BlockedKind,
  BubbleEvent,
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
  SweepBubbleSummary,
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
  /**
   * The window is focusable only while the list or the bubble of the Líder is open (R12). `takeFocus` = it also takes
   * the keyboard now (the gesture that opened them); turning it off hands the focus back first.
   */
  setFocusable(focusable: boolean, takeFocus: boolean): void;
  /** Tells the screen to close the list: the window lost the focus, and the page itself never hears about it. */
  requestCloseList(): void;
  /** Sets the whole rectangle of the window, in DIP: every move goes through here (see the note at the top about `setPosition`). */
  applyBounds(bounds: PetRect): void;
  /** FR-034/FR-035: `true` lets a screen capture see the window, `false` keeps it out of the capture. */
  setCaptureAllowed(allowed: boolean): void;
  /**
   * The right-click menu. `at` is where the owner clicked, in screen DIP (`null` = at the pointer). `onChoose`
   * gets the ACTION of the item that was clicked; nothing is called when the menu closes with no choice.
   */
  popupMenu(entries: readonly PetMenuEntry[], onChoose: (action: PetMenuAction) => void, at: PetPoint | null): void;
  destroy(): void;
}

export interface CreatePetWindowOptions {
  readonly bounds: PetRect;
  /** FR-034: whether a screen capture may see the window. `false` = born protected, out of every capture, from its first frame. */
  readonly captureAllowed: boolean;
  /** Called once, when the window is gone (destroyed by the service or by something else). */
  readonly onClosed: () => void;
  /** The window lost the focus (the owner clicked elsewhere, or another window of the app was activated). */
  readonly onBlur: () => void;
}

/** What the semaphore manager publishes on every update (`SemaphoreUpdate`, src/main/session-semaphore-manager.ts): the service reads only these. */
export interface PetSemaphoreUpdate {
  readonly ptyId: string;
  readonly state: SemaphorePublicState;
  /** #109: the turn ended with background sub-agents alive, so the session is not done yet (`toPetSemaphore`). */
  readonly awaitingBackgroundAgents?: boolean;
}

/** The watcher of full screen apps (src/main/pet/fullscreen-watcher.ts), as the service holds it. */
export interface PetFullscreenWatcher {
  stop(): void;
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
  /** FR-034 test override (`DONEL_PET_CAPTURABLE=1`): the protection against screen captures is never on. */
  readonly alwaysCapturable?: boolean;
  /**
   * Starts the watcher of apps in full screen (R10); it calls `onChange(true)` when one takes the whole screen and
   * `onChange(false)` when it gives it back. Started with the window and stopped with it. Absent = the Jobu never hides.
   */
  readonly startFullscreenWatcher?: (onChange: (active: boolean) => void) => PetFullscreenWatcher;
  /**
   * `display-added`, `display-removed` and `display-metrics-changed` of Electron's `screen` (FR-005): `listener` runs
   * when the monitors or their work areas change. Returns the way to stop listening. Absent = the place is only judged at the start.
   */
  readonly subscribeDisplays?: (listener: () => void) => () => void;
  /**
   * 016-jobu-faxina: runs the sweep the owner asked for ("Fazer faxina") and resolves with the totals the bubble says. It
   * should not reject (a failure is `failed: true`), but one that does is taken as a failure too. Absent = the item
   * of the menu does nothing.
   */
  readonly runSweep?: () => Promise<SweepBubbleSummary>;
  /** 016: opens a folder in the Explorer (the click on the bubble of the sweep). Absent = the click only dismisses the bubble. */
  readonly openFolder?: (path: string) => void;
  /**
   * notificacoes-completas: the session news of a reduction (a wait born out of sight, a failure, an exit), with the
   * Jobu on or off and whether or not a bubble could say it: the toast and the taskbar flash are the other channels.
   */
  readonly onNotices?: (events: readonly BubbleEvent[]) => void;
  /** notificacoes-completas: the number of sessions waiting for the owner, unseen, every time it changes (the taskbar badge). */
  readonly onWaitingCountChanged?: (count: number) => void;
}

export interface PetService {
  /** Applies the saved preference: opens the window when `pet.enabled`. Called once, after the main window is shown (R21). */
  start(): void;
  /** The pet window exists. */
  isEnabled(): boolean;
  /** Preferences toggle and "Esconder": saves, applies at once and tells the main window (R19). */
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
  /**
   * notificacoes-completas: the turn of a session ended in an API error (`StopFailure`), with the short reason. It comes
   * right BEFORE the semaphore update that turns the session `waiting`, so that wait is born as a `failed` event; it is
   * forgotten when the session goes back to work.
   */
  onStopFailure(ptyId: string, reason: string): void;
  /** notificacoes-completas: a click on a toast. The Donel comes to the front on that session's tab, with or without the Jobu. */
  openSession(ptyId: string): void;
  /** The account in use changed, by the panel or by the automatic switch (US4): the label, never an e-mail. */
  onAccountSwitched(label: string): void;
  /**
   * An app took the whole screen, or gave it back (the watcher of US5): no bubble is born while it lasts and the
   * window hides, to show again - without taking the focus - when the screen is free.
   */
  onFullscreenChanged(active: boolean): void;
  /** 016: the sweep is running. The menu says "Faxinando…" and a second one does not start. */
  isSweeping(): boolean;
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
  /**
   * `pet:talk` (item 18): the bubble of the conversation with the Líder opens or closes. The window grows upwards to hold
   * it (the base of the drawing stays put) and can take the keyboard while it is open, for the "você:" field.
   */
  handleTalk(open: boolean): void;
  /** t-29e1327b — `pet:talk-resize`: the owner drags the corner of the bubble of the Líder, or presses its expand button. */
  handleTalkResize(payload: PetTalkResizePayload): void;
  /** The web contents id of the pet window, or `null` with no Jobu: the bubble of the Líder lives there. */
  petWebContentsId(): number | null;
  /** `pet:context-menu`: the owner right-clicked. `at` is the click in screen DIP, or `null` for "where the pointer is". */
  handleContextMenu(at: PetPoint | null): void;
  /** What an item of the right-click menu does; the window calls it with the action of the item that was clicked. */
  handleMenuAction(action: PetMenuAction): void;
  /** `pet:drag-start`: the owner grabbed the Jobu with the pointer at `point`, in screen DIP. */
  handleDragStart(point: PetPoint): void;
  /** `pet:drag-move`: the pointer is at `point`; the window follows it. */
  handleDragMove(point: PetPoint): void;
  /** `pet:drag-end`: the owner let go at `point`; the Jobu snaps to the taskbar edge when it is close, and the place is saved. */
  handleDragEnd(point: PetPoint): void;
  /** `pet:resize-step`: one notch of Ctrl + wheel over the drawing (+1 grows, -1 shrinks). */
  handleResizeStep(direction: 1 | -1): void;
  /** The main window closed: the window and the tick go away and the service goes inert. */
  dispose(): void;
}

/** What a drag remembers from the instant the owner grabbed the Jobu. */
interface DragGrab {
  /** The pointer when it went down, in screen DIP. */
  readonly pointer: PetPoint;
  /** The base of the drawing at that moment. */
  readonly anchor: PetPoint;
  /** The monitors then: judging a drop with the same ones it was dragged over. */
  readonly displays: readonly PetDisplay[];
}

function sameRect(a: PetRect | null, b: PetRect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function createPetService(deps: PetServiceDeps): PetService {
  let disposed = false;
  let window: PetWindowHandle | null = null;
  let tickHandle: unknown = null;
  let petReady = false;
  let lastSentJson: string | null = null;
  /** The list is open on the screen (what `pet:list-open` last said): only then does losing the focus mean "close it". */
  let listOpen = false;
  /** Item 18: the bubble of the Líder is open. It does not close when the window loses the focus: Esc or a click on the Jobu does. */
  let talkOpen = false;
  /** t-29e1327b — the size of the bubble while its corner is being dragged (saved on the release); `undefined` = the saved one. */
  let talkDragSize: PetTalkSize | undefined;
  /** The last rectangle the window was asked to have, to leave it alone when nothing about it changed. */
  let appliedBounds: PetRect | null = null;
  let drag: DragGrab | null = null;
  /** US5/FR-034: the rule of when a capture may see the Jobu, and what the window was last told about it. */
  let capture: CaptureState = createCaptureState({ alwaysCapturable: deps.alwaysCapturable === true });
  let captureApplied: boolean | null = null;
  /** US5/FR-007: what the watcher last said (an app has the whole screen), and whether it is why the window is hidden. */
  let fullscreen = false;
  let hiddenForFullscreen = false;
  let fullscreenWatcher: PetFullscreenWatcher | null = null;
  let unsubscribeDisplays: (() => void) | null = null;
  /** 016: a sweep is running. Lives in the service, not in the core: it is a fact about the menu, not about what the Jobu shows. */
  let sweeping = false;

  let tabs: PetTabsPayload = { activePtyId: null, sessions: [] };
  // In front of the owner: focused and not minimized (a minimized window can keep reporting the focus). The main
  // process keeps the signal after this, from the focus, blur, minimize, restore, show and hide of the window.
  const mainAtBirth = deps.getMainWindow();
  let donelFocused = mainAtBirth !== null && mainAtBirth.isFocused() && !mainAtBirth.isMinimized();
  let ui: PetUi = { size: clampSize(deps.config().size), docked: false, align: 'center', talk: 0 };

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
  /** notificacoes-completas: the reason of the API error that ended the last turn of a tab, until it works again. */
  const failureByPty = new Map<string, string>();
  let state: PetState = createPetState();
  let lastWaitingCount = 0;

  /** The tabs of `pet:tabs` crossed with the semaphore and the pendings: what the core calls "the watched sessions". */
  function sessionsInput(): PetInput {
    const sessions: WatchedSession[] = tabs.sessions.map(({ ptyId, name }) => {
      const semaphore = semaphoreByPty.get(ptyId) ?? 'idle';
      const failure = semaphore === 'waiting' ? failureByPty.get(ptyId) : undefined;
      return {
        ptyId,
        name,
        semaphore,
        blockedKind: semaphore === 'permission' ? (pendingKindByPty.get(ptyId) ?? null) : null,
        ...(failure === undefined ? {} : { failure }),
      };
    });
    return { type: 'sessions', sessions };
  }

  function focusInput(): PetInput {
    const focus: FocusSignal = { activePtyId: tabs.activePtyId, donelFocused };
    return { type: 'focus', focus };
  }

  function reduce(...inputs: PetInput[]): void {
    const now = deps.now();
    const notices: BubbleEvent[] = [];
    for (const input of inputs) {
      const seq = state.noticeSeq;
      state = reducePet(state, input, now);
      if (state.noticeSeq !== seq) notices.push(...state.notices);
    }
    // notificacoes-completas: the other channels hear it here, with the pet on or off.
    const count = waitingCount(state);
    if (count !== lastWaitingCount) {
      lastWaitingCount = count;
      deps.onWaitingCountChanged?.(count);
    }
    if (notices.length > 0) deps.onNotices?.(notices);
  }

  /** A session that is dead and no longer has a tab is forgotten, and so is a pending kind for a tab that is gone; an update for a tab that has not been reported yet is kept. */
  function pruneSemaphores(): void {
    const listed = new Set(tabs.sessions.map((session) => session.ptyId));
    for (const [ptyId, semaphore] of semaphoreByPty) {
      if (semaphore === 'done' && !listed.has(ptyId)) semaphoreByPty.delete(ptyId);
    }
    for (const ptyId of failureByPty.keys()) {
      if (!listed.has(ptyId) && !semaphoreByPty.has(ptyId)) failureByPty.delete(ptyId);
    }
    for (const ptyId of pendingKindByPty.keys()) {
      if (!listed.has(ptyId)) pendingKindByPty.delete(ptyId);
    }
  }

  reduce(focusInput());

  /** The pet window, when there is one that can still be driven. */
  function liveWindow(): PetWindowHandle | null {
    if (disposed || window === null || window.isDestroyed()) return null;
    return window;
  }

  /** The monitors the pet can sit on: what Electron reports, or at least the primary one. */
  function allDisplays(): readonly PetDisplay[] {
    const reported = deps.getDisplays();
    return reported.length > 0 ? reported : [deps.getPrimaryDisplay()];
  }

  /** The window and the ui for the Jobu at `anchor` on `display`: with the bubble of the Líder open, room for it above his head. */
  function layoutAt(anchor: PetPoint, size: number, display: PetDisplay): { bounds: PetRect; ui: PetUi } {
    const talk = talkLayout(anchor, size, display);
    return {
      bounds: windowBoundsFor(anchor, size, talk.height, talk.width),
      ui: { size, docked: isDocked(anchor, display), align: alignFor(anchor, display), talk: talk.height, talkWidth: talk.width, talkExpanded: talk.expanded },
    };
  }

  /**
   * t-29e1327b — the bubble of the Líder at `anchor`: the size the owner chose (being dragged, or saved), fitted to that
   * screen; automatic without one. `expanded` = as large as the screen allows there. Closed = height 0.
   */
  function talkLayout(anchor: PetPoint, size: number, display: PetDisplay): { height: number; width: number; expanded: boolean } {
    if (!talkOpen) return { height: 0, width: talkWidthFor(display), expanded: false };
    const chosen = talkDragSize ?? deps.config().talkSize ?? null;
    const height = talkHeightFor(anchor, size, display, chosen?.height);
    const width = talkWidthFor(display, chosen?.width);
    const expanded = chosen !== null && width >= talkMaxWidthFor(display) && height >= talkHeightFor(anchor, size, display, Number.MAX_SAFE_INTEGER);
    return { height, width, expanded };
  }

  /** Where the pet sits and how it looks around there: the remembered anchor if it is still on a screen, else the corner. */
  function resolvePlacement(prefs: PetPrefs): { anchor: PetPoint; display: PetDisplay; bounds: PetRect; ui: PetUi } {
    const primary = deps.getPrimaryDisplay();
    const displays = allDisplays();
    const size = clampSize(prefs.size);
    const remembered = prefs.placement !== null && isPlacementVisible(prefs.placement, size, displays) ? prefs.placement : null;
    const anchor = remembered ?? defaultPlacement(primary, size);
    const display = displayNearestPoint(displays, anchor) ?? primary;
    return { anchor, display, ...layoutAt(anchor, size, display) };
  }

  /** What the window can do with the keyboard: it takes it while the list or the bubble is open, and only then. */
  function syncFocusable(takeFocus: boolean): void {
    const current = liveWindow();
    if (current === null) return;
    current.setFocusable(listOpen || talkOpen, takeFocus);
  }

  /** Item 18: opens or closes the bubble of the Líder; the window grows or shrinks around the base of the drawing. */
  function setTalk(open: boolean): void {
    if (liveWindow() === null || open === talkOpen) return;
    talkOpen = open;
    // The bubble of the Líder says everything the little bubble would: that one goes.
    if (open) feed({ type: 'bubbleDismissed' });
    syncFocusable(open);
    if (drag === null) relayout();
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

  /** Gives the window a new rectangle (the whole of it, always: see the note at the top) and remembers it. */
  function place(bounds: PetRect): void {
    if (window === null || window.isDestroyed()) return;
    window.applyBounds(bounds);
    appliedBounds = bounds;
  }

  /**
   * Works out where the window belongs from the saved preferences and moves it there if that is not where it
   * is: after a new size, "Voltar ao canto" or a change of the monitors. A remembered place that no screen
   * shows any more (FR-005) puts the Jobu in the corner for as long as that lasts, and is NOT forgotten: when the
   * monitor comes back, so does he.
   */
  function relayout(): void {
    if (window === null || window.isDestroyed()) return;
    const placed = resolvePlacement(deps.config());
    ui = placed.ui;
    if (!sameRect(appliedBounds, placed.bounds)) place(placed.bounds);
    pushView(false);
  }

  /** FR-034: tells the window whether a capture may see it, only when the answer changed. */
  function applyCapture(): void {
    if (window === null || window.isDestroyed()) return;
    const allowed = captureAllowed(capture, deps.now());
    if (allowed === captureApplied) return;
    captureApplied = allowed;
    window.setCaptureAllowed(allowed);
  }

  function stopTick(): void {
    if (tickHandle === null) return;
    deps.clearInterval(tickHandle);
    tickHandle = null;
  }

  /** The watcher of full screen and the listener of the monitors live exactly as long as the window does. */
  function releaseWatchers(): void {
    fullscreenWatcher?.stop();
    fullscreenWatcher = null;
    unsubscribeDisplays?.();
    unsubscribeDisplays = null;
  }

  /** Hides the window while an app has the whole screen and brings it back, without the focus, when the screen is free. */
  function syncVisibility(): void {
    if (window === null || window.isDestroyed() || !petReady) return;
    if (fullscreen && !hiddenForFullscreen) {
      hiddenForFullscreen = true;
      window.hide();
    } else if (!fullscreen && hiddenForFullscreen) {
      hiddenForFullscreen = false;
      window.showInactive();
    }
  }

  function onFullscreenChanged(active: boolean): void {
    if (disposed) return;
    fullscreen = active;
    feed({ type: 'fullscreen', active });
    syncVisibility();
  }

  function onDisplaysChanged(): void {
    // A change of the monitors while the owner holds the Jobu must not take him out of the hand: the drop judges it.
    if (disposed || drag !== null) return;
    relayout();
  }

  function onTick(): void {
    feed({ type: 'tick' });
    applyCapture(); // the end of "Liberar print por 1 minuto" is noticed here, like the end of the bubble
  }

  function resetWindowState(): void {
    petReady = false;
    lastSentJson = null;
    listOpen = false;
    talkOpen = false;
    appliedBounds = null;
    drag = null;
    captureApplied = null;
    fullscreen = false;
    hiddenForFullscreen = false;
  }

  function enable(): void {
    if (disposed || window !== null) return;
    const placement = resolvePlacement(deps.config());
    ui = placement.ui;
    const allowedNow = captureAllowed(capture, deps.now());
    let created: PetWindowHandle;
    try {
      created = deps.createWindow({
        bounds: placement.bounds,
        captureAllowed: allowedNow,
        onClosed: () => {
          // The window went away by itself. A "closed" that arrives late, from a window this service
          // already replaced, must not touch the new one.
          if (window !== created) return;
          window = null;
          resetWindowState();
          stopTick();
          releaseWatchers();
          // The screen mutes the toasts while the pet is on (R8): it must not go on muting with no Jobu on the
          // screen. Only told, never saved - on app exit the order the windows close in is not guaranteed.
          if (!disposed) notifyPrefsChanged(false);
        },
        // Same guard: a blur that arrives late, from a window this service already replaced, is not news.
        onBlur: () => {
          if (window === created) closeListOnBlur();
        },
      });
    } catch (error) {
      // The pet is a convenience: failing to open it never takes the app with it.
      console.error('[donel-dev] a janela do Jobu não abriu:', error);
      notifyPrefsChanged(false); // same reason as `onClosed`: no window, so the screen stops muting the toasts
      return;
    }
    window = created;
    resetWindowState();
    appliedBounds = placement.bounds;
    captureApplied = allowedNow;
    // The core had no clock while the pet was off: its timed parts start from now.
    reduce({ type: 'resume' });
    tickHandle = deps.setInterval(onTick, PET_TICK_MS);
    unsubscribeDisplays = deps.subscribeDisplays?.(onDisplaysChanged) ?? null;
    fullscreenWatcher = deps.startFullscreenWatcher?.(onFullscreenChanged) ?? null;
  }

  function disable(): void {
    stopTick();
    releaseWatchers();
    const closing = window;
    window = null;
    resetWindowState();
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
    // The bubble of the Líder, if open, stays: the window stays focusable for it, without grabbing the keyboard back.
    window.setFocusable(talkOpen, false);
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
    // The target is about to be the active tab. Raising the window fires its 'focus' event at once, and that
    // event would be judged against the OLD active tab, marking it as seen without the owner ever looking at it.
    // So the target is taken as the active tab first; the real `pet:tabs` that follows confirms or corrects it.
    if (target.kind === 'session' && tabs.sessions.some((session) => session.ptyId === target.ptyId)) {
      tabs = { ...tabs, activePtyId: target.ptyId };
    }
    bringMainWindowToFront(main);
    if (target.kind === 'session') main.webContents.send(PET_CHANNELS.activateSession, { ptyId: target.ptyId });
  }

  function notifyPrefsChanged(enabled: boolean): void {
    const main = deps.getMainWindow();
    if (main === null || main.isDestroyed()) return;
    main.webContents.send(PET_CHANNELS.prefsChanged, { enabled });
  }

  function applyEnabled(enabled: boolean): void {
    if (disposed) return;
    const current = deps.config();
    const changed = current.enabled !== enabled;
    if (changed) deps.persist({ ...current, enabled });
    if (enabled) enable();
    else disable();
    // A failed `enable()` has already told the screen "off": saying "on" afterwards would undo it.
    if (changed && !(enabled && window === null)) notifyPrefsChanged(enabled);
  }

  /** FR-033: a new size (Ctrl + wheel or a preset of the menu): kept inside 80-320, saved, and the window grows from the base. */
  function setSize(requested: number): void {
    if (liveWindow() === null || drag !== null) return; // mid-gesture the drop judges the place, not a relayout
    const size = clampSize(requested);
    const current = deps.config();
    if (size === clampSize(current.size)) return;
    deps.persist({ ...current, size });
    relayout();
  }

  /** "Voltar ao canto": the place is forgotten and the Jobu goes to the corner again. */
  function goHome(): void {
    if (liveWindow() === null || drag !== null) return;
    const current = deps.config();
    if (current.placement !== null) deps.persist({ ...current, placement: null });
    relayout();
  }

  /**
   * "Fazer faxina" (016): runs the sweep once at a time and turns its result into the bubble. The menu reads `sweeping`
   * every time it opens, so the item says "Faxinando…" for as long as this lasts.
   */
  function startSweep(): void {
    if (sweeping || deps.runSweep === undefined) return;
    sweeping = true;
    feed({ type: 'sweepStarted', at: deps.now() });
    const finish = (summary: SweepBubbleSummary): void => {
      sweeping = false;
      if (disposed) return;
      feed({ type: 'sweepFinished', summary, at: deps.now() });
    };
    const failure: SweepBubbleSummary = { failed: true, freedBytes: 0, separatedItems: 0, branchesDeleted: 0, worktreesRemoved: 0, folder: null };
    let started: Promise<SweepBubbleSummary>;
    try {
      started = deps.runSweep();
    } catch (error) {
      console.error('[donel-dev] a faxina não começou:', error);
      finish(failure);
      return;
    }
    started.then(finish, (error: unknown) => {
      console.error('[donel-dev] a faxina falhou:', error);
      finish(failure);
    });
  }

  /**
   * A click on the bubble of a sweep: the Explorer opens the folder of the bubble the MAIN holds. The window sends the
   * path along (it is the type of its bubble), but a path that came from a window is never what gets opened.
   */
  function openSweepFolder(): void {
    const target = state.bubble?.target;
    feed({ type: 'bubbleDismissed' });
    if (target !== undefined && target.kind === 'folder') deps.openFolder?.(target.path);
  }

  /** What each item of the right-click menu does. */
  function menuAction(action: PetMenuAction): void {
    if (liveWindow() === null) return; // the menu outlived the window (the Preferences turned the pet off while it was open)
    switch (action.kind) {
      case 'silence':
        feed({ type: 'silence', until: deps.now() + PET_SILENCE_MS });
        break;
      case 'resume':
        feed({ type: 'silence', until: null });
        break;
      case 'releaseCapture':
        capture = releaseCapture(capture, deps.now());
        applyCapture();
        break;
      case 'blockCapture':
        capture = blockCapture(capture);
        applyCapture();
        break;
      case 'size':
        setSize(action.size);
        break;
      case 'sweep':
        startSweep();
        break;
      case 'home':
        goHome();
        break;
      case 'lider':
        setTalk(!talkOpen);
        break;
      case 'hide':
        // The same road as the toggle of the Preferences: it saves `pet.enabled = false`, destroys the window and tells the main window.
        applyEnabled(false);
        break;
      default:
        assertNever(action);
    }
  }

  return {
    start() {
      if (deps.config().enabled) enable();
    },

    isEnabled() {
      return window !== null;
    },

    setEnabled: applyEnabled,

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
      const next = toPetSemaphore(update.state, update.awaitingBackgroundAgents === true, failureByPty.has(update.ptyId));
      if (next !== 'permission') pendingKindByPty.delete(update.ptyId); // the pending is over, or never was one
      if (next !== 'waiting' && next !== 'permission') failureByPty.delete(update.ptyId); // back to work (or gone): the failure is over
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
      failureByPty.delete(ptyId);
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

    onStopFailure(ptyId, reason) {
      if (disposed) return;
      failureByPty.set(ptyId, reason);
    },

    openSession(ptyId) {
      if (disposed) return;
      openTarget({ kind: 'session', ptyId });
    },

    onAccountSwitched(label) {
      if (disposed) return;
      feed({ type: 'accountSwitched', label, at: deps.now() });
    },

    isSweeping() {
      return sweeping;
    },

    onFullscreenChanged,

    isPetSender(sender) {
      return window !== null && sender.id === window.webContentsId;
    },

    handleReady() {
      if (disposed || window === null) return;
      petReady = true;
      pushView(true);
      // An app that has the whole screen when the screen of the pet comes up: the window stays hidden and shows when it is free.
      if (fullscreen) hiddenForFullscreen = true;
      else window.showInactive();
    },

    handleInteractive(interactive) {
      const current = liveWindow();
      if (current === null) return;
      current.setInteractive(interactive);
    },

    handleClick() {
      if (liveWindow() === null) return;
      const decision = decideClick(currentView());
      if (decision.kind !== 'list') openTarget(decision);
    },

    handleOpen(target) {
      if (liveWindow() === null) return;
      if (target.kind === 'folder') {
        openSweepFolder();
        return;
      }
      openTarget(target);
    },

    handleListOpen(open) {
      const current = liveWindow();
      if (current === null) return;
      listOpen = open;
      syncFocusable(open);
      // The click that opens the list also serves the bubble (Q17); nothing else reaches the main for it.
      if (open) feed({ type: 'bubbleDismissed' });
    },

    handleTalk(open) {
      talkDragSize = undefined;
      setTalk(open);
    },

    handleTalkResize(payload) {
      if (liveWindow() === null || !talkOpen || drag !== null) return;
      const current = deps.config();
      if (payload.kind === 'set') {
        const placed = resolvePlacement(current);
        // Fitted to the screen right away, so what is saved is what the owner saw at the release.
        const next: PetTalkSize = {
          width: talkWidthFor(placed.display, payload.width),
          height: talkHeightFor(placed.anchor, placed.ui.size, placed.display, payload.height),
        };
        if (payload.commit) {
          talkDragSize = undefined;
          deps.persist({ ...current, talkSize: next });
        } else {
          talkDragSize = next;
        }
        relayout();
        return;
      }
      // The expand button: the largest the screen allows above the Jobu, or back to automatic when it already is.
      talkDragSize = undefined;
      const placed = resolvePlacement(current);
      if (placed.ui.talkExpanded === true) {
        deps.persist({ ...current, talkSize: null });
      } else {
        const height = talkHeightFor(placed.anchor, placed.ui.size, placed.display, Number.MAX_SAFE_INTEGER);
        deps.persist({ ...current, talkSize: { width: talkMaxWidthFor(placed.display), height } });
      }
      relayout();
    },

    petWebContentsId() {
      return liveWindow()?.webContentsId ?? null;
    },

    handleContextMenu(at) {
      const current = liveWindow();
      if (current === null) return;
      const now = deps.now();
      current.popupMenu(buildPetMenu({ silenced: isSilenced(state, now), captureReleased: captureReleased(capture, now), size: ui.size, sweeping }), menuAction, at);
    },

    handleMenuAction: menuAction,

    handleDragStart(point) {
      if (liveWindow() === null) return;
      drag = { pointer: point, anchor: resolvePlacement(deps.config()).anchor, displays: allDisplays() };
    },

    handleDragMove(point) {
      if (liveWindow() === null || drag === null) return;
      const anchor = dragAnchor(drag.anchor, drag.pointer, point);
      const display = displayNearestPoint(drag.displays, anchor) ?? deps.getPrimaryDisplay();
      // The base fades the moment it leaves the taskbar edge, and the bubble re-anchors as he crosses the screen (with
      // the bubble of the Líder open, it goes along and fits what is above his head there).
      const laid = layoutAt(anchor, ui.size, display);
      ui = laid.ui;
      place(laid.bounds);
      pushView(false);
    },

    handleDragEnd(point) {
      if (liveWindow() === null || drag === null) return;
      const grab = drag;
      drag = null;
      const outcome = settleDrop(dragAnchor(grab.anchor, grab.pointer, point), grab.anchor, ui.size, grab.displays);
      const display = displayNearestPoint(grab.displays, outcome.anchor) ?? deps.getPrimaryDisplay();
      const talk = talkLayout(outcome.anchor, ui.size, display);
      ui = { size: ui.size, docked: outcome.docked, align: outcome.align, talk: talk.height, talkWidth: talk.width, talkExpanded: talk.expanded };
      place(windowBoundsFor(outcome.anchor, ui.size, talk.height, talk.width));
      // A drop that left less than half of the drawing on a screen was refused: he is back where he was and nothing is saved.
      if (outcome.accepted) deps.persist({ ...deps.config(), placement: outcome.anchor });
      pushView(false);
    },

    handleResizeStep(direction) {
      if (liveWindow() === null) return;
      setSize(stepSize(deps.config().size, direction));
    },

    dispose() {
      disposed = true;
      disable();
    },
  };
}
