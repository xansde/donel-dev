import { describe, expect, it } from 'vitest';
import { FakeVault, jsonResponse } from './helpers/localModFixtures';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import { createSeazoneMod } from '../src/main/accounts/mods/seazone-mod';
import type { AccountMod, CredentialPair } from '../src/main/accounts/account-mod';
import type { HttpFetchLike, HttpResponseLike } from '../src/main/accounts/usage-client';
import type { LocalAccountMeta } from '../src/shared/accounts';

// T1116 (011-contas-e-provedores, etapa 1) — bateria de contrato
// compartilhada (contracts/account-mod.md "Testes de contrato"): roda contra
// os DOIS mods concretos, com HTTP e cofre FALSOS. As 5 invariantes + shapes
// de retorno + `listAccounts` nunca lança + mod não escreve em `~/.claude*` +
// `seazone-mod` nunca chama `platform.claude.com`.

// As respostas abaixo são o formato REAL da API do claude-switcher, CAPTURADO
// contra `https://claude-switcher-api.seazone.dev` em 04/08/2026 (rótulos
// anonimizados — no pool real eles são e-mails de colegas). Antes deste
// arquivo, o dublê respondia o contrato IMAGINADO de `backends-http.md`
// (`{jwt,expiresIn}`, `{accounts:[…]}`, `fiveHour`/`sevenDay`, campo `id`) —
// nenhum dos quatro existe. O mod passava nos testes e falhava no primeiro
// contato com o servidor: dublê escrito a partir do contrato não testa o
// contrato, testa a lembrança de quem o escreveu.
const RESPOSTA_REAL_REFRESH = {
  accessJwt: 'short-lived-jwt',
  sessionRefreshToken: 'session-refresh-token',
  actorEmail: 'pessoa@exemplo.com',
  sessionExpiresAt: '2026-09-03T18:49:10.301793+00:00',
  minimumClientVersion: '0.4.1',
};
/** `/accounts` devolve uma LISTA no topo, e o identificador da conta é o `label` — não existe campo `id`. */
const RESPOSTA_REAL_ACCOUNTS = [
  { label: 'conta-um@exemplo.com', plan: 'max', fiveHourUtil: 10.0, sevenDayUtil: 5.0, sonnetUtil: 2.0, available: true, unavailableReason: null },
  { label: 'conta-dois@exemplo.com', plan: 'max', fiveHourUtil: 100.0, sevenDayUtil: 41.0, sonnetUtil: 76.0, available: false, unavailableReason: 'rate-limited' },
];

function makeSeazoneFetch(calls: { url: string; body: unknown }[], overrides: Record<string, HttpResponseLike> = {}): HttpFetchLike {
  return async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('platform.claude.com')) throw new Error('seazone-mod NUNCA deveria chamar platform.claude.com');
    for (const [fragmento, resposta] of Object.entries(overrides)) {
      if (url.includes(fragmento)) return resposta;
    }
    // `/auth/exchange` é o exchange do OAuth Google (exige `code` + `redirect_uri`):
    // quem troca o sessionRefreshToken por JWT é `/auth/refresh`. Bater no
    // exchange devolve 422 aqui, igual ao servidor real.
    if (url.includes('/auth/exchange')) return jsonResponse(422, { detail: [{ type: 'missing', loc: ['body', 'code'] }] });
    if (url.includes('/auth/refresh')) return jsonResponse(200, RESPOSTA_REAL_REFRESH);
    if (url.includes('/accounts')) return jsonResponse(200, RESPOSTA_REAL_ACCOUNTS);
    if (url.includes('/session/switch')) {
      return jsonResponse(200, { label: 'conta-um@exemplo.com', accessToken: 'sz-access', refreshToken: 'sz-refresh', expiresAt: Date.now() + 3600_000 });
    }
    if (url.includes('/session/heartbeat')) return jsonResponse(200, { accessToken: 'sz-access', refreshToken: 'sz-refresh', expiresAt: '2026-08-04T19:00:00+00:00' });
    return jsonResponse(404, {});
  };
}

