// Sentinela de saída (t-d4f5879c, 17/11) — how the main process ended, and what around it looked like a killer.
// At 06:22 of 17/11 the app on the owner's PC was ended from outside (third time): no quit path ran, no dump, no
// Application Error, and Windows keeps no record of who called TerminateProcess unless process auditing is on
// (auditpol, needs admin). The run trail (run-trail.ts) proves THAT the run ended without quitting; this says HOW,
// from the exit code:
//   0 quit · 1 taskkill /F, Task Manager or a node `process.kill` · 2 a second copy of the app found this one hung
//   with no visible window and ended it (Chromium ProcessSingleton, RESULT_CODE_HUNG) · -1 PowerShell Stop-Process ·
//   0xC000013A console closed · 0xC0000000+ and 0x80000003 a crash.
// A small PowerShell waits on the main and, when it ends, writes `<userData>/main-exit-<pid>-<start>.json` (one file
// per run, so a late record is never overwritten by the next run's): first the exit code alone, then again with the
// processes started in the two minutes before the end that are STILL ALIVE when it looks (`aliveAfterExit`). A
// short-lived killer (taskkill.exe, the host of a Stop-Process) is usually gone by then: only its long-lived parent
// may show. Catching the killer itself needs process-creation auditing or ETW, both admin-only; a 1 s WMI poll was
// tried and caught taskkill 2 times in 5, at a constant WMI cost, so it was left out.
// The full command line never reaches the disk (t-c1b710c2): masking a whole line either leaves a password readable
// or erases who did the kill. Of each candidate to killer only the EVIDENCE is kept — the kill commands it carries
// (taskkill, Stop-Process, kill/pkill, process.kill, wmic … delete, .Kill()), the scripts it runs, also inside a
// -EncodedCommand, and whether it names the main's pid — each piece masked for passwords (taskkill /P, wmic /password).
// It is started through a hop that leaves at once, so it is not a descendant of the main and a `taskkill /T` on the
// main does not take it along.

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets } from '../shared/ledger/secret-scan';

export type ExitCause = 'quit' | 'killed' | 'killed-as-hung-by-second-copy' | 'stop-process' | 'console-closed' | 'crash' | 'other';

export function classifyExitCode(code: number): ExitCause {
  const unsigned = code >>> 0;
  if (unsigned === 0) return 'quit';
  if (unsigned === 1) return 'killed';
  if (unsigned === 2) return 'killed-as-hung-by-second-copy';
  if (unsigned === 0xffffffff) return 'stop-process';
  if (unsigned === 0xc000013a) return 'console-closed';
  if (unsigned >= 0xc0000000 || unsigned === 0x80000003) return 'crash';
  return 'other';
}

/**
 * What says who ended a process, found in a command line (case-insensitive; .NET `[regex]::Matches` and JS `matchAll`
 * read them the same way: ASCII classes, bounded lengths, so a long line costs a linear pass per pattern).
 */
export const KILL_EVIDENCE_PATTERNS: readonly string[] = [
  String.raw`taskkill(?:\.exe)?[^&|;<>\r\n]{0,160}`,
  String.raw`(?:Stop-Process|spps)[^;|"\r\n]{0,160}`,
  String.raw`Get-Process[^;|"\r\n]{0,120}`,
  String.raw`(?<![A-Za-z0-9_.-])(?:kill|pkill|killall)\s+[^'"&|;<>\r\n]{1,160}`,
  String.raw`process\.kill\([^)\r\n]{0,80}\)`,
  String.raw`[A-Za-z0-9_$.\])]{1,60}\.Kill\(\)`,
  String.raw`wmic[^&|<>\r\n]{0,160}?(?:delete|terminate)`,
  // a script run by the process: the path only, never its arguments
  String.raw`(?<![^\s"'=(])[^\s"'|&;<>()]{1,200}\.(?:ps1|psm1|sh|bash|js|mjs|cjs|ts|py|cmd|bat|vbs)(?![A-Za-z0-9])`,
];

