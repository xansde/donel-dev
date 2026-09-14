import { describe, expect, it } from 'vitest';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createReconnectRegistry } from '../src/main/accounts/reconnect-registry';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import type { VaultLike, VaultWriteResult } from '../src/main/accounts/vault';
import type { HttpFetchLike, HttpResponseLike } from '../src/main/accounts/usage-client';
import type { RefreshResult } from '../src/main/accounts/token-refresh';
import type { AccountId, LocalAccountMeta } from '../src/shared/accounts';

// 011-contas-e-provedores, etapa 3, Fase 2 (D7/D9, adendo ao desenho) —
// bateria dedicada ao mod local sobre os dois furos do achado pós-desenho:
// (D7) a conta ATIVA lê a carga do par VIVO (`<claudeHome>/.credentials.json`),
// nunca renova pelo cofre; (D9) a leitura de carga de uma conta PARADA renova
// o par vencido dela com o MESMO protocolo do switch (grava no cofre ANTES de
// usar; no máx. uma renovação em voo por conta — refresh token de uso único).
// Mesmos padrões de tests/accountModContract.test.ts: cofre em memória, HTTP
// falso e refreshImpl injetado.

class FakeVault implements VaultLike {
  private readonly entries = new Map<string, string>();
  readonly writeCalls: string[] = [];
  readonly failWriteFor = new Set<string>();
  /** Hook opcional pra rastrear ORDEM entre escrita no cofre e outras chamadas (ex.: leitura de usage). */
  onWrite: ((id: string) => void) | null = null;

  read(id: string): string | null {
    return this.entries.get(id) ?? null;
  }
  write(id: string, plainText: string): VaultWriteResult {
    this.writeCalls.push(id);
    this.onWrite?.(id);
    if (this.failWriteFor.has(id)) return { kind: 'vault-unavailable' };
    this.entries.set(id, plainText);
    return { kind: 'ok' };
  }
}

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, json: async () => body };
}

function buildPair(overrides: Partial<CredentialPair> = {}): CredentialPair {
  return { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000, scopes: [], ...overrides };
}

function accountOf(id: AccountId, label = `Conta ${id}`): LocalAccountMeta {
  return { id, label, plan: null };
}

/** Fetch falso pro endpoint de usage — registra o access token usado (via header Authorization) em `calls`, na ordem das chamadas. */
function makeUsageFetch(calls: string[], usage: { fiveHour: number; sevenDay: number } = { fiveHour: 1, sevenDay: 2 }): HttpFetchLike {
  return async (_url, init) => {
    const auth = init?.headers?.Authorization ?? '';
    calls.push(auth.replace('Bearer ', ''));
    return jsonResponse(200, { five_hour: { utilization: usage.fiveHour }, seven_day: { utilization: usage.sevenDay } });
  };
}

/** Fetch falso que registra a ORDEM entre chamadas de usage e outras marcações (ex.: escrita no cofre via vault.onWrite). */
function makeOrderedUsageFetch(order: string[], usage: { fiveHour: number; sevenDay: number }): HttpFetchLike {
  return async (_url, init) => {
    const auth = (init?.headers?.Authorization ?? '').replace('Bearer ', '');
    order.push(`usage:${auth}`);
    return jsonResponse(200, { five_hour: { utilization: usage.fiveHour }, seven_day: { utilization: usage.sevenDay } });
  };
}

function makeRefreshImpl(
  outcome: RefreshResult | (() => RefreshResult),
  calls: string[] = [],
): (refreshToken: string) => Promise<RefreshResult> {
  return async (refreshToken: string) => {
    calls.push(refreshToken);
    return typeof outcome === 'function' ? outcome() : outcome;
  };
}

