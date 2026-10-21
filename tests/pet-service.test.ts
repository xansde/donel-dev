// T020/T027 (015-jobu-pet) - the pet service in the main, with every dependency faked: the window, the
// screen, the clock, the timer, the config and the main window. What it must guarantee here:
// with `pet.enabled = false` the app is the one of before (no window, no timer); with `true` there
// is exactly one window and one 1 s tick, both gone on disable and on dispose; the view goes out
// only when it changes; the main window is told whenever `pet.enabled` changes (R19); and what the
// tabs, the focus, the semaphore and the clock say turns into the face the owner sees (US1), the bubble
// of what happens (US2) and where a click leads (US3).
import { describe, expect, it } from 'vitest';
import type { PetPrefs } from '../src/shared/config';
import { PET_BUBBLE_MS } from '../src/shared/pet/bubble';
import { PET_CHANNELS } from '../src/shared/pet/ipc';
import { alignFor, anchorOf, defaultPlacement, windowBoundsFor } from '../src/shared/pet/placement';
import type { PetDisplay, PetPoint, PetRect, PetView, SemaphorePublicState } from '../src/shared/pet/types';
import {
  PET_TICK_MS,
  createPetService,
  type CreatePetWindowOptions,
  type PetMainWindowLike,
  type PetServiceDeps,
  type PetWindowHandle,
} from '../src/main/pet/pet-service';

const PRIMARY: PetDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const SECOND: PetDisplay = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.25,
};

class FakePetWindow implements PetWindowHandle {
  destroyed = false;
  readonly views: PetView[] = [];
  shown = 0;
  hidden = 0;
  readonly interactive: boolean[] = [];
  readonly listOpen: boolean[] = [];
  readonly moves: PetPoint[] = [];
  readonly bounds: PetRect[] = [];
  constructor(
    readonly webContentsId: number,
    readonly options: CreatePetWindowOptions,
  ) {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
  sendView(view: PetView): void {
    this.views.push(view);
  }
  showInactive(): void {
    this.shown += 1;
  }
  hide(): void {
    this.hidden += 1;
  }
  setInteractive(interactive: boolean): void {
    this.interactive.push(interactive);
  }
  setListOpen(open: boolean): void {
    this.listOpen.push(open);
  }
  moveTo(point: PetPoint): void {
    this.moves.push(point);
  }
  applyBounds(bounds: PetRect): void {
    this.bounds.push(bounds);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

interface FakeTimer {
  readonly id: number;
  readonly callback: () => void;
  readonly ms: number;
  cleared: boolean;
}

interface Harness {
  readonly deps: PetServiceDeps;
  readonly windows: FakePetWindow[];
  readonly timers: FakeTimer[];
  readonly persisted: PetPrefs[];
  readonly mainSent: { channel: string; payload: unknown }[];
  /** The main window: what it is, and what the service did to it (`calls`, in order). `focusWorks = false` is the foreground lock refusing the focus. */
  readonly main: { focused: boolean; destroyed: boolean; minimized: boolean; focusWorks: boolean; readonly calls: string[] };
  prefs: PetPrefs;
  clock: { now: number };
  /** Runs every live timer once, like a second passing. */
  tickAll(): void;
  liveTimers(): FakeTimer[];
  liveWindows(): FakePetWindow[];
}

function harness(over: { prefs?: Partial<PetPrefs>; displays?: readonly PetDisplay[]; withMain?: boolean; createWindowThrows?: boolean } = {}): Harness {
  const windows: FakePetWindow[] = [];
  const timers: FakeTimer[] = [];
  const persisted: PetPrefs[] = [];
  const mainSent: { channel: string; payload: unknown }[] = [];
  const main = { focused: false, destroyed: false, minimized: false, focusWorks: true, calls: [] as string[] };
  const clock = { now: 1_000_000 };
  const state = { prefs: { enabled: false, placement: null, size: 140, ...over.prefs } as PetPrefs };
  const displays = over.displays ?? [PRIMARY];

  const mainWindow: PetMainWindowLike = {
    isDestroyed: () => main.destroyed,
    isFocused: () => main.focused,
    isMinimized: () => main.minimized,
    restore: () => {
      main.calls.push('restore');
      main.minimized = false;
    },
    show: () => void main.calls.push('show'),
    focus: () => {
      main.calls.push('focus');
      if (main.focusWorks) main.focused = true;
    },
    setAlwaysOnTop: (flag: boolean) => void main.calls.push(`alwaysOnTop:${flag}`),
    webContents: { send: (channel: string, payload: unknown) => void mainSent.push({ channel, payload }) },
  };

  const deps: PetServiceDeps = {
    getMainWindow: () => (over.withMain === false ? null : mainWindow),
    config: () => state.prefs,
    persist: (next) => {
      state.prefs = next;
      persisted.push(next);
    },
    createWindow: (options) => {
      if (over.createWindowThrows === true) throw new Error('boom');
      const window = new FakePetWindow(100 + windows.length, options);
      windows.push(window);
      return window;
    },
    getDisplays: () => displays,
    getPrimaryDisplay: () => displays[0] ?? PRIMARY,
    now: () => clock.now,
    setInterval: (callback, ms) => {
      const timer: FakeTimer = { id: timers.length + 1, callback, ms, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearInterval: (handle) => {
      const timer = timers.find((candidate) => candidate.id === handle);
      if (timer !== undefined) timer.cleared = true;
    },
  };

  return {
    deps,
    windows,
    timers,
    persisted,
    mainSent,
    main,
    get prefs() {
      return state.prefs;
    },
    set prefs(value: PetPrefs) {
      state.prefs = value;
    },
    clock,
    tickAll: () => {
      for (const timer of timers.filter((candidate) => !candidate.cleared)) timer.callback();
    },
    liveTimers: () => timers.filter((timer) => !timer.cleared),
    liveWindows: () => windows.filter((window) => !window.destroyed),
  };
}

const prefsChanged = (h: Harness) => h.mainSent.filter((entry) => entry.channel === PET_CHANNELS.prefsChanged);
const activations = (h: Harness) => h.mainSent.filter((entry) => entry.channel === PET_CHANNELS.activateSession).map((entry) => entry.payload);

const SEC = 1000;
const MIN = 60 * SEC;
const sem = (ptyId: string, state: SemaphorePublicState) => ({ ptyId, state });
const tab = (ptyId: string, name = ptyId) => ({ ptyId, name });
/** The last view the pet window received. */
const lastView = (h: Harness): PetView => {
  const views = h.windows[h.windows.length - 1]?.views ?? [];
  const view = views[views.length - 1];
  if (view === undefined) throw new Error('the pet window received no view');
  return view;
};
/** A pet that is on, with its screen ready: the state every story below starts from. */
function readyPet(over: Parameters<typeof harness>[0] = {}) {
  const h = harness({ prefs: { enabled: true }, ...over });
  const service = createPetService(h.deps);
  service.start();
  service.handleReady();
  return { h, service };
}

describe('with pet.enabled = false (the default): the app is the one of before', () => {
  it('creating the service makes no window and no timer', () => {
    const h = harness({ prefs: { enabled: false } });
    createPetService(h.deps);
    expect(h.windows).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
  });

  it('start() makes no window and no timer either', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    expect(h.windows).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
    expect(service.isEnabled()).toBe(false);
  });

  it('signals that arrive while it is off create nothing and send nothing', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: 'a', sessions: [{ ptyId: 'a', name: 'atlas' }] });
    service.onMainFocusChanged(true);
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSessionRegistered('a');
    service.onSessionExited('a', false);
    h.tickAll();
    expect(h.windows).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
    expect(h.mainSent).toHaveLength(0);
    expect(h.persisted).toHaveLength(0);
  });
});

describe('with pet.enabled = true', () => {
  it('creating the service alone has no side effect: it only starts on start()', () => {
    const h = harness({ prefs: { enabled: true } });
    createPetService(h.deps);
    expect(h.windows).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
  });

  it('start() creates exactly one window and one 1 s tick', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    expect(h.windows).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.ms).toBe(PET_TICK_MS);
    expect(PET_TICK_MS).toBe(1000);
    expect(service.isEnabled()).toBe(true);
  });

