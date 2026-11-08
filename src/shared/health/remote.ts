// Saúde das VPS - one short read-only command over ssh per remote place (RAM, disk, load, Donel sessions)
// and the parser of its answer. Pure: the main runs the script (src/main/health/remote-health-service.ts),
// the renderer only reads `RemoteHealthReport`. The parser is tested (tests/health-remote-parse.test.ts).

import { formatBytes } from '../format-bytes';
import { HEALTH_THRESHOLDS } from './analyze';
import { parseGatewayLine, parseSessionLine, remoteSessionsScriptLines, type RemoteGateway, type RemoteSessionReading } from './remoteSessions';
import type { HealthSeverity } from './types';

const KB = 1024;
const MARK = 'DONEL_HEALTH';

/** What one read of a remote place found. A field the place did not answer is `null`. */
export interface RemoteHealthReading {
  readonly ram: { readonly totalBytes: number; readonly freeBytes: number } | null;
  /** Swap (`SwapTotal`/`SwapFree`); a machine without swap answers total 0 and reads `null`. */
  readonly swap: { readonly totalBytes: number; readonly freeBytes: number } | null;
  /** The disk of `$HOME` (where the projects and the sessions live). */
  readonly disk: { readonly totalBytes: number; readonly freeBytes: number } | null;
  /** Load average of 1, 5 and 15 minutes. */
  readonly load: { readonly one: number; readonly five: number; readonly fifteen: number } | null;
  readonly cpus: number | null;
  /** Live Donel sessions (tmux sessions `donel-*` on the `donel` socket). */
  readonly sessions: number | null;
  /**
   * Gargalos do ambiente — what each of those sessions is really doing (`remoteSessions.ts`); `null` = the place
   * could not tell (no `python3`, the program failed). Also `null` on a place that has no session (no line printed
   * and no clock line): an empty list is only trusted when the program ran.
   */
  readonly sessionDetails: readonly RemoteSessionReading[] | null;
  /** The place's clock when the details were read (ages are measured on it, never on the PC's clock). */
  readonly readAt: number | null;
  /** Where the CLI of the place sends its calls; `null` = straight to the API (or not known). */
  readonly gateway: RemoteGateway | null;
}

export interface RemoteHealthReport {
  readonly id: string;
  readonly label: string;
  /** `pending` = no read finished yet; `unreachable` = the last read got no answer (ssh down, timeout). */
  readonly status: 'pending' | 'ok' | 'unreachable';
  /** When the last read finished (ok or not). */
  readonly checkedAt: number | null;
  /** When the last read that answered finished; `reading` is from then. */
  readonly lastOkAt: number | null;
  readonly reading: RemoteHealthReading | null;
  /** Of the last good reading; `unreachable` is told by `status`, not by this. */
  readonly severity: HealthSeverity;
}

/**
 * The script, sent by stdin to `bash -s`. Only reads `/proc`, `df`, `nproc` and `tmux ls`: nothing is installed
 * or written. Every line starts with the marker, so whatever a login profile prints is ignored.
 */
export function buildRemoteHealthScript(): string {
  return [
    `awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print "${MARK} mem", t, a}' /proc/meminfo 2>/dev/null`,
    `awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{print "${MARK} swap", t, f}' /proc/meminfo 2>/dev/null`,
    `df -kP "$HOME" 2>/dev/null | awk 'NR==2{print "${MARK} disk", $2, $4}'`,
    `printf '${MARK} load %s\\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"`,
    `printf '${MARK} cpus %s\\n' "$(nproc 2>/dev/null)"`,
    `printf '${MARK} sessions %s\\n' "$(tmux -L donel ls -F '#S' 2>/dev/null | grep -c '^donel-')"`,
    ...remoteSessionsScriptLines(),
    `echo '${MARK} end'`,
    '',
  ].join('\n');
}

