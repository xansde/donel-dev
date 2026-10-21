// T024 (015-jobu-pet, US1) - the view the pet window draws: the projection of the core state at a
// given instant. What matters here is the list of who waits (oldest first, with a readable age), the
// exact shape that crosses to the screen, and that nothing but names and kinds of events travels
// (FR-018). The reducer itself is tested in pet-state.test.ts.
import { describe, expect, it } from 'vitest';
import { createPetState, reducePet } from '../src/shared/pet/petState';
import { badgeOf, toPetView, waitingLabel } from '../src/shared/pet/petView';
import type { PetSemaphore, PetState, PetUi, WatchedSession } from '../src/shared/pet/types';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const T0 = 5_000_000;
const UI: PetUi = { size: 140, docked: true, align: 'right' };

const watched = (ptyId: string, semaphore: PetSemaphore, name = ptyId): WatchedSession => ({ ptyId, name, semaphore, blockedKind: null });

/** Feeds the sessions one snapshot at a time, moving the clock by `at`. */
function build(steps: readonly { at: number; sessions: readonly WatchedSession[]; look?: string | null }[]): PetState {
  let state = createPetState();
  for (const step of steps) {
    state = reducePet(state, { type: 'sessions', sessions: step.sessions }, T0 + step.at);
    if (step.look !== undefined) state = reducePet(state, { type: 'focus', focus: { activePtyId: step.look, donelFocused: step.look !== null } }, T0 + step.at);
  }
  return state;
}

