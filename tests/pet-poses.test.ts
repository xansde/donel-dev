// T008 (015-jobu-pet) - resolving a logical pose to the art that exists (R15, FR-029).
// Arrival of new art must change the picture only, never the behavior.
import { describe, expect, it } from 'vitest';
import { PROVISIONAL_POSES, resolvePose } from '../src/shared/pet/poses';
import { BLINK_POSE_NAMES, POSE_NAMES } from '../src/shared/pet/types';

/** The 12 poses of the v2 sheet: what exists before the new art. */
const SHEET = ['neutral', 'talking', 'sleeping', 'skeptical', 'waffle', 'incense', 'reading', 'mirror', 'laughing', 'sad', 'angry', 'surprised'];

describe('PROVISIONAL_POSES (FR-029)', () => {
  it('is exactly impatient -> skeptical, very-impatient -> angry, calling -> talking, sweeping -> mirror', () => {
    expect({ ...PROVISIONAL_POSES }).toEqual({ impatient: 'skeptical', 'very-impatient': 'angry', calling: 'talking', sweeping: 'mirror' });
  });

  it('only provisions poses that the sheet does not have, and only with poses it has', () => {
    for (const [logical, stand] of Object.entries(PROVISIONAL_POSES)) {
      expect(SHEET).not.toContain(logical);
      expect(SHEET).toContain(stand);
    }
  });
});

describe('resolvePose', () => {
  it('a pose that has art resolves to itself', () => {
    for (const pose of SHEET) expect(resolvePose(pose as never, new Set(SHEET))).toBe(pose);
  });

  it('with only the sheet, the three new poses resolve to their provisional stand-ins', () => {
    const available = new Set(SHEET);
    expect(resolvePose('impatient', available)).toBe('skeptical');
    expect(resolvePose('very-impatient', available)).toBe('angry');
    expect(resolvePose('calling', available)).toBe('talking');
  });

  it('when the new art arrives it takes over, without anything else changing', () => {
    const withNew = new Set([...SHEET, 'impatient', 'very-impatient', 'calling']);
    expect(resolvePose('impatient', withNew)).toBe('impatient');
    expect(resolvePose('very-impatient', withNew)).toBe('very-impatient');
    expect(resolvePose('calling', withNew)).toBe('calling');
    // the twelve sheet poses resolve exactly as before
    for (const pose of SHEET) expect(resolvePose(pose as never, withNew)).toBe(pose);
  });

  it('a partial arrival only replaces the poses that arrived', () => {
    const available = new Set([...SHEET, 'calling']);
    expect(resolvePose('calling', available)).toBe('calling');
    expect(resolvePose('impatient', available)).toBe('skeptical');
    expect(resolvePose('very-impatient', available)).toBe('angry');
  });

  it('blink frames are optional: without the art there is no blink, and nothing stands in for them', () => {
    const available = new Set(SHEET);
    for (const blink of BLINK_POSE_NAMES) expect(resolvePose(blink, available)).toBeNull();
    // `neutral` exists, yet `blink-neutral` must not turn into it: that would be "blinking" to the same picture
    expect(resolvePose('blink-neutral', new Set(['neutral']))).toBeNull();
  });

  it('blink frames resolve to themselves once the art exists', () => {
    const available = new Set([...SHEET, 'blink-neutral', 'blink-impatient']);
    expect(resolvePose('blink-neutral', available)).toBe('blink-neutral');
    expect(resolvePose('blink-impatient', available)).toBe('blink-impatient');
  });

  it('a pose with no art and no stand-in falls back to neutral, then to nothing', () => {
    expect(resolvePose('sleeping', new Set(['neutral', 'talking']))).toBe('neutral');
    expect(resolvePose('sleeping', new Set(['talking']))).toBeNull();
    expect(resolvePose('sleeping', new Set())).toBeNull();
  });

  it('a stand-in that is also missing falls back to neutral', () => {
    // impatient -> skeptical, but skeptical has no art either
    expect(resolvePose('impatient', new Set(['neutral', 'talking']))).toBe('neutral');
    expect(resolvePose('very-impatient', new Set(['neutral']))).toBe('neutral');
    expect(resolvePose('calling', new Set(['neutral']))).toBe('neutral');
  });

  it('accepts a list as well as a set, and does not touch it', () => {
    const list = [...SHEET];
    expect(resolvePose('impatient', list)).toBe('skeptical');
    expect(list).toEqual(SHEET);
  });

  it('every logical pose resolves to something when the whole sheet exists', () => {
    const available = new Set(SHEET);
    for (const pose of POSE_NAMES) expect(resolvePose(pose, available)).not.toBeNull();
  });

  it('sweeping falls back to mirror while it has no art, and uses its own art once the PNG exists', () => {
    expect(resolvePose('sweeping', new Set(SHEET))).toBe('mirror');
    expect(resolvePose('sweeping', new Set([...SHEET, 'sweeping']))).toBe('sweeping');
  });
});
