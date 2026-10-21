// T030 (015-jobu-pet, US2) - the bubble of the Jobu: what an event says (FR-015), the pose it brings
// (FR-016), how events of the same second become one bubble (FR-017), when NO bubble is born
// (FR-019, silence, full screen, a tab the owner is looking at) and when a bubble that is already up
// stops making sense (the owner opened its session, Q9). Pure and clocked by the test, like
// pet-state.test.ts: everything goes through `reducePet`, and what the screen would draw is read
// through `toPetView`.
//
// Account bubbles (`accountSwitched`) are US4 (T042): the rule "an account never joins a session
// bubble" is tested there. The opposite direction, "a bubble that is not a session bubble never
// absorbs a session event", is tested here with a hand-built bubble.
import { describe, expect, it } from 'vitest';
import {
  PET_BUBBLE_JOIN_MS,
  PET_BUBBLE_MS,
  PET_BUBBLE_NAME_MAX,
  composeBubble,
  eventPose,
  eventText,
  splitSessionBubbleText,
  truncateTabName,
} from '../src/shared/pet/bubble';
import { PET_LAUGH_MS, createPetState, reducePet } from '../src/shared/pet/petState';
import { toPetView } from '../src/shared/pet/petView';
import type {
  BlockedKind,
  Bubble,
  BubbleEvent,
  BubbleEventKind,
  FocusSignal,
  PetInput,
  PetSemaphore,
  PetState,
  PetUi,
  WatchedSession,
} from '../src/shared/pet/types';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const UI: PetUi = { size: 140, docked: true, align: 'right' };

/** A session event as the core builds it, for the pure text and composition functions. */
const ev = (kind: BubbleEventKind, name = 'atlas', over: Partial<BubbleEvent> = {}): BubbleEvent => ({
  kind,
  ptyId: `pty-${name}`,
  name,
  blockedKind: null,
  at: 0,
  ...over,
});

/**
 * A tiny world around the reducer, like the one of pet-state.test.ts: tabs, focus and a clock, plus
 * the events the service sends (exit, pending, silence, full screen). Each method feeds ONE input.
 * A tab's ptyId is `pty-<name>` so a test reads in names.
 */
class World {
  state: PetState = createPetState();
  now = 1_000_000;
  private readonly tabs = new Map<string, WatchedSession>();
  private focus: FocusSignal = { activePtyId: null, donelFocused: false };

  /** A tab appears, or its signal changes. */
  put(name: string, semaphore: PetSemaphore = 'idle', over: Partial<WatchedSession> = {}): this {
    this.tabs.set(name, { ptyId: `pty-${name}`, name, semaphore, blockedKind: null, ...over });
    return this.apply({ type: 'sessions', sessions: [...this.tabs.values()] });
  }

  /** Several tabs change in ONE input, like the service does when two hooks land together. */
  putAll(changes: readonly [name: string, semaphore: PetSemaphore][]): this {
    for (const [name, semaphore] of changes) this.tabs.set(name, { ptyId: `pty-${name}`, name, semaphore, blockedKind: null });
    return this.apply({ type: 'sessions', sessions: [...this.tabs.values()] });
  }

  close(name: string): this {
    this.tabs.delete(name);
    return this.apply({ type: 'sessions', sessions: [...this.tabs.values()] });
  }

  /** The owner looks at a tab (active tab + the Donel window focused), or looks away. */
  look(name: string | null, donelFocused = true): this {
    this.focus = { activePtyId: name === null ? null : `pty-${name}`, donelFocused };
    return this.apply({ type: 'focus', focus: this.focus });
  }

  exit(name: string, byUser: boolean): this {
    return this.apply({ type: 'sessionExited', ptyId: `pty-${name}`, name, byUser, at: this.now });
  }

  pending(name: string, kind: BlockedKind): this {
    return this.apply({ type: 'pendingOpened', ptyId: `pty-${name}`, kind, at: this.now });
  }

  silence(until: number | null): this {
    return this.apply({ type: 'silence', until });
  }

  fullscreen(active: boolean): this {
    return this.apply({ type: 'fullscreen', active });
  }

  advance(ms: number): this {
    this.now += ms;
    return this.apply({ type: 'tick' });
  }

  apply(input: PetInput): this {
    this.state = reducePet(this.state, input, this.now);
    return this;
  }

  get bubble(): Bubble | null {
    return this.state.bubble;
  }