  it('start() twice does not make a second window or timer', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.start();
    expect(h.windows).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
  });

  it('opens at the default corner when nothing was remembered', () => {
    const h = harness({ prefs: { enabled: true } });
    createPetService(h.deps).start();
    expect(h.windows[0]?.options.bounds).toEqual(windowBoundsFor(defaultPlacement(PRIMARY, 140), 140));
  });

  it('opens at the remembered anchor, with the remembered size', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 900, y: 700 }, size: 200 } });
    createPetService(h.deps).start();
    expect(h.windows[0]?.options.bounds).toEqual(windowBoundsFor({ x: 900, y: 700 }, 200));
  });

  it('a remembered anchor that is no longer on any screen goes back to the default corner (FR-005)', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 9000, y: 9000 }, size: 140 } });
    createPetService(h.deps).start();
    expect(h.windows[0]?.options.bounds).toEqual(windowBoundsFor(defaultPlacement(PRIMARY, 140), 140));
  });

  it('a remembered anchor on the second monitor is kept while that monitor is there', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 3000, y: 800 } }, displays: [PRIMARY, SECOND] });
    createPetService(h.deps).start();
    expect(h.windows[0]?.options.bounds).toEqual(windowBoundsFor({ x: 3000, y: 800 }, 140));
  });

  it('an absurd size in the config is clamped before it sizes the window', () => {
    const h = harness({ prefs: { enabled: true, size: 5000 } });
    createPetService(h.deps).start();
    expect(h.windows[0]?.options.bounds.height).toBe(320 + 200);
  });

  it('the window is created hidden of any view: nothing is sent and nothing is shown before pet:ready', () => {
    const h = harness({ prefs: { enabled: true } });
    createPetService(h.deps).start();
    h.tickAll();
    expect(h.windows[0]?.views).toHaveLength(0);
    expect(h.windows[0]?.shown).toBe(0);
  });
});

