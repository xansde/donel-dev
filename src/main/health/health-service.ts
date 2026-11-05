// Saúde do computador - samples the machine every minute while the app is open, keeps the last report
// and ends a process on request (behind the kill guard). One sample at a time; the collector runs
// asynchronously, so the main never blocks on it. Tested with fakes (tests/health-service.test.ts).

import { analyzeHealth } from '../../shared/health/analyze';
import type { KillProcessOutcome } from '../../shared/health/ipc';
import { normalizeProcessName } from '../../shared/health/protected';
import type { HealthReport, HealthSnapshot } from '../../shared/health/types';
import { checkKillRequest } from './kill-guard';

export const HEALTH_SAMPLE_INTERVAL_MS = 60_000;
/** The first sample waits for the boot to settle: the app has enough to do in its first seconds. */
export const HEALTH_FIRST_SAMPLE_DELAY_MS = 10_000;

export interface HealthServiceDeps {
  readonly collect: () => Promise<HealthSnapshot>;
  readonly onReport: (report: HealthReport) => void;
  /** The app's pids right now (main + helpers), on top of the ones the last sample saw. */
  readonly ownPids: () => readonly number[];
  /** The current image name of `pid`, `null` when nobody holds it. */
  readonly lookupProcessName: (pid: number) => Promise<string | null>;
  /** Ends `pid`; throws when the system refuses. */
  readonly terminate: (pid: number) => void;
  readonly intervalMs?: number;
  readonly firstDelayMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface HealthService {
  start(): void;
  stop(): void;
  getReport(): HealthReport | null;
  /** Samples now, or joins the sample already running. */
  refresh(): Promise<HealthReport | null>;
  killProcess(pid: unknown): Promise<KillProcessOutcome>;
}

export function createHealthService(deps: HealthServiceDeps): HealthService {
  const intervalMs = deps.intervalMs ?? HEALTH_SAMPLE_INTERVAL_MS;
  const firstDelayMs = deps.firstDelayMs ?? HEALTH_FIRST_SAMPLE_DELAY_MS;
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, ms: number) => {
      const handle = setTimeout(callback, ms);
      handle.unref?.();
      return handle;
    });
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let lastSnapshot: HealthSnapshot | null = null;
  let lastReport: HealthReport | null = null;
  let inFlight: Promise<HealthReport | null> | null = null;
  let timer: unknown = null;
  let running = false;

  function sample(): Promise<HealthReport | null> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const snapshot = await deps.collect();
        const report = analyzeHealth(snapshot, lastSnapshot ?? undefined);
        lastSnapshot = snapshot;
        lastReport = report;
        deps.onReport(report);
        return report;
      } catch (error) {
        console.warn('[donel-dev] saúde do PC: amostra falhou:', error instanceof Error ? error.message : error);
        return lastReport;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule(ms: number): void {
    if (!running) return;
    timer = setTimer(() => {
      timer = null;
      void sample().finally(() => schedule(intervalMs));
    }, ms);
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(firstDelayMs);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    getReport: () => lastReport,
    refresh: sample,
    async killProcess(pid) {
      const snapshot = lastSnapshot ? { ...lastSnapshot, ownPids: [...lastSnapshot.ownPids, ...deps.ownPids()] } : null;
      const check = checkKillRequest(pid, lastReport, snapshot);
      if (!check.ok) return check;

      // Up to a minute passed since the sample: the pid may be gone, or reused by another program.
      const current = await deps.lookupProcessName(check.pid);
      if (current === null || normalizeProcessName(current) !== normalizeProcessName(check.name)) return { ok: false, reason: 'changed' };

      try {
        deps.terminate(check.pid);
      } catch (error) {
        console.warn(`[donel-dev] saúde do PC: encerrar pid ${check.pid} falhou:`, error instanceof Error ? error.message : error);
        return { ok: false, reason: 'failed' };
      }
      void sample();
      return { ok: true, pid: check.pid, name: check.name };
    },
  };
}
