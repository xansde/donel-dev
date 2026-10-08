// Helpers for tests that depend on `fs.watch` / on disk reads finishing.
//
// Deliberately does NOT import `node:fs`: `transcriptWatcher.test.ts` loads this
// file from inside a `vi.mock('node:fs')` factory, and importing the mocked
// module from there would be circular.
import { EventEmitter } from 'node:events';

// Captured at import time, BEFORE any `vi.useFakeTimers()` call replaces them.
const realSetTimeout = globalThis.setTimeout;
const realSetImmediate = globalThis.setImmediate;

/** Real wall-clock delay. Immune to fake timers. */
export const realDelay = (ms: number): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, ms));

/**
 * Polls `predicate` until it is true, or throws. Uses REAL timers, so it keeps
 * working under `vi.useFakeTimers()`. Replaces fixed `sleep`s: the test waits
 * exactly as long as the I/O takes and fails loudly if the condition never holds.
 */
export async function pollUntil(predicate: () => boolean, timeoutMs = 3_000, pollMs = 2): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`pollUntil: condition not met within ${timeoutMs} ms`);
    await realDelay(pollMs);
  }
}

/**
 * Lets pending file reads finish. Used to assert "nothing was emitted": after
 * the stimulus there is no event to wait for, so we drain the libuv threadpool
 * with a few sequential `probe()` round-trips (each is a real async fs call)
 * instead of sleeping a fixed, generous time.
 */
export async function drainIo(probe: () => Promise<unknown>, rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await probe();
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  }
}

// --- fake `fs.watch` ---------------------------------------------------------

type WatchListener = (event: string, fileName: string | null) => void;

class FakeFsWatcher extends EventEmitter {
  closed = false;
  constructor(readonly dir: string, readonly listener: WatchListener) {
    super();
  }
  close(): void {
    this.closed = true;
  }
}

/**
 * Switchable replacement for `fs.watch`. While `active` is false the real
 * implementation runs (so the same test file can mix real and fake cases).
 */
export const fakeFsWatch = {
  active: false,
  watchers: [] as FakeFsWatcher[],

  reset(): void {
    this.active = false;
    this.watchers = [];
  },
  /** Delivers a change event to every open fake watcher (as the OS would). */
  emit(fileName: string | null, options: { includeClosed?: boolean } = {}): void {
    for (const watcher of this.watchers) {
      if (!watcher.closed || options.includeClosed) watcher.listener('change', fileName);
    }
  },
  get openCount(): number {
    return this.watchers.filter((w) => !w.closed).length;
  },
};

/** Builds the `watch` export for the mocked `node:fs`: fake when active, real otherwise. */
export function wrapWatch<T extends (...args: never[]) => unknown>(actualWatch: T): T {
  const wrapped = (...args: unknown[]): unknown => {
    if (!fakeFsWatch.active) return (actualWatch as unknown as (...a: unknown[]) => unknown)(...args);
    const listener = args.find((a): a is WatchListener => typeof a === 'function');
    const watcher = new FakeFsWatcher(String(args[0]), listener ?? (() => undefined));
    fakeFsWatch.watchers.push(watcher);
    return watcher;
  };
  return wrapped as unknown as T;
}

// --- read tracking -----------------------------------------------------------

export interface ReadTracker {
  /** `stat`/`open` on the tracked file not yet finished (an `open` counts until its handle is closed). */
  readonly inFlight: () => number;
  readonly restore: () => void;
}

/**
 * Counts reads of ONE file in flight by wrapping `fs.promises.stat/open` (the
 * same object `src` imports as `fs`). It is the completion signal that lets a
 * test assert "nothing was emitted" without guessing how long the read takes.
 * Calls on other paths (probes, tmpdir cleanup) are passed through untouched.
 */
export function trackReads(
  fsp: { stat: (...a: never[]) => Promise<unknown>; open: (...a: never[]) => Promise<unknown> },
  filePath: string,
): ReadTracker {
  type AnyFn = (...args: unknown[]) => Promise<unknown>;
  const target = fsp as unknown as { stat: AnyFn; open: AnyFn };
  const originalStat = target.stat;
  const originalOpen = target.open;
  let inFlight = 0;

  target.stat = (path, ...rest) => {
    if (path !== filePath) return originalStat.call(fsp, path, ...rest);
    inFlight += 1;
    return originalStat.call(fsp, path, ...rest).finally(() => {
      inFlight -= 1;
    });
  };
  target.open = async (path, ...rest) => {
    if (path !== filePath) return originalOpen.call(fsp, path, ...rest);
    inFlight += 1;
    let handle: { close: () => Promise<void> };
    try {
      handle = (await originalOpen.call(fsp, path, ...rest)) as typeof handle;
    } catch (error) {
      inFlight -= 1;
      throw error;
    }
    const close = handle.close.bind(handle);
    handle.close = () =>
      close().finally(() => {
        inFlight -= 1;
      });
    return handle;
  };

  return {
    inFlight: () => inFlight,
    restore: () => {
      target.stat = originalStat;
      target.open = originalOpen;
    },
  };
}

/** Resolves once the tracked file has had no read in flight for three event-loop turns in a row. */
export async function untilReadsSettle(tracker: ReadTracker, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  for (let calm = 0; calm < 3; ) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`untilReadsSettle: reads still in flight after ${timeoutMs} ms`);
    await new Promise<void>((resolve) => realSetImmediate(resolve));
    calm = tracker.inFlight() === 0 ? calm + 1 : 0;
  }
}
