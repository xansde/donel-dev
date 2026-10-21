// T012 (015-jobu-pet) - where the pet sits: default position, docking, validity, alignment, window
// geometry and size. Pure: every input and output is in DIP (what Electron's `screen` reports),
// so the scale factor of a display never enters a calculation.
//
// The unit of position is the ANCHOR: the point at the center of the base of the drawing. The
// window is `windowSizeFor(size)` around it, with the drawing at the bottom center, so a resize
// (FR-033) grows the window upwards and sideways while the anchor does not move. The remembered
// `pet.placement` is this anchor, which makes it independent of the size.

import type { PetAlign, PetDisplay, PetPoint, PetRect } from './types';

// ---------------------------------------------------------------------------
// Size (FR-033)
// ---------------------------------------------------------------------------

export const PET_SIZE_MIN = 80;
export const PET_SIZE_MAX = 320;
/** Medium: the size the pet is born with (FR-008). */
export const PET_SIZE_DEFAULT = 140;
/** Ctrl + wheel moves the size this much per notch. */
export const PET_SIZE_STEP = 10;

/** The "Tamanho" submenu of the context menu. */
export const PET_SIZE_PRESETS: readonly { readonly label: string; readonly size: number }[] = [
  { label: 'Pequeno', size: 100 },
  { label: 'Médio', size: 140 },
  { label: 'Grande', size: 200 },
  { label: 'Muito grande', size: 260 },
];

/** Whole DIP inside 80-320; anything that is not a finite number gives the default. */
export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return PET_SIZE_DEFAULT;
  return Math.round(Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, size)));
}

export function stepSize(size: number, direction: 1 | -1): number {
  return clampSize(clampSize(size) + direction * PET_SIZE_STEP);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** From the right edge of the work area to the right edge of the drawing (D8). */
export const PET_EDGE_MARGIN = 16;
/** `isDocked`: how far from the taskbar edge the base can be and still count as sitting on it. */
export const PET_DOCK_TOLERANCE = 4;
/** `snapOnDrop`: releasing the drag this close to the taskbar edge snaps the base to it. */
export const PET_SNAP_DISTANCE = 24;
/** `alignFor`: this close to a side of the work area, the bubble anchors to the drawing's edge on that side. */
export const PET_ALIGN_EDGE = 160;
/** Width of the drawing over its height: the 264x320 canvas of the sliced art (`manifest.json`). */
export const PET_DRAWING_ASPECT = 264 / 320;

/** The window never gets narrower than this: it has to hold a bubble of up to 300 px (FR-017). */
export const PET_WINDOW_MIN_WIDTH = 480;
export const PET_WINDOW_WIDTH_FACTOR = 3.4;
/** Room above the drawing for the bubble and the list. */
export const PET_WINDOW_EXTRA_HEIGHT = 200;

/** `max(480, 3.4 x size)` by `size + 200` (R9). */
export function windowSizeFor(size: number): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(PET_WINDOW_MIN_WIDTH, Math.round(PET_WINDOW_WIDTH_FACTOR * size)),
    height: Math.round(size) + PET_WINDOW_EXTRA_HEIGHT,
  };
}

/** The window with `anchor` at its bottom center. Whole numbers: `BrowserWindow` bounds are integers. */
export function windowBoundsFor(anchor: PetPoint, size: number): PetRect {
  const { width, height } = windowSizeFor(size);
  return { x: Math.round(anchor.x - width / 2), y: Math.round(anchor.y - height), width, height };
}

/**
 * The anchor of a window. Only the top-left corner of `bounds` is read: the dimensions come from
 * `size`, so a window whose real bounds are stale still gives the right anchor.
 */
export function anchorOf(bounds: PetPoint, size: number): PetPoint {
  const { width, height } = windowSizeFor(size);
  return { x: bounds.x + width / 2, y: bounds.y + height };
}

/** The drawing itself: bottom center on the anchor. */
export function drawingRectFor(anchor: PetPoint, size: number): PetRect {
  const width = size * PET_DRAWING_ASPECT;
  return { x: anchor.x - width / 2, y: anchor.y - size, width, height: size };
}

/**
 * The corner position (D8): the right edge of the drawing `PET_EDGE_MARGIN` from the right edge of
 * the work area of `display`, the base of the drawing on the bottom of the work area (with the
 * taskbar below, that is the top of the taskbar). Taskbar on another side, or hidden, gives the
 * bottom right corner of the work area all the same.
 */
export function defaultPlacement(display: PetDisplay, size: number): PetPoint {
  const work = display.workArea;
  const halfDrawing = (size * PET_DRAWING_ASPECT) / 2;
  const x = Math.max(work.x + halfDrawing, work.x + work.width - PET_EDGE_MARGIN - halfDrawing);
  return { x: Math.round(x), y: work.y + work.height };
}

/** Something is reserved at the bottom of the display: the taskbar sits there (a hidden one reserves nothing). */
export function taskbarAtBottom(display: PetDisplay): boolean {
  return display.bounds.y + display.bounds.height - (display.workArea.y + display.workArea.height) > 0;
}

/** The base of the drawing sits on the taskbar edge (FR-004: only then it is not faded). */
export function isDocked(anchor: PetPoint, display: PetDisplay): boolean {
  if (!taskbarAtBottom(display)) return false;
  return Math.abs(anchor.y - (display.workArea.y + display.workArea.height)) <= PET_DOCK_TOLERANCE;
}

/** On release, a base within `PET_SNAP_DISTANCE` of the taskbar edge snaps to it; `x` is left alone. */
export function snapOnDrop(anchor: PetPoint, display: PetDisplay): PetPoint {
  if (!taskbarAtBottom(display)) return anchor;
  const edge = display.workArea.y + display.workArea.height;
  if (Math.abs(anchor.y - edge) > PET_SNAP_DISTANCE) return anchor;
  return { x: anchor.x, y: edge };
}

function intersectionArea(a: PetRect, b: PetRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * FR-005: a remembered position stays only if at least half of the DRAWING (not the wide window
 * around it) is inside the work area of some display. Otherwise the caller goes back to the default.
 */
export function isPlacementVisible(anchor: PetPoint, size: number, displays: readonly PetDisplay[]): boolean {
  const drawing = drawingRectFor(anchor, size);
  const half = (drawing.width * drawing.height) / 2;
  return displays.some((display) => intersectionArea(drawing, display.workArea) + 1e-6 >= half);
}

/** Which side the bubble and the list anchor to (see `PetAlign`): the nearer side edge of the work area within 160 px, else center. */
export function alignFor(anchor: PetPoint, display: PetDisplay): PetAlign {
  const work = display.workArea;
  const toLeft = anchor.x - work.x;
  const toRight = work.x + work.width - anchor.x;
  if (toRight <= PET_ALIGN_EDGE && toRight <= toLeft) return 'right';
  if (toLeft <= PET_ALIGN_EDGE) return 'left';
  return 'center';
}

/** The display holding `point`, or the closest one to it (like Electron's `getDisplayNearestPoint`); `null` without displays. */
export function displayNearestPoint(displays: readonly PetDisplay[], point: PetPoint): PetDisplay | null {
  let best: PetDisplay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    const dx = Math.max(x - point.x, 0, point.x - (x + width));
    const dy = Math.max(y - point.y, 0, point.y - (y + height));
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return best;
}
