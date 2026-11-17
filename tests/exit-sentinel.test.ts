// t-d4f5879c — the main ended from outside (17/11 06:22) and nothing on the PC said who did it. The sentinel waits on
// the main from outside the app's process tree and leaves its exit code; the next boot names the cause from it.
// t-c1b710c2 — of the processes around the end, only the evidence of a kill reaches the disk, never a command line.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildExitSentinelCommand,
  classifyExitCode,
  COMMAND_LINE_CUT,
  exitRecordPath,
  extractKillEvidence,
  KILLER_CANDIDATES,
  type KillEvidence,
  maskForLog,
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

function utf16Base64(text: string): string {
  return Buffer.from(text, 'utf16le').toString('base64');
}

// Fake, built in pieces so no scanner reads it as a real token.
const FAKE_GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const CURL = 'cu' + 'rl';

// Command lines of other programs on the PC, with the secret each one carries (reviews of #461 and of #465).
const SECRET_LINES: ReadonlyArray<readonly [string, string]> = [
  ['mysql.exe -u root -pSenha123', 'Senha123'],
  ['psql.exe "postgresql://postgres:Pa$$w0rd.2026@db.supabase.co:5432/postgres"', 'Pa$$w0rd.2026'],
  ['git clone https://alexandre:S3nhaForte!@github.com/x/y', 'S3nhaForte!'],
  [CURL + ' -u admin:Hunter2!Hunter2 https://api.x', 'Hunter2!Hunter2'],
  ['aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['sshpass -p MinhaSenha#1 ssh root@vps', 'MinhaSenha#1'],
  ['tool.exe --password=abc!123 --token xyz.987', 'abc!123'],
  [`gh auth login --with-token ${FAKE_GH_TOKEN}`, FAKE_GH_TOKEN],
  ['bash.exe -c "docker login -u x --password Senha123"', 'Senha123'],
  ['cmd.exe /c "set PGPASSWORD=Senha123&& psql -h db"', 'Senha123'],
  [`powershell.exe -Command "$env:TOKEN='Senha123'; gh api user"`, 'Senha123'],
  ['bash.exe -c "export GH_TOKEN=\\"Senha123\\"; gh api user"', 'Senha123'],
  ["powershell.exe -Command \"New-LocalUser x -Password (ConvertTo-SecureString 'Senha128' -AsPlainText -Force)\"", 'Senha128'],
  [CURL + " -H 'X-API-Key: Senha129' https://api.x", 'Senha129'],
  [CURL + ` -d '{"password":"Senha131"}' https://api.x`, 'Senha131'],
  ['cmd.exe /c sqlcmd -S localhost -U sa -P Senha127 -Q "select 1"', 'Senha127'],
  ['cmd.exe /c setx DB_PASSWORD Senha132', 'Senha132'],
  ['cmd.exe /c gh secret set API_KEY --body "Senha135"', 'Senha135'],
  ['cmd.exe /c net use Z: \\\\srv\\share Senha130 /user:DOM\\alex', 'Senha130'],
  // the Claude Code Bash-tool wrapper, which turns each ' inside the command into '\"'\"'
  [`bash.exe -c "eval 'cd /tmp && PGPASSWORD='\\"'\\"'Senha991'\\"'\\"' true' < /dev/null"`, 'Senha991'],
  // a kill command next to a secret: in a $(…), after & or ), in a block, in the same node -e
  ['bash.exe -c "kill $(' + CURL + ' -s -u admin:Senha301 http://x/pid)"', 'Senha301'],
  ['bash.exe -c "kill -9 6700 $(mysql -uroot -pSenha302 -N -e x)"', 'Senha302'],
  ["powershell.exe -Command \"Stop-Process -Id (irm http://x/pid -Headers @{Authorization='Bearer Senha303'})\"", 'Senha303'],
  ['powershell.exe -Command "Stop-Process -Id 6700 -Force & ' + CURL + '.exe -u admin:Senha304 http://x"', 'Senha304'],
  ["powershell.exe -Command \"if (Get-Process ollama -EA 0) { $env:API_KEY = 'Senha305' }\"", 'Senha305'],
  ["powershell.exe -Command \"if ($a) { Stop-Process -Id 6700 -Force } else { $env:GH_TOKEN = 'Senha306' }\"", 'Senha306'],
  ["node.exe -e \"process.kill(6700); require('x').login('Senha307')\"", 'Senha307'],
  ["node.exe -e \"process.kill(Number(require('child_process').execSync('" + CURL + " -u a:Senha308 u')))\"", 'Senha308'],
  ['bash.exe -c "' + CURL + ' -s https://x.com/Senha309/run.sh | bash"', 'Senha309'],
  ['powershell.exe -File C:\\x\\run.ps1 -Token Senha310', 'Senha310'],
  [`powershell.exe -NoProfile -EncodedCommand ${utf16Base64("$p = 'Senha311'; Stop-Process -Id 6700 -Force")}`, 'Senha311'],
  [`powershell.exe -File C:\\Users\\a\\${FAKE_GH_TOKEN}\\kill.ps1`, FAKE_GH_TOKEN],
  [
    "powershell.exe -Command \"Invoke-Command -ComputerName srv -ScriptBlock { Stop-Process -Id 6700 -Force } -Credential (New-Object PSCredential('u', (ConvertTo-SecureString 'Senha312' -AsPlainText -Force)))\"",
    'Senha312',
  ],
];

// A kill command that carries a password: the kill stays, the password does not.
const KILL_WITH_SECRET: ReadonlyArray<readonly [string, string, string]> = [
  ['taskkill.exe /S pc-alexandre /U alexandre /P Senha201 /PID 6700 /F', 'Senha201', 'taskkill.exe /S pc-alexandre /PID 6700 /F'],
  ['cmd.exe /c "taskkill /S pc /U a /p Senha202 /PID 6700 /F"', 'Senha202', 'taskkill /S pc /PID 6700 /F'],
  ['cmd.exe /c "wmic /user:alexandre /password Senha203 process where processid=6700 delete"', 'Senha203', 'wmic process where processid=6700 delete'],
  ['cmd.exe /c "wmic /node:pc /user:a /password:Senha204 process where processid=6700 delete"', 'Senha204', 'wmic /node:pc process where processid=6700 delete'],
  // Git Bash turns /P into //P; taskkill also takes -p
  ['bash.exe -c "taskkill //S pc //U alex //P Senha205 //PID 6700 //F"', 'Senha205', 'taskkill //S pc //PID 6700 //F'],
  ['cmd.exe /c "taskkill -s srv -u a -p Senha206 -pid 6700 -f"', 'Senha206', 'taskkill -s srv -pid 6700 -f'],
  ['cmd.exe /c "taskkill /s srv /u a /p:Senha207 /pid 6700"', 'Senha207', 'taskkill /s srv /pid 6700'],
  ['cmd.exe /c "wmic process where processid=6700 delete -password:Senha208"', 'Senha208', 'wmic process where processid=6700 delete'],
  ['bash.exe -c "sshpass -p Senha209 ssh root@vps kill 6700"', 'Senha209', 'kill 6700'],
];

// What says who ended the main (reviews of #461 and #465): the kill and the script stay legible.
const IDENTITY_LINES: ReadonlyArray<readonly [string, string]> = [
  ['node.exe -p "process.kill(6700)"', 'process.kill(6700)'],
  ['powershell.exe -Command "Stop-Process -PassThru -Id 6700"', 'Stop-Process -PassThru -Id 6700'],
  ["powershell.exe -Command \"Stop-Process -processname 'Donel Dev Alfa' -force\"", "Stop-Process -processname 'Donel Dev Alfa' -force"],
  ['cmd.exe /c powershell -Command "Stop-Process -Name \\"Donel Dev Alfa\\" -Force"', 'Stop-Process -Name \\"Donel Dev Alfa\\" -Force'],
  ["powershell.exe -Command \"Get-Process 'Donel Dev Alfa' | Stop-Process\"", "Get-Process 'Donel Dev Alfa'"],
  ["powershell.exe -Command \"(Get-Process -Id 6700).Kill()\"", 'Get-Process -Id 6700'],
  ['cmd.exe /c "taskkill /IM "Donel Dev Alfa.exe" /F"', 'taskkill /IM "Donel Dev Alfa.exe" /F'],
  ['C:\\Windows\\System32\\taskkill.exe /PID 6700 /T /F', 'taskkill.exe /PID 6700 /T /F'],
  ['powershell.exe -NoProfile -File C:/Users/compu/seazone/scripts/limpa.ps1', 'seazone/scripts/limpa.ps1'],
  ['powershell.exe -File C:\\Users\\compu\\seazone\\scripts\\kill-orphan-electron-processes.ps1', 'seazone\\scripts\\kill-orphan-electron-processes.ps1'],
  ['node.exe scripts/killDonelProcess.js 6700', 'scripts/killDonelProcess.js'],
  ['cmd.exe /c "C:\\tools\\mata app.cmd"', 'C:\\tools\\mata app.cmd'],
  [
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\cli.js"',
    '@anthropic-ai\\claude-code\\cli.js',
  ],
  ['bash.exe -c "$HOME/seazone/donel/scripts/kill.sh 6700"', 'donel/scripts/kill.sh'],
  ['bash.exe -c "pkill -f donel-dev-alfa-electron-main"', 'pkill -f donel-dev-alfa-electron-main'],
  ['bash.exe -c "pkill -f \\"Donel Dev Alfa\\""', 'pkill -f \\"Donel Dev Alfa\\"'],
  ['python.exe -c "import os, signal; os.kill(6700, signal.SIGTERM)"', 'os.kill(6700, signal.SIGTERM)'],
  ['python.exe -c "import psutil; psutil.Process(6700).kill()"', 'psutil.Process(6700).kill()'],
  [
    "powershell.exe -Command \"Get-CimInstance Win32_Process -Filter 'ProcessId=6700' | Invoke-CimMethod -MethodName Terminate\"",
    'Get-CimInstance Win32_Process ProcessId=6700 | Invoke-CimMethod Terminate',
  ],
  ["cmd.exe /c \"wmic process where \"name='Donel Dev Alfa.exe'\" delete\"", "wmic process where name='Donel Dev Alfa.exe' delete"],
  ['powershell.exe -Command "$p = 6700; Stop-Process -Id $p -Force"', 'Stop-Process -Id $p -Force'],
  ["bash.exe -c \"pid=$(pgrep -f 'Donel Dev'); kill $pid\"", "kill $pid | pgrep -f 'Donel Dev'"],
  ["powershell.exe -Command \"Get-Process | Where-Object { $_.Name -like 'Donel*' } | Stop-Process -Force\"", "$_.Name -like 'Donel*'"],
  ['powershell.exe -Command "[Diagnostics.Process]::GetProcessById(6700).Kill()"', 'GetProcessById(6700).Kill()'],
  ['node.exe -e "process.kill(Number(process.argv[1]))" 6700', 'process.kill(Number(process.argv[1]))'],
  // the real shape of a Claude Code Bash-tool process: the command sits past a ~480-character wrapper
  [
    '"C:\\Program Files\\Git\\usr\\bin\\bash.exe" -c "source /c/Users/compu/.claude/shell-snapshots/snapshot-bash-1794909251041-vuvkav.sh 2>/dev/null || true && export TEMP=\'C:\\Users\\compu\\AppData\\Local\\Temp\' && { \\builtin unalias -- \'which\'; } >/dev/null 2>&1 || true && eval \'kill -9 6700\' < /dev/null && pwd -P >| /c/Users/compu/AppData/Local/Temp/claude-f650-cwd"',
    'kill -9 6700',
  ],
  // every spelling of -EncodedCommand PowerShell runs, and the second block of a line
  [`powershell.exe -NoProfile -EncodedCommand ${utf16Base64('Stop-Process -Id 6700 -Force')}`, 'Stop-Process -Id 6700 -Force'],
  [`powershell.exe -ec ${utf16Base64('Stop-Process -Id 6700')}`, 'Stop-Process -Id 6700'],
  [`pwsh.exe --EncodedCommand ${utf16Base64('Stop-Process -Id 6700')}`, 'Stop-Process -Id 6700'],
  [`powershell.exe -enco ${utf16Base64('Stop-Process -Id 6700')}`, 'Stop-Process -Id 6700'],
  [`powershell.exe -EncodedCommand:${utf16Base64('Stop-Process -Id 6700')}`, 'Stop-Process -Id 6700'],
  [`powershell.exe -e ${utf16Base64('Write-Host hi')}; powershell.exe -enc ${utf16Base64('taskkill /PID 6700 /F')}`, 'taskkill /PID 6700 /F'],
  // a Start-Process hop, like the sentinel's own: the inner block is decoded too
  [
    `powershell.exe -EncodedCommand ${utf16Base64(`Start-Process powershell.exe -ArgumentList '-EncodedCommand','${utf16Base64('Stop-Process -Id 6700')}'`)}`,
    'Stop-Process -Id 6700',
  ],
];

/** Everything the PowerShell is fed in the test that runs it, with what its disk record must say. */
const CUT_LINE = `${'x'.repeat(COMMAND_LINE_CUT)} taskkill /PID 6700 /F`;
const ALL_LINES = [
  ...SECRET_LINES.map(([line]) => line),
  ...KILL_WITH_SECRET.map(([line]) => line),
  ...IDENTITY_LINES.map(([line]) => line),
  CUT_LINE,
  'node.exe server.js --port 16700',
  // more blocks than ENCODED_MAX: the PowerShell stops decoding where this side does
  `powershell.exe ${[1, 2, 3, 4].map((n) => `-ec ${utf16Base64(`Write-Host ${n}`)}`).join(' ')} -ec ${utf16Base64('taskkill /PID 6700 /F')}`,
];

/** powershell.exe on Windows, pwsh elsewhere when installed; null when there is none. */
function powerShell(): string | null {
  if (process.platform === 'win32') return 'powershell.exe';
  return spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'pwsh' : null;
}

/** Runs the Get-KillEvidence of the REAL inner script on each line, the way the record is built. */
function runGetKillEvidence(shell: string, lines: readonly string[]): KillEvidence[] {
  const inner = innerScript('C:\\x\\main-exit-6700-2.json');
  const start = inner.indexOf('function Get-KillEvidence');
  const fn = inner.slice(start, inner.indexOf('\n}', start) + 2);
  const dir = tempDir();
  const input = join(dir, 'lines.json');
  const output = join(dir, 'out.json');
  writeFileSync(input, JSON.stringify(lines), 'utf8');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    fn,
    `$lines = [IO.File]::ReadAllText('${input}', [Text.Encoding]::UTF8) | ConvertFrom-Json`,
    '$out = @(foreach ($l in $lines) { $ev = Get-KillEvidence ([string]$l); [ordered]@{ evidence = @($ev.evidence); mentionsMain = $ev.mentionsMain } })',
    `[IO.File]::WriteAllText('${output}', (ConvertTo-Json -InputObject $out -Depth 5 -Compress), (New-Object Text.UTF8Encoding $false))`,
  ].join('\n');
  const file = join(dir, 'probe.ps1');
  writeFileSync(file, `\ufeff${script}`, 'utf8');
  const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(output, 'utf8')) as KillEvidence[];
}

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

  it('writes no secret: a command line never reaches the disk, only the evidence of a kill', () => {
    for (const [line, secret] of SECRET_LINES) {
      const { evidence } = extractKillEvidence(line, 6700);
      expect(evidence.join(' '), line).not.toContain(secret);
    }
    for (const [line, secret, kept] of KILL_WITH_SECRET) {
      const { evidence, mentionsMain } = extractKillEvidence(line, 6700);
      expect(evidence.join(' '), line).not.toContain(secret);
      expect(evidence, line).toContain(kept);
      expect(mentionsMain, line).toBe(true);
    }
    // the log also goes through the ledger's maskSecrets (a short Slack token no evidence mask knows)
    expect(maskForLog('taskkill /PID 1 & notify xoxb-12345-abcde')).not.toContain('xoxb-12345-abcde');

    // The record searches only a candidate's line, through Get-KillEvidence; the line itself is written nowhere.
    const script = innerScript('C:\\x\\main-exit-1-2.json');
    expect(script).toContain(
      `if ($_.Name -match '${KILLER_CANDIDATES}' -or $_.ParentProcessId -eq 6700) { $ev = Get-KillEvidence ([string]$_.CommandLine) }`,
    );
    expect(script.match(/CommandLine/gi)).toHaveLength(1);

    // Only the candidates to killer are searched; any other process of the PC keeps only its name.
    const candidate = new RegExp(KILLER_CANDIDATES, 'i');
    for (const name of ['taskkill.exe', 'wmic.exe', 'py.exe', 'pythonw.exe', 'powershell.exe', 'cmd.exe', 'bash.exe', 'node.exe', 'Donel Dev Alfa.exe']) {
      expect(candidate.test(name), name).toBe(true);
    }
    for (const name of ['psql.exe', 'mysql.exe', 'curl.exe', 'git.exe', 'ssh.exe']) {
      expect(candidate.test(name), name).toBe(false);
    }
  });

  it('keeps legible what says who ended the main, and searches a long line in linear time', () => {
    for (const [line, kept] of IDENTITY_LINES) {
      const { evidence, mentionsMain } = extractKillEvidence(line, 6700);
      expect(evidence.join(' | '), line).toContain(kept);
      expect(evidence.map(maskForLog).join(' | '), line).toContain(kept);
      if (kept.includes('6700')) expect(mentionsMain, line).toBe(true);
    }
    expect(extractKillEvidence('node.exe server.js --port 16700', 6700).mentionsMain).toBe(false);
    expect(extractKillEvidence(CUT_LINE, 6700)).toEqual({ evidence: [], mentionsMain: false });
    const worst = [
      'pw'.repeat(COMMAND_LINE_CUT / 2),
      'a'.repeat(COMMAND_LINE_CUT),
      'kill '.repeat(COMMAND_LINE_CUT / 5),
      `x ${'/a'.repeat(COMMAND_LINE_CUT / 2)}`,
      ` -e ${'A'.repeat(COMMAND_LINE_CUT)}`,
      `taskkill ${'/im "a '.repeat(COMMAND_LINE_CUT / 7)}`,
    ];
    for (const line of worst) {
      const started = performance.now();
      extractKillEvidence(line, 6700);
      expect(performance.now() - started, line.slice(0, 12)).toBeLessThan(1000);
    }
  });

  // The disk is written by the PowerShell, so the PowerShell itself is run: same evidence as here, and no secret.
  it.skipIf(!powerShell())('writes from the PowerShell the same evidence, with no secret', { timeout: 60_000 }, () => {
    const fromDisk = runGetKillEvidence(powerShell() as string, ALL_LINES);
    expect(fromDisk).toHaveLength(ALL_LINES.length);
    ALL_LINES.forEach((line, i) => {
      expect(fromDisk[i], line).toEqual(extractKillEvidence(line, 6700));
    });
    const secrets = [...SECRET_LINES.map(([, secret]) => secret), ...KILL_WITH_SECRET.map(([, secret]) => secret)];
    const disk = JSON.stringify(fromDisk);
    for (const secret of secrets) expect(disk, secret).not.toContain(secret);
  });

  it('hands over the record of a run once, and only a well formed one', () => {
    const dir = tempDir();
    const run = { pid: 6700, startedAtMs: Date.parse('2026-11-16T16:22:16.046Z') };
    const path = exitRecordPath(dir, run);
    expect(path).toBe(join(dir, `main-exit-6700-${run.startedAtMs}.json`));
    const alive = [{ pid: 9, ppid: 1, name: 'cmd.exe', startedAt: 'a', evidence: ['taskkill /S pc /U u /P Senha123 /PID 6700 /F'], mentionsMain: true }];
    writeFileSync(path, JSON.stringify({ ...run, exitCode: 2, endedAt: '2026-11-17T09:22:03.000Z', aliveAfterExit: alive }), 'utf8');

    // another pid or another start in the file: not this run's record
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ ...run, pid: 6701, exitCode: 1, endedAt: 'x', aliveAfterExit: [] }));
    expect(takeExitRecord(join(dir, 'other.json'), run)).toBeNull();

    const record = takeExitRecord(path, run);
    expect(record).toMatchObject({ ...run, exitCode: 2, cause: 'killed-as-hung-by-second-copy', endedAt: '2026-11-17T09:22:03.000Z' });
    expect(record?.aliveAfterExit[0]).toMatchObject({ evidence: ['taskkill /S pc /U u /P *** /PID 6700 /F'], mentionsMain: true });
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

    const userData = "C:\\Users\\o'brien O\u2019Neil\\AppData\\Roaming\\donel-dev\\main-exit-6700-1794850936046.json";
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
