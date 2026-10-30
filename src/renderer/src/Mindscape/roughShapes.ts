// Mindscape, fatia 05 — the hand-made stroke (ADR 0004): `roughjs` generates
// the SVG `d` of the links and of the card outlines. The seed is fixed by the
// id, so the stroke does not "shake" at every render, and the result is
// cached by geometry (a drag recomputes only the link that moved).

import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';
import type { MindscapeDrawing } from '../../../shared/mindscape/model';
import { STROKE_WIDTH } from '../../../shared/mindscape/drawings';
import { linkEndpoints, type Rect } from '../../../shared/mindscape/geometry';

// Fatia 03 (desenho) — `linkEndpoints` and its types moved to the shared
// geometry (pure, used by the hit-test); re-exported here for the old imports.
export { linkEndpoints, type LinkSegment, type Rect } from '../../../shared/mindscape/geometry';

export interface LinkShape {
  readonly line: string;
  /** The two strokes of the arrow head at the destination; `null` with the arrow off. */
  readonly head: string | null;
}

const generator = rough.generator();
const cache = new Map<string, string>();
/** Bound of the cache: past it, it starts over (a board has a handful of cards). */
const CACHE_LIMIT = 2000;

const ARROW_LENGTH = 12;
const ARROW_ANGLE = 0.45;

/** Positive 31-bit seed from the id (FNV-1a); roughjs treats 0 as "random", so never 0. */
function seedOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

function options(id: string): Options {
  return { seed: seedOf(id), roughness: 1.1, bowing: 1.2, strokeWidth: 1.5, stroke: 'currentColor' };
}

function cached(key: string, build: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  const value = build();
  cache.set(key, value);
  return value;
}

/** Test seam: forget every cached `d` (the stroke must come out the same anyway). */
export function clearRoughCache(): void {
  cache.clear();
}

/** Tenth of a pixel: enough for the eye, and stable as a cache key. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function pathsOf(drawable: ReturnType<typeof generator.line>): string {
  return generator
    .toPaths(drawable)
    .map((info) => info.d)
    .join(' ');
}

/** The two wings of an arrow head that ends at (x2, y2), coming from (x1, y1). */
function arrowHead(id: string, x1: number, y1: number, x2: number, y2: number, length: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const wing = (side: number): [number, number] => [
    round(x2 - length * Math.cos(angle + side * ARROW_ANGLE)),
    round(y2 - length * Math.sin(angle + side * ARROW_ANGLE)),
  ];
  return pathsOf(generator.linearPath([wing(1), [x2, y2], wing(-1)], { ...options(`${id}:head`), roughness: 0.6 }));
}

/** `d` of the link line (and of its arrow head), hand-made, stable for the same id and geometry. */
export function linkPath(id: string, from: Rect, to: Rect, arrow: boolean): LinkShape | null {
  const segment = linkEndpoints(from, to);
  if (!segment) return null;
  const { x1, y1, x2, y2 } = segment;
  const geometry = `${x1},${y1},${x2},${y2}`;
  const line = cached(`line|${id}|${geometry}`, () => pathsOf(generator.line(x1, y1, x2, y2, options(id))));
  if (!arrow) return { line, head: null };
  const head = cached(`head|${id}|${geometry}`, () => arrowHead(id, x1, y1, x2, y2, ARROW_LENGTH));
  return { line, head };
}

/** `d` of the hand-made outline of a card of `w` × `h`, in the card's own coordinates. */
export function cardOutlinePath(id: string, w: number, h: number): string {
  const width = Math.round(w);
  const height = Math.round(h);
  return cached(`card|${id}|${width}x${height}`, () => pathsOf(generator.rectangle(1, 1, width - 2, height - 2, { ...options(id), roughness: 0.8, bowing: 0.6, strokeWidth: 1 })));
}

/** `d` of each pencil stroke, by its `points` array (an untouched stroke keeps the same array between renders). */
const pencilCache = new WeakMap<readonly number[], string>();

function format(value: number): string {
  return String(round(value));
}

/**
 * Desenho, fatia 04 — the pencil stroke (Rabisco) as a smoothed SVG path:
 * quadratic curves through the midpoints of the flattened `points`
 * (`[x0, y0, x1, y1, …]`), from the first point to the last. Two points are a
 * straight segment; fewer give no path. Pure and stable for the same points.
 */
export function pencilPath(points: readonly number[]): string {
  const hit = pencilCache.get(points);
  if (hit !== undefined) return hit;
  const count = Math.floor(points.length / 2);
  let d = '';
  if (count >= 2) {
    const x = (index: number): number => points[index * 2]!;
    const y = (index: number): number => points[index * 2 + 1]!;
    const parts = [`M${format(x(0))} ${format(y(0))}`];
    for (let index = 1; index < count - 1; index += 1) {
      parts.push(`Q${format(x(index))} ${format(y(index))} ${format((x(index) + x(index + 1)) / 2)} ${format((y(index) + y(index + 1)) / 2)}`);
    }
    parts.push(`L${format(x(count - 1))} ${format(y(count - 1))}`);
    d = parts.join(' ');
  }
  pencilCache.set(points, d);
  return d;
}

export interface DrawingShape {
  /** Position of the local geometry in the board (`translate(x y)`). */
  readonly transform: string;
  readonly d: string;
  /** Arrow head of a loose arrow; `null` otherwise. */
  readonly head: string | null;
  readonly strokeWidth: number;
}

/**
 * Mindscape desenho, fatia 01 — the hand-made stroke of a drawing, generated
 * in local coordinates (origin at the top-left of the box, or at the start of
 * the line) and placed by `transform`: moving it does not invalidate the cache.
 * A degenerate box (< 1 unit) has no shape.
 */
export function drawingShape(drawing: MindscapeDrawing): DrawingShape | null {
  const strokeWidth = STROKE_WIDTH[drawing.stroke];
  if (drawing.kind === 'pencil') {
    // Absolute points: a moved stroke has a new `points` array anyway (the cache is by array).
    const d = pencilPath(drawing.points);
    return d ? { transform: 'translate(0 0)', d, head: null, strokeWidth } : null;
  }
  const opts = { ...options(drawing.id), strokeWidth };
  if (drawing.kind === 'line') {
    const dx = round(drawing.x2 - drawing.x1);
    const dy = round(drawing.y2 - drawing.y1);
    if (dx === 0 && dy === 0) return null;
    const geometry = `${dx},${dy}`;
    const d = cached(`dline|${drawing.id}|${geometry}`, () => pathsOf(generator.line(0, 0, dx, dy, opts)));
    const length = ARROW_LENGTH + strokeWidth * 2;
    const head = drawing.arrow ? cached(`dhead|${drawing.id}|${geometry}|${length}`, () => arrowHead(drawing.id, 0, 0, dx, dy, length)) : null;
    return { transform: `translate(${drawing.x1} ${drawing.y1})`, d, head, strokeWidth };
  }
  const w = round(drawing.w);
  const h = round(drawing.h);
  if (w < 1 || h < 1) return null;
  const d =
    drawing.kind === 'rect'
      ? cached(`drect|${drawing.id}|${w}x${h}`, () => pathsOf(generator.rectangle(0, 0, w, h, opts)))
      : cached(`dellipse|${drawing.id}|${w}x${h}`, () => pathsOf(generator.ellipse(w / 2, h / 2, w, h, opts)));
  return { transform: `translate(${drawing.x} ${drawing.y})`, d, head: null, strokeWidth };
}
