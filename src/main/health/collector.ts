// Saúde do computador - the I/O half: reads RAM, the system disk and the process list. Thin on purpose:
// the parse of the PowerShell output is pure and tested (tests/health-collector.test.ts); the judgement
// lives in src/shared/health/analyze.ts.

import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import type { HealthSnapshot, ProcessSample } from '../../shared/health/types';

/**
 * Two CIM queries joined in TS. `Win32_PerfFormattedData_PerfProc_Process` names instances `node#3`,
 * so the join key is `IDProcess`, never the name; the name and the parent come from `Win32_Process`.
 * The creation date tells a living parent from a reused pid.
 */
export const PROCESS_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  // `foreach` statements and `-Property`: the pipeline version took seconds more on a loaded machine.
  '$perf = [System.Collections.Generic.List[object]]::new()',
  'foreach ($x in Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process -Property IDProcess,IOWriteBytesPersec) { if ($x.IDProcess -ne 0) { $perf.Add(@{ i = [int]$x.IDProcess; w = [double]$x.IOWriteBytesPersec }) } }',
  '$procs = [System.Collections.Generic.List[object]]::new()',
  'foreach ($x in Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,CreationDate) { $c = $null; if ($x.CreationDate) { $c = ([DateTimeOffset]$x.CreationDate).ToUnixTimeMilliseconds() }; $procs.Add(@{ p = [int]$x.ProcessId; pp = [int]$x.ParentProcessId; n = [string]$x.Name; ws = [double]$x.WorkingSetSize; c = $c }) }',
  '[Console]::Out.Write((@{ perf = $perf.ToArray(); procs = $procs.ToArray() } | ConvertTo-Json -Compress -Depth 3))',
].join('\n');

interface RawPerf {
  readonly i?: unknown;
  readonly w?: unknown;
}

interface RawProc {
  readonly p?: unknown;
  readonly pp?: unknown;
  readonly n?: unknown;
  readonly ws?: unknown;
  readonly c?: unknown;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value !== null && typeof value === 'object') return [value as T];
  return [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The JSON of `PROCESS_QUERY_SCRIPT` -> one sample per process. Anything unreadable yields `[]`. */
export function parseProcessQueryOutput(stdout: string): ProcessSample[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const root = parsed as { perf?: unknown; procs?: unknown };

  const writes = new Map<number, number>();
  for (const entry of asArray<RawPerf>(root.perf)) {
    const pid = num(entry?.i);
    const write = num(entry?.w);
    if (pid !== null && write !== null) writes.set(pid, write);
  }

  const procs: { pid: number; parentPid: number; name: string; ws: number; created: number | null }[] = [];
  for (const entry of asArray<RawProc>(root.procs)) {
    const pid = num(entry?.p);
    if (pid === null || pid < 0) continue;
    procs.push({
      pid,
      parentPid: num(entry?.pp) ?? 0,
      name: typeof entry?.n === 'string' ? entry.n : '',
      ws: num(entry?.ws) ?? 0,
      created: num(entry?.c),
    });
  }

  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  return procs.map((proc) => {
    const parent = byPid.get(proc.parentPid);
    // The kernel's own (0 = idle, 4 = System) have no meaningful parent.
    const rootProcess = proc.pid === 0 || proc.pid === 4;
    const bornBeforeChild = parent !== undefined && (parent.created === null || proc.created === null || parent.created <= proc.created);
    return {
      pid: proc.pid,
      parentPid: proc.parentPid,
      name: proc.name,
      parentAlive: rootProcess || (parent !== undefined && parent.pid !== proc.pid && bornBeforeChild),
      workingSetBytes: proc.ws,
      writeBytesPerSec: writes.get(proc.pid) ?? 0,
    };
  });
}

/** `tasklist /FO CSV /NH` -> the image name of its first row, `null` when no task matched. */
export function parseTasklistName(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]*)"/.exec(line.trim());
    if (match) return match[1] ?? null;
  }
  return null;
}

function run(file: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

const PROCESS_QUERY_TIMEOUT_MS = 15_000;

export async function readProcesses(): Promise<ProcessSample[]> {
  if (process.platform !== 'win32') return [];
  const encoded = Buffer.from(PROCESS_QUERY_SCRIPT, 'utf16le').toString('base64');
  try {
    const stdout = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], PROCESS_QUERY_TIMEOUT_MS);
    return parseProcessQueryOutput(stdout);
  } catch (error) {
    console.warn('[donel-dev] saúde do PC: leitura de processos falhou:', error instanceof Error ? error.message : error);
    return [];
  }
}

/** The disk Windows runs from (`C:\`), or `/` elsewhere. */
export function systemDiskPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return '/';
  const drive = (env.SystemDrive ?? 'C:').replace(/[\\/]+$/, '');
  return `${drive}\\`;
}

async function readDisk(path: string): Promise<HealthSnapshot['disk']> {
  try {
    const stats = await statfs(path);
    return { path: path.replace(/\\$/, ''), totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  } catch {
    return null;
  }
}

export interface CollectDeps {
  readonly ownPids: () => readonly number[];
  readonly now?: () => number;
}

export async function collectHealthSnapshot(deps: CollectDeps): Promise<HealthSnapshot> {
  const [disk, processes] = await Promise.all([readDisk(systemDiskPath()), readProcesses()]);
  return {
    at: (deps.now ?? Date.now)(),
    ram: { totalBytes: totalmem(), freeBytes: freemem() },
    disk,
    processes,
    ownPids: deps.ownPids(),
  };
}

/** The current image name of `pid` (to re-check right before ending it), `null` when no process holds it. */
export async function lookupProcessName(pid: number): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const stdout = await run('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 10_000);
    return parseTasklistName(stdout);
  } catch {
    return null;
  }
}
