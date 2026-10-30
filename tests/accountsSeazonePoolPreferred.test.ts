import { describe, expect, it } from 'vitest';
import { planConnectSeazonePool } from '../src/main/accounts/account-pool';
import { sanitizeAccountsConfig } from '../src/main/accounts/accounts-config';
import { restrictPoolToPreferred, selectAutoSwitchTarget, type PickTwo } from '../src/main/accounts/auto-switch';
import { toPoolAccountId } from '../src/main/accounts/pool-account-id';
import type { AccountSummary, AutoSwitchPolicy } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// B25 — preferidas do pool Seazone: com a lista preenchida, o auto-switch só
// leva para essas contas do pool. A troca manual e a lista do painel não
// passam por este filtro.

function summary(id: string, load: number | null): AccountSummary {
  return {
    id,
    label: id,
    plan: null,
    active: false,
    available: true,
    load: { fiveHour: load, sevenDay: null, sonnet: null, readAt: '2026-10-28T00:00:00.000Z' },
  };
}

const firstTwo: PickTwo = (candidates) => candidates.slice(0, 2);
const POLICY: AutoSwitchPolicy = { enabled: true, switchAtLoad: 90, minAdvantage: 20 };
const MINE = toPoolAccountId('minha@example.test');
const OTHER = toPoolAccountId('alheia@example.test');

describe('restrictPoolToPreferred', () => {
  const accounts = [summary('local-a', 95), summary(OTHER, 0), summary(MINE, 10)];

  it('sem lista devolve tudo', () => {
    expect(restrictPoolToPreferred(accounts, 'local-a', undefined)).toBe(accounts);
    expect(restrictPoolToPreferred(accounts, 'local-a', [])).toBe(accounts);
  });

  it('com lista tira só as contas do pool fora dela; locais ficam', () => {
    expect(restrictPoolToPreferred(accounts, 'local-a', ['minha@example.test']).map((a) => a.id)).toEqual(['local-a', MINE]);
  });

  it('a ativa fica mesmo fora da lista', () => {
    expect(restrictPoolToPreferred(accounts, OTHER, ['minha@example.test']).map((a) => a.id)).toEqual(['local-a', OTHER, MINE]);
  });

  it('o auto-switch vai para a preferida mesmo com uma alheia mais livre', () => {
    const restricted = restrictPoolToPreferred(accounts, 'local-a', ['minha@example.test']);
    expect(selectAutoSwitchTarget(restricted, 'local-a', POLICY, firstTwo)).toBe(MINE);
  });

  it('nenhuma preferida com folga: não troca', () => {
    const full = [summary('local-a', 95), summary(OTHER, 0), summary(MINE, 90)];
    const restricted = restrictPoolToPreferred(full, 'local-a', ['minha@example.test']);
    expect(selectAutoSwitchTarget(restricted, 'local-a', POLICY, firstTwo)).toBeNull();
  });
});

describe('config das preferidas', () => {
  const defaults = defaultAccountsConfig();

  it('sanitize apara, tira repetidas e descarta o que não é texto', () => {
    const parsed = { ...defaults, seazone: { baseUrl: 'https://switcher.example.test', preferredLabels: [' a@x.test ', 'a@x.test', '', 3, 'b@x.test'] } };
    expect(sanitizeAccountsConfig(parsed, defaults).seazone).toEqual({ baseUrl: 'https://switcher.example.test', preferredLabels: ['a@x.test', 'b@x.test'] });
  });

  it('sanitize sem preferidas não cria a chave', () => {
    const parsed = { ...defaults, seazone: { baseUrl: 'https://switcher.example.test', preferredLabels: 'a@x.test' } };
    expect(sanitizeAccountsConfig(parsed, defaults).seazone).toEqual({ baseUrl: 'https://switcher.example.test' });
  });

  it('reconectar o switcher mantém as preferidas', () => {
    const config = { ...defaults, seazone: { baseUrl: 'https://old.example.test', preferredLabels: ['a@x.test'] } };
    expect(planConnectSeazonePool(config, ' https://new.example.test ').seazone).toEqual({ baseUrl: 'https://new.example.test', preferredLabels: ['a@x.test'] });
  });
});
