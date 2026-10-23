// 016-jobu-faxina (T009) - which repos a sweep looks at: the cwd read from the head of a transcript, the repos found
// under the roots, the activity of the transcripts per repo and the selection by the stamp of the last sweep.
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCwdFromHead, scanClaudeProjects, type ClaudeProjectFolder } from '../src/main/sweep/claude-projects';
import { dedupePaths, discoverReposInRoots, selectActiveRepos, transcriptActivity } from '../src/main/sweep/discovery';

describe('the cwd of a transcript', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'sweep-disc-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('is the first "cwd" of the head, with the escapes of the JSON undone', async () => {
    const file = join(root, 'a.jsonl');
    await fs.writeFile(file, `${JSON.stringify({ type: 'custom-title' })}\n${JSON.stringify({ type: 'user', cwd: 'C:\\Users\\x\\seazone\\atlas', n: 1 })}\n${JSON.stringify({ cwd: 'C:\\later' })}\n`);
    expect(await readCwdFromHead(file)).toBe('C:\\Users\\x\\seazone\\atlas');
  });

  it('survives a head cut in the middle of a long record, and a file with no cwd or no file at all', async () => {
    const file = join(root, 'big.jsonl');
    await fs.writeFile(file, `${JSON.stringify({ cwd: 'C:\\w\\atlas' })}\n${'x'.repeat(300_000)}`);
    expect(await readCwdFromHead(file)).toBe('C:\\w\\atlas');
    await fs.writeFile(join(root, 'none.jsonl'), '{"type":"summary"}\n');
    expect(await readCwdFromHead(join(root, 'none.jsonl'))).toBeNull();
    expect(await readCwdFromHead(join(root, 'missing.jsonl'))).toBeNull();
  });

  it('scanClaudeProjects: one entry per folder, the cwd from the first file that has one, the newest transcript time, and no content', async () => {
    await fs.mkdir(join(root, 'p1'));
    await fs.writeFile(join(root, 'p1', 'a.jsonl'), '{"type":"summary"}\n');
    await fs.writeFile(join(root, 'p1', 'b.jsonl'), `${JSON.stringify({ cwd: 'C:\\w\\atlas' })}\n`);
    const old = new Date(2020, 0, 1);
    await fs.utimes(join(root, 'p1', 'a.jsonl'), old, old);
    await fs.mkdir(join(root, 'empty'));
    await fs.writeFile(join(root, 'loose.txt'), 'not a folder');
    const folders = await scanClaudeProjects(root);
    expect(folders.map((folder) => folder.name).sort()).toEqual(['empty', 'p1']);
    const p1 = folders.find((folder) => folder.name === 'p1');
    expect(p1?.cwd).toBe('C:\\w\\atlas');
    expect(p1?.newestTranscriptMs).toBeGreaterThan(old.getTime());
    expect(folders.find((folder) => folder.name === 'empty')).toMatchObject({ cwd: null, newestTranscriptMs: 0 });
    expect(JSON.stringify(folders)).not.toContain('summary');
  });

  it('scanClaudeProjects of a directory that does not exist is empty', async () => {
    expect(await scanClaudeProjects(join(root, 'nope'))).toEqual([]);
  });

  it('discoverReposInRoots: a repo ends the descent, a .git FILE (worktree) is not a repo, node_modules and _archive are skipped', async () => {
    const make = async (...parts: string[]): Promise<void> => void (await fs.mkdir(join(root, ...parts), { recursive: true }));
    await make('seazone', 'atlas', '.git');
    await make('seazone', 'atlas', 'inner', '.git'); // below a repo: never looked at
    await make('seazone', 'group', 'vega', '.git'); // two levels deep
    await make('seazone', 'atlas-wt', 'a');
    await fs.writeFile(join(root, 'seazone', 'atlas-wt', 'a', '.git'), 'gitdir: elsewhere');
    await make('seazone', '_archive', 'faxina', '.git');
    await make('seazone', 'node_modules', 'pkg', '.git');
    await make('seazone', '.hidden', '.git');
    const found = (await discoverReposInRoots([join(root, 'seazone'), join(root, 'no-such-root')])).map((path) => path.slice(root.length + 1).replace(/\\/g, '/')).sort();
    expect(found).toEqual(['seazone/atlas', 'seazone/group/vega']);
  });
});

describe('dedupePaths', () => {
  it('drops the same path spelled with another case or slash, keeping the first', () => {
    expect(dedupePaths(['C:\\W\\Atlas', 'c:/w/atlas', 'C:\\w\\vega'])).toEqual(['C:\\W\\Atlas', 'C:\\w\\vega']);
  });
});

describe('transcriptActivity and selectActiveRepos', () => {
  const folder = (cwd: string | null, newestTranscriptMs: number): ClaudeProjectFolder => ({ name: 'f', absPath: 'p', cwd, newestTranscriptMs });
  const repos = ['C:\\w\\atlas', 'C:\\w\\vega'];

  it('the newest transcript per repo, counting worktrees of the repo and ignoring cwd-less folders', () => {
    const latest = transcriptActivity(
      [folder('C:\\w\\atlas', 100), folder('C:\\w\\atlas-wt\\a', 300), folder('C:\\w\\vega\\sub', 200), folder(null, 999), folder('C:\\w\\other', 999), folder('C:\\w\\vega', 0)],
      repos,
    );
    expect(latest.get('C:\\w\\atlas')).toBe(300);
    expect(latest.get('C:\\w\\vega')).toBe(200);
    expect(latest.size).toBe(2);
  });

  it('without a stamp every repo enters and git is not asked', async () => {
    const asked: string[] = [];
    const picked = await selectActiveRepos(repos, null, new Map(), async (repo) => {
      asked.push(repo);
      return null;
    });
    expect(picked).toEqual(repos);
    expect(asked).toEqual([]);
  });

  it('with a stamp: a newer transcript settles it; otherwise the reflog decides; the stamp itself is not "after" it', async () => {
    const transcripts = new Map([['C:\\w\\atlas', 5_000]]);
    const asked: string[] = [];
    const git = async (repo: string): Promise<number | null> => {
      asked.push(repo);
      return repo === 'C:\\w\\vega' ? 4_000 : null;
    };
    expect(await selectActiveRepos(repos, 3_000, transcripts, git)).toEqual(repos);
    expect(asked).toEqual(['C:\\w\\vega']); // atlas was settled by its transcript
    expect(await selectActiveRepos(repos, 4_000, new Map([['C:\\w\\atlas', 4_000]]), git)).toEqual([]);
  });
});