function numbers(rest: string, count: number): number[] | null {
  const parts = rest.trim().split(/\s+/).slice(0, count).map(Number);
  if (parts.length < count || parts.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return parts;
}

/** Pure — `null` when the answer did not reach the end marker (ssh failed, timeout, cut short). */
export function parseRemoteHealthOutput(stdout: string): RemoteHealthReading | null {
  let ram: RemoteHealthReading['ram'] = null;
  let swap: RemoteHealthReading['swap'] = null;
  let disk: RemoteHealthReading['disk'] = null;
  let load: RemoteHealthReading['load'] = null;
  let cpus: number | null = null;
  let sessions: number | null = null;
  const details: RemoteSessionReading[] = [];
  let readAt: number | null = null;
  let gateway: RemoteGateway | null = null;
  let ended = false;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(`${MARK} `)) continue;
    const [key = '', ...restParts] = line.slice(MARK.length + 1).split(' ');
    const rest = restParts.join(' ');
    if (key === 'end') ended = true;
    else if (key === 'mem') {
      const values = numbers(rest, 2);
      if (values && values[0] > 0 && values[1] <= values[0]) ram = { totalBytes: values[0] * KB, freeBytes: values[1] * KB };
    } else if (key === 'swap') {
      const values = numbers(rest, 2);
      if (values && values[0] > 0 && values[1] <= values[0]) swap = { totalBytes: values[0] * KB, freeBytes: values[1] * KB };
    } else if (key === 'disk') {
      const values = numbers(rest, 2);
      if (values && values[0] > 0 && values[1] <= values[0]) disk = { totalBytes: values[0] * KB, freeBytes: values[1] * KB };
    } else if (key === 'load') {
      const values = numbers(rest, 3);
      if (values) load = { one: values[0], five: values[1], fifteen: values[2] };
    } else if (key === 'cpus') {
      const values = numbers(rest, 1);
      if (values && values[0] >= 1) cpus = Math.floor(values[0]);
    } else if (key === 'sessions') {
      const values = numbers(rest, 1);
      if (values) sessions = Math.floor(values[0]);
    } else if (key === 'now') {
      const values = numbers(rest, 1);
      if (values) readAt = values[0];
    } else if (key === 'gateway') {
      gateway = parseGatewayLine(rest);
    } else if (key === 'sess') {
      const reading = parseSessionLine(rest);
      if (reading) details.push(reading);
    }
  }
  if (!ended) return null;
  return { ram, swap, disk, load, cpus, sessions, sessionDetails: readAt === null ? null : details, readAt, gateway };
}

/** Load of the last minute per CPU at or above this is a busy machine; at or above the critical one, a choked one. */
const LOAD_WARN_PER_CPU = 1;
const LOAD_CRITICAL_PER_CPU = 2;

/** Pure — the worst state of a reading, with the same RAM/disk limits as the PC. */
export function remoteHealthSeverity(reading: RemoteHealthReading): HealthSeverity {
  const levels: HealthSeverity[] = [];
  if (reading.ram) {
    const free = reading.ram.freeBytes / reading.ram.totalBytes;
    levels.push(free < HEALTH_THRESHOLDS.ramCriticalFreeRatio ? 'critical' : free < HEALTH_THRESHOLDS.ramWarnFreeRatio ? 'warn' : 'ok');
  }
  if (reading.disk) {
    const free = reading.disk.freeBytes / reading.disk.totalBytes;
    levels.push(free < HEALTH_THRESHOLDS.diskCriticalFreeRatio ? 'critical' : free < HEALTH_THRESHOLDS.diskWarnFreeRatio ? 'warn' : 'ok');
  }
  if (reading.load && reading.cpus) {
    const perCpu = reading.load.one / reading.cpus;
    levels.push(perCpu >= LOAD_CRITICAL_PER_CPU ? 'critical' : perCpu >= LOAD_WARN_PER_CPU ? 'warn' : 'ok');
  }
  return levels.includes('critical') ? 'critical' : levels.includes('warn') ? 'warn' : 'ok';
}

/** `vps · RAM 40% · disco 30 GB`, `vps · sem sinal`, `vps · —` before the first read. */
export function formatRemoteIndicator(report: RemoteHealthReport): string {
  if (report.status === 'unreachable') return `${report.label} · sem sinal`;
  const reading = report.reading;
  if (!reading) return `${report.label} · —`;
  const parts = [report.label];
  if (reading.ram) parts.push(`RAM ${Math.round((1 - reading.ram.freeBytes / reading.ram.totalBytes) * 100)}%`);
  if (reading.disk) parts.push(`disco ${formatBytes(reading.disk.freeBytes)}`);
  return parts.join(' · ');
}

/** `0,42 · 0,38 · 0,30 (2 CPUs)`. */
export function formatLoad(reading: RemoteHealthReading): string | null {
  if (!reading.load) return null;
  const fmt = (value: number): string => value.toFixed(2).replace('.', ',');
  const cpus = reading.cpus ? ` (${reading.cpus} ${reading.cpus === 1 ? 'CPU' : 'CPUs'})` : '';
  return `${fmt(reading.load.one)} · ${fmt(reading.load.five)} · ${fmt(reading.load.fifteen)}${cpus}`;
}