describe('pet:ready handshake and the view', () => {
  it('answers pet:ready with the current view and only then shows the window, without taking focus', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    const window = h.windows[0]!;
    expect(window.views).toHaveLength(1);
    expect(window.shown).toBe(1);
  });

  it('with no session the first view is asleep, with no badge, no bubble and nobody waiting', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    expect(h.windows[0]?.views[0]).toMatchObject({ pose: 'sleeping', badge: null, bubble: null, waiting: [], silenced: false, size: 140 });
  });

  it('the view carries size, docked and align from the placement: default corner = docked and right-aligned', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    expect(h.windows[0]?.views[0]).toMatchObject({ docked: true, align: 'right', size: 140 });
  });

  it('floating in the middle of the screen: not docked, centered', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 960, y: 500 }, size: 260 } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    expect(h.windows[0]?.views[0]).toMatchObject({ docked: false, align: 'center', size: 260 });
  });

  it('align follows the display the anchor is on', () => {
    const anchor = { x: 1920 + 100, y: 1400 };
    const h = harness({ prefs: { enabled: true, placement: anchor }, displays: [PRIMARY, SECOND] });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    expect(h.windows[0]?.views[0]?.align).toBe(alignFor(anchor, SECOND));
    expect(h.windows[0]?.views[0]?.align).toBe('left');
    expect(h.windows[0]?.views[0]?.docked).toBe(true);
  });

  it('the tick sends the view only when it changed: a quiet minute is silent', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    for (let i = 0; i < 60; i += 1) h.tickAll();
    expect(h.windows[0]?.views).toHaveLength(1);
  });

  it('sends again when the view changes, and only then', () => {
    const { h, service } = readyPet();
    h.tickAll();
    expect(h.windows[0]?.views).toHaveLength(1);
    service.onTabs({ activePtyId: null, sessions: [tab('a')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    h.tickAll();
    h.tickAll();
    expect(h.windows[0]?.views.map((view) => view.pose)).toEqual(['sleeping', 'incense', 'reading']);
  });

  it('a second pet:ready (the screen reloaded) answers with the view again', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    service.handleReady();
    expect(h.windows[0]?.views).toHaveLength(2);
  });

  it('pet:ready with no window is ignored', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    expect(() => service.handleReady()).not.toThrow();
    expect(h.windows).toHaveLength(0);
  });

  it('the view is made of the tabs, the focus, the clock and the placement together', () => {
    const { h, service } = readyPet();
    service.onMainFocusChanged(true);
    service.onTabs({ activePtyId: 'pty-a', sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-b', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting')); // the owner is on this tab: born seen
    service.onSemaphoreUpdate(sem('pty-b', 'waiting')); // not on this one: it counts
    h.clock.now += 90 * SEC;
    h.tickAll();
    const view = lastView(h);
    expect(view.waiting).toEqual([{ ptyId: 'pty-b', name: 'beacon', waitingLabel: 'há 1 min' }]);
    expect(view).toMatchObject({ pose: 'impatient', badge: '1', size: 140, docked: true, align: 'right' });
  });

  it('tabs and signals received while the pet was off are used as soon as it is turned on', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [tab('pty-a', 'atlas')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    service.setEnabled(true);
    service.handleReady();
    expect(lastView(h)).toMatchObject({ pose: 'impatient', badge: '1' });
    expect(lastView(h).waiting.map((entry) => entry.name)).toEqual(['atlas']);
  });

  it('a wait that began while the pet was off keeps its real age when the pet is turned on', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [tab('pty-a', 'atlas')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    h.clock.now += 11 * MIN;
    service.setEnabled(true);
    service.handleReady();
    expect(lastView(h).waiting[0]?.waitingLabel).toBe('há 11 min');
    expect(lastView(h).pose).toBe('very-impatient');
  });

  it('the serene hours the pet spent off do not become a waffle the moment it is turned on', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [tab('pty-a')] });
    h.clock.now += 3 * 60 * MIN;
    service.setEnabled(true);
    service.handleReady();
    h.tickAll();
    expect(lastView(h).pose).toBe('incense');
  });

  it('the focus state starts from the main window as it is when the service is born', () => {
    const h = harness({ prefs: { enabled: true } });
    h.main.focused = true;
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    service.onTabs({ activePtyId: 'pty-a', sessions: [tab('pty-a')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    // the owner is on the tab with the Donel focused from the start: the wait is born seen
    expect(lastView(h)).toMatchObject({ badge: null, pose: 'incense' });
  });

  it('a focus change re-evaluates the view without waiting for the tick', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: 'pty-a', sessions: [tab('pty-a', 'atlas')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    expect(lastView(h)).toMatchObject({ badge: '1', pose: 'calling' }); // the bubble of the turn that ended is in front of the face
    service.onMainFocusChanged(true); // the owner comes back to the Donel, with the tab already in front
    expect(lastView(h)).toMatchObject({ badge: null, pose: 'laughing', bubble: null });
    expect(h.windows[0]?.views.map((view) => view.pose)).toEqual(['sleeping', 'incense', 'reading', 'calling', 'laughing']);
  });
});

describe('setEnabled (Preferences toggle, and "Esconder" later): applies at once, no restart', () => {
  it('turning on persists, opens the window and the tick, and tells the main window', () => {
    const h = harness({ prefs: { enabled: false, placement: { x: 5, y: 6 }, size: 200 } });
    const service = createPetService(h.deps);
    service.start();
    service.setEnabled(true);
    expect(h.persisted).toEqual([{ enabled: true, placement: { x: 5, y: 6 }, size: 200 }]);
    expect(h.liveWindows()).toHaveLength(1);
    expect(h.liveTimers()).toHaveLength(1);
    expect(service.isEnabled()).toBe(true);
    expect(prefsChanged(h)).toEqual([{ channel: 'pet:prefs-changed', payload: { enabled: true } }]);
  });

  it('turning off persists, destroys the window, stops the tick, and tells the main window', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.setEnabled(false);
    expect(h.persisted).toEqual([{ enabled: false, placement: null, size: 140 }]);
    expect(h.liveWindows()).toHaveLength(0);
    expect(h.liveTimers()).toHaveLength(0);
    expect(service.isEnabled()).toBe(false);
    expect(prefsChanged(h)).toEqual([{ channel: 'pet:prefs-changed', payload: { enabled: false } }]);
  });

  it('turning on again leaves exactly one live window and one live tick', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.setEnabled(true);
    service.setEnabled(false);
    service.setEnabled(true);
    service.setEnabled(true);
    expect(h.liveWindows()).toHaveLength(1);
    expect(h.liveTimers()).toHaveLength(1);
    expect(h.windows).toHaveLength(2);
  });

  it('the new window of a second round answers its own pet:ready with a fresh view', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    service.setEnabled(false);
    service.setEnabled(true);
    service.handleReady();
    expect(h.windows).toHaveLength(2);
    expect(h.windows[1]?.views).toHaveLength(1);
    expect(h.windows[1]?.shown).toBe(1);
  });

  it('the same value again does not persist or notify, and does not open a second window', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.setEnabled(true);
    expect(h.persisted).toHaveLength(0);
    expect(prefsChanged(h)).toHaveLength(0);
    expect(h.windows).toHaveLength(1);
    expect(h.timers).toHaveLength(1);

    const off = harness({ prefs: { enabled: false } });
    const offService = createPetService(off.deps);
    offService.start();
    offService.setEnabled(false);
    expect(off.persisted).toHaveLength(0);
    expect(prefsChanged(off)).toHaveLength(0);
  });

  it('keeps the remembered placement and size across a toggle', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 900, y: 700 }, size: 200 } });
    const service = createPetService(h.deps);
    service.start();
    service.setEnabled(false);
    service.setEnabled(true);
    expect(h.prefs).toEqual({ enabled: true, placement: { x: 900, y: 700 }, size: 200 });
    expect(h.windows[1]?.options.bounds).toEqual(windowBoundsFor({ x: 900, y: 700 }, 200));
  });

  it('does not touch the main window when there is none, or when it is already destroyed', () => {
    const noMain = harness({ prefs: { enabled: false }, withMain: false });
    const service = createPetService(noMain.deps);
    expect(() => service.setEnabled(true)).not.toThrow();
    expect(noMain.mainSent).toHaveLength(0);

    const gone = harness({ prefs: { enabled: false } });
    gone.main.destroyed = true;
    createPetService(gone.deps).setEnabled(true);
    expect(gone.mainSent).toHaveLength(0);
  });

  it('a window that fails to open does not break the toggle: no window, no tick, the app goes on', () => {
    const h = harness({ prefs: { enabled: false }, createWindowThrows: true });
    const service = createPetService(h.deps);
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      expect(() => service.setEnabled(true)).not.toThrow();
    } finally {
      console.error = originalError;
    }
    expect(h.liveTimers()).toHaveLength(0);
    expect(service.isEnabled()).toBe(false);
    expect(logged).toHaveLength(1); // the failure is reported, not swallowed
  });
});

