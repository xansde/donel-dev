// T046/T048 (015-jobu-pet, US5, R11/FR-004/FR-033) - the arithmetic of the gestures on the Jobu: the 4 px that
// tell a click from a drag, where the base of the drawing goes while the owner drags, how a drop settles
// (snap to the taskbar edge, `docked`, `align`, and the refusal of a drop that leaves less than half of the
// drawing on a screen), and how Ctrl + wheel turns into steps of the size. All pure and in DIP: the screen
// reads the pointer, the main moves the window, and neither decides anything.
import { describe, expect, it } from 'vitest';
import {
  PET_DRAG_THRESHOLD,
  PET_WHEEL_NOTCH,
  dragAnchor,
  exceedsDragThreshold,
  normalizeWheelDelta,
  settleDrop,
  wheelSteps,
} from '../src/shared/pet/gestures';
import { PET_SNAP_DISTANCE, defaultPlacement } from '../src/shared/pet/placement';
import type { PetDisplay } from '../src/shared/pet/types';

/** 1920x1080 with a 40 px taskbar at the bottom. */
const PRIMARY: PetDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
/** A second monitor to the right, taller, with its own taskbar. */
const SECOND: PetDisplay = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1.25 };
/** No taskbar at the bottom: the whole display is the work area. */
const NO_BAR: PetDisplay = { id: 3, bounds: { x: 0, y: 0, width: 1600, height: 900 }, workArea: { x: 0, y: 0, width: 1600, height: 900 }, scaleFactor: 1 };

describe('exceedsDragThreshold: 4 px tell a click from a drag (R11)', () => {
  it('is 4 px', () => {
    expect(PET_DRAG_THRESHOLD).toBe(4);
  });

  it('a pointer that has not moved, or moved less than 4 px in a straight line, is still a click', () => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 103, y: 100 })).toBe(false);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100, y: 97 })).toBe(false);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 102, y: 102 })).toBe(false);
  });

  it('from 4 px on it is a drag, in any direction', () => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 104, y: 100 })).toBe(true);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 96, y: 100 })).toBe(true);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100, y: 104 })).toBe(true);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100, y: 96 })).toBe(true);
  });

  it('it is the distance that counts, not each axis: 3 and 3 is 4.24 px', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it('works with negative coordinates (a monitor to the left of the primary one)', () => {
    expect(exceedsDragThreshold({ x: -500, y: 10 }, { x: -505, y: 10 })).toBe(true);
    expect(exceedsDragThreshold({ x: -500, y: 10 }, { x: -502, y: 10 })).toBe(false);
  });
});

describe('dragAnchor: the base follows the pointer, by the same distance', () => {
  it('no movement, no change', () => {
    expect(dragAnchor({ x: 1846, y: 1040 }, { x: 900, y: 500 }, { x: 900, y: 500 })).toEqual({ x: 1846, y: 1040 });
  });

  it('moves the anchor by exactly what the pointer moved, from where the drag started', () => {
    expect(dragAnchor({ x: 1846, y: 1040 }, { x: 900, y: 500 }, { x: 800, y: 450 })).toEqual({ x: 1746, y: 990 });
    expect(dragAnchor({ x: 1846, y: 1040 }, { x: 900, y: 500 }, { x: 950, y: 520 })).toEqual({ x: 1896, y: 1060 });
  });

  it('is relative to the start: the spot of the drawing that was grabbed stays under the pointer', () => {
    // Grabbed 30 px right of the base center; after moving the pointer by (+200, -100) the base center is 200/-100 away.
    const start = { x: 1000, y: 1040 };
    const pointer = { x: 1030, y: 980 };
    const moved = dragAnchor(start, pointer, { x: 1230, y: 880 });
    expect(moved).toEqual({ x: 1200, y: 940 });
    expect(1230 - moved.x).toBe(pointer.x - start.x);
  });

  it('crosses to another monitor: only the pointer distance matters', () => {
    expect(dragAnchor({ x: 1846, y: 1040 }, { x: 1800, y: 1000 }, { x: 2400, y: 1100 })).toEqual({ x: 2446, y: 1140 });
  });

  it('does not mutate what it receives', () => {
    const anchor = { x: 10, y: 20 };
    const start = { x: 1, y: 2 };
    const pointer = { x: 5, y: 7 };
    dragAnchor(anchor, start, pointer);
    expect(anchor).toEqual({ x: 10, y: 20 });
    expect(start).toEqual({ x: 1, y: 2 });
    expect(pointer).toEqual({ x: 5, y: 7 });
  });

  it('gives whole numbers: BrowserWindow bounds are integers, and a pointer on a scaled screen can be fractional', () => {
    const moved = dragAnchor({ x: 1000, y: 1000 }, { x: 10.4, y: 20.6 }, { x: 15.9, y: 18.2 });
    expect(Number.isInteger(moved.x)).toBe(true);
    expect(Number.isInteger(moved.y)).toBe(true);
  });
});

