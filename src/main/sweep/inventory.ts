// 016-jobu-faxina (T008) - the inventory of ONE repo: read-only (a `git fetch` aside), it measures what the plan needs and
// decides nothing. Every git call goes through the injected `GitRun`; the filesystem is read with `fs/promises`.
// What comes out is `RepoFacts` (types.ts); `planRepo` (plan.ts) turns it into actions.

import { promises as fs } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ClaudeProjectFolder } from './claude-projects';
import { isGone, mapLimit, measure, pathExists } from './fs-utils';
import { firstLine, type GitRun } from './git';
import { cherryIsClean, parseBranchList, parseWorktreeList, splitNul } from './git-parse';
import { ownerRepo, repoSlugs } from './names';
import type { BranchFact, InstallerFact, JunkFact, RepoFacts, ScratchEntryFact, SessionFolderFact, UntrackedFileFact, WorktreeFact } from './types';

export interface InventoryContext {
  readonly git: GitRun;
  /** `%TEMP%/claude`. */
  readonly tempClaudeDir: string;
  /** Every known repo (for telling whose a dead session or a scratchpad is). */
  readonly knownRepos: readonly string[];
  /** The result of `scanClaudeProjects`, shared by all repos of the sweep. */
  readonly claudeFolders: readonly ClaudeProjectFolder[];
}

const INTEGRATION_CANDIDATES = ['origin/staging', 'origin/dev', 'origin/main', 'origin/master'] as const;
/** Branches the plan never looks into; their facts are filled with defaults and no git call is spent on them. */
const UNANALYZED_BRANCHES = new Set(['main', 'master', 'staging', 'dev']);
const OUTPUT_DIR_NAMES = new Set(['test-results', '.e2e-visual', '.tutorial-shots', '.playwright-cli']);
const MAX_WALK_DEPTH = 6;
const GIT_PARALLELISM = 6;

// ---------------------------------------------------------------------------
// Git probes
// ---------------------------------------------------------------------------

async function revParse(git: GitRun, cwd: string, ref: string): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : null;
}

async function findIntegrationRef(git: GitRun, repoPath: string): Promise<string | null> {
  for (const candidate of INTEGRATION_CANDIDATES) {
    if ((await revParse(git, repoPath, `refs/remotes/${candidate}`)) !== null) return candidate;
  }
  return null;
}

/** `git fetch origin`, only when there is an `origin`. The reason it failed, or `null`. */
async function fetchOrigin(git: GitRun, repoPath: string): Promise<string | null> {
  const remotes = await git(repoPath, ['remote']);
  if (remotes.code !== 0 || !remotes.stdout.split(/\r?\n/).map((line) => line.trim()).includes('origin')) return null;
  const result = await git(repoPath, ['fetch', 'origin'], { timeoutMs: 120_000 });
  return result.code === 0 ? null : firstLine(result.stderr) || `código ${result.code}`;
}

async function isAncestor(git: GitRun, repoPath: string, commit: string, of: string): Promise<boolean> {
  return (await git(repoPath, ['merge-base', '--is-ancestor', commit, of])).code === 0;
}

// ---------------------------------------------------------------------------
// Worktrees and branches
// ---------------------------------------------------------------------------

async function inventoryWorktrees(ctx: InventoryContext, repoPath: string, integrationRef: string | null): Promise<WorktreeFact[]> {
  const listed = await ctx.git(repoPath, ['worktree', 'list', '--porcelain']);
  if (listed.code !== 0) return [];
  return mapLimit(parseWorktreeList(listed.stdout), GIT_PARALLELISM, async (entry, index): Promise<WorktreeFact> => {
    const base = { path: entry.path, branch: entry.branch, head: entry.head, isMain: index === 0 || entry.bare, locked: entry.locked };
    if (base.isMain) return { ...base, missing: false, clean: true, headInIntegration: false, headEqualsRemote: false };
    if (!(await pathExists(entry.path))) return { ...base, missing: true, clean: false, headInIntegration: false, headEqualsRemote: false };
    const status = await ctx.git(entry.path, ['status', '--porcelain']);
    const clean = status.code === 0 && status.stdout.trim() === '';
    const headInIntegration = integrationRef !== null && entry.head !== '' && (await isAncestor(ctx.git, repoPath, entry.head, integrationRef));
    const remoteSha = entry.branch === null ? null : await revParse(ctx.git, repoPath, `refs/remotes/origin/${entry.branch}`);
    return { ...base, missing: false, clean, headInIntegration, headEqualsRemote: remoteSha !== null && remoteSha === entry.head };
  });
}

