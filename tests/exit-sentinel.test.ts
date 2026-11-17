// t-d4f5879c — the main ended from outside (17/11 06:22) and nothing on the PC said who did it. The sentinel waits on
// the main from outside the app's process tree and leaves its exit code; the next boot names the cause from it.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExitSentinelCommand, classifyExitCode, takeExitRecord } from '../src/main/exit-sentinel';

const dirs: string[] = [];
function recordPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'exit-sentinel-'));
  dirs.push(dir);
  return join(dir, 'main-exit.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function decode(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

describe('exit sentinel', () => {
  it('tells apart who ended the main from its exit code', () => {
    expect(classifyExitCode(0)).toBe('quit');
    expect(classifyExitCode(1)).toBe('killed'); // taskkill /F, Task Manager, node process.kill
    expect(classifyExitCode(2)).toBe('killed-as-hung-by-second-copy'); // Chromium ProcessSingleton, RESULT_CODE_HUNG
    expect(classifyExitCode(-1)).toBe('stop-process'); // PowerShell Stop-Process
    expect(classifyExitCode(4294967295)).toBe('stop-process');
    expect(classifyExitCode(-1073740791)).toBe('crash'); // 0xC0000409, as PowerShell reads it (Int32)
    expect(classifyExitCode(0xc0000005)).toBe('crash');
    expect(classifyExitCode(7)).toBe('other');
  });

  it('hands the record over once, only for the run it belongs to', () => {
    const path = recordPath();
    const run = { pid: 6700, startedAtMs: Date.parse('2026-11-16T16:22:16.046Z') };
    writeFileSync(path, JSON.stringify({ ...run, exitCode: 2, endedAt: '2026-11-17T09:22:03.000Z', recent: [{ pid: 9, ppid: 1, name: 'x.exe', startedAt: 'a', commandLine: 'x' }] }), 'utf8');

    // another run's record (pid reused, or an older copy): not this one, and left alone
    expect(takeExitRecord(path, { pid: 6700, startedAtMs: run.startedAtMs + 60_000 })).toBeNull();
    expect(existsSync(path)).toBe(true);

    expect(takeExitRecord(path, run)).toEqual({
      ...run,
      exitCode: 2,
      cause: 'killed-as-hung-by-second-copy',
      endedAt: '2026-11-17T09:22:03.000Z',
      recent: [{ pid: 9, ppid: 1, name: 'x.exe', startedAt: 'a', commandLine: 'x' }],
    });
    expect(existsSync(path)).toBe(false);
    expect(takeExitRecord(path, run)).toBeNull();

    writeFileSync(path, '{not json', 'utf8');
    expect(takeExitRecord(path, run)).toBeNull();

    // an exit code the sentinel could not read is not a quit
    writeFileSync(path, JSON.stringify({ ...run, exitCode: null, endedAt: 'b', recent: [] }), 'utf8');
    expect(takeExitRecord(path, run)).toBeNull();
  });

  it('hands over a record of any run when asked without one, and never logs a secret from a command line', () => {
    const path = recordPath();
    const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    writeFileSync(
      path,
      JSON.stringify({ pid: 5, startedAtMs: 9, exitCode: 1, endedAt: 'c', recent: [{ pid: 1, ppid: 2, name: 'cmd.exe', startedAt: 'd', commandLine: `gh auth login --with-token ${token}` }] }),
      'utf8',
    );
    const record = takeExitRecord(path);
    expect(record?.cause).toBe('killed');
    expect(record?.recent[0].commandLine).toBe('gh auth login --with-token ***');
    expect(JSON.stringify(record)).not.toContain(token);
  });

  it('runs outside the app tree and refuses a bad pid', () => {
    expect(() => buildExitSentinelCommand({ pid: 0, startedAtMs: 1, recordPath: 'C:\\x' })).toThrow();
    expect(() => buildExitSentinelCommand({ pid: 12, startedAtMs: Number.NaN, recordPath: 'C:\\x' })).toThrow();

    const userData = "C:\\Users\\o'brien\\AppData\\Roaming\\donel-dev\\main-exit.json";
    const { file, args } = buildExitSentinelCommand({ pid: 6700, startedAtMs: 1794850936046, recordPath: userData });
    expect(file).toBe('powershell.exe');
    // the hop: a PowerShell that starts the real sentinel and leaves, so a `taskkill /T` on the main never reaches it
    const outer = decode(args[args.length - 1]);
    expect(outer).toContain('Start-Process');
    const inner = decode(/-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(outer)?.[1] ?? '');
    expect(inner).toContain('Get-Process -Id 6700');
    expect(inner).toContain('FromUnixTimeMilliseconds(1794850936046)');
    expect(inner).toContain('WaitForExit()');
    expect(inner).toContain("'C:\\Users\\o''brien\\AppData\\Roaming\\donel-dev\\main-exit.json'");
  });
});