  get view() {
    return toPetView(this.state, this.now, UI);
  }
}

/** `atlas` working, the owner elsewhere: its next `waiting` is a wait that nobody is looking at. */
const worldWithWorking = (...names: string[]): World => {
  const world = new World();
  for (const name of names) world.put(name, 'working');
  return world;
};

describe('truncateTabName (FR-015): names longer than 28 characters are cut and closed with an ellipsis', () => {
  it('leaves a name of up to 28 characters alone', () => {
    expect(PET_BUBBLE_NAME_MAX).toBe(28);
    expect(truncateTabName('atlas')).toBe('atlas');
    expect(truncateTabName('a'.repeat(28))).toBe('a'.repeat(28));
  });

  it('cuts at 28 characters and adds the ellipsis from the 29th on', () => {
    expect(truncateTabName('a'.repeat(29))).toBe(`${'a'.repeat(28)}…`);
    expect(truncateTabName('b'.repeat(80))).toBe(`${'b'.repeat(28)}…`);
  });

  it('counts characters, not UTF-16 code units: an emoji is never cut in half', () => {
    const name = `${'a'.repeat(27)}🙂🙂`;
    const cut = truncateTabName(name);
    expect(cut).toBe(`${'a'.repeat(27)}🙂…`);
    expect(() => encodeURIComponent(cut)).not.toThrow(); // throws on a lone surrogate
  });
});

describe('the text of an event (FR-015) and its pose (FR-016)', () => {
  it.each<[string, BubbleEvent, string]>([
    ['finished', ev('finished'), 'atlas · terminou'],
    ['blocked on a question', ev('blocked', 'atlas', { blockedKind: 'question' }), 'atlas · tem uma pergunta'],
    ['blocked on a permission', ev('blocked', 'atlas', { blockedKind: 'permission' }), 'atlas · quer permissão'],
    ['blocked on a plan', ev('blocked', 'atlas', { blockedKind: 'plan' }), 'atlas · plano para aprovar'],
    ['blocked with the kind unknown (no chat)', ev('blocked', 'atlas', { blockedKind: null }), 'atlas · quer permissão'],
    ['ended', ev('ended'), 'atlas · encerrou'],
  ])('%s', (_label, event, text) => {
    expect(eventText(event)).toBe(text);
  });

  it('the name in the text is cut at 28 characters', () => {
    const long = 'x'.repeat(40);
    expect(eventText(ev('finished', long))).toBe(`${'x'.repeat(28)}… · terminou`);
  });

  it.each<[BubbleEventKind, string]>([
    ['finished', 'calling'],
    ['blocked', 'surprised'],
    ['ended', 'sad'],
  ])('the pose of %s is %s', (kind, pose) => {
    expect(eventPose(ev(kind))).toBe(pose);
  });
});

describe('splitSessionBubbleText: the screen styles the name of the tab apart from what happened', () => {
  it('splits `<aba> · <evento>` in two', () => {
    expect(splitSessionBubbleText('atlas · terminou')).toEqual({ name: 'atlas', event: 'terminou' });
    expect(splitSessionBubbleText('atlas · tem uma pergunta')).toEqual({ name: 'atlas', event: 'tem uma pergunta' });
  });

  it('every text of FR-015 splits back into the name and the event that made it', () => {
    for (const event of [ev('finished', 'beacon'), ev('blocked', 'beacon', { blockedKind: 'plan' }), ev('ended', 'beacon')]) {
      const split = splitSessionBubbleText(eventText(event));
      expect(split?.name).toBe('beacon');
      expect(`${split?.name} · ${split?.event}`).toBe(eventText(event));
    }
  });

  it('a name with the separator inside is still one name: it splits at the LAST one, because no event has it', () => {
    expect(splitSessionBubbleText('atlas · repasse · quer permissão')).toEqual({ name: 'atlas · repasse', event: 'quer permissão' });
  });

  it('a cut name keeps its ellipsis', () => {
    expect(splitSessionBubbleText(eventText(ev('finished', 'x'.repeat(40))))).toEqual({ name: `${'x'.repeat(28)}…`, event: 'terminou' });
  });

  it('a text that is not of one session (an aggregate, an account) does not split', () => {
    expect(splitSessionBubbleText('3 sessões terminaram')).toBeNull();
    expect(splitSessionBubbleText('Conta → Interno 3')).toBeNull();
    expect(splitSessionBubbleText('')).toBeNull();
  });
});

