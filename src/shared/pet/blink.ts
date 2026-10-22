// T053 (015-jobu-pet, US6, FR-028/FR-029/FR-030) - the blink of the Jobu, pure. Blinking is OPTIONAL art
// (`blink-neutral`, `blink-impatient`): only `neutral` and `impatient` blink, and only when their OWN picture
// is on screen, because a blink frame is the same face with the eyes shut and putting it over a stand-in
// (the skeptical one drawn for the impatient pose while its art does not exist) would shut the eyes of another
// face. No frame in the folder of the poses, no blink; when the PNG arrives the blink starts with no change in
// the code (R15). A blink swaps the frame for 120 ms, every 4 to 7 s.
//
// The scheduler takes the timers and the dice as arguments, so the cadence is tested without a clock; the
// screen (src/renderer/src/pet/PetApp.tsx) wires it to `setTimeout` and `Math.random`.

import type { BlinkPoseName, PoseName } from './types';

/** How long the eyes stay shut. */
export const PET_BLINK_MS = 120;
/** The wait between two blinks goes from this... */
export const PET_BLINK_MIN_MS = 4_000;
/** ...to this. */
export const PET_BLINK_MAX_MS = 7_000;

const BLINK_FRAME_OF: Readonly<Partial<Record<PoseName, BlinkPoseName>>> = {
  neutral: 'blink-neutral',
  impatient: 'blink-impatient',
};

/**
 * The blink frame to show for `logical` while its picture `drawn` is on screen, or `null`: the pose does not
 * blink, the picture on screen is a stand-in or nothing, or the frame does not exist.
 */
export function blinkFrameFor(logical: PoseName, drawn: string | null, available: ReadonlySet<string>): BlinkPoseName | null {
  const frame = BLINK_FRAME_OF[logical];
  if (frame === undefined || drawn !== logical || !available.has(frame)) return null;
  return frame;
}

/** The wait until the next blink for a throw of the dice in 0..1 (anything else is clamped, no number is the middle). */
export function nextBlinkDelay(random: number): number {
  const dice = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
  return Math.round(PET_BLINK_MIN_MS + dice * (PET_BLINK_MAX_MS - PET_BLINK_MIN_MS));
}

export interface BlinkSchedulerDeps {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  /** A throw of the dice in 0..1. */
  readonly random: () => number;
  /** `true` = the eyes just shut, `false` = they opened. */
  readonly onChange: (blinking: boolean) => void;
}

export interface BlinkScheduler {
  /** Starts the cycle (wait, shut, open, wait...). Starting what already runs does nothing. */
  start(): void;
  /** Cancels it; with the eyes shut they open at once. Stopping what is not running does nothing. */
  stop(): void;
}

export function createBlinkScheduler(deps: BlinkSchedulerDeps): BlinkScheduler {
  let handle: unknown = null;
  let running = false;
  let blinking = false;

  const later = (ms: number, callback: () => void): void => {
    handle = deps.setTimeout(callback, ms);
  };
  const wait = (): void => later(nextBlinkDelay(deps.random()), shut);
  const shut = (): void => {
    blinking = true;
    deps.onChange(true);
    later(PET_BLINK_MS, open);
  };
  const open = (): void => {
    blinking = false;
    deps.onChange(false);
    wait();
  };

  return {
    start() {
      if (running) return;
      running = true;
      wait();
    },
    stop() {
      if (!running) return;
      running = false;
      if (handle !== null) {
        deps.clearTimeout(handle);
        handle = null;
      }
      if (blinking) {
        blinking = false;
        deps.onChange(false);
      }
    },
  };
}
