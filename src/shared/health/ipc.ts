// Saúde do computador - the IPC contract: channel names, the outcomes and the `window.donel.health` API.
// Same `'<domain>:<action>'` pattern as the other domains.

import type { RemoteHealthReport } from './remote';
import type { HealthReport } from './types';

export const HEALTH_CHANNELS = {
  /** invoke -> the last report, `null` before the first sample. */
  get: 'health:get',
  /** invoke -> runs a sample now (unless one is running) and resolves with the report. */
  refresh: 'health:refresh',
  /** main -> renderer, after every sample. */
  changed: 'health:changed',
  /** invoke(pid) -> `KillProcessOutcome`. Only pids offered by the last report. */
  killProcess: 'health:killProcess',
  /** invoke -> opens %TEMP% in the Explorer; resolves with `''` or the error message. */
  openTemp: 'health:openTemp',
  /** invoke -> the last report of each remote place (VPS), in the order of the config. */
  remoteGet: 'health:remoteGet',
  /** invoke -> reads every remote place now (unless a round is running) and resolves with the reports. */
  remoteRefresh: 'health:remoteRefresh',
  /** main -> renderer, after every round of remote reads. */
  remoteChanged: 'health:remoteChanged',
} as const;

export type KillRefusal =
  /** Not a positive integer. */
  | 'invalid-pid'
  /** No sample yet. */
  | 'no-report'
  /** The last report did not offer to end this pid. */
  | 'not-in-report'
  /** A Windows piece (svchost, explorer, ...). */
  | 'protected-system'
  /** The app itself, or a terminal/session it opened. */
  | 'own-app'
  /** The pid is now held by another program (or by none): nothing was ended. */
  | 'changed'
  /** The system refused (permission, already gone). */
  | 'failed';

export type KillProcessOutcome = { readonly ok: true; readonly pid: number; readonly name: string } | { readonly ok: false; readonly reason: KillRefusal };

/** API exposed by the preload at `window.donel.health`. */
export interface DonelHealthApi {
  get(): Promise<HealthReport | null>;
  refresh(): Promise<HealthReport | null>;
  onChanged(listener: (report: HealthReport) => void): () => void;
  killProcess(pid: number): Promise<KillProcessOutcome>;
  openTemp(): Promise<string>;
  remoteGet(): Promise<readonly RemoteHealthReport[]>;
  remoteRefresh(): Promise<readonly RemoteHealthReport[]>;
  onRemoteChanged(listener: (reports: readonly RemoteHealthReport[]) => void): () => void;
}
