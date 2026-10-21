// T023 (015-jobu-pet, US1) - the reducer of the pet core: sessions, focus and the clock turn into what
// the owner should see. Pure and clocked by the test, so every rule of specs/015-jobu-pet/data-model.md
// that belongs to User Story 1 is checked here without a window, a timer or a semaphore.
//
// The pose is read through `toPetView` (the same function the screen uses), so "the pose priority, line
// by line" is tested where it is decided. Balloons are not part of this story: `state.bubble` is only
// ever set by hand here, to prove its place at the top of the priority table.
import { describe, expect, it } from 'vitest';
import {
  PET_LAUGH_MS,
  PET_VERY_IMPATIENT_MS,
  PET_WAFFLE_AFTER_MS,
  PET_WAFFLE_MS,
  createPetState,
  reducePet,
  toPetSemaphore,
  waitingCount,
} from '../src/shared/pet/petState';
import { toPetView } from '../src/shared/pet/petView';
import type { FocusSignal, PetSemaphore, PetState, PetUi, PoseName, TrackedSession, WatchedSession } from '../src/shared/pet/types';

const SEC = 1000;
const MIN = 60 * SEC;
const UI: PetUi = { size: 140, docked: true, align: 'right' };

/**
 * A tiny world around the reducer: the tabs the renderer reports, the focus of the Donel window and a
 * clock. Every method feeds ONE input and keeps the resulting state, like the service does.
 */
class Pet {
  state: PetState = createPetState();
  now = 1_000_000;
  private readonly tabs = new Map<string, WatchedSession>();
  private focus: FocusSignal = { activePtyId: null, donelFocused: false };

  /** A tab appears (or its signal changes). */
  put(ptyId: string, semaphore: PetSemaphore = 'idle', over: Partial<WatchedSession> = {}): this {
    this.tabs.set(ptyId, { ptyId, name: ptyId, semaphore, blockedKind: null, ...over });
    return this.sessions();
  }

  /** The tab is closed: it is simply not in the list anymore. */
  close(ptyId: string): this {
    this.tabs.delete(ptyId);
    return this.sessions();
  }

  /** The owner looks (or stops looking) at a tab: active tab + the Donel window focused. */
  look(activePtyId: string | null, donelFocused = true): this {
    this.focus = { activePtyId, donelFocused };
    this.state = reducePet(this.state, { type: 'focus', focus: this.focus }, this.now);
    return this;
  }

  advance(ms: number): this {
    this.now += ms;
    this.state = reducePet(this.state, { type: 'tick' }, this.now);
    return this;
  }

  resume(): this {
    this.state = reducePet(this.state, { type: 'resume' }, this.now);
    return this;
  }

  get view() {
    return toPetView(this.state, this.now, UI);
  }

  get pose(): PoseName {
    return this.view.pose;
  }

  get badge(): string | null {
    return this.view.badge;
  }

  tracked(ptyId: string): TrackedSession {
    const session = this.state.sessions.get(ptyId);
    if (session === undefined) throw new Error(`no tracked session ${ptyId}`);
    return session;
  }

  private sessions(): this {
    this.state = reducePet(this.state, { type: 'sessions', sessions: [...this.tabs.values()] }, this.now);
    return this;
  }
}

/** `n` sessions waiting for the owner, who is looking elsewhere. */
function worldWithWaiting(n: number): Pet {
  const pet = new Pet();
  for (let i = 1; i <= n; i += 1) pet.put(`s${i}`, 'working');
  for (let i = 1; i <= n; i += 1) pet.put(`s${i}`, 'waiting');
  return pet;
}

describe('toPetSemaphore: what the semaphore says becomes what the core reads (R2)', () => {
  it('no update at all is idle', () => {
    expect(toPetSemaphore(undefined)).toBe('idle');
  });

  it('error reaches the core as done', () => {
    expect(toPetSemaphore('error')).toBe('done');
  });

  it('the four states of the machine pass through', () => {
    expect(toPetSemaphore('working')).toBe('working');
    expect(toPetSemaphore('waiting')).toBe('waiting');
    expect(toPetSemaphore('permission')).toBe('permission');
    expect(toPetSemaphore('done')).toBe('done');
  });
});

