// Saúde do computador - the shapes shared by the collector (main), the analyzer (pure) and the panel (renderer).
// Pure: no I/O. Everything here is safe to cross the preload.

/** One running process, as one sample of the collector sees it. */
export interface ProcessSample {
  readonly pid: number;
  readonly parentPid: number;
  /** Image name as Windows reports it (`node.exe`), never the perf instance name (`node#3`). */
  readonly name: string;
  /** `false` when no living process holds `parentPid`, or the one holding it was born after this one (pid reused): the process is an orphan. */
  readonly parentAlive: boolean;
  readonly workingSetBytes: number;
  readonly writeBytesPerSec: number;
}

/** One sample of the machine. `at` is epoch ms. */
export interface HealthSnapshot {
  readonly at: number;
  readonly ram: { readonly totalBytes: number; readonly freeBytes: number };
  /** `null` when the disk could not be read. */
  readonly disk: { readonly path: string; readonly totalBytes: number; readonly freeBytes: number } | null;
  /** Empty when the process list could not be read (or off Windows). */
  readonly processes: readonly ProcessSample[];
  /** The app itself (main + its helpers): never offered for kill, nor its descendants. */
  readonly ownPids: readonly number[];
}

export type HealthSeverity = 'ok' | 'warn' | 'critical';

export type HealthAction =
  | { readonly kind: 'kill-process'; readonly pid: number; readonly name: string; readonly label: string }
  | { readonly kind: 'open-temp'; readonly label: string };

export interface HealthFinding {
  readonly id: string;
  readonly severity: HealthSeverity;
  readonly title: string;
  readonly detail: string;
  readonly action?: HealthAction;
}

export interface DiskForecast {
  /** Positive = the disk is filling. */
  readonly gbPerHour: number;
  /** `null` when the disk is not filling. */
  readonly hoursToFull: number | null;
}

/** A process as the panel shows it in the top-by-memory list. */
export interface ProcessSummary {
  readonly pid: number;
  readonly name: string;
  readonly workingSetBytes: number;
  readonly writeBytesPerSec: number;
}

/** What the renderer sees. Small on purpose: never the whole process list. */
export interface HealthReport {
  readonly at: number;
  readonly ram: { readonly totalBytes: number; readonly freeBytes: number };
  readonly disk: { readonly path: string; readonly totalBytes: number; readonly freeBytes: number } | null;
  readonly diskForecast: DiskForecast | null;
  readonly findings: readonly HealthFinding[];
  readonly topMemory: readonly ProcessSummary[];
  /** The worst severity among the findings. */
  readonly worst: HealthSeverity;
}
