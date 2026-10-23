// 016-jobu-faxina (T008-T011) - the sweep from end to end against REAL temporary git repos (os.tmpdir()): inventory,
// plan, executor, sweep folder, receipt and summary. Nothing here touches a real repo or the real ~/.claude.
// One big scenario is built once and asserted piece by piece; the smaller ones (second sweep of the day, stamp, no
// remote, failed fetch) get their own sandbox.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitRunner } from '../src/main/sweep/git';
import { localDay, repoSlugs } from '../src/main/sweep/names';
import { createSweepRunner, SUMMARY_FILE, type SweepDeps } from '../src/main/sweep/sweep-service';
import type { SweepBubbleSummary } from '../src/shared/pet/types';
import { age, commitAll, createRepo, createSandbox, git, write, type Sandbox } from './helpers/sweep-fixture';

const exists = async (path: string): Promise<boolean> => fs.lstat(path).then(() => true, () => false);

interface Run {
  readonly summary: SweepBubbleSummary;
  readonly stamps: number[];
  readonly logs: string[];
}

function depsFor(sandbox: Sandbox, over: Partial<SweepDeps> = {}): { deps: SweepDeps; stamps: number[]; logs: string[] } {
  const stamps: number[] = [];
  const logs: string[] = [];
  const deps: SweepDeps = {
    git: createGitRunner(),
    now: () => Date.now(),
    getRoots: () => [sandbox.seazone],
    getLastSweepAt: () => null,
    setLastSweepAt: (ms) => void stamps.push(ms),
    claudeProjectsDir: sandbox.claudeProjects,
    tempClaudeDir: sandbox.tempClaude,
    log: (line) => void logs.push(line),
    ...over,
  };
  return { deps, stamps, logs };
}

async function sweep(sandbox: Sandbox, over: Partial<SweepDeps> = {}): Promise<Run> {
  const { deps, stamps, logs } = depsFor(sandbox, over);
  return { summary: await createSweepRunner(deps)(), stamps, logs };
}

async function jsonlSession(sandbox: Sandbox, name: string, cwd: string): Promise<string> {
  const folder = join(sandbox.claudeProjects, name);
  await write(join(folder, 's1.jsonl'), `${JSON.stringify({ type: 'custom-title', title: 'x' })}\n${JSON.stringify({ type: 'user', cwd, sessionId: 's1' })}\n`);
  return folder;
}

// ---------------------------------------------------------------------------
// The big scenario
// ---------------------------------------------------------------------------

