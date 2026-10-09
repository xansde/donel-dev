// T087/T089 (014-chat) - renderer-side decisions of the composer: which key does what with a menu open, what a pick
// inserts, the large-paste chip and the request that leaves the box. Pure functions; no DOM.
import { describe, expect, it } from 'vitest';
import { canSend, sendRequestOf } from '../src/renderer/src/chat/composer/attachmentsModel';
import { SCOPE_BADGE, insertionFor, matchRange, menuKeyAction, stepHighlight } from '../src/renderer/src/chat/composer/composerMenu';
import { PASTE_MAX_CHARS, PASTE_MAX_LINES, countLines, expandPastes, isLargePaste, makePaste, pasteLabel } from '../src/renderer/src/chat/composer/pastedText';
import type { CommandEntry } from '../src/shared/chat/ipc';
import { detectComposerTrigger } from '../src/shared/chat/t3/composerTrigger';

const key = (k: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

const entry = (name: string, scope: CommandEntry['scope'] = 'user'): CommandEntry => ({
  name,
  aliases: [],
  description: '',
  source: scope === 'builtin' ? 'builtin' : 'skill',
  scope,
  opensScreen: false,
});

describe('menuKeyAction', () => {
  it('Tab picks, arrows move, Esc closes', () => {
    expect(menuKeyAction(key('Tab'), 3)).toBe('choose');
    expect(menuKeyAction(key('ArrowUp'), 3)).toBe('prev');
    expect(menuKeyAction(key('ArrowDown'), 3)).toBe('next');
    expect(menuKeyAction(key('Escape'), 3)).toBe('close');
  });

  it('Enter is never the menu\'s: it sends what is written (`/mod` is not completed to `/model`)', () => {
    expect(menuKeyAction(key('Enter'), 3)).toBeNull();
    expect(menuKeyAction(key('Enter', { shiftKey: true }), 3)).toBeNull();
  });

  it('Shift+Tab stays the CLI mode switch', () => {
    expect(menuKeyAction(key('Tab', { shiftKey: true }), 3)).toBeNull();
  });

  it('a menu without rows takes no key (history keeps ArrowUp)', () => {
    expect(menuKeyAction(key('ArrowUp'), 0)).toBeNull();
    expect(menuKeyAction(key('Escape'), 0)).toBeNull();
  });

  it('modified keys are left alone', () => {
    expect(menuKeyAction(key('ArrowDown', { ctrlKey: true }), 3)).toBeNull();
  });
});

describe('stepHighlight', () => {
  const ids = ['a', 'b', 'c'];
  it('moves and wraps in both directions', () => {
    expect(stepHighlight(ids, 'a', 'next')).toBe('b');
    expect(stepHighlight(ids, 'c', 'next')).toBe('a');
    expect(stepHighlight(ids, 'a', 'prev')).toBe('c');
  });
  it('starts at the ends when nothing is highlighted', () => {
    expect(stepHighlight(ids, null, 'next')).toBe('a');
    expect(stepHighlight(ids, null, 'prev')).toBe('c');
    expect(stepHighlight([], null, 'next')).toBeNull();
  });
});

describe('insertionFor', () => {
  it('a command replaces what was typed with `/name ` (trailing space, caret after it)', () => {
    const text = '/mo';
    const trigger = detectComposerTrigger(text, 3)!;
    expect(insertionFor(text, trigger, { kind: 'command', entry: entry('model', 'builtin') })).toEqual({ text: '/model ', cursor: 7 });
  });

  it('a file replaces only the token under the caret, keeping the rest of the message', () => {
    const text = 'olha o @par e depois';
    const trigger = detectComposerTrigger(text, 11)!;
    expect(trigger.kind).toBe('path');
    expect(insertionFor(text, trigger, { kind: 'file', path: 'src/parcelas.ts' })).toEqual({ text: 'olha o @src/parcelas.ts e depois', cursor: 24 });
  });

  it('a path with spaces is quoted', () => {
    const text = '@me';
    const trigger = detectComposerTrigger(text, 3)!;
    expect(insertionFor(text, trigger, { kind: 'file', path: 'docs/meu arquivo.md' }).text).toBe('@"docs/meu arquivo.md" ');
  });
});

describe('menu labels', () => {
  it('the origin chips follow the design plus "plugin"', () => {
    expect(SCOPE_BADGE).toEqual({ builtin: 'CLI', user: 'global', project: 'projeto', plugin: 'plugin' });
  });
  it('matchRange finds the first occurrence, case-insensitively', () => {
    expect(matchRange('code-review', 'co')).toEqual([0, 2]);
    expect(matchRange('src/Parcelas.ts', 'parc')).toEqual([4, 8]);
    expect(matchRange('abc', 'x')).toBeNull();
    expect(matchRange('abc', '')).toBeNull();
  });
});

describe('large paste', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `linha ${i + 1}`).join('\n');

  it('counts lines ignoring a trailing break', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('')).toBe(0);
    expect(countLines('a\r\nb')).toBe(2);
  });

  it('is large only ABOVE 20 lines or 2.000 characters', () => {
    expect(isLargePaste(lines(PASTE_MAX_LINES))).toBe(false);
    expect(isLargePaste(lines(PASTE_MAX_LINES + 1))).toBe(true);
    expect(isLargePaste('x'.repeat(PASTE_MAX_CHARS))).toBe(false);
    expect(isLargePaste('x'.repeat(PASTE_MAX_CHARS + 1))).toBe(true);
  });

  it('labels the chip with the number of lines', () => {
    expect(pasteLabel(makePaste('p', lines(500)))).toBe('texto colado — 500 linhas');
    expect(pasteLabel(makePaste('p', 'x'.repeat(3000)))).toBe('texto colado — 1 linha');
  });

  it('the pasted text goes back in full after what was typed', () => {
    const paste = makePaste('p', `${lines(30)}\n`);
    expect(expandPastes('O que acha?', [paste])).toBe(`O que acha?\n\n${lines(30)}`);
    expect(expandPastes('', [paste])).toBe(lines(30));
    expect(expandPastes('oi', [])).toBe('oi');
  });

  it('a leading `/skill` stays first, so the message is still classified as a command', () => {
    expect(expandPastes('/revisar', [makePaste('p', lines(30))]).startsWith('/revisar\n\n')).toBe(true);
  });

  it('a chip alone is enough to send', () => {
    expect(canSend('', [], [])).toBe(false);
    expect(canSend('', [], [makePaste('p', lines(30))])).toBe(true);
  });
});

describe('sendRequestOf (T087/T089)', () => {
  it('a bare screen command carries opensScreen; the same command with an argument does not', () => {
    expect(sendRequestOf('/config', [], 'normal').opensScreen).toBe(true);
    expect(sendRequestOf('/model opus', [], 'normal').opensScreen).toBeUndefined();
    expect(sendRequestOf('oi', [], 'normal').opensScreen).toBeUndefined();
  });

  it('a skill of the same name shadows the native command (no opensScreen) and travels as customCommands', () => {
    const custom = new Set(['config']);
    const request = sendRequestOf('/config', [], 'normal', { customCommands: custom });
    expect(request.opensScreen).toBeUndefined();
    expect(request.customCommands).toBe(custom);
  });

  it('pastes are expanded into the text', () => {
    const request = sendRequestOf('veja', [], 'normal', { pastes: [makePaste('p', 'a\nb')] });
    expect(request.text).toBe('veja\n\na\nb');
  });
});
