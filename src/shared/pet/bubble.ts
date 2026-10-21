// T031 (015-jobu-pet, US2) - the words and the shape of the bubble: what each event says (FR-015), the
// pose it brings (FR-016), how tab names are cut, and what a group of events says as ONE bubble
// (FR-017). Pure: no clock, no state. WHEN a bubble is born, joined, refined or dismissed is the
// reducer's business (petState.ts); this file only answers "what would it say?".
//
// Nothing here reads the conversation: the only inputs are the name of a tab, the kind of an event and,
// for a blocked session, the kind of its pending (FR-018).

import type { BubbleEvent, BubbleTarget, PoseName } from './types';

/** FR-017: a bubble stays about this long. */
export const PET_BUBBLE_MS = 6_000;
/** FR-017: an event that arrives up to this long after a bubble was born joins it instead of replacing it. */
export const PET_BUBBLE_JOIN_MS = 1_000;
/** FR-015: a tab name longer than this is cut and closed with an ellipsis. */
export const PET_BUBBLE_NAME_MAX = 28;

/**
 * Names over 28 characters keep the first 28 and take an ellipsis: `abc…`. Counted in characters, not in
 * UTF-16 units, so an emoji at the edge is never cut in half.
 */
export function truncateTabName(name: string): string {
  const characters = [...name];
  if (characters.length <= PET_BUBBLE_NAME_MAX) return name;
  return `${characters.slice(0, PET_BUBBLE_NAME_MAX).join('')}…`;
}

/** What the session waits for, in the words of FR-015. A kind that is not known (no chat) is the permission, the common case (R3). */
const BLOCKED_TEXT = {
  question: 'tem uma pergunta',
  permission: 'quer permissão',
  plan: 'plano para aprovar',
} as const;

/** The text of ONE event: `<aba> · terminou`, `<aba> · tem uma pergunta`, `<aba> · quer permissão`, `<aba> · plano para aprovar`, `<aba> · encerrou`. */
export function eventText(event: BubbleEvent): string {
  const name = truncateTabName(event.name);
  switch (event.kind) {
    case 'finished':
      return `${name} · terminou`;
    case 'blocked':
      return `${name} · ${BLOCKED_TEXT[event.blockedKind ?? 'permission']}`;
    case 'ended':
      return `${name} · encerrou`;
  }
}

/** FR-016: calling (finished), surprised (blocked), sad (ended). */
export function eventPose(event: BubbleEvent): PoseName {
  switch (event.kind) {
    case 'finished':
      return 'calling';
    case 'blocked':
      return 'surprised';
    case 'ended':
      return 'sad';
  }
}

/** What the screen needs of a bubble that the clock does not decide: the words, the pose and where a click goes. */
export interface BubbleFace {
  readonly text: string;
  readonly pose: PoseName;
  readonly target: BubbleTarget;
}

/**
 * The bubble that says a set of session events (one per session). One event speaks for itself and a click
 * leads to its tab. Two or more become a count, and a click opens the list: `N sessões terminaram` when
 * they all finished, `N sessões encerraram` when they all ended (Q9), and `N sessões esperando você` when
 * the kinds mix or when they are all blocked - an `ended` among the others counts as one more waiting.
 * The aggregate never names a tab.
 */
export function composeBubble(events: readonly BubbleEvent[]): BubbleFace {
  const [first] = events;
  if (first === undefined) throw new RangeError('composeBubble: no events to say');
  if (events.length === 1) return { text: eventText(first), pose: eventPose(first), target: { kind: 'session', ptyId: first.ptyId } };

  const count = events.length;
  if (events.every((event) => event.kind === 'finished')) return { text: `${count} sessões terminaram`, pose: 'calling', target: { kind: 'list' } };
  if (events.every((event) => event.kind === 'ended')) return { text: `${count} sessões encerraram`, pose: 'sad', target: { kind: 'list' } };
  return { text: `${count} sessões esperando você`, pose: 'surprised', target: { kind: 'list' } };
}
