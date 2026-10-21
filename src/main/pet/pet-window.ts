// T019 (015-jobu-pet, R9/R18) - the window of the pet: a transparent, frameless, always-on-top
// `BrowserWindow` that never takes the focus and lets every click through the empty space around the
// drawing. It loads the SAME `index.html` as the main window, on the `#pet` route, with the same
// preload; the page decides what to mount (src/renderer/src/main.tsx). This is the only file of the
// pet that talks to Electron's `BrowserWindow`; the service drives it through `PetWindowHandle`.

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { PET_CHANNELS } from '../../shared/pet/ipc';
import type { PetPoint, PetRect, PetView } from '../../shared/pet/types';
import type { CreatePetWindowOptions, PetWindowHandle } from './pet-service';

export function createPetWindow(options: CreatePetWindowOptions): PetWindowHandle {
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
      if (!win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    setListOpen: (open: boolean) => {
      if (win.isDestroyed()) return;
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
    moveTo: (point: PetPoint) => {
      if (!win.isDestroyed()) win.setPosition(Math.round(point.x), Math.round(point.y));
    },
    applyBounds: (next: PetRect) => {
      if (!win.isDestroyed()) win.setBounds(next);
    },
    destroy: () => {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