describe('local-mod — D7: a carga da ativa sai do token vivo', () => {
  it('conta ATIVA com par vivo legível usa o token VIVO (nunca o do cofre)', async () => {
    const vault = new FakeVault();
    vault.write('acc-active', JSON.stringify(buildPair({ accessToken: 'cofre-token' })));
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-active')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token' }),
    });

    const result = await mod.listAccounts();
    expect(result.kind).toBe('ok');
    expect(usageCalls).toEqual(['live-token']);
  });

  it('conta ATIVA sem par vivo legível cai no par do cofre (comportamento de hoje)', async () => {
    const vault = new FakeVault();
    vault.write('acc-active', JSON.stringify(buildPair({ accessToken: 'cofre-token' })));
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-active')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => null,
    });

    await mod.listAccounts();
    expect(usageCalls).toEqual(['cofre-token']);
  });

  it('conta NÃO ativa nunca usa o par vivo, mesmo que readLiveCredentialPair devolva algo', async () => {
    const vault = new FakeVault();
    vault.write('acc-active', JSON.stringify(buildPair({ accessToken: 'cofre-ativa' })));
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'cofre-parada' })));
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-active'), accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token' }),
    });

    await mod.listAccounts();
    expect(usageCalls).toContain('live-token'); // a ativa usou o vivo
    expect(usageCalls).toContain('cofre-parada'); // a parada usou o PRÓPRIO token do cofre
    expect(usageCalls).not.toContain('cofre-ativa'); // a ativa tinha vivo — não caiu no cofre
    expect(usageCalls.filter((token) => token === 'live-token')).toHaveLength(1); // vivo usado só uma vez (só a ativa)
  });

  it('ativa nunca renova pelo cofre mesmo com o par do cofre vencido — usa o par vivo', async () => {
    const vault = new FakeVault();
    vault.write('acc-active', JSON.stringify(buildPair({ accessToken: 'cofre-vencido', expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-active')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'nunca-deveria-usar' }) }, refreshCalls),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token' }),
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    expect(usageCalls).toEqual(['live-token']);
  });

  it('ativa sem par vivo usa o cofre SEM renovar, mesmo vencido', async () => {
    const vault = new FakeVault();
    vault.write('acc-active', JSON.stringify(buildPair({ accessToken: 'cofre-vencido', expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-active')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'nunca-deveria-usar' }) }, refreshCalls),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => null,
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    expect(usageCalls).toEqual(['cofre-vencido']);
  });

  it('available da ativa continua dizendo se HÁ par no cofre, independente do par vivo', async () => {
    const vault = new FakeVault(); // sem par nenhum gravado
    const mod = createLocalMod({
      accounts: [accountOf('acc-active')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      getActiveAccountId: () => 'acc-active',
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token' }),
    });

    const result = await mod.listAccounts();
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].available).toBe(false);
  });
});

describe('local-mod — D9: a leitura de carga renova conta parada vencida', () => {
  it('parada com par vencido renova, grava no cofre ANTES de ler a carga, e lê com o token NOVO', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'old-token', expiresAt: Date.now() - 1000 })));
    const order: string[] = [];
    vault.onWrite = (id) => order.push(`write:${id}`);
    const newPair = buildPair({ accessToken: 'new-token', refreshToken: 'new-refresh' });
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeOrderedUsageFetch(order, { fiveHour: 7, sevenDay: 8 }),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: newPair }, refreshCalls),
    });

    const result = await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1);
    expect(order).toEqual(['write:acc-parada', 'usage:new-token']); // grava ANTES de ler a carga
    expect(vault.read('acc-parada')).toBe(JSON.stringify(newPair));
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].available).toBe(true);
    expect(result.accounts[0].load).toEqual({ fiveHour: 7, sevenDay: 8, sonnet: null, readAt: expect.any(String) });
  });

  it('recusa do refresh (rejected) marca no registro; a leitura seguinte NÃO chama refresh de novo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'rejected' }, refreshCalls),
      reconnectRegistry: registry,
    });

    const first = await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1);
    expect(registry.has('acc-parada')).toBe(true);
    if (first.kind !== 'ok') throw new Error('esperava ok');
    expect(first.accounts[0].load).toBeNull();

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1); // não tentou de novo
  });

  it('indisponível (unavailable) NÃO marca no registro; a leitura seguinte TENTA de novo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'unavailable' }, refreshCalls),
      reconnectRegistry: registry,
    });

    const first = await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1);
    expect(registry.has('acc-parada')).toBe(false);
    if (first.kind !== 'ok') throw new Error('esperava ok');
    expect(first.accounts[0].load).toBeNull();

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(2); // tentou de novo
  });

  it('conta parada JÁ marcada no registro não renova — lê com o par que houver, sem refresh', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'token-vencido', expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    registry.mark('acc-parada');
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'nao-deveria-usar' }) }, refreshCalls),
      reconnectRegistry: registry,
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    expect(usageCalls).toEqual(['token-vencido']);
  });

  it('conta parada sem NENHUM par no cofre aparece available:false, sem chamar refresh', async () => {
    const vault = new FakeVault();
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-sem-par')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair() }, refreshCalls),
    });

    const result = await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0]).toMatchObject({ available: false, load: null });
  });

  it('leitura e troca simultâneas da mesma conta vencida chamam refresh UMA vez; as duas recebem o par novo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const newPair = buildPair({ accessToken: 'novo-simultaneo', refreshToken: 'novo-refresh' });
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: async (refreshToken: string) => {
        refreshCalls.push(refreshToken);
        await Promise.resolve(); // garante pelo menos um microtask antes de resolver
        return { kind: 'ok', pair: newPair };
      },
    });

    const [listResult, switchResult] = await Promise.all([mod.listAccounts(), mod.switchTo('acc-parada')]);

    expect(refreshCalls).toHaveLength(1);
    expect(switchResult).toEqual({ kind: 'ok', pair: newPair });
    if (listResult.kind !== 'ok') throw new Error('esperava ok');
    expect(usageCalls).toEqual(['novo-simultaneo']);
    expect(vault.read('acc-parada')).toBe(JSON.stringify(newPair));
  });

  it('onPairRefreshed é chamado com (id, "read") quando a renovação vem de listAccounts', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const calls: { id: string; trigger: string }[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'novo' }) }),
      onPairRefreshed: (id, trigger) => calls.push({ id, trigger }),
    });

    await mod.listAccounts();
    expect(calls).toEqual([{ id: 'acc-parada', trigger: 'read' }]);
  });

  it('onPairRefreshed é chamado com (id, "switch") quando a renovação vem de switchTo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const calls: { id: string; trigger: string }[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'novo' }) }),
      onPairRefreshed: (id, trigger) => calls.push({ id, trigger }),
    });

    await mod.switchTo('acc-parada');
    expect(calls).toEqual([{ id: 'acc-parada', trigger: 'switch' }]);
  });

  it('falha ao gravar o par renovado no cofre NÃO chama onPairRefreshed (switchTo -> offline)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    vault.failWriteFor.add('acc-parada');
    const calls: { id: string; trigger: string }[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'novo' }) }),
      onPairRefreshed: (id, trigger) => calls.push({ id, trigger }),
    });

    const switchResult = await mod.switchTo('acc-parada');
    expect(switchResult).toEqual({ kind: 'failed', reason: 'offline' });
    expect(calls).toEqual([]);
  });

  it('falha ao gravar o par renovado no cofre também aparece em listAccounts como carga null, sem marca', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    vault.failWriteFor.add('acc-parada');
    const registry = createReconnectRegistry();
    const calls: { id: string; trigger: string }[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'novo' }) }),
      reconnectRegistry: registry,
      onPairRefreshed: (id, trigger) => calls.push({ id, trigger }),
    });

    const result = await mod.listAccounts();
    expect(calls).toEqual([]);
    expect(registry.has('acc-parada')).toBe(false); // só 'rejected' marca — vault-write-failed não é recusa de credencial
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].load).toBeNull();
  });
});

