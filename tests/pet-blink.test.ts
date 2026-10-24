// T053 (015-jobu-pet, US6, FR-028/FR-029/FR-030) - the blink of the Jobu. It is optional art: only `neutral` and
// `impatient` blink, only when their OWN picture is on screen (never a stand-in) and the blink frame exists in the
// folder of the poses. No frame, no blink, with no code to change when the art arrives. A blink swaps the frame
// for 120 ms, every 4 to 7 s; the scheduler is pure (timers and the dice come in) so the cadence is tested
// without a clock.
import { describe, expect, it } from 'vitest';
import { PET_BLINK_MAX_MS, PET_BLINK_MIN_MS, PET_BLINK_MS, blinkFrameFor, createBlinkScheduler, nextBlinkDelay } from '../src/shared/pet/blink';

const SHEET = ['neutral', 'talking', 'sleeping', 'skeptical', 'waffle', 'incense', 'reading', 'mirror', 'laughing', 'sad', 'angry', 'surprised'];

describe('blinkFrameFor: which frame blinks, if any', () => {
  it('with only the 12 poses of the sheet nothing blinks, whatever the pose', () => {
    const available = new Set(SHEET);
    for (const pose of ['neutral', 'impatient', 'reading', 'sleeping', 'incense', 'calling'] as const) {
      expect(blinkFrameFor(pose, pose, available)).toBeNull();
    }
  });

  it('`neutral` blinks with `blink-neutral`, once the frame exists', () => {
    expect(blinkFrameFor('neutral', 'neutral', new Set([...SHEET, 'blink-neutral']))).toBe('blink-neutral');
  });

  it('`impatient` blinks with `blink-impatient`, once the frame exists and its own picture is the one on screen', () => {
    expect(blinkFrameFor('impatient', 'impatient', new Set([...SHEET, 'impatient', 'blink-impatient']))).toBe('blink-impatient');
  });

  it('each pose asks for its own frame: the other one existing is no use', () => {
    expect(blinkFrameFor('neutral', 'neutral', new Set([...SHEET, 'blink-impatient']))).toBeNull();
    expect(blinkFrameFor('impatient', 'impatient', new Set([...SHEET, 'impatient', 'blink-neutral']))).toBeNull();
  });

  it('with the stand-in on screen (skeptical for the impatient one) there is no blink: the eyes of another face would shut', () => {
    expect(blinkFrameFor('impatient', 'skeptical', new Set([...SHEET, 'blink-impatient']))).toBeNull();
  });

  it('with no picture on screen there is no blink', () => {
    expect(blinkFrameFor('neutral', null, new Set([...SHEET, 'blink-neutral']))).toBeNull();
  });

  it('only those two poses blink: the others have no frame to ask for, with or without the blink art around', () => {
    const everything = new Set([...SHEET, 'impatient', 'very-impatient', 'calling', 'blink-neutral', 'blink-impatient']);
    for (const pose of ['reading', 'sleeping', 'incense', 'waffle', 'laughing', 'sad', 'surprised', 'mirror', 'angry', 'skeptical', 'talking', 'very-impatient', 'calling'] as const) {
      expect(blinkFrameFor(pose, pose, everything)).toBeNull();
    }
  });
});

describe('nextBlinkDelay: every 4 to 7 s', () => {
  it('the limits are 4 s and 7 s, and the blink itself is 120 ms', () => {
    expect(PET_BLINK_MIN_MS).toBe(4_000);
    expect(PET_BLINK_MAX_MS).toBe(7_000);
    expect(PET_BLINK_MS).toBe(120);
  });

  it('maps the dice linearly over that range', () => {
    expect(nextBlinkDelay(0)).toBe(4_000);
    expect(nextBlinkDelay(0.5)).toBe(5_500);
    expect(nextBlinkDelay(1)).toBe(7_000);
  });

  it('a dice outside 0..1, or no number at all, stays in range', () => {
    expect(nextBlinkDelay(-3)).toBe(4_000);
    expect(nextBlinkDelay(9)).toBe(7_000);
    expect(nextBlinkDelay(Number.NaN)).toBeGreaterThanOrEqual(4_000);
    expect(nextBlinkDelay(Number.NaN)).toBeLessThanOrEqual(7_000);
  });
});

