// T060 (015-jobu-pet, US5, FR-034/FR-035) - when the Jobu may show up in a screenshot or a screen share. The rule is
// pure and clocked by the test: the protection is on by default, "Liberar print por 1 minuto" turns it off for
// 60 s and the end of the minute brings it back with no event (the service only has to ask again on its tick),
// "Bloquear print agora" brings it back at once, and the test override (`DONEL_PET_CAPTURABLE=1`) keeps it off
// for good.
import { describe, expect, it } from 'vitest';
import { PET_CAPTURE_RELEASE_MS, blockCapture, captureAllowed, captureReleased, createCaptureState, releaseCapture } from '../src/shared/pet/capture';

const SEC = 1000;
const NOW = 5_000_000;

describe('the protection is on by default (FR-034)', () => {
  it('a new state is protected: the capture does not see the Jobu', () => {
    const state = createCaptureState();
    expect(captureAllowed(state, NOW)).toBe(false);
    expect(captureReleased(state, NOW)).toBe(false);
  });

  it('it stays protected whatever the instant: there is no clock to wait on', () => {
    const state = createCaptureState();
    expect(captureAllowed(state, 0)).toBe(false);
    expect(captureAllowed(state, NOW + 10 * 60 * SEC)).toBe(false);
  });
});

describe('"Liberar print por 1 minuto" (FR-035)', () => {
  it('the release lasts 60 s', () => {
    expect(PET_CAPTURE_RELEASE_MS).toBe(60 * SEC);
  });

  it('the capture is allowed from the instant of the click and the protection is back exactly 60 s later', () => {
    const released = releaseCapture(createCaptureState(), NOW);
    expect(captureAllowed(released, NOW)).toBe(true);
    expect(captureAllowed(released, NOW + 30 * SEC)).toBe(true);
    expect(captureAllowed(released, NOW + PET_CAPTURE_RELEASE_MS - 1)).toBe(true);
    expect(captureAllowed(released, NOW + PET_CAPTURE_RELEASE_MS)).toBe(false);
    expect(captureAllowed(released, NOW + PET_CAPTURE_RELEASE_MS + 5 * SEC)).toBe(false);
  });

  it('the menu knows the release is on (it offers "Bloquear print agora") for as long as it lasts, and only then', () => {
    const released = releaseCapture(createCaptureState(), NOW);
    expect(captureReleased(released, NOW)).toBe(true);
    expect(captureReleased(released, NOW + PET_CAPTURE_RELEASE_MS - 1)).toBe(true);
    expect(captureReleased(released, NOW + PET_CAPTURE_RELEASE_MS)).toBe(false);
  });

  it('releasing again while it is on restarts the minute from the new click', () => {
    const first = releaseCapture(createCaptureState(), NOW);
    const second = releaseCapture(first, NOW + 40 * SEC);
    expect(captureAllowed(second, NOW + 90 * SEC)).toBe(true);
    expect(captureAllowed(second, NOW + 40 * SEC + PET_CAPTURE_RELEASE_MS)).toBe(false);
  });
});

describe('"Bloquear print agora"', () => {
  it('brings the protection back at once, in the middle of the minute', () => {
    const released = releaseCapture(createCaptureState(), NOW);
    expect(captureAllowed(released, NOW + 10 * SEC)).toBe(true);
    const blocked = blockCapture(released);
    expect(captureAllowed(blocked, NOW + 10 * SEC)).toBe(false);
    expect(captureReleased(blocked, NOW + 10 * SEC)).toBe(false);
  });

  it('on a state that was never released it changes nothing', () => {
    const state = createCaptureState();
    expect(blockCapture(state)).toEqual(state);
    expect(captureAllowed(blockCapture(state), NOW)).toBe(false);
  });

  it('a new release after a block is a whole new minute', () => {
    const state = releaseCapture(blockCapture(releaseCapture(createCaptureState(), NOW)), NOW + 5 * SEC);
    expect(captureAllowed(state, NOW + 5 * SEC + 59 * SEC)).toBe(true);
    expect(captureAllowed(state, NOW + 5 * SEC + PET_CAPTURE_RELEASE_MS)).toBe(false);
  });
});

describe('the test override (DONEL_PET_CAPTURABLE=1) turns the protection off for good', () => {
  it('the capture is always allowed, at any instant', () => {
    const state = createCaptureState({ alwaysCapturable: true });
    expect(captureAllowed(state, 0)).toBe(true);
    expect(captureAllowed(state, NOW + 24 * 60 * 60 * SEC)).toBe(true);
  });

  it('"Bloquear print agora" and the end of a release do not bring it back: the override is not the owner\'s release', () => {
    const state = createCaptureState({ alwaysCapturable: true });
    expect(captureAllowed(blockCapture(state), NOW)).toBe(true);
    const released = releaseCapture(state, NOW);
    expect(captureAllowed(released, NOW + PET_CAPTURE_RELEASE_MS + SEC)).toBe(true);
  });

  it('the menu still tells the truth about the owner\'s own release: the override is not a release', () => {
    const state = createCaptureState({ alwaysCapturable: true });
    expect(captureReleased(state, NOW)).toBe(false);
    expect(captureReleased(releaseCapture(state, NOW), NOW + SEC)).toBe(true);
    expect(captureReleased(releaseCapture(state, NOW), NOW + PET_CAPTURE_RELEASE_MS)).toBe(false);
  });

  it('without the flag, the default is protected: a missing option never means "capturable"', () => {
    expect(captureAllowed(createCaptureState({}), NOW)).toBe(false);
    expect(captureAllowed(createCaptureState({ alwaysCapturable: false }), NOW)).toBe(false);
  });
});

describe('purity', () => {
  it('never mutates the state it receives', () => {
    const state = createCaptureState();
    const snapshot = JSON.stringify(state);
    releaseCapture(state, NOW);
    blockCapture(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('the same inputs always give the same answers', () => {
    const run = (): boolean[] => {
      const released = releaseCapture(createCaptureState(), NOW);
      return [NOW, NOW + 59 * SEC, NOW + 60 * SEC].map((at) => captureAllowed(released, at));
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([true, true, false]);
  });
});
