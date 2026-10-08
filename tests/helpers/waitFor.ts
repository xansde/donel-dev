import { vi } from 'vitest';

export interface WaitForOptions {
  /** Max time to wait (fake time when fake timers are active). */
  readonly timeout?: number;
  /** Polling step; with fake timers it is how far the fake clock advances per check. */
  readonly interval?: number;
}

/**
 * Single shared `waitFor` for the test suite. The callback either returns a
 * boolean (false = keep waiting) or throws (e.g. an `expect`) while the
 * condition is not met. With `vi.useFakeTimers()` active the fake clock is
 * advanced per iteration (no real waiting); otherwise it polls in real time.
 */
export async function waitFor(check: () => boolean | void, options: WaitForOptions = {}): Promise<void> {
  const timeout = options.timeout ?? 2000;
  const interval = options.interval ?? 10;
  let elapsed = 0;
  let lastError: unknown = null;
  for (;;) {
    try {
      if (check() !== false) return;
      lastError = new Error('waitFor: condition returned false');
    } catch (error) {
      lastError = error;
    }
    if (elapsed >= timeout) {
      throw lastError instanceof Error ? lastError : new Error(`waitFor: condition not met within ${timeout} ms`);
    }
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(interval);
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
    }
    elapsed += interval;
  }
}
