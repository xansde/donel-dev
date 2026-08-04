// T1117 (011-contas-e-provedores, etapa 1) — mod Seazone (pool compartilhado),
// contracts/backends-http.md §A + contracts/account-mod.md. NUNCA renova
// token (D3): não importa `token-refresh.ts` de propósito — o refresh do pool
// Seazone é do servidor deles (há monitor externo com
// `refresh_owner`/`token_version`; refresh token da Anthropic é de uso
// único). Auth: JWT curto (15 min) obtido a partir do `sessionRefreshToken`
// (guardado no cofre, entrada `seazone:session`, C11).

import type { AccountLoad, AccountSummary } from '../../../shared/accounts';
import type { AccountMod, ListAccountsResult, SwitchToResult } from '../account-mod';
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
/**
 * O `label` É o identificador: a resposta de `/accounts` não tem campo `id`
 * (verificado contra a API real em 04/08/2026 — os campos são `label`, `plan`,
 * `fiveHourUtil`, `sevenDayUtil`, `sonnetUtil`, `available`,
 * `unavailableReason`), e o cliente oficial identifica conta por label no
 * `/session/switch`. Antes daqui o mod lia `candidate.id` (sempre ausente →
 * `''`) e `fiveHour`/`sevenDay` (idem → `null`): as contas chegavam sem
 * identidade e sem carga, e carga desconhecida nunca é destino de auto-switch
 * (C9).
 */
function mapSeazoneAccount(raw: unknown): AccountSummary {
  const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const label = typeof candidate.label === 'string' ? candidate.label : '';
  const plan = typeof candidate.plan === 'string' ? candidate.plan : null;
  const available = typeof candidate.available === 'boolean' ? candidate.available : true;
  const load: AccountLoad = {
    fiveHour: typeof candidate.fiveHourUtil === 'number' ? candidate.fiveHourUtil : null,
    sevenDay: typeof candidate.sevenDayUtil === 'number' ? candidate.sevenDayUtil : null,
    sonnet: typeof candidate.sonnetUtil === 'number' ? candidate.sonnetUtil : null,
    readAt: new Date().toISOString(),
  };
  return { id: label, label, plan, active: false, available, load };
}

