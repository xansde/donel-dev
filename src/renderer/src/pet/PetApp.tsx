import { useEffect, useRef, useState } from 'react';
import { drawingMetrics } from '../../../shared/pet/art';
import { resolvePose } from '../../../shared/pet/poses';
import type { PetView } from '../../../shared/pet/types';
import styles from './PetApp.module.css';
import { usePetHitTest } from './usePetHitTest';

/**
 * The art of every pose, by pose name (`neutral`, `reading`...). New art is one more PNG in the folder
 * and nothing here changes (R15). Each one arrives as a `data:` URI, not as a file: the click test reads
 * the alpha of the picture from a canvas, and on a `file://` page a picture from a file is another
 * origin, which makes the canvas unreadable. The inlining is `build.assetsInlineLimit` for that folder
 * in electron.vite.config.ts.
 */
const POSE_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(import.meta.glob('./assets/poses/*.png', { eager: true, import: 'default' }) as Record<string, string>).map(([path, url]) => [
    path.replace(/^.*\//, '').replace(/\.png$/, ''),
    url,
  ]),
);
const AVAILABLE_ART: ReadonlySet<string> = new Set(POSE_ART.keys());

/** The accessible name of the drawing: how many sessions wait, nothing more (FR-018). */
function petLabel(view: PetView): string {
  if (view.waiting.length === 0) return 'Jobu: nenhuma sessão esperando você';
  return `Jobu: ${view.waiting.length === 1 ? '1 sessão esperando você' : `${view.waiting.length} sessões esperando você`}`;
}

/**
 * T017/T028 (015-jobu-pet) - the screen of the Jobu. The view (`PetView`) is the ONLY source of what
 * is shown: nothing here decides a state. The drawing sits at the bottom center with its anchor on the
 * bottom edge of the window (the base point), `view.size` tall; the badge counts who waits; and the
 * `data-*` of the root mirror the view, which is the surface of the `@pet` smoke (contracts/ipc-pet.md,
 * "Regras"). The bubble, the list, the drag and the menu join it with the next stories (T034, T039, T046...).
 *
 * `data-pose` is the LOGICAL pose (`impatient`); `data-art` is the picture that was drawn for it (the
 * stand-in `skeptical` while the art of `impatient` does not exist, FR-029). `data-interactive` is what
 * the click test last told the main: `true` while the pointer is over the Jobu or the badge.
 */
export function PetApp(): React.JSX.Element {
  const [view, setView] = useState<PetView | null>(null);
  const figureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe BEFORE saying ready: the main answers `ready` with the current view, and an answer
    // that came with nobody listening would be lost.
    const unsubscribe = window.donel.pet.onView(setView);
    window.donel.pet.ready();
    return unsubscribe;
  }, []);

  const art = view === null ? null : resolvePose(view.pose, AVAILABLE_ART);
  const interactive = usePetHitTest({ figure: figureRef, arts: POSE_ART, art, size: view?.size ?? null, refreshKey: view?.badge ?? '' });

  const metrics = view === null ? null : drawingMetrics(view.size);
  // FR-004: away from the taskbar edge the base of the art fades, instead of showing a straight cut.
  const fade = view === null || metrics === null || view.docked ? undefined : `linear-gradient(to bottom, #000 calc(100% - ${metrics.fade}px), transparent 100%)`;

  return (
    <div
      className={styles.root}
      data-testid="pet-root"
      data-pose={view?.pose ?? 'sleeping'}
      data-art={art ?? undefined}
      data-badge={view?.badge ?? undefined}
      data-bubble={view?.bubble?.text ?? undefined}
      data-docked={view === null ? undefined : String(view.docked)}
      data-align={view?.align}
      data-size={view === null ? undefined : String(view.size)}
      data-interactive={String(interactive)}
    >
      {view !== null && metrics !== null && (
        // The stage is the part of the drawing above the anchor, so its bottom edge IS the base point.
        <div className={styles.stage} style={{ width: metrics.width, height: metrics.anchorY }} role="img" aria-label={petLabel(view)}>
          <div className={styles.clip} style={fade === undefined ? undefined : { maskImage: fade, WebkitMaskImage: fade }}>
            <div ref={figureRef} className={styles.figure} data-testid="pet-figure" style={{ width: metrics.width, height: metrics.height }}>
              {[...POSE_ART].map(([name, url]) => (
                <img key={name} className={styles.pose} data-active={String(name === art)} src={url} alt="" draggable={false} />
              ))}
            </div>
          </div>
          {view.badge !== null && (
            <span className={styles.badge} data-hit data-testid="pet-badge">
              {view.badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