async function inventoryBranches(ctx: InventoryContext, repoPath: string, integrationRef: string | null, checkedOut: ReadonlySet<string>): Promise<BranchFact[]> {
  const listed = await ctx.git(repoPath, ['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)', 'refs/heads']);
  if (listed.code !== 0) return [];
  return mapLimit(parseBranchList(listed.stdout), GIT_PARALLELISM, async (entry): Promise<BranchFact> => {
    const base = { name: entry.name, sha: entry.sha, checkedOut: checkedOut.has(entry.name), lastCommitMs: entry.committedMs };
    const skipped = UNANALYZED_BRANCHES.has(entry.name) || entry.name.startsWith('backup/') || base.checkedOut;
    if (skipped) return { ...base, ancestorOfIntegration: false, cherryClean: false, publishedSameSha: false, onlyHereCount: 0 };

    const ref = `refs/heads/${entry.name}`;
    const ancestorOfIntegration = integrationRef !== null && (await isAncestor(ctx.git, repoPath, ref, integrationRef));
    let cherryClean = ancestorOfIntegration;
    if (integrationRef !== null && !ancestorOfIntegration) {
      const cherry = await ctx.git(repoPath, ['cherry', integrationRef, ref]);
      cherryClean = cherry.code === 0 && cherryIsClean(cherry.stdout);
    }
    const remoteSha = await revParse(ctx.git, repoPath, `refs/remotes/origin/${entry.name}`);
    const publishedSameSha = remoteSha !== null && remoteSha === entry.sha;

    let onlyHereCount = 0;
    if (!ancestorOfIntegration && !cherryClean && !publishedSameSha) {
      const counted = await ctx.git(repoPath, ['rev-list', '--count', ref, '--not', ...(integrationRef === null ? [] : [integrationRef]), '--remotes']);
      const parsed = Number.parseInt(counted.stdout.trim(), 10);
      onlyHereCount = counted.code === 0 && Number.isFinite(parsed) ? parsed : 0;
    }
    return { ...base, ancestorOfIntegration, cherryClean, publishedSameSha, onlyHereCount };
  });
}

// ---------------------------------------------------------------------------
// Tracked files
// ---------------------------------------------------------------------------

interface TrackedIndex {
  isTracked(relPath: string): boolean;
}

/** One `git ls-files` for the whole repo: a path is tracked when it is a tracked file or holds one. */
async function trackedIndex(git: GitRun, repoPath: string): Promise<TrackedIndex> {
  const result = await git(repoPath, ['ls-files', '-z']);
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const file of splitNul(result.code === 0 ? result.stdout : '')) {
    files.add(file);
    let at = file.lastIndexOf('/');
    while (at > 0) {
      const folder = file.slice(0, at);
      if (folders.has(folder)) break;
      folders.add(folder);
      at = folder.lastIndexOf('/');
    }
  }
  // When git could not list (broken repo), nothing is deleted: everything counts as tracked.
  const unknown = result.code !== 0;
  return { isTracked: (relPath) => unknown || files.has(relPath) || folders.has(relPath) };
}

// ---------------------------------------------------------------------------
// Regenerable output and installers
// ---------------------------------------------------------------------------

/** Walks the main checkout looking for the output directories by name. Does not enter node_modules, .git, nested repos or worktrees. */
async function findOutputDirs(repoPath: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // links are not directories here: never entered
      const path = join(dir, entry.name);
      if (OUTPUT_DIR_NAMES.has(entry.name)) {
        found.push(path);
        continue;
      }
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('probe-')) continue;
      if (depth >= MAX_WALK_DEPTH) continue;
      if (await pathExists(join(path, '.git'))) continue; // another repo or a worktree nested here
      await walk(path, depth + 1);
    }
  };
  await walk(repoPath, 0);
  return found;
}

async function inventoryJunk(repoPath: string, tracked: TrackedIndex): Promise<JunkFact[]> {
  const candidates: { path: string; kind: JunkFact['kind'] }[] = [];
  for (const path of await findOutputDirs(repoPath)) candidates.push({ path, kind: 'output-dir' });

  const microsoft = join(repoPath, 'Microsoft');
  try {
    if ((await fs.lstat(microsoft)).isDirectory()) candidates.push({ path: microsoft, kind: 'stray-cache' });
  } catch {
    // no such folder
  }

  const prototypes = join(repoPath, 'prototypes');
  try {
    for (const entry of await fs.readdir(prototypes, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const [name, kind] of [['node_modules', 'prototype-modules'], ['dist', 'prototype-dist']] as const) {
        const path = join(prototypes, entry.name, name);
        try {
          if ((await fs.lstat(path)).isDirectory()) candidates.push({ path, kind });
        } catch {
          // not there
        }
      }
    }
  } catch {
    // no prototypes folder
  }

  return mapLimit(candidates, 4, async ({ path, kind }): Promise<JunkFact> => {
    const relPath = relative(repoPath, path).replace(/\\/g, '/');
    return { relPath, absPath: path, kind, bytes: (await measure(path)).bytes, tracked: tracked.isTracked(relPath) };
  });
}

