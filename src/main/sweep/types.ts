// 016-jobu-faxina (T002) - the shapes of the sweep. The flow is one-way and each step is its own module:
//
//   inventory (git + fs)  ->  RepoFacts  ->  planRepo (pure)  ->  RepoPlan  ->  executor (fs + git)  ->  RepoReport  ->  renderSummary (pure)
//
// Facts are what was MEASURED; the plan is what to do about it and why; the report is what happened. Nothing
// here touches the disk, and no type carries the content of a file: only names, sizes, dates and SHAs.

/** One worktree of a repo as `git worktree list --porcelain` and a few probes describe it. */
export interface WorktreeFact {
  readonly path: string;
  /** Short branch name, or `null` for a detached HEAD. */
  readonly branch: string | null;
  readonly head: string;
  /** The first entry of the list: the main checkout. Never removed, never reported. */
  readonly isMain: boolean;
  readonly locked: boolean;
  /**
   * The lock is the CLI's own (`claude session <name> (pid N)`, left by a `--worktree` session that was killed) and
   * that process is gone: the lock protects nothing any more, so it does not hold the worktree back.
   */
  readonly staleClaudeLock: boolean;
  /** The folder is gone from the disk (git still lists it as prunable). */
  readonly missing: boolean;
  /** `git status --porcelain` printed nothing (untracked files count as dirty). */
  readonly clean: boolean;
  /** HEAD is an ancestor of the integration branch. */
  readonly headInIntegration: boolean;
  /** `origin/<branch>` points at exactly this HEAD. */
  readonly headEqualsRemote: boolean;
  /** Every commit of HEAD is on some remote branch (`git rev-list HEAD --not --remotes` is empty). */
  readonly headOnRemote: boolean;
  /** Newest write to the worktree's admin files in `.git/worktrees/<name>/` (HEAD, logs/HEAD); 0 when unknown. */
  readonly lastActivityMs: number;
  /**
   * The worktree holds a submodule: `git worktree remove` refuses it ("working trees containing submodules cannot be
   * moved or removed"). Git's own test is a `modules/` folder in the worktree's git dir or a gitlink in its index; a
   * `.gitmodules` file at the root is added as a cheap early signal.
   */
  readonly hasSubmodules: boolean;
  /** What `git status --ignored` lists as ignored in the worktree (`!!` lines, folders with a trailing `/`). */
  readonly ignored: readonly string[];
}

export interface BranchFact {
  readonly name: string;
  readonly sha: string;
  /** Checked out in some worktree (the main one included). */
  readonly checkedOut: boolean;
  readonly ancestorOfIntegration: boolean;
  /** `git cherry <integration> <branch>` has no `+` line: every patch is already there. */
  readonly cherryClean: boolean;
  /** `origin/<name>` is at the same SHA. */
  readonly publishedSameSha: boolean;
  /** Commits that exist on this branch and on no remote branch and not in the integration branch. */
  readonly onlyHereCount: number;
  /** Committer date of the tip, epoch ms. */
  readonly lastCommitMs: number;
}

/** What kind of regenerable output a path is. */
export type JunkKind = 'output-dir' | 'prototype-modules' | 'prototype-dist' | 'stray-cache';

export interface JunkFact {
  /** Path relative to the repo, with `/`. */
  readonly relPath: string;
  readonly absPath: string;
  readonly kind: JunkKind;
  readonly bytes: number;
  /** `git ls-files` lists something under it: it is the repo's own, not output. */
  readonly tracked: boolean;
}

export interface InstallerFact {
  /** File name inside `release/`. */
  readonly name: string;
  readonly absPath: string;
  readonly bytes: number;
  /** `git ls-files release` lists it. */
  readonly tracked: boolean;
}

export interface ScratchEntryFact {
  readonly absPath: string;
  /** Name shown to the owner, relative to `%TEMP%/claude`. */
  readonly label: string;
  readonly bytes: number;
  /** Newest write anywhere inside it (or its own mtime if empty), epoch ms. */
  readonly newestWriteMs: number;
}

