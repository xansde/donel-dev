// Mindscape desenho — pure hit-tests in board units. Design:
// docs/design/mindscape-desenho.md, "Ligação desenhada com A/L" and
// "Borracha parcial e hit-test".

import { STROKE_WIDTH } from './drawings';
import type { MindscapeDrawing } from './model';
import type { Point } from './view';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CardRect extends Rect {
  readonly id: string;
}

export interface LinkSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Ids of cards and drawings picked together (lasso, Ctrl+A, the screen selection). */
export interface ItemIds {
  readonly cards: readonly string[];
  readonly drawings: readonly string[];
}

/**
 * The card under `point`, border included. `rects` come in drawing order, so
 * the search runs from the last (on top) to the first. Background → `null`.
 */
export function cardAtPoint(point: Point, rects: readonly CardRect[]): string | null {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index]!;
    if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) return rect.id;
  }
  return null;
}

/** Tenth of a unit: enough for the eye, and what the file keeps. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The center-to-center segment, cut at the border of each card, so the arrow
 * head lands on the edge of the destination. Overlapping cards → `null`.
 * (Moved here from `roughShapes.ts`, which re-exports it.)
 */
export function linkEndpoints(from: Rect, to: Rect): LinkSegment | null {
  const ax = from.x + from.w / 2;
  const ay = from.y + from.h / 2;
  const bx = to.x + to.w / 2;
  const by = to.y + to.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return null;
  const exit = (rect: Rect): number => Math.min(dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx), dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy));
  const tFrom = exit(from);
  const tTo = exit(to);
  if (tFrom + tTo >= 1) return null;
  return { x1: round(ax + dx * tFrom), y1: round(ay + dy * tFrom), x2: round(bx - dx * tTo), y2: round(by - dy * tTo) };
}

/** Distance from `p` to the segment a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the open polyline through `points`. */
function distanceToPolyline(p: Point, points: readonly Point[]): number {
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) best = Math.min(best, distanceToSegment(p, points[index - 1]!, points[index]!));
  return best;
}

const ELLIPSE_SAMPLES = 64;

/** The ellipse inscribed in the box, as a closed polyline of 64 points. */
function ellipsePoints(box: Rect): Point[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const points: Point[] = [];
  for (let index = 0; index <= ELLIPSE_SAMPLES; index += 1) {
    const angle = (index / ELLIPSE_SAMPLES) * Math.PI * 2;
    points.push({ x: cx + (box.w / 2) * Math.cos(angle), y: cy + (box.h / 2) * Math.sin(angle) });
  }
  return points;
}

function rectPoints(box: Rect): Point[] {
  const { x, y, w, h } = box;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
}

/** Distance from `p` to the stroke of the drawing (boxes have no fill: only the contour counts). */
function distanceToDrawing(p: Point, drawing: MindscapeDrawing): number {
  switch (drawing.kind) {
    case 'line':
      return distanceToSegment(p, { x: drawing.x1, y: drawing.y1 }, { x: drawing.x2, y: drawing.y2 });
    case 'rect':
      return distanceToPolyline(p, rectPoints(drawing));
    case 'ellipse':
      return distanceToPolyline(p, ellipsePoints(drawing));
  }
}

/**
 * The drawing under `point`, the one on top first (end of the array). A
 * drawing is hit within `stroke / 2 + slack` of its stroke; `slack` comes in
 * board units (6 px of screen divided by the zoom). Nothing → `null`.
 */
export function hitTestDrawings(drawings: readonly MindscapeDrawing[], point: Point, slack: number): string | null {
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const drawing = drawings[index]!;
    if (distanceToDrawing(point, drawing) <= STROKE_WIDTH[drawing.stroke] / 2 + slack) return drawing.id;
  }
  return null;
}

