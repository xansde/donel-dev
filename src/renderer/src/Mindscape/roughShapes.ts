// Mindscape, fatia 05 — the hand-made stroke (ADR 0004): `roughjs` generates
// the SVG `d` of the links and of the card outlines. The seed is fixed by the
// id, so the stroke does not "shake" at every render, and the result is
// cached by geometry (a drag recomputes only the link that moved).

import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LinkSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

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

/**
 * The center-to-center segment, cut at the border of each card, so the arrow
 * head lands on the edge of the destination. Overlapping cards → `null`.
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

function pathsOf(drawable: ReturnType<typeof generator.line>): string {
  return generator
    .toPaths(drawable)
    .map((info) => info.d)
    .join(' ');
}

/** `d` of the link line (and of its arrow head), hand-made, stable for the same id and geometry. */
export function linkPath(id: string, from: Rect, to: Rect, arrow: boolean): LinkShape | null {
  const segment = linkEndpoints(from, to);
  if (!segment) return null;
  const { x1, y1, x2, y2 } = segment;
  const geometry = `${x1},${y1},${x2},${y2}`;
  const line = cached(`line|${id}|${geometry}`, () => pathsOf(generator.line(x1, y1, x2, y2, options(id))));
  if (!arrow) return { line, head: null };
  const head = cached(`head|${id}|${geometry}`, () => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const wing = (side: number): [number, number] => [
      round(x2 - ARROW_LENGTH * Math.cos(angle + side * ARROW_ANGLE)),
      round(y2 - ARROW_LENGTH * Math.sin(angle + side * ARROW_ANGLE)),
    ];
    return pathsOf(generator.linearPath([wing(1), [x2, y2], wing(-1)], { ...options(`${id}:head`), roughness: 0.6 }));
  });
  return { line, head };
}

/** `d` of the hand-made outline of a card of `w` × `h`, in the card's own coordinates. */
export function cardOutlinePath(id: string, w: number, h: number): string {
  const width = Math.round(w);
  const height = Math.round(h);
  return cached(`card|${id}|${width}x${height}`, () => pathsOf(generator.rectangle(1, 1, width - 2, height - 2, { ...options(id), roughness: 0.8, bowing: 0.6, strokeWidth: 1 })));
}
