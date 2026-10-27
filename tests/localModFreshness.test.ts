import { describe, expect, it } from 'vitest';
import { FakeVault, accountOf, buildPair, jsonResponse } from './helpers/localModFixtures';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createReconnectRegistry } from '../src/main/accounts/reconnect-registry';
import type { HttpFetchLike } from '../src/main/accounts/usage-client';
import type { RefreshResult } from '../src/main/accounts/token-refresh';

// 011-contas-e-provedores, etapa 3, Fase 2 (D7/D9, adendo ao desenho) —
// bateria dedicada ao mod local sobre os dois furos do achado pós-desenho:
// (D7) a conta ATIVA lê a carga do par VIVO (`<claudeHome>/.credentials.json`),
// nunca renova pelo cofre; (D9) a leitura de carga de uma conta PARADA renova
// o par vencido dela com o MESMO protocolo do switch (grava no cofre ANTES de
// usar; no máx. uma renovação em voo por conta — refresh token de uso único).
// Mesmos padrões de tests/accountModContract.test.ts: cofre em memória, HTTP
// falso e refreshImpl injetado.

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
      // refreshToken PRÓPRIO (diferente do default de buildPair) — R5
      // (revisão) passa a comparar refreshToken do vivo com o da parada;
      // sem isso os dois colidiriam no default 'refresh' de buildPair só por
      // acidente de fixture, e este teste (que é sobre D7, não sobre R5)
      // pegaria o ramo errado.
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token', refreshToken: 'live-refresh-token' }),
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

describe('local-mod — R5 (revisão): nunca renova a família de token do CLI', () => {
  it('parada vencida com o MESMO refresh token do par vivo -> NUNCA chama refresh, lê a carga com o token vivo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'cofre-vencido', refreshToken: 'refresh-compartilhado', expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'nunca-deveria-usar' }) }, refreshCalls),
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token', refreshToken: 'refresh-compartilhado' }),
    });

    const result = await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    expect(usageCalls).toEqual(['live-token']);
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].available).toBe(true); // ainda há par no cofre (vencido, mas existe)
  });

  it('parada JÁ marcada no registro, mas com o MESMO refresh token do par vivo -> ainda assim usa o vivo, sem renovar (R5 tem prioridade)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ refreshToken: 'refresh-compartilhado', expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    registry.mark('acc-parada');
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'nunca-deveria-usar' }) }, refreshCalls),
      reconnectRegistry: registry,
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token', refreshToken: 'refresh-compartilhado' }),
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(0);
    expect(usageCalls).toEqual(['live-token']);
  });

  it('parada com refresh token DIFERENTE do par vivo segue o caminho normal (ensureFreshPair, renova)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'cofre-vencido', refreshToken: 'refresh-proprio', expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];
    const newPair = buildPair({ accessToken: 'renovado' });

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: newPair }, refreshCalls),
      readLiveCredentialPair: () => buildPair({ accessToken: 'live-token', refreshToken: 'refresh-vivo' }),
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1); // token diferente do vivo -> não é a família viva, renova normalmente
    expect(usageCalls).toEqual(['renovado']);
  });

  it('sem readLiveCredentialPair (dep ausente), conta parada segue o caminho normal mesmo com refreshToken igual ao default de buildPair', async () => {
    // guarda-chuva: sem a dep pra comparar, nunca deveria achar que "é a família viva" por acidente.
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'renovado' }) }, refreshCalls),
    });

    await mod.listAccounts();
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('local-mod — R2 (revisão): recusa com o cofre já renovado não é recusa', () => {
  it('refreshImpl grava um par novo no cofre (outro processo renovou/reconectou no meio) e devolve rejected -> listAccounts NÃO marca, lê a carga com o par NOVO', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'velho', refreshToken: 'refresh-velho', expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    const racedPair = buildPair({ accessToken: 'par-novo-de-outro-processo', refreshToken: 'refresh-novo' });
    const usageCalls: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: makeUsageFetch(usageCalls),
      refreshImpl: async () => {
        // simula outro processo (login "Reconectar", outra instância do mod,
        // a captura do par rotacionado) renovando/reconectando a conta
        // ENQUANTO este refresh estava em voo.
        vault.write('acc-parada', JSON.stringify(racedPair));
        return { kind: 'failed', reason: 'rejected' } as const;
      },
      reconnectRegistry: registry,
    });

    const result = await mod.listAccounts();
    expect(registry.has('acc-parada')).toBe(false);
    expect(usageCalls).toEqual(['par-novo-de-outro-processo']);
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].load).not.toBeNull();
  });

  it('switchTo com o mesmo cenário (cofre renovado no meio de um rejected) -> ok com o par NOVO, não expired-credentials', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'velho', refreshToken: 'refresh-velho', expiresAt: Date.now() - 1000 })));
    const racedPair = buildPair({ accessToken: 'par-novo-de-outro-processo', refreshToken: 'refresh-novo' });

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => {
        vault.write('acc-parada', JSON.stringify(racedPair));
        return { kind: 'failed', reason: 'rejected' } as const;
      },
    });

    const result = await mod.switchTo('acc-parada');
    expect(result).toEqual({ kind: 'ok', pair: racedPair });
  });

  it('cofre ainda guarda o MESMO refresh token usado -> continua sendo rejected de verdade (marca no registro)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ refreshToken: 'refresh-inalterado', expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'failed', reason: 'rejected' }) as const, // cofre NÃO muda
      reconnectRegistry: registry,
    });

    const result = await mod.listAccounts();
    expect(registry.has('acc-parada')).toBe(true);
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].load).toBeNull();
  });

  it('cofre passou a ter um par novo mas JÁ VENCIDO -> unavailable (não rejected, não marca)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ refreshToken: 'refresh-velho', expiresAt: Date.now() - 1000 })));
    const registry = createReconnectRegistry();
    const expiredRacedPair = buildPair({ accessToken: 'novo-mas-vencido', refreshToken: 'refresh-novo', expiresAt: Date.now() - 500 });

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => {
        vault.write('acc-parada', JSON.stringify(expiredRacedPair));
        return { kind: 'failed', reason: 'rejected' } as const;
      },
      reconnectRegistry: registry,
    });

    const result = await mod.listAccounts();
    expect(registry.has('acc-parada')).toBe(false); // não é recusa de credencial
    if (result.kind !== 'ok') throw new Error('esperava ok');
    expect(result.accounts[0].load).toBeNull(); // mas também não tinha um par válido pra usar
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

