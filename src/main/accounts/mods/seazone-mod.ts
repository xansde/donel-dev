// T1117 (011-contas-e-provedores, etapa 1) — mod Seazone (pool compartilhado),
// contracts/backends-http.md §A + contracts/account-mod.md. NUNCA renova
// token (D3): não importa `token-refresh.ts` de propósito — o refresh do pool
// Seazone é do servidor deles (há monitor externo com
// `refresh_owner`/`token_version`; refresh token da Anthropic é de uso
// único). Auth: JWT curto (15 min) obtido a partir do `sessionRefreshToken`
// (guardado no cofre, entrada `seazone:session`, C11).

import type { AccountLoad, AccountSummary } from '../../../shared/accounts';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../account-mod';
import type { HttpFetchLike, HttpRequestInit, HttpResponseLike } from '../usage-client';
import type { VaultLike } from '../vault';

const SESSION_VAULT_KEY = 'seazone:session';
const DEFAULT_JWT_TTL_SECONDS = 900; // 15 min

export interface SeazoneModDeps {
  readonly baseUrl: string;
  readonly vault: VaultLike;
  readonly fetchImpl?: HttpFetchLike;
}

/**
 * `active` sempre `false` aqui — o mod não sabe qual conta está ativa
 * "de verdade" (isso é estado do motor/config, `AccountsConfig.activeAccountId`).
 * `account-engine.ts` sobrescreve o campo ao montar `AccountsViewDto`.
 */
function mapSeazoneAccount(raw: unknown): AccountSummary {
  const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id : '';
  const label = typeof candidate.label === 'string' ? candidate.label : id;
  const plan = typeof candidate.plan === 'string' ? candidate.plan : null;
  const available = typeof candidate.available === 'boolean' ? candidate.available : true;
  const load: AccountLoad = {
    fiveHour: typeof candidate.fiveHour === 'number' ? candidate.fiveHour : null,
    sevenDay: typeof candidate.sevenDay === 'number' ? candidate.sevenDay : null,
    sonnet: typeof candidate.sonnetUtil === 'number' ? candidate.sonnetUtil : null,
    readAt: new Date().toISOString(),
  };
  return { id, label, plan, active: false, available, load };
}

export function createSeazoneMod(deps: SeazoneModDeps): AccountMod {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as HttpFetchLike);
  let cachedJwt: { readonly token: string; readonly expiresAt: number } | null = null;

  /** Troca/renova o JWT curto a partir do `sessionRefreshToken` do cofre. `null` = sem sessão utilizável (cofre vazio ou servidor recusou). Nunca lança. */
  async function ensureJwt(): Promise<string | null> {
    if (cachedJwt && cachedJwt.expiresAt > Date.now() + 5_000) return cachedJwt.token;

    const sessionToken = deps.vault.read(SESSION_VAULT_KEY);
    if (!sessionToken) return null;

    try {
      const path = cachedJwt ? '/auth/refresh' : '/auth/exchange';
      const response = await fetchImpl(`${deps.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionRefreshToken: sessionToken }),
      });
      if (response.status < 200 || response.status >= 300) return null;

      const body = (await response.json()) as { jwt?: unknown; expiresIn?: unknown };
      if (typeof body.jwt !== 'string') return null;
      const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : DEFAULT_JWT_TTL_SECONDS;
      cachedJwt = { token: body.jwt, expiresAt: Date.now() + expiresIn * 1000 };
      return cachedJwt.token;
    } catch {
      return null;
    }
  }

  /** `null` = falha de rede/sessão (nunca lança) — chamador decide o `reason`. */
  async function authedFetch(path: string, init?: HttpRequestInit): Promise<HttpResponseLike | null> {
    const token = await ensureJwt();
    if (!token) return null;
    try {
      return await fetchImpl(`${deps.baseUrl}${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    } catch {
      return null;
    }
  }

  return {
    id: 'seazone',

    async listAccounts(): Promise<ListAccountsResult> {
      const response = await authedFetch('/accounts');
      if (!response) return { kind: 'unavailable', reason: 'offline' };
      if (response.status === 401) return { kind: 'unavailable', reason: 'unauthorized' };
      if (response.status < 200 || response.status >= 300) return { kind: 'unavailable', reason: 'io' };

      try {
        const body = (await response.json()) as { accounts?: unknown };
        if (!Array.isArray(body.accounts)) return { kind: 'unavailable', reason: 'io' };
        return { kind: 'ok', accounts: body.accounts.map(mapSeazoneAccount) };
      } catch {
        return { kind: 'unavailable', reason: 'io' };
      }
    },

    async switchTo(id): Promise<SwitchToResult> {
      const response = await authedFetch('/session/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id }),
      });
      if (!response) return { kind: 'failed', reason: 'offline' };
      if (response.status === 401) return { kind: 'failed', reason: 'unauthorized' };
      if (response.status === 404) return { kind: 'failed', reason: 'unknown-account' };
      if (response.status < 200 || response.status >= 300) return { kind: 'failed', reason: 'offline' };

      try {
        const body = (await response.json()) as Partial<CredentialPair>;
        if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string' || typeof body.expiresAt !== 'number') {
          return { kind: 'failed', reason: 'offline' };
        }
        return {
          kind: 'ok',
          pair: {
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresAt: body.expiresAt,
            scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : [],
          },
        };
      } catch {
        return { kind: 'failed', reason: 'offline' };
      }
    },

    /** Repassa o par rotacionado ao servidor deles (eles são a fonte de verdade do pool) — nunca grava localmente. */
    async captureRotatedPair(id, pair): Promise<void> {
      await authedFetch('/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id, rotatedPair: pair }),
      }).catch(() => null);
    },

    /** Heartbeat de 15 min (C3) — só enquanto o app está aberto, timer do main (account-engine.ts). */
    async keepAlive(): Promise<void> {
      await authedFetch('/session/heartbeat', { method: 'POST' }).catch(() => null);
    },
  };
}