describe('a session with no update yet is idle (R2): open and quiet, never "working"', () => {
  it('is alive but neither working nor waiting', () => {
    const pet = new Pet().put('a');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'idle', waitingSince: null, seen: false });
    expect(waitingCount(pet.state)).toBe(0);
    expect(pet.pose).toBe('incense');
    expect(pet.badge).toBeNull();
  });

  it('only a real update promotes it to working', () => {
    const pet = new Pet().put('a');
    expect(pet.pose).toBe('incense');
    pet.put('a', 'working');
    expect(pet.pose).toBe('reading');
  });

  it('an error counts as done: the session is no longer alive', () => {
    const pet = new Pet().put('a', toPetSemaphore('error'));
    expect(pet.tracked('a').semaphore).toBe('done');
    expect(pet.pose).toBe('sleeping');
  });
});

describe('entering waiting or permission', () => {
  it('waiting is dated with the clock and counts when the owner is elsewhere', () => {
    const pet = new Pet().put('a', 'working');
    pet.advance(5 * SEC).put('a', 'waiting');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'waiting', waitingSince: pet.now, seen: false });
    expect(waitingCount(pet.state)).toBe(1);
  });

  it('permission counts the same way', () => {
    const pet = new Pet().put('a', 'working');
    pet.advance(SEC).put('a', 'permission');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'permission', waitingSince: pet.now, seen: false });
    expect(waitingCount(pet.state)).toBe(1);
  });

  it('waiting then permission keeps the original date: the session was already counted (R3)', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting');
    const since = pet.tracked('a').waitingSince;
    pet.advance(3 * MIN).put('a', 'permission');
    expect(pet.tracked('a').waitingSince).toBe(since);
    expect(waitingCount(pet.state)).toBe(1);
    expect(pet.view.waiting[0]?.waitingLabel).toBe('há 3 min');
  });

  it('permission then waiting keeps it too', () => {
    const pet = new Pet().put('a', 'working').put('a', 'permission');
    const since = pet.tracked('a').waitingSince;
    pet.advance(2 * MIN).put('a', 'waiting');
    expect(pet.tracked('a').waitingSince).toBe(since);
  });

  it('a session met for the first time already waiting is dated at that moment (the pet was turned on late)', () => {
    const pet = new Pet().advance(MIN).put('a', 'waiting');
    expect(pet.tracked('a')).toMatchObject({ waitingSince: pet.now, seen: false });
    expect(pet.badge).toBe('1');
  });

  it('the same signal twice changes nothing: dedupe by state', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting');
    const before = pet.tracked('a');
    pet.advance(40 * SEC).put('a', 'waiting');
    expect(pet.tracked('a')).toEqual(before);
  });

  it('a repeated signal does not un-see a session the owner already opened', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').look('a');
    expect(pet.tracked('a').seen).toBe(true);
    pet.put('a', 'waiting');
    expect(pet.tracked('a').seen).toBe(true);
    expect(pet.badge).toBeNull();
  });

  it('a new name is taken without touching the wait', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting');
    const since = pet.tracked('a').waitingSince;
    pet.advance(MIN).put('a', 'waiting', { name: 'atlas' });
    expect(pet.tracked('a')).toMatchObject({ name: 'atlas', waitingSince: since, seen: false });
  });

  it('working clears the wait', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').put('a', 'working');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'working', waitingSince: null, seen: false });
    expect(waitingCount(pet.state)).toBe(0);
  });

  it('done is not waiting, whatever it was before', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').put('a', 'done');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'done', waitingSince: null });
    expect(waitingCount(pet.state)).toBe(0);
  });
});

