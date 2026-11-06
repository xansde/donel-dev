// Espelho do Oráculo — a layer that only WATCHES the ledger (`LedgerService.onChange`), never writes it. After a
// change it waits a little (a burst — create, take, deliver — goes as one registry), turns the whole document into
// rows (`demandaRows`, secrets masked) and hands them to the destination (`MirrorSink`, Supabase today). It never
// throws into the app and never blocks it: a failure (no network, the destination down) keeps the latest document
// pending and tries again later, growing the wait; the next change goes too. The ledger file stays the source:
// after a restart the main simply mirrors it once more.

import { demandaRows, type DemandaRow, type MaskNote } from '../../shared/ledger/mirror';
import type { LedgerDoc } from '../../shared/ledger/contract';
import type { PlaceNameOf } from '../../shared/ledger/labels';

/** Where the rows go. `push` gets every row (an upsert); it rejects on failure, with a message free of secrets. */
export interface MirrorSink {
  push(rows: readonly DemandaRow[]): Promise<void>;
}

export interface MirrorTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LedgerMirrorDeps {
  /** `null` = mirror off (not configured): changes are ignored. Read at every push (the owner may configure later). */
  readonly sink: () => MirrorSink | null;
  /** Called once per push: the place names as they are now (one read of the boards, not one per task). */
  readonly placeNames?: () => PlaceNameOf;
  /** The wait that joins a burst of changes (default 45 s). */
  readonly delayMs?: number;
  /** First retry after a failure; doubles up to `maxRetryMs`. */
  readonly retryMs?: number;
  readonly maxRetryMs?: number;
  readonly timers?: MirrorTimers;
  readonly now?: () => number;
  /** One line per event (masked fields, failures). Never a secret. */
  readonly log?: (line: string) => void;
}

export interface LedgerMirrorStatus {
  readonly lastSyncAt: number | null;
  readonly pending: boolean;
  readonly lastError: string | null;
}

export interface LedgerMirror {
  /** The ledger changed (or the app opened): mirror this document after the wait. */
  changed(doc: LedgerDoc): void;
  /** Push now, skipping the wait (the Preferences' "Enviar agora", the first sync after configuring). */
  flush(): Promise<void>;
  status(): LedgerMirrorStatus;
  dispose(): void;
}

export const DEFAULT_MIRROR_DELAY_MS = 45_000;
const DEFAULT_RETRY_MS = 60_000;
const DEFAULT_MAX_RETRY_MS = 15 * 60_000;

const nodeTimers: MirrorTimers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // Never keeps the process alive on quit.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createLedgerMirror(deps: LedgerMirrorDeps): LedgerMirror {
  const delayMs = deps.delayMs ?? DEFAULT_MIRROR_DELAY_MS;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  const maxRetryMs = deps.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const timers = deps.timers ?? nodeTimers;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);

  /** The latest document not mirrored yet. */
  let pendingDoc: LedgerDoc | null = null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let lastSyncAt: number | null = null;
  let lastError: string | null = null;
  let disposed = false;

  function schedule(ms: number): void {
    if (disposed || timer !== null) return;
    timer = timers.set(() => {
      timer = null;
      void run();
    }, ms);
  }

  async function run(): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      // A change arrived while a push was on its way: it goes right after.
      await inFlight;
      return run();
    }
    const doc = pendingDoc;
    if (!doc) return;
    const sink = deps.sink();
    if (!sink) return; // off: the document stays pending until the owner configures it (flush on configure)
    pendingDoc = null;
    inFlight = (async () => {
      try {
        const { rows, masked } = demandaRows(doc, deps.placeNames?.());
        for (const note of masked) log(logMasked(note));
        await sink.push(rows);
        failures = 0;
        lastError = null;
        lastSyncAt = now();
      } catch (error) {
        // Keep the newest: a change that came meanwhile wins over the one that failed.
        pendingDoc ??= doc;
        failures += 1;
        lastError = error instanceof Error ? error.message : 'falhou';
        const wait = Math.min(retryMs * 2 ** (failures - 1), maxRetryMs);
        log(`falhou (${lastError}); tento de novo em ${Math.round(wait / 1000)} s`);
        schedule(wait);
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    changed(doc) {
      if (disposed) return;
      pendingDoc = doc;
      // A fixed window from the FIRST change of a burst: the burst goes as one, and a steady stream of changes
      // never postpones the registry forever. After a failure the backoff timer is already set — it carries this
      // newer document too.
      schedule(delayMs);
    },
    async flush() {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
      await run();
    },
    status: () => ({ lastSyncAt, pending: pendingDoc !== null, lastError }),
    dispose() {
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}

function logMasked(note: MaskNote): string {
  return `mascarado: tarefa ${note.taskId}, campo ${note.field} (${note.kinds.join(', ')})`;
}
