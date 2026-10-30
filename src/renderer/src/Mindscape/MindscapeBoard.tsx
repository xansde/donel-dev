import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { translateDrawing } from '../../../shared/mindscape/drawings';
import { cardAtPoint, hitTestDrawings, itemsInsideRect, resizeDrawing, type CardRect, type ItemIds, type Rect, type ResizeHandle } from '../../../shared/mindscape/geometry';
import type { MindscapeBoard as Board, MindscapeCard, MindscapeDrawing } from '../../../shared/mindscape/model';
import type { MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { screenToWorld, type Point } from '../../../shared/mindscape/view';
import styles from './Mindscape.module.css';

/** Pointer travel (px) before a press becomes a drag — below it, click and double click stay intact; a shorter drawing is dropped. */
const DRAG_THRESHOLD = 4;
/** Hit-test slack of a drawing, in px of screen (design: `stroke/2 + 6 px de tela`). */
const HIT_SLACK_PX = 6;

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

export const EMPTY_ITEMS: ItemIds = { cards: [], drawings: [] };

type Item = { readonly kind: 'cards' | 'drawings'; readonly id: string };

function has(ids: ItemIds, item: Item): boolean {
  return ids[item.kind].includes(item.id);
}

function union(a: ItemIds, b: ItemIds): ItemIds {
  return { cards: [...new Set([...a.cards, ...b.cards])], drawings: [...new Set([...a.drawings, ...b.drawings])] };
}

function only(item: Item): ItemIds {
  return item.kind === 'cards' ? { cards: [item.id], drawings: [] } : { cards: [], drawings: [item.id] };
}

function without(ids: ItemIds, item: Item): ItemIds {
  return { ...ids, [item.kind]: ids[item.kind].filter((id) => id !== item.id) };
}

type Preview =
  | { readonly kind: 'move'; readonly ids: ItemIds; readonly dx: number; readonly dy: number }
  | { readonly kind: 'pan'; readonly x: number; readonly y: number }
  | { readonly kind: 'draw'; readonly gesture: DrawGesture }
  | { readonly kind: 'lasso'; readonly rect: Rect }
  | { readonly kind: 'resize'; readonly drawing: MindscapeDrawing };

interface Gesture {
  readonly kind: 'move' | 'pan' | 'draw' | 'lasso' | 'resize';
  readonly startX: number;
  readonly startY: number;
  /** `pan`: the pan when the drag started. */
  readonly originX: number;
  readonly originY: number;
  /** Top-left of the board element on screen, read on `pointerdown`. */
  readonly viewLeft: number;
  readonly viewTop: number;
  /** `move`: the items that travel together. */
  readonly ids?: ItemIds;
  /** `move`: a press with no drag narrows the selection to this item (`only`) or takes it out (`toggle-off`). */
  readonly click?: { readonly item: Item; readonly action: 'only' | 'toggle-off' };
  /** `lasso`: Shift adds to the selection that existed before. */
  readonly base?: ItemIds;
  /** `resize`: the drawing as it was and the handle being dragged. */
  readonly drawing?: MindscapeDrawing;
  readonly handle?: ResizeHandle;
  /** `draw`: the gesture so far (board units). */
  draw?: DrawGesture;
  /** `pan` started by H or space: the click that ends it reaches nobody. */
  readonly swallow?: boolean;
  moved: boolean;
  lastX: number;
  lastY: number;
}

/** What the board hands to its children: live positions and drawings (previews applied), the drawing in progress and the lasso. */
export interface BoardRender {
  readonly positionOf: (card: MindscapeCard) => { x: number; y: number };
  readonly drawings: readonly MindscapeDrawing[];
  readonly draft: DrawGesture | null;
  readonly lasso: Rect | null;
}

export interface MindscapeBoardProps {
  readonly board: Board;
  readonly tool: MindscapeTool;
  /** Space held: any drag moves the view, whatever the tool. */
  readonly panMode: boolean;
  /** Rects of the cards on screen, in drawing order — the hit-test of the arrow/line ends and the lasso. */
  readonly cardRects: readonly CardRect[];
  /** The selection (cards and drawings that exist on screen). */
  readonly selection: ItemIds;
  readonly onSelect: (next: ItemIds) => void;
  /** `pointerup` of a drag of the selection — the only moment the positions are written (one entry). */
  readonly onMoveItems: (ids: ItemIds, dx: number, dy: number) => void;
  /** `pointerup` of a handle drag. */
  readonly onResize: (drawing: MindscapeDrawing) => void;
  /** `pointerup` of a hand drag (H or space). */
  readonly onPan: (pan: { x: number; y: number }) => void;
  /** `pointerup` of a drawing gesture longer than the threshold. */
  readonly onDraw: (gesture: DrawGesture) => void;
  /** Plain click on the background (no drag) — clears the selection. */
  readonly onBackgroundClick: () => void;
  /** Desenho, fatia 02 — a gesture starts (`pointerdown`) or ends; Ctrl+Z is ignored in between. */
  readonly onGestureChange?: (active: boolean) => void;
  /** Renders the layers and the cards inside the moving plane. */
  readonly children: (render: BoardRender) => ReactNode;
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
 * translate(pan)`. With V (desenho, fatia 03), a press on a card or a drawing
 * selects it (Shift adds or takes out) and a drag moves the whole selection,
 * a drag on the background draws the lasso and the handles resize the single
 * selected drawing; with H, or with space held, any drag moves the plane; with
 * A/L/R/O, a drag draws (local preview, written on `pointerup`). A tool change
 * cancels the gesture in flight (Esc goes back to V).
 */
export function MindscapeBoard({
  board,
  tool,
  panMode,
  cardRects,
  selection,
  onSelect,
  onMoveItems,
  onResize,
  onPan,
  onDraw,
  onBackgroundClick,
  onGestureChange,
  children,
}: MindscapeBoardProps): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  /** A drag (or a press on an item) just ended: the click that follows it is not a "plain click" on the background. */
  const suppressClickRef = useRef(false);
  /** A drawing or a hand drag just ended: the click that follows it reaches nobody (no card selected, no link). */
  const swallowClickRef = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const rectsRef = useRef(cardRects);
  rectsRef.current = cardRects;
  const callbacksRef = useRef({ onMoveItems, onResize, onPan, onDraw, onSelect, onGestureChange });
  callbacksRef.current = { onMoveItems, onResize, onPan, onDraw, onSelect, onGestureChange };

  const worldAt = useCallback((gesture: Gesture, clientX: number, clientY: number): Point => {
    const view = { pan: boardRef.current.pan, zoom: boardRef.current.zoom };
    const point = screenToWorld({ x: clientX - gesture.viewLeft, y: clientY - gesture.viewTop }, view);
    return { x: round(point.x), y: round(point.y) };
  }, []);

  const previewOf = useCallback(
    (gesture: Gesture): Preview => {
      // Whole pixels: pointer coordinates are fractional under display scaling.
      const dx = Math.round(gesture.lastX - gesture.startX);
      const dy = Math.round(gesture.lastY - gesture.startY);
      switch (gesture.kind) {
        case 'draw':
          return { kind: 'draw', gesture: { ...gesture.draw!, end: worldAt(gesture, gesture.lastX, gesture.lastY) } };
        case 'move': {
          const zoom = boardRef.current.zoom;
          return { kind: 'move', ids: gesture.ids!, dx: round(dx / zoom), dy: round(dy / zoom) };
        }
        case 'lasso': {
          const start = worldAt(gesture, gesture.startX, gesture.startY);
          const end = worldAt(gesture, gesture.lastX, gesture.lastY);
          return { kind: 'lasso', rect: { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y } };
        }
        case 'resize':
          return { kind: 'resize', drawing: resizeDrawing(gesture.drawing!, gesture.handle!, worldAt(gesture, gesture.lastX, gesture.lastY)) };
        case 'pan':
          return { kind: 'pan', x: gesture.originX + dx, y: gesture.originY + dy };
      }
    },
    [worldAt],
  );

  /** Removes the window listeners of the gesture in flight. */
  const detachRef = useRef<(() => void) | null>(null);

  const endGesture = useCallback((): void => {
    if (gestureRef.current) callbacksRef.current.onGestureChange?.(false);
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

  const finish = (gesture: Gesture): void => {
    const callbacks = callbacksRef.current;
    if (!gesture.moved) {
      // A press with no drag on an already selected item: narrow to it, or (Shift) take it out.
      if (gesture.kind === 'move' && gesture.click) {
        const { item, action } = gesture.click;
        callbacks.onSelect(action === 'only' ? only(item) : without(gesture.ids!, item));
      }
      return;
    }
    suppressClickRef.current = true;
    const final = previewOf(gesture);
    switch (final.kind) {
      case 'move':
        callbacks.onMoveItems(final.ids, final.dx, final.dy);
        break;
      case 'pan':
        if (gesture.swallow) swallowClickRef.current = true;
        callbacks.onPan({ x: final.x, y: final.y });
        break;
      case 'lasso': {
        const inside = itemsInsideRect(final.rect, rectsRef.current, boardRef.current.drawings);
        callbacks.onSelect(gesture.base ? union(gesture.base, inside) : inside);
        break;
      }
      case 'resize':
        callbacks.onResize(final.drawing);
        break;
      case 'draw':
        swallowClickRef.current = true;
        callbacks.onDraw({ ...final.gesture, toCard: cardAtPoint(final.gesture.end, rectsRef.current) });
        break;
    }
  };

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
      if (gesture) finish(gesture);
      endGesture();
    };
    callbacksRef.current.onGestureChange?.(true);
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
      originX: 0,
      originY: 0,
      viewLeft: viewBox.left,
      viewTop: viewBox.top,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    if (panMode || tool === 'hand') {
      if (target.closest(EDITABLE)) return;
      gestureRef.current = { ...base, kind: 'pan', originX: boardRef.current.pan.x, originY: boardRef.current.pan.y, swallow: true };
      attachGesture();
      return;
    }
    if (isDrawTool(tool)) {
      if (target.closest(EDITABLE)) return;
      const gesture: Gesture = { ...base, kind: 'draw' };
      const start = worldAt(gesture, event.clientX, event.clientY);
      gesture.draw = { tool, id: crypto.randomUUID(), start, end: start, fromCard: cardAtPoint(start, rectsRef.current), toCard: null };
      gestureRef.current = gesture;
      attachGesture();
      return;
    }
    // V: a handle of the single selected drawing resizes it.
    const handleElement = target.closest<SVGElement>('[data-handle]');
    if (handleElement) {
      const drawing = boardRef.current.drawings.find((candidate) => candidate.id === handleElement.dataset.drawingId);
      if (!drawing) return;
      gestureRef.current = { ...base, kind: 'resize', drawing, handle: handleElement.dataset.handle as ResizeHandle };
      attachGesture();
      return;
    }
    if (target.closest(INTERACTIVE)) return;
    const cardId = target.closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    if (cardId && !boardRef.current.cards[cardId]) return;
    let item: Item | null = cardId ? { kind: 'cards', id: cardId } : null;
    if (!item) {
      const point = worldAt({ ...base, kind: 'move' }, event.clientX, event.clientY);
      const drawingId = hitTestDrawings(boardRef.current.drawings, point, HIT_SLACK_PX / boardRef.current.zoom);
      if (drawingId) item = { kind: 'drawings', id: drawingId };
    }
    if (!item) {
      // The background: the lasso (Shift adds to what was selected).
      gestureRef.current = { ...base, kind: 'lasso', base: event.shiftKey ? selection : undefined };
      attachGesture();
      return;
    }
    // A press on an item is never a click on the background.
    suppressClickRef.current = true;
    const selected = has(selection, item);
    let ids: ItemIds;
    let click: Gesture['click'];
    if (event.shiftKey) {
      ids = selected ? selection : union(selection, only(item));
      click = selected ? { item, action: 'toggle-off' } : undefined;
    } else {
      ids = selected ? selection : only(item);
      click = selected ? { item, action: 'only' } : undefined;
    }
    if (!selected) callbacksRef.current.onSelect(ids);
    gestureRef.current = { ...base, kind: 'move', ids, click };
    attachGesture();
  };

  const pan = preview?.kind === 'pan' ? preview : board.pan;
  const moving = preview?.kind === 'move' ? preview : null;
  const positionOf = (card: MindscapeCard): { x: number; y: number } =>
    moving && moving.ids.cards.includes(card.id) ? { x: card.x + moving.dx, y: card.y + moving.dy } : { x: card.x, y: card.y };
  const resized = preview?.kind === 'resize' ? preview.drawing : null;
  const drawings =
    moving && moving.ids.drawings.length > 0
      ? board.drawings.map((drawing) => (moving.ids.drawings.includes(drawing.id) ? translateDrawing(drawing, moving.dx, moving.dy) : drawing))
      : resized
        ? board.drawings.map((drawing) => (drawing.id === resized.id ? resized : drawing))
        : board.drawings;

  return (
    <div
      className={preview?.kind === 'pan' ? `${styles.view} ${styles.panning}` : styles.view}
      data-testid="mindscape-board"
      data-tool={tool}
      data-space={panMode ? 'true' : undefined}
      data-pan={`${board.pan.x},${board.pan.y}`}
      data-dragging={moving ? 'true' : undefined}
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
        {children({
          positionOf,
          drawings,
          draft: preview?.kind === 'draw' ? preview.gesture : null,
          lasso: preview?.kind === 'lasso' ? preview.rect : null,
        })}
      </div>
    </div>
  );
}
