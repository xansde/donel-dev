// notificacoes-completas (30/10) — the Electron end of the taskbar channels: the badge over the Donel button
// (`setOverlayIcon`, Windows) and its flash (`flashFrame`). The picture of the badge is drawn at runtime
// (src/shared/attention/badgeBitmap.ts), at the pixel size of the primary screen, so no asset ships for it.

import { nativeImage, screen, type BrowserWindow } from 'electron';
import { renderBadgeBitmap } from '../../shared/attention/badgeBitmap';
import { overlayDescription } from '../../shared/attention/rule';
import { badgeOf } from '../../shared/pet/petView';

/** What a smoke can read from the main process (`electronApp.evaluate`), with the notifications stub on. */
export interface AttentionSmokeSnapshot {
  overlayCount: number;
  flashing: boolean;
}

export interface TaskbarAttention {
  setOverlay(count: number): void;
  flashFrame(flag: boolean): void;
}

/** Windows draws the overlay at 16 x 16 at 96 DPI: one pixel of the picture per physical pixel, whatever the scale. */
function overlayPixels(): number {
  let scale = 1;
  try {
    scale = screen.getPrimaryDisplay().scaleFactor;
  } catch {
    // `screen` before `ready`, or gone at exit: 100 % is a fine guess for a 16 px picture
  }
  return Math.max(16, Math.round(16 * scale));
}

export function createTaskbarAttention(getMainWindow: () => BrowserWindow | null, smoke: AttentionSmokeSnapshot | null): TaskbarAttention {
  return {
    setOverlay(count) {
      if (smoke !== null) smoke.overlayCount = count;
      const window = getMainWindow();
      if (window === null || process.platform !== 'win32') return;
      try {
        const label = badgeOf(count);
        if (label === null) {
          window.setOverlayIcon(null, '');
          return;
        }
        const size = overlayPixels();
        const image = nativeImage.createFromBitmap(Buffer.from(renderBadgeBitmap(label, size)), { width: size, height: size });
        window.setOverlayIcon(image, overlayDescription(count));
      } catch (error) {
        console.error('[donel-dev] o selo da barra de tarefas falhou:', error);
      }
    },

    flashFrame(flag) {
      if (smoke !== null) smoke.flashing = flag;
      const window = getMainWindow();
      if (window === null) return;
      try {
        window.flashFrame(flag);
      } catch (error) {
        console.error('[donel-dev] piscar a barra de tarefas falhou:', error);
      }
    },
  };
}