describe('local-mod — switchTo com ensureFreshPair (D9)', () => {
  it('switchTo com conta cadastrada mas sem NENHUM par no cofre -> unknown-account', async () => {
    const vault = new FakeVault();
    const mod = createLocalMod({ accounts: [accountOf('acc-sem-par')], vault, fetchImpl: async () => jsonResponse(200, {}) });

    const result = await mod.switchTo('acc-sem-par');
    expect(result).toEqual({ kind: 'failed', reason: 'unknown-account' });
  });

  it('switchTo tenta renovar mesmo com a conta JÁ marcada no registro — é o gesto de tentar de novo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    registry.mark('acc-parada');
    const newPair = buildPair({ accessToken: 'renovado-manual' });

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: newPair }),
      reconnectRegistry: registry,
    });

    const result = await mod.switchTo('acc-parada');
    expect(result).toEqual({ kind: 'ok', pair: newPair });
  });

  it('switchTo com refresh recusado (rejected) -> expired-credentials (via ensureFreshPair)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'rejected' }),
    });

    const result = await mod.switchTo('acc-parada');
    expect(result).toEqual({ kind: 'failed', reason: 'expired-credentials' });
  });

  it('switchTo com refresh indisponível (unavailable) -> offline (via ensureFreshPair)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'unavailable' }),
    });

    const result = await mod.switchTo('acc-parada');
    expect(result).toEqual({ kind: 'failed', reason: 'offline' });
  });

  it('switchTo com par válido (não vencido) não dispara refresh nenhum', async () => {
    const vault = new FakeVault();
    const validPair = buildPair({ accessToken: 'valido' });
    vault.write('acc-parada', JSON.stringify(validPair));
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair() }, refreshCalls),
    });

    const result = await mod.switchTo('acc-parada');
    expect(refreshCalls).toHaveLength(0);
    expect(result).toEqual({ kind: 'ok', pair: validPair });
  });
});
