// "Isolar em worktree" (Launcher, uso geral) — what happens to the worktree of a session when its TAB is closed.
//
// The CLI creates the worktree (`claude --worktree <name>`: `<main repo>/.claude/worktrees/<name>`, branch
// `worktree-<name>`, locked as `claude session <name> (pid <pid>)`) and cleans it up itself on a clean `/exit`. Closing
// the tab KILLS the process instead, and then nothing is cleaned and the lock stays: that is how the folders pile up.
// So, after the owner closes the tab, this module:
//
//   inspect (git, read-only)  ->  SessionWorktreeFacts  ->  decideSessionWorktreeRelease (pure)  ->  execute
//
// The rule (decision of the owner, 30/10): remove only what holds no work. A worktree with a change, an untracked file,
// an ignored file that does not come back by itself, or a commit that no other branch and no remote holds STAYS, and the
// app says so. Removal is always `git worktree remove` without `--force`, after the links inside it (a `node_modules`
// junction) are undone as links: on Windows a recursive delete can walk through a junction into the checkout it points
// to. The branch `worktree-<name>` goes only when every commit of it is held by another branch or a remote, and only if
// it still points where the inspection saw it.

import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { cliWorktreeBranch } from '../shared/sessionWorktree';
import { findLinks, undoLink } from './sweep/executor';
import { pathExists, removeIfEmpty } from './sweep/fs-utils';
import { firstLine, type GitRun } from './sweep/git';
import { parseClaudeSessionLock, parseWorktreeList, splitNul } from './sweep/git-parse';
import { comparablePath } from './sweep/names';
import { isRegenerableIgnored } from './sweep/plan';

/** Where a session worktree lives, as the CLI lays it out. */
export interface SessionWorktreeTarget {
  /** The MAIN checkout (never a linked worktree): the CLI always nests under it. */
  readonly repoRoot: string;
  readonly name: string;
  readonly path: string;
  /** The branch the CLI created: `worktree-<name>`. */
  readonly branch: string;
}

export function sessionWorktreeTarget(repoRoot: string, name: string): SessionWorktreeTarget {
  return { repoRoot, name, path: join(repoRoot, '.claude', 'worktrees', name), branch: cliWorktreeBranch(name) };
}

/** What a lock on the worktree means. */
export type SessionWorktreeLock =
  | { readonly kind: 'none' }
  /** The CLI's own lock: the session process is `pid`. */
  | { readonly kind: 'claude-session'; readonly pid: number; readonly alive: boolean }
  /** Somebody else's lock (the owner's `git worktree lock`, another tool). */
  | { readonly kind: 'other'; readonly reason: string | null };

export interface SessionWorktreeFacts {
  /** The folder is on the disk. */
  readonly exists: boolean;
  /** `git worktree list` knows it. */
  readonly registered: boolean;
  readonly lock: SessionWorktreeLock;
  /** `git status` ran; when it did not, nothing below about the files can be trusted. */
  readonly statusRead: boolean;
  /** Changed, staged or untracked paths (`git status --porcelain`, ignored ones apart). */
  readonly dirty: readonly string[];
  /** Ignored paths that do not come back by themselves (a `.env`, a local database...). */
  readonly preciousIgnored: readonly string[];
  readonly hasSubmodules: boolean;
  /**
   * Commits of the worktree's HEAD that no other local branch and no remote branch holds; `null` when git could not
   * count them. The branch checked out in the worktree and the CLI's own branch do not count as "another branch".
   */
  readonly uniqueCommits: number | null;
  /** The CLI's branch (`worktree-<name>`), when it exists. */
  readonly ownBranch: { readonly name: string; readonly sha: string; readonly uniqueCommits: number | null } | null;
}

export type SessionWorktreeDecision =
  /** Nothing left: the CLI removed it (or never created it). */
  | { readonly action: 'nothing' }
  /** Only git's record is left (the folder is gone): prune it, and the branch if it holds nothing of its own. */
  | { readonly action: 'prune'; readonly deleteBranch: { readonly name: string; readonly sha: string } | null }
  | { readonly action: 'keep'; readonly reason: string }
  | { readonly action: 'remove'; readonly unlock: boolean; readonly deleteBranch: { readonly name: string; readonly sha: string } | null };

/**
 * Ignored files of a session worktree that are not work: what a build or an install brings back (the sweep's rule),
 * plus the per-worktree permission approvals the CLI writes on Windows (`.claude/settings.local.json`).
 */
export function isDisposableIgnored(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized === '.claude/settings.local.json') return true;
  return isRegenerableIgnored(normalized);
}

