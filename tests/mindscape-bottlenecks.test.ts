// Gargalos do ambiente (t-dda3571f) — what the panel says about a session decides what the owner closes in batch:
// a session that works must never be offered for closing, and one stuck by the quota must never read "trabalhando".

import { describe, expect, it } from 'vitest';
import type { RemoteSessionReading } from '../src/shared/health/remoteSessions';
import { buildEnvPanel, canOfferClose, pulseOfLocal, pulseOfRemote, type EnvSession, type SessionPulse } from '../src/shared/mindscape/bottlenecks';

const NOW = Date.UTC(2026, 10, 8, 13, 0);
const MIN = 60_000;

function reading(over: Partial<RemoteSessionReading>): RemoteSessionReading {
  return {
    sid: 's1',
    name: 'Dev',
    rssBytes: 300e6,
    cpuTicks: 0,
    clkTck: 100,
    pane: 'idle',
    paneActivityAt: NOW - 30 * MIN,
    transcript: true,
    lastAt: NOW - 5 * MIN,
    turn: 'ended',
    last: 'reply',
    tool: null,
    apiError: null,
    retry: null,
    ...over,
  };
}

describe('pulseOfRemote', () => {
  it('reads the spinner on the pane as working, whatever the last hook said', () => {
    expect(pulseOfRemote(reading({ pane: 'busy', turn: 'open', last: 'tool', tool: 'Bash' }), NOW)).toMatchObject({ state: 'trabalhando', reason: 'rodando Bash' });
    expect(pulseOfRemote(reading({ pane: 'busy', turn: 'open', last: 'request', lastAt: NOW - 3 * MIN }), NOW).state).toBe('esperando-api');
  });

  it('names the cause of a turn that ended on a failed call (the "parada por conta" of the owner)', () => {
    const quota = reading({ last: 'error', apiError: { kind: 'rate_limit', text: 'API Error: Request rejected (429) · All credentials for model claude-opus are cooling down', at: NOW - 2 * 60 * MIN } });
    expect(pulseOfRemote(quota, NOW)).toMatchObject({ state: 'travada', reason: 'gateway sem cota (429) há 2 h' });
    const refused = reading({ last: 'error', apiError: { kind: 'server_error', text: 'API Error: Connection refused (ECONNREFUSED)', at: NOW - 10 * MIN } });
    expect(pulseOfRemote(refused, NOW).reason).toMatch(/^gateway fora do ar/);
    const weekly = reading({ last: 'error', apiError: { kind: 'rate_limit', text: "You've hit your weekly limit · resets Nov 10", at: NOW } });
    expect(pulseOfRemote(weekly, NOW).reason).toMatch(/^conta no limite/);
  });

  it('a call that answered after the failure is not stuck', () => {
    expect(pulseOfRemote(reading({ last: 'reply', apiError: null }), NOW).state).toBe('ociosa');
  });

  it('only a turn ended long ago (or a session that never got a request) "pode fechar"', () => {
    expect(pulseOfRemote(reading({ lastAt: NOW - 20 * MIN }), NOW).state).toBe('ociosa');
    expect(pulseOfRemote(reading({ lastAt: NOW - 14 * 60 * MIN }), NOW)).toMatchObject({ state: 'pode-fechar', reason: 'terminou há 14 h, ninguém retomou' });
    expect(pulseOfRemote(reading({ transcript: false, lastAt: null, turn: null, last: null, paneActivityAt: NOW - 3 * 60 * MIN }), NOW).state).toBe('pode-fechar');
  });

  it('a prompt on the pane is the owner\'s, never closable', () => {
    expect(pulseOfRemote(reading({ pane: 'permission', lastAt: NOW - 20 * 60 * MIN }), NOW).state).toBe('precisa-dono');
  });
});

describe('pulseOfLocal', () => {
  it('a usage-limit failure reads stuck, a fresh birth reads unknown', () => {
    expect(pulseOfLocal({ state: 'waiting', stateEnteredAt: NOW - MIN, turnFailure: 'rate_limit' }, NOW).state).toBe('travada');
    expect(pulseOfLocal({ state: 'working', stateEnteredAt: 0, unconfirmed: true }, NOW).state).toBe('desconhecido');
  });
});

function session(id: string, pulse: Partial<SessionPulse> & Pick<SessionPulse, 'state'>, over: Partial<EnvSession> = {}): EnvSession {
  return { sessionId: id, name: id, tabId: `tab-${id}`, machineId: 'vps', account: null, pulse: { reason: '', since: NOW - 2 * 60 * MIN, source: 'lugar', ...pulse }, ...over };
}

describe('closing in batch', () => {
  it('never offers a session that works, waits for the API or for the owner, the Líder, or one without a tab', () => {
    for (const state of ['trabalhando', 'esperando-api', 'precisa-dono', 'desconhecido'] as const) expect(canOfferClose(session('a', { state }))).toBe(false);
    expect(canOfferClose(session('a', { state: 'pode-fechar' }, { roleId: 'lider' }))).toBe(false);
    expect(canOfferClose(session('a', { state: 'pode-fechar' }, { tabId: undefined }))).toBe(false);
    expect(canOfferClose(session('a', { state: 'pode-fechar' }))).toBe(true);
  });

  it('pre-marks only "pode fechar"; idle and stuck ones are offered unmarked', () => {
    const panel = buildEnvPanel({
      sessions: [
        session('idle', { state: 'ociosa' }),
        session('old', { state: 'pode-fechar' }),
        session('stuck', { state: 'travada', reason: 'gateway fora do ar há 1 h' }),
        session('busy', { state: 'trabalhando' }),
        session('elsewhere', { state: 'pode-fechar' }, { tabId: undefined }),
        session('leader', { state: 'pode-fechar' }, { roleId: 'lider' }),
      ],
      machines: [],
      accounts: [],
      links: [],
    });
    expect(panel.closable.map((entry) => [entry.session.sessionId, entry.premarked, entry.canClose])).toEqual([
      ['old', true, true],
      ['elsewhere', false, false],
      ['stuck', false, true],
      ['idle', false, true],
    ]);
  });
});

describe('bottlenecks', () => {
  it('groups stuck sessions by cause and finds a mother waiting on a stuck daughter', () => {
    const panel = buildEnvPanel({
      sessions: [
        session('mae', { state: 'ociosa' }),
        session('filha', { state: 'travada', reason: 'gateway fora do ar há 3 h' }),
        session('outra', { state: 'travada', reason: 'gateway fora do ar há 1 h' }),
      ],
      machines: [{ id: 'vps', label: 'VPS', kind: 'vps', reachable: true, ramUsedRatio: 0.95, swapUsedRatio: 0.1, loadPerCpu: 0.5, account: null }],
      accounts: [{ label: 'a@x', loadPct: 100, available: true, needsReconnect: false, activeOn: ['PC'] }],
      links: [{ from: 'mae', to: 'filha' }],
    });
    const titles = panel.bottlenecks.map((item) => item.title);
    expect(titles).toContain('2 sessões travadas: gateway fora do ar');
    expect(titles).toContain('Conta a@x: sem cota (100%)');
    expect(titles).toContain('VPS: RAM 95%');
    expect(panel.waits).toEqual([expect.objectContaining({ waiting: 'mae', on: 'filha', kind: 'mae-espera-filha', blocked: true })]);
  });
});
