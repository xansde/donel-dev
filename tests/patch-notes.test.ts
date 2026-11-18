// Novidades da versão: cada novidade virou um arquivo em `patchnotes/notes/`.
// Guarda que a janela mostra o que mostrava antes da migração (nada some, texto,
// dia e ordem iguais) e que um arquivo mal formado não some em silêncio.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitsToNotes, parseGitLog, readGitCommits } from '../src/renderer/src/patchnotes/gitNotes';
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

describe('novidades geradas do git log', () => {
  const log = [
    ['a1b2c3d', '2026-11-18-0412', 'feat(main): mostra o placar no celular (t-2eedda0d)\n\nO placar agora aparece na tela inicial,\nsem abrir o quadro.\n\nDetalhe técnico.\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
    ['b2c3d4e', '2026-11-18-0930', 'fix: trava que volta avisa de novo\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
    ['0a1b2c3', '2026-11-17-2300', 'fix(main): sentinela não grava segredo\n\n- main.ts: mascara a flag\n- log.ts: um registro por execução'],
    ['c3d4e5f', '2026-11-18-1000', 'chore: atualiza dependências'],
    ['d4e5f6a', '2026-11-18-1001', 'test: cobre o placar'],
    ['e5f6a7b', '2026-11-18-1002', 'docs: explica o placar'],
    ['f6a7b8c', '2026-11-18-1003', 'refactor: separa o placar'],
    ['a7b8c9d', '2026-11-18-1004', 'ci: roda o verify'],
    ['b8c9d0e', '2026-11-18-1005', "Merge pull request #470 from xansde/feat/placar"],
    ['c9d0e1f', '2026-11-18-1006', 'feature: não é feat'],
  ]
    .map(([hash, stamp, message]) => `\x1e${hash}\x1f${stamp}\x1f${message}\n`)
    .join('');

  it('transforma feat e fix em novidades e ignora o resto', () => {
    expect(commitsToNotes(parseGitLog(log))).toEqual({
      './git/2026-11-18-0412-a1b2c3d.json': {
        title: 'Mostra o placar no celular',
        text: 'O placar agora aparece na tela inicial, sem abrir o quadro.',
      },
      './git/2026-11-18-0930-b2c3d4e.json': { title: 'Trava que volta avisa de novo', text: 'Trava que volta avisa de novo' },
      './git/2026-11-17-2300-0a1b2c3.json': { title: 'Sentinela não grava segredo', text: 'Sentinela não grava segredo' },
    });
  });

  it('entra na janela junto dos arquivos, na ordem do dia e da hora', () => {
    const notes = buildPatchNotes({
      './notes/2026-11-18-0500-arquivo.json': { title: 'Arquivo', text: 'a' },
      ...commitsToNotes(parseGitLog(log)),
    });
    expect(notes.map((day) => [day.date, day.items.map((item) => item.title)])).toEqual([
      ['2026-11-18', ['Trava que volta avisa de novo', 'Arquivo', 'Mostra o placar no celular']],
      ['2026-11-17', ['Sentinela não grava segredo']],
    ]);
  });

  it('sem repositório git o build segue sem novidades do git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-sem-git-'));
    try {
      expect(readGitCommits(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
