// 016-jobu-faxina (T005) - the resumo.html of a sweep: self-contained, every text escaped, and the tables the owner
// reads to decide what to delete from the folder. Pure: the report goes in, a string comes out.
import { describe, expect, it } from 'vitest';
import { renderSummary, totalsOf, summaryText } from '../src/main/sweep/render-summary';
import type { ExecutedItem, PlanItem, RepoReport, SweepReport } from '../src/main/sweep/types';

const MB = 1024 * 1024;
const WHEN = new Date(2026, 9, 20, 10).getTime();

const ok = (item: PlanItem): ExecutedItem => ({ item, ok: true, error: null });
const failed = (item: PlanItem, error: string): ExecutedItem => ({ item, ok: false, error });

function repo(patch: Partial<RepoReport> = {}): RepoReport {
  return { repoPath: 'C:\\w\\atlas', repoName: 'atlas', folderName: 'atlas', integrationRef: 'origin/staging', fetchError: null, executed: [], kept: [], ...patch };
}

function report(repos: RepoReport[], patch: Partial<SweepReport> = {}): SweepReport {
  return { day: '2026-10-23', folder: 'C:\\w\\_archive\\faxina-2026-10-23', repos, notes: [], ...patch };
}

const fullRepo = repo({
  executed: [
    ok({ kind: 'separate', group: 'sessoes-claude', from: 'C:\\h\\.claude\\projects\\C--w-atlas-wt-x', destRel: 'sessoes-claude/C--w-atlas-wt-x', bytes: 3 * MB, mtimeMs: WHEN, reason: 'r', restore: 'mova a pasta de volta para ~/.claude/projects/' }),
    ok({ kind: 'separate', group: 'esteira', from: 'C:\\w\\atlas\\.esteira\\h.md', destRel: '.esteira/h.md', bytes: 2048, mtimeMs: WHEN, reason: 'r', restore: 'copie de volta para .esteira/h.md no repo' }),
    ok({ kind: 'delete', group: 'regenerable', path: 'C:\\w\\atlas\\test-results', label: 'test-results', bytes: 100 * MB, reason: 'saída regenerável' }),
    ok({ kind: 'delete', group: 'installer', path: 'C:\\w\\atlas\\release\\A-Setup-1.0.0.exe', label: 'release/A-Setup-1.0.0.exe', bytes: 50 * MB, reason: 'instalador antigo' }),
    ok({ kind: 'removeWorktree', path: 'C:\\w\\atlas-wt\\a', branch: 'docs/a', missing: false, reason: 'já em origin/staging' }),
    ok({ kind: 'deleteBranch', name: 'feature/old', sha: '0123456789abcdef0123456789abcdef01234567', reason: 'já incorporada em origin/staging' }),
    failed({ kind: 'delete', group: 'regenerable', path: 'C:\\w\\atlas\\.e2e-visual', label: '.e2e-visual', bytes: 7 * MB, reason: 'saída regenerável' }, 'EBUSY: arquivo em uso'),
  ],
  kept: [
    { kind: 'keep', what: 'worktree', name: 'C:\\w\\atlas-wt\\dirty', reason: 'mudança não commitada' },
    { kind: 'keep', what: 'branch', name: 'wip', reason: '7 commits só aqui, último em 20/10/2026' },
  ],
});

describe('totalsOf', () => {
  it('counts only what really happened: a failed deletion frees nothing', () => {
    expect(totalsOf(report([fullRepo]))).toEqual({
      freedBytes: 150 * MB,
      separatedBytes: 3 * MB + 2048,
      separatedItems: 2,
      branchesDeleted: 1,
      worktreesRemoved: 1,
      kept: 2,
      failed: 1,
    });
  });

  it('adds up several repos', () => {
    const second = repo({ repoName: 'vega', executed: [ok({ kind: 'deleteBranch', name: 'b', sha: 'f', reason: 'r' })] });
    expect(totalsOf(report([fullRepo, second])).branchesDeleted).toBe(2);
  });
});

