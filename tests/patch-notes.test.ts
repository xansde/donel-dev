// Novidades da versão: cada novidade virou um arquivo em `patchnotes/notes/`.
// Guarda que a janela mostra o que mostrava antes da migração (nada some, texto,
// dia e ordem iguais) e que um arquivo mal formado não some em silêncio.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changesToNotes, readGitChanges } from '../src/renderer/src/patchnotes/gitNotes';
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
  // Repositório de verdade: a linha de 1º pai, o diff contra ela e os commits do
  // PR é que decidem o que vira novidade.
  function repoWithHistory(): string {
    const dir = mkdtempSync(join(tmpdir(), 'donel-notas-'));
    let clock = Date.parse('2026-11-18T10:00:00Z');
    const run = (...args: string[]): string => {
      clock += 60_000;
      const date = new Date(clock).toISOString();
      return execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
    };
    const write = (path: string, content: string): void => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    };
    const commit = (path: string, message: string): void => {
      write(path, `${message}\n${clock}`);
      run('add', '-A');
      run('commit', '-q', '-m', message);
    };
    const pr = (n: number, title: string, commits: [string, string][]): void => {
      run('checkout', '-q', '-b', `pr-${n}`, 'staging');
      for (const [path, message] of commits) commit(path, message);
      run('checkout', '-q', 'staging');
      run('merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from xansde/pr-${n}\n\n${title}`, `pr-${n}`);
    };

    run('init', '-q', '-b', 'staging');
    run('config', 'user.email', 't@t');
    run('config', 'user.name', 't');
    run('config', 'commit.gpgsign', 'false');
    commit('README.md', 'chore: início');
    pr(1, 'feat: placar na tela inicial (t-2eedda0d) (#1)', [
      ['src/a.ts', 'feat(main): placar\n\nO placar aparece na tela inicial,\nsem abrir o quadro.\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
      ['src/a.ts', 'fix: ressalvas do revisor\n\nTexto interno da revisão.'],
      ['src/a.ts', 'fix: ressalvas do revisor'],
    ]);
    pr(2, 'fix: trava que volta avisa de novo', [['src/b.ts', 'fix: trava\n\nt-2eedda0d, Nota: o aviso volta quando a trava volta.']]);
    pr(3, 'feat: novidade já escrita à mão', [
      ['src/c.ts', 'feat: c'],
      ['src/renderer/src/patchnotes/notes/2026-11-18-0700-c.json', 'fix: novidade'],
    ]);
    pr(4, 'fix: cron do servidor', [['scripts/cron.mjs', 'fix: cron']]);
    pr(5, 'chore: dependências', [['src/d.ts', 'feat: d']]);
    pr(6, 'feat: recurso desfeito', [['src/e.ts', 'feat: e']]);
    const reverted = run('rev-parse', 'HEAD').trim();
    run('revert', '--no-edit', '-m', '1', reverted);
    commit('src/f.ts', 'fix: corrigido direto na branch\n\n- f.ts: lista não é texto');
    return dir;
  }

  it('dá uma novidade por PR feat/fix que chega ao app, na hora do merge em São Paulo', () => {
    const dir = repoWithHistory();
    try {
      const notes = changesToNotes(readGitChanges(dir, '2026-11-18T00:00:00Z'));
      expect(Object.entries(notes).map(([key, item]) => [key.replace(/-[0-9a-f]{8}\.json$/, ''), item])).toEqual([
        ['./git/2026-11-18-0746', { title: 'Corrigido direto na branch', text: 'Corrigido direto na branch' }],
        ['./git/2026-11-18-0720', { title: 'Trava que volta avisa de novo', text: 'Nota: o aviso volta quando a trava volta.' }],
        ['./git/2026-11-18-0715', { title: 'Placar na tela inicial', text: 'O placar aparece na tela inicial, sem abrir o quadro.' }],
      ]);

      const days = buildPatchNotes({ './notes/2026-11-18-0716-arquivo.json': { title: 'Arquivo', text: 'a' }, ...notes });
      expect(days.map((day) => [day.date, day.items.map((item) => item.title)])).toEqual([
        ['2026-11-18', ['Corrigido direto na branch', 'Trava que volta avisa de novo', 'Arquivo', 'Placar na tela inicial']],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('sem repositório git o build segue sem novidades do git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-sem-git-'));
    try {
      expect(readGitChanges(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
