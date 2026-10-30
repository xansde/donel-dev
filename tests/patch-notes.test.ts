import { describe, expect, it } from 'vitest';
import { PATCH_NOTES, type PatchNoteDay } from '../src/renderer/src/patchnotes/notes';
import { formatNoteDate, latestNoteDate, unseenNotes } from '../src/renderer/src/patchnotes/patchNotesModel';

const day = (date: string): PatchNoteDay => ({ date, items: [{ title: date, text: 'x' }] });
const notes = [day('2026-10-27'), day('2026-10-29'), day('2026-10-28')];

describe('novidades da versão', () => {
  it('primeira vez na máquina: só o dia mais novo', () => {
    expect(unseenNotes(notes, null).map((d) => d.date)).toEqual(['2026-10-29']);
  });

  it('mostra os dias depois do último visto, do mais novo ao mais antigo', () => {
    expect(unseenNotes(notes, '2026-10-27').map((d) => d.date)).toEqual(['2026-10-29', '2026-10-28']);
  });

  it('nada novo: não abre', () => {
    expect(unseenNotes(notes, '2026-10-29')).toEqual([]);
  });

  it('grava como visto o dia mais novo', () => {
    expect(latestNoteDate(notes)).toBe('2026-10-29');
    expect(latestNoteDate([])).toBeNull();
  });

  it('data por extenso', () => {
    expect(formatNoteDate('2026-10-28')).toBe('28 de outubro');
    expect(formatNoteDate('2026-03-05')).toBe('5 de março');
  });

  it('as notas publicadas têm data AAAA-MM-DD e texto em cada item', () => {
    for (const d of PATCH_NOTES) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.items.length).toBeGreaterThan(0);
      for (const item of d.items) expect(item.title && item.text).toBeTruthy();
    }
  });
});
