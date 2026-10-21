import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { isOpaqueAt, loadImage, maskSizeFor, readAlphaMask, type AlphaMask } from './hitTest';

/**
 * T028 (015-jobu-pet, US1, R9/FR-006) - the click test of the pet window, on the React side. The window
 * ignores the mouse and only receives the forwarded `mousemove`; on every one the hook asks whether the
 * pointer is over the Jobu (the alpha of the pose on screen, at the size it is drawn) or over something
 * marked `data-hit` (the badge, the bubble, the list), and tells the main (`pet:interactive`) ONLY when
 * the answer changes.
 *
 * The alpha of each pose is read once from a canvas that is never put on the page, at the current size,
 * and the pose on screen goes first so a pose change finds its mask ready. A new size throws the masks
 * away (they are a few KB each) and reads them again from the pictures, which are decoded only once.
 *
 * `locked` holds the window interactive for the whole of a drag (US5). Returns what was last sent to the main (`interactive`: `data-interactive` mirrors it, which is also how
 * the smoke proves the whole chain - position, scale, alpha - without a real mouse) and `isHit`, the same
 * question for any point: a click handler asks it so a click on the transparent corner of the drawing's
 * box is not taken for a click on the Jobu.
 */

/** The pictures, decoded once: the same art is read again at every new size. */
const IMAGES = new Map<string, HTMLImageElement>();
/** The masks of the size they were read at. */
const MASKS = new Map<string, AlphaMask>();
let masksSize = 0;

export interface PetHitTestSource {
  /** The box the PNG is drawn in: its rectangle is where the alpha is. */
  readonly figure: RefObject<HTMLElement | null>;
  /** The picture of every pose that exists, by pose name. */
  readonly arts: ReadonlyMap<string, string>;
  /** The pose on screen now (a name in `arts`), or `null` before the first view. */
  readonly art: string | null;
  /** The height the drawing has now, or `null` before the first view. */
  readonly size: number | null;
  /** Changes whenever what is under a pointer that does not move changes (a `data-hit` element came or went). */
  readonly refreshKey: string;
  /**
   * While the owner drags the Jobu the window is held interactive whatever is under the pointer: the window moves
   * under the pointer a moment after it, and a pointer that is for one frame over the transparent void would give
   * the mouse back to the window below and lose the end of the drag.
   */
  readonly locked: boolean;
}

export interface PetHitTest {
  /** What the main was last told: the window receives the mouse while the pointer is over the Jobu. */
  readonly interactive: boolean;
  /** Is the Jobu (the drawing by its alpha, or anything marked `data-hit`) under this point of the page? */
  readonly isHit: (clientX: number, clientY: number) => boolean;
}

export function usePetHitTest({ figure, arts, art, size, refreshKey, locked }: PetHitTestSource): PetHitTest {
  const [interactive, setInteractive] = useState(false);
  /** What the main knows: the window is born ignoring the mouse. */
  const sentRef = useRef(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const maskRef = useRef<AlphaMask | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  const isHit = useCallback(
    (clientX: number, clientY: number): boolean => {
      // Something marked `data-hit` is part of the Jobu.
      if (document.elementFromPoint(clientX, clientY)?.closest('[data-hit]')) return true;
      const box = figure.current;
      return box !== null && isOpaqueAt(maskRef.current, box.getBoundingClientRect(), clientX, clientY);
    },
    [figure],
  );

  const decide = useCallback(() => {
    const pointer = pointerRef.current;
    const hit = lockedRef.current || (pointer !== null && isHit(pointer.x, pointer.y));
    if (hit === sentRef.current) return;
    sentRef.current = hit;
    setInteractive(hit);
    window.donel.pet.setInteractive(hit);
  }, [isHit]);

  // The pointer: the forwarded `mousemove` while the window ignores the mouse, the real one while it does not.
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      decide();
    };
    const onLeave = (): void => {
      pointerRef.current = null;
      decide();
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [decide]);

  // A badge, a bubble or a list that shows up under a pointer that does not move changes the answer too, and so
  // does the end of a drag (the lock comes off and the pointer is judged again).
  useEffect(() => {
    decide();
  }, [refreshKey, locked, decide]);

  // The masks. A pose that changes under a pointer that does not move changes the answer as well.
  useEffect(() => {
    if (size === null) return undefined;
    let cancelled = false;
    if (masksSize !== size) {
      MASKS.clear();
      masksSize = size;
    }
    const { width, height } = maskSizeFor(size);
    const names = art === null ? [...arts.keys()] : [art, ...[...arts.keys()].filter((name) => name !== art)];

    void (async () => {
      for (const name of names) {
        if (cancelled) return;
        if (!MASKS.has(name)) {
          let image = IMAGES.get(name);
          if (image === undefined) {
            const url = arts.get(name);
            if (url === undefined) continue;
            try {
              image = await loadImage(url);
            } catch (error) {
              console.error(`[donel-dev] a arte "${name}" do Jobu não decodificou:`, error);
              continue;
            }
            IMAGES.set(name, image);
            if (cancelled) return;
          }
          try {
            MASKS.set(name, readAlphaMask(image, width, height));
          } catch (error) {
            // Without a readable canvas no pose will have a mask: say so once and keep the clicks going through.
            console.error('[donel-dev] o teste de clique do Jobu não consegue ler o alfa da arte:', error);
            return;
          }
        }
        if (name === art) {
          maskRef.current = MASKS.get(name) ?? null;
          decide();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [art, arts, size, decide]);

  return { interactive, isHit };
}