/** The geometric box of a drawing (a line drawn backwards included), stroke not counted. */
export function drawingBounds(drawing: MindscapeDrawing): Rect {
  if (drawing.kind === 'line') {
    const x = Math.min(drawing.x1, drawing.x2);
    const y = Math.min(drawing.y1, drawing.y2);
    return { x, y, w: Math.abs(drawing.x2 - drawing.x1), h: Math.abs(drawing.y2 - drawing.y1) };
  }
  return { x: drawing.x, y: drawing.y, w: drawing.w, h: drawing.h };
}

function normalizedRect(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** The lasso: the cards and drawings whose box stays whole inside `rect` (drawn in any direction). Links never enter. */
export function itemsInsideRect(rect: Rect, cards: readonly CardRect[], drawings: readonly MindscapeDrawing[]): ItemIds {
  const lasso = normalizedRect(rect);
  return {
    cards: cards.filter((card) => contains(lasso, card)).map((card) => card.id),
    drawings: drawings.filter((drawing) => contains(lasso, drawingBounds(drawing))).map((drawing) => drawing.id),
  };
}

/** Corners of a box (rect, ellipse) and ends of a loose line. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';

/** Smallest side of a box, and shortest line, a handle can leave (board units). */
export const MIN_DRAWING_SIZE = 4;

const CORNER_SIGN: Readonly<Record<'nw' | 'ne' | 'sw' | 'se', { readonly x: -1 | 1; readonly y: -1 | 1 }>> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
};

/** A side of at least MIN_DRAWING_SIZE, keeping its direction (zero takes the handle's own). */
function atLeastMin(raw: number, direction: number): number {
  if (Math.abs(raw) >= MIN_DRAWING_SIZE) return raw;
  return (raw === 0 ? direction : Math.sign(raw)) * MIN_DRAWING_SIZE;
}

/**
 * The drawing with `handle` dragged to `point`: a corner of a box moves with
 * the opposite one fixed (crossing it flips the box), an end of a loose line
 * moves with the other fixed. Never under 4 units. A handle that the drawing
 * does not have → the same drawing. Never turns a line into a link.
 */
export function resizeDrawing(drawing: MindscapeDrawing, handle: ResizeHandle, point: Point): MindscapeDrawing {
  if (drawing.kind === 'line') {
    if (handle !== 'start' && handle !== 'end') return drawing;
    const fixed = handle === 'end' ? { x: drawing.x1, y: drawing.y1 } : { x: drawing.x2, y: drawing.y2 };
    const moving = handle === 'end' ? { x: drawing.x2, y: drawing.y2 } : { x: drawing.x1, y: drawing.y1 };
    let dx = point.x - fixed.x;
    let dy = point.y - fixed.y;
    let length = Math.hypot(dx, dy);
    if (length < MIN_DRAWING_SIZE) {
      if (length === 0) {
        dx = moving.x - fixed.x;
        dy = moving.y - fixed.y;
        length = Math.hypot(dx, dy) || 1;
        if (dx === 0 && dy === 0) dx = 1;
      }
      dx = (dx / length) * MIN_DRAWING_SIZE;
      dy = (dy / length) * MIN_DRAWING_SIZE;
    }
    const end = { x: fixed.x + dx, y: fixed.y + dy };
    return handle === 'end' ? { ...drawing, x2: end.x, y2: end.y } : { ...drawing, x1: end.x, y1: end.y };
  }
  if (handle === 'start' || handle === 'end') return drawing;
  const sign = CORNER_SIGN[handle];
  const fixed = { x: sign.x < 0 ? drawing.x + drawing.w : drawing.x, y: sign.y < 0 ? drawing.y + drawing.h : drawing.y };
  const w = atLeastMin(point.x - fixed.x, sign.x);
  const h = atLeastMin(point.y - fixed.y, sign.y);
  return { ...drawing, x: w < 0 ? fixed.x + w : fixed.x, y: h < 0 ? fixed.y + h : fixed.y, w: Math.abs(w), h: Math.abs(h) };
}
