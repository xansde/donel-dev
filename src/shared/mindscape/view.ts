// Mindscape desenho — the view of a board: `screen = board × zoom + pan`, with
// the screen point relative to the top-left corner of the board element.
// Design: docs/design/mindscape-desenho.md, "Zoom e visão". The gestures
// convert through here from fatia 01 on; fatia 05 adds the zoom gestures:
// `zoomAt` (the board point under the mouse stays put), the wheel factor, the
// "− 100% +" steps and the wheel moving the view.

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

/**
 * Zoom to `nextZoom` (held between 25% and 400%) keeping the board point under
 * `screenPoint` where it is: `pan' = p − (p − pan) × (z'/z)`. The same view
 * comes back when the zoom does not change (already at the limit, or not a number).
 */
export function zoomAt(view: BoardView, screenPoint: Point, nextZoom: number): BoardView {
  if (!Number.isFinite(nextZoom)) return view;
  const zoom = clampZoom(nextZoom);
  if (zoom === view.zoom) return view;
  const ratio = zoom / view.zoom;
  return {
    pan: { x: screenPoint.x - (screenPoint.x - view.pan.x) * ratio, y: screenPoint.y - (screenPoint.y - view.pan.y) * ratio },
    zoom,
  };
}

/**
 * What one wheel event multiplies the zoom by: `1.1^(−delta/100)`, with the
 * delta in pixels (`normalizeWheelDelta`). A mouse notch (100) is 10%; the
 * wheel rolled up (negative delta) zooms in. A pinch on the touchpad arrives
 * as small deltas with `ctrlKey` and zooms smoothly. Not a finite number → 1.
 */
export function wheelZoomFactor(delta: number): number {
  if (!Number.isFinite(delta)) return 1;
  return 1.1 ** (-delta / 100);
}

/** The zoom as the indicator shows it: a whole percentage. */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/** "−" / "+" of the indicator: `points` percentage points from the shown percentage, held between 25% and 400%. */
export function stepZoom(zoom: number, points: number): number {
  return clampZoom((zoomPercent(zoom) + points) / 100);
}

/**
 * The wheel without Ctrl moves the view: `deltaY` vertically and `deltaX`
 * horizontally (touchpad); with Shift, the wheel moves it horizontally.
 * Chromium may or may not have swapped the axes already, so with Shift both
 * deltas go to the horizontal. Deltas in pixels; nothing to move → same pan.
 */
export function wheelPan(pan: Point, deltaX: number, deltaY: number, shift: boolean): Point {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return pan;
  const dx = shift ? deltaX + deltaY : deltaX;
  const dy = shift ? 0 : deltaY;
  if (dx === 0 && dy === 0) return pan;
  return { x: pan.x - dx, y: pan.y - dy };
}