async function inventoryInstallers(repoPath: string, tracked: TrackedIndex): Promise<InstallerFact[]> {
  const dir = join(repoPath, 'release');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const facts: InstallerFact[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absPath = join(dir, entry.name);
    try {
      facts.push({ name: entry.name, absPath, bytes: (await fs.stat(absPath)).size, tracked: tracked.isTracked(`release/${entry.name}`) });
    } catch {
      // vanished
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Scratchpads, sessions, .esteira
// ---------------------------------------------------------------------------

/** Does the folder `name` of %TEMP%/claude belong to this repo (and not to a known repo with a longer slug)? */
function scratchBelongsTo(name: string, repoPath: string, knownRepos: readonly string[]): { readonly own: boolean; readonly wholeSlug: boolean } {
  const matches = (slug: string): boolean => name === slug || name.startsWith(`${slug}-`);
  const mine = repoSlugs(repoPath).filter(matches).sort((a, b) => b.length - a.length)[0];
  if (mine === undefined) return { own: false, wholeSlug: false };
  const longerOwner = knownRepos.some((other) => other !== repoPath && repoSlugs(other).some((slug) => slug.length > mine.length && matches(slug)));
  return { own: !longerOwner, wholeSlug: name === mine };
}

async function inventoryScratchpads(ctx: InventoryContext, repoPath: string): Promise<ScratchEntryFact[]> {
  let names: string[];
  try {
    names = await fs.readdir(ctx.tempClaudeDir);
  } catch {
    return [];
  }
  const facts: ScratchEntryFact[] = [];
  for (const name of names) {
    const verdict = scratchBelongsTo(name, repoPath, ctx.knownRepos);
    if (!verdict.own) continue;
    const dir = join(ctx.tempClaudeDir, name);
    // The folder of the slug itself holds one subfolder per session: each is judged alone. The others (`<slug>-wt-*`) go whole.
    const targets = verdict.wholeSlug ? (await fs.readdir(dir).catch(() => [])).map((child) => ({ path: join(dir, child), label: `${name}/${child}` })) : [{ path: dir, label: name }];
    for (const target of targets) {
      const measured = await measure(target.path);
      if (measured.newestMs === 0) continue; // vanished while measuring
      facts.push({ absPath: target.path, label: target.label, bytes: measured.bytes, newestWriteMs: measured.newestMs });
    }
  }
  return facts;
}

async function inventorySessions(ctx: InventoryContext, repoPath: string): Promise<SessionFolderFact[]> {
  const owners = ctx.knownRepos.map((path) => ({ path }));
  const facts: SessionFolderFact[] = [];
  for (const folder of ctx.claudeFolders) {
    if (folder.cwd === null || ownerRepo(folder.cwd, owners) !== repoPath) continue;
    if (!(await isGone(folder.cwd))) continue;
    const measured = await measure(folder.absPath);
    facts.push({ name: folder.name, absPath: folder.absPath, cwd: folder.cwd, cwdGone: true, owner: repoPath, bytes: measured.bytes, mtimeMs: measured.newestMs || folder.newestTranscriptMs });
  }
  return facts;
}

async function inventoryEsteira(ctx: InventoryContext, repoPath: string): Promise<UntrackedFileFact[]> {
  const result = await ctx.git(repoPath, ['ls-files', '-z', '--others', '--exclude-standard', '--', '.esteira']);
  if (result.code !== 0) return [];
  const facts: UntrackedFileFact[] = [];
  for (const relPath of splitNul(result.stdout)) {
    const absPath = join(repoPath, ...relPath.split('/'));
    try {
      const stats = await fs.lstat(absPath);
      if (stats.isFile()) facts.push({ relPath, absPath, bytes: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // listed but gone
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

export async function collectRepoFacts(ctx: InventoryContext, repoPath: string): Promise<RepoFacts> {
  const fetchError = await fetchOrigin(ctx.git, repoPath);
  const integrationRef = await findIntegrationRef(ctx.git, repoPath);
  const worktrees = await inventoryWorktrees(ctx, repoPath, integrationRef);
  const checkedOut = new Set(worktrees.flatMap((worktree) => (worktree.branch === null ? [] : [worktree.branch])));
  const branches = await inventoryBranches(ctx, repoPath, integrationRef, checkedOut);
  const tracked = await trackedIndex(ctx.git, repoPath);
  return {
    repoPath,
    repoName: basename(repoPath),
    integrationRef,
    fetchError,
    worktrees,
    branches,
    junk: await inventoryJunk(repoPath, tracked),
    installers: await inventoryInstallers(repoPath, tracked),
    scratchpads: await inventoryScratchpads(ctx, repoPath),
    sessions: await inventorySessions(ctx, repoPath),
    esteiraFiles: await inventoryEsteira(ctx, repoPath),
  };
}