describe('dispose (the main window closed)', () => {
  it('destroys the window and stops the tick', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.dispose();
    expect(h.liveWindows()).toHaveLength(0);
    expect(h.liveTimers()).toHaveLength(0);
    expect(service.isEnabled()).toBe(false);
  });

  it('after it, nothing opens again and nothing is sent', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    service.dispose();
    service.setEnabled(true);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [] });
    service.handleReady();
    expect(h.windows).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
    expect(h.mainSent).toHaveLength(0);
  });

  it('is harmless when the pet was never on, and when called twice', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.dispose();
    expect(() => service.dispose()).not.toThrow();
    expect(h.windows).toHaveLength(0);
  });
});

describe('the window going away on its own', () => {
  it('stops the tick and frees the handle; turning it on again opens a new one', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    const first = h.windows[0]!;
    first.destroyed = true;
    first.options.onClosed();
    expect(h.liveTimers()).toHaveLength(0);
    expect(service.isEnabled()).toBe(false);

    service.setEnabled(false);
    service.setEnabled(true);
    expect(h.liveWindows()).toHaveLength(1);
    expect(h.liveTimers()).toHaveLength(1);
  });

  it('the late "closed" of a window we replaced does not touch the new one', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.start();
    const first = h.windows[0]!;
    service.setEnabled(false);
    service.setEnabled(true);
    first.options.onClosed();
    expect(service.isEnabled()).toBe(true);
    expect(h.liveTimers()).toHaveLength(1);
    expect(h.liveWindows()).toHaveLength(1);
  });
});

