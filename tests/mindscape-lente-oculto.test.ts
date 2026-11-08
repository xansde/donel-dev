import { describe, expect, it } from 'vitest';
import { guardBoardAction, lensLocksBoard, shortcutInLens } from '../src/shared/mindscape/chairs';
import { removeItems } from '../src/shared/mindscape/drawings';
import type { MindscapeDoc } from '../src/shared/mindscape/model';
import { mindscapeShortcut } from '../src/shared/mindscape/shortcuts';

// Cadeiras, fatia 1 (Revisor, #278): with "Seu desenho: Oculto" in the chairs lens, Ctrl+A + Delete erased every
// drawing of the owner without him seeing it (4 → 0, written to mindscape.json). The hidden board only moves.

const path = 'C:/projetos/atlas';
const doc: MindscapeDoc = {
  schemaVersion: 6,
  boards: {
    [path]: {
      projectPath: path,
      pan: { x: 0, y: 0 },
      zoom: 1,
      cards: {},
      links: [],
      drawings: [
        { kind: 'rect', id: 'r1', color: 'none', stroke: 'medium', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'ellipse', id: 'e1', color: 'accent', stroke: 'thin', x: 20, y: 0, w: 10, h: 10 },
      ],
    },
  },
};
const key = (key: string, ctrl = false, shift = false) => mindscapeShortcut({ key, ctrl, shift, alt: false, meta: false, editable: false });

/** What the screen does with a key and then with the reducer it would apply. */
function press(locked: boolean, current: MindscapeDoc, shortcutKey: ReturnType<typeof key>): MindscapeDoc {
  const shortcut = shortcutInLens(shortcutKey, locked);
  if (shortcut?.type !== 'delete') return current;
  const ids = { cards: [], drawings: current.boards[path]!.drawings.map((drawing) => drawing.id) };
  const reducer = guardBoardAction<MindscapeDoc>(locked, (state) => removeItems(state, path, ids));
  return reducer ? reducer(current) : current;
}

describe('the chairs lens with the owner layer hidden', () => {
  it('Ctrl+A then Delete leaves every drawing of the owner in the document', () => {
    const locked = lensLocksBoard(true, 'hidden');
    expect(shortcutInLens(key('a', true), locked)).toBeNull();
    const after = press(locked, doc, key('Delete'));
    expect(after).toBe(doc);
    expect(after.boards[path]!.drawings).toHaveLength(2);
  });

  it('drops undo, redo and the layer keys, and lets Esc through', () => {
    const locked = lensLocksBoard(true, 'hidden');
    for (const shortcut of [key('z', true), key('z', true, true), key(']', true, true), key('[', true, true)]) {
      expect(shortcutInLens(shortcut, locked)).toBeNull();
    }
    expect(shortcutInLens(key('Escape'), locked)).toEqual({ type: 'escape' });
  });

  it('with the drawing on top (or dimmed) the owner still edits as before', () => {
    for (const mode of ['over', 'dim'] as const) {
      const locked = lensLocksBoard(true, mode);
      expect(press(locked, doc, key('Delete')).boards[path]!.drawings).toHaveLength(0);
    }
    expect(lensLocksBoard(false, 'hidden')).toBe(false);
  });
});
