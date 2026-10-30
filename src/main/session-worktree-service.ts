// "Isolar em worktree" — the main-process side of a session tab that runs in a worktree: remembers which pty is in
// which worktree (spawn), releases the worktree when the OWNER closes the tab (exit with the kill intent), and tells the
// renderer when a worktree stayed because it holds work. A process that left on its own (`/exit`, crash) is not
// touched here: on a clean `/exit` the CLI already ran its own keep/remove, and the Jobu's sweep catches the rest.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isSafeWorktreeName, worktreeNameFromArgs } from '../shared/sessionWorktree';
import type { WorktreeKeptPayload } from '../shared/workspace';
import { comparablePath } from './sweep/names';
import { releaseSessionWorktree, resolveMainRepoRootSync, sessionWorktreeTarget, type SessionWorktreeDeps, type SessionWorktreeOutcome, type SessionWorktreeTarget } from './session-worktree';

export interface SessionWorktreeServiceDeps extends SessionWorktreeDeps {
  readonly resolveRepoRoot?: (cwd: string) => string | null;
  /** A worktree stayed (work in it) or could not be removed: the renderer shows the notice. */
  readonly notifyKept: (payload: WorktreeKeptPayload) => void;
  readonly openPath: (path: string) => Promise<string>;
  readonly log?: (line: string) => void;
}

export interface SessionWorktreeService {
  /** Spawn of a `claude` tab: when the argv isolates it, remembers the worktree and returns it (its path is the session's real cwd). */
  onSpawn(ptyId: string, cwd: string | undefined, args: readonly string[] | undefined): SessionWorktreeTarget | null;
  /** Exit of a pty. `byUser` = the owner closed the tab (or Restart/Resume killed it). Resolves when the release is done. */
  onExit(ptyId: string, byUser: boolean): Promise<SessionWorktreeOutcome | null>;
  /** "Abrir pasta" of the notice: only a worktree this service reported as kept. */
  openFolder(path: unknown): Promise<boolean>;
}

const key = (target: SessionWorktreeTarget): string => comparablePath(resolve(target.path));

export function createSessionWorktreeService(deps: SessionWorktreeServiceDeps): SessionWorktreeService {
  const byPty = new Map<string, SessionWorktreeTarget>();
  const keptPaths = new Set<string>();
  const resolveRoot = deps.resolveRepoRoot ?? ((cwd: string) => resolveMainRepoRootSync(cwd));

  /** Another live tab of this app in the same worktree (Restart reopens the same name while the old one is dying). */
  const inUseElsewhere = (target: SessionWorktreeTarget): boolean => [...byPty.values()].some((other) => key(other) === key(target));

  return {
    onSpawn(ptyId, cwd, args) {
      const name = worktreeNameFromArgs(args);
      if (name === null || !isSafeWorktreeName(name) || !cwd) return null;
      const repoRoot = resolveRoot(cwd);
      if (repoRoot === null) return null; // not a git repo: the CLI refuses `--worktree` and says so in the terminal
      const target = sessionWorktreeTarget(repoRoot, name);
      byPty.set(ptyId, target);
      return target;
    },

    async onExit(ptyId, byUser) {
      const target = byPty.get(ptyId);
      if (target === undefined) return null;
      byPty.delete(ptyId);
      if (!byUser || inUseElsewhere(target)) return null;
      const outcome = await releaseSessionWorktree(deps, target, () => !inUseElsewhere(target));
      // Re-checked after the wait: a Restart may have reopened it meanwhile; then the new tab owns it.
      if (inUseElsewhere(target)) return outcome;
      if (outcome.kind === 'kept' || outcome.kind === 'failed') {
        keptPaths.add(key(target));
        deps.notifyKept({ kind: outcome.kind, name: target.name, path: target.path, branch: target.branch, reason: outcome.reason });
      }
      deps.log?.(`[worktree] ${target.name}: ${outcome.kind}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
      return outcome;
    },

    async openFolder(path) {
      if (typeof path !== 'string' || !isAbsolute(path) || !keptPaths.has(comparablePath(resolve(path)))) return false;
      try {
        if (!existsSync(path) || !statSync(path).isDirectory()) return false;
      } catch {
        return false;
      }
      return (await deps.openPath(path)) === '';
    },
  };
}
