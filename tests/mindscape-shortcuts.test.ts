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

  // Fatia 04 — P (lápis) and E (borracha).
  it('maps P to the pencil and E to the eraser, without telling the case', () => {
    expect(mindscapeShortcut(key('p'))).toEqual({ type: 'tool', tool: 'pencil' });
    expect(mindscapeShortcut(key('P', { shift: true }))).toEqual({ type: 'tool', tool: 'pencil' });
    expect(mindscapeShortcut(key('e'))).toEqual({ type: 'tool', tool: 'eraser' });
    expect(mindscapeShortcut(key('E'))).toEqual({ type: 'tool', tool: 'eraser' });
    expect(mindscapeShortcut(key('p', { ctrl: true }))).toBeNull();
    expect(mindscapeShortcut(key('e', { alt: true }))).toBeNull();
    expect(mindscapeShortcut(key('e', { editable: true }))).toBeNull();
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

  // Fatia 03 — Delete, Ctrl+A and the layer keys (by `key`, not `code`: ABNT2 puts the brackets elsewhere).
  it('maps Delete, with or without the selection keys around it', () => {
    expect(mindscapeShortcut(key('Delete'))).toEqual({ type: 'delete' });
    expect(mindscapeShortcut(key('Delete', { editable: true }))).toBeNull();
  });

  it('maps Ctrl+A to select all (not Ctrl+Shift+A, not with the focus in a field)', () => {
    expect(mindscapeShortcut(key('a', { ctrl: true }))).toEqual({ type: 'select-all' });
    expect(mindscapeShortcut(key('A', { ctrl: true }))).toEqual({ type: 'select-all' });
    expect(mindscapeShortcut(key('A', { ctrl: true, shift: true }))).toBeNull();
    expect(mindscapeShortcut(key('a', { ctrl: true, alt: true }))).toBeNull();
    expect(mindscapeShortcut(key('a', { ctrl: true, editable: true }))).toBeNull();
  });

  it('maps Ctrl+Shift+] / } to bring to front and Ctrl+Shift+[ / { to send to back, by key', () => {
    expect(mindscapeShortcut(key(']', { ctrl: true, shift: true }))).toEqual({ type: 'bring-to-front' });
    expect(mindscapeShortcut(key('}', { ctrl: true, shift: true }))).toEqual({ type: 'bring-to-front' });
    expect(mindscapeShortcut(key('[', { ctrl: true, shift: true }))).toEqual({ type: 'send-to-back' });
    expect(mindscapeShortcut(key('{', { ctrl: true, shift: true }))).toEqual({ type: 'send-to-back' });
    expect(mindscapeShortcut(key(']', { ctrl: true }))).toBeNull();
    expect(mindscapeShortcut(key('}', { shift: true }))).toBeNull();
    expect(mindscapeShortcut(key('{', { ctrl: true, shift: true, editable: true }))).toBeNull();
  });

  it('returns null for keys that are not shortcuts (yet)', () => {
    for (const k of ['x', 'q', 'Enter', ' ', '1']) expect(mindscapeShortcut(key(k))).toBeNull();
  });
});