describe('composeBubble: what a set of events says as ONE bubble (FR-017)', () => {
  it('one event is its own text, its pose and its session as the target', () => {
    expect(composeBubble([ev('finished')])).toEqual({ text: 'atlas · terminou', pose: 'calling', target: { kind: 'session', ptyId: 'pty-atlas' } });
  });

  it('two or more `finished` become "N sessões terminaram": calling, and the list as the target', () => {
    expect(composeBubble([ev('finished', 'atlas'), ev('finished', 'beacon')])).toEqual({ text: '2 sessões terminaram', pose: 'calling', target: { kind: 'list' } });
    expect(composeBubble([ev('finished', 'atlas'), ev('finished', 'beacon'), ev('finished', 'vega')]).text).toBe('3 sessões terminaram');
  });

  it('mixed kinds become "N sessões esperando você": surprised, and the list', () => {
    expect(composeBubble([ev('finished', 'atlas'), ev('blocked', 'beacon')])).toEqual({ text: '2 sessões esperando você', pose: 'surprised', target: { kind: 'list' } });
  });

  it('several blocked ones, of any kind, are sessions waiting for the owner too', () => {
    expect(composeBubble([ev('blocked', 'atlas', { blockedKind: 'permission' }), ev('blocked', 'beacon', { blockedKind: 'question' })])).toMatchObject({
      text: '2 sessões esperando você',
      pose: 'surprised',
    });
  });

  it('several that ended become "N sessões encerraram": sad (Q9)', () => {
    expect(composeBubble([ev('ended', 'atlas'), ev('ended', 'beacon')])).toEqual({ text: '2 sessões encerraram', pose: 'sad', target: { kind: 'list' } });
  });

  it('an `ended` among the others counts as one more waiting', () => {
    expect(composeBubble([ev('finished', 'atlas'), ev('ended', 'beacon')]).text).toBe('2 sessões esperando você');
  });

  it('the aggregate never names a tab: only a count (FR-018)', () => {
    const text = composeBubble([ev('finished', 'atlas'), ev('finished', 'beacon')]).text;
    expect(text).not.toContain('atlas');
    expect(text).not.toContain('beacon');
  });
});

describe('a bubble is born when a wait starts out of the owner\'s sight (FR-014)', () => {
  it('finished: working to waiting, the owner elsewhere', () => {
    const world = worldWithWorking('atlas').advance(5 * SEC).put('atlas', 'waiting');
    expect(world.bubble).toEqual({
      id: 1,
      text: 'atlas · terminou',
      pose: 'calling',
      target: { kind: 'session', ptyId: 'pty-atlas' },
      until: world.now + PET_BUBBLE_MS,
    });
    expect(PET_BUBBLE_MS).toBe(6 * SEC);
  });

  it('blocked: working to permission, with the kind unknown it says "quer permissão"', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission');
    expect(world.bubble).toMatchObject({ text: 'atlas · quer permissão', pose: 'surprised', target: { kind: 'session', ptyId: 'pty-atlas' } });
  });

  it('blocked: the kind the service already knows is the one in the text', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission', { blockedKind: 'plan' });
    expect(world.bubble?.text).toBe('atlas · plano para aprovar');
  });

  it('an idle tab that starts waiting counts too: it was known, and it changed', () => {
    const world = new World().put('atlas', 'idle').put('atlas', 'waiting');
    expect(world.bubble?.text).toBe('atlas · terminou');
  });

  it('shows up in the view, with the pose of the event in front of everything', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting');
    expect(world.view.bubble).toEqual({ id: 1, text: 'atlas · terminou', pose: 'calling', target: { kind: 'session', ptyId: 'pty-atlas' } });
    expect(world.view.pose).toBe('calling');
  });

  it('the view carries only the text, the pose and the target: no `until`, no kind, nothing of the conversation (FR-018)', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting');
    expect(Object.keys(world.view.bubble ?? {}).sort()).toEqual(['id', 'pose', 'target', 'text']);
  });
});

