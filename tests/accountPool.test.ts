import { describe, expect, it } from 'vitest';
import { needsEngineRebuild, planDisconnect, planRemoveAccount } from '../src/main/accounts/account-pool';
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

// 011-contas-e-provedores, etapa 3, Fase 1 (bloco "Remover conta") —
// `planRemoveAccount`/`planDisconnect` são PUROS: só calculam a config final
// + as chaves que o cofre deve perder; quem chama (index.ts) aplica a config
// e apaga do cofre.
describe('planRemoveAccount', () => {
  it('remove conta NÃO ativa — tira da lista, preserva a ativa, agenda só a chave dela no cofre', () => {
    const config = baseConfig({ activeAccountId: 'a' });
    const result = planRemoveAccount(config, 'b');
    if (result.kind !== 'remove') throw new Error(`esperava 'remove', veio ${result.kind}`);
    expect(result.config.localAccounts.map((account) => account.id)).toEqual(['a']);
    expect(result.config.activeAccountId).toBe('a');
    expect(result.vaultKeys).toEqual(['b']);
  });

  it('remover a conta ATIVA é bloqueado — o par dela vive no ~/.claude; sem activeAccountId a próxima troca não captura o par rotacionado', () => {
    const config = baseConfig({ activeAccountId: 'a' });
    const result = planRemoveAccount(config, 'a');
    expect(result).toEqual({ kind: 'blocked', reason: 'active-account' });
  });

  it('id desconhecido -> unknown-account', () => {
    const config = baseConfig({ activeAccountId: 'a' });
    const result = planRemoveAccount(config, 'nunca-existiu');
    expect(result).toEqual({ kind: 'unknown-account' });
  });

  it('activeAccountId null -> remover uma conta cadastrada é permitido (nenhuma é a ativa)', () => {
    const config = baseConfig({ activeAccountId: null });
    const result = planRemoveAccount(config, 'a');
    if (result.kind !== 'remove') throw new Error(`esperava 'remove', veio ${result.kind}`);
    expect(result.config.localAccounts.map((account) => account.id)).toEqual(['b']);
    expect(result.config.activeAccountId).toBeNull();
  });
});

describe('planDisconnect', () => {
  it('volta ao default preservando claudeHome, e agenda as chaves das contas locais + seazone:session — nunca provider:*', () => {
    const config = baseConfig({ activeAccountId: 'a', claudeHome: 'C:\\fake\\.claude' });

    const plan = planDisconnect(config);

    expect(plan.config).toEqual({ ...defaultAccountsConfig(), claudeHome: 'C:\\fake\\.claude' });
    expect([...plan.vaultKeys].sort()).toEqual(['a', 'b', 'seazone:session'].sort());
    expect(plan.vaultKeys.some((key) => key.startsWith('provider:'))).toBe(false);
  });

  it('sem contas locais -> agenda só seazone:session', () => {
    const plan = planDisconnect(defaultAccountsConfig());
    expect(plan.vaultKeys).toEqual(['seazone:session']);
    expect(plan.config).toEqual(defaultAccountsConfig());
  });
});