describe('seen (FR-009): the active tab with the Donel window focused', () => {
  it('a session that finishes while the owner is on its tab is born seen: no badge, no impatience', () => {
    const pet = new Pet().put('a', 'working').look('a');
    pet.put('a', 'waiting');
    expect(pet.tracked('a')).toMatchObject({ waitingSince: pet.now, seen: true });
    expect(waitingCount(pet.state)).toBe(0);
    expect(pet.badge).toBeNull();
    expect(pet.pose).toBe('incense');
  });

  it('born seen is not a visit: nobody laughs', () => {
    const pet = new Pet().put('a', 'working').look('a');
    pet.put('a', 'waiting').advance(SEC);
    expect(pet.pose).not.toBe('laughing');
    expect(pet.state.laughUntil).toBeNull();
  });

  it.each([
    ['the tab is active but the Donel window is not focused', { active: 'a', focused: false }],
    ['the Donel window is focused but another tab is active', { active: 'b', focused: true }],
    ['the Donel window is focused with no session tab in front', { active: null, focused: true }],
  ])('is not seen when %s', (_label, { active, focused }) => {
    const pet = new Pet().put('a', 'working').put('b').look(active, focused);
    pet.put('a', 'waiting');
    expect(pet.tracked('a').seen).toBe(false);
    expect(pet.badge).toBe('1');
    expect(pet.pose).toBe('impatient');
  });

  it('becomes seen when the owner opens the tab: the active tab changes with the Donel focused', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting');
    expect(pet.badge).toBe('1');
    pet.look('a');
    expect(pet.tracked('a').seen).toBe(true);
    expect(pet.badge).toBeNull();
  });

  it('becomes seen when the Donel window gets the focus with the tab already in front (the owner comes back to it)', () => {
    const pet = new Pet().put('a', 'working').look('a', false).put('a', 'waiting');
    expect(pet.badge).toBe('1');
    pet.look('a', true);
    expect(pet.badge).toBeNull();
  });

  it('stays seen after the owner looks away', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').look('a');
    pet.look('b').look('b', false);
    expect(pet.tracked('a').seen).toBe(true);
    expect(pet.badge).toBeNull();
  });

  it('looking at a tab that is not waiting changes nothing', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting');
    pet.look('b').look('b', false).look('b', true);
    expect(pet.tracked('a').seen).toBe(false);
    expect(pet.badge).toBe('1');
  });

  it('only the tab looked at is seen: the others keep counting', () => {
    const pet = worldWithWaiting(3);
    pet.look('s2');
    expect(pet.tracked('s1').seen).toBe(false);
    expect(pet.tracked('s2').seen).toBe(true);
    expect(pet.tracked('s3').seen).toBe(false);
    expect(pet.badge).toBe('2');
  });

  it('counts again after working: a new turn that ends while the owner is away is a new wait', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').look('a');
    expect(pet.badge).toBeNull();
    pet.look('b').put('a', 'working');
    expect(pet.tracked('a')).toMatchObject({ waitingSince: null, seen: false });
    pet.advance(MIN).put('a', 'waiting');
    expect(pet.tracked('a')).toMatchObject({ waitingSince: pet.now, seen: false });
    expect(pet.badge).toBe('1');
  });

  it('a new turn that ends in front of the owner is born seen again', () => {
    const pet = new Pet().put('a', 'working').look('a').put('a', 'waiting').put('a', 'working');
    pet.put('a', 'waiting');
    expect(pet.tracked('a').seen).toBe(true);
    expect(pet.badge).toBeNull();
  });
});

describe('a closed tab leaves without a trace', () => {
  it('drops out of the count, with no laugh (closing is not visiting, R16)', () => {
    const pet = new Pet().put('a', 'working').put('b').put('a', 'waiting');
    expect(pet.badge).toBe('1');
    pet.close('a');
    expect(pet.state.sessions.has('a')).toBe(false);
    expect(pet.badge).toBeNull();
    expect(pet.state.laughUntil).toBeNull();
    expect(pet.pose).toBe('incense');
  });

  it('closing one of two waiting sessions lowers the badge and keeps the face impatient', () => {
    const pet = worldWithWaiting(2);
    pet.close('s1');
    expect(pet.badge).toBe('1');
    expect(pet.pose).toBe('impatient');
  });

  it('closing the last tab leaves the Jobu asleep', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').close('a');
    expect(pet.pose).toBe('sleeping');
    expect(pet.state.sessions.size).toBe(0);
  });

  it('a tab that comes back is a new session: it does not inherit the old wait', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').advance(5 * MIN).close('a');
    pet.put('a', 'idle');
    expect(pet.tracked('a')).toMatchObject({ semaphore: 'idle', waitingSince: null });
  });
});

