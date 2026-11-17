// Sentinela de saída (t-d4f5879c, 17/11) — how the main process ended.
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
// Only the candidates to killer keep their command line, masked (maskCommandLine) both in the PowerShell, before the
// disk, and here, before the log. It is started through a hop that leaves at once, so it is not a descendant of the
// main and a `taskkill /T` on the main does not take it along.

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
 * Masks for a command line, applied by the PowerShell (`-replace`, case-insensitive) and here (flag `gi`); written
 * so the .NET and the JS engines read them the same way. They mask more than needed (`-Path` loses its value): a
 * readable command line is worth less than a password left in a log.
 */
export const COMMAND_LINE_MASKS: ReadonlyArray<{ readonly source: string; readonly to: string }> = [
  // scheme://user:password@host
  { source: '(://[^/\\s:@"]+:)[^@\\s"]+@', to: '$1***@' },
  // curl -u user:password, --user=user:password
  { source: '((?:^|\\s)(?:-u|--user)(?:=|\\s+)[^\\s:"]+:)\\S+', to: '$1***' },
  // -pSenha, -p Senha (mysql, sshpass), --password=x, --token x, --api-key x
  { source: '((?:^|\\s)--?(?:p|pw|pwd|pass|passwd|password|token|secret|apikey|api-key|key)(?:=|\\s+)?)("[^"]*"|\\S+)', to: '$1***' },
  // Bearer <token>
  { source: '(bearer\\s+)\\S+', to: '$1***' },
  // AWS access key ids, 20 characters
  { source: '\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b', to: '***' },
  // any long run of token-like characters (keys, tokens, base64)
  { source: '[A-Za-z0-9_+/=-]{24,}', to: '***' },
];

export function maskCommandLine(text: string): string {
  let out = text;
  for (const mask of COMMAND_LINE_MASKS) out = out.replace(new RegExp(mask.source, 'gi'), mask.to);
  return maskSecrets(out).text;
}

/** Image names whose command line may say who ended the main; any other process keeps only its name. */
const KILLER_CANDIDATES = '^(taskkill|powershell|pwsh|cmd|wscript|cscript|node|electron|bash|sh|python[0-9.]*|Donel Dev.*)\\.exe$';

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

export function buildExitSentinelCommand(options: ExitSentinelOptions): { file: string; args: string[] } {
  const pid = Math.trunc(options.pid);
  const startedAt = Math.trunc(options.startedAtMs);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('sentinela de saída: pid ou início inválido');
  }
  const target = psQuote(options.recordPath);
  const temp = psQuote(`${options.recordPath}.tmp`);
  const masks = COMMAND_LINE_MASKS.map((mask) => ` -replace ${psQuote(mask.source)}, '${mask.to}'`).join('');
  const save = [
    '$json = ConvertTo-Json -InputObject $record -Depth 4 -Compress',
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
    `$since = (Get-Date).AddSeconds(-${RECENT_WINDOW_SECONDS})`,
    '$record.aliveAfterExit = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since } | Sort-Object CreationDate |' +
      ` Select-Object -Last ${RECENT_MAX} | ForEach-Object {` +
      // only a candidate to killer (or a child of the main) keeps its command line, masked before the disk
      ` $cl = ''; if ($_.Name -match ${psQuote(KILLER_CANDIDATES)} -or $_.ParentProcessId -eq ${pid}) { $cl = [string]$_.CommandLine${masks} };` +
      " if ($cl.Length -gt 300) { $cl = $cl.Substring(0, 300) };" +
      " [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name;" +
      " startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $cl } })",
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
  readonly commandLine: string;
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

const RECORD_NAME = /^main-exit-(\d+)-(\d+)\.json$/;

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
  const alive = (Array.isArray(v.aliveAfterExit) ? (v.aliveAfterExit as AliveProcess[]) : []).map((p) => ({
    pid: Number(p?.pid),
    ppid: Number(p?.ppid),
    name: String(p?.name ?? ''),
    startedAt: String(p?.startedAt ?? ''),
    commandLine: maskCommandLine(String(p?.commandLine ?? '')),
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
    const record = takeExitRecord(path);
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
