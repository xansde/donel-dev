// Mindscape desenho, fatia 04 — the eraser, pure. It takes away only the
// touched piece of a pencil stroke or a loose line (one can become two); a
// rect, an ellipse and a link go whole when their stroke is touched; a post-it
// never goes. Design: docs/design/mindscape-desenho.md, "Borracha parcial e hit-test".

import { STROKE_WIDTH, strokeWidthOf } from './drawings';
import { distanceToDrawing, distanceToSegment, linkEndpoints, toPoints } from './geometry';
import type { MindscapeBoard, MindscapeDoc, MindscapeDrawing, MindscapeLink } from './model';
import type { Point } from './view';

/** A run shorter than this (board units) is dropped: it would be an invisible dot. */
const MIN_RUN_LENGTH = 1;
/** Stroke width of a link (`roughShapes.ts` draws it at 1.5). */
const LINK_STROKE = 1.5;

/** Tenth of a unit: what the file keeps. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The eraser path as circles: one sample every `radius / 2`, so a fast pass leaves no gap. */
function samples(eraser: readonly number[], radius: number): Point[] {
  const points = toPoints(eraser);
  if (points.length === 0) return [];
  const step = Math.max(radius / 2, 0.01);
  const out: Point[] = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step);
    for (let k = 1; k <= count; k += 1) out.push({ x: from.x + ((to.x - from.x) * k) / count, y: from.y + ((to.y - from.y) * k) / count });
  }
  return out;
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boxOf(points: readonly Point[], pad = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** The `t` interval of the segment a→b inside the circle (center c, radius r), or `null` (2nd degree equation). */
function insideCircle(a: Point, b: Point, c: Point, r: number): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  const C = fx * fx + fy * fy - r * r;
  if (A === 0) return C <= 0 ? [0, 1] : null;
  const B = 2 * (fx * dx + fy * dy);
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const lo = Math.max(0, (-B - root) / (2 * A));
  const hi = Math.min(1, (-B + root) / (2 * A));
  return lo < hi ? [lo, hi] : null;
}

/** What is left of [0, 1] once the (unsorted, overlapping) intervals are taken out. */
function complement(erased: [number, number][]): [number, number][] {
  erased.sort((x, y) => x[0] - y[0]);
  const kept: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of erased) {
    if (lo > cursor) kept.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < 1) kept.push([cursor, 1]);
  return kept;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: round(a.x + (b.x - a.x) * t), y: round(a.y + (b.y - a.y) * t) };
}

function runLength(run: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < run.length; index += 1) total += Math.hypot(run[index]!.x - run[index - 1]!.x, run[index]!.y - run[index - 1]!.y);
  return total;
}