/** The base64 of a `powershell -EncodedCommand` (or -enc / -e), decoded and searched like the line itself. */
export const ENCODED_COMMAND_PATTERN = String.raw`(?:^|\s)-e(?:nc(?:odedcommand)?)?\s+([A-Za-z0-9+/=]{8,})`;

/** At most this many pieces of evidence per process, each cut to EVIDENCE_PIECE_MAX characters. */
export const EVIDENCE_MAX = 8;
export const EVIDENCE_PIECE_MAX = 200;
/** The command line is cut to this before the search. */
export const COMMAND_LINE_CUT = 8192;

/**
 * Masks for a piece of evidence, applied by the PowerShell (`-replace`) and here (flag `gi`): the passwords a kill
 * command can carry. A piece is short and never a whole command line, so no blanket mask erases what it shows.
 */
export const EVIDENCE_MASKS: ReadonlyArray<{ readonly source: string; readonly to: string }> = [
  // scheme://user:password@host
  { source: String.raw`(://[^/\s:@"']+:)[^@\s"']+@`, to: '$1***@' },
  // taskkill /S pc /U user /P password, wmic /password x, /p:x
  { source: String.raw`((?:^|\s)/(?:p|pw|pwd|pass|password)(?:[:=]|\s+))("[^"]*"|'[^']*'|\S+)`, to: '$1***' },
  // -Password x, --password x, -Credential x
  { source: String.raw`((?:^|\s)--?(?:password|passwd|pass|pwd|pw|credential|token|secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)`, to: '$1***' },
];

/** What the PowerShell does to a piece of evidence before the disk. */
export function maskEvidence(text: string): string {
  let out = text.length > EVIDENCE_PIECE_MAX ? text.slice(0, EVIDENCE_PIECE_MAX) : text;
  for (const mask of EVIDENCE_MASKS) out = out.replace(new RegExp(mask.source, 'gi'), mask.to);
  return out;
}

export interface KillEvidence {
  readonly evidence: readonly string[];
  /** The command line names the main's pid as a whole number. */
  readonly mentionsMain: boolean;
}

/** What the PowerShell records of a candidate's command line; mirrors the script, so the tests prove the disk. */
export function extractKillEvidence(commandLine: string, mainPid: number): KillEvidence {
  const line = commandLine.length > COMMAND_LINE_CUT ? commandLine.slice(0, COMMAND_LINE_CUT) : commandLine;
  const texts = [line];
  const encoded = new RegExp(ENCODED_COMMAND_PATTERN, 'i').exec(line);
  // .NET's FromBase64String refuses a length that is not a multiple of 4; Node would decode it anyway
  if (encoded && encoded[1].length % 4 === 0) {
    const decoded = Buffer.from(encoded[1], 'base64').toString('utf16le');
    if (decoded) texts.push(decoded);
  }
  const found: string[] = [];
  for (const text of texts) {
    for (const pattern of KILL_EVIDENCE_PATTERNS) {
      for (const match of text.matchAll(new RegExp(pattern, 'gi'))) found.push(match[0]);
    }
  }
  const evidence = [...new Set(found)].slice(0, EVIDENCE_MAX).map(maskEvidence);
  const mentionsMain = texts.some((text) => new RegExp(`(?<![0-9])${Math.trunc(mainPid)}(?![0-9])`).test(text));
  return { evidence, mentionsMain };
}

/** What reaches the log: the evidence masks again, then the ledger's maskSecrets. */
export function maskForLog(text: string): string {
  return maskSecrets(maskEvidence(text)).text;
}

/** Image names whose command line may say who ended the main; any other process keeps only its name. */
export const KILLER_CANDIDATES = '^(taskkill|powershell|pwsh|cmd|wscript|cscript|node|electron|bash|sh|python[0-9.]*|Donel Dev.*)\\.exe$';

export interface ExitSentinelOptions {
  readonly pid: number;
  /** When the main started (epoch ms): the sentinel only waits on the process that has this start. */
  readonly startedAtMs: number;
  /** `exitRecordPath(userData, run)`. */
  readonly recordPath: string;
}