describe('a full sweep over a repo with everything in it', () => {
  let sandbox: Sandbox;
  let repo: string;
  let run: Run;
  let slug: string;
  let stagingSha: string;
  const shas: Record<string, string> = {};
  let folder: string;

  beforeAll(async () => {
    sandbox = await createSandbox();
    repo = await createRepo(sandbox, 'atlas');
    slug = repoSlugs(repo)[0] as string;

    // Tracked files that look like output, and a tracked esteira file: must survive.
    await write(join(repo, '.e2e-visual', 'tracked.txt'), 'meu');
    await write(join(repo, '.esteira', 'tracked.md'), 'versionado');
    commitAll(repo, 'chore: arquivos versionados');
    git(repo, 'push', '-q', 'origin', 'staging');

    // Branches.
    git(repo, 'branch', 'old1');
    git(repo, 'branch', 'backup/x');
    git(repo, 'checkout', '-q', '-b', 'squashed');
    await write(join(repo, 'squashed.txt'), 's');
    commitAll(repo, 'feat: squashed');
    git(repo, 'checkout', '-q', 'staging');
    git(repo, 'cherry-pick', 'squashed');
    git(repo, 'push', '-q', 'origin', 'staging');
    git(repo, 'checkout', '-q', '-b', 'pub');
    await write(join(repo, 'pub.txt'), 'p');
    shas.pub = commitAll(repo, 'feat: publicada');
    git(repo, 'push', '-q', 'origin', 'pub');
    git(repo, 'checkout', '-q', 'staging');
    git(repo, 'checkout', '-q', '-b', 'wip');
    await write(join(repo, 'wip.txt'), 'w');
    commitAll(repo, 'feat: so aqui');
    git(repo, 'checkout', '-q', 'staging');
    shas.old1 = git(repo, 'rev-parse', 'old1');
    shas.squashed = git(repo, 'rev-parse', 'squashed');
    stagingSha = git(repo, 'rev-parse', 'HEAD');

    // Worktrees: merged (with a junction into the main checkout), dirty, local-only commit, and an installed channel.
    await write(join(repo, 'node_modules', 'keep.txt'), 'nao pode sumir');
    const wtRoot = join(sandbox.seazone, 'atlas-wt');
    git(repo, 'worktree', 'add', '-q', join(wtRoot, 'merged'), '-b', 'docs/merged');
    await fs.symlink(join(repo, 'node_modules'), join(wtRoot, 'merged', 'node_modules'), 'junction');
    git(repo, 'worktree', 'add', '-q', join(wtRoot, 'dirty'), '-b', 'feature/dirty');
    await write(join(wtRoot, 'dirty', 'solto.txt'), 'nao salvei');
    git(repo, 'worktree', 'add', '-q', join(wtRoot, 'local'), '-b', 'feature/local');
    await write(join(wtRoot, 'local', 'novo.txt'), 'n');
    commitAll(join(wtRoot, 'local'), 'feat: so na worktree');
    git(repo, 'worktree', 'add', '-q', join(sandbox.seazone, 'atlas-alfa'), '-b', 'channel/alfa');

    // Regenerable output.
    await write(join(repo, 'test-results', 'a.txt'), 'x'.repeat(2000));
    await write(join(repo, 'tests', 'smoke', '.playwright-cli', 'x.log'), 'log');
    await write(join(repo, 'Microsoft', 'Windows', 'ps.cache'), 'cache');
    await write(join(repo, 'probe-chat', 'test-results', 'x.txt'), 'sonda');
    await write(join(repo, 'prototypes', 'p1', 'node_modules', 'm.txt'), 'm');
    await write(join(repo, 'prototypes', 'p1', 'dist', 'b.txt'), 'b');
    await write(join(repo, 'prototypes', 'p1', 'src', 'a.txt'), 'fonte do prototipo');
    for (const name of ['Donel-Setup-0.3.0.exe', 'Donel-Setup-0.3.0.exe.blockmap', 'Donel-Setup-0.4.0.exe', 'Donel-Setup-0.4.0.exe.blockmap']) {
      await write(join(repo, 'release', name), name);
    }

    // The .esteira of the main checkout: an old untracked file, a fresh one.
    await write(join(repo, '.esteira', 'old', 'handoff.md'), 'handoff de item concluido');
    await age(join(repo, '.esteira', 'old', 'handoff.md'), 5);
    await write(join(repo, '.esteira', 'fresh.md'), 'da entrega em curso');

    // Claude sessions: one whose folder is gone, one alive, one of nobody, one on a drive that does not answer.
    await jsonlSession(sandbox, 'C--box-atlas-wt-gone', join(wtRoot, 'gone-spike'));
    await jsonlSession(sandbox, 'C--box-atlas-alive', repo);
    await jsonlSession(sandbox, 'C--box-nobody', join(sandbox.root, 'elsewhere', 'nobody'));
    await jsonlSession(sandbox, 'C--box-unplugged', 'Q:\\atlas-wt\\sumiu');

    // Scratchpads in %TEMP%/claude.
    const oldSession = join(sandbox.tempClaude, slug, 'old-session');
    await write(join(oldSession, 'scratchpad', 'notes.md'), 'velho');
    await age(join(oldSession, 'scratchpad', 'notes.md'), 10);
    await age(join(oldSession, 'scratchpad'), 10);
    await age(oldSession, 10);
    await write(join(sandbox.tempClaude, slug, 'fresh-session', 'scratchpad', 'notes.md'), 'novo');
    const worktreeScratch = join(sandbox.tempClaude, `${slug}-wt-x`);
    await write(join(worktreeScratch, 'f.txt'), 'velho');
    await age(join(worktreeScratch, 'f.txt'), 9);
    await age(worktreeScratch, 9);

    run = await sweep(sandbox);
    const archive = join(sandbox.seazone, '_archive');
    folder = join(archive, `faxina-${localDay(Date.now())}`);
  }, 120_000);

  afterAll(async () => {
    await sandbox.cleanup();
  });

  it('ends well, stamps the sweep, and the bubble gets the folder', () => {
    expect(run.summary.failed).toBe(false);
    expect(run.summary.folder).toBe(folder);
    expect(run.stamps).toHaveLength(1);
    expect(run.summary.freedBytes).toBeGreaterThan(2000);
    expect(run.summary.worktreesRemoved).toBe(1);
    expect(run.summary.branchesDeleted).toBe(3);
  });

  it('removes the merged worktree but leaves the main checkout through the junction intact (CA-1)', async () => {
    expect(await exists(join(sandbox.seazone, 'atlas-wt', 'merged'))).toBe(false);
    expect(await fs.readFile(join(repo, 'node_modules', 'keep.txt'), 'utf8')).toBe('nao pode sumir');
    expect(git(repo, 'worktree', 'list')).not.toContain('merged');
  });

  it('keeps the dirty worktree, the one with a local commit and the channel', async () => {
    expect(await exists(join(sandbox.seazone, 'atlas-wt', 'dirty', 'solto.txt'))).toBe(true);
    expect(await exists(join(sandbox.seazone, 'atlas-wt', 'local', 'novo.txt'))).toBe(true);
    expect(await exists(join(sandbox.seazone, 'atlas-alfa'))).toBe(true);
    const list = git(repo, 'worktree', 'list');
    for (const name of ['dirty', 'local', 'atlas-alfa']) expect(list).toContain(name);
  });

  it('keeps the parent of the worktrees while it is not empty', async () => {
    expect(await exists(join(sandbox.seazone, 'atlas-wt'))).toBe(true);
  });

  it('deletes the branches that are in staging, were squashed in, or are published at the same SHA, and nothing else (CA-2)', () => {
    const branches = git(repo, 'branch', '--format=%(refname:short)').split(/\r?\n/);
    expect(branches).not.toContain('old1');
    expect(branches).not.toContain('squashed');
    expect(branches).not.toContain('pub');
    for (const kept of ['wip', 'staging', 'backup/x', 'feature/dirty', 'feature/local', 'channel/alfa', 'docs/merged']) {
      // docs/merged: its worktree went, but the branch was checked out when judged, so it stays for a next sweep
      expect(branches).toContain(kept);
    }
  });

  it('writes the receipt with name and SHA, and the line brings the branch back', async () => {
    const receipt = await fs.readFile(join(folder, 'atlas', 'branches-apagadas.txt'), 'utf8');
    const lines = receipt.trim().split(/\r?\n/).sort();
    expect(lines).toEqual([`old1 ${shas.old1}`, `pub ${shas.pub}`, `squashed ${shas.squashed}`].sort());
    git(repo, 'branch', 'old1', shas.old1 as string);
    expect(git(repo, 'rev-parse', 'old1')).toBe(shas.old1);
  });

  it('deletes the regenerable output that git does not track (CA-3) and nothing the repo owns', async () => {
    for (const gone of ['test-results', join('tests', 'smoke', '.playwright-cli'), 'Microsoft', join('prototypes', 'p1', 'node_modules'), join('prototypes', 'p1', 'dist')]) {
      expect(await exists(join(repo, gone))).toBe(false);
    }
    expect(await exists(join(repo, '.e2e-visual', 'tracked.txt'))).toBe(true);
    expect(await exists(join(repo, 'node_modules', 'keep.txt'))).toBe(true);
    expect(await exists(join(repo, 'probe-chat', 'test-results', 'x.txt'))).toBe(true);
    expect(await exists(join(repo, 'prototypes', 'p1', 'src', 'a.txt'))).toBe(true);
    expect(await exists(join(repo, 'README.md'))).toBe(true);
    expect(git(repo, 'status', '--porcelain', '--', 'README.md', '.gitignore')).toBe('');
  });

  it('deletes the old installers and their blockmaps, keeps the newest', async () => {
    expect(await exists(join(repo, 'release', 'Donel-Setup-0.3.0.exe'))).toBe(false);
    expect(await exists(join(repo, 'release', 'Donel-Setup-0.3.0.exe.blockmap'))).toBe(false);
    expect(await exists(join(repo, 'release', 'Donel-Setup-0.4.0.exe'))).toBe(true);
    expect(await exists(join(repo, 'release', 'Donel-Setup-0.4.0.exe.blockmap'))).toBe(true);
  });

  it('deletes the stale scratchpads, session by session in the slug folder and whole in the worktree one', async () => {
    expect(await exists(join(sandbox.tempClaude, slug, 'old-session'))).toBe(false);
    expect(await exists(join(sandbox.tempClaude, slug, 'fresh-session', 'scratchpad', 'notes.md'))).toBe(true);
    expect(await exists(join(sandbox.tempClaude, slug))).toBe(true);
    expect(await exists(join(sandbox.tempClaude, `${slug}-wt-x`))).toBe(false);
  });

  it('moves the dead session into the folder and leaves the others where they are (CA-4)', async () => {
    expect(await exists(join(folder, 'atlas', 'sessoes-claude', 'C--box-atlas-wt-gone', 's1.jsonl'))).toBe(true);
    expect(await exists(join(sandbox.claudeProjects, 'C--box-atlas-wt-gone'))).toBe(false);
    for (const stays of ['C--box-atlas-alive', 'C--box-nobody', 'C--box-unplugged']) {
      expect(await exists(join(sandbox.claudeProjects, stays, 's1.jsonl'))).toBe(true);
    }
  });

  it('moves the old untracked .esteira file keeping its path, and leaves the fresh and the tracked ones', async () => {
    expect(await fs.readFile(join(folder, 'atlas', '.esteira', 'old', 'handoff.md'), 'utf8')).toBe('handoff de item concluido');
    expect(await exists(join(repo, '.esteira', 'old', 'handoff.md'))).toBe(false);
    expect(await exists(join(repo, '.esteira', 'fresh.md'))).toBe(true);
    expect(await exists(join(repo, '.esteira', 'tracked.md'))).toBe(true);
  });

  it('writes a self-contained resumo.html that tells what happened and what was left', async () => {
    const html = await fs.readFile(join(folder, SUMMARY_FILE), 'utf8');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('C--box-atlas-wt-gone');
    expect(html).toContain('git branch old1 ' + shas.old1);
    expect(html).toContain('mudança não commitada');
    expect(html).toContain('canal instalado');
    expect(html).toContain('commit que só existe aqui');
    expect(html).toContain('wip');
    expect(html).toContain('backup/x');
    expect(html).toContain('test-results');
  });

  it('left the integration branch where it was', () => {
    expect(git(repo, 'rev-parse', 'staging')).toBe(stagingSha);
  });

  it('logged the run', () => {
    expect(run.logs.some((line) => line.includes('1 repos conhecidos'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The smaller ones
// ---------------------------------------------------------------------------

describe('the sweep folder and the stamp', () => {
  let sandbox: Sandbox;
  beforeAll(async () => {
    sandbox = await createSandbox();
  });
  afterAll(async () => {
    await sandbox.cleanup();
  });

  it('a second sweep the same day takes "-2" and never touches the first (CA-5)', async () => {
    const repo = await createRepo(sandbox, 'atlas');
    await jsonlSession(sandbox, 'C--box-atlas-wt-one', join(sandbox.seazone, 'atlas-wt', 'one'));
    const first = await sweep(sandbox);
    await jsonlSession(sandbox, 'C--box-atlas-wt-two', join(sandbox.seazone, 'atlas-wt', 'two'));
    const second = await sweep(sandbox);
    const day = localDay(Date.now());
    expect(first.summary.folder).toBe(join(sandbox.seazone, '_archive', `faxina-${day}`));
    expect(second.summary.folder).toBe(join(sandbox.seazone, '_archive', `faxina-${day}-2`));
    expect(await exists(join(first.summary.folder as string, 'atlas', 'sessoes-claude', 'C--box-atlas-wt-one'))).toBe(true);
    expect(await exists(join(second.summary.folder as string, 'atlas', 'sessoes-claude', 'C--box-atlas-wt-two'))).toBe(true);
    expect(await exists(repo)).toBe(true);
  }, 60_000);

  it('with a stamp newer than any work, no repo is swept: "nada a limpar", no folder, and the stamp moves (CA-6)', async () => {
    await createRepo(sandbox, 'vega');
    await write(join(sandbox.seazone, 'vega', 'test-results', 'a.txt'), 'x'); // would be cleaned if vega were looked at
    const stamp = Date.now() + 60_000;
    const before = await fs.readdir(join(sandbox.seazone, '_archive'));
    const run = await sweep(sandbox, { getLastSweepAt: () => stamp });
    expect(run.summary).toMatchObject({ failed: false, freedBytes: 0, separatedItems: 0, branchesDeleted: 0, worktreesRemoved: 0, folder: null });
    expect(await exists(join(sandbox.seazone, 'vega', 'test-results', 'a.txt'))).toBe(true);
    expect(await fs.readdir(join(sandbox.seazone, '_archive'))).toEqual(before);
    expect(run.stamps).toHaveLength(1);
  }, 60_000);

  it('only the repo with work after the stamp is swept: a transcript newer than it selects its repo, and the other stays untouched', async () => {
    const orion = await createRepo(sandbox, 'orion');
    const lyra = await createRepo(sandbox, 'lyra');
    await write(join(orion, 'test-results', 'a.txt'), 'x');
    await write(join(lyra, 'test-results', 'a.txt'), 'x');
    const stamp = Date.now() + 5_000; // after every commit made so far
    await jsonlSession(sandbox, 'C--box-orion', orion);
    const later = new Date(stamp + 5_000);
    await fs.utimes(join(sandbox.claudeProjects, 'C--box-orion', 's1.jsonl'), later, later);
    const run = await sweep(sandbox, { getLastSweepAt: () => stamp });
    expect(run.summary.failed).toBe(false);
    expect(await exists(join(orion, 'test-results'))).toBe(false);
    expect(await exists(join(lyra, 'test-results', 'a.txt'))).toBe(true);
  }, 60_000);

  it('a repo with a commit after the stamp is selected by the reflog, with no transcript at all', async () => {
    const nova = await createRepo(sandbox, 'nova');
    await write(join(nova, 'test-results', 'a.txt'), 'x');
    const stamp = Date.now() - 60_000; // the commit of createRepo is newer than this
    const run = await sweep(sandbox, { getLastSweepAt: () => stamp });
    expect(run.summary.failed).toBe(false);
    expect(await exists(join(nova, 'test-results'))).toBe(false);
  }, 60_000);
});

describe('repos without origin, with a broken origin, and the failure of the whole sweep', () => {
  let sandbox: Sandbox;
  beforeAll(async () => {
    sandbox = await createSandbox();
  });
  afterAll(async () => {
    await sandbox.cleanup();
  });

  it('a repo with no remote at all is swept (local rules only) and no fetch error is invented', async () => {
    const repo = await createRepo(sandbox, 'solo', { withOrigin: false });
    await write(join(repo, 'test-results', 'a.txt'), 'x');
    git(repo, 'branch', 'old');
    const run = await sweep(sandbox);
    expect(run.summary.failed).toBe(false);
    expect(await exists(join(repo, 'test-results'))).toBe(false);
    // no integration branch and no remote: a branch cannot be proven merged, so it stays
    expect(git(repo, 'branch', '--format=%(refname:short)')).toContain('old');
  }, 60_000);

  it('a failed fetch is said in the summary and the sweep goes on with what is local', async () => {
    const repo = await createRepo(sandbox, 'broken');
    await write(join(repo, 'test-results', 'a.txt'), 'x');
    await jsonlSession(sandbox, 'C--box-broken-wt-gone', join(sandbox.seazone, 'broken-wt', 'gone')); // gives the sweep a folder and a summary
    git(repo, 'remote', 'set-url', 'origin', join(sandbox.root, 'does-not-exist.git'));
    const run = await sweep(sandbox);
    expect(run.summary.failed).toBe(false);
    expect(await exists(join(repo, 'test-results'))).toBe(false);
    const html = await fs.readFile(join(run.summary.folder as string, SUMMARY_FILE), 'utf8');
    expect(html).toContain('git fetch falhou');
  }, 60_000);

  it('a failure of the whole sweep is a summary with failed: true, a log line, and no stamp (D10)', async () => {
    const run = await sweep(sandbox, {
      getRoots: () => {
        throw new Error('config quebrada');
      },
    });
    expect(run.summary).toMatchObject({ failed: true, folder: null });
    expect(run.stamps).toEqual([]);
    expect(run.logs.join('\n')).toContain('config quebrada');
  });

  it('a log that throws does not fail the sweep', async () => {
    const run = await sweep(sandbox, {
      log: () => {
        throw new Error('disco cheio');
      },
    });
    expect(run.summary.failed).toBe(false);
  }, 60_000);
});
