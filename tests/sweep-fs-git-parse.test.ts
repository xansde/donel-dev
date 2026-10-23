// 016-jobu-faxina (T008/T010) - the parsers of git output and the filesystem helpers of the sweep (real temporary
// folders): measuring without entering links, the move that survives another volume, and the "gone for good" check.
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cherryIsClean, latestReflogMs, parseBranchList, parseWorktreeList, splitNul } from '../src/main/sweep/git-parse';
import { isGone, isLink, mapLimit, measure, movePath, pathExists, removeIfEmpty } from '../src/main/sweep/fs-utils';

describe('parseWorktreeList', () => {
  const sample = [
    'worktree C:/w/atlas',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/staging',
    '',
    'worktree C:/w/atlas-wt/a',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature/a',
    'locked razão qualquer',
    '',
    'worktree C:/w/atlas-wt/gone',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n');

  it('reads the path, the HEAD, the branch without refs/heads, and the flags; the first entry is the main one', () => {
    const [main, locked, gone] = parseWorktreeList(sample);
    expect(main).toMatchObject({ head: '1111111111111111111111111111111111111111', branch: 'staging', locked: false, prunable: false });
    expect(locked).toMatchObject({ branch: 'feature/a', locked: true });
    expect(gone).toMatchObject({ branch: null, prunable: true });
    expect(main?.path.endsWith('atlas')).toBe(true);
  });

  it('reads CRLF output and ignores noise', () => {
    expect(parseWorktreeList(sample.replace(/\n/g, '\r\n'))).toHaveLength(3);
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('the other parsers', () => {
  it('parseBranchList: name, sha and the committer date in ms; a malformed line is skipped', () => {
    expect(parseBranchList('feature/a\tabc\t1760000000\n\nbroken\nb\tdef\tnotanumber\n')).toEqual([
      { name: 'feature/a', sha: 'abc', committedMs: 1_760_000_000_000 },
      { name: 'b', sha: 'def', committedMs: 0 },
    ]);
  });

  it('cherryIsClean: any "+" line is a patch that is not there yet; "-" lines are', () => {
    expect(cherryIsClean('- abc\n- def\n')).toBe(true);
    expect(cherryIsClean('')).toBe(true);
    expect(cherryIsClean('- abc\n+ def\n')).toBe(false);
  });

  it('splitNul drops the empty tail', () => {
    expect(splitNul('a\0b c\0')).toEqual(['a', 'b c']);
    expect(splitNul('')).toEqual([]);
  });

  it('latestReflogMs: the largest @{unix}, in ms, or null', () => {
    expect(latestReflogMs('HEAD@{1760000100}\nHEAD@{1760000500}\nHEAD@{1750000000}\n')).toBe(1_760_000_500_000);
    expect(latestReflogMs('')).toBeNull();
  });
});

describe('filesystem helpers', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'sweep-fs-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('measure adds the files up and reports the newest write', async () => {
    await fs.mkdir(join(root, 'a', 'b'), { recursive: true });
    await fs.writeFile(join(root, 'a', 'one.txt'), '12345');
    await fs.writeFile(join(root, 'a', 'b', 'two.txt'), '123');
    const old = new Date(2020, 0, 1);
    await fs.utimes(join(root, 'a', 'one.txt'), old, old);
    const recent = new Date(2026, 5, 1);
    await fs.utimes(join(root, 'a', 'b', 'two.txt'), recent, recent);
    const result = await measure(join(root, 'a'));
    expect(result.bytes).toBe(8);
    expect(result.newestMs).toBeGreaterThanOrEqual(recent.getTime());
  });

  it('measure over a wide and deep tree gives the exact bytes and the newest write', async () => {
    const recent = new Date(2026, 8, 1);
    let expected = 0;
    for (let d = 0; d < 8; d += 1) {
      const dir = join(root, 'wide', `d${d}`, 'inner');
      await fs.mkdir(dir, { recursive: true });
      for (let f = 0; f < 10; f += 1) {
        await fs.writeFile(join(dir, `f${f}.txt`), 'x'.repeat(f + d));
        expected += f + d;
      }
    }
    await fs.utimes(join(root, 'wide', 'd7', 'inner', 'f3.txt'), recent, recent);
    const result = await measure(join(root, 'wide'));
    expect(result.bytes).toBe(expected);
    expect(result.newestMs).toBeGreaterThanOrEqual(recent.getTime());
  });

  it('measure of a missing path is empty, not an error', async () => {
    expect(await measure(join(root, 'nope'))).toEqual({ bytes: 0, newestMs: 0 });
  });

  it('measure does not enter a junction: the target is not counted', async () => {
    await fs.mkdir(join(root, 'target'));
    await fs.writeFile(join(root, 'target', 'big.bin'), Buffer.alloc(10_000));
    await fs.mkdir(join(root, 'wt'));
    await fs.symlink(join(root, 'target'), join(root, 'wt', 'node_modules'), 'junction');
    expect(await isLink(join(root, 'wt', 'node_modules'))).toBe(true);
    expect((await measure(join(root, 'wt'))).bytes).toBe(0);
  });

  it('isGone: a missing path under an existing folder is gone; an existing one is not', async () => {
    expect(await isGone(join(root, 'nope', 'deeper'))).toBe(true);
    expect(await isGone(root)).toBe(false);
  });

  it('isGone: a path on a drive that does not answer is NOT gone, just unknown', async () => {
    if (process.platform !== 'win32') return;
    expect(await isGone('Q:\\sumiu\\de\\vez')).toBe(false);
  });

  it('movePath moves a folder, creating the parents', async () => {
    await fs.mkdir(join(root, 'src', 'sub'), { recursive: true });
    await fs.writeFile(join(root, 'src', 'sub', 'f.txt'), 'x');
    await movePath(join(root, 'src'), join(root, 'dest', 'deep', 'src'));
    expect(await pathExists(join(root, 'src'))).toBe(false);
    expect(await fs.readFile(join(root, 'dest', 'deep', 'src', 'sub', 'f.txt'), 'utf8')).toBe('x');
  });

  it('movePath across volumes (EXDEV): copies, then removes the original', async () => {
    await fs.mkdir(join(root, 'src'));
    await fs.writeFile(join(root, 'src', 'f.txt'), 'dados');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    await movePath(join(root, 'src'), join(root, 'dest', 'src'));
    expect(await pathExists(join(root, 'src'))).toBe(false);
    expect(await fs.readFile(join(root, 'dest', 'src', 'f.txt'), 'utf8')).toBe('dados');
  });

  it('movePath with another error from rename leaves the original where it was', async () => {
    await fs.writeFile(join(root, 'f.txt'), 'x');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    await expect(movePath(join(root, 'f.txt'), join(root, 'out', 'f.txt'))).rejects.toThrow('busy');
    expect(await pathExists(join(root, 'f.txt'))).toBe(true);
  });

  it('movePath refuses to land on something that exists, and leaves both alone', async () => {
    await fs.writeFile(join(root, 'a.txt'), 'a');
    await fs.writeFile(join(root, 'b.txt'), 'b');
    await expect(movePath(join(root, 'a.txt'), join(root, 'b.txt'))).rejects.toThrow('destino já existe');
    expect(await fs.readFile(join(root, 'b.txt'), 'utf8')).toBe('b');
    expect(await pathExists(join(root, 'a.txt'))).toBe(true);
  });

  it('removeIfEmpty removes an empty folder and leaves a full one', async () => {
    await fs.mkdir(join(root, 'empty'));
    await fs.mkdir(join(root, 'full'));
    await fs.writeFile(join(root, 'full', 'x'), '1');
    expect(await removeIfEmpty(join(root, 'empty'))).toBe(true);
    expect(await removeIfEmpty(join(root, 'full'))).toBe(false);
    expect(await removeIfEmpty(join(root, 'missing'))).toBe(false);
    expect(await pathExists(join(root, 'full', 'x'))).toBe(true);
  });

  it('mapLimit keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([30, 5, 20, 1, 10, 2], 2, async (ms) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return ms * 2;
    });
    expect(results).toEqual([60, 10, 40, 2, 20, 4]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
