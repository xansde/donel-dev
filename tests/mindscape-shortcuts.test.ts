import { describe, expect, it } from 'vitest';
import { mindscapeShortcut, type ShortcutInput } from '../src/shared/mindscape/shortcuts';

// Mindscape desenho, fatia 01 — one-key tools (V H A L R O) and Esc, only with
// the Mindscape focused and never with the focus in a text field.

function key(k: string, extra: Partial<ShortcutInput> = {}): ShortcutInput {
  return { key: k, ctrl: false, shift: false, alt: false, meta: false, editable: false, ...extra };
}

describe('mindscapeShortcut', () => {
  it('maps the tool letters', () => {
    expect(mindscapeShortcut(key('v'))).toEqual({ type: 'tool', tool: 'select' });
    expect(mindscapeShortcut(key('h'))).toEqual({ type: 'tool', tool: 'hand' });
    expect(mindscapeShortcut(key('a'))).toEqual({ type: 'tool', tool: 'arrow' });
    expect(mindscapeShortcut(key('l'))).toEqual({ type: 'tool', tool: 'line' });
    expect(mindscapeShortcut(key('r'))).toEqual({ type: 'tool', tool: 'rect' });
    expect(mindscapeShortcut(key('o'))).toEqual({ type: 'tool', tool: 'ellipse' });
  });

  it('does not tell upper from lower case', () => {
    expect(mindscapeShortcut(key('R'))).toEqual({ type: 'tool', tool: 'rect' });
    expect(mindscapeShortcut(key('A', { shift: true }))).toEqual({ type: 'tool', tool: 'arrow' });
  });

  it('maps Escape', () => {
    expect(mindscapeShortcut(key('Escape'))).toEqual({ type: 'escape' });
  });

  it('ignores the letters with Ctrl, Alt or Meta', () => {
    expect(mindscapeShortcut(key('r', { ctrl: true }))).toBeNull();
    expect(mindscapeShortcut(key('r', { alt: true }))).toBeNull();
    expect(mindscapeShortcut(key('r', { meta: true }))).toBeNull();
  });

  it('returns null with the focus in a text field', () => {
    expect(mindscapeShortcut(key('r', { editable: true }))).toBeNull();
    expect(mindscapeShortcut(key('Escape', { editable: true }))).toBeNull();
  });

  it('returns null for keys that are not shortcuts (yet)', () => {
    for (const k of ['x', 'p', 'e', 'Enter', ' ', '1']) expect(mindscapeShortcut(key(k))).toBeNull();
  });
});
