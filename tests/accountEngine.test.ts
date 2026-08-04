import { describe, expect, it, vi } from 'vitest';
import { AccountEngine } from '../src/main/accounts/account-engine';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../src/main/accounts/account-mod';
import type { AccountsConfig, AccountSummary } from '../src/shared/accounts';
import { defaultAccountsConfig } from '../src/shared/accounts';

// T1119/T1121 (011-contas-e-provedores, etapa 1) — máquina de estados do
// motor (inert/ready/unavailable); switch com motor inerte falha; falha em
// cada passo do switch degrada sem corromper; unavailable pausa o
// auto-switch; escolha do mod por config; adiamento por sessão ocupada (C5).

function account(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    label: id,
    plan: null,
    active: false,
    available: true,
    load: { fiveHour: 0, sevenDay: 0, sonnet: 0, readAt: '2026-08-04T00:00:00.000Z' },
    ...overrides,
  };
}

class FakeMod implements AccountMod {
  readonly id = 'local' as const;
  listAccountsResult: ListAccountsResult = { kind: 'ok', accounts: [account('a'), account('b')] };
  switchResult: SwitchToResult = { kind: 'ok', pair: { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scopes: [] } };
  captureCalls: { id: string; pair: CredentialPair }[] = [];
  keepAliveCalls = 0;
  hasKeepAlive = true;

  async listAccounts(): Promise<ListAccountsResult> {
    return this.listAccountsResult;
  }
  async switchTo(): Promise<SwitchToResult> {
    return this.switchResult;
  }
  async captureRotatedPair(id: string, pair: CredentialPair): Promise<void> {
    this.captureCalls.push({ id, pair });
  }
  keepAlive = this.hasKeepAlive ? async (): Promise<void> => {
    this.keepAliveCalls += 1;
  } : undefined;
}

function makeConfig(overrides: Partial<AccountsConfig> = {}): AccountsConfig {
  return { ...defaultAccountsConfig(), mod: 'local', activeAccountId: 'a', ...overrides };
}

function makeEngine(overrides: {
  mod?: AccountMod | null;
  config?: AccountsConfig;
  applySwitch?: (pair: CredentialPair, onRotatedPairCaptured: (pair: CredentialPair | null) => void | Promise<void>) => Promise<void>;
  isSessionBusy?: () => boolean;
} = {}) {
  const applySwitch = overrides.applySwitch ?? vi.fn(async (_pair, onRotatedPairCaptured) => {
    await onRotatedPairCaptured({ accessToken: 'rotated', refreshToken: 'r', expiresAt: 1, scopes: [] });
  });
  const isSessionBusy = overrides.isSessionBusy ?? (() => false);

  const engine = new AccountEngine({
    config: overrides.config ?? makeConfig(),
    resolveMod: () => (overrides.mod === undefined ? new FakeMod() : (overrides.mod as AccountMod)),
    applySwitch,
    isSessionBusy,
  });
  return { engine, applySwitch, isSessionBusy };
}

describe('AccountEngine — estados', () => {
  it('motor nasce inerte quando config.mod é null', () => {
    const { engine } = makeEngine({ mod: null, config: makeConfig({ mod: null }) });
    expect(engine.getState()).toBe('inert');
  });

  it('motor fica ready após listAccounts() bem-sucedido com mod configurado', async () => {
    const { engine } = makeEngine();
    await engine.listAccounts();
    expect(engine.getState()).toBe('ready');
  });

  it('motor fica unavailable quando o mod devolve unavailable', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'unavailable', reason: 'offline' };
    const { engine } = makeEngine({ mod });
    await engine.listAccounts();
    expect(engine.getState()).toBe('unavailable');
  });
});

describe('AccountEngine — switch com motor inerte', () => {
  it('switch falha com motor inerte (io) — não há caminho implícito de ativação', async () => {
    const { engine } = makeEngine({ mod: null, config: makeConfig({ mod: null }) });
    const result = await engine.switchTo('a');
    expect(result).toEqual({ kind: 'failed', reason: 'io' });
  });
});

