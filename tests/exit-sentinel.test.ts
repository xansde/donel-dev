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
  KILLER_CANDIDATES,
  maskCommandLine,
  maskForDisk,
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
const CURL = 'cu' + 'rl';

// Command lines of other programs on the PC, with the secret each one carries (review of #461).
const SECRET_LINES: ReadonlyArray<readonly [string, string]> = [
  ['mysql.exe -u root -pSenha123', 'Senha123'],
  ['psql.exe "postgresql://postgres:Pa$$w0rd.2026@db.supabase.co:5432/postgres"', 'Pa$$w0rd.2026'],
  ['git clone https://alexandre:S3nhaForte!@github.com/x/y', 'S3nhaForte!'],
  [CURL + ' -u admin:Hunter2!Hunter2 https://api.x', 'Hunter2!Hunter2'],
  ['aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['sshpass -p MinhaSenha#1 ssh root@vps', 'MinhaSenha#1'],
  ['tool.exe --password=abc!123 --token xyz.987', 'abc!123'],
  ['tool.exe --password=abc!123 --token xyz.987', 'xyz.987'],
  [`gh auth login --with-token ${FAKE_GH_TOKEN}`, FAKE_GH_TOKEN],
  // 2nd review of #461
  ['mysql.exe -u root --password Senha123', 'Senha123'],
  ['bash.exe -c "docker login -u x --password Senha123"', 'Senha123'],
  ['tool --password "Senha com espaco" --x', 'Senha com espaco'],
  ['tool --pass Pa55a', 'Pa55a'],
  ['tool --pwd Pa55b', 'Pa55b'],
  ['tool --passwd Pa55c', 'Pa55c'],
  ['tool --pw Pa55d', 'Pa55d'],
  ['tool --db-password Pa55e', 'Pa55e'],
  ['tool --client-secret Pa55f', 'Pa55f'],
  ['cmd.exe /c "set PGPASSWORD=Senha123&& psql -h db"', 'Senha123'],
  ["bash.exe -c 'PGPASSWORD=Senha123 psql -h db'", 'Senha123'],
  [`powershell.exe -Command "$env:TOKEN='Senha123'; gh api user"`, 'Senha123'],
  [CURL + ' -u "admin:Hunter2!" https://api.x', 'Hunter2!'],
  [CURL + ' -uadmin:Hunter2! https://api.x', 'Hunter2!'],
  [CURL + ' -H "Authorization: Basic YWRtaW46cA==" https://api.x', 'YWRtaW46cA=='],
  ['tool /p:Senha9 /user:x', 'Senha9'],
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
      // what the PowerShell writes to the disk: the command-line masks alone
      expect(maskForDisk(line), line).not.toContain(secret);
      expect(maskCommandLine(line), line).not.toContain(secret);
    }
    // the log also goes through the ledger's maskSecrets (a short Slack token no command-line mask knows)
    expect(maskCommandLine('cmd /c notify xoxb-12345-abcde')).not.toContain('xoxb-12345-abcde');

    // The PowerShell applies exactly these masks to the command line before writing it.
    const script = innerScript('C:\\x\\main-exit-1-2.json');
    const chain = COMMAND_LINE_MASKS.map((mask) => ` -replace '${mask.source.replace(/'/g, "''")}', '${mask.to}'`).join('');
    expect(script).toContain(`$cl = [string]$_.CommandLine${chain} }`);

    // Only the candidates to killer keep their command line; any other process of the PC keeps only its name.
    expect(script).toContain(`if ($_.Name -match '${KILLER_CANDIDATES}' -or $_.ParentProcessId -eq 6700)`);
    const candidate = new RegExp(KILLER_CANDIDATES, 'i');
    for (const name of ['taskkill.exe', 'powershell.exe', 'cmd.exe', 'bash.exe', 'node.exe', 'Donel Dev Alfa.exe']) {
      expect(candidate.test(name), name).toBe(true);
    }
    for (const name of ['psql.exe', 'mysql.exe', 'curl.exe', 'git.exe', 'ssh.exe']) {
      expect(candidate.test(name), name).toBe(false);
    }
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
    writeFileSync(`${exitRecordPath(dir, { pid: 300, startedAtMs: 3000 })}.tmp`, JSON.stringify({ pid: 300, startedAtMs: 3000, exitCode: 1 }));

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
