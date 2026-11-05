import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { appendPencilPoint, translateDrawing } from '../../../shared/mindscape/drawings';
import { eraseBoard } from '../../../shared/mindscape/eraser';
import { cardAtPoint, hitTestDrawings, itemsInsideRect, resizeDrawing, type CardRect, type ItemIds, type Rect, type ResizeHandle } from '../../../shared/mindscape/geometry';
import { isPrintInputType } from '../../../shared/mindscape/images';
import type { MindscapeBoard as Board, MindscapeCard, MindscapeDrawing, MindscapeLink } from '../../../shared/mindscape/model';
import { contextMenuAllowed, draggedPan, isDrag, pressActionFor, RIGHT_BUTTON } from '../../../shared/mindscape/pointer';
import type { MindscapeTool } from '../../../shared/mindscape/shortcuts';
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, stepZoom, wheelPan, wheelZoomFactor, zoomAt, zoomPercent, type BoardView, type Point } from '../../../shared/mindscape/view';
import { normalizeWheelDelta } from '../../../shared/pet/gestures';
import styles from './Mindscape.module.css';

/** Hit-test slack of a drawing, in px of screen (design: `stroke/2 + 6 px de tela`). */
const HIT_SLACK_PX = 6;
/** Desenho, fatia 04 — radius of the eraser, in px of screen (`8 / zoom` on the board). */
export const ERASER_RADIUS_PX = 8;
/** Desenho, fatia 05 — the dot grid of the background at 100% (px); it scales and moves with the view. */
const GRID_PX = 22;
/** Desenho, fatia 05 — "−" / "+" of the zoom indicator walk this many percentage points. */
const ZOOM_STEP_POINTS = 10;

/** The tools that draw by dragging (fatia 01; the pencil from fatia 04). */
export type DrawTool = Extract<MindscapeTool, 'arrow' | 'line' | 'rect' | 'ellipse' | 'pencil'>;

export function isDrawTool(tool: MindscapeTool): tool is DrawTool {
  return tool === 'arrow' || tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'pencil';
}

/** Card sizes by id, from the measured rects (the cards on screen) — what the eraser needs to find the links. */
export function sizesOf(rects: readonly CardRect[]): Record<string, { w: number; h: number }> {
  return Object.fromEntries(rects.map((rect) => [rect.id, { w: rect.w, h: rect.h }]));
}

