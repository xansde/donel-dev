import { describe, expect, it } from 'vitest';
import {
  checkRenewal,
  decideSwap,
  DEFAULT_SESSION_RENEWAL_PREFS,
  parseHandoffHeader,
  renewalHandoffDeliveryNotice,
  type RenewalCheckInput,
} from '../src/shared/sessionRenewal';

// Sessão renovada em voo (B36) — the two decisions that would end a process the
// owner did not mean to end (or never end it). The card that keeps its place on the
// board is in mindscape-place.test.ts. Refinement: docs/refinamentos/sessao-renovada-em-voo.md.

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

describe('renewalHandoffDeliveryNotice — did the new session get the handoff?', () => {
  const path = '/home/atlas/.config/donel-dev/handoffs/beacon.md';

  it('quiet when the first message went in or the CLI queued it', () => {
    expect(renewalHandoffDeliveryNotice({ kind: 'entrou' }, path)).toBeNull();
    expect(renewalHandoffDeliveryNotice({ kind: 'na-fila' }, path)).toBeNull();
  });

  it('says so, with the handoff path, when it did not go in or is still on its way past the wait', () => {
    const failed = renewalHandoffDeliveryNotice({ kind: 'nao-foi', reason: 'a caixa não respondeu' }, path);
    expect(failed).toContain(path);
    expect(failed).toContain('a caixa não respondeu');
    const pending = renewalHandoffDeliveryNotice({ kind: 'enviando' }, path);
    expect(pending).toContain(path);
    expect(pending).not.toBeNull();
  });
});
