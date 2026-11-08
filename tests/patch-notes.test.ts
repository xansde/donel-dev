// Novidades da versão: cada novidade virou um arquivo em `patchnotes/notes/`.
// Guarda que a janela mostra o que mostrava antes da migração (nada some, texto,
// dia e ordem iguais) e que um arquivo mal formado não some em silêncio.

import { describe, expect, it } from 'vitest';
import { buildPatchNotes, PATCH_NOTES, type PatchNoteDay } from '../src/renderer/src/patchnotes/notes';
import { recentNotes } from '../src/renderer/src/patchnotes/patchNotesModel';
import before from './fixtures/patch-notes-antes-da-migracao.json';

describe('novidades por arquivo', () => {
  it('mostra exatamente o que o notes.ts mostrava antes da migração', () => {
    // Novidades acrescentadas depois da migração ficam de fora da comparação;
    // as que existiam têm de estar todas, com o mesmo texto, no mesmo dia e na mesma ordem.
    const known = new Set(before.flatMap((day) => day.items.map((item) => `${day.date}\n${item.title}`)));
    const migrated: PatchNoteDay[] = recentNotes(PATCH_NOTES, Number.MAX_SAFE_INTEGER)
      .map((day) => ({ date: day.date, items: day.items.filter((item) => known.has(`${day.date}\n${item.title}`)) }))
      .filter((day) => day.items.length > 0);

    expect(migrated).toEqual(before);
  });

  it('põe o dia mais novo primeiro e, no dia, a hora maior primeiro', () => {
    const notes = buildPatchNotes({
      './notes/2026-11-06-0900-antiga.json': { title: 'A', text: 'a' },
      './notes/2026-11-07-0001-cedo.json': { title: 'B', text: 'b' },
      './notes/2026-11-07-1430-tarde.json': { title: 'C', text: 'c' },
    });

    expect(notes.map((day) => [day.date, day.items.map((item) => item.title)])).toEqual([
      ['2026-11-07', ['C', 'B']],
      ['2026-11-06', ['A']],
    ]);
  });

  it('recusa arquivo com nome fora do padrão ou sem título e texto', () => {
    expect(() => buildPatchNotes({ './notes/2026-11-07-nova.json': { title: 'A', text: 'a' } })).toThrow(
      '2026-11-07-nova.json',
    );
    expect(() => buildPatchNotes({ './notes/2026-11-07-1430-nova.json': { title: 'A' } })).toThrow(
      '2026-11-07-1430-nova.json',
    );
  });
});
