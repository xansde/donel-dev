// t-56abde57 — the owner moved the Donel to another monitor and the Jobu vanished. Windows reports a maximized
// window on a monitor without the taskbar as "an app has the whole screen", and the Jobu hid for it. The owner
// wants him on screen everywhere ("quero o jobu sem essa restrição burra"): nothing hides the Jobu but the owner.

import { describe, expect, it } from 'vitest';
import type { PetPrefs } from '../src/shared/config';
import type { PetDisplay, PetRect, PetView } from '../src/shared/pet/types';
import { createPetService, type PetServiceDeps, type PetWindowHandle } from '../src/main/pet/pet-service';

const rect = (x: number, y: number, width: number, height: number): PetRect => ({ x, y, width, height });
const primary: PetDisplay = { id: 1, bounds: rect(0, 0, 1920, 1080), workArea: rect(0, 0, 1920, 1040), scaleFactor: 1 };
// The second monitor, to the right, at 150% and with no taskbar: where a maximized Donel looks "full screen".
const second: PetDisplay = { id: 2, bounds: rect(1920, 0, 1707, 960), workArea: rect(1920, 0, 1707, 960), scaleFactor: 1.5 };

function setup() {
  const calls = { hide: 0, showInactive: 0, bounds: [] as PetRect[], views: [] as PetView[] };
  let displays: readonly PetDisplay[] = [primary];
  let displaysListener: (() => void) | null = null;
  let systemSaysFullScreen: ((active: boolean) => void) | null = null;
  let prefs: PetPrefs = { enabled: true, placement: null, size: 140 };

  const handle: PetWindowHandle = {
    webContentsId: 7,
    isDestroyed: () => false,
    sendView: (view) => calls.views.push(view),
    showInactive: () => calls.showInactive++,
    hide: () => calls.hide++,
    setInteractive: () => undefined,
    setFocusable: () => undefined,
    requestCloseList: () => undefined,
    applyBounds: (bounds) => calls.bounds.push(bounds),
    setCaptureAllowed: () => undefined,
    popupMenu: () => undefined,
    destroy: () => undefined,
  };

  // A variable, not a literal: the deps may still carry the full-screen watcher of the old service.
  const deps = {
    getMainWindow: () => null,
    config: () => prefs,
    persist: (next: PetPrefs) => {
      prefs = next;
    },
    createWindow: () => handle,
    getDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => undefined,
    subscribeDisplays: (listener: () => void) => {
      displaysListener = listener;
      return () => undefined;
    },
    startFullscreenWatcher: (onChange: (active: boolean) => void) => {
      systemSaysFullScreen = onChange;
      return { stop: () => undefined };
    },
  };
  const service = createPetService(deps as PetServiceDeps);
  return {
    service,
    calls,
    moveToSecondMonitor() {
      displays = [primary, second];
      displaysListener?.();
    },
    systemSaysFullScreen(active: boolean) {
      systemSaysFullScreen?.(active);
      // The smoke hook of the old service did the same thing by the other door.
      (service as { onFullscreenChanged?: (active: boolean) => void }).onFullscreenChanged?.(active);
    },
  };
}

describe('Jobu: nothing hides him but the owner', () => {
  it('stays on screen when the Donel goes to another monitor (with another scale) and when it comes back', () => {
    const app = setup();
    app.service.start();
    app.service.handleReady();
    expect(app.calls.showInactive).toBe(1);

    app.moveToSecondMonitor();
    app.systemSaysFullScreen(true); // the maximized Donel on the monitor without the taskbar
    expect(app.calls.hide).toBe(0);

    app.systemSaysFullScreen(false); // back to the first monitor
    expect(app.calls.hide).toBe(0);
    expect(app.service.isEnabled()).toBe(true);
  });

  it('shows up even when the system already says "full screen" before his screen is ready', () => {
    const app = setup();
    app.service.start();
    app.systemSaysFullScreen(true);
    app.service.handleReady();
    expect(app.calls.showInactive).toBe(1);
    expect(app.calls.hide).toBe(0);
  });
});