export interface SessionFolderFact {
  /** Folder name under `~/.claude/projects`. */
  readonly name: string;
  readonly absPath: string;
  /** `cwd` of the first record that has one, or `null` when none could be read. */
  readonly cwd: string | null;
  /** The cwd is gone for good: not on disk AND its drive is reachable. */
  readonly cwdGone: boolean;
  /** The known repo this folder belongs to (see `ownerRepo`), if any. */
  readonly owner: string | null;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface UntrackedFileFact {
  /** Path relative to the repo, with `/`. */
  readonly relPath: string;
  readonly absPath: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface RepoFacts {
  readonly repoPath: string;
  readonly repoName: string;
  /** `origin/staging`, `origin/dev`, `origin/main` or `origin/master`; `null` when none exists. */
  readonly integrationRef: string | null;
  /** The `git fetch origin` failed: the plan runs on what is local, and the summary says so. */
  readonly fetchError: string | null;
  readonly worktrees: readonly WorktreeFact[];
  readonly branches: readonly BranchFact[];
  readonly junk: readonly JunkFact[];
  readonly installers: readonly InstallerFact[];
  /** Entries of `%TEMP%/claude` that belong to this repo; each one is judged on its own. */
  readonly scratchpads: readonly ScratchEntryFact[];
  readonly sessions: readonly SessionFolderFact[];
  /** Untracked, not ignored, files under `.esteira/` of the main checkout. */
  readonly esteiraFiles: readonly UntrackedFileFact[];
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type DeleteGroup = 'regenerable' | 'installer' | 'scratchpad';
export type SeparateGroup = 'sessoes-claude' | 'esteira';

export type PlanItem =
  | {
      readonly kind: 'delete';
      readonly group: DeleteGroup;
      readonly path: string;
      /** What the owner reads: a path relative to the repo, or the scratchpad name. */
      readonly label: string;
      readonly bytes: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'removeWorktree';
      readonly path: string;
      readonly branch: string | null;
      readonly missing: boolean;
      readonly reason: string;
      /** A stale lock of the CLI is released first (`git worktree unlock`). */
      readonly unlock?: boolean;
    }
  | { readonly kind: 'deleteBranch'; readonly name: string; readonly sha: string; readonly reason: string }
  | {
      readonly kind: 'separate';
      readonly group: SeparateGroup;
      readonly from: string;
      /** Where it lands, relative to `<faxina>/<repo>/`. */
      readonly destRel: string;
      readonly bytes: number;
      readonly mtimeMs: number;
      readonly reason: string;
      /** How to put it back, in words. */
      readonly restore: string;
    }
  | { readonly kind: 'keep'; readonly what: 'worktree' | 'branch' | 'path'; readonly name: string; readonly reason: string };

export interface RepoPlan {
  readonly repoPath: string;
  readonly repoName: string;
  readonly integrationRef: string | null;
  readonly fetchError: string | null;
  readonly items: readonly PlanItem[];
}

/** Anything the executor would change on the disk. `keep` is not an action. */
export function isActionable(item: PlanItem): boolean {
  return item.kind !== 'keep';
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ExecutedItem {
  readonly item: PlanItem;
  readonly ok: boolean;
  /** Why it failed, when `ok` is false. Never a file content. */
  readonly error: string | null;
}

export interface RepoReport {
  readonly repoPath: string;
  readonly repoName: string;
  /** Subfolder of this repo inside the sweep folder (used only when something went there). */
  readonly folderName: string;
  readonly integrationRef: string | null;
  readonly fetchError: string | null;
  readonly executed: readonly ExecutedItem[];
  /** The `keep` items of the plan: left alone on purpose. */
  readonly kept: readonly Extract<PlanItem, { kind: 'keep' }>[];
}

export interface SweepReport {
  /** Local date of the sweep, `AAAA-MM-DD`. */
  readonly day: string;
  /** The sweep folder, or `null` when nothing was set aside and no branch was deleted. */
  readonly folder: string | null;
  readonly repos: readonly RepoReport[];
  /** Whole-sweep notes (a repo that could not be read, ...). */
  readonly notes: readonly string[];
}