describe('no bubble is born: the owner saw it, nobody changed, or it was never seen changing', () => {
  it('a session that ends its turn on the tab the owner is looking at is born seen (FR-019)', () => {
    const world = worldWithWorking('atlas').look('atlas').put('atlas', 'waiting');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(0);
  });

  it('the same for a permission', () => {
    expect(worldWithWorking('atlas').look('atlas').put('atlas', 'permission').bubble).toBeNull();
  });

  it('a tab that shows up already waiting was not seen changing: no bubble', () => {
    expect(new World().advance(MIN).put('atlas', 'waiting').bubble).toBeNull();
    expect(new World().put('atlas', 'permission').bubble).toBeNull();
  });

  it('the same state again is not an event (dedupe)', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').advance(7 * SEC);
    expect(world.bubble).toBeNull();
    world.put('atlas', 'waiting');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(1);
  });

  it('waiting to permission is no event: the session was already counted (R3), so an idle prompt is not a false "quer permissão"', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').advance(7 * SEC);
    world.put('atlas', 'permission');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(1);
  });

  it('...and permission to waiting is none either', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission').advance(7 * SEC);
    world.put('atlas', 'waiting');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(1);
  });

  it('going back to work, or done, is not an event', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').advance(7 * SEC).put('atlas', 'working').put('atlas', 'done');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(1);
  });

  it('a closed tab leaves without a bubble (FR-009)', () => {
    const world = worldWithWorking('atlas', 'beacon').advance(7 * SEC).close('atlas');
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(0);
  });

  it('a new wait after the owner saw the last one is a new event, with a new bubble', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').look('atlas').look('beacon').put('atlas', 'working');
    world.advance(10 * SEC).put('atlas', 'waiting');
    expect(world.bubble).toMatchObject({ id: 2, text: 'atlas · terminou' });
  });
});

describe('a bubble lives 6 s and then goes (FR-017)', () => {
  it('is still there one millisecond before and gone at the instant, with the face back to what the sessions ask for', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting');
    expect(world.view.pose).toBe('calling');
    world.advance(PET_BUBBLE_MS - 1);
    expect(world.view.bubble).not.toBeNull();
    expect(world.view.pose).toBe('calling');
    world.advance(1);
    expect(world.state.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
    expect(world.view.bubble).toBeNull();
    expect(world.view.pose).toBe('impatient');
  });

  it('ids only grow: the next bubble is a new one, and `resume` does not take the count back', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(PET_BUBBLE_MS);
    expect(world.state.lastBubbleId).toBe(1);
    world.put('beacon', 'waiting');
    expect(world.bubble?.id).toBe(2);
    world.apply({ type: 'resume' });
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(2);
    world.put('beacon', 'working').put('beacon', 'waiting');
    expect(world.bubble?.id).toBe(3);
  });

  it('`resume` (the pet window opened again) drops the bubble and the events behind it', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').apply({ type: 'resume' });
    expect(world.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
  });
});

describe('events of the same second become ONE bubble, with the same id (FR-017)', () => {
  it('three sessions that finish in the same input: "3 sessões terminaram", calling, the list', () => {
    const world = worldWithWorking('atlas', 'beacon', 'vega').putAll([
      ['atlas', 'waiting'],
      ['beacon', 'waiting'],
      ['vega', 'waiting'],
    ]);
    expect(world.bubble).toMatchObject({ id: 1, text: '3 sessões terminaram', pose: 'calling', target: { kind: 'list' } });
    expect(world.state.lastBubbleId).toBe(1);
  });

  it('an event up to 1 s after the birth joins the bubble: the text becomes the aggregate and the id does not change (no second hop)', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting');
    const born = world.bubble;
    expect(born?.text).toBe('atlas · terminou');
    world.advance(600).put('beacon', 'waiting');
    expect(world.bubble).toMatchObject({ id: 1, text: '2 sessões terminaram', target: { kind: 'list' } });
    expect(world.bubble?.until).toBe(born?.until); // it does not live longer because someone joined
  });

  it('the window is 1 s from the birth, edges included', () => {
    expect(PET_BUBBLE_JOIN_MS).toBe(SEC);
    const joined = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(PET_BUBBLE_JOIN_MS).put('beacon', 'waiting');
    expect(joined.bubble).toMatchObject({ id: 1, text: '2 sessões terminaram' });

    const late = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(PET_BUBBLE_JOIN_MS + 1).put('beacon', 'waiting');
    expect(late.bubble).toMatchObject({ id: 2, text: 'beacon · terminou', target: { kind: 'session', ptyId: 'pty-beacon' } });
  });

  it('a later event replaces the bubble: new id, its own text, the 6 s counted again', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(3 * SEC).put('beacon', 'permission');
    expect(world.bubble).toEqual({
      id: 2,
      text: 'beacon · quer permissão',
      pose: 'surprised',
      target: { kind: 'session', ptyId: 'pty-beacon' },
      until: world.now + PET_BUBBLE_MS,
    });
  });

  it('finished and blocked in the same second: "2 sessões esperando você", surprised', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').put('beacon', 'permission');
    expect(world.bubble).toMatchObject({ id: 1, text: '2 sessões esperando você', pose: 'surprised', target: { kind: 'list' } });
  });

  it('the same session twice in the window counts once, and its latest event speaks (a turn that ends and the process right after it)', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').exit('atlas', false);
    expect(world.bubble).toMatchObject({ id: 1, text: 'atlas · encerrou', pose: 'sad', target: { kind: 'session', ptyId: 'pty-atlas' } });
    expect(world.state.pendingBurst).toHaveLength(1);
  });

  it('a session that went back to work took its bubble with it, so its next event is a new bubble', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').put('atlas', 'working').put('atlas', 'permission');
    expect(world.bubble).toMatchObject({ id: 2, text: 'atlas · quer permissão' });
  });

  it('a bubble that is not a session bubble never absorbs a session event, even inside its first second', () => {
    const world = worldWithWorking('atlas');
    const account: Bubble = { id: 7, text: 'Conta → Interno 3', pose: 'mirror', target: { kind: 'donel' }, until: world.now + PET_BUBBLE_MS };
    world.state = { ...world.state, bubble: account, lastBubbleId: 7 };
    world.put('atlas', 'waiting');
    expect(world.bubble).toMatchObject({ id: 8, text: 'atlas · terminou' });
  });
});

