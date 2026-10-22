// T036 (015-jobu-pet, US3) - what a click on the Jobu, or on its bubble, leads to (FR-022 to FR-025). The
// decision is pure and shared: the screen uses it to open the list or send a gesture, the main uses it
// to answer `pet:click` with ITS state, so the two can never disagree about what a click means.
import { describe, expect, it } from 'vitest';
import { decideBubbleClick, decideClick } from '../src/shared/pet/click';
import type { PetViewBubble, PetViewWaiting } from '../src/shared/pet/types';

const waits = (...names: string[]): readonly PetViewWaiting[] => names.map((name) => ({ ptyId: `pty-${name}`, name, waitingLabel: 'há 2 min' }));

describe('decideClick: a click on the drawing (FR-022 to FR-024)', () => {
  it('nobody waiting: just bring the Donel to the front, without changing tab (FR-024)', () => {
    expect(decideClick({ waiting: [] })).toEqual({ kind: 'donel' });
  });

  it('exactly one waiting: go to its tab (FR-022)', () => {
    expect(decideClick({ waiting: waits('atlas') })).toEqual({ kind: 'session', ptyId: 'pty-atlas' });
  });

  it('several waiting: a short list opens next to it (FR-023)', () => {
    expect(decideClick({ waiting: waits('atlas', 'beacon') })).toEqual({ kind: 'list' });
    expect(decideClick({ waiting: waits('atlas', 'beacon', 'vega') })).toEqual({ kind: 'list' });
  });

  it('does not touch what it receives', () => {
    const waiting = waits('atlas', 'beacon');
    const snapshot = JSON.stringify(waiting);
    decideClick({ waiting });
    expect(JSON.stringify(waiting)).toBe(snapshot);
  });
});

describe('decideBubbleClick: a click on the bubble goes where the bubble says (FR-025)', () => {
  const bubble = (target: PetViewBubble['target'], text = 'atlas · terminou'): PetViewBubble => ({ id: 1, text, pose: 'calling', target });

  it('a session bubble leads to the tab of that session, whoever else waits', () => {
    expect(decideBubbleClick(bubble({ kind: 'session', ptyId: 'pty-beacon' }), waits('atlas', 'beacon', 'vega'))).toEqual({ kind: 'session', ptyId: 'pty-beacon' });
  });

  it('...even when that session no longer waits: an "encerrou" bubble leads to the tab that ended', () => {
    expect(decideBubbleClick(bubble({ kind: 'session', ptyId: 'pty-atlas' }, 'atlas · encerrou'), [])).toEqual({ kind: 'session', ptyId: 'pty-atlas' });
  });

  it('an aggregate bubble opens the list while two or more wait', () => {
    expect(decideBubbleClick(bubble({ kind: 'list' }, '2 sessões terminaram'), waits('atlas', 'beacon'))).toEqual({ kind: 'list' });
  });

  it('...with only one left waiting, that one is the answer: a list of one is no list', () => {
    expect(decideBubbleClick(bubble({ kind: 'list' }, '2 sessões terminaram'), waits('beacon'))).toEqual({ kind: 'session', ptyId: 'pty-beacon' });
  });

  it('...and with none, the Donel comes to the front (an aggregate of sessions that ended)', () => {
    expect(decideBubbleClick(bubble({ kind: 'list' }, '2 sessões encerraram'), [])).toEqual({ kind: 'donel' });
  });

  it('the account bubble brings the Donel to the front', () => {
    expect(decideBubbleClick(bubble({ kind: 'donel' }, 'Conta → Interno 3'), waits('atlas', 'beacon'))).toEqual({ kind: 'donel' });
  });
});