function erase(points: number[], circles: readonly Point[], radius: number): number[][] {
  const stroke = toPoints(points);
  if (stroke.length < 2 || circles.length === 0 || !overlaps(boxOf(stroke), boxOf(circles, radius))) return [points];
  const runs: Point[][] = [];
  let current: Point[] | null = null;
  let touched = false;
  for (let index = 1; index < stroke.length; index += 1) {
    const a = stroke[index - 1]!;
    const b = stroke[index]!;
    const segment = boxOf([a, b], radius);
    const erased: [number, number][] = [];
    for (const circle of circles) {
      if (circle.x < segment.minX || circle.x > segment.maxX || circle.y < segment.minY || circle.y > segment.maxY) continue;
      const interval = insideCircle(a, b, circle, radius);
      if (interval) erased.push(interval);
    }
    if (erased.length > 0) touched = true;
    for (const [lo, hi] of complement(erased)) {
      const end = hi === 1 ? b : lerp(a, b, hi);
      if (lo === 0 && current) {
        // The previous segment was kept up to its end (= a): the run goes on.
        current.push(end);
      } else {
        if (current) runs.push(current);
        current = [lo === 0 ? a : lerp(a, b, lo), end];
      }
      if (hi < 1) {
        runs.push(current);
        current = null;
      }
    }
    // A segment erased up to its end closes the run.
    if (current && erased.some(([, hi]) => hi === 1)) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  if (!touched) return [points];
  return runs.filter((run) => run.length >= 2 && runLength(run) >= MIN_RUN_LENGTH).map((run) => run.flatMap((point) => [point.x, point.y]));
}

/**
 * The runs of the polyline `points` (flattened) left after the eraser passes
 * along `eraser` (flattened; one point is a single press) with `radius`. The
 * runs keep the surviving vertices; the cut points are rounded to 0.1; a run
 * with fewer than 2 points or shorter than 1 unit goes away. Untouched → the
 * same array, alone.
 */
export function erasePolyline(points: number[], eraser: readonly number[], radius: number): number[][] {
  return erase(points, samples(eraser, radius), radius);
}

/** Pieces of a pencil stroke or a loose line; the first keeps the id. `null` = untouched. */
function erasePieces(drawing: Extract<MindscapeDrawing, { kind: 'pencil' | 'line' }>, circles: readonly Point[], radius: number, newId: () => string): MindscapeDrawing[] | null {
  const reach = radius + STROKE_WIDTH[drawing.stroke] / 2;
  const points = drawing.kind === 'pencil' ? drawing.points : [drawing.x1, drawing.y1, drawing.x2, drawing.y2];
  const runs = erase(points, circles, reach);
  if (runs.length === 1 && runs[0] === points) return null;
  return runs.map((run, index) => {
    const id = index === 0 ? drawing.id : newId();
    if (drawing.kind === 'pencil') return { ...drawing, id, points: run };
    const [x1, y1, x2, y2] = run as [number, number, number, number];
    // Only the piece that keeps the original end keeps the arrow head.
    return { ...drawing, id, x1, y1, x2, y2, arrow: drawing.arrow && x2 === drawing.x2 && y2 === drawing.y2 };
  });
}

function touches(circles: readonly Point[], distance: (point: Point) => number, reach: number): boolean {
  return circles.some((circle) => distance(circle) <= reach);
}

/**
 * One pass of the eraser along `eraserPath` (flattened, board units) with
 * `radius` (8 px of screen / zoom) on the board: pencil strokes and loose lines
 * lose the touched piece (the first piece keeps the id and the layer, the
 * others get `newId()`, injected to stay pure); rects and ellipses go whole
 * when the contour is touched; a print (fatia 06) goes whole when its area is; a link goes whole when its drawn segment is
 * touched (`cardSizes` are the measured sizes of the cards on screen — a link
 * without both is not drawn, so it is not erased); post-its never go. The ink
 * counts: the reach is `radius + stroke / 2`. Nothing touched → the same board.
 */
export function eraseBoard(
  board: MindscapeBoard,
  eraserPath: readonly number[],
  radius: number,
  newId: () => string,
  cardSizes: Readonly<Record<string, { readonly w: number; readonly h: number }>> = {},
): MindscapeBoard {
  const circles = samples(eraserPath, radius);
  if (circles.length === 0) return board;
  let drawingsChanged = false;
  const drawings: MindscapeDrawing[] = [];
  for (const drawing of board.drawings) {
    if (drawing.kind === 'pencil' || drawing.kind === 'line') {
      const pieces = erasePieces(drawing, circles, radius, newId);
      if (pieces) {
        drawingsChanged = true;
        drawings.push(...pieces);
      } else drawings.push(drawing);
      continue;
    }
    // A rect or an ellipse goes when its contour is touched; a print (fatia 06), when its area is.
    if (touches(circles, (point) => distanceToDrawing(point, drawing), radius + strokeWidthOf(drawing) / 2)) {
      drawingsChanged = true;
      continue;
    }
    drawings.push(drawing);
  }
  const links = board.links.filter((link: MindscapeLink) => {
    const from = board.cards[link.from];
    const to = board.cards[link.to];
    const fromSize = cardSizes[link.from];
    const toSize = cardSizes[link.to];
    if (!from || !to || !fromSize || !toSize) return true;
    const segment = linkEndpoints({ x: from.x, y: from.y, ...fromSize }, { x: to.x, y: to.y, ...toSize });
    if (!segment) return true;
    const a = { x: segment.x1, y: segment.y1 };
    const b = { x: segment.x2, y: segment.y2 };
    return !touches(circles, (point) => distanceToSegment(point, a, b), radius + LINK_STROKE / 2);
  });
  const linksChanged = links.length !== board.links.length;
  if (!drawingsChanged && !linksChanged) return board;
  return { ...board, drawings: drawingsChanged ? drawings : board.drawings, links: linksChanged ? links : board.links };
}

/** `eraseBoard` on the board of `projectPath`, as a document reducer (one history entry). Same board → same document. */
export function eraseDoc(
  doc: MindscapeDoc,
  projectPath: string,
  eraserPath: readonly number[],
  radius: number,
  newId: () => string,
  cardSizes?: Readonly<Record<string, { readonly w: number; readonly h: number }>>,
): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  const next = eraseBoard(board, eraserPath, radius, newId, cardSizes);
  return next === board ? doc : { ...doc, boards: { ...doc.boards, [projectPath]: next } };
}