describe('pendingOpened refines the kind of the blocked event, and only that (R3)', () => {
  it('"quer permissão" becomes "tem uma pergunta" at once: same id, same pose, same end', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission');
    const born = world.bubble;
    expect(born?.text).toBe('atlas · quer permissão');
    world.pending('atlas', 'question');
    expect(world.bubble).toEqual({ ...born, text: 'atlas · tem uma pergunta' });
  });

  it('and into "plano para aprovar"', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission').pending('atlas', 'plan');
    expect(world.bubble?.text).toBe('atlas · plano para aprovar');
  });

  it('a permission pending leaves "quer permissão"', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission').pending('atlas', 'permission');
    expect(world.bubble?.text).toBe('atlas · quer permissão');
  });

  it('it refines the session it names, inside an aggregate the text does not change', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'permission').put('beacon', 'permission').pending('beacon', 'question');
    expect(world.bubble).toMatchObject({ id: 1, text: '2 sessões esperando você' });
    expect(world.state.pendingBurst.find((event) => event.ptyId === 'pty-beacon')?.blockedKind).toBe('question');
    expect(world.state.pendingBurst.find((event) => event.ptyId === 'pty-atlas')?.blockedKind).toBeNull();
  });

  it('after the first second it refines nothing: the bubble is what it was', () => {
    const world = worldWithWorking('atlas').put('atlas', 'permission').advance(PET_BUBBLE_JOIN_MS + 1);
    world.pending('atlas', 'question');
    expect(world.bubble?.text).toBe('atlas · quer permissão');
  });

  it('it never creates a bubble: no blocked event, no bubble', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').advance(7 * SEC).pending('atlas', 'question');
    expect(world.bubble).toBeNull();
    const finished = worldWithWorking('atlas').put('atlas', 'waiting').pending('atlas', 'question');
    expect(finished.bubble?.text).toBe('atlas · terminou'); // a `finished` is not refined into a question
    expect(new World().pending('atlas', 'plan').bubble).toBeNull();
  });
});