describe('settleDrop: where the Jobu stays when the owner lets go', () => {
  it('released within 24 px of the taskbar edge snaps the base onto it, and counts as docked', () => {
    expect(PET_SNAP_DISTANCE).toBe(24);
    const settled = settleDrop({ x: 1500, y: 1030 }, { x: 1846, y: 1040 }, 140, [PRIMARY]);
    expect(settled).toMatchObject({ anchor: { x: 1500, y: 1040 }, docked: true, accepted: true });
  });

  it('snaps from below the edge too, as long as it is within the reach', () => {
    expect(settleDrop({ x: 1500, y: 1060 }, { x: 1846, y: 1040 }, 140, [PRIMARY])).toMatchObject({ anchor: { x: 1500, y: 1040 }, docked: true });
  });

  it('released farther than 24 px from the edge floats where it is, not docked', () => {
    expect(settleDrop({ x: 1500, y: 800 }, { x: 1846, y: 1040 }, 140, [PRIMARY])).toMatchObject({ anchor: { x: 1500, y: 800 }, docked: false, accepted: true });
    expect(settleDrop({ x: 1500, y: 1040 - 25 }, { x: 1846, y: 1040 }, 140, [PRIMARY])).toMatchObject({ anchor: { x: 1500, y: 1015 }, docked: false });
  });

  it('with no taskbar at the bottom there is no edge to snap to: it floats, never docked (the base fades instead)', () => {
    expect(settleDrop({ x: 800, y: 895 }, { x: 800, y: 900 }, 140, [NO_BAR])).toMatchObject({ anchor: { x: 800, y: 895 }, docked: false });
  });

  it('decides on the display the base is on: the second monitor has its own taskbar edge', () => {
    // 1390 is 10 px above the edge of the second monitor (1400): snaps and docks there.
    expect(settleDrop({ x: 3000, y: 1390 }, { x: 1846, y: 1040 }, 140, [PRIMARY, SECOND])).toMatchObject({ anchor: { x: 3000, y: 1400 }, docked: true });
    // 1040 is exactly the edge of the PRIMARY one, but here it is 360 px above the edge of the monitor the base is on: it floats.
    expect(settleDrop({ x: 3000, y: 1040 }, { x: 1846, y: 1040 }, 140, [PRIMARY, SECOND])).toMatchObject({ anchor: { x: 3000, y: 1040 }, docked: false });
  });

  it('works out the alignment of the bubble for where the Jobu stayed: right near the right edge, left near the left, center elsewhere', () => {
    expect(settleDrop({ x: 1850, y: 1040 }, { x: 1000, y: 1040 }, 140, [PRIMARY]).align).toBe('right');
    expect(settleDrop({ x: 80, y: 1040 }, { x: 1000, y: 1040 }, 140, [PRIMARY]).align).toBe('left');
    expect(settleDrop({ x: 960, y: 1040 }, { x: 1000, y: 1040 }, 140, [PRIMARY]).align).toBe('center');
  });

  it('a drop that leaves less than half of the drawing on any screen is refused: the Jobu goes back to where he was', () => {
    const before = { x: 1846, y: 1040 };
    const refused = settleDrop({ x: 5000, y: 500 }, before, 140, [PRIMARY]);
    expect(refused).toMatchObject({ anchor: before, accepted: false });
    // ...and the answer already carries what the screen needs for the place he returned to.
    expect(refused.docked).toBe(true);
    expect(refused.align).toBe('right');
  });

  it('exactly half of the drawing inside is still accepted: the Jobu may hang half way off the edge', () => {
    // 140 px tall is 115.5 px wide: its center on the right edge of the screen leaves exactly half inside.
    expect(settleDrop({ x: 1920, y: 1040 }, { x: 1846, y: 1040 }, 140, [PRIMARY]).accepted).toBe(true);
    expect(settleDrop({ x: 1925, y: 1040 }, { x: 1846, y: 1040 }, 140, [PRIMARY]).accepted).toBe(false);
  });

  it('a drop right over the second monitor is accepted: it is the point of "any monitor"', () => {
    expect(settleDrop({ x: 2600, y: 700 }, { x: 1846, y: 1040 }, 140, [PRIMARY, SECOND])).toMatchObject({ anchor: { x: 2600, y: 700 }, accepted: true });
  });

  it('judges with the size of the drawing: a bigger one needs more room', () => {
    // At 320 px the drawing is 264 px wide: a center 100 px from the right edge leaves 100+132 ... less than half outside is fine; 140 px from it is not.
    expect(settleDrop({ x: 1850, y: 1040 }, { x: 1000, y: 1040 }, 320, [PRIMARY]).accepted).toBe(true);
    expect(settleDrop({ x: 1930, y: 1040 }, { x: 1000, y: 1040 }, 320, [PRIMARY]).accepted).toBe(false);
  });

  it('the default corner of the screen is accepted and docked: where he is born stays valid', () => {
    const corner = defaultPlacement(PRIMARY, 140);
    expect(settleDrop(corner, { x: 500, y: 500 }, 140, [PRIMARY])).toMatchObject({ anchor: corner, docked: true, accepted: true });
  });

  it('with no displays at all nothing can be judged: refused, back to where it was', () => {
    expect(settleDrop({ x: 100, y: 100 }, { x: 50, y: 60 }, 140, [])).toMatchObject({ anchor: { x: 50, y: 60 }, accepted: false });
  });
});

