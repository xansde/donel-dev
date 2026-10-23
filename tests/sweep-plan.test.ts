// 016-jobu-faxina (T004) - planRepo: from the facts measured in a repo to what the sweep does about each one, and why.
// Pure. The rules under test are the "nunca tocar" of the owner as much as the "apaga": every refusal here is a
// guard against an incident (a junction that eats the main checkout, a branch with the only copy of a commit).
import { describe, expect, it } from 'vitest';
import { planRepo, parseInstallerName, compareVersions, STALE_SCRATCHPAD_MS, ESTEIRA_FRESH_MS, WORKTREE_FRESH_MS, isRegenerableIgnored } from '../src/main/sweep/plan';
import type { BranchFact, InstallerFact, JunkFact, PlanItem, RepoFacts, ScratchEntryFact, SessionFolderFact, UntrackedFileFact, WorktreeFact } from '../src/main/sweep/types';

const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60_000;
const REPO = 'C:\\w\\atlas';

function facts(patch: Partial<RepoFacts> = {}): RepoFacts {
  return {
    repoPath: REPO,
    repoName: 'atlas',
    integrationRef: 'origin/staging',
    fetchError: null,
    worktrees: [],
    branches: [],
    junk: [],
    installers: [],
    scratchpads: [],
    sessions: [],
    esteiraFiles: [],
    ...patch,
  };
}

function worktree(patch: Partial<WorktreeFact> = {}): WorktreeFact {
  return { path: 'C:\\w\\atlas-wt\\a', branch: 'feature/a', head: 'aaa', isMain: false, locked: false, missing: false, clean: true, headInIntegration: true, headEqualsRemote: false, lastActivityMs: NOW - 3 * DAY, ignored: [], hasSubmodules: false, ...patch };
}

function branch(patch: Partial<BranchFact> = {}): BranchFact {
  return { name: 'feature/a', sha: 'abc123', checkedOut: false, ancestorOfIntegration: true, cherryClean: true, publishedSameSha: false, onlyHereCount: 0, lastCommitMs: NOW - 3 * DAY, ...patch };
}

function junk(relPath: string, patch: Partial<JunkFact> = {}): JunkFact {
  return { relPath, absPath: `${REPO}\\${relPath.replace(/\//g, '\\')}`, kind: 'output-dir', bytes: 1000, tracked: false, ...patch };
}

function installer(name: string, patch: Partial<InstallerFact> = {}): InstallerFact {
  return { name, absPath: `${REPO}\\release\\${name}`, bytes: 100, tracked: false, ...patch };
}

function scratch(label: string, newestWriteMs: number, patch: Partial<ScratchEntryFact> = {}): ScratchEntryFact {
  return { absPath: `C:\\tmp\\claude\\${label}`, label, bytes: 500, newestWriteMs, ...patch };
}

function session(name: string, patch: Partial<SessionFolderFact> = {}): SessionFolderFact {
  return { name, absPath: `C:\\home\\.claude\\projects\\${name}`, cwd: 'C:\\w\\atlas-wt\\gone', cwdGone: true, owner: REPO, bytes: 2000, mtimeMs: NOW - 5 * DAY, ...patch };
}

function esteira(relPath: string, patch: Partial<UntrackedFileFact> = {}): UntrackedFileFact {
  return { relPath, absPath: `${REPO}\\${relPath.replace(/\//g, '\\')}`, bytes: 300, mtimeMs: NOW - 10 * DAY, ...patch };
}

const plan = (patch: Partial<RepoFacts>): readonly PlanItem[] => planRepo(facts(patch), NOW).items;
const ofKind = <K extends PlanItem['kind']>(items: readonly PlanItem[], kind: K): Extract<PlanItem, { kind: K }>[] =>
  items.filter((item): item is Extract<PlanItem, { kind: K }> => item.kind === kind);

