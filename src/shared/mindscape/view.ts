// Mindscape desenho — the view of a board: `screen = board × zoom + pan`, with
// the screen point relative to the top-left corner of the board element.
// Design: docs/design/mindscape-desenho.md, "Zoom e visão". The gestures
// convert through here from fatia 01 on; the zoom stays 1 until fatia 05.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoardView {
  readonly pan: Point;
  readonly zoom: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Holds the zoom between 25% and 400%; a non-finite zoom falls back to 100%. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(point: Point, view: BoardView): Point {
  return { x: (point.x - view.pan.x) / view.zoom, y: (point.y - view.pan.y) / view.zoom };
}

export function worldToScreen(point: Point, view: BoardView): Point {
  return { x: point.x * view.zoom + view.pan.x, y: point.y * view.zoom + view.pan.y };
}
