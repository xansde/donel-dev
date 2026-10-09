import { describe, expect, it } from 'vitest';
import { CLI_SHORTCUTS, shortcutFor } from '../src/renderer/src/chat/cliShortcuts';
import { forwardShortcut } from '../src/renderer/src/chat/cycleMode';
import { isBareModelCommand, MODEL_CHOICES, modelCommandText, modelMenuKeyAction } from '../src/renderer/src/chat/composer/composerMenu';
import { toggleAllFolds } from '../src/renderer/src/chat/timelineModel';

// 014-chat - the CLI shortcuts the box takes over (table from the `claude` 2.1.295 binary) and the model picker
// that Alt+P / a bare `/model` open inside the chat.

const key = (k: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});
const ctrl = (k: string) => key(k, { ctrlKey: true });
const alt = (k: string) => key(k, { altKey: true });

describe('shortcutFor: forwarded to the CLI', () => {
  const cases: Array<[string, ReturnType<typeof key>, string]> = [
    ['shift+tab', key('Tab', { shiftKey: true }), '\x1b[Z'],
    ['alt+o', alt('o'), '\x1bo'],
    ['alt+t', alt('t'), '\x1bt'],
    ['alt+w', alt('w'), '\x1bw'],
    ['ctrl+y', ctrl('y'), '\x19'],
    ['ctrl+t', ctrl('t'), '\x14'],
    ['ctrl+b', ctrl('b'), '\x02'],
    ['ctrl+]', ctrl(']'), '\x1d'],
  ];
  it.each(cases)('%s writes the bytes xterm would send', (_name, event, bytes) => {
    const hit = shortcutFor(event);
    expect(hit?.kind).toBe('forward');
    expect(hit?.kind === 'forward' ? hit.bytes : null).toBe(bytes);
    expect(hit?.label).toBeTruthy();
  });

  it('is case-insensitive on the letter (Caps Lock) but not when Shift joins in', () => {
    expect(shortcutFor(alt('O'))?.kind).toBe('forward');
    expect(shortcutFor(key('o', { altKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('t', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('shortcutFor: native in the chat', () => {
  it('alt+p opens the model picker, ctrl+o toggles the folds, ctrl+enter sends now', () => {
    expect(shortcutFor(alt('p'))).toMatchObject({ kind: 'native', action: 'modelPicker' });
    expect(shortcutFor(ctrl('o'))).toMatchObject({ kind: 'native', action: 'toggleFolds' });
    expect(shortcutFor(ctrl('Enter'))).toMatchObject({ kind: 'native', action: 'sendNow' });
  });
});

describe('shortcutFor: left to the box or never forwarded', () => {
  it.each([
    ['ctrl+d', ctrl('d')],
    ['ctrl+c', ctrl('c')],
    ['ctrl+x', ctrl('x')],
    ['ctrl+r', ctrl('r')],
    ['ctrl+l', ctrl('l')],
    ['ctrl+g', ctrl('g')],
    ['ctrl+s', ctrl('s')],
    ['ctrl+j', ctrl('j')],
    ['ctrl+_', ctrl('_')],
    ['ctrl+shift+b', key('B', { ctrlKey: true, shiftKey: true })],
    ['alt+v', alt('v')],
    ['alt+up', alt('ArrowUp')],
    ['ctrl+down', ctrl('ArrowDown')],
    ['enter', key('Enter')],
    ['shift+enter', key('Enter', { shiftKey: true })],
    ['tab', key('Tab')],
    ['escape', key('Escape')],
    ['space', key(' ')],
    ['a letter', key('a')],
    ['meta+t', key('t', { metaKey: true })],
  ])('%s -> null', (_name, event) => {
    expect(shortcutFor(event)).toBeNull();
  });

  it('every table entry is reachable and nothing in it is on the exclusion list', () => {
    expect(Object.keys(CLI_SHORTCUTS).sort()).toEqual(
      ['alt+o', 'alt+p', 'alt+t', 'alt+w', 'ctrl+]', 'ctrl+b', 'ctrl+enter', 'ctrl+o', 'ctrl+t', 'ctrl+y', 'shift+tab'].sort(),
    );
  });
});

describe('forwardShortcut', () => {
  const bar = '─'.repeat(40);
  const idle = ['Claude Code', '', bar, '❯ ', bar, '  ? for shortcuts'];
  const terminal = (lines: string[]) => {
    const written: string[] = [];
    return { written, readScreen: () => ({ lines }), write: (d: string) => (written.push(d), true) };
  };
  it('writes any bytes while the box is free', () => {
    const t = terminal(idle);
    expect(forwardShortcut(t, '\x14')).toBe(true);
    expect(t.written).toEqual(['\x14']);
  });
  it('writes nothing while a dialog holds the screen', () => {
    const t = terminal(['Do you want to proceed?', '❯ 1. Yes', '  2. No']);
    expect(forwardShortcut(t, '\x14')).toBe(false);
    expect(t.written).toEqual([]);
  });
});

describe('model picker', () => {
  it('lists the four aliases', () => {
    expect(MODEL_CHOICES).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
  });
  it('a pick becomes `/model <alias>`', () => {
    expect(modelCommandText('opus')).toBe('/model opus');
  });
  it('only a bare `/model` opens the picker; with an argument it goes to the CLI', () => {
    expect(isBareModelCommand('/model')).toBe(true);
    expect(isBareModelCommand('  /model \n')).toBe(true);
    expect(isBareModelCommand('/model opus')).toBe(false);
    expect(isBareModelCommand('/models')).toBe(false);
    expect(isBareModelCommand('oi /model')).toBe(false);
  });
  it('arrows move, Enter and Tab choose, Esc closes', () => {
    expect(modelMenuKeyAction(key('ArrowDown'), 4)).toBe('next');
    expect(modelMenuKeyAction(key('ArrowUp'), 4)).toBe('prev');
    expect(modelMenuKeyAction(key('Enter'), 4)).toBe('choose');
    expect(modelMenuKeyAction(key('Tab'), 4)).toBe('choose');
    expect(modelMenuKeyAction(key('Escape'), 4)).toBe('close');
    expect(modelMenuKeyAction(key('Enter', { shiftKey: true }), 4)).toBeNull();
    expect(modelMenuKeyAction(key('a'), 4)).toBeNull();
  });
});

describe('toggleAllFolds (Ctrl+O)', () => {
  const fold = (k: string) => ({ kind: 'fold' as const, key: k });
  const rounds = [{ items: [{ kind: 'row' as const, key: 'r' }, fold('a')] }, { items: [fold('b')] }];
  it('opens every fold when some are closed', () => {
    expect([...toggleAllFolds(rounds, new Set(['a']))].sort()).toEqual(['a', 'b']);
    expect([...toggleAllFolds(rounds, new Set())].sort()).toEqual(['a', 'b']);
  });
  it('closes them all when every fold is open', () => {
    expect(toggleAllFolds(rounds, new Set(['a', 'b'])).size).toBe(0);
  });
  it('does nothing without folds', () => {
    const prev = new Set<string>();
    expect(toggleAllFolds([{ items: [{ kind: 'row', key: 'r' }] }], prev)).toBe(prev);
  });
});
