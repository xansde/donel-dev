import { describe, expect, it, vi } from 'vitest';
import { AccountEngine } from '../src/main/accounts/account-engine';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../src/main/accounts/account-mod';
import { createReconnectRegistry, type ReconnectRegistry } from '../src/main/accounts/reconnect-registry';
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
  switchToCalls = 0;
  // 011-contas-e-provedores, etapa 3, Fase 2 (revisão, R3) — promessas
  // controladas pelo teste pra segurar `listAccounts`/`switchTo`/
  // `captureRotatedPair` em voo enquanto o teste chama `engine.dispose()`.
  // `null` (default) = resolve na hora, como sempre foi.
  listAccountsGate: Promise<void> | null = null;
  switchToGate: Promise<void> | null = null;
  captureGate: Promise<void> | null = null;
  /** Avisa o teste, de forma síncrona, que a execução ENTROU em `captureRotatedPair` — antes de pendurar no `captureGate`. Evita contar microtasks na mão. */
  onCaptureRotatedPairCalled: (() => void) | null = null;

  async listAccounts(): Promise<ListAccountsResult> {
    if (this.listAccountsGate) await this.listAccountsGate;
    return this.listAccountsResult;
  }
  async switchTo(): Promise<SwitchToResult> {
    this.switchToCalls += 1;
    if (this.switchToGate) await this.switchToGate;
    return this.switchResult;
  }
  async captureRotatedPair(id: string, pair: CredentialPair): Promise<void> {
    this.onCaptureRotatedPairCalled?.();
    if (this.captureGate) await this.captureGate;
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
  now?: () => number;
  reconnectRegistry?: ReconnectRegistry;
  onAutoSwitchLogged?: (entry: {
    outcome: 'switched' | 'failed';
    from: string | null;
    to: string;
    activeLoad: number | null;
    targetLoad: number | null;
    sessionBusy: boolean;
  }) => void;
  readCurrentPair?: () => CredentialPair | null;
  readCurrentAccountFingerprint?: () => string | null;
  onSwitchOverwritten?: (info: { to: string }) => void;
  onSwitchPairRotated?: (info: { to: string }) => void;
  onSwitchCheckInconclusive?: (info: { to: string }) => void;
  raceCheckDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
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
    now: overrides.now,
    reconnectRegistry: overrides.reconnectRegistry,
    onAutoSwitchLogged: overrides.onAutoSwitchLogged,
    readCurrentPair: overrides.readCurrentPair,
    readCurrentAccountFingerprint: overrides.readCurrentAccountFingerprint,
    onSwitchOverwritten: overrides.onSwitchOverwritten,
    onSwitchPairRotated: overrides.onSwitchPairRotated,
    onSwitchCheckInconclusive: overrides.onSwitchCheckInconclusive,
    raceCheckDelayMs: overrides.raceCheckDelayMs,
    setTimeoutFn: overrides.setTimeoutFn,
    clearTimeoutFn: overrides.clearTimeoutFn,
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

// Emenda 22/09 — o adiamento por sessão ocupada (C5) foi REMOVIDO: o
// auto-switch troca na hora, mesmo com sessão `working`. `isSessionBusy`
// segue injetado só para anotar `sessionBusy` no log (ver describe abaixo,
// "onAutoSwitchLogged").
describe('AccountEngine — emenda 22/09, auto-switch não adia mais por sessão ocupada', () => {
  it('auto-switch troca na hora mesmo com sessão trabalhando', async () => {
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
    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
  });

  it('switch MANUAL também nunca foi adiado (comportamento preservado)', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), isSessionBusy: () => true });
    const result = await engine.switchTo('b');
    expect(result).toEqual({ kind: 'switched', from: 'a', to: 'b' });
  });

  it('sem sessão ocupada, auto-switch dispara o switch de verdade (caso comum, sem regressão)', async () => {
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

  it('AccountEngine não expõe mais retryDeferredAutoSwitch (removido junto com o adiamento)', async () => {
    const { engine } = makeEngine();
    expect((engine as unknown as Record<string, unknown>).retryDeferredAutoSwitch).toBeUndefined();
  });
});

