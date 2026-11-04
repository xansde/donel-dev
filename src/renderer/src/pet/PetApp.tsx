import { useCallback, useEffect, useRef, useState } from 'react';
import { drawingMetrics } from '../../../shared/pet/art';
import { blinkFrameFor, createBlinkScheduler } from '../../../shared/pet/blink';
import { splitSessionBubbleText } from '../../../shared/pet/bubble';
import { decideBubbleClick } from '../../../shared/pet/click';
import { normalizeWheelDelta, wheelSteps } from '../../../shared/pet/gestures';
import { PET_SIZE_DEFAULT } from '../../../shared/pet/placement';
import { resolvePose } from '../../../shared/pet/poses';
import type { PetView, PetViewBubble } from '../../../shared/pet/types';
import { LiderTalk, type TalkPose } from './LiderTalk';
import styles from './PetApp.module.css';
import { usePetDrag } from './usePetDrag';
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

/** Whoever asked the system for less motion gets none: no sway, no hop, no blink. */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * FR-030: the little hop that goes with a new bubble. A few pixels up and back, with a second, smaller
 * bounce; its height follows the size of the drawing. Skipped for whoever asked the system for less motion.
 */
function hop(element: HTMLElement | null, size: number): void {
  if (element === null || typeof element.animate !== 'function') return;
  if (prefersReducedMotion()) return;
  const lift = (size / PET_SIZE_DEFAULT) * 9;
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
 * T017/T028/T034/T039/T046/T052/T053 (015-jobu-pet) - the screen of the Jobu. The view (`PetView`) is the ONLY source of
 * what is shown: nothing here decides a state. The drawing sits at the bottom center with its anchor on the
 * bottom edge of the window (the base point), `view.size` tall; the badge counts who waits; the bubble and
 * the list sit above it, anchored to it by `view.align`; and the `data-*` of the root mirror the view, which
 * is the surface of the `@pet` smoke (contracts/ipc-pet.md, "Regras").
 *
 * The click (FR-022 to FR-025) is decided by `decideClick`/`decideBubbleClick`, the same functions the main
 * uses: one waiting goes to its tab, nobody waiting brings the Donel, several open the list; the bubble goes
 * where it says. The list is this screen's own state, and while it is open the window can take the focus
 * (`pet.setListOpen`), so that Esc closes it, and the main tells it to close when the window loses the focus.
 *
 * The gestures of US5: the left button drags the Jobu (`usePetDrag`: 4 px tell it from a click, and the click that
 * ends a drag is swallowed), the right button asks the main for the menu with the place of the click, and Ctrl +
 * wheel over the Jobu steps the size. What each one DOES is the main's; this screen only reads the pointer.
 *
 * Life (US6, FR-030): a light sway at rest (CSS, from 0 to +4 px so the base never lifts off the taskbar), nearly
 * still while asleep, the hop of a new bubble and, once the art exists, a blink of 120 ms every 4 to 7 s. Nothing
 * of it runs for whoever asked the system for less motion.
 *
 * `data-pose` is the LOGICAL pose (`impatient`); `data-art` is the picture that was drawn for it (the
 * stand-in `skeptical` while the art of `impatient` does not exist, FR-029); `data-blinking` is `true` for the 120 ms of
 * a blink. `data-interactive` is what the click test last told the main: `true` while the pointer is over the Jobu, the
 * badge, the bubble or the list. `data-list` is `open` while the list shows, `data-silenced` mirrors the view, and
 * `data-dragging` is `true` while the owner holds the Jobu.
 */
export function PetApp(): React.JSX.Element {
  const [view, setView] = useState<PetView | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [blinking, setBlinking] = useState(false);
  /** Item 18: the pose the Jobu takes while he talks as the Líder (the bubble decides it from what is being said). */
  const [talkPose, setTalkPose] = useState<TalkPose | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe BEFORE saying ready: the main answers `ready` with the current view, and an answer
    // that came with nobody listening would be lost.
    const unsubscribe = window.donel.pet.onView(setView);
    window.donel.pet.ready();
    return unsubscribe;
  }, []);

  // Item 18: the bubble of the Líder is open (the main grew the window for it: `view.talk` is its height).
  const talking = view !== null && view.talk > 0;
  const talkArt = talking && talkPose !== null && AVAILABLE_ART.has(talkPose) ? talkPose : null;
  const art = view === null ? null : (talkArt ?? resolvePose(view.pose, AVAILABLE_ART));
  // While the Líder talks, his bubble says everything: the little bubble and the list stay out of the way.
  const bubble = talking ? null : (view?.bubble ?? null);
  const waiting = view?.waiting ?? [];
  // A list of one is no list: it needs two or more to be worth opening (FR-023), and it goes when they drop to one.
  const listVisible = !talking && listOpen && waiting.length >= 2;
  // What is under a pointer that does not move changes when the badge, the bubble or the list comes or goes (or says something else).
  const refreshKey = `${view?.badge ?? ''}|${bubble?.id ?? ''}:${bubble?.text ?? ''}|${listVisible ? `list${waiting.length}` : ''}|talk${view?.talk ?? 0}`;
  const { interactive, isHit } = usePetHitTest({ figure: figureRef, arts: POSE_ART, art, size: view?.size ?? null, refreshKey, locked: dragging });

  // FR-030: one hop per bubble, keyed by its id: a bubble that grew into an aggregate keeps its id and does not hop twice.
  const bubbleId = bubble?.id ?? null;
  const hoppedForRef = useRef<number | null>(null);
  const sizeRef = useRef(PET_SIZE_DEFAULT);
  sizeRef.current = view?.size ?? sizeRef.current;
  useEffect(() => {
    if (bubbleId === null || bubbleId === hoppedForRef.current) return;
    hoppedForRef.current = bubbleId;
    hop(figureRef.current, sizeRef.current);
  }, [bubbleId]);

  // T053 (FR-030): the blink. It exists only for a pose whose own picture is on screen AND has a blink frame in the folder
  // of the poses: with no frame there is no blink, and the day the PNG arrives it starts with no change here.
  const blinkFrame = view === null || talkArt !== null ? null : blinkFrameFor(view.pose, art, AVAILABLE_ART);
  useEffect(() => {
    if (blinkFrame === null || prefersReducedMotion()) return undefined;
    const scheduler = createBlinkScheduler({
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      random: Math.random,
      onChange: setBlinking,
    });
    scheduler.start();
    return () => scheduler.stop(); // stopping with the eyes shut opens them: a pose that changed never keeps a closed frame
  }, [blinkFrame]);
  const drawn = blinking && blinkFrame !== null ? blinkFrame : art;

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

  // T048 (FR-033): Ctrl + wheel over the Jobu steps the size. The listener is NATIVE and not passive: React's own
  // wheel listener is passive, and only a handler that can `preventDefault` keeps the page from zooming with the wheel.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    let piled = 0; // a touchpad sends many small deltas: they pile up until they make a notch
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!isHit(event.clientX, event.clientY)) return;
      const { steps, rest } = wheelSteps(piled, normalizeWheelDelta(event.deltaY, event.deltaMode));
      piled = rest;
      for (let step = 0; step < Math.abs(steps); step += 1) window.donel.pet.resizeStep(steps > 0 ? 1 : -1);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [isHit]);

  // T046 (R11): the drag. Grabbing the Jobu closes the list: it would float along with him.
  const onDraggingChange = useCallback((now: boolean): void => {
    setDragging(now);
    if (now) setListOpen(false);
  }, []);
  const drag = usePetDrag(isHit, onDraggingChange);

  /**
   * Item 18: a click on the drawing or on the badge (the badge is part of the Jobu) opens the bubble of the conversation with
   * the Líder, or closes it. Always: who waits for the owner shows inside the bubble, each with a way to its tab.
   */
  const onJobuClick = useCallback(
    (event: React.MouseEvent): void => {
      if (view === null || !isHit(event.clientX, event.clientY)) return; // the transparent corner of the box is not the Jobu
      setListOpen(false);
      window.donel.pet.setTalk(!(view.talk > 0));
    },
    [view, isHit],
  );
  const closeTalk = useCallback((): void => window.donel.pet.setTalk(false), []);
  // The pose of the conversation is forgotten when the bubble closes: the Jobu goes back to what the sessions ask for.
  useEffect(() => {
    if (!talking) setTalkPose(null);
  }, [talking]);

  /** The click that ends a drag is not a click on the Jobu: it is swallowed before the drawing, the badge, the bubble or the list see it. */
  const onClickCapture = (event: React.MouseEvent): void => {
    if (!drag.consumeClick()) return;
    event.stopPropagation();
    event.preventDefault();
  };

  /** T047: the right button asks the main for the menu, at the place of the click; the menu itself is the main's (native). */
  const onContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    if (view === null || !isHit(event.clientX, event.clientY)) return;
    setListOpen(false);
    window.donel.pet.openContextMenu({ screenX: event.screenX, screenY: event.screenY });
  };

  /** A click on the bubble goes where the bubble says (FR-025). */
  const onBubbleClick = (): void => {
    if (view === null || bubble === null) return;
    const decision = decideBubbleClick(bubble, view.waiting);
    // Several waiting: the bubble of the Líder lists them, each with a way to its tab.
    if (decision.kind === 'list') window.donel.pet.setTalk(true);
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
      ref={rootRef}
      className={styles.root}
      data-testid="pet-root"
      data-pose={view?.pose ?? 'sleeping'}
      data-art={art ?? undefined}
      data-blinking={String(blinking)}
      data-badge={view?.badge ?? undefined}
      data-bubble={bubble?.text ?? undefined}
      data-list={listVisible ? 'open' : 'closed'}
      data-talk={talking ? 'open' : 'closed'}
      data-docked={view === null ? undefined : String(view.docked)}
      data-align={view?.align}
      data-size={view === null ? undefined : String(view.size)}
      data-silenced={view === null ? undefined : String(view.silenced)}
      data-dragging={String(dragging)}
      data-interactive={String(interactive)}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
    >
      {/* What the bubble says, for whoever reads the screen with a reader: a live region has to exist before its text changes. */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {bubble?.text ?? ''}
      </div>
      {view !== null && metrics !== null && (
        // The stage is the part of the drawing above the anchor, so its bottom edge IS the base point.
        // `--sway` is how far the rest sway goes down, in proportion to the drawing (4 px at the medium size).
        <div
          className={styles.stage}
          style={{ width: metrics.width, height: metrics.anchorY, '--stage-w': `${metrics.width}px`, '--sway': `${(view.size / PET_SIZE_DEFAULT) * 4}px` } as React.CSSProperties}
        >
          {/* The picture is the `img`; the bubble and the list are buttons, and an `img` hides its children from a screen reader. */}
          <div
            className={styles.clip}
            role="img"
            aria-label={petLabel(view)}
            style={fade === undefined ? undefined : { maskImage: fade, WebkitMaskImage: fade }}
          >
            <div
              ref={figureRef}
              className={styles.figure}
              data-testid="pet-figure"
              style={{ width: metrics.width, height: metrics.height }}
              onClick={onJobuClick}
              onPointerDown={drag.onPointerDown}
            >
              {/* The sway moves the pictures inside the figure, so it composes with the hop of the figure itself. */}
              <div className={styles.sway}>
                {[...POSE_ART].map(([name, url]) => (
                  <img key={name} className={styles.pose} data-active={String(name === drawn)} src={url} alt="" draggable={false} />
                ))}
              </div>
            </div>
          </div>
          {view.badge !== null && (
            <span className={styles.badge} data-hit data-testid="pet-badge" onClick={onJobuClick} onPointerDown={drag.onPointerDown}>
              {view.badge}
            </span>
          )}
          {talking && <LiderTalk view={view} onClose={closeTalk} onPose={setTalkPose} />}
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
