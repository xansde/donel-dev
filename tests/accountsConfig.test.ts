import { describe, expect, it } from 'vitest';
import { defaultAccountsConfig } from '../src/shared/accounts';
import { sanitizeAccountsConfig } from '../src/main/accounts/accounts-config';

// T1102 (011-contas-e-provedores, etapa 1) — `sanitizeAccountsConfig` precisa
// ser resiliente no mesmo espírito de `sanitizeAppConfig` (config-store.ts):
// nunca lança, campo a campo cai no default quando ausente/corrompido/tipo
// errado. Defaults fixados pelo tasks.md: switchAtLoad 90, minAdvantage 20,
// autoSwitch.enabled true.

describe('sanitizeAccountsConfig (puro)', () => {
  const defaults = defaultAccountsConfig();

  it('chave ausente cai nos defaults', () => {
    expect(sanitizeAccountsConfig(undefined, defaults)).toEqual(defaults);
    expect(sanitizeAccountsConfig(null, defaults)).toEqual(defaults);
  });

  it('JSON corrompido (não-objeto) cai nos defaults', () => {
    expect(sanitizeAccountsConfig('not-an-object', defaults)).toEqual(defaults);
    expect(sanitizeAccountsConfig(42, defaults)).toEqual(defaults);
    expect(sanitizeAccountsConfig([1, 2, 3], defaults)).toEqual(defaults);
  });

  it('mod desconhecido cai em null (motor inerte)', () => {
    const result = sanitizeAccountsConfig({ mod: 'openrouter' }, defaults);
    expect(result.mod).toBeNull();
  });

  it('mod válido é preservado', () => {
    expect(sanitizeAccountsConfig({ mod: 'seazone' }, defaults).mod).toBe('seazone');
    expect(sanitizeAccountsConfig({ mod: 'local' }, defaults).mod).toBe('local');
  });

  it('limiares fora de 0-100 caem no default', () => {
    const result = sanitizeAccountsConfig({ autoSwitch: { enabled: true, switchAtLoad: 150, minAdvantage: -5 } }, defaults);
    expect(result.autoSwitch.switchAtLoad).toBe(90);
    expect(result.autoSwitch.minAdvantage).toBe(20);
  });

  it('defaults de autoSwitch: 90/20/enabled true', () => {
    const result = sanitizeAccountsConfig({}, defaults);
    expect(result.autoSwitch).toEqual({ enabled: true, switchAtLoad: 90, minAdvantage: 20 });
  });

  it('autoSwitch.enabled tipo errado cai no default (true)', () => {
    const result = sanitizeAccountsConfig({ autoSwitch: { enabled: 'yes', switchAtLoad: 90, minAdvantage: 20 } }, defaults);
    expect(result.autoSwitch.enabled).toBe(true);
  });

  it('tipos errados em campos simples caem no default', () => {
    const result = sanitizeAccountsConfig({ claudeHome: 42, activeAccountId: {}, seazone: 'nope' }, defaults);
    expect(result.claudeHome).toBeNull();
    expect(result.activeAccountId).toBeNull();
    expect(result.seazone).toBeNull();
  });

  it('claudeHome string válida é preservada', () => {
    expect(sanitizeAccountsConfig({ claudeHome: 'C:\\custom\\.claude' }, defaults).claudeHome).toBe('C:\\custom\\.claude');
  });

  it('seazone.baseUrl válido é preservado', () => {
    const result = sanitizeAccountsConfig({ seazone: { baseUrl: 'https://switcher.seazone.dev' } }, defaults);
    expect(result.seazone).toEqual({ baseUrl: 'https://switcher.seazone.dev' });
  });

  it('localAccounts malformado descarta a entrada isolada, preserva as boas', () => {
    const result = sanitizeAccountsConfig(
      {
        localAccounts: [
          { id: 'acc-1', label: 'Conta 1', plan: 'pro' },
          { id: '', label: 'sem id', plan: null },
          { id: 'acc-2' }, // sem label
          'not-an-object',
        ],
      },
      defaults,
    );
    expect(result.localAccounts).toEqual([{ id: 'acc-1', label: 'Conta 1', plan: 'pro' }]);
  });

  it('nunca lança para qualquer entrada maluca', () => {
    expect(() => sanitizeAccountsConfig({ mod: {}, autoSwitch: null, localAccounts: null }, defaults)).not.toThrow();
  });
});