describe('AccountEngine — emenda 22/09 (item 2), onAutoSwitchLogged', () => {
  it('switch bem-sucedido registra outcome switched com from/to/cargas/sessionBusy', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const onAutoSwitchLogged = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      isSessionBusy: () => true,
      onAutoSwitchLogged,
    });
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();

    expect(onAutoSwitchLogged).toHaveBeenCalledWith({
      outcome: 'switched',
      from: 'a',
      to: 'b',
      activeLoad: 95,
      targetLoad: 10,
      sessionBusy: true,
    });
  });

  it('switch que falha registra outcome failed', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    mod.switchResult = { kind: 'failed', reason: 'offline' };
    const onAutoSwitchLogged = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      isSessionBusy: () => false,
      onAutoSwitchLogged,
    });
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();

    expect(onAutoSwitchLogged).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', from: 'a', to: 'b', sessionBusy: false }),
    );
  });

  it('sem alvo elegível, nunca chama onAutoSwitchLogged (não houve decisão)', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'ok', accounts: [account('a', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b')] };
    const onAutoSwitchLogged = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      onAutoSwitchLogged,
    });
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();

    expect(onAutoSwitchLogged).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 2 — D3 (needsReconnect/Reconectar) +
// D5 (autoSwitchState/lastAutoSwitch). fase2-design.md §Bloco 1.
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_700_000_000_000;
const FIXED_ISO = new Date(FIXED_NOW).toISOString();

describe('AccountEngine — D3, marca needsReconnect', () => {
  it('switch falhando com expired-credentials marca a conta, e a marca aparece na view', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    await engine.listAccounts();

    mod.switchResult = { kind: 'failed', reason: 'expired-credentials' };
    const result = await engine.switchTo('b');

    expect(result).toEqual({ kind: 'failed', reason: 'expired-credentials' });
    const view = engine.getSnapshot();
    expect(view.accounts.find((a) => a.id === 'b')?.needsReconnect).toBe(true);
    // A conta que NÃO falhou nunca ganha a chave (ausente, não `false` — os
    // testes de FakeMod comparam objetos com toEqual em outros arquivos).
    expect(view.accounts.find((a) => a.id === 'a')).not.toHaveProperty('needsReconnect');
  });

  it('troca bem-sucedida para uma conta marcada limpa a marca', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    await engine.listAccounts();

    mod.switchResult = { kind: 'failed', reason: 'expired-credentials' };
    await engine.switchTo('b');
    expect(engine.getSnapshot().accounts.find((a) => a.id === 'b')?.needsReconnect).toBe(true);

    mod.switchResult = { kind: 'ok', pair: { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scopes: [] } };
    await engine.switchTo('b');
    expect(engine.getSnapshot().accounts.find((a) => a.id === 'b')?.needsReconnect).toBeUndefined();
  });

  it('conta marcada needsReconnect nunca é alvo do auto-switch', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();

    mod.switchResult = { kind: 'failed', reason: 'expired-credentials' };
    await engine.switchTo('b'); // marca 'b' (única candidata)

    mod.switchResult = { kind: 'ok', pair: { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scopes: [] } };
    const result = await engine.evaluateAutoSwitch();
    expect(result).toBeNull();
  });

  it('reconnectRegistry injetado sobrevive a um motor novo (mesma instância entre dois AccountEngine)', async () => {
    const registry = createReconnectRegistry();
    const mod1 = new FakeMod();
    mod1.switchResult = { kind: 'failed', reason: 'expired-credentials' };
    const { engine: engine1 } = makeEngine({ mod: mod1, config: makeConfig({ activeAccountId: 'a' }), reconnectRegistry: registry });
    await engine1.listAccounts();
    await engine1.switchTo('b');
    expect(registry.has('b')).toBe(true);

    const mod2 = new FakeMod();
    const { engine: engine2 } = makeEngine({ mod: mod2, config: makeConfig({ activeAccountId: 'a' }), reconnectRegistry: registry });
    await engine2.listAccounts();
    expect(engine2.getSnapshot().accounts.find((a) => a.id === 'b')?.needsReconnect).toBe(true);
  });
});

