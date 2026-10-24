// T086 (014-chat) - files for the `@` menu of the composer (`chat:files`, ipc-chat.md).
//
// Inside a git repo: tracked + untracked-not-ignored (`git ls-files --cached --others --exclude-standard`), so
// `.gitignore` is honoured exactly as the CLI's own `@` completion does. Without git (or when it fails): a bounded
// walk that skips `node_modules`, `.git` and `dist`, capped at 20 thousand files. Paths are relative to the tab's
// `cwd`, with `/` separators. The `cwd` always comes from the main (the tab's conversation), never from the renderer.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { insertRankedSearchResult, normalizeSearchQuery, scoreQueryMatch, type RankedSearchResult } from '../../shared/chat/t3/searchRanking';

export const WALK_FILE_CAP = 20000;
/** Safety net for a monorepo listing; far above anything the menu can show. */
const GIT_FILE_CAP = 200000;
const WALK_SKIP: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist']);

export interface ListOptions {
  /** Default `true`; `false` forces the walk (tests, or a folder known not to be a repo). */
  readonly useGit?: boolean;
  readonly walkCap?: number;
}

function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd, maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        if (error !== null) return resolve(null);
        const seen = new Set<string>();
        for (const entry of stdout.split('\0')) {
          if (entry !== '') seen.add(entry);
          if (seen.size >= GIT_FILE_CAP) break;
        }
        resolve([...seen]);
      },
    );
  });
}

async function walkFiles(cwd: string, cap: number): Promise<string[]> {
  const out: string[] = [];
  const pending: string[] = [''];
  while (pending.length > 0 && out.length < cap) {
    const rel = pending.shift()!;
    let entries;
    try {
      entries = await fs.readdir(join(cwd, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= cap) break;
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name)) pending.push(next);
      } else if (entry.isFile()) {
        out.push(next);
      }
    }
  }
  return out;
}

/** Every project file the `@` menu may offer, relative to `cwd`. `[]` when the folder cannot be read. */
export async function listProjectFiles(cwd: string, options: ListOptions = {}): Promise<string[]> {
  if (cwd === '') return [];
  try {
    await fs.access(cwd);
  } catch {
    return [];
  }
  if (options.useGit !== false) {
    const viaGit = await gitFiles(cwd);
    if (viaGit !== null) return viaGit;
  }
  return walkFiles(cwd, options.walkCap ?? WALK_FILE_CAP);
}

const depthOf = (path: string): number => path.split('/').length - 1;

/** Best matches first. Empty query: shallowest files first (what the owner most likely wants to mention). */
export function rankProjectFiles(files: readonly string[], query: string, limit: number): string[] {
  const max = Math.max(0, Math.floor(limit));
  const q = normalizeSearchQuery(query);
  const ranked: RankedSearchResult<string>[] = [];
  for (const path of files) {
    const tieBreaker = `${String(depthOf(path)).padStart(3, '0')}${path}`;
    if (q === '') {
      insertRankedSearchResult(ranked, { item: path, score: 0, tieBreaker }, max);
      continue;
    }
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const byName = scoreQueryMatch({ value: base, query: q, exactBase: 0, prefixBase: 10, boundaryBase: 20, includesBase: 30, fuzzyBase: 60, boundaryMarkers: ['-', '_', '.', ' '] });
    const byPath = scoreQueryMatch({ value: lower, query: q, exactBase: 40, boundaryBase: 40, includesBase: 50, fuzzyBase: 80, boundaryMarkers: ['/'] });
    const score = byName === null ? byPath : byPath === null ? byName : Math.min(byName, byPath);
    if (score !== null) insertRankedSearchResult(ranked, { item: path, score, tieBreaker }, max);
  }
  return ranked.map((r) => r.item);
}

export interface ProjectFilesOptions extends ListOptions {
  /** How long a listing is reused, per `cwd`. Default 5 s: a burst of keystrokes costs one listing. */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface ProjectFilesService {
  query(cwd: string, query: string, limit: number): Promise<string[]>;
}

export function createProjectFiles(options: ProjectFilesOptions = {}): ProjectFilesService {
  const ttl = options.ttlMs ?? 5000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; files: Promise<string[]> }>();
  return {
    async query(cwd, query, limit) {
      let entry = cache.get(cwd);
      if (entry === undefined || now() - entry.at >= ttl) {
        entry = { at: now(), files: listProjectFiles(cwd, options) };
        cache.set(cwd, entry);
      }
      return rankProjectFiles(await entry.files, query, limit);
    },
  };
}
