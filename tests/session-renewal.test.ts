import { describe, expect, it } from 'vitest';
import { addLink, carrySessionCard, emptyMindscapeDoc, placeSessionCard, writeSessionNote } from '../src/shared/mindscape/model';
import {
  checkRenewal,
  decideSwap,
  DEFAULT_SESSION_RENEWAL_PREFS,
  parseHandoffHeader,
  type RenewalCheckInput,
} from '../src/shared/sessionRenewal';

// Sessão renovada em voo (B36) — the two decisions that would end a process the
// owner did not mean to end (or never end it), and the card that must keep its
// place on the board. Refinement: docs/refinamentos/sessao-renovada-em-voo.md.

const base: RenewalCheckInput = {
  prefs: DEFAULT_SESSION_RENEWAL_PREFS,
  contextTokens: 260_000,
  turn: 'waiting',
  backgroundAgents: false,
  snoozedUntilTokens: null,
  eligible: true,
};

describe('checkRenewal — renew now?', () => {
  it('past the limit, at the end of a turn, with nothing in the background: renew', () => {
    expect(checkRenewal(base)).toBe('renew');
  });

  it('never mid-turn, with a permission open or with background agents alive', () => {
    expect(checkRenewal({ ...base, turn: 'working' })).toBe('due-wait');
    expect(checkRenewal({ ...base, turn: 'permission' })).toBe('due-wait');
    expect(checkRenewal({ ...base, backgroundAgents: true })).toBe('due-wait');
  });

  it('warns close to the limit, and "Agora não" moves the threshold', () => {
    expect(checkRenewal({ ...base, contextTokens: 240_000 })).toBe('near');
    expect(checkRenewal({ ...base, contextTokens: 100_000 })).toBe('off');
    expect(checkRenewal({ ...base, snoozedUntilTokens: 310_000 })).toBe('off');
    expect(checkRenewal({ ...base, contextTokens: 312_000, snoozedUntilTokens: 310_000 })).toBe('renew');
  });

  it('off when switched off, without a reading, or in a tab that is not eligible', () => {
    expect(checkRenewal({ ...base, prefs: { ...base.prefs, enabled: false } })).toBe('off');
    expect(checkRenewal({ ...base, contextTokens: null })).toBe('off');
    expect(checkRenewal({ ...base, eligible: false })).toBe('off');
  });
});

describe('decideSwap — swap or wait?', () => {
  const ready = parseHandoffHeader('---\ndonel-passagem: 1\ntrabalho-vivo: nenhum\n---\n# Passagem');

  it('handoff written, turn over, nothing alive: swap', () => {
    expect(ready).toEqual({ kind: 'ready', liveWork: null });
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('swap');
  });

  it('never ends a process with live work, declared or reported by the CLI', () => {
    const declared = parseHandoffHeader('---\ndonel-passagem: 1\ntrabalho-vivo: agente revisando o PR #12\n---\n');
    expect(decideSwap({ handoff: declared, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-live-work');
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: true, turnEndedSinceAsk: true })).toBe('wait-live-work');
    // a header without the field did not say "nothing": it counts as live work
    const silent = parseHandoffHeader('---\ndonel-passagem: 1\n---\n');
    expect(decideSwap({ handoff: silent, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-live-work');
  });

  it('waits for the request turn to end; gives up when it ended without a handoff', () => {
    expect(decideSwap({ handoff: ready, turn: 'working', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('wait-turn');
    expect(decideSwap({ handoff: ready, turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: false })).toBe('wait-turn');
    expect(decideSwap({ handoff: parseHandoffHeader(null), turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('give-up');
    expect(decideSwap({ handoff: parseHandoffHeader('# sem cabeçalho'), turn: 'waiting', backgroundAgents: false, turnEndedSinceAsk: true })).toBe('give-up');
  });
});

describe('carrySessionCard — the card is the same place before and after', () => {
  it('the card, the post-it and the links pass to the new session, in place', () => {
    let doc = placeSessionCard(emptyMindscapeDoc(), 'C:/atlas', 'old');
    doc = writeSessionNote(doc, 'C:/atlas', { sessionId: 'old', sessionName: 'atlas', text: 'feito', writtenAt: 1 });
    doc = placeSessionCard(doc, 'C:/atlas', 'beacon');
    doc = addLink(doc, 'C:/atlas', { id: 'l1', from: 'session:old', to: 'session:beacon' });
    doc = addLink(doc, 'C:/atlas', { id: 'l2', from: 'session:old', to: 'note:old' });
    const before = doc.boards['C:/atlas']!.cards;

    const after = carrySessionCard(doc, 'old', 'new').boards['C:/atlas']!;
    expect(after.cards['session:old']).toBeUndefined();
    expect(after.cards['note:old']).toBeUndefined();
    expect(after.cards['session:new']).toMatchObject({ sessionId: 'new', x: before['session:old']!.x, y: before['session:old']!.y });
    expect(after.cards['note:new']).toMatchObject({ sessionId: 'new', text: 'feito', x: before['note:old']!.x, y: before['note:old']!.y });
    expect(after.links).toEqual([
      { id: 'l1', from: 'session:new', to: 'session:beacon', arrow: true },
      { id: 'l2', from: 'session:new', to: 'note:new', arrow: true },
    ]);
  });

  it('a card the new session already got gives way to the old place; nothing to carry is a no-op', () => {
    let doc = placeSessionCard(emptyMindscapeDoc(), 'C:/vega', 'old');
    doc = placeSessionCard(doc, 'C:/vega', 'new');
    const oldPlace = doc.boards['C:/vega']!.cards['session:old']!;
    const after = carrySessionCard(doc, 'old', 'new').boards['C:/vega']!;
    expect(Object.keys(after.cards)).toEqual(['session:new']);
    expect(after.cards['session:new']).toMatchObject({ x: oldPlace.x, y: oldPlace.y });

    expect(carrySessionCard(doc, 'ghost', 'new')).toBe(doc);
  });
});