describe('worktrees', () => {
  it('removes a clean worktree whose HEAD is already in the integration branch', () => {
    const items = plan({ worktrees: [worktree()] });
    expect(ofKind(items, 'removeWorktree')).toEqual([{ kind: 'removeWorktree', path: 'C:\\w\\atlas-wt\\a', branch: 'feature/a', missing: false, reason: 'já em origin/staging' }]);
  });

  it('removes a clean worktree whose HEAD is what the remote has of the same branch', () => {
    const items = plan({ worktrees: [worktree({ headInIntegration: false, headEqualsRemote: true })] });
    expect(ofKind(items, 'removeWorktree')[0]?.reason).toBe('publicada no remoto com o mesmo SHA');
  });

  it('keeps a worktree with a submodule, saying why: git refuses to remove it (achado da 1ª faxina real)', () => {
    const items = plan({ worktrees: [worktree({ hasSubmodules: true })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
    expect(ofKind(items, 'keep')).toEqual([{ kind: 'keep', what: 'worktree', name: 'C:\\w\\atlas-wt\\a', reason: 'tem submódulo (o git não remove worktree com submódulo)' }]);
  });

  it('a worktree with a submodule is never removed, whatever else is true of it', () => {
    const items = plan({ worktrees: [worktree({ hasSubmodules: true, headInIntegration: true, headEqualsRemote: true, lastActivityMs: NOW - 30 * DAY })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
  });

  it('a missing worktree is still pruned (the folder is gone, nothing to refuse)', () => {
    const items = plan({ worktrees: [worktree({ missing: true })] });
    expect(ofKind(items, 'removeWorktree')[0]?.missing).toBe(true);
  });

  it('keeps a worktree with unsaved changes, saying so', () => {
    const items = plan({ worktrees: [worktree({ clean: false })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
    expect(ofKind(items, 'keep')).toEqual([{ kind: 'keep', what: 'worktree', name: 'C:\\w\\atlas-wt\\a', reason: 'mudança não commitada' }]);
  });

  it('keeps a clean worktree with a commit that exists only here', () => {
    const items = plan({ worktrees: [worktree({ headInIntegration: false, headEqualsRemote: false })] });
    expect(ofKind(items, 'keep')[0]?.reason).toBe('commit que só existe aqui');
  });

  it('keeps a clean worktree used in the last day: a card that was just born has no commit yet and looks merged', () => {
    const items = plan({ worktrees: [worktree({ lastActivityMs: NOW - WORKTREE_FRESH_MS + 60_000 })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
    expect(ofKind(items, 'keep')[0]?.reason).toBe('usada nas últimas 24 h');
  });

  it('removes a clean, merged worktree once the last day has passed', () => {
    const items = plan({ worktrees: [worktree({ lastActivityMs: NOW - WORKTREE_FRESH_MS - 60_000 })] });
    expect(ofKind(items, 'removeWorktree')).toHaveLength(1);
  });

  it('keeps a merged worktree holding an ignored file that nothing recreates, naming it: git worktree remove would take a .env with it', () => {
    const items = plan({ worktrees: [worktree({ ignored: ['node_modules/', '.env.local', 'src/__pycache__/'] })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
    expect(ofKind(items, 'keep')[0]?.reason).toBe('arquivo ignorado que não se recria: .env.local');
  });

  it('removes a merged worktree whose ignored files are all regenerable', () => {
    const items = plan({ worktrees: [worktree({ ignored: ['node_modules/', 'dist/', 'src/a/__pycache__/', '.pytest_cache/', 'debug.log'] })] });
    expect(ofKind(items, 'removeWorktree')).toHaveLength(1);
  });

  it('never touches the main checkout, and does not even mention it', () => {
    expect(plan({ worktrees: [worktree({ isMain: true })] })).toEqual([]);
  });

  it('keeps a locked worktree', () => {
    expect(ofKind(plan({ worktrees: [worktree({ locked: true })] }), 'keep')[0]?.reason).toBe('travada (git worktree lock)');
  });

  it('keeps the worktrees of the installed channels (alfa, beta)', () => {
    const items = plan({ worktrees: [worktree({ path: 'C:\\w\\atlas-alfa' }), worktree({ path: 'C:\\w\\atlas-BETA' })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([]);
    expect(ofKind(items, 'keep').map((item) => item.reason)).toEqual(['canal instalado', 'canal instalado']);
  });

  it('a worktree whose folder is already gone only needs a prune', () => {
    const items = plan({ worktrees: [worktree({ missing: true, clean: false, headInIntegration: false })] });
    expect(ofKind(items, 'removeWorktree')).toEqual([expect.objectContaining({ missing: true, reason: 'a pasta já não existia (só registro no git)' })]);
  });

  it('without an integration branch the reason is generic but the rule is the same', () => {
    const items = planRepo(facts({ integrationRef: null, worktrees: [worktree({ headEqualsRemote: true, headInIntegration: false })] }), NOW).items;
    expect(ofKind(items, 'removeWorktree')).toHaveLength(1);
  });
});

describe('branches', () => {
  it('deletes a branch that is an ancestor of the integration branch, keeping name and SHA for the receipt', () => {
    const items = plan({ branches: [branch()] });
    expect(ofKind(items, 'deleteBranch')).toEqual([{ kind: 'deleteBranch', name: 'feature/a', sha: 'abc123', reason: 'já incorporada em origin/staging' }]);
  });

  it('deletes one whose patches are all already there (squash, cherry-pick)', () => {
    const items = plan({ branches: [branch({ ancestorOfIntegration: false })] });
    expect(ofKind(items, 'deleteBranch')[0]?.reason).toBe('conteúdo já em origin/staging (git cherry)');
  });

  it('deletes one published on the remote at the same SHA, even without a merge', () => {
    const items = plan({ branches: [branch({ ancestorOfIntegration: false, cherryClean: false, publishedSameSha: true })] });
    expect(ofKind(items, 'deleteBranch')[0]?.reason).toBe('publicada no remoto com o mesmo SHA');
  });

  it('keeps one with commits that exist only here, with the count and the date of the last', () => {
    const items = plan({ branches: [branch({ name: 'wip', ancestorOfIntegration: false, cherryClean: false, onlyHereCount: 7, lastCommitMs: new Date(2026, 9, 20, 10).getTime() })] });
    expect(ofKind(items, 'deleteBranch')).toEqual([]);
    expect(ofKind(items, 'keep')).toEqual([{ kind: 'keep', what: 'branch', name: 'wip', reason: '7 commits só aqui, último em 20/10/2026' }]);
  });

  it('says "1 commit" in the singular', () => {
    const items = plan({ branches: [branch({ ancestorOfIntegration: false, cherryClean: false, onlyHereCount: 1 })] });
    expect(ofKind(items, 'keep')[0]?.reason).toMatch(/^1 commit só aqui/);
  });

  it('never touches main, master, staging, dev, even when they would qualify', () => {
    const names = ['main', 'master', 'staging', 'dev'];
    expect(plan({ branches: names.map((name) => branch({ name })) })).toEqual([]);
  });

  it('never touches backup/*, and says it is on purpose', () => {
    const items = plan({ branches: [branch({ name: 'backup/beta-0805' })] });
    expect(ofKind(items, 'deleteBranch')).toEqual([]);
    expect(ofKind(items, 'keep')).toEqual([{ kind: 'keep', what: 'branch', name: 'backup/beta-0805', reason: 'backup/* nunca é tocado' }]);
  });

  it('never touches a branch checked out in a worktree', () => {
    expect(plan({ branches: [branch({ checkedOut: true })] })).toEqual([]);
  });

  it('without an integration branch only the "published at the same SHA" rule can apply', () => {
    const items = planRepo(
      facts({ integrationRef: null, branches: [branch({ name: 'a', ancestorOfIntegration: false, cherryClean: false, publishedSameSha: true }), branch({ name: 'b', ancestorOfIntegration: true, cherryClean: true })] }),
      NOW,
    ).items;
    expect(ofKind(items, 'deleteBranch').map((item) => item.name)).toEqual(['a']);
  });

  it('lists the branches in alphabetical order, so the receipt and the summary are stable', () => {
    const items = plan({ branches: [branch({ name: 'z' }), branch({ name: 'a' }), branch({ name: 'm' })] });
    expect(ofKind(items, 'deleteBranch').map((item) => item.name)).toEqual(['a', 'm', 'z']);
  });
});

describe('regenerable output', () => {
  it('deletes untracked output directories and the stray PowerShell cache', () => {
    const items = plan({
      junk: [
        junk('test-results'),
        junk('.e2e-visual'),
        junk('tests/smoke/.playwright-cli'),
        junk('Microsoft', { kind: 'stray-cache' }),
        junk('prototypes/mapa/node_modules', { kind: 'prototype-modules' }),
        junk('prototypes/mapa/dist', { kind: 'prototype-dist' }),
      ],
    });
    expect(ofKind(items, 'delete').map((item) => item.label)).toEqual([
      'test-results',
      '.e2e-visual',
      'tests/smoke/.playwright-cli',
      'Microsoft',
      'prototypes/mapa/node_modules',
      'prototypes/mapa/dist',
    ]);
    expect(ofKind(items, 'delete').every((item) => item.group === 'regenerable')).toBe(true);
  });

  it('keeps what git tracks, even under a name that looks like output', () => {
    const items = plan({ junk: [junk('test-results', { tracked: true })] });
    expect(ofKind(items, 'delete')).toEqual([]);
    expect(ofKind(items, 'keep')).toEqual([{ kind: 'keep', what: 'path', name: 'test-results', reason: 'o git rastreia arquivos aqui: não é saída gerada' }]);
  });

  it('refuses the paths that are never touched, even if the inventory handed them over', () => {
    const items = plan({
      junk: [
        junk('node_modules'),
        junk('out'),
        junk('dist'),
        junk('probe-chat'),
        junk('tests/probe'),
        junk('scripts/publicar.local.json'),
        junk('.git'),
        junk('probe-x/test-results'),
      ],
    });
    expect(items).toEqual([]);
  });

  it('refuses a kind that does not match its path (a prototype rule on the root node_modules)', () => {
    expect(plan({ junk: [junk('node_modules', { kind: 'prototype-modules' }), junk('src', { kind: 'output-dir' }), junk('docs', { kind: 'stray-cache' })] })).toEqual([]);
  });

  it('carries the size, for the totals', () => {
    expect(ofKind(plan({ junk: [junk('test-results', { bytes: 4242 })] }), 'delete')[0]?.bytes).toBe(4242);
  });
});

describe('installers in release/', () => {
  it('deletes every version but the newest of each product, with its blockmap', () => {
    const items = plan({
      installers: [
        installer('Donel Dev-Setup-0.3.0.exe'),
        installer('Donel Dev-Setup-0.3.0.exe.blockmap'),
        installer('Donel Dev-Setup-0.10.0.exe'),
        installer('Donel Dev-Setup-0.10.0.exe.blockmap'),
        installer('Donel Dev-Setup-0.9.2.exe'),
      ],
    });
    expect(ofKind(items, 'delete').map((item) => item.label)).toEqual(['release/Donel Dev-Setup-0.3.0.exe', 'release/Donel Dev-Setup-0.3.0.exe.blockmap', 'release/Donel Dev-Setup-0.9.2.exe']);
    expect(ofKind(items, 'delete')[0]?.group).toBe('installer');
    expect(ofKind(items, 'delete')[0]?.reason).toBe('instalador antigo (0.10.0 segue em release/)');
  });

  it('judges each product on its own: "Alfa" and "Beta" do not compete', () => {
    const items = plan({ installers: [installer('Donel Dev Alfa-Setup-0.5.0.exe'), installer('Donel Dev Beta-Setup-0.1.0.exe')] });
    expect(ofKind(items, 'delete')).toEqual([]);
  });

  it('a pre-release is older than the release of the same number', () => {
    const items = plan({ installers: [installer('App-Setup-1.0.0-beta.1.exe'), installer('App-Setup-1.0.0.exe')] });
    expect(ofKind(items, 'delete').map((item) => item.label)).toEqual(['release/App-Setup-1.0.0-beta.1.exe']);
  });

  it('leaves alone files that do not follow the pattern, and anything git tracks', () => {
    const items = plan({
      installers: [installer('notas.txt'), installer('App-Setup-1.0.0.exe', { tracked: true }), installer('App-Setup-2.0.0.exe', { tracked: true })],
    });
    expect(ofKind(items, 'delete')).toEqual([]);
  });

  it('parseInstallerName and compareVersions', () => {
    expect(parseInstallerName('Donel Dev-Setup-0.4.0.exe')).toEqual({ product: 'Donel Dev', version: '0.4.0', blockmap: false });
    expect(parseInstallerName('Donel Dev-Setup-0.4.0.exe.blockmap')).toEqual({ product: 'Donel Dev', version: '0.4.0', blockmap: true });
    expect(parseInstallerName('Donel Dev-0.4.0.exe')).toBeNull();
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('scratchpads in %TEMP%', () => {
  it('deletes the ones with no write for more than 7 days, keeps the recent ones without mentioning them', () => {
    const items = plan({ scratchpads: [scratch('old', NOW - STALE_SCRATCHPAD_MS - 1), scratch('fresh', NOW - STALE_SCRATCHPAD_MS + 60_000)] });
    expect(ofKind(items, 'delete')).toEqual([
      { kind: 'delete', group: 'scratchpad', path: 'C:\\tmp\\claude\\old', label: 'old', bytes: 500, reason: 'scratchpad de sessão sem escrita há mais de 7 dias' },
    ]);
    expect(ofKind(items, 'keep')).toEqual([]);
  });
});

describe('Claude sessions whose folder is gone', () => {
  it('separates them into sessoes-claude/, with how to bring them back', () => {
    const items = plan({ sessions: [session('C--w-atlas-wt-gone')] });
    expect(ofKind(items, 'separate')).toEqual([
      {
        kind: 'separate',
        group: 'sessoes-claude',
        from: 'C:\\home\\.claude\\projects\\C--w-atlas-wt-gone',
        destRel: 'sessoes-claude/C--w-atlas-wt-gone',
        bytes: 2000,
        mtimeMs: NOW - 5 * DAY,
        reason: 'a pasta de trabalho dela não existe mais',
        restore: 'mova a pasta de volta para ~/.claude/projects/',
      },
    ]);
  });

  it('leaves alone a session whose folder still exists, another repo\'s, and one with no readable cwd', () => {
    const items = plan({
      sessions: [session('alive', { cwdGone: false }), session('other', { owner: 'C:\\w\\vega' }), session('nocwd', { cwd: null, owner: null }), session('noowner', { owner: null })],
    });
    expect(items).toEqual([]);
  });
});

describe('untracked files of .esteira/', () => {
  it('separates them keeping the relative path', () => {
    const items = plan({ esteiraFiles: [esteira('.esteira/handoffs/011.md')] });
    const [only] = ofKind(items, 'separate');
    expect(only).toMatchObject({ group: 'esteira', destRel: '.esteira/handoffs/011.md', restore: 'copie de volta para .esteira/handoffs/011.md no repo' });
  });

  it('keeps what was written in the last 24 h: it may belong to the delivery in progress', () => {
    const items = plan({ esteiraFiles: [esteira('.esteira/ctx/atual.md', { mtimeMs: NOW - ESTEIRA_FRESH_MS + 60_000 })] });
    expect(ofKind(items, 'separate')).toEqual([]);
    expect(ofKind(items, 'keep')[0]).toMatchObject({ what: 'path', name: '.esteira/ctx/atual.md' });
  });

  it('ignores anything outside .esteira/', () => {
    expect(plan({ esteiraFiles: [esteira('docs/x.md')] })).toEqual([]);
  });
});

describe('the plan as a whole', () => {
  it('carries the repo, the integration branch and the fetch error to the report', () => {
    const planned = planRepo(facts({ fetchError: 'sem rede' }), NOW);
    expect(planned).toMatchObject({ repoPath: REPO, repoName: 'atlas', integrationRef: 'origin/staging', fetchError: 'sem rede', items: [] });
  });

  it('orders the items: worktrees, branches, deletions, separations, then what was left alone', () => {
    const items = plan({
      worktrees: [worktree(), worktree({ path: 'C:\\w\\atlas-wt\\dirty', clean: false })],
      branches: [branch()],
      junk: [junk('test-results')],
      sessions: [session('s')],
    });
    expect(items.map((item) => item.kind)).toEqual(['removeWorktree', 'deleteBranch', 'delete', 'separate', 'keep']);
  });
});

describe('isRegenerableIgnored', () => {
  it.each(['node_modules/', 'packages/x/node_modules/', 'dist/', 'out/', 'build/', '.next/', 'coverage/', 'src/a/__pycache__/', '.pytest_cache/', '.ruff_cache/', '.mypy_cache/', '.venv/', 'test-results/', 'a/b.pyc', 'npm-debug.log', '.playwright-cli/'])(
    'treats %s as regenerable',
    (path) => expect(isRegenerableIgnored(path)).toBe(true),
  );

  it.each(['.env', '.env.local', 'config/secrets.json', 'knowledge-base/.index/', 'scripts/publicar.local.json', 'data.db'])(
    'treats %s as something that does not come back',
    (path) => expect(isRegenerableIgnored(path)).toBe(false),
  );
});
