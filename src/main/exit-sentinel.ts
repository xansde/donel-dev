// Sentinela de saída (t-d4f5879c, 17/11) — who ended the main process.
// At 06:22 of 17/11 the app on the owner's PC was ended from outside (third time): no quit path ran, no dump, no
// Application Error, and Windows keeps no record of who called TerminateProcess unless auditing is on (needs admin).
// The run trail (run-trail.ts) proves THAT the run ended without quitting; this says HOW, from the exit code:
//   0 quit · 1 taskkill /F, Task Manager or a node `process.kill` · 2 a second copy of the app found this one hung
//   with no visible window and ended it (Chromium ProcessSingleton, RESULT_CODE_HUNG) · -1 PowerShell Stop-Process ·
//   0xC0000000+ a crash.
// A small PowerShell waits on the main and, when it ends, writes `<userData>/main-exit.json` with the exit code and
// the processes started in the two minutes before it (the launcher of a second copy, the shell of a script). It is
// started through a hop that leaves at once, so it is not a descendant of the main and a `taskkill /T` on the main
// does not take it along. The next boot reads the record (takeExitRecord) and logs it in main-events.log.

import { readFileSync, unlinkSync } from 'node:fs';

export type ExitCause = 'quit' | 'killed' | 'killed-as-hung-by-second-copy' | 'stop-process' | 'crash' | 'other';

export function classifyExitCode(code: number): ExitCause {
  const unsigned = code >>> 0;
  if (unsigned === 0) return 'quit';
  if (unsigned === 1) return 'killed';
  if (unsigned === 2) return 'killed-as-hung-by-second-copy';
  if (unsigned === 0xffffffff) return 'stop-process';
  if (unsigned >= 0xc0000000) return 'crash';
  return 'other';
}

export interface ExitSentinelOptions {
  readonly pid: number;
  /** When the main started (epoch ms): the sentinel only waits on the process that has this start. */
  readonly startedAtMs: number;
  /** `<userData>/main-exit.json`. */
  readonly recordPath: string;
}

/** How far the start time read by Windows may be from ours and still be the same process. */
const SAME_PROCESS_TOLERANCE_SECONDS = 10;
/** The processes started this long before the end go in the record. */
const RECENT_WINDOW_SECONDS = 120;
const RECENT_MAX = 40;

function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
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
    `$since = (Get-Date).AddSeconds(-${RECENT_WINDOW_SECONDS})`,
    '$recent = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since } | Sort-Object CreationDate |' +
      ` Select-Object -Last ${RECENT_MAX} | ForEach-Object {` +
      // a token on a command line never reaches the disk (redactSecrets does the same on read)
      " $cl = [string]$_.CommandLine -replace '[A-Za-z0-9_+/=-]{24,}', '***'; if ($cl.Length -gt 300) { $cl = $cl.Substring(0, 300) };" +
      " [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name;" +
      " startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $cl } })",
    `$record = [ordered]@{ pid = ${pid}; startedAtMs = ${startedAt}; exitCode = $code; endedAt = (Get-Date).ToUniversalTime().ToString('o'); recent = $recent }`,
    '$json = ConvertTo-Json -InputObject $record -Depth 4 -Compress',
    `[IO.File]::WriteAllText(${temp}, $json, (New-Object Text.UTF8Encoding $false))`,
    `Move-Item -LiteralPath ${temp} -Destination ${target} -Force`,
  ].join('\n');
  const hop =
    "Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive'," +
    `'-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`;
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(hop)],
  };
}

export interface RecentProcess {
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
  readonly recent: readonly RecentProcess[];
}

/** Drops a record nobody will read (the previous run quit on its own path). Never throws. */
export function discardExitRecord(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // none
  }
}

/** Long runs of token-like characters (keys, tokens, hashes) become `***`. */
export function redactSecrets(text: string): string {
  return text.replace(/[A-Za-z0-9_+/=-]{24,}/g, '***');
}

/**
 * The record of the run `run` (of any run when `run` is omitted), removed once read; `null` when there is none yet,
 * it is unreadable, its exit code was not read, or it belongs to another run (left in place). Never throws: the boot
 * must not fail on it.
 */
export function takeExitRecord(path: string, run?: { readonly pid: number; readonly startedAtMs: number }): ExitRecord | null {
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
  const recent = (Array.isArray(v.recent) ? (v.recent as RecentProcess[]) : []).map((p) => ({
    ...p,
    commandLine: redactSecrets(String(p?.commandLine ?? '')),
  }));
  return {
    pid: v.pid,
    startedAtMs: v.startedAtMs,
    exitCode: v.exitCode,
    cause: classifyExitCode(v.exitCode),
    endedAt: typeof v.endedAt === 'string' ? v.endedAt : '',
    recent,
  };
}
