import { useCallback, useEffect, useRef } from 'react';
import { exceedsDragThreshold } from '../../../shared/pet/gestures';

/**
 * T046 (015-jobu-pet, US5, R11/FR-004) - dragging the Jobu, on the React side. The window of the pet is moved by
 * the main; this hook only reads the pointer and tells it in SCREEN coordinates (`MouseEvent.screenX/Y`, in DIP),
 * which do not change when the window moves under the pointer. There is no `-webkit-app-region: drag` on purpose:
 * it swallows the click, and the click on the Jobu is what takes the owner to the session.
 *
 *  - A press on the Jobu (the drawing by its alpha, or the badge) with the left button starts watching.
 *  - Until the pointer has gone 4 px from where it went down it is still a click: nothing is sent, and the
 *    `click` that follows is the normal one.
 *  - From then on it is a drag: `dragStart` with the point where it went down, a `dragMove` for every move,
 *    and `dragEnd` when the button is released (or the gesture is cancelled).
 *  - The `click` the browser fires after a drag is NOT a click on the Jobu: `consumeClick` says so once, and the
 *    root of the screen swallows it before the handlers of the drawing and the badge see it.
 *
 * The listeners are on the window, and the pointer is captured by the element that was pressed: a drag that
 * leaves the 480 px of the window (the window follows a moment later) keeps its events.
 */
export interface PetDrag {
  /** `onPointerDown` of the drawing and of the badge. */
  readonly onPointerDown: (event: React.PointerEvent) => void;
  /** `true` once right after a drag ended: the `click` that comes next is not a click on the Jobu. Asking resets it. */
  readonly consumeClick: () => boolean;
}

export function usePetDrag(isHit: (clientX: number, clientY: number) => boolean, onDraggingChange: (dragging: boolean) => void): PetDrag {
  const swallowClickRef = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const changeRef = useRef(onDraggingChange);
  changeRef.current = onDraggingChange;

  // The screen going away in the middle of a drag drops the listeners with it.
  useEffect(() => () => releaseRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      if (event.button !== 0 || !isHit(event.clientX, event.clientY)) return;
      releaseRef.current?.();

      const origin = { x: event.screenX, y: event.screenY };
      let latest = origin;
      let started = false;
      const target = event.currentTarget as Element;
      const pointerId = event.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // No capture is no problem: the window listeners below still get the events while the button is down.
      }

      const onMove = (move: PointerEvent): void => {
        latest = { x: move.screenX, y: move.screenY };
        if (!started) {
          if (!exceedsDragThreshold(origin, latest)) return;
          started = true;
          changeRef.current(true);
          window.donel.pet.dragStart(origin.x, origin.y);
        }
        window.donel.pet.dragMove(latest.x, latest.y);
      };

      const finish = (up: PointerEvent | null): void => {
        release();
        if (!started) return; // it never left the 4 px: this was a click, and the click is handled as always
        const end = up === null ? latest : { x: up.screenX, y: up.screenY };
        window.donel.pet.dragEnd(end.x, end.y);
        changeRef.current(false);
        // The `click` that the browser fires after the release is the end of the drag, not a click on the Jobu. It comes
        // right after the `pointerup`, so the mark is lifted on the next turn in case no click comes at all.
        swallowClickRef.current = true;
        window.setTimeout(() => {
          swallowClickRef.current = false;
        }, 0);
      };
      const onUp = (up: PointerEvent): void => finish(up);
      const onCancel = (): void => finish(null);

      function release(): void {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          // Already released (the button went up): nothing to do.
        }
        releaseRef.current = null;
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      releaseRef.current = () => {
        // Unmounted or replaced by another press mid-drag: let go, and close the drag if it had begun.
        const wasStarted = started;
        release();
        if (wasStarted) {
          window.donel.pet.dragEnd(latest.x, latest.y);
          changeRef.current(false);
        }
      };
    },
    [isHit],
  );

  const consumeClick = useCallback((): boolean => {
    const swallow = swallowClickRef.current;
    swallowClickRef.current = false;
    return swallow;
  }, []);

  return { onPointerDown, consumeClick };
}
