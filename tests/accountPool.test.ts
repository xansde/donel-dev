import { describe, expect, it } from 'vitest';
import { needsEngineRebuild } from '../src/main/accounts/account-pool';
import type { AccountsConfig, LocalAccountMeta } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — decide quando o
// AccountEngine precisa ser RECONSTRUÍDO (o mod concreto só é resolvido no
// construtor, account-engine.ts:75) em vez de só `updateConfig`
// (account-engine.ts:102, que não pega mudança de mod/lista de contas).

function accounts(...entries: readonly LocalAccountMeta[]): readonly LocalAccountMeta[] {
  return entries;
}

function baseConfig(overrides: Partial<AccountsConfig> = {}): AccountsConfig {
  return {
    ...defaultAccountsConfig(),
    mod: 'local',
    localAccounts: accounts({ id: 'a', label: 'Conta A', plan: 'max' }, { id: 'b', label: 'Conta B', plan: 'max' }),
    activeAccountId: 'a',
    ...overrides,
  };
}

describe('needsEngineRebuild — tabela', () => {
  it('mod mudou (local -> seazone) -> true', () => {
    expect(needsEngineRebuild(baseConfig({ mod: 'local' }), baseConfig({ mod: 'seazone' }))).toBe(true);
  });

  it('mod null -> configurado -> true', () => {
    expect(needsEngineRebuild(baseConfig({ mod: null }), baseConfig({ mod: 'local' }))).toBe(true);
  });

  it('seazone.baseUrl mudou -> true', () => {
    const prev = baseConfig({ mod: 'seazone', seazone: { baseUrl: 'https://a.seazone.dev' } });
    const next = baseConfig({ mod: 'seazone', seazone: { baseUrl: 'https://b.seazone.dev' } });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: id mudou numa posição -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({ localAccounts: accounts({ id: 'a', label: 'Conta A', plan: 'max' }, { id: 'c', label: 'Conta B', plan: 'max' }) });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: label mudou -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({ localAccounts: accounts({ id: 'a', label: 'Conta A (renomeada)', plan: 'max' }, { id: 'b', label: 'Conta B', plan: 'max' }) });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: plan mudou -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({ localAccounts: accounts({ id: 'a', label: 'Conta A', plan: 'pro' }, { id: 'b', label: 'Conta B', plan: 'max' }) });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: ordem trocada -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({ localAccounts: accounts({ id: 'b', label: 'Conta B', plan: 'max' }, { id: 'a', label: 'Conta A', plan: 'max' }) });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: tamanho mudou (conta adicionada) -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({
      localAccounts: accounts({ id: 'a', label: 'Conta A', plan: 'max' }, { id: 'b', label: 'Conta B', plan: 'max' }, { id: 'c', label: 'Conta C', plan: null }),
    });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('localAccounts: tamanho mudou (conta removida) -> true', () => {
    const prev = baseConfig();
    const next = baseConfig({ localAccounts: accounts({ id: 'a', label: 'Conta A', plan: 'max' }) });
    expect(needsEngineRebuild(prev, next)).toBe(true);
  });

  it('só autoSwitch mudou -> false', () => {
    const prev = baseConfig({ autoSwitch: { enabled: false, switchAtLoad: 90, minAdvantage: 20 } });
    const next = baseConfig({ autoSwitch: { enabled: true, switchAtLoad: 50, minAdvantage: 10 } });
    expect(needsEngineRebuild(prev, next)).toBe(false);
  });

  it('só claudeHome mudou -> false', () => {
    const prev = baseConfig({ claudeHome: null });
    const next = baseConfig({ claudeHome: 'C:\\fake\\.claude' });
    expect(needsEngineRebuild(prev, next)).toBe(false);
  });

  it('só activeAccountId mudou -> false', () => {
    const prev = baseConfig({ activeAccountId: 'a' });
    const next = baseConfig({ activeAccountId: 'b' });
    expect(needsEngineRebuild(prev, next)).toBe(false);
  });

  it('nada mudou -> false', () => {
    const config = baseConfig();
    expect(needsEngineRebuild(config, config)).toBe(false);
  });
});