describe('AccountEngine — switch bem-sucedido', () => {
  it('já ativa -> already-active, sem tocar o mod', async () => {
    const mod = new FakeMod();
    const { engine, applySwitch } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    const result = await engine.switchTo('a');
    expect(result).toEqual({ kind: 'already-active', account: 'a' });
    expect(applySwitch).not.toHaveBeenCalled();
  });

  it('switch para outra conta chama mod.switchTo, aplica via claude-state e devolve switched', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    const result = await engine.switchTo('b');
    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
  });

  it('captura o par rotacionado da conta que SAI antes de aplicar o novo (via applySwitch)', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    await engine.switchTo('b');
    expect(mod.captureCalls).toHaveLength(1);
    expect(mod.captureCalls[0].id).toBe('a');
  });
});

describe('AccountEngine — falha em cada passo do switch degrada sem corromper', () => {
  it('mod.switchTo falha -> failed, motor não muda de conta ativa', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'failed', reason: 'unauthorized' };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    const result = await engine.switchTo('b');
    expect(result).toEqual({ kind: 'failed', reason: 'unauthorized' });
    expect(engine.getActiveAccountId()).toBe('a');
  });

  it('applySwitch (claude-state) lançando -> failed io, nunca propaga exceção', async () => {
    const mod = new FakeMod();
    const applySwitch = vi.fn(async () => {
      throw new Error('disco cheio');
    });
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), applySwitch });
    const result = await engine.switchTo('b');
    expect(result).toEqual({ kind: 'failed', reason: 'io' });
    expect(engine.getActiveAccountId()).toBe('a'); // não corrompe o estado anterior
  });
});

describe('AccountEngine — unavailable pausa o auto-switch', () => {
  it('evaluateAutoSwitch não dispara quando o motor está unavailable', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'unavailable', reason: 'offline' };
    const { engine } = makeEngine({ mod, config: makeConfig({ autoSwitch: { enabled: true, switchAtLoad: 0, minAdvantage: 0 } }) });
    await engine.listAccounts();
    const result = await engine.evaluateAutoSwitch();
    expect(result).toBeNull();
  });
});

describe('AccountEngine — C5, adiamento por sessão ocupada', () => {
  it('auto-switch devolve deferred/session-busy enquanto há sessão trabalhando', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      isSessionBusy: () => true,
    });
    await engine.listAccounts();
    const result = await engine.evaluateAutoSwitch();
    expect(result).toEqual({ kind: 'deferred', reason: 'session-busy' });
  });

  it('switch MANUAL não é adiado mesmo com sessão ocupada', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), isSessionBusy: () => true });
    const result = await engine.switchTo('b');
    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
  });

  it('sem sessão ocupada, auto-switch dispara o switch de verdade', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      isSessionBusy: () => false,
    });
    await engine.listAccounts();
    const result = await engine.evaluateAutoSwitch();
    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
  });
});

describe('AccountEngine — escolha do mod por config', () => {
  it('resolveMod é chamado com o modId da config quando não-null', () => {
    const resolveMod = vi.fn(() => new FakeMod());
    new AccountEngine({
      config: makeConfig({ mod: 'seazone' }),
      resolveMod,
      applySwitch: vi.fn(),
      isSessionBusy: () => false,
    });
    expect(resolveMod).toHaveBeenCalledWith('seazone');
  });

  it('resolveMod não é chamado quando config.mod é null (motor inerte)', () => {
    const resolveMod = vi.fn(() => new FakeMod());
    new AccountEngine({ config: makeConfig({ mod: null }), resolveMod, applySwitch: vi.fn(), isSessionBusy: () => false });
    expect(resolveMod).not.toHaveBeenCalled();
  });
});

describe('AccountEngine — accounts:changed', () => {
  it('emite ao mudar de conta ativa', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    const listener = vi.fn();
    engine.onChanged(listener);
    await engine.switchTo('b');
    expect(listener).toHaveBeenCalled();
  });
});