describe('ended: the session exited by itself (FR-014)', () => {
  it('only when the owner did not close it: "encerrou", sad, and the session as the target', () => {
    const world = worldWithWorking('atlas', 'beacon').exit('atlas', false);
    expect(world.bubble).toMatchObject({ id: 1, text: 'atlas · encerrou', pose: 'sad', target: { kind: 'session', ptyId: 'pty-atlas' } });
  });

  it('closed by the owner (byUser): no bubble', () => {
    const world = worldWithWorking('atlas', 'beacon').exit('atlas', true);
    expect(world.bubble).toBeNull();
    expect(world.state.lastBubbleId).toBe(0);
  });

  it('the session record goes away on any exit', () => {
    expect(worldWithWorking('atlas').exit('atlas', false).state.sessions.has('pty-atlas')).toBe(false);
    expect(worldWithWorking('atlas').exit('atlas', true).state.sessions.has('pty-atlas')).toBe(false);
  });

  it('a session that was already `done` (the SessionEnd hook came before the exit) is announced all the same', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'done').exit('atlas', false);
    expect(world.bubble?.text).toBe('atlas · encerrou');
  });

  it('an exit of something the core does not know (a plain terminal, a tab never reported) is nothing', () => {
    const world = worldWithWorking('atlas').exit('shell', false);
    expect(world.bubble).toBeNull();
    expect(world.state.sessions.size).toBe(1);
  });

  it('with the tab in front and the Donel focused it is born seen: no bubble (Q9)', () => {
    const world = worldWithWorking('atlas', 'beacon').look('atlas').exit('atlas', false);
    expect(world.bubble).toBeNull();
  });

  it('with the Donel focused on ANOTHER tab, or the tab in front but the Donel out of focus, it is announced', () => {
    expect(worldWithWorking('atlas', 'beacon').look('beacon').exit('atlas', false).bubble?.text).toBe('atlas · encerrou');
    expect(worldWithWorking('atlas', 'beacon').look('atlas', false).exit('atlas', false).bubble?.text).toBe('atlas · encerrou');
  });

  it('several that end together become "N sessões encerraram" (Q9)', () => {
    const world = worldWithWorking('atlas', 'beacon', 'vega').exit('atlas', false).advance(300).exit('beacon', false);
    expect(world.bubble).toMatchObject({ id: 1, text: '2 sessões encerraram', pose: 'sad', target: { kind: 'list' } });
    world.advance(300).exit('vega', false);
    expect(world.bubble).toMatchObject({ id: 1, text: '3 sessões encerraram' });
  });

  it('a session that ended while waiting is no longer owed: it leaves the count, with no laugh (closing is not visiting)', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(7 * SEC).exit('atlas', false);
    expect(world.view.badge).toBeNull();
    expect(world.state.laughUntil).toBeNull();
    expect(world.bubble?.text).toBe('atlas · encerrou');
  });
});

describe('silence blocks the bubble, never the face (FR-020, FR-027)', () => {
  it('while it lasts no bubble is born, but the badge and the face keep changing', () => {
    const world = worldWithWorking('atlas').silence(1_000_000 + HOUR).put('atlas', 'waiting');
    expect(world.bubble).toBeNull();
    expect(world.view).toMatchObject({ badge: '1', pose: 'impatient', silenced: true });
  });

  it('it blocks every kind of event', () => {
    const world = worldWithWorking('atlas', 'beacon').silence(1_000_000 + HOUR).put('atlas', 'permission').exit('beacon', false);
    expect(world.bubble).toBeNull();
  });

  it('turning it on drops the bubble that is on screen', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting');
    expect(world.bubble).not.toBeNull();
    world.silence(world.now + HOUR);
    expect(world.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
  });

  it('it ends on time: the first event after it speaks again, and what was lost in it is not repeated', () => {
    const world = worldWithWorking('atlas', 'beacon').silence(1_000_000 + HOUR).put('atlas', 'waiting');
    world.advance(HOUR);
    expect(world.view.silenced).toBe(false);
    expect(world.bubble).toBeNull(); // atlas waits and is in the badge, but no balloon is made up afterwards
    world.put('beacon', 'waiting');
    expect(world.bubble).toMatchObject({ id: 1, text: 'beacon · terminou' });
    expect(world.view.badge).toBe('2');
  });

  it('"Retomar avisos" (until = null) lifts it at once', () => {
    const world = worldWithWorking('atlas', 'beacon').silence(1_000_000 + HOUR).silence(null);
    expect(world.view.silenced).toBe(false);
    world.put('atlas', 'waiting');
    expect(world.bubble?.text).toBe('atlas · terminou');
  });
});

