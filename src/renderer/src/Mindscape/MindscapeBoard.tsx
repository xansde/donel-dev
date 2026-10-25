import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cardAtPoint, type CardRect } from '../../../shared/mindscape/geometry';
import type { MindscapeBoard as Board, MindscapeCard } from '../../../shared/mindscape/model';
import type { MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { screenToWorld, type Point } from '../../../shared/mindscape/view';
import styles from './Mindscape.module.css';

/** Pointer travel (px) before a press becomes a drag — below it, click and double click stay intact; a shorter drawing is dropped. */
const DRAG_THRESHOLD = 4;

/** The tools that draw by dragging (fatia 01). */
export type DrawTool = Extract<MindscapeTool, 'arrow' | 'line' | 'rect' | 'ellipse'>;

export function isDrawTool(tool: MindscapeTool): tool is DrawTool {
  return tool === 'arrow' || tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

/** A drawing gesture, in board units. `toCard` is only known on `pointerup`. */
export interface DrawGesture {
  readonly tool: DrawTool;
  /** Id of the future drawing (or link), made on `pointerdown` so the preview has the same stroke. */
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
  /** Card under the pointer on `pointerdown`. */
  readonly fromCard: string | null;
  readonly toCard: string | null;
}

type Preview =
  | { readonly kind: 'card'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'pan'; readonly x: number; readonly y: number }
  | { readonly kind: 'draw'; readonly gesture: DrawGesture };

interface Gesture {
  readonly kind: 'card' | 'pan' | 'draw';
  readonly startX: number;
  readonly startY: number;
  /** Card being dragged (`card`). */
  readonly cardId?: string;
  readonly originX: number;
  readonly originY: number;
  /** `draw`: the gesture so far (board units). */
  draw?: DrawGesture;
  /** `draw`: top-left of the board element on screen, read on `pointerdown`. */
  readonly viewLeft: number;
  readonly viewTop: number;
  moved: boolean;
  lastX: number;
  lastY: number;
}

export interface MindscapeBoardProps {
  readonly board: Board;
  readonly tool: MindscapeTool;
  /** Rects of the cards on screen, in drawing order — the hit-test of the arrow/line ends. */
  readonly cardRects: readonly CardRect[];
  /** `pointerup` of a card drag — the only moment the position is written. */
  readonly onMoveCard: (cardId: string, x: number, y: number) => void;
  /** `pointerup` of a background drag (V) or of a hand drag (H). */
  readonly onPan: (pan: { x: number; y: number }) => void;
  /** `pointerup` of a drawing gesture longer than the threshold. */
  readonly onDraw: (gesture: DrawGesture) => void;
  /** Plain click on the background (no drag) — clears the selection. */
  readonly onBackgroundClick: () => void;
  /** Renders the cards inside the moving plane, with the live position of each one and the drawing in progress. */
  readonly children: (positionOf: (card: MindscapeCard) => { x: number; y: number }, draft: DrawGesture | null) => ReactNode;
}

/** Elements inside a card that keep their own pointer behavior (no drag from them, with V). */
const INTERACTIVE = 'button, textarea, input, select, a, [data-no-drag]';
/** Text fields: no tool starts a gesture from them. */
const EDITABLE = 'textarea, input, select, [contenteditable="true"]';

/** Tenth of a unit: enough for the eye, and what the file keeps. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Mindscape — the free canvas: the plane moves with `transform:
 * translate(pan)`. With V, dragging a card moves the card and dragging the
 * background moves the plane (V1, until fatia 03); with H, any drag moves the
 * plane; with A/L/R/O, a drag draws (local preview, written on `pointerup`).
 * A tool change cancels the gesture in flight (Esc goes back to V).
 */
export function MindscapeBoard({ board, tool, cardRects, onMoveCard, onPan, onDraw, onBackgroundClick, children }: MindscapeBoardProps): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  /** A drag just ended: the click that follows it is not a "plain click" on the background. */
  const suppressClickRef = useRef(false);
  /** A drawing or a hand drag just ended: the click that follows it reaches nobody (no card selected, no link). */
  const swallowClickRef = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const rectsRef = useRef(cardRects);
  rectsRef.current = cardRects;
  const callbacksRef = useRef({ onMoveCard, onPan, onDraw });
  callbacksRef.current = { onMoveCard, onPan, onDraw };

  const worldAt = useCallback((gesture: Gesture, clientX: number, clientY: number): Point => {
    const view = { pan: boardRef.current.pan, zoom: boardRef.current.zoom };
    const point = screenToWorld({ x: clientX - gesture.viewLeft, y: clientY - gesture.viewTop }, view);
    return { x: round(point.x), y: round(point.y) };
  }, []);

  const previewOf = useCallback(
    (gesture: Gesture): Preview => {
      if (gesture.kind === 'draw') {
        const end = worldAt(gesture, gesture.lastX, gesture.lastY);
        return { kind: 'draw', gesture: { ...gesture.draw!, end } };
      }
      // Whole pixels: pointer coordinates are fractional under display scaling.
      const dx = Math.round(gesture.lastX - gesture.startX);
      const dy = Math.round(gesture.lastY - gesture.startY);
      return gesture.kind === 'card'
        ? { kind: 'card', id: gesture.cardId!, x: gesture.originX + dx, y: gesture.originY + dy }
        : { kind: 'pan', x: gesture.originX + dx, y: gesture.originY + dy };
    },
    [worldAt],
  );

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
  // A tool change (a key, a button, Esc) cancels the gesture in flight: nothing is written.
  useEffect(() => endGesture(), [tool, endGesture]);

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
        else if (final.kind === 'pan') {
          if (gesture.kind === 'pan' && tool === 'hand') swallowClickRef.current = true;
          callbacksRef.current.onPan({ x: final.x, y: final.y });
        } else {
          swallowClickRef.current = true;
          callbacksRef.current.onDraw({ ...final.gesture, toCard: cardAtPoint(final.gesture.end, rectsRef.current) });
        }
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
    suppressClickRef.current = false;
    swallowClickRef.current = false;
    const viewBox = event.currentTarget.getBoundingClientRect();
    const base = {
      startX: event.clientX,
      startY: event.clientY,
      viewLeft: viewBox.left,
      viewTop: viewBox.top,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    if (isDrawTool(tool) || tool === 'hand') {
      if (target.closest(EDITABLE)) return;
      if (tool === 'hand') {
        gestureRef.current = { ...base, kind: 'pan', originX: boardRef.current.pan.x, originY: boardRef.current.pan.y };
      } else {
        const gesture: Gesture = { ...base, kind: 'draw', originX: 0, originY: 0 };
        const start = worldAt(gesture, event.clientX, event.clientY);
        gesture.draw = { tool, id: crypto.randomUUID(), start, end: start, fromCard: cardAtPoint(start, rectsRef.current), toCard: null };
        gestureRef.current = gesture;
      }
      attachGesture();
      return;
    }
    if (tool !== 'select' || target.closest(INTERACTIVE)) return;
    const cardId = target.closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    const card = cardId ? boardRef.current.cards[cardId] : undefined;
    if (cardId && !card) return;
    const origin = card ? { x: card.x, y: card.y } : boardRef.current.pan;
    gestureRef.current = { ...base, kind: card ? 'card' : 'pan', cardId: card?.id, originX: origin.x, originY: origin.y };
    attachGesture();
  };

  const pan = preview?.kind === 'pan' ? preview : board.pan;
  const positionOf = (card: MindscapeCard): { x: number; y: number } =>
    preview?.kind === 'card' && preview.id === card.id ? { x: preview.x, y: preview.y } : { x: card.x, y: card.y };

  return (
    <div
      className={preview?.kind === 'pan' ? `${styles.view} ${styles.panning}` : styles.view}
      data-testid="mindscape-board"
      data-tool={tool}
      data-pan={`${board.pan.x},${board.pan.y}`}
      data-dragging={preview?.kind === 'card' ? preview.id : undefined}
      onPointerDown={handlePointerDown}
      onClickCapture={(event) => {
        if (!swallowClickRef.current) return;
        swallowClickRef.current = false;
        suppressClickRef.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (event.target === event.currentTarget || event.target === event.currentTarget.firstElementChild) onBackgroundClick();
      }}
    >
      <div className={styles.world} data-testid="mindscape-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        {children(positionOf, preview?.kind === 'draw' ? preview.gesture : null)}
      </div>
    </div>
  );
}
