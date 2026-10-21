// T020 (015-jobu-pet) - the pet service in the main, with every dependency faked: the window, the
// screen, the clock, the timer, the config and the main window. What it must guarantee here:
// with `pet.enabled = false` the app is the one of before (no window, no timer); with `true` there
// is exactly one window and one 1 s tick, both gone on disable and on dispose; the view goes out
// only when it changes; and the main window is told whenever `pet.enabled` changes (R19).
import { describe, expect, it } from 'vitest';
import type { PetPrefs } from '../src/shared/config';
import { PET_CHANNELS } from '../src/shared/pet/ipc';
import { alignFor, anchorOf, defaultPlacement, windowBoundsFor } from '../src/shared/pet/placement';
import type { PetDisplay, PetPoint, PetRect, PetView } from '../src/shared/pet/types';
import {
  PET_TICK_MS,
  buildTrivialView,
  createPetService,
  type CreatePetWindowOptions,
  type PetMainWindowLike,
  type PetServiceDeps,
  type PetViewInputs,
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
  readonly main: { focused: boolean; destroyed: boolean };
  prefs: PetPrefs;
  clock: { now: number };
  /** Runs every live timer once, like a second passing. */
  tickAll(): void;
  liveTimers(): FakeTimer[];
  liveWindows(): FakePetWindow[];
}

function harness(over: { prefs?: Partial<PetPrefs>; displays?: readonly PetDisplay[]; withMain?: boolean; buildView?: (inputs: PetViewInputs) => PetView; createWindowThrows?: boolean } = {}): Harness {
  const windows: FakePetWindow[] = [];
  const timers: FakeTimer[] = [];
  const persisted: PetPrefs[] = [];
  const mainSent: { channel: string; payload: unknown }[] = [];
  const main = { focused: false, destroyed: false };
  const clock = { now: 1_000_000 };
  const state = { prefs: { enabled: false, placement: null, size: 140, ...over.prefs } as PetPrefs };
  const displays = over.displays ?? [PRIMARY];

  const mainWindow: PetMainWindowLike = {
    isDestroyed: () => main.destroyed,
    isFocused: () => main.focused,
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
    ...(over.buildView !== undefined ? { buildView: over.buildView } : {}),
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

  it('the first view is the trivial one of this phase: asleep, no badge, no bubble, nobody waiting', () => {
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
    let pose: PetView['pose'] = 'sleeping';
    const h = harness({ prefs: { enabled: true }, buildView: (inputs) => ({ ...buildTrivialView(inputs), pose }) });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    h.tickAll();
    expect(h.windows[0]?.views).toHaveLength(1);
    pose = 'reading';
    h.tickAll();
    h.tickAll();
    expect(h.windows[0]?.views.map((view) => view.pose)).toEqual(['sleeping', 'reading']);
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

  it('the view builder gets the tabs, the focus, the clock and the placement-derived ui', () => {
    const seen: PetViewInputs[] = [];
    const h = harness({
      prefs: { enabled: true },
      buildView: (inputs) => {
        seen.push(inputs);
        return buildTrivialView(inputs);
      },
    });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: 'pty-a', sessions: [{ ptyId: 'pty-a', name: 'atlas' }, { ptyId: 'pty-b', name: 'beacon' }] });
    service.onMainFocusChanged(true);
    service.handleReady();
    const last = seen[seen.length - 1]!;
    expect(last.tabs.sessions.map((session) => session.name)).toEqual(['atlas', 'beacon']);
    expect(last.focus).toEqual({ activePtyId: 'pty-a', donelFocused: true });
    expect(last.now).toBe(h.clock.now);
    expect(last.ui).toEqual({ size: 140, docked: true, align: 'right' });
  });

  it('tabs received while the pet was off are used as soon as it is turned on', () => {
    const seen: PetViewInputs[] = [];
    const h = harness({
      prefs: { enabled: false },
      buildView: (inputs) => {
        seen.push(inputs);
        return buildTrivialView(inputs);
      },
    });
    const service = createPetService(h.deps);
    service.start();
    service.onTabs({ activePtyId: null, sessions: [{ ptyId: 'pty-a', name: 'atlas' }] });
    service.setEnabled(true);
    service.handleReady();
    expect(seen[seen.length - 1]?.tabs.sessions).toEqual([{ ptyId: 'pty-a', name: 'atlas' }]);
  });

  it('the focus state starts from the main window as it is when the service is born', () => {
    const seen: PetViewInputs[] = [];
    const h = harness({
      prefs: { enabled: true },
      buildView: (inputs) => {
        seen.push(inputs);
        return buildTrivialView(inputs);
      },
    });
    h.main.focused = true;
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    expect(seen[seen.length - 1]?.focus.donelFocused).toBe(true);
  });

  it('a focus change re-evaluates the view without waiting for the tick', () => {
    let focusedSeen: boolean | null = null;
    const h = harness({
      prefs: { enabled: true },
      buildView: (inputs) => {
        focusedSeen = inputs.focus.donelFocused;
        return { ...buildTrivialView(inputs), pose: inputs.focus.donelFocused ? 'neutral' : 'sleeping' };
      },
    });
    const service = createPetService(h.deps);
    service.start();
    service.handleReady();
    service.onMainFocusChanged(true);
    expect(focusedSeen).toBe(true);
    expect(h.windows[0]?.views.map((view) => view.pose)).toEqual(['sleeping', 'neutral']);
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
