// T037 (015-jobu-pet, US3) - what a click on the Jobu, or on his bubble, leads to (FR-022 to FR-025).
// Pure and shared on purpose: the screen asks it to know whether a click opens the list (the list is
// the screen's own state) or goes to the main as a gesture, and the main asks it to answer `pet:click`
// with ITS state of who waits. One function, so the two cannot disagree.
//
// The answer is a `BubbleTarget`: it is the same three places a bubble can lead to - a session, the
// list, or the Donel as it is.

import type { BubbleTarget, PetViewBubble, PetViewWaiting } from './types';

/**
 * A click on the drawing: nobody waiting brings the Donel to the front without changing tab (FR-024), one
 * waiting goes to its tab (FR-022), several open the list (FR-023).
 */
export function decideClick(view: { readonly waiting: readonly PetViewWaiting[] }): BubbleTarget {
  const [only, second] = view.waiting;
  if (only === undefined) return { kind: 'donel' };
  if (second === undefined) return { kind: 'session', ptyId: only.ptyId };
  return { kind: 'list' };
}

/**
 * A click on the bubble goes where the bubble says (FR-025): the tab of its session - also when that
 * session ended, because its tab is still there - the Donel for an account bubble, and for an aggregate
 * the list, as long as there is a list to show: with one left waiting that one is the answer, and with
 * none the Donel comes to the front.
 */
export function decideBubbleClick(bubble: PetViewBubble, waiting: readonly PetViewWaiting[]): BubbleTarget {
  switch (bubble.target.kind) {
    case 'session':
    case 'donel':
      return bubble.target;
    case 'list':
      return decideClick({ waiting });
  }
}
