// T007 (015-jobu-pet) - placement, docking, validity, alignment, window geometry and size.
// Synthetic monitors only; every number is in DIP, so `scaleFactor` must never change a result.
import { describe, expect, it } from 'vitest';
import {
  PET_ALIGN_EDGE,
  PET_DOCK_TOLERANCE,
  PET_EDGE_MARGIN,
  PET_SIZE_DEFAULT,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  PET_SIZE_PRESETS,
  PET_SIZE_STEP,
  PET_SNAP_DISTANCE,
  alignFor,
  anchorOf,
  clampSize,
  defaultPlacement,
  displayNearestPoint,
  drawingRectFor,
  isDocked,
  isPlacementVisible,
  snapOnDrop,
  stepSize,
  taskbarAtBottom,
  windowBoundsFor,
  windowSizeFor,
} from '../src/shared/pet/placement';
import type { PetDisplay } from '../src/shared/pet/types';

/** 1920x1080 with a 40 px taskbar at the bottom: the usual Windows primary monitor. */
const PRIMARY: PetDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
/** A second monitor to the right, taller, at 125% scale, with its own taskbar. */
const SECOND: PetDisplay = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.25,
};
/** Taskbar on the left: the work area loses width, not height. */
const TASKBAR_LEFT: PetDisplay = {
  id: 3,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 60, y: 0, width: 1860, height: 1080 },
  scaleFactor: 1,
};
/** Taskbar on top: the work area starts lower and still ends at the bottom of the screen. */
const TASKBAR_TOP: PetDisplay = {
  id: 4,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 40, width: 1920, height: 1040 },
  scaleFactor: 1,
};
/** Taskbar hidden: the work area is the whole screen. */
const TASKBAR_HIDDEN: PetDisplay = {
  id: 5,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

const WORK_BOTTOM = 1040;

/** Distance between the right edge of the drawing and `edge`; whole-DIP rounding may cost up to half a pixel. */
function rightGap(anchor: { x: number; y: number }, size: number, edge: number): number {
  const drawing = drawingRectFor(anchor, size);
  return edge - (drawing.x + drawing.width);
}

describe('constants', () => {
  it('match the plan', () => {
    expect(PET_EDGE_MARGIN).toBe(16);
    expect(PET_DOCK_TOLERANCE).toBe(4);
    expect(PET_SNAP_DISTANCE).toBe(24);
    expect(PET_ALIGN_EDGE).toBe(160);
    expect(PET_SIZE_MIN).toBe(80);
    expect(PET_SIZE_MAX).toBe(320);
    expect(PET_SIZE_DEFAULT).toBe(140);
    expect(PET_SIZE_STEP).toBe(10);
  });
});

describe('defaultPlacement (D8, FR-003)', () => {
  it('puts the drawing 16 px from the right edge of the work area, its base on the bottom of the work area', () => {
    const anchor = defaultPlacement(PRIMARY, 140);
    const drawing = drawingRectFor(anchor, 140);
    expect(Math.abs(rightGap(anchor, 140, PRIMARY.workArea.width) - PET_EDGE_MARGIN)).toBeLessThanOrEqual(0.5);
    expect(drawing.y + drawing.height).toBe(WORK_BOTTOM);
    expect(anchor.y).toBe(WORK_BOTTOM);
  });

  it('keeps the 16 px margin for every size', () => {
    for (const size of [...PET_SIZE_PRESETS.map((preset) => preset.size), PET_SIZE_MIN, PET_SIZE_MAX]) {
      expect(Math.abs(rightGap(defaultPlacement(PRIMARY, size), size, 1920) - PET_EDGE_MARGIN)).toBeLessThanOrEqual(0.5);
    }
  });

  it('works on a display that does not start at the origin', () => {
    const anchor = defaultPlacement(SECOND, 140);
    expect(Math.abs(rightGap(anchor, 140, 1920 + 2560) - PET_EDGE_MARGIN)).toBeLessThanOrEqual(0.5);
    expect(anchor.y).toBe(1400);
  });

  it('with the taskbar on the left or hidden, still the bottom right corner of the work area', () => {
    const left = defaultPlacement(TASKBAR_LEFT, 140);
    expect(Math.abs(rightGap(left, 140, 1920) - PET_EDGE_MARGIN)).toBeLessThanOrEqual(0.5);
    expect(left.y).toBe(1080);
    expect(defaultPlacement(TASKBAR_HIDDEN, 140).y).toBe(1080);
    expect(defaultPlacement(TASKBAR_TOP, 140).y).toBe(1080);
  });

  it('keeps the drawing inside a work area that is narrower than it', () => {
    const narrow: PetDisplay = { ...PRIMARY, bounds: { x: 0, y: 0, width: 100, height: 600 }, workArea: { x: 0, y: 0, width: 100, height: 600 } };
    const anchor = defaultPlacement(narrow, 140);
    expect(anchor.x - (140 * 0.825) / 2).toBeGreaterThanOrEqual(-0.5);
  });

  it('does not depend on the scale factor (inputs and outputs are DIP)', () => {
    expect(defaultPlacement({ ...PRIMARY, scaleFactor: 2 }, 140)).toEqual(defaultPlacement({ ...PRIMARY, scaleFactor: 1 }, 140));
  });

  it('returns whole numbers (BrowserWindow bounds are integers)', () => {
    const anchor = defaultPlacement(SECOND, 200);
    expect(Number.isInteger(anchor.x)).toBe(true);
    expect(Number.isInteger(anchor.y)).toBe(true);
  });
});

describe('taskbarAtBottom', () => {
  it('is true only when something is reserved at the bottom of the display', () => {
    expect(taskbarAtBottom(PRIMARY)).toBe(true);
    expect(taskbarAtBottom(SECOND)).toBe(true);
    expect(taskbarAtBottom(TASKBAR_LEFT)).toBe(false);
    expect(taskbarAtBottom(TASKBAR_TOP)).toBe(false);
    expect(taskbarAtBottom(TASKBAR_HIDDEN)).toBe(false);
  });
});

describe('isDocked (tolerance of 4 px)', () => {
  it('is docked when the base of the drawing is on the bottom of the work area and the taskbar is at the bottom', () => {
    expect(isDocked({ x: 900, y: WORK_BOTTOM }, PRIMARY)).toBe(true);
  });

  it('allows 4 px either way, and no more', () => {
    expect(isDocked({ x: 900, y: WORK_BOTTOM - 4 }, PRIMARY)).toBe(true);
    expect(isDocked({ x: 900, y: WORK_BOTTOM + 4 }, PRIMARY)).toBe(true);
    expect(isDocked({ x: 900, y: WORK_BOTTOM - 5 }, PRIMARY)).toBe(false);
    expect(isDocked({ x: 900, y: WORK_BOTTOM + 5 }, PRIMARY)).toBe(false);
  });

  it('is never docked when the taskbar is not at the bottom (FR-004: the base fades instead)', () => {
    expect(isDocked({ x: 900, y: 1080 }, TASKBAR_LEFT)).toBe(false);
    expect(isDocked({ x: 900, y: 1080 }, TASKBAR_TOP)).toBe(false);
    expect(isDocked({ x: 900, y: 1080 }, TASKBAR_HIDDEN)).toBe(false);
  });

  it('uses the work area of the display it is given', () => {
    expect(isDocked({ x: 3000, y: 1400 }, SECOND)).toBe(true);
    expect(isDocked({ x: 3000, y: WORK_BOTTOM }, SECOND)).toBe(false);
  });

  it('does not depend on the horizontal position', () => {
    expect(isDocked({ x: -5000, y: WORK_BOTTOM }, PRIMARY)).toBe(true);
  });
});

describe('snapOnDrop (24 px)', () => {
  it('snaps the base to the taskbar edge when released within 24 px, above or below it', () => {
    expect(snapOnDrop({ x: 700, y: WORK_BOTTOM - 24 }, PRIMARY)).toEqual({ x: 700, y: WORK_BOTTOM });
    expect(snapOnDrop({ x: 700, y: WORK_BOTTOM - 1 }, PRIMARY)).toEqual({ x: 700, y: WORK_BOTTOM });
    expect(snapOnDrop({ x: 700, y: WORK_BOTTOM + 24 }, PRIMARY)).toEqual({ x: 700, y: WORK_BOTTOM });
  });

  it('keeps x untouched', () => {
    expect(snapOnDrop({ x: 123.5, y: WORK_BOTTOM - 10 }, PRIMARY).x).toBe(123.5);
  });

  it('leaves the point alone beyond 24 px', () => {
    expect(snapOnDrop({ x: 700, y: WORK_BOTTOM - 25 }, PRIMARY)).toEqual({ x: 700, y: WORK_BOTTOM - 25 });
    expect(snapOnDrop({ x: 700, y: WORK_BOTTOM + 25 }, PRIMARY)).toEqual({ x: 700, y: WORK_BOTTOM + 25 });
    expect(snapOnDrop({ x: 700, y: 300 }, PRIMARY)).toEqual({ x: 700, y: 300 });
  });

  it('never snaps when the taskbar is not at the bottom', () => {
    expect(snapOnDrop({ x: 700, y: 1075 }, TASKBAR_LEFT)).toEqual({ x: 700, y: 1075 });
    expect(snapOnDrop({ x: 700, y: 1075 }, TASKBAR_HIDDEN)).toEqual({ x: 700, y: 1075 });
    expect(snapOnDrop({ x: 700, y: 1075 }, TASKBAR_TOP)).toEqual({ x: 700, y: 1075 });
  });

  it('snaps to the work area of the display it is given', () => {
    expect(snapOnDrop({ x: 3000, y: 1390 }, SECOND)).toEqual({ x: 3000, y: 1400 });
  });

  it('what it returns counts as docked', () => {
    expect(isDocked(snapOnDrop({ x: 700, y: WORK_BOTTOM - 20 }, PRIMARY), PRIMARY)).toBe(true);
  });

  it('does not mutate the input point', () => {
    const point = { x: 700, y: WORK_BOTTOM - 10 };
    snapOnDrop(point, PRIMARY);
    expect(point).toEqual({ x: 700, y: WORK_BOTTOM - 10 });
  });
});

describe('isPlacementVisible (FR-005: at least half of the drawing inside some work area)', () => {
  it('the default position is visible, on every display and for every size', () => {
    for (const display of [PRIMARY, SECOND, TASKBAR_LEFT, TASKBAR_TOP, TASKBAR_HIDDEN]) {
      for (const { size } of PET_SIZE_PRESETS) {
        expect(isPlacementVisible(defaultPlacement(display, size), size, [display])).toBe(true);
      }
    }
  });

  it('exactly half inside counts; a hair less does not (horizontal, left edge)', () => {
    // the anchor is the center of the drawing: on the edge, half of it is inside
    expect(isPlacementVisible({ x: 0, y: 600 }, 140, [PRIMARY])).toBe(true);
    expect(isPlacementVisible({ x: -1, y: 600 }, 140, [PRIMARY])).toBe(false);
  });

  it('exactly half inside counts; a hair less does not (horizontal, right edge)', () => {
    expect(isPlacementVisible({ x: 1920, y: 600 }, 140, [PRIMARY])).toBe(true);
    expect(isPlacementVisible({ x: 1921, y: 600 }, 140, [PRIMARY])).toBe(false);
  });

  it('exactly half inside counts; a hair less does not (vertical, top edge)', () => {
    expect(isPlacementVisible({ x: 900, y: 70 }, 140, [PRIMARY])).toBe(true);
    expect(isPlacementVisible({ x: 900, y: 69 }, 140, [PRIMARY])).toBe(false);
  });

  it('exactly half inside counts; a hair less does not (vertical, behind the taskbar)', () => {
    // the work area ends at 1040: with the base at 1110 the lower 70 px are under the taskbar
    expect(isPlacementVisible({ x: 900, y: WORK_BOTTOM + 70 }, 140, [PRIMARY])).toBe(true);
    expect(isPlacementVisible({ x: 900, y: WORK_BOTTOM + 71 }, 140, [PRIMARY])).toBe(false);
  });

  it('far outside every display is invalid', () => {
    expect(isPlacementVisible({ x: -5000, y: 300 }, 140, [PRIMARY, SECOND])).toBe(false);
    expect(isPlacementVisible({ x: 900, y: 9000 }, 140, [PRIMARY, SECOND])).toBe(false);
  });

  it('is valid when the drawing is on any of the displays', () => {
    expect(isPlacementVisible({ x: 3000, y: 800 }, 140, [PRIMARY, SECOND])).toBe(true);
    // a monitor that was unplugged: the point only existed on SECOND
    expect(isPlacementVisible({ x: 3000, y: 800 }, 140, [PRIMARY])).toBe(false);
  });

  it('judges the drawing, not the (much wider) window around it', () => {
    // the 480 px wide window would still overlap the screen, but the drawing is entirely outside
    expect(isPlacementVisible({ x: -100, y: 600 }, 140, [PRIMARY])).toBe(false);
  });

  it('a bigger drawing needs more room: the half rule scales with the size', () => {
    expect(isPlacementVisible({ x: 0, y: 600 }, 320, [PRIMARY])).toBe(true);
    expect(isPlacementVisible({ x: -1, y: 600 }, 320, [PRIMARY])).toBe(false);
  });

  it('no displays at all is invalid', () => {
    expect(isPlacementVisible({ x: 900, y: 600 }, 140, [])).toBe(false);
  });
});

describe('alignFor (160 px from the edges)', () => {
  it('right when the drawing is within 160 px of the right edge of the work area', () => {
    expect(alignFor({ x: 1830, y: WORK_BOTTOM }, PRIMARY)).toBe('right');
    expect(alignFor({ x: 1920 - PET_ALIGN_EDGE, y: WORK_BOTTOM }, PRIMARY)).toBe('right');
  });

  it('left when within 160 px of the left edge', () => {
    expect(alignFor({ x: 100, y: WORK_BOTTOM }, PRIMARY)).toBe('left');
    expect(alignFor({ x: PET_ALIGN_EDGE, y: WORK_BOTTOM }, PRIMARY)).toBe('left');
  });

  it('center anywhere else', () => {
    expect(alignFor({ x: 960, y: WORK_BOTTOM }, PRIMARY)).toBe('center');
    expect(alignFor({ x: 1920 - PET_ALIGN_EDGE - 1, y: WORK_BOTTOM }, PRIMARY)).toBe('center');
    expect(alignFor({ x: PET_ALIGN_EDGE + 1, y: WORK_BOTTOM }, PRIMARY)).toBe('center');
  });

  it('measures from the work area of the display it is given', () => {
    // SECOND starts at x = 1920: 100 px in is "left", and 100 px from its right edge is "right"
    expect(alignFor({ x: 1920 + 100, y: 1400 }, SECOND)).toBe('left');
    expect(alignFor({ x: 4480 - 100, y: 1400 }, SECOND)).toBe('right');
    expect(alignFor({ x: 3200, y: 1400 }, SECOND)).toBe('center');
    // with the taskbar on the left the usable area starts at 60
    expect(alignFor({ x: 60 + 100, y: 600 }, TASKBAR_LEFT)).toBe('left');
  });

  it('when both edges are close, the nearer wins (tie goes to the right, the default corner)', () => {
    const tiny: PetDisplay = { ...PRIMARY, bounds: { x: 0, y: 0, width: 300, height: 600 }, workArea: { x: 0, y: 0, width: 300, height: 600 } };
    expect(alignFor({ x: 100, y: 600 }, tiny)).toBe('left');
    expect(alignFor({ x: 200, y: 600 }, tiny)).toBe('right');
    expect(alignFor({ x: 150, y: 600 }, tiny)).toBe('right');
  });

  it('the default position aligns right, so the first bubble opens towards the screen', () => {
    for (const display of [PRIMARY, SECOND, TASKBAR_LEFT]) {
      expect(alignFor(defaultPlacement(display, 140), display)).toBe('right');
    }
  });
});

describe('displayNearestPoint', () => {
  it('returns the display that contains the point', () => {
    expect(displayNearestPoint([PRIMARY, SECOND], { x: 100, y: 100 })?.id).toBe(1);
    expect(displayNearestPoint([PRIMARY, SECOND], { x: 3000, y: 100 })?.id).toBe(2);
  });

  it('with the point outside everything, returns the closest display', () => {
    expect(displayNearestPoint([PRIMARY, SECOND], { x: -300, y: 500 })?.id).toBe(1);
    expect(displayNearestPoint([PRIMARY, SECOND], { x: 6000, y: 500 })?.id).toBe(2);
    expect(displayNearestPoint([PRIMARY, SECOND], { x: 900, y: 1500 })?.id).toBe(1);
  });

  it('a point on the base line of a display (the taskbar edge) belongs to it', () => {
    // the base of a docked drawing sits at workArea bottom, 40 px above the bottom of the bounds
    expect(displayNearestPoint([PRIMARY, SECOND], { x: 1000, y: WORK_BOTTOM })?.id).toBe(1);
  });

  it('is null without displays', () => {
    expect(displayNearestPoint([], { x: 0, y: 0 })).toBeNull();
  });
});

describe('window geometry (R9, FR-033)', () => {
  it('measures max(480, 3.4 x size) by size + 200', () => {
    expect(windowSizeFor(80)).toEqual({ width: 480, height: 280 });
    expect(windowSizeFor(100)).toEqual({ width: 480, height: 300 });
    expect(windowSizeFor(140)).toEqual({ width: 480, height: 340 });
    expect(windowSizeFor(200)).toEqual({ width: 680, height: 400 });
    expect(windowSizeFor(260)).toEqual({ width: 884, height: 460 });
    expect(windowSizeFor(320)).toEqual({ width: 1088, height: 520 });
  });

  it('windowBoundsFor puts the anchor at the bottom center of the window', () => {
    const bounds = windowBoundsFor({ x: 1000, y: 1040 }, 140);
    expect(bounds).toEqual({ x: 760, y: 700, width: 480, height: 340 });
    expect(bounds.x + bounds.width / 2).toBe(1000);
    expect(bounds.y + bounds.height).toBe(1040);
  });

  it('anchorOf is the inverse of windowBoundsFor, for every preset', () => {
    for (const { size } of PET_SIZE_PRESETS) {
      const anchor = { x: 1234, y: 1040 };
      expect(anchorOf(windowBoundsFor(anchor, size), size)).toEqual(anchor);
    }
  });

  it('anchorOf also takes just the top-left corner of the window plus the size', () => {
    expect(anchorOf({ x: 760, y: 700 }, 140)).toEqual({ x: 1000, y: 1040 });
  });

  it('resizing keeps the anchor fixed: the window grows upwards and sideways, never moves the base', () => {
    const anchor = { x: 1500, y: 1040 };
    const small = windowBoundsFor(anchor, 100);
    const big = windowBoundsFor(anchor, 260);
    expect(small.y + small.height).toBe(1040);
    expect(big.y + big.height).toBe(1040);
    expect(big.y).toBeLessThan(small.y);
    expect(big.x).toBeLessThan(small.x);
    expect(big.x + big.width / 2).toBe(1500);
    expect(anchorOf(big, 260)).toEqual(anchorOf(small, 100));
  });

  it('may poke out of the screen: only the center of the drawing has to stay on a monitor', () => {
    const bounds = windowBoundsFor(defaultPlacement(PRIMARY, 140), 140);
    expect(bounds.x + bounds.width).toBeGreaterThan(1920);
  });

  it('returns whole numbers even for a size that is not a multiple of 10', () => {
    const bounds = windowBoundsFor({ x: 1001, y: 1040 }, 145);
    for (const value of Object.values(bounds)) expect(Number.isInteger(value)).toBe(true);
  });
});

describe('size (FR-033)', () => {
  it('clampSize keeps 80-320', () => {
    expect(clampSize(50)).toBe(80);
    expect(clampSize(80)).toBe(80);
    expect(clampSize(140)).toBe(140);
    expect(clampSize(320)).toBe(320);
    expect(clampSize(500)).toBe(320);
    expect(clampSize(-10)).toBe(80);
  });

  it('clampSize rounds to a whole number and falls back to the default for garbage', () => {
    expect(clampSize(143.4)).toBe(143);
    expect(clampSize(Number.NaN)).toBe(PET_SIZE_DEFAULT);
    expect(clampSize(Number.POSITIVE_INFINITY)).toBe(PET_SIZE_DEFAULT);
  });

  it('stepSize moves 10 at a time and stops at the limits', () => {
    expect(stepSize(140, 1)).toBe(150);
    expect(stepSize(140, -1)).toBe(130);
    expect(stepSize(320, 1)).toBe(320);
    expect(stepSize(80, -1)).toBe(80);
    expect(stepSize(315, 1)).toBe(320);
  });

  it('walks the whole range from the minimum to the maximum in 24 steps', () => {
    let size = PET_SIZE_MIN;
    let steps = 0;
    while (size < PET_SIZE_MAX) {
      size = stepSize(size, 1);
      steps += 1;
    }
    expect(size).toBe(PET_SIZE_MAX);
    expect(steps).toBe(24);
  });

  it('has the four presets of the menu, with the default among them', () => {
    expect(PET_SIZE_PRESETS).toEqual([
      { label: 'Pequeno', size: 100 },
      { label: 'Médio', size: 140 },
      { label: 'Grande', size: 200 },
      { label: 'Muito grande', size: 260 },
    ]);
    expect(PET_SIZE_PRESETS.map((preset) => preset.size)).toContain(PET_SIZE_DEFAULT);
    for (const { size } of PET_SIZE_PRESETS) expect(clampSize(size)).toBe(size);
  });
});
