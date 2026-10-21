import { useEffect, useRef, useState } from 'react';
import { drawingMetrics } from '../../../shared/pet/art';
import { splitSessionBubbleText } from '../../../shared/pet/bubble';
import { resolvePose } from '../../../shared/pet/poses';
import type { PetView, PetViewBubble } from '../../../shared/pet/types';
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

/**
 * FR-030: the little hop that goes with a new bubble. A few pixels up and back, with a second, smaller
 * bounce; its height follows the size of the drawing. Skipped for whoever asked the system for less motion.
 */
function hop(element: HTMLElement | null, size: number): void {
  if (element === null || typeof element.animate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lift = (size / 140) * 9;
  element.animate(
    [
      { transform: 'translateY(0)', offset: 0 },
      { transform: `translateY(${-lift}px)`, offset: 0.3 },
      { transform: 'translateY(0)', offset: 0.55 },
      { transform: `translateY(${-lift / 3}px)`, offset: 0.75 },
      { transform: 'translateY(0)', offset: 1 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  );
}

/** What the bubble says, with the name of the tab in its own face and the only part that is cut when the line is long. */
function BubbleText({ bubble }: { bubble: PetViewBubble }): React.JSX.Element {
  const split = bubble.target.kind === 'session' ? splitSessionBubbleText(bubble.text) : null;
  if (split === null) {
    return (
      <span className={styles.text}>
        <span className={styles.lead}>{bubble.text}</span>
      </span>
    );
  }
  return (
    <span className={styles.text}>
      <span className={`${styles.lead} ${styles.name}`}>{split.name}</span>
      <span className={styles.tail}> · {split.event}</span>
    </span>
  );
}

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
 * "Regras"). The bubble (T034) sits above the drawing, anchored to it by `view.align`; the list, the
 * drag and the menu join it with the next stories (T039, T046...).
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
  const bubble = view?.bubble ?? null;
  // What is under a pointer that does not move changes when the badge or the bubble comes or goes (or says something else).
  const refreshKey = `${view?.badge ?? ''}|${bubble?.id ?? ''}:${bubble?.text ?? ''}`;
  const interactive = usePetHitTest({ figure: figureRef, arts: POSE_ART, art, size: view?.size ?? null, refreshKey });

  // FR-030: one hop per bubble, keyed by its id: a bubble that grew into an aggregate keeps its id and does not hop twice.
  const bubbleId = bubble?.id ?? null;
  const hoppedForRef = useRef<number | null>(null);
  const sizeRef = useRef(140);
  sizeRef.current = view?.size ?? sizeRef.current;
  useEffect(() => {
    if (bubbleId === null || bubbleId === hoppedForRef.current) return;
    hoppedForRef.current = bubbleId;
    hop(figureRef.current, sizeRef.current);
  }, [bubbleId]);

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
        <div
          className={styles.stage}
          style={{ width: metrics.width, height: metrics.anchorY, '--stage-w': `${metrics.width}px` } as React.CSSProperties}
          role="img"
          aria-label={petLabel(view)}
        >
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
          {bubble !== null && (
            // Above the head, anchored to the drawing like an alignment (`right` near the right edge of the screen, the default corner).
            <div className={styles.popups} data-align={view.align} data-testid="pet-popups">
              <div className={styles.bubble} role="status" aria-live="polite" data-hit data-testid="pet-bubble" data-bubble-id={bubble.id} data-pose={bubble.pose}>
                <span className={styles.dot} aria-hidden="true" />
                <BubbleText bubble={bubble} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