describe('the badge (FR-011)', () => {
  it('is null with nobody waiting', () => {
    expect(new Pet().put('a', 'working').badge).toBeNull();
  });

  it.each([1, 2, 5, 9])('shows %i as a number', (n) => {
    expect(worldWithWaiting(n).badge).toBe(String(n));
  });

  it.each([10, 11, 25])('shows 9+ for %i', (n) => {
    expect(worldWithWaiting(n).badge).toBe('9+');
  });

  it('goes back down as the sessions are seen, and 9+ becomes a number again', () => {
    const pet = worldWithWaiting(10);
    expect(pet.badge).toBe('9+');
    pet.look('s1');
    expect(pet.badge).toBe('9');
    pet.look('s2').look('s3');
    expect(pet.badge).toBe('7');
  });
});

describe('the pose priority (FR-010), line by line', () => {
  const aBubble = (now: number, lasts: number) => ({ id: 1, text: 'atlas · terminou', pose: 'calling' as const, target: { kind: 'donel' as const }, until: now + lasts });

  it('1. the pose of the bubble wins over everything while there is a bubble', () => {
    const pet = worldWithWaiting(1).advance(11 * MIN);
    expect(pet.pose).toBe('very-impatient');
    pet.state = { ...pet.state, laughUntil: pet.now + SEC, bubble: aBubble(pet.now, 6 * SEC) };
    expect(pet.pose).toBe('calling');
  });

  it('1. ...and only while it lasts: an expired bubble no longer decides', () => {
    const pet = worldWithWaiting(1);
    pet.state = { ...pet.state, bubble: aBubble(pet.now, 6 * SEC) };
    pet.advance(6 * SEC);
    expect(pet.pose).toBe('impatient');
  });

  it('2. laughing wins over a waiting session while the laugh lasts', () => {
    const pet = worldWithWaiting(1).advance(11 * MIN);
    pet.state = { ...pet.state, laughUntil: pet.now + SEC };
    expect(pet.pose).toBe('laughing');
  });

  it('3. very-impatient: the oldest waiting session has waited more than 10 minutes', () => {
    expect(worldWithWaiting(1).advance(10 * MIN + SEC).pose).toBe('very-impatient');
  });

  it('4. impatient: some session is waiting', () => {
    expect(worldWithWaiting(1).pose).toBe('impatient');
  });

  it('4. impatient beats reading: a session working does not calm down one that waits', () => {
    const pet = new Pet().put('a', 'working').put('b', 'working').put('b', 'waiting');
    expect(pet.pose).toBe('impatient');
  });

  it('5. reading: some session is working and nobody waits', () => {
    expect(new Pet().put('a', 'working').put('b').pose).toBe('reading');
  });

  it('5. reading beats the serene faces: a working session among quiet ones and one already seen', () => {
    const pet = new Pet().put('a').put('b', 'working').put('c', 'working').look('c').put('c', 'waiting');
    expect(pet.tracked('c').seen).toBe(true);
    expect(pet.pose).toBe('reading');
  });

  it('6. incense: sessions open, none working, every wait already seen', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').look('a');
    pet.advance(PET_LAUGH_MS);
    expect(pet.pose).toBe('incense');
  });

  it('6. incense: sessions open and still untouched', () => {
    expect(new Pet().put('a').put('b').pose).toBe('incense');
  });

  it('6. a session that only ended does not keep the Jobu awake', () => {
    expect(new Pet().put('a', 'done').pose).toBe('sleeping');
  });

  it('7. sleeping: no session at all', () => {
    expect(new Pet().pose).toBe('sleeping');
  });

  it('7. sleeping: every session ended', () => {
    expect(new Pet().put('a', 'done').put('b', 'done').pose).toBe('sleeping');
  });
});

describe('very-impatient at 10 minutes (D10)', () => {
  it('is impatient up to ten minutes, and very impatient only after them ("mais de 10 min")', () => {
    const pet = worldWithWaiting(1);
    expect(pet.advance(10 * MIN - SEC).pose).toBe('impatient');
    expect(pet.advance(SEC).pose).toBe('impatient');
    expect(PET_VERY_IMPATIENT_MS).toBe(10 * MIN);
    expect(pet.advance(SEC).pose).toBe('very-impatient');
  });

  it('the oldest decides: a recent wait does not calm down an old one', () => {
    const pet = new Pet().put('old', 'working').put('old', 'waiting').advance(11 * MIN);
    pet.put('new', 'working').put('new', 'waiting');
    expect(pet.pose).toBe('very-impatient');
    expect(pet.badge).toBe('2');
  });

  it('seeing the old one brings back plain impatience while the recent one still waits', () => {
    const pet = new Pet().put('old', 'working').put('old', 'waiting').advance(11 * MIN);
    pet.put('new', 'working').put('new', 'waiting').look('old');
    expect(pet.pose).toBe('impatient');
  });

  it('waiting to permission does not restart the clock: the session has been there all along (R3)', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').advance(8 * MIN).put('a', 'permission');
    expect(pet.advance(2 * MIN + SEC).pose).toBe('very-impatient');
  });
});