/**
 * `expiresAt` cruza a fronteira em dois formatos: o `.credentials.json` do CLI
 * guarda epoch ms (número), e a API do switcher declara ISO-8601. Normalizar
 * nos dois sentidos, num lugar só, é o que impede o bug que o cliente oficial
 * já pagou: mandar o int cru fazia TODO tick do heartbeat responder 422, o
 * token rotacionado nunca chegava ao pool e os switches seguintes davam 403.
 */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function createSeazoneMod(deps: SeazoneModDeps): AccountMod {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as HttpFetchLike);
  let cachedJwt: { readonly token: string; readonly expiresAt: number } | null = null;

  /**
   * A sessão morreu de um jeito que reconectar não resolve (o servidor recusou
   * o `sessionRefreshToken`) — diferente de "não consegui falar com o
   * servidor". A distinção existe porque as duas chegavam à tela como
   * "backend indisponível (offline)", mandando quem lê procurar problema de
   * rede quando o problema era a credencial.
   */
  let sessionRefused = false;

  /**
   * Troca o `sessionRefreshToken` por um JWT curto. A rota é `/auth/refresh` —
   * `/auth/exchange` é o exchange do OAuth Google (exige `code` +
   * `redirect_uri`) e responde 422 a este payload, que foi exatamente o erro
   * que chegou à tela como "offline". `null` = sem sessão utilizável.
   * Nunca lança.
   */
  async function ensureJwt(): Promise<string | null> {
    if (cachedJwt && cachedJwt.expiresAt > Date.now() + 5_000) return cachedJwt.token;

    const sessionToken = deps.vault.read(SESSION_VAULT_KEY);
    if (!sessionToken) return null;

    try {
      const response = await fetchImpl(`${deps.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionRefreshToken: sessionToken }),
      });
      if (response.status === 401 || response.status === 403) {
        sessionRefused = true;
        return null;
      }
      if (response.status < 200 || response.status >= 300) return null;

      const body = (await response.json()) as { accessJwt?: unknown; sessionRefreshToken?: unknown };
      if (typeof body.accessJwt !== 'string') return null;

      // O servidor pode ROTACIONAR a sessão a cada refresh; guardar o token
      // novo é obrigatório. Ignorá-lo deixa o cofre com um token morto e a
      // sessão cai na chamada seguinte, sem nada na tela dizendo por quê.
      if (typeof body.sessionRefreshToken === 'string' && body.sessionRefreshToken !== sessionToken) {
        deps.vault.write(SESSION_VAULT_KEY, body.sessionRefreshToken);
      }

      cachedJwt = { token: body.accessJwt, expiresAt: Date.now() + DEFAULT_JWT_TTL_SECONDS * 1000 };
      return cachedJwt.token;
    } catch {
      return null;
    }
  }

  /** `null` = falha de rede/sessão (nunca lança) — chamador decide o `reason`, lendo `sessionRefused` para separar credencial de rede. */
  async function authedFetch(path: string, init?: HttpRequestInit): Promise<HttpResponseLike | null> {
    sessionRefused = false;
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

    /** `/accounts` devolve a LISTA no topo — não um envelope `{ accounts: [...] }`. */
    async listAccounts(): Promise<ListAccountsResult> {
      const response = await authedFetch('/accounts');
      if (!response) return { kind: 'unavailable', reason: sessionRefused ? 'unauthorized' : 'offline' };
      if (response.status === 401 || response.status === 403) return { kind: 'unavailable', reason: 'unauthorized' };
      if (response.status < 200 || response.status >= 300) return { kind: 'unavailable', reason: 'io' };

      try {
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) return { kind: 'unavailable', reason: 'io' };
        return { kind: 'ok', accounts: body.map(mapSeazoneAccount) };
      } catch {
        return { kind: 'unavailable', reason: 'io' };
      }
    },

    /** A conta é identificada por `account` (o label), como no cliente oficial — `accountId` não existe no contrato. */
    async switchTo(id): Promise<SwitchToResult> {
      const response = await authedFetch('/session/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: id }),
      });
      if (!response) return { kind: 'failed', reason: sessionRefused ? 'unauthorized' : 'offline' };
      if (response.status === 401 || response.status === 403) return { kind: 'failed', reason: 'unauthorized' };
      if (response.status === 404) return { kind: 'failed', reason: 'unknown-account' };
      if (response.status < 200 || response.status >= 300) return { kind: 'failed', reason: 'offline' };

      try {
        const body = (await response.json()) as Record<string, unknown>;
        const expiresAt = toEpochMs(body.expiresAt);
        if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string' || expiresAt === null) {
          return { kind: 'failed', reason: 'io' };
        }
        return {
          kind: 'ok',
          pair: {
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresAt,
            scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : [],
          },
        };
      } catch {
        return { kind: 'failed', reason: 'io' };
      }
    },

    /**
     * Repassa o par rotacionado ao servidor deles (eles são a fonte de verdade
     * do pool) — nunca grava localmente. O corpo é o do cliente oficial:
     * `accessToken`/`refreshToken` na raiz, `label` para dizer de qual conta é,
     * e `expiresAt` em ISO (int cru dá 422 e o par nunca chega ao pool).
     */
    async captureRotatedPair(id, pair): Promise<void> {
      await authedFetch('/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          expiresAt: new Date(pair.expiresAt).toISOString(),
          label: id,
        }),
      }).catch(() => null);
    },

    /**
     * Heartbeat de 15 min (C3) — só enquanto o app está aberto, timer do main
     * (account-engine.ts). Renova o JWT em vez de bater no `/session/heartbeat`
     * sem corpo: aquele endpoint EXIGE o par (`accessToken`/`refreshToken`) e
     * responderia 422 a um POST vazio. Sincronizar o par é papel do
     * `captureRotatedPair`, que tem o par em mãos; aqui o que se mantém viva é
     * a sessão do switcher.
     */
    async keepAlive(): Promise<void> {
      cachedJwt = null;
      await ensureJwt();
    },
  };
}
