import { describe, expect, it } from 'vitest';
import {
  checkRenewal,
  decideSwap,
  DEFAULT_SESSION_RENEWAL_PREFS,
  parseHandoffHeader,
  renewalHandoffDeliveryNotice,
  type RenewalCheckInput,
} from '../src/shared/sessionRenewal';
import { createSessionRenewalService, type RenewalFs } from '../src/main/session-renewal';

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

describe('prepare — a seat renewed more than once keeps the older handoffs', () => {
  const memFs: RenewalFs = { mkdirSync: () => {}, writeFileSync: () => {}, readFileText: () => null };
  let clock = Date.UTC(2026, 10, 10, 12, 0, 0);
  let n = 0;
  const service = createSessionRenewalService({ handoffsDir: '/home/atlas/handoffs', fs: memFs, now: () => (clock += 60_000), randomId: () => `r${++n}` });
  const ask = (sessionId: string, openingHandoffPath?: string) => ({
    sessionId,
    transcriptPath: null,
    cwd: '/home/atlas/seazone/beacon',
    contextTokens: 260_000,
    limitTokens: 250_000,
    ...(openingHandoffPath ? { openingHandoffPath } : {}),
  });

  it('reads the current handoff first and lists the older ones, newest first, as optional history', () => {
    const first = service.prepare(ask('aaaaaaaa-1111'));
    expect(first.firstPrompt).not.toContain('histórico');
    const second = service.prepare(ask('bbbbbbbb-2222', first.handoffPath));
    const third = service.prepare(ask('cccccccc-3333', second.handoffPath));
    expect(third.handoffChain).toEqual([third.handoffPath, second.handoffPath, first.handoffPath]);
    const p = third.firstPrompt;
    expect(p.indexOf(third.handoffPath)).toBeGreaterThan(-1);
    expect(p.indexOf(third.handoffPath)).toBeLessThan(p.indexOf(second.handoffPath));
    expect(p.indexOf(second.handoffPath)).toBeLessThan(p.indexOf(first.handoffPath));
    expect(p).toContain('leia só se precisar do histórico deste lugar');
  });

  it('on a remote place the history is the paths ON the place, never the copies here', () => {
    const remote = { sshTarget: 'vega', home: '/home/vega' };
    const first = service.prepare(ask('dddddddd-4444'), remote);
    // the chat knows the copy here; the new session on the place must read the place's file
    const second = service.prepare(ask('eeeeeeee-5555', first.remote?.localCopyPath), remote);
    expect(second.handoffChain).toEqual([second.handoffPath, first.handoffPath]);
    expect(second.firstPrompt).toContain(first.handoffPath);
    expect(second.firstPrompt).not.toContain(first.remote?.localCopyPath);
  });
});
