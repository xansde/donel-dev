// T055 (014-chat, R19) - the timeline's scroll rules as pure functions, so the
// component only measures and applies them.
//
//   - "following the end" while the scroll sits within 40 px of the bottom;
//   - free mode otherwise, with the "novas mensagens" pill - and (D-C9) the
//     pill appears ONLY when a new row landed below the reading position: an
//     in-place update (streaming text, a patched row) or an older page loaded
//     above never raises it;
//   - prepending older history preserves the reading position by the
//     `scrollHeight` difference;
//   - the per-tab view state (following / position) survives the Chat |
//     Terminal toggle.

export const FOLLOW_THRESHOLD_PX = 40;
/** Distance from the top that triggers loading the next older page. */
export const TOP_LOAD_THRESHOLD_PX = 120;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

const maxScrollTop = (m: ScrollMetrics): number => Math.max(0, m.scrollHeight - m.clientHeight);

export const distanceFromEnd = (m: ScrollMetrics): number => maxScrollTop(m) - m.scrollTop;

export const isFollowing = (m: ScrollMetrics): boolean => distanceFromEnd(m) <= FOLLOW_THRESHOLD_PX;

// ---- what changed in the list of rows --------------------------------------

export type RowsChangeKind = 'initial' | 'append' | 'prepend' | 'update' | 'reset' | 'none';

export interface RowsChange {
  readonly kind: RowsChangeKind;
  /** Rows gained (initial: all of them; reset: the new length). */
  readonly added: number;
}

/**
 * Compares two id lists. `none` = same ids (the caller maps it to `update`
 * when the row objects changed). Growth at both ends reads as `append`, so a
 * new row below the reader is never missed.
 */
export function classifyRowsChange(prev: readonly string[], next: readonly string[]): RowsChange {
  if (prev.length === 0) return next.length === 0 ? { kind: 'none', added: 0 } : { kind: 'initial', added: next.length };
  const prevIds = new Set(prev);
  let lastKept = -1;
  for (let i = 0; i < next.length; i += 1) if (prevIds.has(next[i]!)) lastKept = i;
  if (lastKept === -1) return { kind: 'reset', added: next.length };

  const tail = next.length - 1 - lastKept;
  let inner = 0;
  for (let i = 0; i < lastKept; i += 1) if (!prevIds.has(next[i]!)) inner += 1;

  if (tail > 0) return { kind: 'append', added: tail };
  if (inner > 0) return { kind: 'prepend', added: inner };
  return { kind: 'none', added: 0 };
}

// ---- state machine ----------------------------------------------------------

export interface ScrollState {
  readonly following: boolean;
  readonly pill: boolean;
}

export const INITIAL_SCROLL_STATE: ScrollState = { following: true, pill: false };

export type ScrollAction = { readonly kind: 'scroll-to-end' } | { readonly kind: 'preserve' } | { readonly kind: 'none' };

/** The user (or a programmatic jump) moved the scroll. */
export function onUserScroll(state: ScrollState, m: ScrollMetrics): ScrollState {
  const following = isFollowing(m);
  return { following, pill: following ? false : state.pill };
}

export function onRowsChange(state: ScrollState, change: RowsChange): { state: ScrollState; action: ScrollAction } {
  switch (change.kind) {
    case 'initial':
    case 'reset':
      return { state: INITIAL_SCROLL_STATE, action: { kind: 'scroll-to-end' } };
    case 'append':
      return state.following
        ? { state, action: { kind: 'scroll-to-end' } }
        : { state: { following: false, pill: true }, action: { kind: 'none' } };
    case 'prepend':
      return { state, action: { kind: 'preserve' } };
    case 'update':
      return { state, action: state.following ? { kind: 'scroll-to-end' } : { kind: 'none' } };
    case 'none':
      return { state, action: { kind: 'none' } };
  }
}

/** New `scrollTop` after older rows were inserted above: the height gained is added. */
export function preservedScrollTop(prevScrollTop: number, prevScrollHeight: number, nextScrollHeight: number): number {
  return Math.max(0, prevScrollTop + (nextScrollHeight - prevScrollHeight));
}

export function shouldLoadOlder(
  m: ScrollMetrics,
  session: { readonly status: string; readonly cursor: string | null; readonly loadingOlder: boolean },
): boolean {
  if (session.status !== 'ready' || session.cursor === null || session.loadingOlder) return false;
  return m.scrollTop <= TOP_LOAD_THRESHOLD_PX;
}

// ---- per-tab view state -----------------------------------------------------

export interface ViewSnapshot {
  readonly following: boolean;
  readonly pill: boolean;
  readonly scrollTop: number;
}

export function snapshotView(state: ScrollState, m: ScrollMetrics): ViewSnapshot {
  return { following: state.following, pill: state.pill, scrollTop: m.scrollTop };
}

/** Where to put the scroll when the view comes back (content may have grown meanwhile). */
export function restoreScrollTop(snapshot: ViewSnapshot, m: ScrollMetrics): number {
  const max = maxScrollTop(m);
  return snapshot.following ? max : Math.min(snapshot.scrollTop, max);
}