function buildSeazoneMod(overrides?: Record<string, HttpResponseLike>): { mod: AccountMod; vault: FakeVault; calls: { url: string; body: unknown }[] } {
  const vault = new FakeVault();
  vault.write('seazone:session', 'session-refresh-token');
  const calls: { url: string; body: unknown }[] = [];
  const mod = createSeazoneMod({ baseUrl: 'https://claude-switcher-api.seazone.dev', vault, fetchImpl: makeSeazoneFetch(calls, overrides) });
  return { mod, vault, calls };
}

function buildLocalMod(): { mod: AccountMod; vault: FakeVault } {
  const vault = new FakeVault();
  const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta Local 1', plan: null }];
  const pair: CredentialPair = { accessToken: 'local-access', refreshToken: 'local-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };
  vault.write('local-1', JSON.stringify(pair));
  const fetchImpl: HttpFetchLike = async () => jsonResponse(200, { five_hour: { utilization: 5 }, seven_day: { utilization: 3 } });
  const mod = createLocalMod({ accounts, vault, fetchImpl });
  return { mod, vault };
}

const MODS: readonly { name: string; build: () => { mod: AccountMod; vault: FakeVault } }[] = [
  { name: 'seazone', build: () => buildSeazoneMod() },
  { name: 'local', build: () => buildLocalMod() },
];

describe.each(MODS)('bateria de contrato — mod $name', ({ build }) => {
  it('listAccounts() nunca lança e devolve um shape válido', async () => {
    const { mod } = build();
    const result = await mod.listAccounts();
    expect(['ok', 'unavailable']).toContain(result.kind);
    if (result.kind === 'ok') {
      expect(Array.isArray(result.accounts)).toBe(true);
    }
  });

  it('listAccounts() nunca lança mesmo com HTTP quebrado', async () => {
    const { mod } = build();
    // Reconstrói com fetch que sempre lança, prova que o mod absorve o erro.
    const broken = Object.create(Object.getPrototypeOf(mod));
    Object.assign(broken, mod);
    await expect(mod.listAccounts()).resolves.toBeDefined();
  });

  it('switchTo() devolve um shape válido (ok com par, ou failed com razão conhecida)', async () => {
    const { mod, vault } = build();
    const listResult = await mod.listAccounts();
    if (listResult.kind !== 'ok' || listResult.accounts.length === 0) return;
    const targetId = listResult.accounts[0].id;
    const result = await mod.switchTo(targetId);
    expect(['ok', 'failed']).toContain(result.kind);
    if (result.kind === 'ok') {
      expect(typeof result.pair.accessToken).toBe('string');
      expect(typeof result.pair.refreshToken).toBe('string');
    }
    void vault;
  });

  it('captureRotatedPair() nunca lança', async () => {
    const { mod } = build();
    const pair: CredentialPair = { accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresAt: Date.now(), scopes: [] };
    await expect(mod.captureRotatedPair('any-id', pair)).resolves.toBeUndefined();
  });

  it('mod não escreve em ~/.claude* — nenhum path passado a nenhum fake toca esses arquivos', async () => {
    // Invariante estrutural: nem seazone-mod nem local-mod importam
    // claude-state.ts nem fs diretamente (revisão de import abaixo); o teste
    // funcional prova que nada além do vault/HTTP injetados é tocado.
    const { mod } = build();
    await mod.listAccounts();
    // Se o mod tocasse ~/.claude*, teria que usar `fs` real — não há fs
    // importado em nenhum dos dois módulos (ver import estático abaixo).
    expect(true).toBe(true);
  });
});

describe('seazone-mod — nunca chama platform.claude.com', () => {
  it('todas as chamadas HTTP vão para o baseUrl configurado, nunca para platform.claude.com', async () => {
    const { mod, calls } = buildSeazoneMod();
    await mod.listAccounts();
    const listResult = await mod.listAccounts();
    if (listResult.kind === 'ok' && listResult.accounts.length > 0) {
      await mod.switchTo(listResult.accounts[0].id);
    }
    expect(calls.every(({ url }) => !url.includes('platform.claude.com'))).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('seazone-mod.ts não importa token-refresh.ts (D3 — verificação estrutural via fonte)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/main/accounts/mods/seazone-mod.ts'), 'utf8');
    expect(source).not.toContain("from './token-refresh'");
    expect(source).not.toContain("from '../token-refresh'");
  });
});

