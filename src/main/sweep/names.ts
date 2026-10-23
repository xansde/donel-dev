// 016-jobu-faxina (T003) - the naming rules of the sweep, pure: the slug Claude gives the folders of a repo, who owns a
// path that is gone from the disk, the name of the sweep folder and of the subfolder of each repo, and where
// `_archive` lives.

import { basename, dirname } from 'node:path';

/**
 * The folder name Claude derives from a path (`C:\Users\x\seazone\app` -> `C--Users-x-seazone-app`), used under
 * `~/.claude/projects` and `%TEMP%/claude`. The first form changes only ":", "\" and "/"; the second turns every
 * non-alphanumeric into "-" (what the CLI does with spaces, accents and dots). One entry when they are equal.
 */
export function repoSlugs(repoPath: string): string[] {
  const narrow = repoPath.replace(/[:\\/]/g, '-');
  const wide = repoPath.replace(/[^A-Za-z0-9]/g, '-');
  return narrow === wide ? [narrow] : [narrow, wide];
}

/** For comparing paths on Windows: lower case, one kind of slash, no trailing slash. */
export function comparablePath(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

const SCORE_INSIDE = 3_000_000;
const SCORE_SIBLING = 2_000_000;
const SCORE_SLUG = 1_000_000;

/**
 * Which known repo a path belongs to, when the path itself may be gone (a removed worktree, a scratchpad): inside
 * the repo; a sibling folder named `<repo>-...` (the worktree folders); or a path that carries the slug of the repo
 * (the scratchpads in %TEMP%). The longest match wins, so `app-publico` is never taken for `app`. `null` = nobody's.
 */
export function ownerRepo(cwd: string, repos: readonly { readonly path: string }[]): string | null {
  const target = comparablePath(cwd);
  let best: { readonly path: string; readonly score: number } | null = null;
  for (const repo of repos) {
    const base = comparablePath(repo.path);
    let score = 0;
    if (target === base || target.startsWith(`${base}/`)) score = SCORE_INSIDE + base.length;
    else if (target.startsWith(`${base}-`)) score = SCORE_SIBLING + base.length;
    else {
      for (const slug of repoSlugs(repo.path)) {
        const needle = slug.toLowerCase();
        if (target.includes(needle)) score = Math.max(score, SCORE_SLUG + needle.length);
      }
    }
    if (score > 0 && (best === null || score > best.score)) best = { path: repo.path, score };
  }
  return best === null ? null : best.path;
}

/** `faxina-AAAA-MM-DD`, and `-2`, `-3`... when that name is taken (the app never deletes a sweep folder). */
export function nextSweepFolderName(day: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  const first = `faxina-${day}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${first}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The LOCAL date `AAAA-MM-DD` of an instant. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The subfolder of each repo inside the sweep folder, in the order given: its own name, and `-2`... when two repos share one. */
export function repoFolderNames(repoPaths: readonly string[]): string[] {
  const used = new Map<string, number>();
  return repoPaths.map((path) => {
    const base = basename(path);
    const count = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/** `_archive` goes next to the repos: the parent folder most of them share (the first one wins a tie). */
export function chooseArchiveParent(repoPaths: readonly string[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const path of repoPaths) {
    const parent = dirname(path);
    if (!counts.has(parent)) order.push(parent);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best = order[0] ?? '';
  for (const parent of order) if ((counts.get(parent) ?? 0) > (counts.get(best) ?? 0)) best = parent;
  return best;
}

/** `dd/mm/aaaa`, local time: how dates read in the summary and in the reasons. */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}
