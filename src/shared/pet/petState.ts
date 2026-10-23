// T025/T031 (015-jobu-pet, US1/US2) - the reducer of the pet core. It takes what the main knows (the tabs
// and what the semaphore says of each, the focus of the Donel window, the 1 s clock, the exit of a
// process, a pending the chat opened) and keeps what the owner should see: who is waiting, whether the
// owner has seen it, the laugh, the serene period, the waffle and the bubble. Pure: no Electron, no
// timer, no `Date.now()`. The clock is the `now` argument, so every rule of
// specs/015-jobu-pet/data-model.md is tested with a clock the test moves by hand.
//
// What the face and the badge are made of is derived from the state at a given instant by petView.ts;
// what a bubble SAYS is bubble.ts; here is when one is born, joined, refined, dismissed or expires.
//
// A wait is born in `trackSession`, the only place where a session enters `waiting`/`permission`. If the
// session was already known and the owner is not looking at it, that birth is also the `finished` or
// `blocked` event of a bubble. A change of account (`accountSwitched`, US4) is a bubble of its own that
// belongs to no session: it replaces whatever is up and nothing ever joins it.

import { PET_BUBBLE_JOIN_MS, PET_BUBBLE_MS, accountBubbleFace, composeBubble, sweepBubbleFace } from './bubble';
import type {
  AccountSwitchedEvent,
  BubbleEvent,
  FocusSignal,
  FullscreenEvent,
  PendingOpenedEvent,
  PetInput,
  PetSemaphore,
  PetState,
  SemaphorePublicState,
  SessionExitedEvent,
  SilenceEvent,
  SweepFinishedEvent,
  TrackedSession,
  WatchedSession,
} from './types';

/** D10: a session that has waited more than this makes the Jobu very impatient. */
export const PET_VERY_IMPATIENT_MS = 10 * 60_000;
/** FR-012: how long the laugh of an emptied queue lasts. */
export const PET_LAUGH_MS = 2_500;
/** FR-013: how long the Jobu stays serene before the waffle comes. */
export const PET_WAFFLE_AFTER_MS = 20 * 60_000;
/** FR-013: how long the waffle stays on screen. */
export const PET_WAFFLE_MS = 8_000;
/** FR-026: "Silenciar por 1 hora". */
export const PET_SILENCE_MS = 60 * 60_000;

export function createPetState(): PetState {
  return {
    sessions: new Map(),
    focus: { activePtyId: null, donelFocused: false },
    bubble: null,
    lastBubbleId: 0,
    pendingBurst: [],
    laughUntil: null,
    sereneSince: null,
    waffleShown: false,
    waffleUntil: null,
    silencedUntil: null,
    fullscreen: false,
  };
}

/**
 * From what the semaphore published to what the core reads (R2): no update at all is `idle` (a tab
 * that was just opened is not "working" because the semaphore is born that way), and `error` is `done`.
 */
export function toPetSemaphore(published: SemaphorePublicState | undefined): PetSemaphore {
  if (published === undefined) return 'idle';
  return published === 'error' ? 'done' : published;
}

function isWaitingSemaphore(semaphore: PetSemaphore): boolean {
  return semaphore === 'waiting' || semaphore === 'permission';
}

/** The owner is looking at this session right now: its tab in front, in a Donel window that has the focus. */
function isSeenNow(focus: FocusSignal, ptyId: string): boolean {
  return focus.donelFocused && focus.activePtyId === ptyId;
}

// ---------------------------------------------------------------------------
// Derived from the state (no clock needed, except `baseState`)
// ---------------------------------------------------------------------------

export interface WaitingEntry {
  readonly ptyId: string;
  readonly name: string;
  readonly waitingSince: number;
}

/** "Esperando": a wait that started and that the owner has not seen yet. The oldest first; ties keep the order of the tabs. */
export function waitingSessions(state: PetState): readonly WaitingEntry[] {
  const entries: WaitingEntry[] = [];
  for (const [ptyId, session] of state.sessions) {
    if (session.waitingSince !== null && !session.seen) entries.push({ ptyId, name: session.name, waitingSince: session.waitingSince });
  }
  return entries.sort((a, b) => a.waitingSince - b.waitingSince);
}

export function waitingCount(state: PetState): number {
  let count = 0;
  for (const session of state.sessions.values()) {
    if (session.waitingSince !== null && !session.seen) count += 1;
  }
  return count;
}

/** The face the sessions alone ask for (FR-010), before a bubble or a laugh gets in front of it. */
export type BaseState = 'sleeping' | 'serene' | 'reading' | 'impatient' | 'very-impatient';