describe('the shape of the view', () => {
  it('has exactly the fields the screen reads, nothing else', () => {
    const view = toPetView(createPetState(), T0, UI);
    expect(Object.keys(view).sort()).toEqual(['align', 'badge', 'bubble', 'docked', 'pose', 'silenced', 'size', 'waiting']);
  });

  it('is an empty, asleep view when there is nothing to watch', () => {
    expect(toPetView(createPetState(), T0, UI)).toEqual({
      pose: 'sleeping',
      badge: null,
      bubble: null,
      waiting: [],
      docked: true,
      align: 'right',
      silenced: false,
      size: 140,
    });
  });

  it('survives the trip to the window: it is plain JSON', () => {
    const state = build([
      { at: 0, sessions: [watched('a', 'working'), watched('b', 'idle')] },
      { at: MIN, sessions: [watched('a', 'waiting', 'atlas'), watched('b', 'idle')] },
    ]);
    const view = toPetView(state, T0 + 2 * MIN, UI);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('copies size, docked and align from the placement as they are', () => {
    const state = createPetState();
    expect(toPetView(state, T0, { size: 260, docked: false, align: 'left' })).toMatchObject({ size: 260, docked: false, align: 'left' });
    expect(toPetView(state, T0, { size: 80, docked: true, align: 'center' })).toMatchObject({ size: 80, docked: true, align: 'center' });
  });

  it('is a pure function: the same state and instant give the same view, and the state is untouched', () => {
    const state = build([{ at: 0, sessions: [watched('a', 'working')] }, { at: SEC, sessions: [watched('a', 'waiting')] }]);
    const before = JSON.stringify({ ...state, sessions: [...state.sessions] });
    const first = toPetView(state, T0 + 5 * MIN, UI);
    const second = toPetView(state, T0 + 5 * MIN, UI);
    expect(second).toEqual(first);
    expect(JSON.stringify({ ...state, sessions: [...state.sessions] })).toBe(before);
  });
});

describe('waiting[]: who waits for the owner, the oldest first', () => {
  const threeWaiting = (): PetState =>
    build([
      { at: 0, sessions: [watched('late', 'working', 'vega'), watched('mid', 'working', 'beacon'), watched('early', 'working', 'atlas')] },
      { at: 1 * MIN, sessions: [watched('late', 'working', 'vega'), watched('mid', 'working', 'beacon'), watched('early', 'waiting', 'atlas')] },
      { at: 4 * MIN, sessions: [watched('late', 'working', 'vega'), watched('mid', 'waiting', 'beacon'), watched('early', 'waiting', 'atlas')] },
      { at: 9 * MIN, sessions: [watched('late', 'waiting', 'vega'), watched('mid', 'waiting', 'beacon'), watched('early', 'waiting', 'atlas')] },
    ]);

  it('lists them by how long they have waited, longest first, whatever order the tabs are in', () => {
    const view = toPetView(threeWaiting(), T0 + 10 * MIN, UI);
    expect(view.waiting.map((entry) => entry.name)).toEqual(['atlas', 'beacon', 'vega']);
    expect(view.waiting.map((entry) => entry.ptyId)).toEqual(['early', 'mid', 'late']);
  });

  it('carries a readable age for each one, from the clock of the view', () => {
    const view = toPetView(threeWaiting(), T0 + 10 * MIN, UI);
    expect(view.waiting.map((entry) => entry.waitingLabel)).toEqual(['há 9 min', 'há 6 min', 'há 1 min']);
    const later = toPetView(threeWaiting(), T0 + 10 * MIN + 30 * SEC, UI);
    expect(later.waiting.map((entry) => entry.waitingLabel)).toEqual(['há 9 min', 'há 6 min', 'há 1 min']);
    const muchLater = toPetView(threeWaiting(), T0 + 2 * HOUR + 5 * MIN, UI);
    expect(muchLater.waiting.map((entry) => entry.waitingLabel)).toEqual(['há 2 h', 'há 2 h', 'há 1 h']);
  });

  it('keeps the order of arrival when two sessions started waiting at the same instant', () => {
    const state = build([
      { at: 0, sessions: [watched('x', 'working', 'first'), watched('y', 'working', 'second')] },
      { at: MIN, sessions: [watched('x', 'waiting', 'first'), watched('y', 'waiting', 'second')] },
    ]);
    expect(toPetView(state, T0 + 2 * MIN, UI).waiting.map((entry) => entry.name)).toEqual(['first', 'second']);
  });

  it('leaves out the ones the owner already saw, the working ones, the quiet ones and the ones that ended', () => {
    const state = build([
      { at: 0, sessions: [watched('seen', 'working'), watched('busy', 'working'), watched('quiet', 'idle'), watched('gone', 'working'), watched('waits', 'working')] },
      {
        at: MIN,
        sessions: [watched('seen', 'waiting'), watched('busy', 'working'), watched('quiet', 'idle'), watched('gone', 'waiting'), watched('waits', 'permission')],
      },
      { at: 2 * MIN, sessions: [watched('seen', 'waiting'), watched('busy', 'working'), watched('quiet', 'idle'), watched('gone', 'done'), watched('waits', 'permission')], look: 'seen' },
    ]);
    const view = toPetView(state, T0 + 3 * MIN, UI);
    expect(view.waiting.map((entry) => entry.ptyId)).toEqual(['waits']);
    expect(view.badge).toBe('1');
  });

  it('shows the tab name as it is: the screen shortens it, the view does not', () => {
    const name = 'revisão do plano de migração das parcelas do CUB';
    const state = build([{ at: 0, sessions: [watched('a', 'working', name)] }, { at: SEC, sessions: [watched('a', 'waiting', name)] }]);
    expect(toPetView(state, T0 + MIN, UI).waiting[0]?.name).toBe(name);
  });

  it('follows a rename while the session waits', () => {
    const state = build([
      { at: 0, sessions: [watched('a', 'working', 'novo')] },
      { at: SEC, sessions: [watched('a', 'waiting', 'novo')] },
      { at: MIN, sessions: [watched('a', 'waiting', 'spotsys')] },
    ]);
    expect(toPetView(state, T0 + 2 * MIN, UI).waiting.map((entry) => entry.name)).toEqual(['spotsys']);
  });

  it('every entry is only a session id, a name and an age: nothing of the conversation (FR-018)', () => {
    const view = toPetView(threeWaiting(), T0 + 10 * MIN, UI);
    for (const entry of view.waiting) expect(Object.keys(entry).sort()).toEqual(['name', 'ptyId', 'waitingLabel']);
  });

  it('the badge and the list always agree', () => {
    const view = toPetView(threeWaiting(), T0 + 10 * MIN, UI);
    expect(view.badge).toBe(String(view.waiting.length));
  });

  it('lists all of them even where the badge says 9+', () => {
    const working = Array.from({ length: 12 }, (_, i) => watched(`s${i}`, 'working'));
    const waiting = Array.from({ length: 12 }, (_, i) => watched(`s${i}`, 'waiting'));
    const view = toPetView(build([{ at: 0, sessions: working }, { at: SEC, sessions: waiting }]), T0 + MIN, UI);
    expect(view.badge).toBe('9+');
    expect(view.waiting).toHaveLength(12);
  });
});

describe('waitingLabel: "agora", "há 1 min", "há 12 min", "há 2 h"', () => {
  it.each([
    [0, 'agora'],
    [1, 'agora'],
    [30 * SEC, 'agora'],
    [MIN - 1, 'agora'],
    [MIN, 'há 1 min'],
    [MIN + 59 * SEC, 'há 1 min'],
    [2 * MIN, 'há 2 min'],
    [12 * MIN, 'há 12 min'],
    [59 * MIN, 'há 59 min'],
    [59 * MIN + 59 * SEC, 'há 59 min'],
    [HOUR, 'há 1 h'],
    [HOUR + 59 * MIN, 'há 1 h'],
    [2 * HOUR, 'há 2 h'],
    [2 * HOUR + 5 * MIN, 'há 2 h'],
    [26 * HOUR, 'há 26 h'],
  ])('%i ms -> %s', (elapsed, label) => {
    expect(waitingLabel(elapsed)).toBe(label);
  });

  it('a clock that went backwards still says "agora"', () => {
    expect(waitingLabel(-5 * MIN)).toBe('agora');
  });
});

describe('badgeOf (FR-011)', () => {
  it('is null for zero, the number up to 9 and 9+ above', () => {
    expect(badgeOf(0)).toBeNull();
    expect(badgeOf(1)).toBe('1');
    expect(badgeOf(9)).toBe('9');
    expect(badgeOf(10)).toBe('9+');
    expect(badgeOf(100)).toBe('9+');
  });
});

describe('silenced', () => {
  const silenced = (until: number | null): PetState => ({ ...createPetState(), silencedUntil: until });

  it('is false when nothing was asked', () => {
    expect(toPetView(silenced(null), T0, UI).silenced).toBe(false);
  });

  it('is true until the end of the silence, and false from that instant on', () => {
    const state = silenced(T0 + HOUR);
    expect(toPetView(state, T0, UI).silenced).toBe(true);
    expect(toPetView(state, T0 + HOUR - 1, UI).silenced).toBe(true);
    expect(toPetView(state, T0 + HOUR, UI).silenced).toBe(false);
    expect(toPetView(state, T0 + 2 * HOUR, UI).silenced).toBe(false);
  });

  it('keeps the face and the badge moving while silenced (FR-027)', () => {
    const state: PetState = {
      ...build([{ at: 0, sessions: [watched('a', 'working')] }, { at: SEC, sessions: [watched('a', 'waiting')] }]),
      silencedUntil: T0 + HOUR,
    };
    expect(toPetView(state, T0 + MIN, UI)).toMatchObject({ silenced: true, pose: 'impatient', badge: '1' });
  });
});

describe('bubble: US1 never makes one, but the view already carries it', () => {
  const bubble = { id: 3, text: 'atlas · terminou', pose: 'calling', target: { kind: 'session', ptyId: 'a' }, until: T0 + 6 * SEC } as const;

  it('is null for a state without a bubble', () => {
    expect(toPetView(createPetState(), T0, UI).bubble).toBeNull();
  });

  it('is the id, the text, the pose and the target of the live bubble, without its deadline', () => {
    const state: PetState = { ...createPetState(), bubble };
    expect(toPetView(state, T0 + SEC, UI).bubble).toEqual({ id: 3, text: 'atlas · terminou', pose: 'calling', target: { kind: 'session', ptyId: 'a' } });
  });

  it('is null once its time is up', () => {
    const state: PetState = { ...createPetState(), bubble };
    expect(toPetView(state, T0 + 6 * SEC - 1, UI).bubble).not.toBeNull();
    expect(toPetView(state, T0 + 6 * SEC, UI).bubble).toBeNull();
  });
});
