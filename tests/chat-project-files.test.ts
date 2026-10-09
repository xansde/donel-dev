// T086 (014-chat) - `@` menu files: git (tracked + untracked not ignored) or a bounded walk without git.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WALK_FILE_CAP, createProjectFiles, listProjectFiles, rankProjectFiles } from '../src/main/chat/project-files';

let root: string;
const put = (rel: string, body = 'x'): void => {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};
const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-files-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listProjectFiles', () => {
  it('lists tracked and untracked-not-ignored files inside a git repo', async () => {
    git('init', '-q');
    put('src/tracked.ts');
    put('notes with space.md');
    put('.gitignore', 'ignored.log\nbuild/\n');
    git('add', 'src/tracked.ts', '.gitignore');
    put('src/untracked.ts');
    put('ignored.log');
    put('build/out.js');
    const files = await listProjectFiles(root);
    expect(files).toEqual(expect.arrayContaining(['src/tracked.ts', 'src/untracked.ts', 'notes with space.md', '.gitignore']));
    expect(files).not.toContain('ignored.log');
    expect(files).not.toContain('build/out.js');
  });

  it('walks the folder without git, skipping node_modules, .git and dist', async () => {
    put('a.txt');
    put('src/b.ts');
    put('node_modules/pkg/index.js');
    put('.git/config');
    put('dist/bundle.js');
    put('src/dist/deep.js');
    const files = (await listProjectFiles(root, { useGit: false })).sort();
    expect(files).toEqual(['a.txt', 'src/b.ts']);
  });

  it('caps the walk', async () => {
    for (let i = 0; i < 12; i += 1) put(`f${i}.txt`);
    expect(await listProjectFiles(root, { useGit: false, walkCap: 5 })).toHaveLength(5);
    expect(WALK_FILE_CAP).toBe(20000);
  });

  it('returns an empty list for a missing folder', async () => {
    expect(await listProjectFiles(join(root, 'nope'))).toEqual([]);
  });
});

describe('rankProjectFiles', () => {
  const files = ['src/main/index.ts', 'src/renderer/App.tsx', 'README.md', 'docs/index.md', 'a/b/c/deep/index.ts'];
  it('puts the shallowest files first for an empty query', () => {
    expect(rankProjectFiles(files, '', 3)[0]).toBe('README.md');
    expect(rankProjectFiles(files, '', 3)).toHaveLength(3);
  });
  it('ranks basename prefix over path matches and honors the limit', () => {
    expect(rankProjectFiles(files, 'index', 2)).toEqual(['docs/index.md', 'src/main/index.ts']);
    expect(rankProjectFiles(files, 'app', 5)[0]).toBe('src/renderer/App.tsx');
    expect(rankProjectFiles(files, 'zzz', 5)).toEqual([]);
  });
  it('matches by path segment', () => {
    expect(rankProjectFiles(files, 'renderer/app', 5)[0]).toBe('src/renderer/App.tsx');
  });
});

describe('createProjectFiles (cache)', () => {
  it('serves the query from a cached listing and refreshes after the ttl', async () => {
    put('one.ts');
    let t = 0;
    const svc = createProjectFiles({ ttlMs: 1000, now: () => t, useGit: false });
    expect(await svc.query(root, 'one', 10)).toEqual(['one.ts']);
    put('two.ts');
    expect(await svc.query(root, 'two', 10)).toEqual([]);
    t = 2000;
    expect(await svc.query(root, 'two', 10)).toEqual(['two.ts']);
  });
});
