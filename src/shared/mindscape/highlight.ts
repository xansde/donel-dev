import type { SemaphoreState } from '../index';

/** How a session post-it looks on the board (rule 3 of docs/produto/mindscape.spec.md). */
export type SessionHighlight = 'normal' | 'highlighted' | 'dimmed';

/**
 * `working` → normal; any other state → highlighted when it was entered after
 * the owner's last visit to the session (`seenAt`, 0 when never visited),
 * dimmed otherwise. An error counts as news, like a finished turn.
 */
export function sessionHighlight(state: SemaphoreState, stateEnteredAt: number, seenAt: number | undefined): SessionHighlight {
  if (state === 'working') return 'normal';
  return stateEnteredAt > (seenAt ?? 0) ? 'highlighted' : 'dimmed';
}