function listOf(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} e mais ${paths.length - 3}` : shown;
}

function branchToDelete(facts: SessionWorktreeFacts): { readonly name: string; readonly sha: string } | null {
  const own = facts.ownBranch;
  return own !== null && own.uniqueCommits === 0 ? { name: own.name, sha: own.sha } : null;
}

/** "Can this session worktree go?" Pure: every "never delete work" of the owner is here, in order. */
export function decideSessionWorktreeRelease(facts: SessionWorktreeFacts): SessionWorktreeDecision {
  if (!facts.exists && !facts.registered) return { action: 'nothing' };
  if (!facts.exists) return { action: 'prune', deleteBranch: branchToDelete(facts) };
  if (!facts.registered) return { action: 'keep', reason: 'a pasta existe, mas o git não a reconhece como worktree' };

  if (facts.lock.kind === 'other') return { action: 'keep', reason: 'está travada (git worktree lock) por outro motivo' };
  if (facts.lock.kind === 'claude-session' && facts.lock.alive) return { action: 'keep', reason: 'outra sessão do Claude ainda está usando a worktree' };

  if (!facts.statusRead) return { action: 'keep', reason: 'não consegui ler o estado dela no git' };
  if (facts.hasSubmodules) return { action: 'keep', reason: 'tem submódulo (o git não remove worktree com submódulo)' };
  if (facts.dirty.length > 0) return { action: 'keep', reason: `tem mudança não commitada (${listOf(facts.dirty)})` };
  if (facts.preciousIgnored.length > 0) return { action: 'keep', reason: `tem arquivo ignorado que não se recria (${listOf(facts.preciousIgnored)})` };
  if (facts.uniqueCommits === null) return { action: 'keep', reason: 'não consegui conferir se os commits dela estão em outra branch' };
  if (facts.uniqueCommits > 0) {
    const noun = facts.uniqueCommits === 1 ? 'commit que não está' : 'commits que não estão';
    return { action: 'keep', reason: `tem ${facts.uniqueCommits} ${noun} em nenhum remoto nem em outra branch` };
  }
  return { action: 'remove', unlock: facts.lock.kind === 'claude-session', deleteBranch: branchToDelete(facts) };
}

// ---------------------------------------------------------------------------
// Inspection (git, read-only)
// ---------------------------------------------------------------------------

export interface SessionWorktreeDeps {
  readonly git: GitRun;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long to wait for a just-killed session to let go of its lock (default `LOCK_RELEASE_WAIT_MS`). */
  readonly lockWaitMs?: number;
}

function sameWorktreePath(a: string, b: string): boolean {
  return comparablePath(resolve(a)) === comparablePath(resolve(b));
}

/** `git rev-list --count <rev> --not <other branches> --remotes`, where "other" leaves `excluded` out. */
async function countUnique(git: GitRun, cwd: string, rev: string, excluded: readonly string[]): Promise<number | null> {
  const excludes = [...new Set(excluded)].map((name) => `--exclude=${name}`);
  const counted = await git(cwd, ['rev-list', '--count', rev, '--not', ...excludes, '--branches', '--remotes']);
  const parsed = Number.parseInt(counted.stdout.trim(), 10);
  return counted.code === 0 && Number.isFinite(parsed) ? parsed : null;
}

async function inspectOwnBranch(git: GitRun, target: SessionWorktreeTarget): Promise<SessionWorktreeFacts['ownBranch']> {
  const tip = await git(target.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${target.branch}`]);
  const sha = tip.stdout.trim();
  if (tip.code !== 0 || sha === '') return null;
  return { name: target.branch, sha, uniqueCommits: await countUnique(git, target.repoRoot, `refs/heads/${target.branch}`, [target.branch]) };
}

