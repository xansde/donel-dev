// T046/T048 (015-jobu-pet, US5, R11/FR-004/FR-033) - the arithmetic of the gestures on the Jobu, pure and in DIP.
// The screen (src/renderer/src/pet/usePetDrag.ts) reads the pointer and tells the main in screen coordinates;
// the main (src/main/pet/pet-service.ts) moves the window and keeps the place. What is decided here:
//
//  - 4 px of distance tell a click from a drag (a click that moves a hair is still a click);
//  - while the owner drags, the base of the drawing (the anchor) moves by exactly what the pointer moved;
//  - on release, a base within 24 px of the taskbar edge snaps onto it (`docked`), the bubble and the list get
//    the alignment of where he stayed, and a drop that leaves less than half of the drawing on any screen is
//    refused: the Jobu goes back to where he was (FR-005 would send him to the corner on the next start);
//  - Ctrl + wheel is a count of notches: a mouse gives 100 per notch, a touchpad gives less and the rest piles up.
//
// Positions are `PetPoint`s: the ANCHOR, the point at the center of the base of the drawing (placement.ts).

import { alignFor, displayNearestPoint, isDocked, isPlacementVisible, snapOnDrop } from './placement';
import type { PetAlign, PetDisplay, PetPoint } from './types';

// ---------------------------------------------------------------------------
// Click or drag
// ---------------------------------------------------------------------------

/** R11: the pointer has to travel this far (in a straight line) from where it went down before it is a drag. */
export const PET_DRAG_THRESHOLD = 4;

export function exceedsDragThreshold(start: PetPoint, current: PetPoint): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= PET_DRAG_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

/**
 * Where the base of the drawing is while the pointer is at `pointer`: the anchor the drag started from, moved by
 * the distance the pointer went since it started. Whole numbers: the window bounds are integers.
 */
export function dragAnchor(startAnchor: PetPoint, startPointer: PetPoint, pointer: PetPoint): PetPoint {
  return {
    x: Math.round(startAnchor.x + (pointer.x - startPointer.x)),
    y: Math.round(startAnchor.y + (pointer.y - startPointer.y)),
  };
}

/** What the screen needs from a drop: where the base stays, whether it sits on the taskbar edge, and how the bubble anchors. */
export interface DropOutcome {
  readonly anchor: PetPoint;
  readonly docked: boolean;
  readonly align: PetAlign;
  /** `false` = the drop left less than half of the drawing on every screen and the Jobu went back to `before`. */
  readonly accepted: boolean;
}

function placeOutcome(anchor: PetPoint, displays: readonly PetDisplay[], accepted: boolean): DropOutcome {
  const display = displayNearestPoint(displays, anchor);
  if (display === null) return { anchor, docked: false, align: 'center', accepted };
  return { anchor, docked: isDocked(anchor, display), align: alignFor(anchor, display), accepted };
}

/**
 * The owner let go with the base at `dropped`. A base within 24 px of the taskbar edge of the screen it is on
 * snaps onto it; anywhere else it stays. A place from which less than half of the drawing would be on a screen
 * is refused, and he returns to `before` (the anchor the drag started from).
 */
export function settleDrop(dropped: PetPoint, before: PetPoint, size: number, displays: readonly PetDisplay[]): DropOutcome {
  const display = displayNearestPoint(displays, dropped);
  if (display !== null) {
    const snapped = snapOnDrop(dropped, display);
    if (isPlacementVisible(snapped, size, displays)) return placeOutcome(snapped, displays, true);
  }
  return placeOutcome(before, displays, false);
}

// ---------------------------------------------------------------------------
// Ctrl + wheel
// ---------------------------------------------------------------------------

/** One notch of a mouse wheel in pixels (Windows reports 100 for the default 3 lines). */
export const PET_WHEEL_NOTCH = 100;

/**
 * The wheel delta in pixels, whatever the unit it came in (`WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages).
 * Windows gives pixels; lines and pages are converted so that a notch is always `PET_WHEEL_NOTCH`.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * (PET_WHEEL_NOTCH / 3);
  if (deltaMode === 2) return deltaY * PET_WHEEL_NOTCH;
  return deltaY;
}

/**
 * Turns the wheel delta into steps of the size. `accumulated` is what was left over from before (a touchpad
 * sends many small deltas, and each one alone is no notch); the answer is the whole steps to take (positive =
 * grow: the wheel rolled up has a NEGATIVE `deltaY`) and what is still piled up. A delta that is not a finite
 * number changes nothing.
 */
export function wheelSteps(accumulated: number, deltaY: number): { readonly steps: number; readonly rest: number } {
  if (!Number.isFinite(deltaY)) return { steps: 0, rest: accumulated };
  const total = accumulated + deltaY;
  const notches = Math.trunc(total / PET_WHEEL_NOTCH);
  return { steps: notches === 0 ? 0 : -notches, rest: total - notches * PET_WHEEL_NOTCH };
}