describe('local-mod — R4 (revisão): gravação no cofre que LANÇA', () => {
  it('vault.write LANÇA (erro de I/O real) durante a renovação -> vault-write-failed, listAccounts com carga null e SEM marca', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    vault.throwWriteFor.add('acc-parada');
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
    expect(calls).toEqual([]); // nunca chamado — a gravação falhou
    expect(registry.has('acc-parada')).toBe(false); // vault-write-failed não é recusa de credencial
    if (result.kind !== 'ok') throw new Error('esperava ok'); // listAccounts nunca lança, mesmo com o cofre explodindo
    expect(result.accounts[0].load).toBeNull();
  });

  it('vault.write LANÇA durante switchTo -> nunca propaga a exceção, devolve failed/offline', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: Date.now() - 1000 })));
    vault.throwWriteFor.add('acc-parada');

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'ok', pair: buildPair({ accessToken: 'novo' }) }),
    });

    await expect(mod.switchTo('acc-parada')).resolves.toEqual({ kind: 'failed', reason: 'offline' });
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

// fix/renovacao-credencial — dois furos do mod local no caminho do par
// rotacionado e da renovação.
describe('local-mod — captura do par rotacionado e falha de renovação visível (fix/renovacao-credencial)', () => {
  it('captureRotatedPair REJEITA quando o cofre recusa gravar — o switch aborta em vez de perder o par', async () => {
    const vault = new FakeVault();
    vault.failWriteFor.add('acc-saindo');
    const mod = createLocalMod({ accounts: [accountOf('acc-saindo')], vault });

    await expect(mod.captureRotatedPair('acc-saindo', buildPair({ refreshToken: 'rotacionado' }))).rejects.toThrow();
  });

  it('captureRotatedPair grava no cofre quando ele aceita', async () => {
    const vault = new FakeVault();
    const mod = createLocalMod({ accounts: [accountOf('acc-saindo')], vault });

    await mod.captureRotatedPair('acc-saindo', buildPair({ refreshToken: 'rotacionado' }));

    expect(JSON.parse(vault.read('acc-saindo') ?? '{}').refreshToken).toBe('rotacionado');
  });

  it('renovação recusada na leitura avisa onPairRefreshFailed com o motivo (antes só o sucesso ia pro log)', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: 0 })));
    const failures: Array<{ id: string; trigger: string; reason: string }> = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'rejected' }),
      onPairRefreshFailed: (id, trigger, reason) => failures.push({ id, trigger, reason }),
    });

    await mod.listAccounts();

    expect(failures).toEqual([{ id: 'acc-parada', trigger: 'read', reason: 'rejected' }]);
  });

  it('renovação indisponível (rede) também avisa, com o motivo certo', async () => {
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ expiresAt: 0 })));
    const failures: string[] = [];

    const mod = createLocalMod({
      accounts: [accountOf('acc-parada')],
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: makeRefreshImpl({ kind: 'failed', reason: 'unavailable' }),
      onPairRefreshFailed: (_id, trigger, reason) => failures.push(`${trigger}:${reason}`),
    });

    await mod.switchTo('acc-parada');

    expect(failures).toEqual(['switch:unavailable']);
  });
});