describe('the laugh (FR-012, R16): only when the owner visits the last waiting session', () => {
  it('opening the last waiting session makes the Jobu laugh for 2.5 s, then it goes back to the sessions', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting');
    pet.look('a');
    expect(pet.badge).toBeNull();
    expect(pet.pose).toBe('laughing');
    expect(PET_LAUGH_MS).toBe(2500);
    pet.advance(PET_LAUGH_MS - 1);
    expect(pet.pose).toBe('laughing');
    pet.advance(1);
    expect(pet.pose).toBe('incense');
  });

  it('opening one of several waiting sessions does not laugh: someone still waits', () => {
    const pet = worldWithWaiting(2);
    pet.look('s1');
    expect(pet.pose).toBe('impatient');
    expect(pet.state.laughUntil).toBeNull();
    pet.look('s2');
    expect(pet.pose).toBe('laughing');
  });

  it('closing the tab of the last waiting session does not laugh', () => {
    const pet = worldWithWaiting(1);
    pet.close('s1');
    expect(pet.state.laughUntil).toBeNull();
    expect(pet.pose).not.toBe('laughing');
  });

  it('the wait ending by itself does not laugh: the session went back to work', () => {
    const pet = worldWithWaiting(1);
    pet.put('s1', 'working');
    expect(pet.state.laughUntil).toBeNull();
    expect(pet.pose).toBe('reading');
  });

  it('the process ending does not laugh either', () => {
    const pet = worldWithWaiting(1);
    pet.put('s1', 'done');
    expect(pet.state.laughUntil).toBeNull();
    expect(pet.pose).toBe('sleeping');
  });

  it('laughs again at the next visit that empties the queue', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').look('a');
    expect(pet.pose).toBe('laughing');
    pet.advance(PET_LAUGH_MS).look('b').put('a', 'working').put('a', 'waiting').look('a');
    expect(pet.pose).toBe('laughing');
  });

  it('a laugh that is over does not come back with the next ticks', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').look('a');
    pet.advance(PET_LAUGH_MS);
    for (let i = 0; i < 5; i += 1) pet.advance(SEC);
    expect(pet.pose).toBe('incense');
    expect(pet.state.laughUntil).toBeNull();
  });
});