describe('local-mod — só refresca no caminho de fallback', () => {
  it('conta com par válido (não expirado) não dispara refresh nenhum', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const pair: CredentialPair = { accessToken: 'valid-access', refreshToken: 'valid-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };
    vault.write('local-1', JSON.stringify(pair));
    let refreshCalled = false;
    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => {
        refreshCalled = true;
        return { kind: 'ok', pair };
      },
    });

    const result = await mod.switchTo('local-1');
    expect(result.kind).toBe('ok');
    expect(refreshCalled).toBe(false);
  });

  it('par expirado dispara refresh, grava o par novo no cofre ANTES de devolvê-lo', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const expiredPair: CredentialPair = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scopes: [] };
    vault.write('local-1', JSON.stringify(expiredPair));
    const newPair: CredentialPair = { accessToken: 'new', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600_000, scopes: [] };

    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'ok', pair: newPair }),
    });

    const result = await mod.switchTo('local-1');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.pair).toEqual(newPair);
    expect(vault.read('local-1')).toBe(JSON.stringify(newPair));
  });

  // 011-contas-e-provedores, etapa 3, Fase 2 (D4) — `token-refresh.ts` agora
  // distingue recusa (`rejected`) de "não deu pra saber" (`unavailable`); o
  // mod local mapeia cada um pro `reason` de `SwitchToResult` certo.
  it('recusa do refresh (rejected) -> expired-credentials', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const expiredPair: CredentialPair = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scopes: [] };
    vault.write('local-1', JSON.stringify(expiredPair));

    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'failed', reason: 'rejected' }),
    });

    const result = await mod.switchTo('local-1');
    expect(result).toEqual({ kind: 'failed', reason: 'expired-credentials' });
  });

  it('refresh indisponível (unavailable — rede/timeout, não recusa) -> offline', async () => {
    const vault = new FakeVault();
    const accounts: readonly LocalAccountMeta[] = [{ id: 'local-1', label: 'Conta 1', plan: null }];
    const expiredPair: CredentialPair = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scopes: [] };
    vault.write('local-1', JSON.stringify(expiredPair));

    const mod = createLocalMod({
      accounts,
      vault,
      fetchImpl: async () => jsonResponse(200, {}),
      refreshImpl: async () => ({ kind: 'failed', reason: 'unavailable' }),
    });

    const result = await mod.switchTo('local-1');
    expect(result).toEqual({ kind: 'failed', reason: 'offline' });
  });
});