describe('summaryText: the sentence at the top of the page', () => {
  it('says what was freed, set aside, removed and left', () => {
    expect(summaryText(totalsOf(report([fullRepo])))).toBe(
      'Faxina: 150 MB liberados; 2 itens separados na pasta (3,0 MB). 1 branch e 1 worktree removidas. Ficaram 2 itens de lado e 1 não pôde ser feito.',
    );
  });

  it('is short when there is little to say', () => {
    expect(summaryText({ freedBytes: 0, separatedBytes: 0, separatedItems: 0, branchesDeleted: 0, worktreesRemoved: 0, kept: 0, failed: 0 })).toBe('Faxina: nada a limpar.');
  });
});

describe('renderSummary', () => {
  const html = renderSummary(report([fullRepo]), WHEN);

  it('is a self-contained document: no script, no external address, dark theme through the media query', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('titles the page with the day and names the repos and the folder', () => {
    expect(html).toContain('<title>Faxina 23/10/2026</title>');
    expect(html).toContain('Faxina de 23/10/2026');
    expect(html).toContain('<code>atlas</code>');
    expect(html).toContain('C:\\w\\_archive\\faxina-2026-10-23');
  });

  it('shows the totals as tiles', () => {
    expect(html).toContain('150 MB');
    expect(html).toContain('apagado direto');
    expect(html).toContain('separado nesta pasta');
  });

  it('lists what is in the folder with origin, date, size and how to restore', () => {
    expect(html).toContain('C--w-atlas-wt-x');
    expect(html).toContain('20/10/2026');
    expect(html).toContain('mova a pasta de volta para ~/.claude/projects/');
    expect(html).toContain('.esteira/h.md');
    expect(html).toContain('copie de volta para .esteira/h.md no repo');
  });

  it('gives each deleted branch the command that brings it back', () => {
    expect(html).toContain('git branch feature/old 0123456789abcdef0123456789abcdef01234567');
  });

  it('lists what was deleted, the worktrees removed and what was left alone with the reason', () => {
    expect(html).toContain('test-results');
    expect(html).toContain('release/A-Setup-1.0.0.exe');
    expect(html).toContain('C:\\w\\atlas-wt\\a');
    expect(html).toContain('mudança não commitada');
    expect(html).toContain('7 commits só aqui, último em 20/10/2026');
  });

  it('puts what failed in its own section with the error', () => {
    expect(html).toContain('Não foi possível');
    expect(html).toContain('EBUSY: arquivo em uso');
  });

  it('does not count a failed deletion among the deleted', () => {
    const deletedSection = html.slice(html.indexOf('Apagado direto'), html.indexOf('Worktrees removidas'));
    expect(deletedSection).not.toContain('.e2e-visual');
  });

  it('escapes every text: a name with markup cannot break the page', () => {
    const hostile = repo({
      repoName: '<img src=x onerror=alert(1)>',
      executed: [ok({ kind: 'deleteBranch', name: 'a"><script>alert(1)</script>', sha: '1&2', reason: '<b>r</b>' })],
      kept: [{ kind: 'keep', what: 'path', name: "x'y", reason: '</td><td>' }],
    });
    const out = renderSummary(report([hostile], { notes: ['<script>n</script>'] }), WHEN);
    expect(out).not.toContain('<img');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('<b>r</b>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('x&#39;y');
  });

  it('prints the notes of the sweep and the fetch error of a repo', () => {
    const out = renderSummary(report([repo({ fetchError: 'sem rede', executed: [ok({ kind: 'deleteBranch', name: 'b', sha: 'f', reason: 'r' })] })], { notes: ['um repo não pôde ser lido'] }), WHEN);
    expect(out).toContain('um repo não pôde ser lido');
    expect(out).toContain('git fetch falhou');
    expect(out).toContain('sem rede');
  });

  it('with no folder (nothing was set aside) the page still renders without inventing a path', () => {
    const out = renderSummary(report([repo({ executed: [ok({ kind: 'delete', group: 'regenerable', path: 'p', label: 'out-x', bytes: MB, reason: 'r' })] })], { folder: null }), WHEN);
    expect(out).toContain('out-x');
    expect(out).not.toContain('pasta da faxina');
  });
});
