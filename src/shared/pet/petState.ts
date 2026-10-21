// T025 (015-jobu-pet, US1) - the reducer of the pet core. It takes what the main knows (the tabs and
// what the semaphore says of each, the focus of the Donel window, the 1 s clock) and keeps what the
// owner should see: who is waiting, whether the owner has seen it, the laugh, the serene period and the
// waffle. Pure: no Electron, no timer, no `Date.now()`. The clock is the `now` argument, so every rule
// of specs/015-jobu-pet/data-model.md is tested with a clock the test moves by hand.
//
// What the face and the badge are made of is derived from the state at a given instant by petView.ts.
//
// EXTENSION POINTS (US2 bubbles, US5 menu): the events of `PetEvent` other than `tick` are accepted by
// `reducePet` and still do nothing; each `case` in the switch names the task that gives it an effect.
// The transitions that will become `finished`/`blocked` events (entering `waiting`/`permission` unseen)
// are decided in `trackSession`, the only place where a wait is born.

import type { FocusSignal, PetInput, PetSemaphore, PetState, SemaphorePublicState, TrackedSession, WatchedSession } from './types';

/** D10: a session that has waited more than this makes the Jobu very impatient. */
export const PET_VERY_IMPATIENT_MS = 10 * 60_000;
/** FR-012: how long the laugh of an emptied queue lasts. */
export const PET_LAUGH_MS = 2_500;
/** FR-013: how long the Jobu stays serene before the waffle comes. */
export const PET_WAFFLE_AFTER_MS = 20 * 60_000;
/** FR-013: how long the waffle stays on screen. */
export const PET_WAFFLE_MS = 8_000;

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

/**
 * One tab, one signal. A wait is born when the session enters `waiting`/`permission` and was not in
 * one: that moment dates it and decides whether the owner is already looking at it ("born seen",
 * FR-009). A session that is already counted keeps its date and its `seen` through every later signal:
 * the same state again (dedupe), `waiting` to `permission` and back (R3). Working or done clear the
 * wait, so the next one is a new wait.
 *
 * EXTENSION POINT (US2, T031): a wait born unseen is where the `finished` (`waiting`) or `blocked`
 * (`permission`) event comes from; a session met for the first time (`previous === undefined`) never
 * gives one, because it was not seen changing.
 */
function trackSession(previous: TrackedSession | undefined, watched: WatchedSession, now: number, focus: FocusSignal): TrackedSession {
  let waitingSince: number | null = null;
  let seen = false;
  if (isWaitingSemaphore(watched.semaphore)) {
    if (previous !== undefined && previous.waitingSince !== null) {
      waitingSince = previous.waitingSince;
      seen = previous.seen;
    } else {
      waitingSince = now;
      seen = isSeenNow(focus, watched.ptyId);
    }
  }
  return { name: watched.name, semaphore: watched.semaphore, blockedKind: watched.blockedKind, waitingSince, seen };
}

/** The new list replaces the old one: whoever is not in it was closed (no event, FR-009). */
function withSessions(state: PetState, incoming: readonly WatchedSession[], now: number): PetState {
  const sessions = new Map<string, TrackedSession>();
  for (const watched of incoming) sessions.set(watched.ptyId, trackSession(state.sessions.get(watched.ptyId), watched, now, state.focus));
  return { ...state, sessions };
}

/** "A cada mudança de foco ou de sinal, toda sessão esperando e vista agora passa a `seen = true`." */
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
  return { ...state, bubble: null, pendingBurst: [], laughUntil: null, sereneSince: null, waffleShown: false, waffleUntil: null };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Applies one input at the instant `now`. Never mutates `state`; returns the same object when nothing
 * changed. After every input, whatever the owner is looking at counts as seen, the laugh is decided and
 * the clock-driven parts (laugh, serene period, waffle) catch up.
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
    // EXTENSION POINTS: these arrive with the stories that need them and change nothing until then.
    case 'accountSwitched': // US4 (T042): a bubble `Conta → <rótulo>` with the mirror pose
    case 'sessionExited': //   US2 (T031/T032): the `ended` event, when `byUser` is false
    case 'pendingOpened': //   US2 (T031/T032): refines the kind of a `blocked` event
    case 'silence': //         US5 (T047): `silencedUntil`
      next = state;
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

  return settleTimers(settled, now);
}

function assertNever(value: never): never {
  throw new Error(`reducePet: input não tratado ${JSON.stringify(value)}`);
}
