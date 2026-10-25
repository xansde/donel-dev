// Mindscape desenho — pure hit-tests in board units. Design:
// docs/design/mindscape-desenho.md, "Ligação desenhada com A/L" and
// "Borracha parcial e hit-test".

import type { Point } from './view';

export interface CardRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
