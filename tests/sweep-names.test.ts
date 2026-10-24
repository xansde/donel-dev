// 016-jobu-faxina (T003) - the naming rules of the sweep: the slug Claude gives a folder, who owns a session whose
// folder is gone, how the sweep folder and the subfolder of each repo are called, and where `_archive` lives. Pure.
import { describe, expect, it } from 'vitest';
import { formatBytes } from '../src/shared/format-bytes';
import { chooseArchiveParent, localDay, nextSweepFolderName, ownerRepo, repoFolderNames, repoSlugs } from '../src/main/sweep/names';

describe('formatBytes', () => {
  it('whole numbers up to KB, one decimal under 10 from MB up, none after, comma as separator', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(formatBytes(319 * 1024 * 1024)).toBe('319 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1,2 GB');
  });

  it('a value that rounds up to 10 does not print "10,0"', () => {
    expect(formatBytes(9.97 * 1024 * 1024)).toBe('10 MB');
  });

  it('negative and non-finite counts are 0 B', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('repoSlugs', () => {
  it('is the path with ":", "\\" and "/" turned into "-"', () => {
    expect(repoSlugs('C:\\Users\\xansd\\seazone\\donel-dev')[0]).toBe('C--Users-xansd-seazone-donel-dev');
    expect(repoSlugs('/home/x/donel-dev')[0]).toBe('-home-x-donel-dev');
  });

  it('also gives the form where every non-alphanumeric becomes "-" (spaces, accents, dots), once when they are equal', () => {
    expect(repoSlugs('C:\\Users\\x\\Área de Trabalho\\app.v2')).toEqual(['C--Users-x-Área de Trabalho-app.v2', 'C--Users-x--rea-de-Trabalho-app-v2']);
    expect(repoSlugs('C:\\Users\\xansd\\seazone\\donel-dev')).toHaveLength(1);
  });
});

describe('ownerRepo: whose is a folder that no longer exists', () => {
  const repos = [{ path: 'C:\\Users\\x\\seazone\\donel-dev' }, { path: 'C:\\Users\\x\\seazone\\donel-dev-publico' }, { path: 'C:\\Users\\x\\seazone\\atlas' }];

  it('a path inside the repo', () => {
    expect(ownerRepo('C:\\Users\\x\\seazone\\donel-dev\\.claude\\worktrees\\a', repos)).toBe(repos[0]?.path);
  });

  it('is case-insensitive and indifferent to the kind of slash', () => {
    expect(ownerRepo('c:/users/X/Seazone/ATLAS/sub', repos)).toBe(repos[2]?.path);
  });

  it('a sibling folder that starts with "<repo>-" (the worktree folders)', () => {
    expect(ownerRepo('C:\\Users\\x\\seazone\\atlas-wt\\feature-a', repos)).toBe(repos[2]?.path);
  });

  it('the longest repo wins, so "donel-dev-publico" is not taken for "donel-dev"', () => {
    expect(ownerRepo('C:\\Users\\x\\seazone\\donel-dev-publico\\src', repos)).toBe(repos[1]?.path);
    expect(ownerRepo('C:\\Users\\x\\seazone\\donel-dev-wt\\a', repos)).toBe(repos[0]?.path);
  });

  it('a scratchpad of the repo, which lives in %TEMP% with the slug in its path', () => {
    const cwd = 'C:\\Users\\x\\AppData\\Local\\Temp\\claude\\C--Users-x-seazone-atlas\\abc\\scratchpad';
    expect(ownerRepo(cwd, repos)).toBe(repos[2]?.path);
  });

  it('a path of no known repo has no owner', () => {
    expect(ownerRepo('C:\\Users\\x\\pessoal\\outro', repos)).toBeNull();
    expect(ownerRepo('C:\\Users\\x\\seazone\\atlasx', repos)).toBeNull();
  });
});

describe('the sweep folder', () => {
  it('is "faxina-<day>", and a second one the same day takes "-2", then "-3"', () => {
    expect(nextSweepFolderName('2026-10-23', [])).toBe('faxina-2026-10-23');
    expect(nextSweepFolderName('2026-10-23', ['faxina-2026-10-23'])).toBe('faxina-2026-10-23-2');
    expect(nextSweepFolderName('2026-10-23', ['faxina-2026-10-23', 'faxina-2026-10-23-2', 'outra'])).toBe('faxina-2026-10-23-3');
  });

  it('other days do not count', () => {
    expect(nextSweepFolderName('2026-10-24', ['faxina-2026-10-23'])).toBe('faxina-2026-10-24');
  });

  it('the day is the LOCAL date', () => {
    expect(localDay(new Date(2026, 9, 3, 23, 30).getTime())).toBe('2026-10-03');
  });
});

describe('repoFolderNames', () => {
  it('is the folder name of each repo, and two repos with the same name do not share a subfolder', () => {
    expect(repoFolderNames(['C:\\a\\atlas', 'C:\\b\\atlas', 'C:\\a\\vega'])).toEqual(['atlas', 'atlas-2', 'vega']);
  });
});

describe('chooseArchiveParent', () => {
  it('is the parent shared by most repos; a tie goes to the first', () => {
    expect(chooseArchiveParent(['C:\\s\\a', 'C:\\s\\b', 'C:\\p\\c'])).toBe('C:\\s');
    expect(chooseArchiveParent(['C:\\p\\c', 'C:\\s\\a'])).toBe('C:\\p');
  });
});
