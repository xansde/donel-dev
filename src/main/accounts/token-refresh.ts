// T1115 (011-contas-e-provedores, etapa 1) — refresh HTTP de fallback
// (contracts/backends-http.md §B: `POST platform.claude.com/v1/oauth/token`,
// `grant_type=refresh_token`, client_id público). Usado SÓ pelo mod local, SÓ
// no caminho de fallback do switch (par vencido) — D3/D4 do plan.md: o mod
// Seazone NUNCA importa este módulo (refresh token de uso único, colide com
// o monitor externo deles). HTTP injetável; nunca lança.

import type { HttpFetchLike } from './usage-client';
import type { CredentialPair } from './account-mod';

const TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';

/** client_id público do CLI Claude Code (mesmo usado pelo próprio `claude` para o fluxo OAuth device/PKCE) — não é segredo. */
export const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export type RefreshResult = { readonly kind: 'ok'; readonly pair: CredentialPair } | { readonly kind: 'failed' };

export interface RefreshCredentialPairOptions {
  readonly fetchImpl?: HttpFetchLike;
  readonly timeoutMs?: number;
}

function parseScope(scope: unknown): readonly string[] {
  return typeof scope === 'string' && scope.trim() ? scope.trim().split(/\s+/) : [];
}

/**
 * Troca `refreshToken` (uso único) por um par novo. Nunca lança: recusa do
 * servidor, timeout, erro de rede ou payload malformado viram `{ kind:
 * 'failed' }` — o chamador (local-mod.ts) mapeia isso para
 * `expired-credentials`.
 */
export async function refreshCredentialPair(refreshToken: string, options: RefreshCredentialPairOptions = {}): Promise<RefreshResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as HttpFetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ANTHROPIC_OAUTH_CLIENT_ID }),
      signal: controller?.signal,
    });
    if (response.status < 200 || response.status >= 300) return { kind: 'failed' };

    const body = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || typeof body.expires_in !== 'number') {
      return { kind: 'failed' };
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
    return { kind: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
