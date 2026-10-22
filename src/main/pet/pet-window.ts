// T019 (015-jobu-pet, R9/R18) - the window of the pet: a transparent, frameless, always-on-top
// `BrowserWindow` that never takes the focus and lets every click through the empty space around the
// drawing. It loads the SAME `index.html` as the main window, on the `#pet` route, with the same
// preload; the page decides what to mount (src/renderer/src/main.tsx). This is the only file of the
// pet that talks to Electron's `BrowserWindow`; the service drives it through `PetWindowHandle`.
//
// Since US5 it also keeps the window out of screen captures (FR-034: `setContentProtection`, which on Windows 10
// 2004 or newer is `WDA_EXCLUDEFROMCAPTURE`) and pops up the right-click menu. Measured on Electron 43 on
// Windows 11: the display affinity only reaches the OS when the window is SHOWN (set while it is hidden, it
// waits for the next `show`), and it is `0x11` protected and `0x0` released. The window is born hidden and
// protected, so the first frame it ever shows is already out of captures.
//
// The test seams (src/main/pet/pet-seams.ts) change what this window does to the OS, never what the page
// does: see `PetSeams`.

import { BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { PET_CHANNELS } from '../../shared/pet/ipc';
import type { PetRect, PetView } from '../../shared/pet/types';
import { deferUntilMenuClosed, toMenuTemplate } from './pet-menu';
import type { PetSeams, PetSmokeGlobal } from './pet-seams';
import type { CreatePetWindowOptions, PetWindowHandle } from './pet-service';

const NO_SEAMS: PetSeams = { ghost: false, capturable: false };

export function createPetWindow(options: CreatePetWindowOptions, seams: PetSeams = NO_SEAMS): PetWindowHandle {
  const { bounds } = options;
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: 'Jobu Donel',
    // A floating drawing, nothing else: no frame, no shadow, no background, no taskbar button.
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    // Never steals the focus on a click: the owner is typing somewhere else (R9). The list turns
    // this on while it is open (`setListOpen`).
    focusable: false,
    // Shown only after the screen says it is ready (`pet:ready` -> `showInactive`).
    show: false,
    webPreferences: {
      // The same preload and the same isolation as the main window (R18).
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The animations must keep running even when the window is covered.
      backgroundThrottling: false,
    },
  });

  // FR-034: out of every capture - print, recording, Teams, Meet, Zoom - and still in front of the owner. Born
  // protected, before the first frame; "Liberar print por 1 minuto" turns it off through `setCaptureAllowed`.
  win.setContentProtection(!options.captureAllowed);

  // The ghost of the smokes (`DONEL_PET_SMOKE_INVISIBLE=1`): no opacity, so nothing of it shows on the screen of whoever
  // is using the machine while the test runs. The page, the CDP and the whole state go on exactly the same.
  if (seams.ghost) win.setOpacity(0);

  // Ctrl + wheel is the gesture of the size (FR-033): the page must not also zoom itself with it.
  void win.webContents.setVisualZoomLevelLimits(1, 1);

  // On Windows a frameless window comes out of the constructor a few pixels larger than asked (measured
  // on a 125% display: 482x343 for 480x340), because the invisible frame is counted when it is created.
  // The base of the drawing must sit exactly on the taskbar edge, so the bounds are applied once more
  // now that the window exists.
  win.setBounds(bounds);

  // Click-through by default: the screen asks for the mouse (`pet:interactive`) only while the
  // pointer is over the drawing, the bubble, the badge or the list. `forward` keeps the `mousemove`
  // flowing to the page so it can run that hit test (R9).
  win.setIgnoreMouseEvents(true, { forward: true });

  // Same navigation guards as the main window (T045 of the chat): this window exposes
  // `window.donel`, so it must never be navigated to another page nor open new windows.
  const sameDocument = (url: string): boolean => {
    const strip = (u: string): string => u.split('#')[0] ?? u;
    return strip(url) === strip(win.webContents.getURL());
  };
  win.webContents.on('will-navigate', (event, url) => {
    if (!sameDocument(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!sameDocument(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // `webContents.id` read now: asking "who sent this message?" later must not touch a destroyed window.
  const webContentsId = win.webContents.id;

  win.on('closed', options.onClosed);
  // The window's own `blur` is the signal that the owner clicked elsewhere while the list was open: the page
  // does not get a DOM `blur` for it (measured on Electron 43, Windows: `document.hasFocus()` stays true).
  win.on('blur', options.onBlur);

  const loaded = process.env.ELECTRON_RENDERER_URL
    ? win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#pet`)
    : win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'pet' });
  loaded.catch((error: unknown) => {
    // A window destroyed while it was still loading rejects here: nothing to report for that.
    if (!win.isDestroyed()) console.error('[donel-dev] a tela do Jobu não carregou:', error);
  });

  return {
    webContentsId,
    isDestroyed: () => win.isDestroyed(),
    sendView: (view: PetView) => {
      if (!win.isDestroyed()) win.webContents.send(PET_CHANNELS.view, view);
    },
    showInactive: () => {
      if (!win.isDestroyed()) win.showInactive();
    },
    hide: () => {
      if (!win.isDestroyed()) win.hide();
    },
    setInteractive: (interactive: boolean) => {
      // A ghost is never the owner's to click: it keeps letting the mouse through, even over the drawing.
      if (!win.isDestroyed() && !seams.ghost) win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    requestCloseList: () => {
      if (!win.isDestroyed()) win.webContents.send(PET_CHANNELS.closeList);
    },
    setListOpen: (open: boolean) => {
      if (win.isDestroyed()) return;
      // A ghost never takes the focus: an invisible window with the keyboard would swallow the typing of whoever is
      // using the machine. The smokes close the list by emitting the `blur` of the window themselves.
      if (seams.ghost) return;
      if (open) {
        win.setFocusable(true);
        win.focus();
        return;
      }
      // Closing. A window that is still the active one when it turns non-focusable would keep the keyboard
      // and swallow the owner's typing, so it hands the focus back first: `blur` activates the next window
      // in the z-order, which is where the owner was.
      if (win.isFocused()) win.blur();
      win.setFocusable(false);
    },
    applyBounds: (next: PetRect) => {
      // Always the whole rectangle: a `setPosition` on a scaled screen makes this window grow (see pet-service.ts).
      if (!win.isDestroyed()) win.setBounds(next);
    },
    setCaptureAllowed: (allowed: boolean) => {
      if (!win.isDestroyed()) win.setContentProtection(!allowed);
    },
    popupMenu: (entries, onChoose, at) => {
      if (win.isDestroyed()) return;
      if (seams.ghost) {
        // No native menu in a test: it takes the mouse of the whole desktop while it is open, and opens at the
        // pointer of whoever is working. The model and the way to choose from it are left for the test instead.
        const hooks = globalThis as PetSmokeGlobal;
        hooks.__donelPetSmoke = { ...hooks.__donelPetSmoke, menu: { entries, choose: onChoose } };
        return;
      }
      // The chosen action runs when the menu has CLOSED, not inside the click of the item: "Esconder" destroys this
      // very window, and a window must not be destroyed from within the activation of its own native menu.
      const deferred = deferUntilMenuClosed(onChoose);
      const menu = Menu.buildFromTemplate(toMenuTemplate(entries, deferred.choose));
      const closed = deferred.closed;
      if (at === null) {
        menu.popup({ window: win, callback: closed });
        return;
      }
      // The coordinates of `popup` are relative to the content of the window; the click came in screen DIP.
      const content = win.getContentBounds();
      menu.popup({ window: win, x: Math.round(at.x - content.x), y: Math.round(at.y - content.y), callback: closed });
    },
    destroy: () => {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
