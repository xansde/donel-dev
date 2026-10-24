// T013 (015-jobu-pet, R15, FR-029) - from a logical pose to the art that exists. The renderer of
// the pet discovers the available files at build time; this pure function decides which one to
// draw. New art enters by adding the PNG, never by touching code: the stand-ins below only apply
// while a file is missing.

import type { BlinkPoseName, PoseName } from './types';

/** Stand-ins for the poses the v2 sheet does not have (FR-029). Blink frames have none: no art, no blink. */
export const PROVISIONAL_POSES: Readonly<Partial<Record<PoseName, PoseName>>> = {
  impatient: 'skeptical',
  'very-impatient': 'angry',
  calling: 'talking',
  // 016-jobu-faxina: owner's alfa feedback (23/10); drop sweeping.png in assets/poses/ and this stops applying.
  sweeping: 'mirror',
};

/** The picture to draw when the pose itself has no art and no stand-in is available. */
const GENERIC_POSE: PoseName = 'neutral';

function isBlinkPose(pose: PoseName | BlinkPoseName): pose is BlinkPoseName {
  return pose.startsWith('blink-');
}

/**
 * The art file (by pose name) to draw for `logical`:
 * - the pose itself, when it has art;
 * - else its provisional stand-in, when that has art;
 * - else `neutral`, so a missing file never makes the pet vanish;
 * - `null` when there is nothing to draw (no art at all), and always `null` for a blink frame
 *   without art: blinking is optional and nothing stands in for it.
 */
export function resolvePose(logical: PoseName | BlinkPoseName, available: ReadonlySet<string> | readonly string[]): PoseName | BlinkPoseName | null {
  const has = (name: string): boolean => (Array.isArray(available) ? available.includes(name) : (available as ReadonlySet<string>).has(name));

  if (has(logical)) return logical;
  if (isBlinkPose(logical)) return null;

  const standIn = PROVISIONAL_POSES[logical];
  if (standIn !== undefined && has(standIn)) return standIn;

  return has(GENERIC_POSE) ? GENERIC_POSE : null;
}