/** Ids of the pieces in the local preview of an eraser pass (the real ones are made on `pointerup`). */
let previewPieceCount = 0;
function previewPieceId(): string {
  previewPieceCount += 1;
  return `erase-preview-${previewPieceCount}`;
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
  /** Pencil (fatia 04): the sampled stroke, flattened `[x0, y0, x1, y1, …]`. */
  readonly points?: number[];
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
  | { readonly kind: 'resize'; readonly drawing: MindscapeDrawing }
  | { readonly kind: 'erase'; readonly board: Board };

interface Gesture {
  readonly kind: 'move' | 'pan' | 'draw' | 'lasso' | 'resize' | 'erase';
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
  /** `erase`: the eraser path so far (flattened, board units) and the board with it applied (local preview). */
  path?: number[];
  erased?: Board;
  /** `pan` started by H, space or the right button: the click that ends it reaches nobody. */
  readonly swallow?: boolean;
  /** `MouseEvent.button` of the press (a right-button pan that moved eats the context menu). */
  readonly button: number;
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
  /** The links (fatia 04: an eraser pass in flight hides the ones it touched). */
  readonly links: readonly MindscapeLink[];
}

export interface MindscapeBoardProps {
  readonly board: Board;
  readonly tool: MindscapeTool;
  /** Space held: any drag moves the view, whatever the tool. */
  readonly panMode: boolean;
  /** Bumped by Esc: cancels the gesture in flight even when the tool does not change (V stays V). */
  readonly cancelSignal?: number;
  /** Rects of the cards on screen, in drawing order — the hit-test of the arrow/line ends and the lasso. */
  readonly cardRects: readonly CardRect[];
  /** The selection (cards and drawings that exist on screen). */
  readonly selection: ItemIds;
  readonly onSelect: (next: ItemIds) => void;
  /** `pointerup` of a drag of the selection — the only moment the positions are written (one entry). */
  readonly onMoveItems: (ids: ItemIds, dx: number, dy: number) => void;
  /** `pointerup` of a handle drag. */
  readonly onResize: (drawing: MindscapeDrawing) => void;
  /**
   * The view of the board changes (out of the history): `pointerup` of a hand
   * drag (H or space); desenho, fatia 05 — the wheel (Ctrl+wheel and the pinch
   * zoom on the mouse, the wheel alone moves the view) and the zoom indicator.
   * `change` gets the view as it is when applied, so wheel events in a row compose.
   */
  readonly onViewChange: (change: (view: BoardView) => BoardView) => void;
  /** `pointerup` of a drawing gesture longer than the threshold. */
  readonly onDraw: (gesture: DrawGesture) => void;
  /** Fatia 04 — `pointerup` of an eraser pass (a single press too): its whole path, flattened, in board units. */
  readonly onErase: (path: number[]) => void;
  /** Plain click on the background (no drag) — clears the selection. */
  readonly onBackgroundClick: () => void;
  /** Desenho, fatia 02 — a gesture starts (`pointerdown`) or ends; Ctrl+Z is ignored in between. */
  readonly onGestureChange?: (active: boolean) => void;
  /**
   * Desenho, fatia 06 — an image pasted (Ctrl+V, the focus out of a text
   * field) or dropped on the board: the file and where the print is born, in
   * board units (the drop point; for a paste, the last point of the mouse over
   * the board, else the middle of the view).
   */
  readonly onImageFile?: (file: File, at: Point) => void;
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

/** A target where a paste belongs to the field (the owner's post-it text, a terminal left focused underneath). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Fatia 06 — the first file of an image type the print takes (PNG, JPEG, WebP, GIF), or `null`. */
export function printFileOf(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (isPrintInputType(file.type)) return file;
  return null;
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes('Files'));
}

/**
 * Mindscape — the free canvas: the plane moves with `transform:
 * translate(pan) scale(zoom)` (fatia 05: Ctrl+wheel or the pinch zoom on the
 * mouse, the wheel moves the view, the "− 100% +" indicator in the corner). With V (desenho, fatia 03), a press on a card or a drawing
 * selects it (Shift adds or takes out) and a drag moves the whole selection,
 * a drag on the background draws the lasso and the handles resize the single
 * selected drawing; with H, or with space held, any drag moves the plane; with
 * A/L/R/O/P, a drag draws (local preview, written on `pointerup`); with E
 * (fatia 04), a pass erases the touched pieces (local preview, written on
 * `pointerup`). A tool change cancels the gesture in flight (Esc goes back to V).
 * Fatia 06: an image pasted (Ctrl+V) or dropped on the board goes up as
 * `onImageFile`, with the point where the print is born.
 */
export function MindscapeBoard({
  board,
  tool,
  panMode,
  cancelSignal = 0,
  cardRects,
  selection,
  onSelect,
  onMoveItems,
  onResize,
  onViewChange,
  onDraw,
  onErase,
  onBackgroundClick,
  onGestureChange,
  onImageFile,
  children,
}: MindscapeBoardProps): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  /** A drag (or a press on an item) just ended: the click that follows it is not a "plain click" on the background. */
  const suppressClickRef = useRef(false);
  /** A drawing or a hand drag just ended: the click that follows it reaches nobody (no card selected, no link). */
  const swallowClickRef = useRef(false);
  /** A right-button drag of the view just ended: the context menu that follows (Windows fires it on release) does not open. */
  const rightDraggedRef = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const rectsRef = useRef(cardRects);
  rectsRef.current = cardRects;
  const callbacksRef = useRef({ onMoveItems, onResize, onViewChange, onDraw, onErase, onSelect, onGestureChange, onImageFile });
  callbacksRef.current = { onMoveItems, onResize, onViewChange, onDraw, onErase, onSelect, onGestureChange, onImageFile };
  /** Fatia 06 — the last point of the mouse over the board (px, relative to the board element): where a pasted print is born. */
  const lastPointerRef = useRef<Point | null>(null);
  /** The board element (fatia 05: the wheel listener and the middle of the view for the indicator). */
  const viewRef = useRef<HTMLDivElement>(null);
  /** Fatia 04 — the eraser circle that follows the pointer (moved by hand: no render per mouse move). */
  const cursorRef = useRef<HTMLDivElement>(null);

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
        case 'erase':
          return { kind: 'erase', board: gesture.erased! };
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
        case 'pan': {
          const pan = draggedPan({ x: gesture.originX, y: gesture.originY }, { x: gesture.startX, y: gesture.startY }, { x: gesture.lastX, y: gesture.lastY });
          return { kind: 'pan', x: pan.x, y: pan.y };
        }
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

  /** Drops the gesture in flight without writing it; a drag that moved also eats the click that follows. */
  const cancelGesture = useCallback((): void => {
    if (gestureRef.current?.moved) {
      swallowClickRef.current = true;
      suppressClickRef.current = true;
    }
    endGesture();
  }, [endGesture]);

  useEffect(() => {
    if (cancelSignal > 0) cancelGesture();
  }, [cancelSignal, cancelGesture]);

  // Desenho, fatia 05 — the wheel. NATIVE and not passive (React's wheel
  // listener is passive and cannot `preventDefault`, as on the Jobu): with Ctrl
  // (a pinch on the touchpad arrives the same way) it zooms on the mouse and the
  // page never zooms; without Ctrl it moves the view (Shift: horizontally). The
  // wheel waits while a gesture is in flight (the drag converts with the view it started with).
  useEffect(() => {
    const element = viewRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) {
        event.preventDefault();
        if (gestureRef.current) return;
        const box = element.getBoundingClientRect();
        const point = { x: event.clientX - box.left, y: event.clientY - box.top };
        const factor = wheelZoomFactor(normalizeWheelDelta(event.deltaY, event.deltaMode));
        callbacksRef.current.onViewChange((view) => zoomAt(view, point, view.zoom * factor));
        return;
      }
      // A text field being edited keeps its own wheel.
      if ((event.target as Element | null)?.closest?.(EDITABLE)) return;
      event.preventDefault();
      if (gestureRef.current) return;
      const dx = normalizeWheelDelta(event.deltaX, event.deltaMode);
      const dy = normalizeWheelDelta(event.deltaY, event.deltaMode);
      const shift = event.shiftKey;
      callbacksRef.current.onViewChange((view) => {
        const pan = wheelPan(view.pan, dx, dy, shift);
        return pan === view.pan ? view : { ...view, pan };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Desenho, fatia 06 — Ctrl+V of an image. Heard on the `document` while the
  // board is mounted (Chromium hands the paste to the focused element, and the
  // focus may be anywhere in the Mindscape); a paste into a text field is the
  // field's own. The print is born on the last point of the mouse over the
  // board, else in the middle of the view.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const file = printFileOf(event.clipboardData);
      const element = viewRef.current;
      if (!file || !element) return;
      // Focus in something over the board (a dialog, another panel): the paste is not the board's.
      const focused = document.activeElement;
      const screen = element.closest('section');
      if (focused && focused !== document.body && screen && !screen.contains(focused)) return;
      event.preventDefault();
      const screenPoint = lastPointerRef.current ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
      const at = screenToWorld(screenPoint, { pan: boardRef.current.pan, zoom: boardRef.current.zoom });
      callbacksRef.current.onImageFile?.(file, { x: round(at.x), y: round(at.y) });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  /** Fatia 05 — the indicator zooms centered on the middle of the view. */
  const zoomOnMiddle = (next: (zoom: number) => number): void => {
    const element = viewRef.current;
    if (!element) return;
    const middle = { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    callbacksRef.current.onViewChange((view) => zoomAt(view, middle, next(view.zoom)));
  };
  // A tool change (a key, a button, Esc) cancels the gesture in flight: nothing is written.
  useEffect(() => endGesture(), [tool, endGesture]);

  const finish = (gesture: Gesture): void => {
    const callbacks = callbacksRef.current;
    if (gesture.kind === 'erase') {
      // A pass, or a single press: the click that ends it reaches nobody (no card selected, no link).
      swallowClickRef.current = true;
      suppressClickRef.current = true;
      callbacks.onErase(gesture.path!);
      return;
    }
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
        if (gesture.button === RIGHT_BUTTON) rightDraggedRef.current = true;
        callbacks.onViewChange((view) => ({ ...view, pan: { x: final.x, y: final.y } }));
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
      case 'erase':
        break;
    }
  };

  const attachGesture = (): void => {
    const move = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      // Pencil and eraser keep every sample (the stroke has the shape of the hand), not one per frame.
      if (gesture.kind === 'draw' && gesture.draw?.points) {
        gesture.draw = { ...gesture.draw, points: appendPencilPoint(gesture.draw.points, worldAt(gesture, event.clientX, event.clientY)) };
      } else if (gesture.kind === 'erase' && gesture.path && gesture.erased) {
        const point = worldAt(gesture, event.clientX, event.clientY);
        const last = gesture.path.slice(-2);
        if (point.x !== last[0] || point.y !== last[1]) {
          gesture.path = [...gesture.path, point.x, point.y];
          // Erasing is a union: the preview erases only the new stretch over the board erased so far.
          const radius = ERASER_RADIUS_PX / boardRef.current.zoom;
          gesture.erased = eraseBoard(gesture.erased, [...last, point.x, point.y], radius, previewPieceId, sizesOf(rectsRef.current));
        }
      }
      if (!gesture.moved && !isDrag({ x: gesture.startX, y: gesture.startY }, { x: event.clientX, y: event.clientY })) return;
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
    // The system took the pointer (a gesture of the OS, a lost capture): nothing is written.
    const cancel = (): void => cancelGesture();
    window.addEventListener('pointercancel', cancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const action = pressActionFor(event.button, tool, panMode);
    if (action === 'none' || gestureRef.current) return;
    const target = event.target as HTMLElement;
    suppressClickRef.current = false;
    swallowClickRef.current = false;
    rightDraggedRef.current = false;
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
      button: event.button,
    };
    // H, space or the right button (any tool): the drag moves the view.
    if (action === 'pan') {
      if (target.closest(EDITABLE)) return;
      gestureRef.current = { ...base, kind: 'pan', originX: boardRef.current.pan.x, originY: boardRef.current.pan.y, swallow: true };
      attachGesture();
      return;
    }
    if (isDrawTool(tool)) {
      if (target.closest(EDITABLE)) return;
      const gesture: Gesture = { ...base, kind: 'draw' };
      const start = worldAt(gesture, event.clientX, event.clientY);
      gesture.draw = {
        tool,
        id: crypto.randomUUID(),
        start,
        end: start,
        fromCard: cardAtPoint(start, rectsRef.current),
        toCard: null,
        points: tool === 'pencil' ? [start.x, start.y] : undefined,
      };
      gestureRef.current = gesture;
      attachGesture();
      return;
    }
    if (tool === 'eraser') {
      // Fatia 04 — a pass of the eraser: the press already erases where it lands (local preview until pointerup).
      if (target.closest(EDITABLE)) return;
      const gesture: Gesture = { ...base, kind: 'erase' };
      const start = worldAt(gesture, event.clientX, event.clientY);
      gesture.path = [start.x, start.y];
      gesture.erased = eraseBoard(boardRef.current, gesture.path, ERASER_RADIUS_PX / boardRef.current.zoom, previewPieceId, sizesOf(rectsRef.current));
      gestureRef.current = gesture;
      setPreview({ kind: 'erase', board: gesture.erased });
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
  const erased = preview?.kind === 'erase' ? preview.board : null;
  const drawings = erased
    ? erased.drawings
    : moving && moving.ids.drawings.length > 0
      ? board.drawings.map((drawing) => (moving.ids.drawings.includes(drawing.id) ? translateDrawing(drawing, moving.dx, moving.dy) : drawing))
      : resized
        ? board.drawings.map((drawing) => (drawing.id === resized.id ? resized : drawing))
        : board.drawings;

  const zoom = board.zoom;
  const grid = GRID_PX * zoom;

  return (
    <div
      ref={viewRef}
      className={preview?.kind === 'pan' ? `${styles.view} ${styles.panning}` : styles.view}
      // Fatia 05 — the dot grid follows the view (size with the zoom, offset with the pan).
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}
      data-testid="mindscape-board"
      data-tool={tool}
      data-space={panMode ? 'true' : undefined}
      data-pan={`${board.pan.x},${board.pan.y}`}
      data-zoom={zoom}
      data-dragging={moving ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        if (contextMenuAllowed(rightDraggedRef.current)) return;
        rightDraggedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        lastPointerRef.current = { x: event.clientX - box.left, y: event.clientY - box.top };
        const cursor = cursorRef.current;
        if (!cursor) return;
        cursor.style.transform = `translate(${event.clientX - box.left - ERASER_RADIUS_PX}px, ${event.clientY - box.top - ERASER_RADIUS_PX}px)`;
        cursor.hidden = false;
      }}
      onDragOver={(event) => {
        // Fatia 06 — a file dragged over the board can be dropped (a print).
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if ((event.target as Element).closest?.(EDITABLE)) return;
        const file = printFileOf(event.dataTransfer);
        if (!file) return;
        const box = event.currentTarget.getBoundingClientRect();
        const at = screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top }, { pan: boardRef.current.pan, zoom: boardRef.current.zoom });
        callbacksRef.current.onImageFile?.(file, { x: round(at.x), y: round(at.y) });
      }}
      onPointerLeave={() => {
        if (cursorRef.current) cursorRef.current.hidden = true;
      }}
      onClickCapture={(event) => {
        // The zoom indicator is not part of the board: its buttons always get their click.
        if ((event.target as Element).closest('[data-zoom-indicator]')) return;
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
      <div className={styles.world} data-testid="mindscape-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {children({
          positionOf,
          drawings,
          draft: preview?.kind === 'draw' ? preview.gesture : null,
          lasso: preview?.kind === 'lasso' ? preview.rect : null,
          links: erased ? erased.links : board.links,
        })}
      </div>
      {tool === 'eraser' ? (
        <div
          ref={cursorRef}
          className={styles.eraserCursor}
          data-testid="mindscape-eraser-cursor"
          style={{ width: ERASER_RADIUS_PX * 2, height: ERASER_RADIUS_PX * 2 }}
          hidden
          aria-hidden="true"
        />
      ) : null}
      <div
        className={styles.zoom}
        role="group"
        aria-label="Zoom"
        data-testid="mindscape-zoom"
        data-zoom-indicator=""
        // No gesture starts on the indicator, whatever the tool.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Diminuir zoom"
          title="Diminuir zoom"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomOnMiddle((current) => stepZoom(current, -ZOOM_STEP_POINTS))}
        >
          −
        </button>
        <button
          type="button"
          className={`${styles.zoomButton} ${styles.zoomValue}`}
          title="Voltar a 100%"
          data-testid="mindscape-zoom-value"
          onClick={() => zoomOnMiddle(() => 1)}
        >
          {zoomPercent(zoom)}%
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Aumentar zoom"
          title="Aumentar zoom"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomOnMiddle((current) => stepZoom(current, ZOOM_STEP_POINTS))}
        >
          +
        </button>
      </div>
    </div>
  );
}
