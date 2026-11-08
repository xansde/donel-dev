import type { SemaphoreStateInfo } from '../../shared';

/**
 * Same state of the semaphore? The bridge repeats the state on every hook of a working session; an equal one keeps
 * the app's record, so the whole app does not render again for nothing (peso do renderer, 08/11). Every field
 * counts, a new one included: a real change dropped here would leave the tab's state stale, and the messages that
 * wait for it (delivery between sessions, the owner's queue) would wait for nothing.
 */
export function sameSemaphoreInfo(a: SemaphoreStateInfo | undefined, b: SemaphoreStateInfo): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = (a as unknown as Record<string, unknown>)[key];
    const y = (b as unknown as Record<string, unknown>)[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((value, index) => value !== y[index])) return false;
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}