/** How far the start time read by Windows may be from ours and still be the same process. */
const SAME_PROCESS_TOLERANCE_SECONDS = 10;
/** The processes started this long before the end go in the record. */
const RECENT_WINDOW_SECONDS = 120;
const RECENT_MAX = 40;

/** A PowerShell single-quoted string: every quote PowerShell closes one with (' ‘ ’ ‚ ‛) is doubled. */
function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The PowerShell function that mirrors extractKillEvidence + maskEvidence (`Get-KillEvidence $commandLine`). */
export function evidenceFunctionScript(mainPid: number): string {
  const patterns = KILL_EVIDENCE_PATTERNS.map(psQuote).join(', ');
  const masks = EVIDENCE_MASKS.map((mask) => ` -replace ${psQuote(mask.source)}, '${mask.to}'`).join('');
  return [
    'function Get-KillEvidence([string]$cl) {',
    `  if ($cl.Length -gt ${COMMAND_LINE_CUT}) { $cl = $cl.Substring(0, ${COMMAND_LINE_CUT}) }`,
    '  $texts = @($cl)',
    `  $enc = [regex]::Match($cl, ${psQuote(ENCODED_COMMAND_PATTERN)}, 'IgnoreCase')`,
    '  if ($enc.Success) { try { $dec = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($enc.Groups[1].Value)); if ($dec) { $texts += $dec } } catch {} }',
    '  $found = New-Object System.Collections.Generic.List[string]',
    `  foreach ($t in $texts) { foreach ($pat in @(${patterns})) { foreach ($m in [regex]::Matches($t, $pat, 'IgnoreCase')) { if (-not $found.Contains($m.Value)) { $found.Add($m.Value) } } } }`,
    `  $evidence = @($found | Select-Object -First ${EVIDENCE_MAX} | ForEach-Object { $s = $_; if ($s.Length -gt ${EVIDENCE_PIECE_MAX}) { $s = $s.Substring(0, ${EVIDENCE_PIECE_MAX}) }; $s${masks} })`,
    `  $mentions = [bool]($texts | Where-Object { $_ -match '(?<![0-9])${Math.trunc(mainPid)}(?![0-9])' })`,
    '  return @{ evidence = $evidence; mentionsMain = $mentions }',
    '}',
  ].join('\n');
}

export function buildExitSentinelCommand(options: ExitSentinelOptions): { file: string; args: string[] } {
  const pid = Math.trunc(options.pid);
  const startedAt = Math.trunc(options.startedAtMs);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('sentinela de saída: pid ou início inválido');
  }
  const target = psQuote(options.recordPath);
  const temp = psQuote(`${options.recordPath}.tmp`);
  const save = [
    '$json = ConvertTo-Json -InputObject $record -Depth 5 -Compress',
    `[IO.File]::WriteAllText(${temp}, $json, (New-Object Text.UTF8Encoding $false))`,
    `Move-Item -LiteralPath ${temp} -Destination ${target} -Force`,
  ];
  const inner = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = Get-Process -Id ${pid}`,
    'if (-not $p) { exit 0 }',
    `$expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime`,
    `if ([math]::Abs(($p.StartTime.ToUniversalTime() - $expected).TotalSeconds) -gt ${SAME_PROCESS_TOLERANCE_SECONDS}) { exit 0 }`,
    // The handle must be open before the end, or the exit code is gone with the process.
    '$null = $p.Handle',
    '$p.WaitForExit()',
    '$code = $p.ExitCode',
    // The exit code reaches the disk first: the process query below may be slow or hang with WMI.
    `$record = [ordered]@{ pid = ${pid}; startedAtMs = ${startedAt}; exitCode = $code; endedAt = (Get-Date).ToUniversalTime().ToString('o'); aliveAfterExit = @() }`,
    ...save,
    evidenceFunctionScript(pid),
    // only processes started before the end: a quick reopen's own children must not take the places
    '$end = Get-Date',
    `$since = $end.AddSeconds(-${RECENT_WINDOW_SECONDS})`,
    '$record.aliveAfterExit = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since -and $_.CreationDate -le $end } | Sort-Object CreationDate |' +
      ` Select-Object -Last ${RECENT_MAX} | ForEach-Object {` +
      // only a candidate to killer (or a child of the main) is searched; the command line itself is never written
      ` $ev = @{ evidence = @(); mentionsMain = $false }; if ($_.Name -match ${psQuote(KILLER_CANDIDATES)} -or $_.ParentProcessId -eq ${pid}) { $ev = Get-KillEvidence ([string]$_.CommandLine) };` +
      " [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name;" +
      " startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); evidence = @($ev.evidence); mentionsMain = $ev.mentionsMain } })",
    // the next boot may have read (and removed) the first write already: then it was told, and is not written again
    `if (-not (Test-Path -LiteralPath ${target})) { exit 0 }`,
    ...save,
  ].join('\n');
  const hop =
    "Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive'," +
    `'-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`;
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(hop)],
  };
}

