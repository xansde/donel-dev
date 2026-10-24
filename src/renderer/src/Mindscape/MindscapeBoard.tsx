import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MindscapeBoard as Board, MindscapeCard } from '../../../shared/mindscape/model';
import styles from './Mindscape.module.css';

/** Pointer travel (px) before a press becomes a drag — below it, click and double click stay intact. */
const DRAG_THRESHOLD = 4;

type Preview = { readonly kind: 'card'; readonly id: string; readonly x: number; readonly y: number } | { readonly kind: 'pan'; readonly x: number; readonly y: number };

interface Gesture {
  readonly startX: number;
  readonly startY: number;
  /** Card being dragged, or `undefined` when the press started on the background (pan). */
  readonly cardId?: string;
  readonly originX: number;
  readonly originY: number;
  moved: boolean;
  lastX: number;
  lastY: number;
}

export interface MindscapeBoardProps {
  readonly board: Board;
  /** `pointerup` of a card drag — the only moment the position is written. */
  readonly onMoveCard: (cardId: string, x: number, y: number) => void;
  /** `pointerup` of a background drag. */
  readonly onPan: (pan: { x: number; y: number }) => void;
  /** Plain click on the background (no drag) — clears the selection. */
  readonly onBackgroundClick: () => void;
  /** Renders the cards inside the moving plane, with the live position of each one. */
  readonly children: (positionOf: (card: MindscapeCard) => { x: number; y: number }) => ReactNode;
}

/** Elements inside a card that keep their own pointer behavior (no drag from them). */
const INTERACTIVE = 'button, textarea, input, select, a, [data-no-drag]';

/**
 * Mindscape, fatia 04 — the free canvas: the plane moves with
 * `transform: translate(pan)`; dragging a card moves the card, dragging the
 * background moves the plane. The live position is applied in a
 * `requestAnimationFrame` and saved only on `pointerup`.
 */
export function MindscapeBoard({ board, onMoveCard, onPan, onBackgroundClick, children }: MindscapeBoardProps): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  /** A drag just ended: the click that follows it is not a "plain click" on the background. */
  const suppressClickRef = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const callbacksRef = useRef({ onMoveCard, onPan });
  callbacksRef.current = { onMoveCard, onPan };

  const previewOf = useCallback((gesture: Gesture): Preview => {
    // Whole pixels: pointer coordinates are fractional under display scaling.
    const dx = Math.round(gesture.lastX - gesture.startX);
    const dy = Math.round(gesture.lastY - gesture.startY);
    return gesture.cardId
      ? { kind: 'card', id: gesture.cardId, x: gesture.originX + dx, y: gesture.originY + dy }
      : { kind: 'pan', x: gesture.originX + dx, y: gesture.originY + dy };
  }, []);

  /** Removes the window listeners of the gesture in flight. */
  const detachRef = useRef<(() => void) | null>(null);

  const endGesture = useCallback((): void => {
    detachRef.current?.();
    detachRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    gestureRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => () => endGesture(), [endGesture]);

  const attachGesture = (): void => {
    const move = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      if (!gesture.moved && Math.abs(event.clientX - gesture.startX) + Math.abs(event.clientY - gesture.startY) <= DRAG_THRESHOLD) return;
      gesture.moved = true;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (gestureRef.current) setPreview(previewOf(gestureRef.current));
      });
    };
    const up = (): void => {
      const gesture = gestureRef.current;
      if (gesture?.moved) {
        suppressClickRef.current = true;
        const final = previewOf(gesture);
        if (final.kind === 'card') callbacksRef.current.onMoveCard(final.id, final.x, final.y);
        else callbacksRef.current.onPan({ x: final.x, y: final.y });
      }
      endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || gestureRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const cardId = target.closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    const card = cardId ? boardRef.current.cards[cardId] : undefined;
    if (cardId && !card) return;
    const origin = card ? { x: card.x, y: card.y } : boardRef.current.pan;
    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      cardId: card?.id,
      originX: origin.x,
      originY: origin.y,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    suppressClickRef.current = false;
    attachGesture();
  };

  const pan = preview?.kind === 'pan' ? preview : board.pan;
  const positionOf = (card: MindscapeCard): { x: number; y: number } =>
    preview?.kind === 'card' && preview.id === card.id ? { x: preview.x, y: preview.y } : { x: card.x, y: card.y };

  return (
    <div
      className={preview?.kind === 'pan' ? `${styles.view} ${styles.panning}` : styles.view}
      data-testid="mindscape-board"
      data-pan={`${board.pan.x},${board.pan.y}`}
      data-dragging={preview?.kind === 'card' ? preview.id : undefined}
      onPointerDown={handlePointerDown}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (event.target === event.currentTarget || event.target === event.currentTarget.firstElementChild) onBackgroundClick();
      }}
    >
      <div className={styles.world} data-testid="mindscape-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        {children(positionOf)}
      </div>
    </div>
  );
}
