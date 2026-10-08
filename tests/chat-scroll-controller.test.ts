import { describe, expect, it } from 'vitest';
import {
  FOLLOW_THRESHOLD_PX,
  INITIAL_SCROLL_STATE,
  classifyRowsChange,
  isFollowing,
  onRowsChange,
  onUserScroll,
  preservedScrollTop,
  restoreScrollTop,
  shouldLoadOlder,
  snapshotView,
} from '../src/renderer/src/chat/scrollController';

const m = (scrollTop: number, clientHeight = 500, scrollHeight = 2000) => ({ scrollTop, clientHeight, scrollHeight });
const AT_END = m(1500);

describe('isFollowing (R19: within 40 px of the end)', () => {
  it('follows at the very end and up to the threshold', () => {
    expect(FOLLOW_THRESHOLD_PX).toBe(40);
    expect(isFollowing(AT_END)).toBe(true);
    expect(isFollowing(m(1500 - 40))).toBe(true);
  });
  it('stops following past the threshold', () => {
    expect(isFollowing(m(1500 - 41))).toBe(false);
    expect(isFollowing(m(0))).toBe(false);
  });
  it('follows a content shorter than the viewport', () => {
    expect(isFollowing({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true);
  });
});

describe('classifyRowsChange', () => {
  it('first rows of an empty timeline are "initial"', () => {
    expect(classifyRowsChange([], ['a', 'b'])).toEqual({ kind: 'initial', added: 2 });
  });
  it('identical ids are "none"; same ids with updated content are the caller\'s "update"', () => {
    expect(classifyRowsChange(['a', 'b'], ['a', 'b'])).toEqual({ kind: 'none', added: 0 });
  });
  it('rows after the last known one are "append"', () => {
    expect(classifyRowsChange(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual({ kind: 'append', added: 2 });
  });
  it('rows before the first known one are "prepend"', () => {
    expect(classifyRowsChange(['c', 'd'], ['a', 'b', 'c', 'd'])).toEqual({ kind: 'prepend', added: 2 });
  });
  it('older rows inserted under a top notice are still a "prepend"', () => {
    const prev = ['app:conversation-switch:1', 'c', 'd'];
    const next = ['app:conversation-switch:1', 'a', 'b', 'c', 'd'];
    expect(classifyRowsChange(prev, next)).toEqual({ kind: 'prepend', added: 2 });
  });
  it('a completely different list is a "reset"', () => {
    expect(classifyRowsChange(['a', 'b'], ['x', 'y'])).toEqual({ kind: 'reset', added: 2 });
  });
  it('an emptied list is a "reset"', () => {
    expect(classifyRowsChange(['a'], [])).toEqual({ kind: 'reset', added: 0 });
  });
  it('growth at both ends counts as "append" (the pill must not be missed)', () => {
    expect(classifyRowsChange(['b', 'c'], ['a', 'b', 'c', 'd']).kind).toBe('append');
  });
  it('a row replaced by a merged group keeps the rest an "append"', () => {
    expect(classifyRowsChange(['a', 'g1'], ['a', 'g2', 'z']).kind).toBe('append');
  });
});

describe('onRowsChange', () => {
  const following = { following: true, pill: false };
  const reading = { following: false, pill: false };

  it('initial and reset jump to the end and drop the pill', () => {
    expect(onRowsChange({ following: false, pill: true }, { kind: 'initial', added: 3 })).toEqual({
      state: { following: true, pill: false },
      action: { kind: 'scroll-to-end' },
    });
    expect(onRowsChange(reading, { kind: 'reset', added: 3 }).action).toEqual({ kind: 'scroll-to-end' });
  });

  it('append while following keeps following the end, no pill', () => {
    expect(onRowsChange(following, { kind: 'append', added: 1 })).toEqual({ state: following, action: { kind: 'scroll-to-end' } });
  });

  it('append while reading shows the pill and does not move', () => {
    expect(onRowsChange(reading, { kind: 'append', added: 1 })).toEqual({
      state: { following: false, pill: true },
      action: { kind: 'none' },
    });
  });

  it('D-C9: an in-place update while reading NEVER shows the pill', () => {
    expect(onRowsChange(reading, { kind: 'update', added: 0 })).toEqual({ state: reading, action: { kind: 'none' } });
  });

  it('an in-place update while following keeps following (streaming text growth)', () => {
    expect(onRowsChange(following, { kind: 'update', added: 0 }).action).toEqual({ kind: 'scroll-to-end' });
  });

  it('D-C9: a prepend never shows the pill and asks to preserve the position', () => {
    const out = onRowsChange(reading, { kind: 'prepend', added: 5 });
    expect(out.state.pill).toBe(false);
    expect(out.action).toEqual({ kind: 'preserve' });
  });

  it('a prepend while at the end still preserves (the viewport must not jump to the end)', () => {
    expect(onRowsChange(following, { kind: 'prepend', added: 5 }).action).toEqual({ kind: 'preserve' });
  });

  it('"none" changes nothing', () => {
    expect(onRowsChange({ following: false, pill: true }, { kind: 'none', added: 0 })).toEqual({
      state: { following: false, pill: true },
      action: { kind: 'none' },
    });
  });
});

describe('onUserScroll', () => {
  it('leaving the end switches to free mode', () => {
    expect(onUserScroll(INITIAL_SCROLL_STATE, m(100))).toEqual({ following: false, pill: false });
  });
  it('returning to the end resumes following and clears the pill', () => {
    expect(onUserScroll({ following: false, pill: true }, AT_END)).toEqual({ following: true, pill: false });
  });
  it('scrolling in free mode keeps a pending pill', () => {
    expect(onUserScroll({ following: false, pill: true }, m(300))).toEqual({ following: false, pill: true });
  });
});

describe('preservedScrollTop (prepend keeps the position by the scrollHeight difference)', () => {
  it('adds the height gained above', () => {
    expect(preservedScrollTop(120, 2000, 2600)).toBe(720);
  });
  it('never goes negative', () => {
    expect(preservedScrollTop(0, 2000, 1500)).toBe(0);
  });
});

describe('shouldLoadOlder', () => {
  const ready = { status: 'ready' as const, cursor: 'c1', loadingOlder: false };
  it('loads near the top when there is more history', () => {
    expect(shouldLoadOlder(m(10), ready)).toBe(true);
  });
  it('does not load when away from the top', () => {
    expect(shouldLoadOlder(m(900), ready)).toBe(false);
  });
  it('does not load at the start of the conversation (no cursor)', () => {
    expect(shouldLoadOlder(m(0), { ...ready, cursor: null })).toBe(false);
  });
  it('does not load twice at once or before the first page', () => {
    expect(shouldLoadOlder(m(0), { ...ready, loadingOlder: true })).toBe(false);
    expect(shouldLoadOlder(m(0), { ...ready, status: 'loading' })).toBe(false);
  });
  it('loads when the content does not fill the viewport', () => {
    expect(shouldLoadOlder({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 }, ready)).toBe(true);
  });
});

describe('per-tab view state (survives the Chat | Terminal toggle)', () => {
  it('restores the end when it was following, even if the content grew while hidden', () => {
    const snap = snapshotView({ following: true, pill: false }, AT_END);
    expect(restoreScrollTop(snap, m(0, 500, 3000))).toBe(2500);
  });
  it('restores the exact position when it was reading', () => {
    const snap = snapshotView({ following: false, pill: true }, m(640));
    expect(restoreScrollTop(snap, m(0, 500, 2000))).toBe(640);
  });
  it('clamps to the available range', () => {
    const snap = snapshotView({ following: false, pill: false }, m(1400));
    expect(restoreScrollTop(snap, m(0, 500, 1000))).toBe(500);
  });
});
