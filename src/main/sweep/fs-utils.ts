// 016-jobu-faxina (T008/T010) - the filesystem helpers of the sweep, all async. Nothing here follows a symlink or a
// junction: a link is measured as the link, removed as the link, never entered. That is the rule that keeps a
// `node_modules` junction from turning into "delete the main checkout".

import { promises as fs } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Is it a symlink or a junction (Node reports both as links on Windows)? `false` for a path that does not exist. */
export async function isLink(path: string): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface Measure {
  readonly bytes: number;
  /** The newest mtime of anything inside (the folder itself included), epoch ms. */
  readonly newestMs: number;
}

/** One walk for the size and the newest write. Links count as 0 bytes and are not entered. Unreadable entries are skipped. */
export async function measure(path: string): Promise<Measure> {
  let bytes = 0;
  let newestMs = 0;
  const pending: string[] = [path];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch {
      continue;
    }
    newestMs = Math.max(newestMs, stats.mtimeMs);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      try {
        for (const name of await fs.readdir(current)) pending.push(join(current, name));
      } catch {
        // unreadable folder: measured as far as it could be
      }
    } else {
      bytes += stats.size;
    }
  }
  return { bytes, newestMs };
}

/** Runs `task` over `items` with at most `limit` in flight; the results keep the order of `items`. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Is `path` gone for good? Not on disk, AND the drive it was on answers (an unplugged disk is "unknown", not "gone"). */
export async function isGone(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') return false;
  }
  return pathExists(parse(path).root);
}

/**
 * Moves a file or a folder to `to`, creating the parents. The same volume: a `rename`. Another volume (`EXDEV`): copy,
 * then remove the original, and only after the copy went whole. It refuses to land on something that exists.
 */
export async function movePath(from: string, to: string): Promise<void> {
  if (await pathExists(to)) throw new Error(`destino já existe: ${to}`);
  await fs.mkdir(dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/** Removes a folder only if nothing is inside it. Returns whether it did. */
export async function removeIfEmpty(path: string): Promise<boolean> {
  try {
    if ((await fs.readdir(path)).length > 0) return false;
    await fs.rmdir(path);
    return true;
  } catch {
    return false;
  }
}