export function baseState(state: PetState, now: number): BaseState {
  let oldestWait: number | null = null;
  let working = false;
  let alive = false;
  for (const session of state.sessions.values()) {
    if (session.waitingSince !== null && !session.seen && (oldestWait === null || session.waitingSince < oldestWait)) oldestWait = session.waitingSince;
    if (session.semaphore === 'working') working = true;
    if (session.semaphore !== 'done') alive = true;
  }
  if (oldestWait !== null) return now - oldestWait > PET_VERY_IMPATIENT_MS ? 'very-impatient' : 'impatient';
  if (working) return 'reading';
  return alive ? 'serene' : 'sleeping';
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** What one tab's signal turns into: its record, and the event of the bubble when a wait was born out of sight. */
interface Tracked {
  readonly session: TrackedSession;
  readonly event: BubbleEvent | null;
}

/**
 * One tab, one signal. A wait is born when the session enters `waiting`/`permission` and was not in
 * one: that moment dates it and decides whether the owner is already looking at it ("born seen",
 * FR-009). A session that is already counted keeps its date and its `seen` through every later signal:
 * the same state again (dedupe), `waiting` to `permission` and back (R3). Working or done clear the
 * wait, so the next one is a new wait.
 *
 * A wait born unseen, on a session the core already knew, is also the event of a bubble: `finished` for
 * `waiting`, `blocked` for `permission` (with the kind of the pending when the service knows it). A
 * session met for the first time (`previous === undefined`) never gives one, because nobody saw it
 * change, and neither does one born seen (FR-019).
 */
function trackSession(previous: TrackedSession | undefined, watched: WatchedSession, now: number, focus: FocusSignal): Tracked {
  let waitingSince: number | null = null;
  let seen = false;
  let event: BubbleEvent | null = null;
  if (isWaitingSemaphore(watched.semaphore)) {
    if (previous !== undefined && previous.waitingSince !== null) {
      waitingSince = previous.waitingSince;
      seen = previous.seen;
    } else {
      waitingSince = now;
      seen = isSeenNow(focus, watched.ptyId);
      if (previous !== undefined && !seen) {
        const blocked = watched.semaphore === 'permission';
        event = { kind: blocked ? 'blocked' : 'finished', ptyId: watched.ptyId, name: watched.name, blockedKind: blocked ? watched.blockedKind : null, at: now };
      }
    }
  }
  return { session: { name: watched.name, semaphore: watched.semaphore, blockedKind: watched.blockedKind, waitingSince, seen }, event };
}

/** The new list replaces the old one: whoever is not in it was closed (no event, FR-009). The events its changes gave go to the bubble. */
function withSessions(state: PetState, incoming: readonly WatchedSession[], now: number): PetState {
  const sessions = new Map<string, TrackedSession>();
  const events: BubbleEvent[] = [];
  for (const watched of incoming) {
    const tracked = trackSession(state.sessions.get(watched.ptyId), watched, now, state.focus);
    sessions.set(watched.ptyId, tracked.session);
    if (tracked.event !== null) events.push(tracked.event);
  }
  return announce({ ...state, sessions }, events, now);
}

/** The process of a session exited. The record goes, and unless the owner closed the tab or is looking at it, the bubble says it ended. */
function withSessionExited(state: PetState, input: SessionExitedEvent, now: number): PetState {
  const tracked = state.sessions.get(input.ptyId);
  if (tracked === undefined) return state; // a plain terminal, or a tab never reported: nothing to announce
  const sessions = new Map(state.sessions);
  sessions.delete(input.ptyId);
  const next: PetState = { ...state, sessions };
  // `byUser`: the owner closed it (R6). Looking at it: born seen, like a wait (Q9). Neither deserves a bubble.
  if (input.byUser || isSeenNow(state.focus, input.ptyId)) return next;
  return announce(next, [{ kind: 'ended', ptyId: input.ptyId, name: tracked.name, blockedKind: null, at: now }], now);
}

/** "On every change of focus or signal, every waiting session that is seen now becomes `seen = true`." */
function markSeen(state: PetState): { readonly state: PetState; readonly flipped: number } {
  let sessions: Map<string, TrackedSession> | null = null;
  let flipped = 0;
  for (const [ptyId, session] of state.sessions) {
    if (session.waitingSince === null || session.seen || !isSeenNow(state.focus, ptyId)) continue;
    sessions ??= new Map(state.sessions);
    sessions.set(ptyId, { ...session, seen: true });
    flipped += 1;
  }
  return sessions === null ? { state, flipped: 0 } : { state: { ...state, sessions }, flipped };
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

/** The owner silenced the notices and the hour has not passed yet (the menu then offers "Retomar avisos"). */
export function isSilenced(state: PetState, now: number): boolean {
  return state.silencedUntil !== null && now < state.silencedUntil;
}

/** No bubble is born while the owner silenced them (FR-020, FR-027) or while an app has the whole screen (Q9). */
function bubblesAllowed(state: PetState, now: number): boolean {
  return !state.fullscreen && !isSilenced(state, now);
}

/**
 * Does the bubble in view still take events? Only a bubble about sessions (it has events behind it), up
 * to a second after it was born (it was born at `until - 6 s`): a bubble of another kind, like the
 * account one, is never joined.
 */
function acceptsEvents(state: PetState, now: number): boolean {
  const { bubble } = state;
  if (bubble === null || state.pendingBurst.length === 0 || now >= bubble.until) return false;
  return now - (bubble.until - PET_BUBBLE_MS) <= PET_BUBBLE_JOIN_MS;
}

function withoutBubble(state: PetState): PetState {
  return state.bubble === null && state.pendingBurst.length === 0 ? state : { ...state, bubble: null, pendingBurst: [] };
}

/**
 * Session events become the bubble (FR-014, FR-017). Within the first second of a bubble they join it:
 * the text becomes the aggregate, the id stays (so the screen does not hop twice) and the end stays too.
 * A session counts once, by its latest event. Out of that window an event REPLACES the bubble, with a new
 * id and a fresh 6 s. Silenced, or with an app on the whole screen, nothing is born: the sessions keep
 * being counted all the same, and what was lost is not repeated when the silence ends.
 */
function announce(state: PetState, events: readonly BubbleEvent[], now: number): PetState {
  if (events.length === 0 || !bubblesAllowed(state, now)) return state;
  let next = state;
  for (const event of events) {
    if (next.bubble !== null && acceptsEvents(next, now)) {
      const burst = [...next.pendingBurst.filter((joined) => joined.ptyId !== event.ptyId), event];
      next = { ...next, pendingBurst: burst, bubble: { ...next.bubble, ...composeBubble(burst) } };
    } else {
      const id = next.lastBubbleId + 1;
      const burst = [event];
      next = { ...next, lastBubbleId: id, pendingBurst: burst, bubble: { id, ...composeBubble(burst), until: now + PET_BUBBLE_MS } };
    }
  }
  return next;
}

/**
 * The chat says what the pending is. It refines the kind of the `blocked` event of that session while the
 * bubble is still inside its first second (the semaphore turns `permission` before the chat says whether it
 * is a question or a plan), and does nothing else: it never creates a bubble (R3) and never touches a
 * `finished` one.
 */
function withPendingKind(state: PetState, input: PendingOpenedEvent, now: number): PetState {
  if (state.bubble === null || !acceptsEvents(state, now)) return state;
  const index = state.pendingBurst.findIndex((event) => event.kind === 'blocked' && event.ptyId === input.ptyId);
  const current = state.pendingBurst[index];
  if (current === undefined || current.blockedKind === input.kind) return state;
  const burst = state.pendingBurst.map((event, at) => (at === index ? { ...event, blockedKind: input.kind } : event));
  return { ...state, pendingBurst: burst, bubble: { ...state.bubble, ...composeBubble(burst) } };
}

/**
 * The account in use changed (US4, FR-014): a bubble `Conta → <rótulo>` with the mirror pose and the Donel as the
 * target. It replaces whatever bubble is up, with a new id and a fresh 6 s, and never joins one (FR-017): the burst
 * behind it is empty, so `acceptsEvents` refuses everything that arrives next and a session event replaces it
 * instead of folding in. The same gate as the session bubbles applies: silenced, or with an app on the whole
 * screen, nothing is born.
 */
function withAccountSwitched(state: PetState, input: AccountSwitchedEvent, now: number): PetState {
  if (!bubblesAllowed(state, now)) return state;
  const id = state.lastBubbleId + 1;
  return { ...state, lastBubbleId: id, pendingBurst: [], bubble: { id, ...accountBubbleFace(input.label), until: now + PET_BUBBLE_MS } };
}

/**
 * The sweep the owner asked for ended (016-jobu-faxina): a bubble with its result, born like the account one (new id, fresh
 * 6 s, replaces whatever is up, nothing joins it). It is NOT held back by "Silenciar por 1 hora": silence calms what the
 * Jobu says on his own, and this is the answer to a request. An app on the whole screen still holds it back, because
 * the Jobu is hidden then.
 */
function withSweepFinished(state: PetState, input: SweepFinishedEvent, now: number): PetState {
  if (state.fullscreen) return state;
  const id = state.lastBubbleId + 1;
  return { ...state, lastBubbleId: id, pendingBurst: [], bubble: { id, ...sweepBubbleFace(input.summary), until: now + PET_BUBBLE_MS } };
}

/** "Silenciar por 1 hora" calms the bubbles, the one in view included (FR-027); "Retomar avisos" lifts it. The face and the badge never stop. */
function withSilence(state: PetState, input: SilenceEvent, now: number): PetState {
  const next: PetState = { ...state, silencedUntil: input.until };
  return input.until !== null && now < input.until ? withoutBubble(next) : next;
}

/** An app took the whole screen: the Jobu hides, so no bubble stays waiting for him (Q9). */
function withFullscreen(state: PetState, input: FullscreenEvent): PetState {
  const next: PetState = { ...state, fullscreen: input.active };
  return input.active ? withoutBubble(next) : next;
}

/** An event of the burst no longer asks for anything: its session is gone, or stopped waiting, or the owner saw it. An `ended` never goes stale: its session is gone by definition. */
function isStale(state: PetState, event: BubbleEvent): boolean {
  if (event.kind === 'ended') return false;
  const session = state.sessions.get(event.ptyId);
  return session === undefined || session.waitingSince === null || session.seen;
}

/**
 * The bubble goes when its time is up, and before that when it stops making sense (Q9): every session
 * behind it was seen by the owner (he opened its tab), closed, or went back to work. An aggregate
 * stays while any of its sessions still asks.
 */
function pruneBubble(state: PetState, now: number): PetState {
  const { bubble } = state;
  if (bubble === null) return state;
  if (now >= bubble.until) return withoutBubble(state);
  if (state.pendingBurst.length > 0 && state.pendingBurst.every((event) => isStale(state, event))) return withoutBubble(state);
  return state;
}

// ---------------------------------------------------------------------------
// Time: the laugh, the serene period and the waffle
// ---------------------------------------------------------------------------

function settleTimers(state: PetState, now: number): PetState {
  let { laughUntil, sereneSince, waffleShown, waffleUntil } = state;

  if (laughUntil !== null && now >= laughUntil) laughUntil = null;
  if (waffleUntil !== null && now >= waffleUntil) waffleUntil = null;

  if (baseState(state, now) !== 'serene') {
    // Leaving serenity (FR-013: "seguidos") ends the period: the next one starts with a clean slate.
    sereneSince = null;
    waffleShown = false;
    waffleUntil = null;
  } else {
    sereneSince ??= now;
    if (!waffleShown && now - sereneSince >= PET_WAFFLE_AFTER_MS) {
      waffleShown = true;
      waffleUntil = now + PET_WAFFLE_MS;
    }
  }

  if (laughUntil === state.laughUntil && sereneSince === state.sereneSince && waffleShown === state.waffleShown && waffleUntil === state.waffleUntil) return state;
  return { ...state, laughUntil, sereneSince, waffleShown, waffleUntil };
}

function resumed(state: PetState): PetState {
  // The full-screen watcher starts again with the pet and says the truth, so what it said before is forgotten.
  return { ...state, bubble: null, pendingBurst: [], fullscreen: false, laughUntil: null, sereneSince: null, waffleShown: false, waffleUntil: null };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Applies one input at the instant `now`. Never mutates `state`; returns the same object when nothing
 * changed. After every input, whatever the owner is looking at counts as seen, the laugh is decided, the
 * bubble that expired or stopped making sense goes, and the clock-driven parts (laugh, serene period,
 * waffle) catch up.
 */
export function reducePet(state: PetState, input: PetInput, now: number): PetState {
  const waitingBefore = waitingCount(state);

  let next: PetState;
  switch (input.type) {
    case 'sessions':
      next = withSessions(state, input.sessions, now);
      break;
    case 'focus':
      next = { ...state, focus: input.focus };
      break;
    case 'resume':
      next = resumed(state);
      break;
    case 'tick':
      next = state;
      break;
    case 'sessionExited':
      next = withSessionExited(state, input, now);
      break;
    case 'pendingOpened':
      next = withPendingKind(state, input, now);
      break;
    case 'silence':
      next = withSilence(state, input, now);
      break;
    case 'fullscreen':
      next = withFullscreen(state, input);
      break;
    case 'bubbleDismissed':
      next = withoutBubble(state);
      break;
    case 'accountSwitched':
      next = withAccountSwitched(state, input, now);
      break;
    case 'sweepFinished':
      next = withSweepFinished(state, input, now);
      break;
    default:
      return assertNever(input);
  }

  const { state: seen, flipped } = markSeen(next);
  let settled = seen;

  // FR-012 / R16: the Jobu laughs when the owner empties the queue by VISITING its last session. A tab
  // closed, a session that went back to work or that ended also lower the count, but nobody laughs
  // at those: only a visit (a wait that turned `seen` in this very input) counts.
  if (waitingBefore > 0 && flipped > 0 && waitingCount(settled) === 0) settled = { ...settled, laughUntil: now + PET_LAUGH_MS };

  return settleTimers(pruneBubble(settled, now), now);
}

export function assertNever(value: never): never {
  throw new Error(`reducePet: input não tratado ${JSON.stringify(value)}`);
}
