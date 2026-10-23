// 016-jobu-faxina (T008) - parsing of the git outputs the inventory reads. Pure.

import { resolve } from 'node:path';

export interface ListedWorktree {
  /** Absolute path in the form of the OS (git prints it with "/"). */
  readonly path: string;
  readonly head: string;
  /** Short branch name; `null` for a detached HEAD or a bare entry. */
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** `git worktree list --porcelain`: blocks separated by a blank line, the first one being the main checkout. */
export function parseWorktreeList(stdout: string): ListedWorktree[] {
  const result: ListedWorktree[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line !== '');
    const first = lines[0];
    if (first === undefined || !first.startsWith('worktree ')) continue;
    let head = '';
    let branch: string | null = null;
    let bare = false;
    let locked = false;
    let prunable = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === 'bare') bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) locked = true;
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
    }
    result.push({ path: resolve(first.slice('worktree '.length).trim()), head, branch, bare, locked, prunable });
  }
  return result;
}

export interface ListedBranch {
  readonly name: string;
  readonly sha: string;
  /** Committer date of the tip, epoch ms. */
  readonly committedMs: number;
}

/** `git for-each-ref --format=%(refname:short)%09%(objectname)%09%(committerdate:unix) refs/heads`. */
export function parseBranchList(stdout: string): ListedBranch[] {
  const result: ListedBranch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [name, sha, unix] = line.split('\t');
    if (name === undefined || name === '' || sha === undefined || sha === '') continue;
    const seconds = Number.parseInt(unix ?? '', 10);
    result.push({ name, sha, committedMs: Number.isFinite(seconds) ? seconds * 1000 : 0 });
  }
  return result;
}

/** `git cherry`: a line starting with "+" is a patch that is not in the other branch yet. */
export function cherryIsClean(stdout: string): boolean {
  return !stdout.split(/\r?\n/).some((line) => line.startsWith('+'));
}

/** NUL-separated output (`-z`) as a list, without the empty tail. */
export function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter((entry) => entry !== '');
}

/** The largest `@{<unix>}` timestamp in `git reflog --date=unix --format=%gd` output, in ms; `null` with none. */
export function latestReflogMs(stdout: string): number | null {
  let latest: number | null = null;
  for (const match of stdout.matchAll(/@\{(\d+)\}/g)) {
    const ms = Number.parseInt(match[1] ?? '', 10) * 1000;
    if (Number.isFinite(ms) && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}