describe('AccountEngine — D5, lastAutoSwitch', () => {
  it('evaluateAutoSwitch bem-sucedido registra lastAutoSwitch switched', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      now: () => FIXED_NOW,
    });
    await engine.listAccounts();
    await engine.evaluateAutoSwitch();

    expect(engine.getSnapshot().lastAutoSwitch).toEqual({ kind: 'switched', from: 'a', to: 'b', at: FIXED_ISO });
  });

  it('evaluateAutoSwitch cuja troca falha registra lastAutoSwitch failed', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    mod.switchResult = { kind: 'failed', reason: 'offline' };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
      now: () => FIXED_NOW,
    });
    await engine.listAccounts();
    const result = await engine.evaluateAutoSwitch();

    expect(result).toEqual({ kind: 'failed', reason: 'offline' });
    expect(engine.getSnapshot().lastAutoSwitch).toEqual({ kind: 'failed', to: 'b', reason: 'offline', at: FIXED_ISO });
  });

  it('evaluateAutoSwitch sem alvo elegível devolve null sem tocar lastAutoSwitch', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'ok', accounts: [account('a', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b')] };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
    });
    await engine.listAccounts();
    const result = await engine.evaluateAutoSwitch();

    expect(result).toBeNull();
    expect(engine.getSnapshot().lastAutoSwitch).toBeNull();
  });
});

describe('AccountEngine — autoSwitchState na view', () => {
  it('off quando autoSwitch.enabled é false', async () => {
    const mod = new FakeMod();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: false, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getSnapshot().autoSwitchState).toBe('off');
  });

  it('idle quando a ativa está abaixo do limiar', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'ok', accounts: [account('a', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b')] };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getSnapshot().autoSwitchState).toBe('idle');
  });

  it('armed quando a ativa está no limiar e existe candidata elegível', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getSnapshot().autoSwitchState).toBe('armed');
  });

  it('saturated quando a ativa está no limiar e nenhuma candidata tem folga', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 85, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getSnapshot().autoSwitchState).toBe('saturated');
  });

  it('motor unavailable -> idle mesmo com carga alta', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'unavailable', reason: 'offline' };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getState()).toBe('unavailable');
    expect(engine.getSnapshot().autoSwitchState).toBe('idle');
  });

  // D8 (adendo) — pelo menos uma outra conta disponível/sem needsReconnect
  // com carga desconhecida vira `blind`, não `saturated` (falta DADO, não folga).
  it('blind quando existe outra conta disponível sem leitura de carga', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [
        account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }),
        account('b', { load: { fiveHour: 85, sevenDay: 0, sonnet: 0, readAt: 'x' } }),
        account('c', { load: null }),
      ],
    };
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }) });
    await engine.listAccounts();
    expect(engine.getSnapshot().autoSwitchState).toBe('blind');
  });
});

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 2 (revisão) — R3: motor descartado
// (dispose(), tipicamente por reconstrução do host — F6) não termina de
// trocar de conta nem emite pros ouvintes, mesmo com uma leitura/troca já em
// voo quando dispose() foi chamado. fase2-review-fixes.md §Agente Y.
// ---------------------------------------------------------------------------

