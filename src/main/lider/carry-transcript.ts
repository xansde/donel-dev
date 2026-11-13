// Líder único na VPS — the conversation goes with the Líder when it changes place (docs/planos/lider-na-vps.md).
// A transcript only grows, so the larger copy is the newer one: it replaces the other, which stays as `.bak-<time>`.
// A smaller copy never overwrites. The remote side follows the same rule (`buildCarryTranscriptScript`).

import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** The largest existing copy among `paths`, or `null`. */
export function largestTranscript(paths: readonly (string | undefined)[]): { readonly path: string; readonly size: number } | null {
  let best: { path: string; size: number } | null = null;
  for (const path of paths) {
    if (!path) continue;
    const size = sizeOf(path);
    if (size !== null && size > 0 && (best === null || size > best.size)) best = { path, size };
  }
  return best;
}

/** Copies `source` to `dest` when `dest` is missing or smaller; the replaced file is kept beside it. */
export function carryTranscriptLocally(source: string, dest: string): 'carried' | 'kept' | 'missing' {
  const sourceSize = sizeOf(source);
  if (sourceSize === null) return 'missing';
  if (source === dest) return 'kept';
  const destSize = sizeOf(dest);
  if (destSize !== null && destSize >= sourceSize) return 'kept';
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.chegando`;
  copyFileSync(source, tmp);
  if (destSize !== null && existsSync(dest)) renameSync(dest, `${dest}.bak-${Date.now()}`);
  renameSync(tmp, dest);
  return 'carried';
}

/** Copies the largest existing copy among `sources` to `dest` (the Líder changes folder on this computer, 12/11). */
export function carryLargestTranscript(sources: readonly (string | undefined)[], dest: string): 'carried' | 'kept' | 'missing' {
  const source = largestTranscript(sources);
  return source ? carryTranscriptLocally(source.path, dest) : 'missing';
}
