import { useCallback, useEffect, useRef, useState } from 'react';
import { drawingMetrics } from '../../../shared/pet/art';
import { splitSessionBubbleText } from '../../../shared/pet/bubble';
import { decideBubbleClick, decideClick } from '../../../shared/pet/click';
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
 * T017/T028/T034/T039 (015-jobu-pet) - the screen of the Jobu. The view (`PetView`) is the ONLY source of
 * what is shown: nothing here decides a state. The drawing sits at the bottom center with its anchor on the
 * bottom edge of the window (the base point), `view.size` tall; the badge counts who waits; the bubble and
 * the list sit above it, anchored to it by `view.align`; and the `data-*` of the root mirror the view, which
 * is the surface of the `@pet` smoke (contracts/ipc-pet.md, "Regras"). The drag and the menu join it with
 * the next stories (T046...).
 *
 * The click (FR-022 to FR-025) is decided by `decideClick`/`decideBubbleClick`, the same functions the main
 * uses: one waiting goes to its tab, nobody waiting brings the Donel, several open the list; the bubble goes
 * where it says. The list is this screen's own state, and while it is open the window can take the focus
 * (`pet.setListOpen`), so that Esc closes it, and the main tells it to close when the window loses the focus.
 *
 * `data-pose` is the LOGICAL pose (`impatient`); `data-art` is the picture that was drawn for it (the
 * stand-in `skeptical` while the art of `impatient` does not exist, FR-029). `data-interactive` is what
 * the click test last told the main: `true` while the pointer is over the Jobu, the badge, the bubble or
 * the list. `data-list` is `open` while the list shows.
 */
export function PetApp(): React.JSX.Element {
  const [view, setView] = useState<PetView | null>(null);
  const [listOpen, setListOpen] = useState(false);
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
  const waiting = view?.waiting ?? [];
  // A list of one is no list: it needs two or more to be worth opening (FR-023), and it goes when they drop to one.
  const listVisible = listOpen && waiting.length >= 2;
  // What is under a pointer that does not move changes when the badge, the bubble or the list comes or goes (or says something else).
  const refreshKey = `${view?.badge ?? ''}|${bubble?.id ?? ''}:${bubble?.text ?? ''}|${listVisible ? `list${waiting.length}` : ''}`;
  const { interactive, isHit } = usePetHitTest({ figure: figureRef, arts: POSE_ART, art, size: view?.size ?? null, refreshKey });

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

  // The list goes away when it has nothing to list, so it does not come back by itself when two wait again.
  useEffect(() => {
    if (listOpen && waiting.length < 2) setListOpen(false);
  }, [listOpen, waiting.length]);

  // The main makes the window focusable while the list shows (R12) and takes it back when it goes: told only when it changes.
  const listToldRef = useRef(false);
  useEffect(() => {
    if (listVisible === listToldRef.current) return;
    listToldRef.current = listVisible;
    window.donel.pet.setListOpen(listVisible);
  }, [listVisible]);

  // Esc closes the list without doing anything (FR-023)...
  useEffect(() => {
    if (!listVisible) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setListOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listVisible]);

  // ...and so does a click anywhere else. The page cannot see that one: with the list open the window is
  // deactivated and `document.hasFocus()` stays true with no DOM `blur` (measured on Electron 43), so the main
  // listens to the window's own `blur` and says it here.
  useEffect(() => window.donel.pet.onCloseList(() => setListOpen(false)), []);

  /** A click on the drawing or on the badge (the badge is part of the Jobu): the one waiting, the Donel, or the list. */
  const onJobuClick = useCallback(
    (event: React.MouseEvent): void => {
      if (view === null || !isHit(event.clientX, event.clientY)) return; // the transparent corner of the box is not the Jobu
      const decision = decideClick(view);
      if (decision.kind === 'list') {
        setListOpen((open) => !open);
        return;
      }
      setListOpen(false);
      window.donel.pet.click(); // the main answers with ITS state of who waits
    },
    [view, isHit],
  );

  /** A click on the bubble goes where the bubble says (FR-025). */
  const onBubbleClick = (): void => {
    if (view === null || bubble === null) return;
    const decision = decideBubbleClick(bubble, view.waiting);
    if (decision.kind === 'list') setListOpen(true);
    else window.donel.pet.open(decision);
  };

  /** A click on an item of the list: the same as the click on the Jobu when only that one waited. */
  const onItemClick = (ptyId: string): void => {
    setListOpen(false);
    window.donel.pet.open({ kind: 'session', ptyId });
  };

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
      data-bubble={bubble?.text ?? undefined}
      data-list={listVisible ? 'open' : 'closed'}
      data-docked={view === null ? undefined : String(view.docked)}
      data-align={view?.align}
      data-size={view === null ? undefined : String(view.size)}
      data-interactive={String(interactive)}
    >
      {/* What the bubble says, for whoever reads the screen with a reader: a live region has to exist before its text changes. */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {bubble?.text ?? ''}
      </div>
      {view !== null && metrics !== null && (
        // The stage is the part of the drawing above the anchor, so its bottom edge IS the base point.
        <div className={styles.stage} style={{ width: metrics.width, height: metrics.anchorY, '--stage-w': `${metrics.width}px` } as React.CSSProperties}>
          {/* The picture is the `img`; the bubble and the list are buttons, and an `img` hides its children from a screen reader. */}
          <div
            className={styles.clip}
            role="img"
            aria-label={petLabel(view)}
            style={fade === undefined ? undefined : { maskImage: fade, WebkitMaskImage: fade }}
          >
            <div ref={figureRef} className={styles.figure} data-testid="pet-figure" style={{ width: metrics.width, height: metrics.height }} onClick={onJobuClick}>
              {[...POSE_ART].map(([name, url]) => (
                <img key={name} className={styles.pose} data-active={String(name === art)} src={url} alt="" draggable={false} />
              ))}
            </div>
          </div>
          {view.badge !== null && (
            <span className={styles.badge} data-hit data-testid="pet-badge" onClick={onJobuClick}>
              {view.badge}
            </span>
          )}
          {(bubble !== null || listVisible) && (
            // Above the head, anchored to the drawing like an alignment (`right` near the right edge of the screen, the default corner).
            <div className={styles.popups} data-align={view.align} data-testid="pet-popups" data-both={bubble !== null && listVisible ? '' : undefined}>
              {bubble !== null && (
                <button
                  type="button"
                  className={styles.bubble}
                  data-hit
                  data-testid="pet-bubble"
                  data-bubble-id={bubble.id}
                  data-pose={bubble.pose}
                  aria-label={bubble.text}
                  onClick={onBubbleClick}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <BubbleText bubble={bubble} />
                </button>
              )}
              {listVisible && (
                <div className={styles.listWrap} data-hit data-testid="pet-list" role="dialog" aria-label="Sessões esperando você">
                  <div className={styles.list}>
                    <h3 className={styles.listTitle}>Esperando você</h3>
                    {view.waiting.map((entry) => (
                      <button key={entry.ptyId} type="button" className={styles.item} data-testid="pet-list-item" title={entry.name} onClick={() => onItemClick(entry.ptyId)}>
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.itemName}>{entry.name}</span>
                        <span className={styles.itemAge}>{entry.waitingLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