describe('AccountEngine — R3 (revisão), motor descartado não troca de conta', () => {
  it('switchTo manual chamado depois de dispose() falha na entrada (io), sem tocar o mod', async () => {
    const mod = new FakeMod();
    const { engine, applySwitch } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    engine.dispose();

    const result = await engine.switchTo('b');

    expect(result).toEqual({ kind: 'failed', reason: 'io' });
    expect(mod.switchToCalls).toBe(0);
    expect(applySwitch).not.toHaveBeenCalled();
    expect(engine.getActiveAccountId()).toBe('a');
  });

  it('dispose() durante um mod.switchTo pendente -> failed/io, applySwitch nunca chamado, conta ativa inalterada', async () => {
    const mod = new FakeMod();
    let resolveSwitchGate!: () => void;
    mod.switchToGate = new Promise<void>((resolve) => {
      resolveSwitchGate = resolve;
    });
    const { engine, applySwitch } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });

    const switchPromise = engine.switchTo('b');
    engine.dispose(); // síncrono — antes de mod.switchTo() resolver.
    resolveSwitchGate();

    const result = await switchPromise;

    expect(result).toEqual({ kind: 'failed', reason: 'io' });
    expect(applySwitch).not.toHaveBeenCalled();
    expect(engine.getActiveAccountId()).toBe('a');
  });

  it('dispose() durante a captura do par rotacionado (callback do applySwitch) -> applySwitch rejeita, failed/io', async () => {
    const mod = new FakeMod();
    let resolveCaptureGate!: () => void;
    mod.captureGate = new Promise<void>((resolve) => {
      resolveCaptureGate = resolve;
    });
    let captureCalledResolve!: () => void;
    const captureCalledPromise = new Promise<void>((resolve) => {
      captureCalledResolve = resolve;
    });
    mod.onCaptureRotatedPairCalled = () => captureCalledResolve();

    const applySwitch = vi.fn(async (_pair: CredentialPair, onRotatedPairCaptured: (pair: CredentialPair | null) => void | Promise<void>) => {
      await onRotatedPairCaptured({ accessToken: 'rotated', refreshToken: 'r', expiresAt: 1, scopes: [] });
    });
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), applySwitch });

    const switchPromise = engine.switchTo('b');
    await captureCalledPromise; // execução parada dentro de captureRotatedPair, pendurada no captureGate.
    engine.dispose();
    resolveCaptureGate();

    const result = await switchPromise;

    expect(result).toEqual({ kind: 'failed', reason: 'io' });
    await expect(applySwitch.mock.results[0]?.value as Promise<void>).rejects.toThrow('account engine disposed during rotated pair capture');
    expect(engine.getActiveAccountId()).toBe('a');
  });

  it('evaluateAutoSwitch depois de dispose() devolve null sem chamar o mod', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = {
      kind: 'ok',
      accounts: [account('a', { load: { fiveHour: 95, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } })],
    };
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a', autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 } }),
    });
    await engine.listAccounts();
    engine.dispose();
    const switchCallsBefore = mod.switchToCalls;

    const result = await engine.evaluateAutoSwitch();

    expect(result).toBeNull();
    expect(mod.switchToCalls).toBe(switchCallsBefore);
  });

  it('dispose() cancela a checagem de corrida agendada — readCurrentPair nunca é chamado depois', async () => {
    const mod = new FakeMod();
    const readCurrentPair = vi.fn(() => null);
    const scheduled: Array<() => void> = [];
    const setTimeoutFn = vi.fn((fn: () => void) => {
      scheduled.push(fn);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), readCurrentPair, setTimeoutFn, clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout });

    await engine.switchTo('b');
    expect(setTimeoutFn).toHaveBeenCalled();

    engine.dispose();
    expect(clearTimeoutFn).toHaveBeenCalled();

    // Mesmo se o timer (fake, nunca de verdade cancelado pelo ambiente de
    // teste) disparasse depois, `performRaceCheck` tem que respeitar `disposed`.
    scheduled[0]?.();
    expect(readCurrentPair).not.toHaveBeenCalled();
  });

  it('listAccounts que termina depois de dispose() não chama os ouvintes de onChanged', async () => {
    const mod = new FakeMod();
    let resolveListGate!: () => void;
    mod.listAccountsGate = new Promise<void>((resolve) => {
      resolveListGate = resolve;
    });
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }) });
    const listener = vi.fn();
    engine.onChanged(listener);

    const listPromise = engine.listAccounts();
    engine.dispose(); // síncrono — antes de mod.listAccounts() resolver.
    resolveListGate();
    await listPromise;

    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Emenda 22/09 (item 3) — poll adaptativo: 1 min perto do limite (carga da
// ativa >= HIGH_LOAD_POLL_THRESHOLD), 5 min caso contrário.
// ---------------------------------------------------------------------------

describe('AccountEngine — emenda 22/09 (item 3), poll adaptativo', () => {
  it('agenda o próximo tick com o intervalo normal (5 min) quando ainda não há leitura de carga', () => {
    const mod = new FakeMod();
    const setTimeoutFn = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), setTimeoutFn });

    engine.startPolling(() => false);

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
  });

  it('agenda o próximo tick com o intervalo agressivo (1 min) quando a ativa já leu carga >= 80', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'ok', accounts: [account('a', { load: { fiveHour: 85, sevenDay: 0, sonnet: 0, readAt: 'x' } })] };
    const setTimeoutFn = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), setTimeoutFn });
    await engine.listAccounts();

    engine.startPolling(() => false);

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
  });

  it('cada tick relê e reavalia SÓ com sessão viva, e reagenda o próximo tick', async () => {
    const mod = new FakeMod();
    mod.listAccountsResult = { kind: 'ok', accounts: [account('a', { load: { fiveHour: 10, sevenDay: 0, sonnet: 0, readAt: 'x' } }), account('b')] };
    const scheduled: Array<() => void> = [];
    const setTimeoutFn = vi.fn((fn: () => void) => {
      scheduled.push(fn);
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), setTimeoutFn });

    let hasLiveSession = false;
    engine.startPolling(() => hasLiveSession);
    expect(scheduled).toHaveLength(1);

    hasLiveSession = true;
    await scheduled[0]();

    expect(engine.getSnapshot().lastReadAt).not.toBeNull(); // listAccounts rodou.
    expect(scheduled).toHaveLength(2); // reagendou o próximo tick.
  });

  it('dispose() para o loop de reagendamento — nenhum novo tick depois dele', () => {
    const mod = new FakeMod();
    const scheduled: Array<() => void> = [];
    const setTimeoutFn = vi.fn((fn: () => void) => {
      scheduled.push(fn);
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), setTimeoutFn });

    engine.startPolling(() => false);
    expect(scheduled).toHaveLength(1);

    engine.dispose();
    // Se o tick agendado ainda disparasse (timer real, não cancelado pelo
    // fake), `scheduleNext` tem que respeitar `disposed` e não reagendar.
    void scheduled[0]();
    expect(scheduled).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Emenda 22/09 (item 5) — checagem de corrida pós-switch: ~30-60s depois de
// um switch bem-sucedido, confere se `~/.claude/.credentials.json` ainda é o
// par que ESTE switch escreveu (comparado por `refreshToken`).
// ---------------------------------------------------------------------------

// Emenda 22/09 (REVISÃO, item 5) — a primeira versão comparava só
// `refreshToken` e reaplicava a troca ao divergir: falso positivo perigoso,
// porque o CLI rotaciona o refresh token da PRÓPRIA conta legitimamente (ex.:
// access token vencido renovado na primeira mensagem). A versão corrigida:
// (1) nunca reaplica — só observa; (2) token divergente sozinho não basta,
// desempata por IDENTIDADE (`readCurrentAccountFingerprint`, comparado com o
// fingerprint conhecido da conta-alvo em `config.localAccounts`).
describe('AccountEngine — emenda 22/09 (revisão, item 5), checagem de corrida pós-switch', () => {
  function scheduleCapture() {
    const scheduled: Array<() => void> = [];
    const setTimeoutFn = vi.fn((fn: () => void) => {
      scheduled.push(fn);
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    return { scheduled, setTimeoutFn };
  }

  const writtenPair: CredentialPair = { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scopes: [] };
  const targetAccountWithFingerprint = (fingerprint: string) => makeConfig({
    activeAccountId: 'a',
    localAccounts: [{ id: 'b', label: 'b', plan: null, fingerprint }],
  });

  it('sem readCurrentPair, nenhuma checagem é agendada', async () => {
    const mod = new FakeMod();
    const { setTimeoutFn } = scheduleCapture();
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), setTimeoutFn });

    await engine.switchTo('b');

    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('par no disco ainda bate com o escrito — sem corrida, sem leitura de identidade', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const readCurrentAccountFingerprint = vi.fn(() => 'nao-deveria-ser-chamado');
    const { engine } = makeEngine({ mod, config: makeConfig({ activeAccountId: 'a' }), readCurrentPair: () => writtenPair, readCurrentAccountFingerprint, setTimeoutFn });

    await engine.switchTo('b');
    await scheduled[0]?.();

    expect(engine.getSnapshot().lastSwitchOverwritten).toBeNull();
    expect(readCurrentAccountFingerprint).not.toHaveBeenCalled(); // token bateu — nem lê identidade.
  });

  it('token divergiu mas a identidade é da PRÓPRIA conta-alvo — rotação legítima, sem aviso (onSwitchPairRotated)', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const onSwitchOverwritten = vi.fn();
    const onSwitchPairRotated = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: targetAccountWithFingerprint('fingerprint-b'),
      // token renovado pelo CLI (refreshToken novo), mas a IDENTIDADE ainda é a da conta-alvo.
      readCurrentPair: () => ({ accessToken: 'novo', refreshToken: 'novo-refresh', expiresAt: 2, scopes: [] }),
      readCurrentAccountFingerprint: () => 'fingerprint-b',
      onSwitchOverwritten,
      onSwitchPairRotated,
      setTimeoutFn,
    });

    await engine.switchTo('b');
    await scheduled[0]?.();

    expect(onSwitchPairRotated).toHaveBeenCalledWith({ to: 'b' });
    expect(onSwitchOverwritten).not.toHaveBeenCalled();
    expect(engine.getSnapshot().lastSwitchOverwritten).toBeNull();
    expect(mod.switchToCalls).toBe(1); // nunca reaplica.
  });

  it('token divergiu e a identidade é de OUTRA conta — corrida confirmada, avisa', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const onSwitchOverwritten = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: targetAccountWithFingerprint('fingerprint-b'),
      readCurrentPair: () => ({ accessToken: 'outro', refreshToken: 'outro-refresh', expiresAt: 2, scopes: [] }),
      readCurrentAccountFingerprint: () => 'fingerprint-de-outra-conta',
      onSwitchOverwritten,
      setTimeoutFn,
      now: () => FIXED_NOW,
    });

    await engine.switchTo('b');
    await scheduled[0]?.();

    expect(onSwitchOverwritten).toHaveBeenCalledWith({ to: 'b' });
    expect(engine.getSnapshot().lastSwitchOverwritten).toEqual({ to: 'b', at: FIXED_ISO });
    expect(mod.switchToCalls).toBe(1); // nunca reaplica.
  });

  it('token divergiu mas a identidade não pôde ser lida (oauthAccount ainda ausente) — inconclusivo, sem aviso', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const onSwitchOverwritten = vi.fn();
    const onSwitchCheckInconclusive = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: targetAccountWithFingerprint('fingerprint-b'),
      readCurrentPair: () => ({ accessToken: 'outro', refreshToken: 'outro-refresh', expiresAt: 2, scopes: [] }),
      readCurrentAccountFingerprint: () => null, // .claude.json ainda sem oauthAccount, ou ilegível.
      onSwitchOverwritten,
      onSwitchCheckInconclusive,
      setTimeoutFn,
    });

    await engine.switchTo('b');
    await scheduled[0]?.();

    expect(onSwitchCheckInconclusive).toHaveBeenCalledWith({ to: 'b' });
    expect(onSwitchOverwritten).not.toHaveBeenCalled();
    expect(engine.getSnapshot().lastSwitchOverwritten).toBeNull();
  });

  it('token divergiu mas a conta-alvo não tem fingerprint conhecido — inconclusivo, mesmo com identidade legível', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const onSwitchOverwritten = vi.fn();
    const onSwitchCheckInconclusive = vi.fn();
    const { engine } = makeEngine({
      mod,
      config: makeConfig({ activeAccountId: 'a' }), // localAccounts vazio — 'b' sem fingerprint.
      readCurrentPair: () => ({ accessToken: 'outro', refreshToken: 'outro-refresh', expiresAt: 2, scopes: [] }),
      readCurrentAccountFingerprint: () => 'qualquer-fingerprint-legivel',
      onSwitchOverwritten,
      onSwitchCheckInconclusive,
      setTimeoutFn,
    });

    await engine.switchTo('b');
    await scheduled[0]?.();

    expect(onSwitchCheckInconclusive).toHaveBeenCalledWith({ to: 'b' });
    expect(onSwitchOverwritten).not.toHaveBeenCalled();
  });

  it('nunca agenda uma segunda checagem — a corrida é observada uma vez só', async () => {
    const mod = new FakeMod();
    mod.switchResult = { kind: 'ok', pair: writtenPair };
    const { scheduled, setTimeoutFn } = scheduleCapture();
    const { engine } = makeEngine({
      mod,
      config: targetAccountWithFingerprint('fingerprint-b'),
      readCurrentPair: () => ({ accessToken: 'outro', refreshToken: 'outro-refresh', expiresAt: 2, scopes: [] }),
      readCurrentAccountFingerprint: () => 'fingerprint-de-outra-conta',
      setTimeoutFn,
    });

    await engine.switchTo('b');
    expect(scheduled).toHaveLength(1);

    await scheduled[0]?.();

    expect(scheduled).toHaveLength(1); // nenhum novo agendamento depois da checagem.
    expect(mod.switchToCalls).toBe(1);
  });
});
