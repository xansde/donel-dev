// T085 (014-chat) - `/` and `@` triggers, ranking and highlight adapted from the T3 Code.
import { describe, expect, it } from 'vitest';
import { detectComposerTrigger, formatFileMention, replaceTextRange } from '../src/shared/chat/t3/composerTrigger';
import { resolveComposerMenuActiveItemId } from '../src/shared/chat/t3/composerMenuHighlight';
import { insertRankedSearchResult, normalizeSearchQuery, scoreQueryMatch, scoreSubsequenceMatch, type RankedSearchResult } from '../src/shared/chat/t3/searchRanking';
import { dismissTrigger, initialTriggerState, resetTrigger, resolveTrigger, setTrigger } from '../src/shared/chat/t3/composerTriggerState';

describe('detectComposerTrigger', () => {
  it('opens the slash menu only at the very start of the message', () => {
    expect(detectComposerTrigger('/mo', 3)).toEqual({ kind: 'slash-command', query: 'mo', rangeStart: 0, rangeEnd: 3 });
    expect(detectComposerTrigger('/', 1)).toMatchObject({ kind: 'slash-command', query: '' });
    expect(detectComposerTrigger('hi\n/mo', 6)).toBeNull();
    expect(detectComposerTrigger('a /mo', 5)).toBeNull();
  });

  it('closes the slash menu once the command name is followed by a space', () => {
    expect(detectComposerTrigger('/model opus', 11)).toBeNull();
    expect(detectComposerTrigger('/model ', 7)).toBeNull();
  });

  it('keeps /model as a plain slash command (no model sub-menu in the chat)', () => {
    expect(detectComposerTrigger('/model', 6)).toMatchObject({ kind: 'slash-command', query: 'model' });
  });

  it('detects @path at the cursor token, in any line', () => {
    expect(detectComposerTrigger('see @src/ap', 11)).toEqual({ kind: 'path', query: 'src/ap', rangeStart: 4, rangeEnd: 11 });
    expect(detectComposerTrigger('x\n@a', 4)).toMatchObject({ kind: 'path', query: 'a', rangeStart: 2 });
    expect(detectComposerTrigger('@', 1)).toMatchObject({ kind: 'path', query: '' });
  });

  it('does not treat # or $ tokens as triggers', () => {
    expect(detectComposerTrigger('#12', 3)).toBeNull();
    expect(detectComposerTrigger('$skill', 6)).toBeNull();
    expect(detectComposerTrigger('plain', 5)).toBeNull();
  });

  it('uses the cursor, not the end of the text, and clamps it', () => {
    expect(detectComposerTrigger('@ab cd', 3)).toMatchObject({ kind: 'path', query: 'ab' });
    expect(detectComposerTrigger('@ab', 99)).toMatchObject({ query: 'ab', rangeEnd: 3 });
    expect(detectComposerTrigger('@ab', Number.NaN)).toMatchObject({ query: 'ab' });
  });
});

describe('replaceTextRange / formatFileMention', () => {
  it('replaces the range and returns the cursor after it', () => {
    expect(replaceTextRange('see @sr here', 4, 7, '@src/a.ts ')).toEqual({ text: 'see @src/a.ts  here', cursor: 14 });
  });
  it('quotes mentions with whitespace, as the CLI expects', () => {
    expect(formatFileMention('src/a.ts')).toBe('@src/a.ts');
    expect(formatFileMention('my docs/a b.md')).toBe('@"my docs/a b.md"');
  });
});

describe('search ranking', () => {
  it('normalizes and scores in tiers (lower is better)', () => {
    expect(normalizeSearchQuery('  FoO ')).toBe('foo');
    const s = (value: string) => scoreQueryMatch({ value, query: 'foo', exactBase: 0, prefixBase: 10, boundaryBase: 20, includesBase: 30, fuzzyBase: 40 });
    expect(s('foo')).toBe(0);
    expect(s('foobar')!).toBeLessThan(s('a-foo')!);
    expect(s('a-foo')!).toBeLessThan(s('afoo')!);
    expect(s('afoo')!).toBeLessThan(s('f-o-o')!);
    expect(s('xyz')).toBeNull();
    expect(scoreSubsequenceMatch('abc', 'ac')).not.toBeNull();
  });

  it('keeps a bounded, ordered result list', () => {
    const out: RankedSearchResult<string>[] = [];
    for (const [item, score] of [['c', 3], ['a', 1], ['b', 2], ['d', 4]] as const) insertRankedSearchResult(out, { item, score, tieBreaker: item }, 3);
    expect(out.map((r) => r.item)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveComposerMenuActiveItemId', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  it('keeps the highlight while the search is the same and the item still exists', () => {
    expect(resolveComposerMenuActiveItemId({ items, highlightedItemId: 'b', currentSearchKey: 'k', highlightedSearchKey: 'k' })).toBe('b');
  });
  it('falls back to the first item when the search changed or the item vanished', () => {
    expect(resolveComposerMenuActiveItemId({ items, highlightedItemId: 'b', currentSearchKey: 'k2', highlightedSearchKey: 'k' })).toBe('a');
    expect(resolveComposerMenuActiveItemId({ items, highlightedItemId: 'z', currentSearchKey: 'k', highlightedSearchKey: 'k' })).toBe('a');
    expect(resolveComposerMenuActiveItemId({ items: [], highlightedItemId: null, currentSearchKey: null, highlightedSearchKey: null })).toBeNull();
  });
});

describe('trigger state (dismiss until the caret leaves the token)', () => {
  const slash = { kind: 'slash-command', query: 'mo', rangeStart: 0, rangeEnd: 3 } as const;
  const path = { kind: 'path', query: 'a', rangeStart: 4, rangeEnd: 6 } as const;

  it('keeps a dismissed trigger closed while the same token is still under the caret', () => {
    let state = setTrigger(initialTriggerState(), slash);
    expect(state.trigger).toEqual(slash);
    state = dismissTrigger(state, slash);
    expect(state.trigger).toBeNull();
    state = setTrigger(state, { ...slash, query: 'mod', rangeEnd: 4 });
    expect(state.trigger).toBeNull();
    expect(resolveTrigger(state, slash)).toBeNull();
  });

  it('reopens once the caret leaves the token, or on another kind/start', () => {
    let state = dismissTrigger(initialTriggerState(), slash);
    state = setTrigger(state, null);
    expect(state.dismissed).toBeNull();
    expect(setTrigger(state, slash).trigger).toEqual(slash);
    expect(setTrigger(dismissTrigger(initialTriggerState(), slash), path).trigger).toEqual(path);
  });

  it('reset reopens unconditionally', () => {
    const state = resetTrigger(dismissTrigger(initialTriggerState(), slash), slash);
    expect(state.trigger).toEqual(slash);
    expect(state.dismissed).toBeNull();
  });
});
