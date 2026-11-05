import { describe, expect, it } from 'vitest';
import { emptySourceFilterState, filterRound, type SourceFilterState } from '../src/shared/rotinas/filter';

// Item 20 — the filter without an LLM between a routine and the wake. Wrong here, the owner would not see it: the
// Líder woken every 5 minutes by the same stalled session (dedup), by a session that only blinked (hysteresis), or
// by twenty at once (cap). In shadow it only fills a log, which is exactly why nobody would notice.

const MIN = 60_000;

function rounds(keysPerRound: readonly (readonly string[])[], start = 0, every = 5 * MIN): { state: SourceFilterState; woke: string[][] } {
  let state = emptySourceFilterState();
  const woke: string[][] = [];
  keysPerRound.forEach((keys, index) => {
    const result = filterRound(state, keys, start + index * every);
    state = result.state;
    woke.push(result.decisions.flatMap((item) => (item.decision === 'acordaria' ? [item.key] : [])));
  });
  return { state, woke };
}

describe('filterRound', () => {
  it('hysteresis: a key wakes only on its 2nd round in a row; one that blinks never wakes', () => {
    const { woke } = rounds([['a', 'blink'], ['a'], ['a'], ['blink'], []]);
    expect(woke).toEqual([[], ['a'], [], [], []]);
  });

  it('dedup: a key that woke stays quiet while present, and wakes again only after going away', () => {
    const { woke } = rounds([['a'], ['a'], ['a'], ['a'], [], ['a'], ['a']]);
    expect(woke).toEqual([[], ['a'], [], [], [], [], ['a']]);
  });

  it('cap: at most 5 per hour; the rest is deferred (logged once) and wakes when the window frees', () => {
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
    let state = emptySourceFilterState();
    state = filterRound(state, keys, 0).state;
    const second = filterRound(state, keys, 5 * MIN);
    expect(second.decisions.filter((item) => item.decision === 'acordaria')).toHaveLength(5);
    expect(second.decisions.filter((item) => item.decision === 'adiada').map((item) => ('key' in item ? item.key : ''))).toEqual(['k6', 'k7']);
    const third = filterRound(second.state, keys, 10 * MIN);
    expect(third.decisions).toEqual([]);
    const afterHour = filterRound(third.state, keys, 5 * MIN + 60 * MIN);
    expect(afterHour.decisions.map((item) => ('key' in item ? item.key : ''))).toEqual(['k6', 'k7']);
  });

  it('noise: more than half of the wakes gone by the next round turns the source off for 7 days', () => {
    // four keys wake and vanish at once, one after the other
    const pattern = ['a', 'b', 'c', 'd'].flatMap((key) => [[key], [key], []]);
    let state = emptySourceFilterState();
    let off = false;
    pattern.forEach((keys, index) => {
      const result = filterRound(state, keys, index * 5 * MIN);
      state = result.state;
      off = result.off;
    });
    expect(off).toBe(true);
    expect(filterRound(state, ['z'], 2 * 24 * 60 * MIN).off).toBe(true);
    expect(filterRound(state, ['z'], 8 * 24 * 60 * MIN).off).toBe(false);
  });
});