export async function inspectSessionWorktree(deps: SessionWorktreeDeps, target: SessionWorktreeTarget): Promise<SessionWorktreeFacts> {
  const { git } = deps;
  const exists = await pathExists(target.path);
  const listed = await git(target.repoRoot, ['worktree', 'list', '--porcelain']);
  const entry = listed.code === 0 ? parseWorktreeList(listed.stdout).find((candidate) => sameWorktreePath(candidate.path, target.path)) : undefined;
  const ownBranch = await inspectOwnBranch(git, target);
  const base = { exists, registered: entry !== undefined, ownBranch };
  const unknown: SessionWorktreeFacts = { ...base, lock: { kind: 'none' }, statusRead: false, dirty: [], preciousIgnored: [], hasSubmodules: false, uniqueCommits: null };
  if (entry === undefined || !exists) return unknown;

  let lock: SessionWorktreeLock = { kind: 'none' };
  if (entry.locked) {
    const claude = parseClaudeSessionLock(entry.lockReason);
    lock = claude !== null ? { kind: 'claude-session', pid: claude.pid, alive: deps.isProcessAlive(claude.pid) } : { kind: 'other', reason: entry.lockReason };
  }

  const status = await git(target.path, ['status', '--porcelain', '--ignored', '-z']);
  if (status.code !== 0) return { ...unknown, lock };
  const lines = splitNul(status.stdout);
  const dirty = lines.filter((line) => !line.startsWith('!! ')).map((line) => line.slice(3));
  const preciousIgnored = lines.filter((line) => line.startsWith('!! ')).map((line) => line.slice(3)).filter((path) => !isDisposableIgnored(path));

  const hasSubmodules =
    (await pathExists(join(target.path, '.gitmodules'))) ||
    (await git(target.path, ['ls-files', '--stage'])).stdout.split('\n').some((line) => line.startsWith('160000 '));

  const uniqueCommits = await countUnique(git, target.path, 'HEAD', [target.branch, ...(entry.branch === null ? [] : [entry.branch])]);
  return { ...base, lock, statusRead: true, dirty, preciousIgnored, hasSubmodules, uniqueCommits };
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export type SessionWorktreeOutcome =
  | { readonly kind: 'gone' }
  | { readonly kind: 'removed'; readonly branchDeleted: boolean }
  | { readonly kind: 'kept'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** How long to wait for the killed session process to really go before judging its lock (the exit event can come first). */
export const LOCK_RELEASE_WAIT_MS = 5_000;
const LOCK_RELEASE_POLL_MS = 250;

async function deleteOwnBranch(git: GitRun, repoRoot: string, branch: { readonly name: string; readonly sha: string }): Promise<boolean> {
  const current = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch.name}`]);
  if (current.code !== 0 || current.stdout.trim() !== branch.sha) return false; // moved since the inspection: not ours to judge any more
  return (await git(repoRoot, ['branch', '-D', branch.name])).code === 0;
}

/** Inspects, waiting a little for a just-killed session to let go of its lock. */
async function inspectAfterExit(deps: SessionWorktreeDeps, target: SessionWorktreeTarget): Promise<SessionWorktreeFacts> {
  let facts = await inspectSessionWorktree(deps, target);
  const limit = deps.lockWaitMs ?? LOCK_RELEASE_WAIT_MS;
  for (let waited = 0; facts.lock.kind === 'claude-session' && facts.lock.alive && waited < limit; waited += LOCK_RELEASE_POLL_MS) {
    await deps.sleep(LOCK_RELEASE_POLL_MS);
    facts = await inspectSessionWorktree(deps, target);
  }
  return facts;
}

/**
 * The whole gesture of "the tab of this session was closed". Never throws. `stillMine` is asked right before anything
 * changes on the disk: `false` (another tab reopened the worktree meanwhile) leaves it as it is.
 */
export async function releaseSessionWorktree(
  deps: SessionWorktreeDeps,
  target: SessionWorktreeTarget,
  stillMine: () => boolean = () => true,
): Promise<SessionWorktreeOutcome> {
  try {
    const decision = decideSessionWorktreeRelease(await inspectAfterExit(deps, target));
    if ((decision.action === 'remove' || decision.action === 'prune') && !stillMine()) return { kind: 'kept', reason: 'outra aba reabriu a worktree' };
    switch (decision.action) {
      case 'nothing':
        return { kind: 'gone' };
      case 'keep':
        return { kind: 'kept', reason: decision.reason };
      case 'prune': {
        await deps.git(target.repoRoot, ['worktree', 'prune']);
        const branchDeleted = decision.deleteBranch !== null && (await deleteOwnBranch(deps.git, target.repoRoot, decision.deleteBranch));
        return { kind: 'removed', branchDeleted };
      }
      case 'remove': {
        if (decision.unlock) {
          const unlocked = await deps.git(target.repoRoot, ['worktree', 'unlock', target.path]);
          if (unlocked.code !== 0) return { kind: 'failed', reason: `git worktree unlock falhou: ${firstLine(unlocked.stderr) || `código ${unlocked.code}`}` };
        }
        // The links first, as links: `git worktree remove` must never walk through a junction.
        for (const link of await findLinks(target.path)) await undoLink(link);
        const removed = await deps.git(target.repoRoot, ['worktree', 'remove', target.path]);
        if (removed.code !== 0) return { kind: 'failed', reason: `git worktree remove falhou: ${firstLine(removed.stderr) || `código ${removed.code}`}` };
        await removeIfEmpty(dirname(target.path));
        const branchDeleted = decision.deleteBranch !== null && (await deleteOwnBranch(deps.git, target.repoRoot, decision.deleteBranch));
        return { kind: 'removed', branchDeleted };
      }
    }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? firstLine(error.message) || error.name : String(error) };
  }
}

// ---------------------------------------------------------------------------
// The main repo of a project folder
// ---------------------------------------------------------------------------

/**
 * The main checkout of the repo `cwd` is in (from a subfolder or from a linked worktree too): the parent of the common
 * git dir. `null` when `cwd` is not in a git repo or the layout is not the usual `<repo>/.git`. Synchronous on purpose:
 * it runs once per spawn, before the transcript path of the session is known.
 */
export function resolveMainRepoRootSync(cwd: string, run: (cwd: string) => string | null = gitCommonDirSync): string | null {
  const commonDir = run(cwd);
  if (commonDir === null || commonDir === '') return null;
  const absolute = resolve(cwd, commonDir);
  return basename(absolute).toLowerCase() === '.git' ? dirname(absolute) : null;
}

function gitCommonDirSync(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return null;
  }
}