describe('gestures from the pet window', () => {
  it('isPetSender recognizes only the live pet window', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    expect(service.isPetSender({ id: 100 })).toBe(false);
    service.start();
    expect(service.isPetSender({ id: 100 })).toBe(true);
    expect(service.isPetSender({ id: 999 })).toBe(false);
    service.setEnabled(false);
    expect(service.isPetSender({ id: 100 })).toBe(false);
  });

  it('pet:interactive is forwarded to the window as is, and only when there is one', () => {
    const h = harness({ prefs: { enabled: true } });
    const service = createPetService(h.deps);
    service.handleInteractive(true);
    service.start();
    service.handleInteractive(true);
    service.handleInteractive(false);
    expect(h.windows[0]?.interactive).toEqual([true, false]);
  });

  it('the window is born ignoring the mouse: interactivity is only ever asked for explicitly', () => {
    const h = harness({ prefs: { enabled: true } });
    createPetService(h.deps).start();
    // nothing is told to the window until the screen asks (the real window defaults to click-through)
    expect(h.windows[0]?.interactive).toEqual([]);
  });
});

describe('the anchor round trip the service relies on', () => {
  it('the window it opens has the anchor at its bottom center', () => {
    const h = harness({ prefs: { enabled: true, placement: { x: 1000, y: 800 } } });
    createPetService(h.deps).start();
    expect(anchorOf(h.windows[0]!.options.bounds, 140)).toEqual({ x: 1000, y: 800 });
  });
});

describe('the events of the main become the bubble (US2, T032)', () => {
  /** Two sessions, the owner on neither: the state in which every event deserves a bubble. */
  function twoSessions() {
    const ready = readyPet();
    ready.service.onTabs({ activePtyId: null, sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    ready.service.onSemaphoreUpdate(sem('pty-a', 'working'));
    ready.service.onSemaphoreUpdate(sem('pty-b', 'working'));
    return ready;
  }

  it('a turn that ends out of sight: the bubble says so, with the pose of the event', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    expect(lastView(h).bubble).toMatchObject({ id: 1, text: 'atlas · terminou', pose: 'calling', target: { kind: 'session', ptyId: 'pty-a' } });
    expect(lastView(h).pose).toBe('calling');
  });

  it('the bubble goes after 6 s, on the tick, and the face goes back to the sessions', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    h.clock.now += PET_BUBBLE_MS - 1;
    h.tickAll();
    expect(lastView(h).bubble).not.toBeNull();
    h.clock.now += 1;
    h.tickAll();
    expect(lastView(h)).toMatchObject({ bubble: null, pose: 'impatient' });
  });

  it('a pending that the chat opens refines "quer permissão" into the kind it is: the same bubble, the same id', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'permission')); // the semaphore turns `permission` first
    expect(lastView(h).bubble).toMatchObject({ id: 1, text: 'atlas · quer permissão' });
    service.onPendingOpened('pty-a', 'question'); // and then the chat says what it is
    expect(lastView(h).bubble).toMatchObject({ id: 1, text: 'atlas · tem uma pergunta', pose: 'surprised' });
  });

  it('...and into a plan', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'permission'));
    service.onPendingOpened('pty-a', 'plan');
    expect(lastView(h).bubble?.text).toBe('atlas · plano para aprovar');
  });

  it('with the pending known BEFORE the semaphore turns, the bubble is born with the right kind', () => {
    const { h, service } = twoSessions();
    service.onPendingOpened('pty-a', 'plan');
    service.onSemaphoreUpdate(sem('pty-a', 'permission'));
    expect(lastView(h).bubble).toMatchObject({ id: 1, text: 'atlas · plano para aprovar' });
  });

  it('the kind of a pending is forgotten when the session leaves `permission`: the next one without a pending is a plain "quer permissão"', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'permission'));
    service.onPendingOpened('pty-a', 'plan');
    service.onSemaphoreUpdate(sem('pty-a', 'working')); // answered
    h.clock.now += 10 * SEC;
    h.tickAll();
    service.onSemaphoreUpdate(sem('pty-a', 'permission')); // a notification with no pending behind it
    expect(lastView(h).bubble?.text).toBe('atlas · quer permissão');
  });

  it('a pending for a tab that is not a session (or nobody) is harmless', () => {
    const { h, service } = twoSessions();
    const sent = h.windows[0]?.views.length;
    service.onPendingOpened('shell-1', 'permission');
    expect(h.windows[0]?.views).toHaveLength(sent ?? -1);
  });

  it('a process that exits by itself: "encerrou", sad, and the tab of the session as the target', () => {
    const { h, service } = twoSessions();
    service.onSessionExited('pty-a', false);
    expect(lastView(h).bubble).toMatchObject({ text: 'atlas · encerrou', pose: 'sad', target: { kind: 'session', ptyId: 'pty-a' } });
  });

  it('a tab the owner closed (byUser) exits without a bubble', () => {
    const { h, service } = twoSessions();
    service.onSessionExited('pty-a', true);
    expect(lastView(h).bubble).toBeNull();
  });

  it('the exit is announced whatever the order of the semaphore and of the process: the SessionEnd hook can say `done` first', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'done'));
    expect(lastView(h).bubble).toBeNull();
    service.onSessionExited('pty-a', false);
    expect(lastView(h).bubble?.text).toBe('atlas · encerrou');
  });

  it('the exit of a terminal that was never a session says nothing', () => {
    const { h, service } = twoSessions();
    const sent = h.windows[0]?.views.length;
    service.onSessionExited('shell-1', false);
    expect(h.windows[0]?.views).toHaveLength(sent ?? -1);
  });

  it('what ends while the owner is looking at it is not announced', () => {
    const { h, service } = twoSessions();
    service.onMainFocusChanged(true);
    service.onTabs({ activePtyId: 'pty-a', sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    service.onSessionExited('pty-a', false);
    expect(lastView(h).bubble).toBeNull();
  });

  it('two sessions that end in the same second become one bubble', () => {
    const { h, service } = twoSessions();
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    service.onSemaphoreUpdate(sem('pty-b', 'waiting'));
    expect(lastView(h).bubble).toMatchObject({ id: 1, text: '2 sessões terminaram', target: { kind: 'list' } });
  });

  it('the owner opening the session before the 6 s takes the bubble away at once', () => {
    const { h, service } = twoSessions();
    service.onMainFocusChanged(true);
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    expect(lastView(h).bubble).not.toBeNull();
    service.onTabs({ activePtyId: 'pty-a', sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    expect(lastView(h).bubble).toBeNull();
  });

  it('with an app in full screen no bubble is born, and when it ends they come back (the watcher of US5 calls this)', () => {
    const { h, service } = twoSessions();
    service.onFullscreenChanged(true);
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    expect(lastView(h)).toMatchObject({ bubble: null, badge: '1' });
    service.onFullscreenChanged(false);
    service.onSemaphoreUpdate(sem('pty-b', 'waiting'));
    expect(lastView(h).bubble?.text).toBe('beacon · terminou');
  });

  it('events that arrive while the pet is off make no window and no view, and the bubble they raised is gone when the pet is turned on (the clock restarts)', () => {
    const h = harness({ prefs: { enabled: false } });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [tab('pty-a', 'atlas')] });
    service.onSemaphoreUpdate(sem('pty-a', 'working'));
    service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    expect(h.windows).toHaveLength(0);
    service.setEnabled(true);
    service.handleReady();
    expect(lastView(h)).toMatchObject({ bubble: null, pose: 'impatient', badge: '1' });
  });

  it('after dispose the new methods change nothing and send nothing', () => {
    const { h, service } = twoSessions();
    service.dispose();
    service.onPendingOpened('pty-a', 'question');
    service.onFullscreenChanged(true);
    service.onSessionExited('pty-a', false);
    expect(h.windows[0]?.views.every((view) => view.bubble === null)).toBe(true);
  });
});

