// Saúde das VPS - reads every remote place once a minute (and on demand, when the panel opens), all places in
// parallel, one round at a time. Each read is one short ssh with a short timeout, run asynchronously: a place
// that is down only turns into "sem sinal" with the time of its last good read; the main never waits on it.

import { buildRemoteHealthScript, parseRemoteHealthOutput, remoteHealthSeverity, type RemoteHealthReport } from '../../shared/health/remote';

export const REMOTE_HEALTH_INTERVAL_MS = 60_000;
/** Lets the boot settle, like the PC sample. */
export const REMOTE_HEALTH_FIRST_DELAY_MS = 15_000;
/** One ssh round trip plus a few `/proc` reads: past this the place counts as down. */
export const REMOTE_HEALTH_TIMEOUT_MS = 8_000;

export interface RemoteHealthPlace {
  readonly id: string;
  readonly label: string;
  readonly sshTarget: string;
}

export interface RemoteHealthServiceDeps {
  readonly places: () => readonly RemoteHealthPlace[];
  readonly run: (sshTarget: string, script: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string }>;
  readonly onReports: (reports: readonly RemoteHealthReport[]) => void;
  readonly now?: () => number;
}

export interface RemoteHealthService {
  start(): void;
  stop(): void;
  getReports(): readonly RemoteHealthReport[];
  /** Reads now, or joins the round already running. */
  refresh(): Promise<readonly RemoteHealthReport[]>;
}

export function createRemoteHealthService(deps: RemoteHealthServiceDeps): RemoteHealthService {
  const now = deps.now ?? Date.now;
  const known = new Map<string, RemoteHealthReport>();
  let inFlight: Promise<readonly RemoteHealthReport[]> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  /** The reports in the order of the config; a place that left the config leaves the list. */
  function current(): RemoteHealthReport[] {
    return deps.places().map(
      (place) =>
        known.get(place.id) ?? { id: place.id, label: place.label, status: 'pending', checkedAt: null, lastOkAt: null, reading: null, severity: 'ok' },
    );
  }

  async function readPlace(place: RemoteHealthPlace): Promise<void> {
    let stdout = '';
    try {
      stdout = (await deps.run(place.sshTarget, buildRemoteHealthScript(), REMOTE_HEALTH_TIMEOUT_MS)).stdout;
    } catch {
      // counts as no answer
    }
    const reading = parseRemoteHealthOutput(stdout);
    const at = now();
    const previous = known.get(place.id);
    known.set(
      place.id,
      reading
        ? { id: place.id, label: place.label, status: 'ok', checkedAt: at, lastOkAt: at, reading, severity: remoteHealthSeverity(reading) }
        : {
            id: place.id,
            label: place.label,
            status: 'unreachable',
            checkedAt: at,
            lastOkAt: previous?.lastOkAt ?? null,
            reading: previous?.reading ?? null,
            severity: previous?.severity ?? 'ok',
          },
    );
  }

  function round(): Promise<readonly RemoteHealthReport[]> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const places = deps.places();
        await Promise.all(places.map((place) => readPlace(place)));
        const reports = current();
        if (places.length > 0) deps.onReports(reports);
        return reports;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule(ms: number): void {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void round().finally(() => schedule(REMOTE_HEALTH_INTERVAL_MS));
    }, ms);
    timer.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(REMOTE_HEALTH_FIRST_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    getReports: current,
    refresh: round,
  };
}
