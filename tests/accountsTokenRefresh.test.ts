import { describe, expect, it } from 'vitest';
import { ANTHROPIC_OAUTH_CLIENT_ID, refreshCredentialPair } from '../src/main/accounts/token-refresh';
import type { HttpFetchLike } from '../src/main/accounts/usage-client';

// T1114 (011-contas-e-provedores, etapa 1) — refresh HTTP de fallback
// (contracts/backends-http.md §B: `POST platform.claude.com/v1/oauth/token`,
// `grant_type=refresh_token`, client_id público). Este arquivo cobre só o
// CONTRATO da chamada crua; QUEM decide chamar (só no fallback do switch do
// mod local) e a sequência "grava no cofre antes de usar" são testados em
// tests/accountModContract.test.ts (local-mod.ts), conforme
// plan.md/estratégia de teste — não duplicados aqui.

const REFRESH_TOKEN = 'super-secret-refresh-token';

function fakeFetch(status: number, body: unknown): HttpFetchLike {
  return async () => ({ status, json: async () => body });
}

describe('refreshCredentialPair (I/O injetável)', () => {
  it('envia grant_type=refresh_token e o client_id público', async () => {
    let capturedBody: unknown;
    const fetchImpl: HttpFetchLike = async (_url, init) => {
      capturedBody = JSON.parse((init as unknown as { body?: string })?.body ?? '{}');
      return { status: 200, json: async () => ({ access_token: 'new-a', refresh_token: 'new-r', expires_in: 3600, scope: 'user' }) };
    };
    await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
    expect(capturedBody).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    });
  });

  it('sucesso: devolve o par novo (expiresAt derivado de expires_in)', async () => {
    const before = Date.now();
    const fetchImpl = fakeFetch(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'user:inference offline_access' });
    const result = await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.pair.accessToken).toBe('new-access');
      expect(result.pair.refreshToken).toBe('new-refresh');
      expect(result.pair.scopes).toEqual(['user:inference', 'offline_access']);
      expect(result.pair.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    }
  });

  it('recusa do servidor (4xx) devolve failed, nunca lança', async () => {
    const fetchImpl = fakeFetch(401, { error: 'invalid_grant' });
    const result = await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
    expect(result).toEqual({ kind: 'failed' });
  });

  it('erro de rede devolve failed, nunca lança', async () => {
    const fetchImpl: HttpFetchLike = async () => {
      throw new Error('network down');
    };
    const result = await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
    expect(result).toEqual({ kind: 'failed' });
  });

  it('payload de sucesso malformado (sem access_token) devolve failed', async () => {
    const fetchImpl = fakeFetch(200, { refresh_token: 'x' });
    const result = await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
    expect(result).toEqual({ kind: 'failed' });
  });

  it('o refresh token nunca aparece numa mensagem de erro lançada', async () => {
    const fetchImpl: HttpFetchLike = async () => {
      throw new Error(`boom with ${REFRESH_TOKEN}`);
    };
    try {
      const result = await refreshCredentialPair(REFRESH_TOKEN, { fetchImpl });
      expect(result).toEqual({ kind: 'failed' });
    } catch (error) {
      expect(String(error)).not.toContain(REFRESH_TOKEN);
    }
  });
});