describe('a click leads to the session (US3, T038)', () => {
  /** `atlas` finished out of sight while the Donel is minimized: the case of the whole feature. */
  function waitingAtlas() {
    const ready = readyPet();
    ready.service.onTabs({ activePtyId: 'pty-b', sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    ready.service.onSemaphoreUpdate(sem('pty-a', 'working'));
    ready.service.onSemaphoreUpdate(sem('pty-a', 'waiting'));
    ready.h.main.minimized = true;
    return ready;
  }

  it('one waiting: restores and focuses the Donel, in that order, and tells it to activate the tab', () => {
    const { h, service } = waitingAtlas();
    service.handleClick();
    expect(h.main.calls).toEqual(['restore', 'show', 'focus']);
    expect(activations(h)).toEqual([{ ptyId: 'pty-a' }]);
  });

  it('with the Donel not minimized there is no restore', () => {
    const { h, service } = waitingAtlas();
    h.main.minimized = false;
    service.handleClick();
    expect(h.main.calls).toEqual(['show', 'focus']);
  });

  it('nobody waiting: the Donel comes to the front and no tab is activated (FR-024)', () => {
    const { h, service } = readyPet();
    h.main.minimized = true;
    service.handleClick();
    expect(h.main.calls).toEqual(['restore', 'show', 'focus']);
    expect(activations(h)).toEqual([]);
  });

  it('several waiting: nothing happens in the main, the list is the screen\'s (FR-023)', () => {
    const { h, service } = waitingAtlas();
    service.onSemaphoreUpdate(sem('pty-b', 'working'));
    service.onSemaphoreUpdate(sem('pty-b', 'waiting'));
    h.main.calls.length = 0;
    service.handleClick();
    expect(h.main.calls).toEqual([]);
    expect(activations(h)).toEqual([]);
  });

  it('the answer comes from the state of the main, not from a view the screen had: it follows who waits NOW', () => {
    const { h, service } = waitingAtlas();
    service.onSemaphoreUpdate(sem('pty-a', 'working')); // atlas went back to work: nobody waits
    service.handleClick();
    expect(activations(h)).toEqual([]);
    expect(h.main.calls).toContain('focus');
  });

  it('a click that opens the target dismisses the bubble: it has served', () => {
    const { h, service } = waitingAtlas();
    expect(lastView(h).bubble).not.toBeNull();
    service.handleClick();
    expect(lastView(h).bubble).toBeNull();
  });

  it('when the foreground lock refuses the focus, the reserve runs: always on top on, focus again, always on top off (R7)', () => {
    const { h, service } = waitingAtlas();
    h.main.focusWorks = false;
    service.handleClick();
    expect(h.main.calls).toEqual(['restore', 'show', 'focus', 'alwaysOnTop:true', 'focus', 'alwaysOnTop:false']);
    expect(activations(h)).toEqual([{ ptyId: 'pty-a' }]); // the tab is activated either way
  });

  it('when the focus takes, the reserve never runs', () => {
    const { h, service } = waitingAtlas();
    service.handleClick();
    expect(h.main.calls.some((call) => call.startsWith('alwaysOnTop'))).toBe(false);
  });

  it('pet:open on a session (an item of the list, or the bubble): brings the Donel and activates that tab', () => {
    const { h, service } = waitingAtlas();
    service.handleOpen({ kind: 'session', ptyId: 'pty-b' });
    expect(h.main.calls).toEqual(['restore', 'show', 'focus']);
    expect(activations(h)).toEqual([{ ptyId: 'pty-b' }]);
  });

  it('pet:open on the Donel (the account bubble): only brings it to the front', () => {
    const { h, service } = waitingAtlas();
    service.handleOpen({ kind: 'donel' });
    expect(h.main.calls).toEqual(['restore', 'show', 'focus']);
    expect(activations(h)).toEqual([]);
  });

  it('pet:open dismisses the bubble too, also when the session is not among the waiting ones (an "encerrou" bubble)', () => {
    const { h, service } = twoSessionsReady();
    service.onSessionExited('pty-a', false);
    expect(lastView(h).bubble?.text).toBe('atlas · encerrou');
    service.handleOpen({ kind: 'session', ptyId: 'pty-a' });
    expect(lastView(h).bubble).toBeNull();
    expect(activations(h)).toEqual([{ ptyId: 'pty-a' }]);
  });

  it('with no main window, or a destroyed one, a click does nothing and does not throw', () => {
    const none = readyPet({ withMain: false });
    expect(() => none.service.handleClick()).not.toThrow();
    expect(() => none.service.handleOpen({ kind: 'donel' })).not.toThrow();

    const { h, service } = waitingAtlas();
    h.main.destroyed = true;
    expect(() => service.handleClick()).not.toThrow();
    expect(h.main.calls).toEqual([]);
    expect(activations(h)).toEqual([]);
  });

  it('with the pet off, or after dispose, the gestures are ignored', () => {
    const off = harness({ prefs: { enabled: false } });
    const offService = createPetService(off.deps);
    offService.handleClick();
    offService.handleOpen({ kind: 'donel' });
    offService.handleListOpen(true);
    expect(off.main.calls).toEqual([]);

    const { h, service } = waitingAtlas();
    service.dispose();
    service.handleClick();
    service.handleOpen({ kind: 'donel' });
    expect(h.main.calls).toEqual([]);
  });

  it('pet:list-open reaches the window: focusable while the list is open (R12)', () => {
    const { h, service } = readyPet();
    service.handleListOpen(true);
    service.handleListOpen(false);
    expect(h.windows[0]?.listOpen).toEqual([true, false]);
  });

  /** Two quiet-working sessions with the owner elsewhere, for the cases that need the bubble of an exit. */
  function twoSessionsReady() {
    const ready = readyPet();
    ready.service.onTabs({ activePtyId: null, sessions: [tab('pty-a', 'atlas'), tab('pty-b', 'beacon')] });
    ready.service.onSemaphoreUpdate(sem('pty-a', 'working'));
    ready.service.onSemaphoreUpdate(sem('pty-b', 'working'));
    return ready;
  }
});

describe('what the semaphore says becomes the face (US1, R2)', () => {
  it('a tab with no update yet is open and quiet: incense, nobody waiting', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    expect(lastView(h)).toMatchObject({ pose: 'incense', badge: null, waiting: [] });
  });

  it('the first state the semaphore announces at registration is forgotten: a new tab is not "working"', () => {
    const { h, service } = readyPet();
    // what the main does at `registerSession`: the semaphore emits `working`, then the service is told
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSessionRegistered('a');
    service.onTabs({ activePtyId: 'a', sessions: [tab('a', 'atlas')] });
    expect(lastView(h).pose).toBe('incense');
  });

  it('...and the first REAL update, even if it is `working` again, is not swallowed as a repeat', () => {
    const { h, service } = readyPet();
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSessionRegistered('a');
    service.onTabs({ activePtyId: 'a', sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working')); // UserPromptSubmit on the born-working machine
    expect(lastView(h).pose).toBe('reading');
  });

  it('working, then the turn ends while the owner is elsewhere: badge 1 and the tab in the list, the bubble first and then the impatient face', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    expect(lastView(h).pose).toBe('reading');
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    expect(lastView(h)).toMatchObject({ pose: 'calling', badge: '1' });
    expect(lastView(h).waiting).toEqual([{ ptyId: 'a', name: 'atlas', waitingLabel: 'agora' }]);
    h.clock.now += PET_BUBBLE_MS;
    h.tickAll();
    expect(lastView(h)).toMatchObject({ pose: 'impatient', badge: '1', bubble: null });
  });

  it('permission counts as waiting too', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'permission'));
    expect(lastView(h)).toMatchObject({ pose: 'surprised', badge: '1' });
    h.clock.now += PET_BUBBLE_MS;
    h.tickAll();
    expect(lastView(h)).toMatchObject({ pose: 'impatient', badge: '1' });
  });

  it('error counts as done: a session that failed is no longer alive', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'error'));
    expect(lastView(h)).toMatchObject({ pose: 'sleeping', badge: null });
  });

  it('every hook emits, so a state that repeats is not a change: no view goes out for it', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    const sent = h.windows[0]?.views.length;
    for (let i = 0; i < 20; i += 1) service.onSemaphoreUpdate(sem('a', 'working'));
    expect(h.windows[0]?.views).toHaveLength(sent ?? -1);
  });

  it('an update that arrives before the tab is reported is used when the tab shows up', () => {
    const { h, service } = readyPet();
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    expect(lastView(h).badge).toBeNull(); // nothing to watch yet
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    expect(lastView(h)).toMatchObject({ pose: 'impatient', badge: '1' });
  });

  it('a tab that leaves takes its wait with it, with no laugh', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas'), tab('b', 'beacon')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    service.onTabs({ activePtyId: null, sessions: [tab('b', 'beacon')] });
    expect(lastView(h)).toMatchObject({ pose: 'incense', badge: null });
  });

  it('a PTY that exits is done at once, whatever the order of the semaphore and of the exit', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    service.onSessionExited('a', false);
    expect(lastView(h)).toMatchObject({ badge: null, waiting: [] }); // nothing is owed to a process that is gone
    h.clock.now += PET_BUBBLE_MS;
    h.tickAll();
    expect(lastView(h)).toMatchObject({ pose: 'sleeping', badge: null, bubble: null });
  });

  it('the exit of a terminal that was never a session is ignored', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    const sent = h.windows[0]?.views.length;
    service.onSessionExited('shell-1', true);
    expect(h.windows[0]?.views).toHaveLength(sent ?? -1);
  });

  it('forgets a dead session once its tab is gone: the same id coming back starts from idle', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'done'));
    service.onTabs({ activePtyId: null, sessions: [] });
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    expect(lastView(h).pose).toBe('incense');
  });

  it('the owner opening the tab of the last waiting session: the badge goes and the Jobu laughs', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: 'b', sessions: [tab('a', 'atlas'), tab('b', 'beacon')] });
    service.onMainFocusChanged(true);
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    expect(lastView(h).badge).toBe('1');
    service.onTabs({ activePtyId: 'a', sessions: [tab('a', 'atlas'), tab('b', 'beacon')] });
    expect(lastView(h)).toMatchObject({ badge: null, pose: 'laughing' });
    for (let i = 0; i < 3; i += 1) {
      h.clock.now += SEC;
      h.tickAll();
    }
    expect(lastView(h).pose).toBe('incense');
  });

  it('the tick makes the Jobu very impatient after 10 minutes, with no signal at all', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    h.clock.now += 10 * MIN;
    h.tickAll();
    expect(lastView(h).pose).toBe('impatient');
    h.clock.now += SEC;
    h.tickAll();
    expect(lastView(h)).toMatchObject({ pose: 'very-impatient' });
    expect(lastView(h).waiting[0]?.waitingLabel).toBe('há 10 min');
  });

  it('only a change of the minute label reaches the screen while someone waits: no view per second', () => {
    const { h, service } = readyPet();
    service.onTabs({ activePtyId: null, sessions: [tab('a', 'atlas')] });
    service.onSemaphoreUpdate(sem('a', 'working'));
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    h.clock.now += PET_BUBBLE_MS; // the bubble of the turn that ended goes first: that is one view, and it is not what is measured here
    h.tickAll();
    const sent = h.windows[0]?.views.length ?? 0;
    for (let i = 0; i < 53; i += 1) {
      h.clock.now += SEC;
      h.tickAll();
    }
    expect(h.windows[0]?.views).toHaveLength(sent);
    h.clock.now += SEC;
    h.tickAll();
    expect(h.windows[0]?.views).toHaveLength(sent + 1);
    expect(lastView(h).waiting[0]?.waitingLabel).toBe('há 1 min');
  });

  it('after dispose the signals change nothing and nothing is sent', () => {
    const { h, service } = readyPet();
    service.dispose();
    service.onTabs({ activePtyId: null, sessions: [tab('a')] });
    service.onSemaphoreUpdate(sem('a', 'waiting'));
    service.onSessionRegistered('a');
    service.onSessionExited('a', false);
    service.onMainFocusChanged(true);
    expect(h.windows[0]?.views).toHaveLength(1);
  });
});