/** A clock the test moves by hand, with the timers and the dice of the scheduler. */
function world(dice: readonly number[] = [0.5]) {
  const timers: { id: number; at: number; callback: () => void }[] = [];
  const changes: boolean[] = [];
  let now = 0;
  let nextId = 1;
  let rolls = 0;
  const scheduler = createBlinkScheduler({
    setTimeout: (callback, ms) => {
      const timer = { id: nextId, at: now + ms, callback };
      nextId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (handle) => {
      const at = timers.findIndex((timer) => timer.id === handle);
      if (at >= 0) timers.splice(at, 1);
    },
    random: () => dice[rolls++ % dice.length] ?? 0.5,
    onChange: (blinking) => void changes.push(blinking),
  });
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      now = due.at;
      due.callback();
    }
    now = until;
  };
  return { scheduler, changes, advance, pending: () => timers.length };
}

describe('createBlinkScheduler: close the eyes for 120 ms, then wait 4 to 7 s', () => {
  it('does nothing until it is started', () => {
    const w = world();
    w.advance(60_000);
    expect(w.changes).toEqual([]);
    expect(w.pending()).toBe(0);
  });

  it('after the wait it closes the eyes, and 120 ms later opens them', () => {
    const w = world([0.5]); // 5.5 s
    w.scheduler.start();
    w.advance(5_499);
    expect(w.changes).toEqual([]);
    w.advance(1);
    expect(w.changes).toEqual([true]);
    w.advance(PET_BLINK_MS - 1);
    expect(w.changes).toEqual([true]);
    w.advance(1);
    expect(w.changes).toEqual([true, false]);
  });

  it('then goes on: every wait is a new throw of the dice', () => {
    const w = world([0, 1, 0.5]); // 4 s, 7 s, 5.5 s
    w.scheduler.start();
    w.advance(4_000); // blink 1 starts
    expect(w.changes).toEqual([true]);
    w.advance(PET_BLINK_MS); // ends at 4_120
    w.advance(6_999); // 11_119: not yet
    expect(w.changes).toEqual([true, false]);
    w.advance(1); // 11_120: blink 2 starts (4_120 + 7_000)
    expect(w.changes).toEqual([true, false, true]);
    w.advance(PET_BLINK_MS);
    w.advance(5_499);
    expect(w.changes).toEqual([true, false, true, false]);
    w.advance(1);
    expect(w.changes).toEqual([true, false, true, false, true]);
  });

  it('over a minute of rest it blinks between 8 and 15 times, always two changes for each blink', () => {
    const w = world([0, 0.25, 0.5, 0.75, 1]);
    w.scheduler.start();
    w.advance(60_000);
    const closes = w.changes.filter((blinking) => blinking).length;
    expect(closes).toBeGreaterThanOrEqual(8);
    expect(closes).toBeLessThanOrEqual(15);
    expect(Math.abs(w.changes.length - 2 * closes)).toBeLessThanOrEqual(1); // a blink can still be open at the end
  });

  it('stopping cancels the wait: nothing blinks afterwards', () => {
    const w = world([0.5]);
    w.scheduler.start();
    w.advance(3_000);
    w.scheduler.stop();
    w.advance(60_000);
    expect(w.changes).toEqual([]);
    expect(w.pending()).toBe(0);
  });

  it('stopping with the eyes shut opens them at once, so a pose that changed never keeps a closed frame', () => {
    const w = world([0.5]);
    w.scheduler.start();
    w.advance(5_500);
    expect(w.changes).toEqual([true]);
    w.scheduler.stop();
    expect(w.changes).toEqual([true, false]);
    w.advance(60_000);
    expect(w.changes).toEqual([true, false]);
  });

  it('can start again after a stop, with a fresh wait', () => {
    const w = world([0.5]);
    w.scheduler.start();
    w.advance(1_000);
    w.scheduler.stop();
    w.scheduler.start();
    w.advance(5_499);
    expect(w.changes).toEqual([]);
    w.advance(1);
    expect(w.changes).toEqual([true]);
  });

  it('starting twice does not double the blinks', () => {
    const w = world([0.5]);
    w.scheduler.start();
    w.scheduler.start();
    expect(w.pending()).toBe(1);
    w.advance(5_500);
    expect(w.changes).toEqual([true]);
  });

  it('stopping when it never started, or twice, is harmless', () => {
    const w = world();
    expect(() => {
      w.scheduler.stop();
      w.scheduler.stop();
    }).not.toThrow();
    expect(w.changes).toEqual([]);
  });
});
