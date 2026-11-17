// t-d4f5879c — the main ended from outside (17/11 06:22) and nothing on the PC said who did it. The sentinel waits on
// the main from outside the app's process tree and leaves its exit code; the next boot names the cause from it.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildExitSentinelCommand,
  classifyExitCode,
  COMMAND_LINE_CUT,
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
  // 3rd review of #461 (t-c1b710c2)
  ['bash.exe -c "export GH_TOKEN=\\"Senha123\\"; gh api user"', 'Senha123'],
  ['powershell.exe -Command "$env:X_TOKEN = \\"Senha124\\"; gh api"', 'Senha124'],
  ['cmd /c "set DB_PASSWORD=\\"Senha125\\""', 'Senha125'],
  ['powershell.exe -Command "$c = @{Password=\\"Senha126\\"}"', 'Senha126'],
  ["powershell.exe -Command \"$s = ConvertTo-SecureString 'Senha127' -AsPlainText -Force\"", 'Senha127'],
  ["powershell.exe -Command \"New-LocalUser x -Password (ConvertTo-SecureString 'Senha128' -AsPlainText -Force)\"", 'Senha128'],
  [CURL + " -H 'X-API-Key: Senha129' https://api.x", 'Senha129'],
  [CURL + " -H 'PRIVATE-TOKEN: Senha130' https://api.x", 'Senha130'],
  [CURL + ` -d '{"password":"Senha131"}' https://api.x`, 'Senha131'],
  ["node.exe -e \"connect({user:'root',password:'Senha132'})\"", 'Senha132'],
  ["powershell.exe -Command \"@{'x-api-key'='Senha133'}\"", 'Senha133'],
  [CURL + ' -H "Authorization: token Senha134" https://api.x', 'Senha134'],
  // the generic rule alone: no flag, no name in front
  ['cmd /c echo q7Rk2pL9_xW4mZ8n-B3vC6tY1hJ5', 'q7Rk2pL9_xW4mZ8n-B3vC6tY1hJ5'],
  ['cmd /c echo wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
];

// What says who ended the main must survive the masks (3rd review of #461, item 4).
const IDENTITY_LINES: ReadonlyArray<readonly [string, string]> = [
  ['node.exe -p "process.kill(6700)"', 'process.kill(6700)'],
  ['powershell.exe -Command "Stop-Process -PassThru -Id 6700"', 'Stop-Process -PassThru -Id 6700'],
  ['powershell.exe -NoProfile -File C:/Users/compu/seazone/scripts/limpa.ps1', 'C:/Users/compu/seazone/scripts/limpa.ps1'],
  ['"C:/Program Files/nodejs/node.exe" C:/Users/compu/AppData/Roaming/npm/node_modules/x/cli.js', 'C:/Users/compu/AppData/Roaming/npm/node_modules/x/cli.js'],
  ['bash.exe -c "/home/alexandrelentz/seazone/donel/killall.sh"', '/home/alexandrelentz/seazone/donel/killall.sh'],
  ['taskkill.exe /PID 6700 /T /F', 'taskkill.exe /PID 6700 /T /F'],
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

    // The PowerShell applies exactly these masks to the command line, cut first, before writing it.
    const script = innerScript('C:\\x\\main-exit-1-2.json');
    const chain = COMMAND_LINE_MASKS.map(
      (mask) => ` ${mask.caseSensitive ? '-creplace' : '-replace'} '${mask.source.replace(/'/g, "''")}', '${mask.to}'`,
    ).join('');
    expect(script).toContain(`if ($cl.Length -gt ${COMMAND_LINE_CUT}) { $cl = $cl.Substring(0, ${COMMAND_LINE_CUT}) }; $cl = $cl${chain} }`);

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

  it('keeps legible what says who ended the main, and masks a long line in linear-ish time', () => {
    for (const [line, kept] of IDENTITY_LINES) {
      expect(maskForDisk(line), line).toContain(kept);
      expect(maskCommandLine(line), line).toContain(kept);
    }
    // the worst cases of the 3rd review, at the length the PowerShell cuts to
    for (const line of ['pw'.repeat(COMMAND_LINE_CUT / 2), 'a'.repeat(COMMAND_LINE_CUT), `x=${'pw'.repeat(COMMAND_LINE_CUT / 2 - 1)}`]) {
      const started = performance.now();
      maskForDisk(line);
      expect(performance.now() - started, line.slice(0, 12)).toBeLessThan(1000);
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
