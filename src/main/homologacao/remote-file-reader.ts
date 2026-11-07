// Mindscape de homologação V1 — one remote file, read every 50 s (and on demand, when a panel opens) with one
// short `ssh ... cat` and a timeout, like the Saúde das VPS. Read-only: nothing is written on the place. The main
// never waits on it: a place that is down only turns into "sem sinal", keeping the last good read.
// Reused for `metricas.json` (fatia 1) and `rigs.json` (fatia 2): each file gets its own reader and parser.

import { buildRemoteFileScript, parseRemoteFileOutput, type RemoteFileState } from '../../shared/homologacao/remoteFile';

/**
 * Counted from the end of a read, so a change on the place shows up within this plus one ssh (at most the timeout):
 * 50 s + 8 s stays inside the minute the plan promises.
 */
export const REMOTE_FILE_INTERVAL_MS = 50_000;
export const REMOTE_FILE_FIRST_DELAY_MS = 15_000;
export const REMOTE_FILE_TIMEOUT_MS = 8_000;

/** Where to read: `null` = the config does not ask for this file, and no ssh goes out. */
export interface RemoteFileSource {
  readonly sshTarget: string;
  readonly path: string;
}

export interface RemoteFileReaderDeps<T> {
  /** Asked before every read, so a config change applies on the next round. */
  readonly source: () => RemoteFileSource | null;
  readonly parse: (text: string) => T;
  readonly run: (sshTarget: string, script: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string }>;
  readonly onState: (state: RemoteFileState<T>) => void;
  readonly now?: () => number;
}

export interface RemoteFileReader<T> {
  start(): void;
  stop(): void;
  get(): RemoteFileState<T>;
  /** Reads now, or joins the read already running. */
  refresh(): Promise<RemoteFileState<T>>;
}

const OFF = { status: 'off', checkedAt: null, lastOkAt: null, value: null } as const;

export function createRemoteFileReader<T>(deps: RemoteFileReaderDeps<T>): RemoteFileReader<T> {
  const now = deps.now ?? Date.now;
  let state: RemoteFileState<T> = OFF;
  let key: string | null = null;
  let inFlight: Promise<RemoteFileState<T>> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function publish(next: RemoteFileState<T>): RemoteFileState<T> {
    const changed = next !== state;
    state = next;
    if (changed) deps.onState(state);
    return state;
  }

  async function read(): Promise<RemoteFileState<T>> {
    const source = deps.source();
    if (!source) {
      key = null;
      return state.status === 'off' ? state : publish(OFF);
    }
    // Another place or path: the last good read belongs to the old file.
    const sourceKey = `${source.sshTarget}\n${source.path}`;
    if (sourceKey !== key) {
      key = sourceKey;
      state = { status: 'pending', checkedAt: null, lastOkAt: null, value: null };
    }
    let stdout = '';
    try {
      stdout = (await deps.run(source.sshTarget, buildRemoteFileScript(source.path), REMOTE_FILE_TIMEOUT_MS)).stdout;
    } catch {
      // counts as no answer
    }
    const output = parseRemoteFileOutput(stdout);
    const at = now();
    if (output?.found) return publish({ status: 'ok', checkedAt: at, lastOkAt: at, value: deps.parse(output.text) });
    return publish({ ...state, status: output ? 'missing' : 'unreachable', checkedAt: at });
  }

  function refresh(): Promise<RemoteFileState<T>> {
    if (inFlight) return inFlight;
    inFlight = read().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function schedule(ms: number): void {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh().finally(() => schedule(REMOTE_FILE_INTERVAL_MS));
    }, ms);
    timer.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(REMOTE_FILE_FIRST_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    get: () => state,
    refresh,
  };
}