describe('Ctrl + wheel (FR-033): notches turn into steps of the size', () => {
  it('a mouse notch is 100: wheel up (negative delta) is one step to grow, wheel down one to shrink', () => {
    expect(PET_WHEEL_NOTCH).toBe(100);
    expect(wheelSteps(0, -100)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, 100)).toEqual({ steps: -1, rest: 0 });
  });

  it('a smaller delta (a touchpad, a pinch) piles up until it makes a step', () => {
    let acc = 0;
    const outcomes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const { steps, rest } = wheelSteps(acc, -25);
      acc = rest;
      outcomes.push(steps);
    }
    expect(outcomes).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(acc).toBe(0);
  });

  it('a big delta makes several steps and keeps the rest for the next one', () => {
    expect(wheelSteps(0, -250)).toEqual({ steps: 2, rest: -50 });
    expect(wheelSteps(-50, -60)).toEqual({ steps: 1, rest: -10 });
    expect(wheelSteps(0, 340)).toEqual({ steps: -3, rest: 40 });
  });

  it('a reversal cancels what was piled up the other way before it steps', () => {
    const grown = wheelSteps(0, -60);
    expect(grown).toEqual({ steps: 0, rest: -60 });
    expect(wheelSteps(grown.rest, 100)).toEqual({ steps: 0, rest: 40 });
  });

  it('never answers a minus zero (a step of 0 is 0)', () => {
    expect(Object.is(wheelSteps(0, -50).steps, 0)).toBe(true);
    expect(Object.is(wheelSteps(0, 50).steps, 0)).toBe(true);
    expect(Object.is(wheelSteps(0, 0).steps, 0)).toBe(true);
  });

  it('ignores a delta that is not a number', () => {
    expect(wheelSteps(30, Number.NaN)).toEqual({ steps: 0, rest: 30 });
    expect(wheelSteps(30, Number.POSITIVE_INFINITY)).toEqual({ steps: 0, rest: 30 });
  });
});

describe('normalizeWheelDelta: the delta in pixels, whatever the unit the wheel reports', () => {
  it('pixels stay as they are (what a mouse wheel and a touchpad give on Windows)', () => {
    expect(normalizeWheelDelta(-100, 0)).toBe(-100);
    expect(normalizeWheelDelta(7, 0)).toBe(7);
  });

  it('lines are worth a third of a notch each, so the 3 lines of a notch are 100 px', () => {
    expect(normalizeWheelDelta(3, 1)).toBeCloseTo(100, 5);
    expect(normalizeWheelDelta(-3, 1)).toBeCloseTo(-100, 5);
  });

  it('a page is a whole notch', () => {
    expect(normalizeWheelDelta(1, 2)).toBe(100);
    expect(normalizeWheelDelta(-1, 2)).toBe(-100);
  });

  it('an unknown unit is taken as pixels', () => {
    expect(normalizeWheelDelta(-40, 9)).toBe(-40);
  });
});
