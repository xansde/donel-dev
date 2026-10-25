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

  // Fatia 02 — Ctrl+Z undoes, Ctrl+Shift+Z redoes (the key comes as "Z" with Shift).
  it('maps Ctrl+Z to undo and Ctrl+Shift+Z to redo', () => {
    expect(mindscapeShortcut(key('z', { ctrl: true }))).toEqual({ type: 'undo' });
    expect(mindscapeShortcut(key('Z', { ctrl: true }))).toEqual({ type: 'undo' });
    expect(mindscapeShortcut(key('Z', { ctrl: true, shift: true }))).toEqual({ type: 'redo' });
    expect(mindscapeShortcut(key('z', { ctrl: true, shift: true }))).toEqual({ type: 'redo' });
  });

  it('leaves Ctrl+Z to the text field (editable → null)', () => {
    expect(mindscapeShortcut(key('z', { ctrl: true, editable: true }))).toBeNull();
    expect(mindscapeShortcut(key('Z', { ctrl: true, shift: true, editable: true }))).toBeNull();
  });

  it('Z without Ctrl, or with Alt or Meta, is not undo', () => {
    expect(mindscapeShortcut(key('z'))).toBeNull();
    expect(mindscapeShortcut(key('z', { ctrl: true, alt: true }))).toBeNull();
    expect(mindscapeShortcut(key('z', { meta: true }))).toBeNull();
  });

  it('returns null for keys that are not shortcuts (yet)', () => {
    for (const k of ['x', 'p', 'e', 'Enter', ' ', '1']) expect(mindscapeShortcut(key(k))).toBeNull();
  });
});
