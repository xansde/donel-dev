// 016-jobu-faxina (T009) - which repos the sweep looks at. Known repos = the git repos found under the roots of the sidebar
// plus the ones the transcripts were made in. A repo enters a sweep when it had work since the last one: a transcript
// written after it (cwd in the repo or in a worktree of it), or an entry in the reflog of HEAD or of a local branch.
// Without a stamp (`lastSweepAt` null) every known repo enters.

import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { ClaudeProjectFolder } from './claude-projects';
import { mapLimit, pathExists } from './fs-utils';
import type { GitRun } from './git';
import { latestReflogMs } from './git-parse';
import { comparablePath, ownerRepo } from './names';

const SKIPPED_DIR_NAMES = new Set(['node_modules', '_archive']);

async function subdirectories(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIR_NAMES.has(entry.name))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

/** A real repo has a `.git` FOLDER; a `.git` file is a worktree, which belongs to the repo that owns it. */
async function isRepoRoot(dir: string): Promise<boolean> {
  try {
    return (await fs.lstat(join(dir, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

/** The repos under the roots, like the scanner of the sidebar sees them: two levels deep, a repo ends the descent. */
export async function discoverReposInRoots(roots: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    for (const first of await subdirectories(root)) {
      if (await isRepoRoot(first)) {
        found.push(first);
        continue;
      }
      for (const second of await subdirectories(first)) if (await isRepoRoot(second)) found.push(second);
    }
  }
  return found;
}

/** The main checkout a directory belongs to (it may be a worktree), or `null` when it is not in a git repo. */
export async function repoOfDirectory(git: GitRun, dir: string): Promise<string | null> {
  if (!(await pathExists(dir))) return null;
  const result = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (result.code !== 0) return null;
  const common = resolve(result.stdout.trim());
  return basename(common).toLowerCase() === '.git' ? dirname(common) : null;
}

/** The same path once, whatever the case or the slashes. The first spelling wins. */
export function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = comparablePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

/** Roots of the sidebar plus the repos behind the `cwd` of the transcripts. Only repos that exist. */
export async function findKnownRepos(git: GitRun, roots: readonly string[], folders: readonly ClaudeProjectFolder[]): Promise<string[]> {
  const fromRoots = await discoverReposInRoots(roots);
  const cwds = dedupePaths(folders.flatMap((folder) => (folder.cwd === null ? [] : [folder.cwd])));
  const fromTranscripts = (await mapLimit(cwds, 6, (cwd) => repoOfDirectory(git, cwd))).flatMap((repo) => (repo === null ? [] : [repo]));
  const known = dedupePaths([...fromRoots, ...fromTranscripts]);
  const existing: string[] = [];
  for (const repo of known) if (await isRepoRoot(repo)) existing.push(repo);
  return existing;
}

/** The newest transcript write per repo (cwd in the repo or in a worktree of it). Pure. */
export function transcriptActivity(folders: readonly ClaudeProjectFolder[], repos: readonly string[]): Map<string, number> {
  const latest = new Map<string, number>();
  const owners = repos.map((path) => ({ path }));
  for (const folder of folders) {
    if (folder.cwd === null || folder.newestTranscriptMs <= 0) continue;
    const owner = ownerRepo(folder.cwd, owners);
    if (owner === null) continue;
    latest.set(owner, Math.max(latest.get(owner) ?? 0, folder.newestTranscriptMs));
  }
  return latest;
}

/** When something last happened in the reflog of HEAD or of a local branch of the repo (epoch ms), or `null`. */
export async function latestGitActivityMs(git: GitRun, repoPath: string): Promise<number | null> {
  const head = await git(repoPath, ['reflog', 'show', '--date=unix', '--format=%gd', '-n', '200', 'HEAD']);
  const branches = await git(repoPath, ['log', '-g', '--date=unix', '--format=%gd', '-n', '500', '--glob=refs/heads/*']);
  const times = [head.code === 0 ? latestReflogMs(head.stdout) : null, branches.code === 0 ? latestReflogMs(branches.stdout) : null];
  const found = times.filter((time): time is number => time !== null);
  return found.length === 0 ? null : Math.max(...found);
}

/**
 * The repos that had work since `lastSweepAt`. With no stamp, all of them. `gitActivity` is looked up only for the repos
 * the transcripts did not already settle.
 */
export async function selectActiveRepos(
  repos: readonly string[],
  lastSweepAt: number | null,
  transcriptLatest: ReadonlyMap<string, number>,
  gitActivity: (repoPath: string) => Promise<number | null>,
): Promise<string[]> {
  if (lastSweepAt === null) return [...repos];
  const active: string[] = [];
  for (const repo of repos) {
    if ((transcriptLatest.get(repo) ?? 0) > lastSweepAt) {
      active.push(repo);
      continue;
    }
    const git = await gitActivity(repo);
    if (git !== null && git > lastSweepAt) active.push(repo);
  }
  return active;
}
