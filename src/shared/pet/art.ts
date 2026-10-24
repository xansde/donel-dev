// T028 (015-jobu-pet, US1) - the geometry of the art: where the base of the drawing is inside its PNG.
// Every pose is cut on the same canvas (`src/renderer/src/pet/assets/poses/manifest.json`, written by
// scripts/pet/slice-sprites.py), with the middle of the straight base of the bust at the ANCHOR. The
// window places the anchor on its own bottom edge (the base point, `placement.ts`), so the Jobu sits
// exactly on the line that the taskbar (or the owner) chose. The few pixels of transparent padding
// under the anchor fall outside the window and are cut there.
//
// The numbers repeat the manifest on purpose: the renderer must not parse JSON to draw, and
// tests/pet-art.test.ts reads the manifest and the PNG headers and fails if they ever disagree.

/** Canvas and anchor of every pose, in PNG pixels. */
export const PET_ART = {
  width: 264,
  height: 320,
  anchorX: 132,
  anchorY: 312,
} as const;

/** FR-004: when the Jobu floats, the bottom 18% of the art fades instead of showing a straight cut. */
export const PET_FADE_RATIO = 0.18;

/** The drawing at one size: all in DIP, measured from the top-left corner of the PNG as it is drawn. */
export interface PetDrawingMetrics {
  readonly width: number;
  /** The size itself: the height of the PNG as drawn (FR-008, FR-033). */
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  /** The transparent strip under the anchor: it goes below the window edge. */
  readonly inset: number;
  /** How tall the fade is when the Jobu floats. */
  readonly fade: number;
}

export function drawingMetrics(size: number): PetDrawingMetrics {
  const scale = size / PET_ART.height;
  const anchorY = PET_ART.anchorY * scale;
  return {
    width: PET_ART.width * scale,
    height: size,
    anchorX: PET_ART.anchorX * scale,
    anchorY,
    inset: (PET_ART.height - PET_ART.anchorY) * scale,
    fade: anchorY * PET_FADE_RATIO,
  };
}