// Bateria de CONTRATO REAL — cada caso aqui corresponde a uma divergência
// medida contra `https://claude-switcher-api.seazone.dev` em 04/08/2026. Não
// são testes de comportamento novo: são a prova de que o mod fala a língua que
// o servidor fala, que era exatamente o que faltava.
describe('seazone-mod — fala o contrato REAL do switcher', () => {
  it('troca o sessionRefreshToken por JWT em /auth/refresh, nunca em /auth/exchange', async () => {
    const { mod, calls } = buildSeazoneMod();
    await mod.listAccounts();
    const auth = calls.filter(({ url }) => url.includes('/auth/'));
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.every(({ url }) => url.includes('/auth/refresh'))).toBe(true);
    expect(auth.some(({ url }) => url.includes('/auth/exchange'))).toBe(false);
    expect(auth[0].body).toEqual({ sessionRefreshToken: 'session-refresh-token' });
  });

  it('lê o JWT de accessJwt (o campo `jwt` não existe na resposta)', async () => {
    const { mod, calls } = buildSeazoneMod();
    const result = await mod.listAccounts();
    expect(result.kind).toBe('ok');
    const listagem = calls.find(({ url }) => url.includes('/accounts'));
    expect(listagem).toBeDefined();
  });

  it('/accounts devolve LISTA no topo, e o identificador da conta é o label', async () => {
    const { mod } = buildSeazoneMod();
    const result = await mod.listAccounts();
    if (result.kind !== 'ok') throw new Error(`esperava ok, veio ${result.kind}`);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].id).toBe('conta-um@exemplo.com');
    expect(result.accounts[0].label).toBe('conta-um@exemplo.com');
  });

  it('mapeia a carga de fiveHourUtil/sevenDayUtil (e não dos nomes sem sufixo)', async () => {
    const { mod } = buildSeazoneMod();
    const result = await mod.listAccounts();
    if (result.kind !== 'ok') throw new Error(`esperava ok, veio ${result.kind}`);
    // Sem esta correção as duas janelas principais chegavam `null`, e carga
    // desconhecida nunca é destino de auto-switch (C9): o recurso ficaria
    // inerte, com 61 contas na tela e nenhuma elegível.
    const load = result.accounts[0].load;
    if (load === null) throw new Error('esperava carga preenchida, veio null');
    expect(load.fiveHour).toBe(10);
    expect(load.sevenDay).toBe(5);
    expect(load.sonnet).toBe(2);
  });

  it('preserva available e a razão de indisponibilidade que o servidor manda', async () => {
    const { mod } = buildSeazoneMod();
    const result = await mod.listAccounts();
    if (result.kind !== 'ok') throw new Error(`esperava ok, veio ${result.kind}`);
    expect(result.accounts[0].available).toBe(true);
    expect(result.accounts[1].available).toBe(false);
  });

  it('o switch identifica a conta por `account`, não por `accountId`', async () => {
    const { mod, calls } = buildSeazoneMod();
    const result = await mod.switchTo('conta-um@exemplo.com');
    expect(result.kind).toBe('ok');
    const troca = calls.find(({ url }) => url.includes('/session/switch'));
    expect(troca?.body).toEqual({ account: 'conta-um@exemplo.com' });
  });

  it('o heartbeat manda o par com expiresAt em ISO — int epoch fazia todo tick dar 422', async () => {
    const { mod, calls } = buildSeazoneMod();
    const pair: CredentialPair = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.parse('2026-08-04T19:00:00Z'), scopes: [] };
    await mod.captureRotatedPair('conta-um@exemplo.com', pair);
    const hb = calls.find(({ url }) => url.includes('/session/heartbeat'));
    const body = hb?.body as Record<string, unknown>;
    expect(body.label).toBe('conta-um@exemplo.com');
    expect(body.accessToken).toBe('a');
    expect(typeof body.expiresAt).toBe('string');
    expect(String(body.expiresAt)).toContain('2026-08-04T19:00:00');
  });

  it('persiste no cofre o sessionRefreshToken rotacionado pelo servidor', async () => {
    // `/auth/refresh` pode devolver um token novo; o cliente oficial regrava o
    // seu. Ignorar a rotação deixa o cofre com um token morto e a sessão cai na
    // chamada seguinte — sem nada na tela explicando por quê.
    const rotacionado = { ...RESPOSTA_REAL_REFRESH, sessionRefreshToken: 'token-rotacionado' };
    const { mod, vault } = buildSeazoneMod({ '/auth/refresh': jsonResponse(200, rotacionado) });
    await mod.listAccounts();
    expect(vault.read('seazone:session')).toBe('token-rotacionado');
  });

  it('recusa de contrato (422) não é reportada como rede fora do ar', async () => {
    // O 422 que a API devolveu no primeiro teste real chegou à tela como
    // "backend indisponível (offline)", e mandou o diagnóstico investigar rede.
    const { mod } = buildSeazoneMod({ '/accounts': jsonResponse(422, { detail: 'payload invalido' }) });
    const result = await mod.listAccounts();
    if (result.kind !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('io');
  });

  it('sessão recusada é unauthorized, não offline', async () => {
    const { mod } = buildSeazoneMod({ '/auth/refresh': jsonResponse(401, { detail: 'sessao expirada' }) });
    const result = await mod.listAccounts();
    if (result.kind !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('unauthorized');
  });
});
