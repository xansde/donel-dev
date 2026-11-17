// t-d4f5879c — the main ended from outside (17/11 06:22) and nothing on the PC said who did it. The sentinel waits on
// the main from outside the app's process tree and leaves its exit code; the next boot names the cause from it.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildExitSentinelCommand,
  classifyExitCode,
  COMMAND_LINE_MASKS,
  exitRecordPath,
  maskCommandLine,
  takeExitRecord,
  takeStrayExitRecords,
} from '../src/main/exit-sentinel';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'exit-sentinel-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function decode(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

function innerScript(recordPath: string): string {
  const { args } = buildExitSentinelCommand({ pid: 6700, startedAtMs: 1794850936046, recordPath });
  const outer = decode(args[args.length - 1]);
  expect(outer).toContain('Start-Process');
  return decode(/-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(outer)?.[1] ?? '');
}

// Fake, built in pieces so no scanner reads it as a real token.
const FAKE_GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

// Command lines of other programs on the PC, with the secret each one carries (review of #461).
const SECRET_LINES: ReadonlyArray<readonly [string, string]> = [
  ['mysql.exe -u root -pSenha123', 'Senha123'],
  ['psql.exe "postgresql://postgres:Pa$$w0rd.2026@db.supabase.co:5432/postgres"', 'Pa$$w0rd.2026'],
  ['git clone https://alexandre:S3nhaForte!@github.com/x/y', 'S3nhaForte!'],
  ['curl -u admin:Hunter2!Hunter2 https://api.x', 'Hunter2!Hunter2'],
  ['aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['sshpass -p MinhaSenha#1 ssh root@vps', 'MinhaSenha#1'],
  ['tool.exe --password=abc!123 --token xyz.987', 'abc!123'],
  [`gh auth login --with-token ${FAKE_GH_TOKEN}`, FAKE_GH_TOKEN],
];

describe('exit sentinel', () => {
  it('tells apart who ended the main from its exit code', () => {
    expect(classifyExitCode(0)).toBe('quit');
    expect(classifyExitCode(1)).toBe('killed'); // taskkill /F, Task Manager, node process.kill
    expect(classifyExitCode(2)).toBe('killed-as-hung-by-second-copy'); // Chromium ProcessSingleton, RESULT_CODE_HUNG
    expect(classifyExitCode(-1)).toBe('stop-process'); // PowerShell Stop-Process
    expect(classifyExitCode(4294967295)).toBe('stop-process');
    expect(classifyExitCode(-1073740791)).toBe('crash'); // 0xC0000409, as PowerShell reads it (Int32)
    expect(classifyExitCode(0x80000003)).toBe('crash'); // a Chromium CHECK
    expect(classifyExitCode(0xc000013a)).toBe('console-closed'); // Ctrl+C / console closed, not a crash
    expect(classifyExitCode(7)).toBe('other');
  });

  it('never lets a secret of a command line through, on the disk (PowerShell) or in the log', () => {
    for (const [line, secret] of SECRET_LINES) {
      expect(maskCommandLine(line), line).not.toContain(secret);
    }
    // The PowerShell applies the same masks before writing: dropping one from the script fails here.
    const script = innerScript('C:\\x\\main-exit-1-2.json');
    for (const mask of COMMAND_LINE_MASKS) {
      expect(script).toContain(`-replace '${mask.source.replace(/'/g, "''")}', '${mask.to}'`);
    }
    // Only the candidates to killer keep their command line; any other process of the PC keeps only its name.
    expect(script).toMatch(/taskkill\|powershell\|pwsh\|cmd/);
  });

  it('hands over the record of a run once, and only a well formed one', () => {
    const dir = tempDir();
    const run = { pid: 6700, startedAtMs: Date.parse('2026-11-16T16:22:16.046Z') };
    const path = exitRecordPath(dir, run);
    expect(path).toBe(join(dir, `main-exit-6700-${run.startedAtMs}.json`));
    const alive = [{ pid: 9, ppid: 1, name: 'cmd.exe', startedAt: 'a', commandLine: 'cmd /c mysql -pSenha123' }];
    writeFileSync(path, JSON.stringify({ ...run, exitCode: 2, endedAt: '2026-11-17T09:22:03.000Z', aliveAfterExit: alive }), 'utf8');

    // another pid or another start in the file: not this run's record
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ ...run, pid: 6701, exitCode: 1, endedAt: 'x', aliveAfterExit: [] }));
    expect(takeExitRecord(join(dir, 'other.json'), run)).toBeNull();

    const record = takeExitRecord(path, run);
    expect(record).toMatchObject({ ...run, exitCode: 2, cause: 'killed-as-hung-by-second-copy', endedAt: '2026-11-17T09:22:03.000Z' });
    expect(record?.aliveAfterExit[0].commandLine).not.toContain('Senha123');
    expect(existsSync(path)).toBe(false);
    expect(takeExitRecord(path, run)).toBeNull();

    writeFileSync(path, '{not json', 'utf8');
    expect(takeExitRecord(path, run)).toBeNull();
    // an exit code the sentinel could not read is not a quit
    writeFileSync(path, JSON.stringify({ ...run, exitCode: null, endedAt: 'b', aliveAfterExit: [] }), 'utf8');
    expect(takeExitRecord(path, run)).toBeNull();
  });

  it('keeps one record per run, so a late record survives the next run and is still told at a later boot', () => {
    const dir = tempDir();
    const late = { pid: 100, startedAtMs: 1000 };
    const next = { pid: 200, startedAtMs: 2000 };
    writeFileSync(exitRecordPath(dir, late), JSON.stringify({ ...late, exitCode: 1, endedAt: 'a', aliveAfterExit: [] }));
    writeFileSync(exitRecordPath(dir, next), JSON.stringify({ ...next, exitCode: 0, endedAt: 'b', aliveAfterExit: [] }));
    writeFileSync(join(dir, 'main-events.log'), 'not a record');

    const strays = takeStrayExitRecords(dir, null);
    expect(strays.map((r) => [r.pid, r.cause]).sort()).toEqual([
      [100, 'killed'],
      [200, 'quit'],
    ]);
    expect(readdirSync(dir)).toEqual(['main-events.log']);

    // the previous run's own record is left for takeExitRecord
    writeFileSync(exitRecordPath(dir, late), JSON.stringify({ ...late, exitCode: 1, endedAt: 'a', aliveAfterExit: [] }));
    expect(takeStrayExitRecords(dir, late)).toEqual([]);
    expect(existsSync(exitRecordPath(dir, late))).toBe(true);
  });

  it('runs outside the app tree, writes the exit code before anything slow, and refuses a bad pid or path', () => {
    expect(() => buildExitSentinelCommand({ pid: 0, startedAtMs: 1, recordPath: 'C:\\x' })).toThrow();
    expect(() => buildExitSentinelCommand({ pid: 12, startedAtMs: Number.NaN, recordPath: 'C:\\x' })).toThrow();

    const userData = 'C:\\Users\\o\'brien O\u2019Neil\\AppData\\Roaming\\donel-dev\\main-exit-6700-1794850936046.json';
    const { file } = buildExitSentinelCommand({ pid: 6700, startedAtMs: 1794850936046, recordPath: userData });
    expect(file).toBe('powershell.exe');
    const inner = innerScript(userData);
    expect(inner).toContain('Get-Process -Id 6700');
    expect(inner).toContain('FromUnixTimeMilliseconds(1794850936046)');
    // every single quote PowerShell knows (' ‘ ’ ‚ ‛) is doubled inside a single-quoted string
    expect(inner).toContain("'C:\\Users\\o''brien O\u2019\u2019Neil\\AppData\\Roaming\\donel-dev\\main-exit-6700-1794850936046.json'");
    // the exit code reaches the disk before the process query, which may hang with WMI
    expect(inner.indexOf('$p.ExitCode')).toBeLessThan(inner.indexOf('Get-CimInstance'));
    expect(inner.indexOf('WriteAllText')).toBeLessThan(inner.indexOf('Get-CimInstance'));
  });
});
