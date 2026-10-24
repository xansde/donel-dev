// 016-jobu-faxina (T010) - does what the plan says, one item at a time, and reports each outcome. A failure of one item
// never stops the next: it becomes a line "não foi possível" in the summary. The rules that exist because something
// went wrong once live here:
//  - A worktree is never removed while a link (junction or symlink) inside it still points somewhere. `git worktree
//    remove` can walk through a `node_modules` junction and empty the CHECKOUT it points to (real incident, 2026). The links are
//    undone first, as links (`unlink`), and only then does git remove the folder, never with `--force`.
//  - A branch is deleted only after its `name SHA` is written to the receipt, and only if it still points where the
//    plan saw it.
//  - A deletion refuses any path outside the folders the sweep owns (the repo, `%TEMP%/claude`).
//  - A separation lands only on a path that does not exist yet.

import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isLink, movePath, removeIfEmpty } from './fs-utils';
import { firstLine, type GitRun } from './git';
import { comparablePath } from './names';
import type { ExecutedItem, PlanItem, RepoPlan } from './types';

export const RECEIPT_FILE = 'branches-apagadas.txt';

export interface ExecutorContext {
  readonly git: GitRun;
  /** Folders a deletion may happen inside (never equal to one of them). */
  readonly allowedRoots: readonly string[];
  /** Creates what is needed (the sweep folder, once, and the subfolder of this repo) and returns the subfolder. Called only when something goes there. */
  readonly repoFolder: () => Promise<string>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return firstLine(error.message) || error.name;
  return String(error);
}

function isInside(path: string, root: string): boolean {
  const target = comparablePath(resolve(path));
  const base = comparablePath(resolve(root));
  return target !== base && target.startsWith(`${base}/`);
}

// ---------------------------------------------------------------------------
// Links inside a worktree
// ---------------------------------------------------------------------------

async function entriesOf(dir: string): Promise<{ readonly name: string; readonly link: boolean; readonly directory: boolean }[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, link: entry.isSymbolicLink(), directory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/**
 * The links (junctions and symlinks) in the first levels of a worktree: the top level; two levels into the folders
 * (`packages/x/node_modules`); and into a real `node_modules` its packages and scoped packages (`@scope/name`).
 */
export async function findLinks(worktreePath: string): Promise<string[]> {
  const links: string[] = [];
  const visit = async (dir: string, depth: number, scoped: boolean): Promise<void> => {
    for (const entry of await entriesOf(dir)) {
      const path = join(dir, entry.name);
      if (entry.link) {
        links.push(path);
        continue;
      }
      if (!entry.directory || entry.name === '.git') continue;
      if (entry.name === 'node_modules') {
        if (depth < 3) await visit(path, depth + 1, true);
      } else if (scoped) {
        if (entry.name.startsWith('@')) await visit(path, depth + 1, false);
      } else if (depth < 2) {
        await visit(path, depth + 1, false);
      }
    }
  };
  await visit(worktreePath, 0, false);
  return links;
}

/** Removes a link as a link. `unlink` first; for a directory junction that refuses it, `rmdir`, which removes the junction and not its target. */
export async function undoLink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error) {
    if (!(await isLink(path))) throw error;
    await fs.rmdir(path);
  }
}

// ---------------------------------------------------------------------------
// The items
// ---------------------------------------------------------------------------

async function removeWorktree(ctx: ExecutorContext, repoPath: string, item: Extract<PlanItem, { kind: 'removeWorktree' }>): Promise<void> {
  if (item.missing) return; // only the registration is left: the prune at the end of the plan clears it
  for (const link of await findLinks(item.path)) await undoLink(link);
  const removed = await ctx.git(repoPath, ['worktree', 'remove', item.path]);
  if (removed.code !== 0) throw new Error(`git worktree remove falhou: ${firstLine(removed.stderr) || `código ${removed.code}`}`);
  await removeIfEmpty(dirname(item.path));
}

async function deleteBranch(ctx: ExecutorContext, repoPath: string, item: Extract<PlanItem, { kind: 'deleteBranch' }>): Promise<void> {
  const current = await ctx.git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${item.name}`]);
  if (current.code !== 0) throw new Error('a branch já não existe');
  if (current.stdout.trim() !== item.sha) throw new Error('a branch mudou desde o inventário');
  const folder = await ctx.repoFolder();
  // The receipt first: if it cannot be written the branch is not deleted.
  await fs.appendFile(join(folder, RECEIPT_FILE), `${item.name} ${item.sha}\n`, 'utf8');
  const deleted = await ctx.git(repoPath, ['branch', '-D', item.name]);
  if (deleted.code !== 0) throw new Error(`git branch -D falhou: ${firstLine(deleted.stderr) || `código ${deleted.code}`}`);
}

async function deletePath(ctx: ExecutorContext, item: Extract<PlanItem, { kind: 'delete' }>): Promise<void> {
  if (!ctx.allowedRoots.some((root) => isInside(item.path, root))) throw new Error('fora das pastas que a faxina pode limpar');
  await fs.rm(item.path, { recursive: true, force: true });
}

async function separate(ctx: ExecutorContext, item: Extract<PlanItem, { kind: 'separate' }>): Promise<void> {
  const folder = await ctx.repoFolder();
  const destination = join(folder, ...item.destRel.split('/'));
  if (!isInside(destination, folder)) throw new Error('destino fora da pasta da faxina');
  await movePath(item.from, destination);
}

/** Runs the plan. Only the actionable items are returned (a `keep` is not something that happened). */
export async function executePlan(ctx: ExecutorContext, plan: RepoPlan): Promise<ExecutedItem[]> {
  const executed: ExecutedItem[] = [];
  let touchedWorktrees = false;
  for (const item of plan.items) {
    if (item.kind === 'keep') continue;
    try {
      switch (item.kind) {
        case 'removeWorktree':
          touchedWorktrees = true;
          await removeWorktree(ctx, plan.repoPath, item);
          break;
        case 'deleteBranch':
          await deleteBranch(ctx, plan.repoPath, item);
          break;
        case 'delete':
          await deletePath(ctx, item);
          break;
        case 'separate':
          await separate(ctx, item);
          break;
      }
      executed.push({ item, ok: true, error: null });
    } catch (error) {
      executed.push({ item, ok: false, error: describeError(error) });
    }
  }
  if (touchedWorktrees) await ctx.git(plan.repoPath, ['worktree', 'prune']);
  return executed;
}