describe('full screen: no bubble is born, and the one that is up goes (Q9)', () => {
  it('an event during full screen makes no bubble, and the state keeps following the sessions', () => {
    const world = worldWithWorking('atlas').fullscreen(true).put('atlas', 'waiting');
    expect(world.bubble).toBeNull();
    expect(world.view.badge).toBe('1');
  });

  it('it drops the bubble that is on screen', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').fullscreen(true);
    expect(world.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
  });

  it('when it ends, events speak again', () => {
    const world = worldWithWorking('atlas', 'beacon').fullscreen(true).put('atlas', 'waiting').fullscreen(false).put('beacon', 'waiting');
    expect(world.bubble?.text).toBe('beacon · terminou');
  });

  it('`resume` forgets it: the watcher says the truth again when it starts', () => {
    const world = worldWithWorking('atlas').fullscreen(true).apply({ type: 'resume' }).put('atlas', 'waiting');
    expect(world.bubble?.text).toBe('atlas · terminou');
  });
});

describe('the bubble goes when it stops making sense (Q9)', () => {
  it('the owner opens the session of the bubble before the 6 s: it goes at once, and the Jobu laughs', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').advance(2 * SEC);
    expect(world.bubble).not.toBeNull();
    world.look('atlas');
    expect(world.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
    expect(world.view.pose).toBe('laughing');
    world.advance(PET_LAUGH_MS);
    expect(world.view.pose).toBe('reading'); // beacon is still working: the face goes back to what the sessions ask for
  });

  it('looking at another tab, or at the right one with the Donel out of focus, leaves it there', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting');
    world.look('beacon');
    expect(world.bubble).not.toBeNull();
    world.look('atlas', false);
    expect(world.bubble).not.toBeNull();
  });

  it('the session closed, or back to work, takes the bubble with it', () => {
    const closed = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting').close('atlas');
    expect(closed.bubble).toBeNull();
    const working = worldWithWorking('atlas', 'beacon').put('atlas', 'permission').put('atlas', 'working');
    expect(working.bubble).toBeNull();
  });

  it('a `blocked` bubble goes when its session is seen too', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'permission').look('atlas');
    expect(world.bubble).toBeNull();
  });

  it('an aggregate stays while any of its sessions still waits, and goes when the last one is seen', () => {
    const world = worldWithWorking('atlas', 'beacon').putAll([
      ['atlas', 'waiting'],
      ['beacon', 'waiting'],
    ]);
    expect(world.bubble?.text).toBe('2 sessões terminaram');
    world.look('atlas');
    expect(world.bubble).not.toBeNull();
    world.look('beacon');
    expect(world.bubble).toBeNull();
  });

  it('an `ended` bubble is never stale: its session is gone by definition', () => {
    const world = worldWithWorking('atlas', 'beacon').exit('atlas', false).advance(3 * SEC);
    expect(world.bubble?.text).toBe('atlas · encerrou');
  });

  it('a click on the bubble dismisses it (the screen asked to open its target)', () => {
    const world = worldWithWorking('atlas').put('atlas', 'waiting').apply({ type: 'bubbleDismissed' });
    expect(world.bubble).toBeNull();
    expect(world.state.pendingBurst).toEqual([]);
    expect(world.view.pose).toBe('impatient'); // the face goes back to the sessions
    expect(world.view.badge).toBe('1'); // and who waits is still counted
  });
});

describe('purity', () => {
  it('never mutates the state it receives, bubble and burst included', () => {
    const world = worldWithWorking('atlas', 'beacon').put('atlas', 'waiting');
    const frozen = world.state;
    const snapshot = JSON.stringify({ ...frozen, sessions: [...frozen.sessions] });
    world.put('beacon', 'permission').pending('beacon', 'question').exit('atlas', false).silence(world.now + HOUR).fullscreen(true).advance(7 * SEC);
    expect(JSON.stringify({ ...frozen, sessions: [...frozen.sessions] })).toBe(snapshot);
  });

  it('the same inputs always give the same state', () => {
    const run = (): string => {
      const world = worldWithWorking('atlas', 'beacon', 'vega').put('atlas', 'waiting').advance(400).put('beacon', 'permission').pending('beacon', 'plan').advance(9 * SEC).exit('vega', false);
      return JSON.stringify({ ...world.state, sessions: [...world.state.sessions] });
    };
    expect(run()).toBe(run());
  });

  it('starts with no bubble, no burst, not silenced and not in full screen', () => {
    const state = createPetState();
    expect(state.bubble).toBeNull();
    expect(state.pendingBurst).toEqual([]);
    expect(state.lastBubbleId).toBe(0);
    expect(state.silencedUntil).toBeNull();
    expect(state.fullscreen).toBe(false);
  });
});