export interface AliveProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly startedAt: string;
  /** What in its command line looked like a kill (masked); empty for a process that is not a candidate. */
  readonly evidence: readonly string[];
  readonly mentionsMain: boolean;
}

export interface ExitRecord {
  readonly pid: number;
  readonly startedAtMs: number;
  readonly exitCode: number;
  readonly cause: ExitCause;
  readonly endedAt: string;
  /** Processes started in the 2 min before the end and still alive after it (not the short-lived killer itself). */
  readonly aliveAfterExit: readonly AliveProcess[];
}

interface RunId {
  readonly pid: number;
  readonly startedAtMs: number;
}

const RECORD_NAME = /^main-exit-(\d+)-(\d+)\.json(\.tmp)?$/;

/** `<dir>/main-exit-<pid>-<start>.json`: one record per run. */
export function exitRecordPath(dir: string, run: RunId): string {
  return join(dir, `main-exit-${Math.trunc(run.pid)}-${Math.trunc(run.startedAtMs)}.json`);
}

/**
 * The record at `path` when it belongs to `run` (any run when omitted), removed once read; `null` when there is none
 * yet, it is unreadable, its exit code was not read, or it is another run's (left in place). Never throws.
 */
export function takeExitRecord(path: string, run?: RunId): ExitRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.pid !== 'number' || typeof v.startedAtMs !== 'number' || typeof v.exitCode !== 'number') return null;
  if (run && (v.pid !== run.pid || v.startedAtMs !== run.startedAtMs)) return null;
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
  const alive = (Array.isArray(v.aliveAfterExit) ? (v.aliveAfterExit as Partial<AliveProcess>[]) : []).map((p) => ({
    pid: Number(p?.pid),
    ppid: Number(p?.ppid),
    name: String(p?.name ?? ''),
    startedAt: String(p?.startedAt ?? ''),
    evidence: (Array.isArray(p?.evidence) ? p.evidence : []).slice(0, EVIDENCE_MAX).map((piece) => maskForLog(String(piece))),
    mentionsMain: p?.mentionsMain === true,
  }));
  return {
    pid: v.pid,
    startedAtMs: v.startedAtMs,
    exitCode: v.exitCode,
    cause: classifyExitCode(v.exitCode),
    endedAt: typeof v.endedAt === 'string' ? v.endedAt : '',
    aliveAfterExit: alive,
  };
}

/**
 * Every record in `dir` except the one of `keep` (the previous run, read on its own), each removed once read. A file
 * that is not a valid record is removed too, so they never pile up. Never throws.
 */
export function takeStrayExitRecords(dir: string, keep: RunId | null): ExitRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: ExitRecord[] = [];
  for (const name of names) {
    const match = RECORD_NAME.exec(name);
    if (!match) continue;
    if (keep && Number(match[1]) === keep.pid && Number(match[2]) === keep.startedAtMs) continue;
    const path = join(dir, name);
    // a `.tmp` left by a sentinel that stopped between the write and the move is only cleared
    const record = match[3] ? null : takeExitRecord(path);
    if (record) records.push(record);
    else {
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    }
  }
  return records;
}
