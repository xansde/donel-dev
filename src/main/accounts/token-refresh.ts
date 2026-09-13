// T1115 (011-contas-e-provedores, etapa 1) — refresh HTTP de fallback
// (contracts/backends-http.md §B: `POST platform.claude.com/v1/oauth/token`,
// `grant_type=refresh_token`, client_id público). Usado SÓ pelo mod local, SÓ
// no caminho de fallback do switch (par vencido) — D3/D4 do plan.md: o mod
// Seazone NUNCA importa este módulo (refresh token de uso único, colide com
// o monitor externo deles). HTTP injetável; nunca lança.
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D4) — `failed` ganha `reason`:
// `rejected` = o servidor recusou de fato (400/401/403) OU uma resposta 2xx
// que não dá pra usar (o refresh token de uso único pode já ter sido
// consumido por outra sessão — não dá pra distinguir "corpo quebrado" de
// "token já gasto", então os dois tratam como recusa); `unavailable` = nunca
// dá pra saber se o servidor teria aceitado (rede fora do ar, timeout/abort,
// ou um status que não é nem sucesso nem recusa de credencial, ex.: 500). Só
// `rejected` vira `expired-credentials` no chamador (local-mod.ts) — misturar
// os dois faria uma queda de rede parecer "sua conta venceu".

import type { HttpFetchLike, HttpResponseLike } from './usage-client';
import type { CredentialPair } from './account-mod';

const TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';

/** client_id público do CLI Claude Code (mesmo usado pelo próprio `claude` para o fluxo OAuth device/PKCE) — não é segredo. */
export const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export type RefreshResult = { readonly kind: 'ok'; readonly pair: CredentialPair } | { readonly kind: 'failed'; readonly reason: 'rejected' | 'unavailable' };

export interface RefreshCredentialPairOptions {
  readonly fetchImpl?: HttpFetchLike;
  readonly timeoutMs?: number;
}

function parseScope(scope: unknown): readonly string[] {
  return typeof scope === 'string' && scope.trim() ? scope.trim().split(/\s+/) : [];
}

/**
 * Troca `refreshToken` (uso único) por um par novo. Nunca lança. A falha diz
 * o motivo: `rejected` quando o servidor recusou (400/401/403) ou quando uma
 * resposta 2xx não pôde ser lida — o refresh token já foi gasto —, e
 * `unavailable` quando não dá para saber (rede, timeout antes da resposta,
 * outro status). O chamador (local-mod.ts) só oferece reconectar em `rejected`.
 */
export async function refreshCredentialPair(refreshToken: string, options: RefreshCredentialPairOptions = {}): Promise<RefreshResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as HttpFetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    // Try do FETCH separado do try do CORPO (D4): as duas falhas mapeiam pra
    // `reason`s diferentes — rede/timeout antes da resposta nunca prova que o
    // servidor recusou.
    let response: HttpResponseLike;
    try {
      response = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ANTHROPIC_OAUTH_CLIENT_ID }),
        signal: controller?.signal,
      });
    } catch {
      return { kind: 'failed', reason: 'unavailable' };
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) return { kind: 'failed', reason: 'rejected' };
    if (response.status < 200 || response.status >= 300) return { kind: 'failed', reason: 'unavailable' };

    // O timer segue armado durante a leitura do corpo: corpo que trava aborta
    // em vez de pendurar a troca. Qualquer falha daqui em diante é `rejected`
    // — com 2xx, o servidor já gastou o refresh token de uso único.
    try {
      const body = (await response.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        scope?: unknown;
      };
      if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || typeof body.expires_in !== 'number') {
        return { kind: 'failed', reason: 'rejected' };
      }

      return {
        kind: 'ok',
        pair: {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: Date.now() + body.expires_in * 1000,
          scopes: parseScope(body.scope),
        },
      };
    } catch {
      return { kind: 'failed', reason: 'rejected' };
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
