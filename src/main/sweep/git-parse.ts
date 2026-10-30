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
  /** The text after `locked ` (`git worktree lock --reason`); `null` when unlocked or locked without a reason. */
  readonly lockReason: string | null;
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
    let lockReason: string | null = null;
    let prunable = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === 'bare') bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true;
        lockReason = line.length > 'locked '.length ? line.slice('locked '.length).trim() || null : null;
      }
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
    }
    result.push({ path: resolve(first.slice('worktree '.length).trim()), head, branch, bare, locked, lockReason, prunable });
  }
  return result;
}

/**
 * The lock the CLI puts on a worktree it created (`claude --worktree`, agents, background sessions):
 * `claude session <name> (pid <pid>)`, measured with CLI 2.1.314. A killed session leaves it behind, so the pid is
 * what tells a live session from a stale lock. `null` for any other lock (the owner's own, another tool's).
 */
export function parseClaudeSessionLock(reason: string | null): { readonly name: string; readonly pid: number } | null {
  if (reason === null) return null;
  const match = /^claude session (.+) \(pid (\d+)\)$/.exec(reason.trim());
  if (match === null) return null;
  const pid = Number.parseInt(match[2] ?? '', 10);
  return Number.isSafeInteger(pid) && pid > 0 ? { name: match[1] ?? '', pid } : null;
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
