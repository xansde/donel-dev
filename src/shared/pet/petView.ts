// T026 (015-jobu-pet, US1) - what the pet window draws: the state of the core at one instant, boiled
// down to the pose, the badge and the list. This is the ONLY thing that crosses to the screen, so it
// carries names, ages and kinds of events and nothing else: no command, no question, no excerpt of the
// conversation, no path (FR-018). Pure, like the reducer: the instant is an argument.

import { baseState, isSilenced, waitingSessions } from './petState';
import { PET_TALK_WIDTH } from './placement';
import type { Bubble, PetState, PetUi, PetView, PetViewBubble, PetViewWaiting, PoseName } from './types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The badge (FR-011): nothing at zero, the number up to 9, `9+` above. */
export function badgeOf(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** How long a session has waited, for the list: `agora`, `há 1 min`, `há 12 min`, `há 2 h`. */
export function waitingLabel(elapsedMs: number): string {
  if (elapsedMs < MINUTE_MS) return 'agora';
  if (elapsedMs < HOUR_MS) return `há ${Math.floor(elapsedMs / MINUTE_MS)} min`;
  return `há ${Math.floor(elapsedMs / HOUR_MS)} h`;
}

/** The bubble that is still on screen at `now`, if any. */
function liveBubble(state: PetState, now: number): Bubble | null {
  return state.bubble !== null && now < state.bubble.until ? state.bubble : null;
}

/**
 * The pose, by priority (FR-010, data-model "Pose"): the pose of the bubble while there is one, the
 * laugh while it lasts, then what the sessions ask for - very impatient, impatient, reading, and in the
 * serene state the waffle while it is on or the incense - and asleep when there is no session.
 */
function poseOf(state: PetState, now: number): PoseName {
  const bubble = liveBubble(state, now);
  if (bubble !== null) return bubble.pose;
  if (state.laughUntil !== null && now < state.laughUntil) return 'laughing';
  const base = baseState(state, now);
  // 016: sweeping beats everything calm, but a waiting session is actionable and still shows.
  if (state.sweeping && base !== 'very-impatient' && base !== 'impatient') return 'sweeping';
  switch (base) {
    case 'very-impatient':
      return 'very-impatient';
    case 'impatient':
      return 'impatient';
    case 'reading':
      return 'reading';
    case 'serene':
      return state.waffleUntil !== null && now < state.waffleUntil ? 'waffle' : 'incense';
    case 'sleeping':
      return 'sleeping';
  }
}

function bubbleView(bubble: Bubble | null): PetViewBubble | null {
  return bubble === null ? null : { id: bubble.id, text: bubble.text, pose: bubble.pose, target: bubble.target };
}

/** `ui` is what the window knows and the core does not: the size, whether it sits on the taskbar edge, and where the bubble anchors. */
export function toPetView(state: PetState, now: number, ui: PetUi): PetView {
  const waiting: PetViewWaiting[] = waitingSessions(state).map((entry) => ({
    ptyId: entry.ptyId,
    name: entry.name,
    waitingLabel: waitingLabel(now - entry.waitingSince),
  }));
  return {
    pose: poseOf(state, now),
    badge: badgeOf(waiting.length),
    bubble: bubbleView(liveBubble(state, now)),
    waiting,
    docked: ui.docked,
    align: ui.align,
    silenced: isSilenced(state, now),
    size: ui.size,
    talk: ui.talk ?? 0,
    talkWidth: ui.talkWidth ?? PET_TALK_WIDTH,
    talkExpanded: ui.talkExpanded ?? false,
  };
}