describe('the waffle (FR-013): 20 serene minutes, 8 s, once per serene period', () => {
  /** One session, opened and quiet: the Jobu is serene from `pet.now` on. */
  const serene = (): Pet => new Pet().put('a');

  it('shows up after 20 minutes of serenity and goes away after 8 seconds', () => {
    expect(PET_WAFFLE_AFTER_MS).toBe(20 * MIN);
    expect(PET_WAFFLE_MS).toBe(8 * SEC);
    const pet = serene();
    expect(pet.pose).toBe('incense');
    pet.advance(20 * MIN - SEC);
    expect(pet.pose).toBe('incense');
    pet.advance(SEC);
    expect(pet.pose).toBe('waffle');
    pet.advance(PET_WAFFLE_MS - SEC);
    expect(pet.pose).toBe('waffle');
    pet.advance(SEC);
    expect(pet.pose).toBe('incense');
  });

  it('comes only once per period: 40 more serene minutes bring nothing', () => {
    const pet = serene().advance(20 * MIN).advance(PET_WAFFLE_MS);
    expect(pet.pose).toBe('incense');
    for (let i = 0; i < 40; i += 1) {
      pet.advance(MIN);
      expect(pet.pose).toBe('incense');
    }
  });

  it('a new serene period can have its own waffle', () => {
    const pet = serene().advance(20 * MIN).advance(PET_WAFFLE_MS);
    pet.put('a', 'working').advance(MIN).put('a', 'waiting').look('a').advance(PET_LAUGH_MS);
    expect(pet.pose).toBe('incense');
    pet.advance(20 * MIN - PET_LAUGH_MS - SEC);
    expect(pet.pose).toBe('incense');
    pet.advance(SEC);
    expect(pet.pose).toBe('waffle');
  });

  it('leaving serenity starts the count again', () => {
    const pet = serene().advance(15 * MIN);
    pet.put('a', 'working').advance(MIN).put('a', 'idle');
    pet.advance(19 * MIN);
    expect(pet.pose).toBe('incense');
    pet.advance(MIN);
    expect(pet.pose).toBe('waffle');
  });

  it('is only for the serene face: a session that starts working interrupts it at once', () => {
    const pet = serene().advance(20 * MIN);
    expect(pet.pose).toBe('waffle');
    pet.put('a', 'working');
    expect(pet.pose).toBe('reading');
    pet.put('a', 'idle');
    expect(pet.pose).toBe('incense');
  });

  it('is only for the serene face: waiting sessions bring the impatient face, not the waffle', () => {
    const pet = new Pet().put('a', 'working').put('a', 'waiting').look('a').advance(20 * MIN);
    // seen and quiet for 20 minutes: serene, so the waffle is allowed
    expect(pet.pose).toBe('waffle');
    pet.put('b', 'working').put('b', 'waiting');
    expect(pet.pose).toBe('impatient');
  });

  it('an unseen wait is not serenity: 20 impatient minutes do not bring the waffle', () => {
    const pet = worldWithWaiting(1).advance(20 * MIN);
    expect(pet.pose).toBe('very-impatient');
  });

  it('never for a sleeping Jobu: no session, no waffle', () => {
    const pet = new Pet().advance(60 * MIN);
    expect(pet.pose).toBe('sleeping');
  });

  it('the serene period counts from the moment the last wait was seen, not from the laugh', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').advance(5 * MIN).look('a');
    pet.advance(20 * MIN - SEC);
    expect(pet.pose).toBe('incense');
    pet.advance(SEC);
    expect(pet.pose).toBe('waffle');
  });
});

describe('resume: the pet window opened again after a while without a clock', () => {
  it('does not start a waffle because of the time the pet was off: the serene period restarts now', () => {
    const pet = new Pet().put('a');
    pet.now += 3 * 60 * MIN; // hours passed with no tick (the pet was turned off)
    pet.resume().advance(SEC);
    expect(pet.pose).toBe('incense');
    pet.advance(20 * MIN - SEC);
    expect(pet.pose).toBe('waffle');
  });

  it('drops a laugh that was running when the window closed', () => {
    const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').look('a');
    expect(pet.pose).toBe('laughing');
    pet.resume();
    expect(pet.pose).toBe('incense');
  });

  it('keeps what the owner still owes: the waiting sessions are still counted, with their real age', () => {
    const pet = worldWithWaiting(1).advance(4 * MIN);
    pet.resume();
    expect(pet.badge).toBe('1');
    expect(pet.view.waiting[0]?.waitingLabel).toBe('há 4 min');
  });
});

describe('purity', () => {
  it('never mutates the state it receives', () => {
    const pet = new Pet().put('a', 'working');
    const frozen = pet.state;
    const snapshot = JSON.stringify({ ...frozen, sessions: [...frozen.sessions] });
    pet.put('a', 'waiting').look('a').advance(MIN).put('b').close('a').resume();
    expect(JSON.stringify({ ...frozen, sessions: [...frozen.sessions] })).toBe(snapshot);
  });

  it('the same inputs always give the same state', () => {
    const run = (): string => {
      const pet = new Pet().put('a', 'working').put('b').look('b').put('a', 'waiting').advance(11 * MIN).look('a');
      return JSON.stringify({ ...pet.state, sessions: [...pet.state.sessions] });
    };
    expect(run()).toBe(run());
  });

  it('starts empty: asleep, nothing waiting, no bubble', () => {
    const state = createPetState();
    expect(state.sessions.size).toBe(0);
    expect(state.bubble).toBeNull();
    expect(state.pendingBurst).toEqual([]);
    expect(state.laughUntil).toBeNull();
    expect(state.waffleUntil).toBeNull();
    expect(state.silencedUntil).toBeNull();
    expect(state.focus).toEqual({ activePtyId: null, donelFocused: false });
  });
});
