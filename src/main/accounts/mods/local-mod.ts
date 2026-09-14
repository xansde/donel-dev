// T1118 (011-contas-e-provedores, etapa 1) — mod local (pool próprio),
// contracts/backends-http.md §B + D4 do plan.md: switch-time-only, SEM
// `keepAlive` (decisão fechada — sem heartbeat, sem agendador). No switch: se
// o par da conta que entra estiver vencido, tenta UM refresh HTTP de
// fallback e grava o resultado no cofre ANTES de usá-lo (refresh token de
// uso único: perder o par novo inutiliza a conta). Recusa do refresh ->
// `expired-credentials` (a UI pede re-login uma vez).
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D4) — `token-refresh.ts` agora
// distingue `rejected` (recusa de verdade) de `unavailable` (rede/timeout —
// nunca dá pra saber se o servidor teria aceitado): só `rejected` vira
// `expired-credentials` aqui; `unavailable` vira `offline`, o mesmo `reason`
// que qualquer outra falha de rede do mod já usa.
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D7/D9, adendo ao desenho) — o
// access token do CLI vence ~8h depois de emitido, e `listAccounts` lia a
// carga de TODA conta com o par do cofre. Dois furos: (1) o par da conta
// ATIVA no cofre fica velho assim que o CLI renova o de `~/.claude` por fora
// (o refresh token que o cofre guarda pra ela já foi consumido) — corrigido
// lendo a carga da ativa com o par VIVO (`getActiveAccountId`/
// `readLiveCredentialPair`, D7), NUNCA renovando-a pelo cofre; (2) o par de
// uma conta PARADA vence sem ninguém renovar, e carga desconhecida nunca é
// destino de auto-switch (C9) — corrigido em `ensureFreshPair` (D9): a
// leitura de carga renova o par vencido de uma conta parada com o MESMO
// protocolo do switch (refresh -> grava no cofre ANTES de usar ->
// `onPairRefreshed`), com no máximo UMA renovação em voo por conta (o
// refresh token é de uso único — leitura e troca simultâneas da mesma conta
// esperam a MESMA promessa, nunca disparam dois refresh).

import type { AccountId, AccountLoad, AccountSummary, LocalAccountMeta } from '../../../shared/accounts';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../account-mod';
import type { ReconnectRegistry } from '../reconnect-registry';
import { refreshCredentialPair, type RefreshResult } from '../token-refresh';
import { readAccountUsage, type HttpFetchLike, type UsageWindows } from '../usage-client';
import type { VaultLike } from '../vault';

export interface LocalModDeps {
  /** Metadado NÃO sensível do pool local (config-store, chave `accounts.localAccounts`). */
  readonly accounts: readonly LocalAccountMeta[];
  readonly vault: VaultLike;
  /** HTTP do endpoint de usage (mod local só, `api.anthropic.com`). */
  readonly fetchImpl?: HttpFetchLike;
  /** Injetável para teste — default `refreshCredentialPair` (token-refresh.ts). */
  readonly refreshImpl?: (refreshToken: string, options?: { fetchImpl?: HttpFetchLike }) => Promise<RefreshResult>;
  /**
   * D7 (adendo) — id da conta ativa AGORA, segundo o motor. Sem esta dep (ou
   * devolvendo `null`), nenhuma conta é tratada como ativa aqui — todas
   * seguem o caminho de conta parada (D9). Nenhuma conta que não seja esta
   * usa o par vivo.
   */
  readonly getActiveAccountId?: () => AccountId | null;
  /**
   * D7 (adendo) — lê `<claudeHome>/.credentials.json` (só leitura, nunca
   * renova, nunca grava). Sem par vivo legível (dep ausente ou `null`), cai
   * no par do cofre — comportamento de hoje.
   */
  readonly readLiveCredentialPair?: () => CredentialPair | null;
  /**
   * D9 (adendo) — o MESMO registro do motor (account-engine.ts,
   * reconnect-registry.ts). Ausente = nenhuma conta é tratada como já
   * marcada (sempre tenta `ensureFreshPair`) e nenhuma marca é gravada.
   */
  readonly reconnectRegistry?: ReconnectRegistry;
  /** Injetável para teste — default `Date.now`. */
  readonly now?: () => number;
  /**
   * D9 (adendo) — chamado depois que o par renovado por `ensureFreshPair` foi
   * gravado no cofre com sucesso. NUNCA recebe o par — só o id e a origem
   * (`read` = veio de `listAccounts`, `switch` = veio de `switchTo`).
   */
  readonly onPairRefreshed?: (id: AccountId, trigger: 'read' | 'switch') => void;
}

function parsePairFromVault(raw: string | null): CredentialPair | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CredentialPair>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((s): s is string => typeof s === 'string') : [],
    };
  } catch {
    return null;
  }
}

function loadFromUsage(usage: UsageWindows, atMs: number): AccountLoad {
  return { fiveHour: usage.fiveHour, sevenDay: usage.sevenDay, sonnet: null, readAt: new Date(atMs).toISOString() };
}

/** D9 (adendo) — resultado interno de `ensureFreshPair`. Nunca lança. */
type EnsureFreshPairResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'missing' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'vault-write-failed' };

export function createLocalMod(deps: LocalModDeps): AccountMod {
  const refresh = deps.refreshImpl ?? refreshCredentialPair;
  const now = deps.now ?? Date.now;
  /** D9 (adendo) — no máx. UMA renovação em voo por conta; quem chega no meio (leitura OU troca) espera a MESMA promessa (refresh token de uso único). Limpo no `finally`. */
  const pendingRefreshes = new Map<AccountId, Promise<EnsureFreshPairResult>>();

  function readPair(id: string): CredentialPair | null {
    return parsePairFromVault(deps.vault.read(id));
  }

  /**
   * D9 (adendo) — garante um par utilizável para `id`: lê o cofre; ausente ->
   * `missing`; ainda válido -> devolve como está; vencido -> UM refresh
   * (grava no cofre ANTES de devolver — uso único; falha de gravação ->
   * `vault-write-failed`; recusa/indisponibilidade do refresh passam
   * adiante). `trigger` só identifica quem pediu, para `onPairRefreshed` —
   * não muda o comportamento. Nunca lança.
   */
  async function ensureFreshPair(id: AccountId, trigger: 'read' | 'switch'): Promise<EnsureFreshPairResult> {
    const inFlight = pendingRefreshes.get(id);
    if (inFlight) return inFlight;

    const pair = readPair(id);
    if (!pair) return { kind: 'missing' };
    if (pair.expiresAt > now()) return { kind: 'ok', pair };

    const refreshPromise = (async (): Promise<EnsureFreshPairResult> => {
      const result = await refresh(pair.refreshToken, { fetchImpl: deps.fetchImpl });
      if (result.kind !== 'ok') return result.reason === 'rejected' ? { kind: 'rejected' } : { kind: 'unavailable' };

      // Uso único: grava no cofre ANTES de qualquer coisa usar o par novo.
      const writeResult = deps.vault.write(id, JSON.stringify(result.pair));
      if (writeResult.kind !== 'ok') return { kind: 'vault-write-failed' };

      deps.onPairRefreshed?.(id, trigger);
      return { kind: 'ok', pair: result.pair };
    })();

    pendingRefreshes.set(id, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      pendingRefreshes.delete(id);
    }
  }

  return {
    id: 'local',

    /**
     * `active` sempre `false` — sobrescrito pelo motor. `available` = existe
     * par gravado no cofre para esta conta (mesmo vencido). Carga lida sob
     * demanda (C4), nunca lança (usage-client já absorve falha em `null`).
     *
     * D7/D9 (adendo): a conta ATIVA lê a carga com o par VIVO quando legível
     * — nunca renova pelo cofre (o refresh token dela lá já pode ter sido
     * consumido pelo CLI, e renovar daria recusa falsa). As demais contas
     * garantem um par fresco via `ensureFreshPair`, exceto as já marcadas no
     * registro de reconectar — essas leem com o par que houver, sem tentar
     * de novo a cada leitura.
     */
    async listAccounts(): Promise<ListAccountsResult> {
      const activeId = deps.getActiveAccountId?.() ?? null;
      const accounts: AccountSummary[] = [];

      for (const meta of deps.accounts) {
        const vaultPair = readPair(meta.id);
        const available = vaultPair !== null;
        let load: AccountLoad | null = null;

        if (meta.id === activeId) {
          // D7 — nunca passa por ensureFreshPair: renovar a ativa pelo cofre
          // usaria um refresh token que o CLI já pode ter gasto por fora.
          const livePair = deps.readLiveCredentialPair?.() ?? null;
          const tokenPair = livePair ?? vaultPair;
          if (tokenPair) {
            const usage = await readAccountUsage(tokenPair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          }
        } else if (deps.reconnectRegistry?.has(meta.id)) {
          // D9 — já marcada: não renova, lê com o par que houver (mesmo vencido).
          if (vaultPair) {
            const usage = await readAccountUsage(vaultPair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          }
        } else {
          const fresh = await ensureFreshPair(meta.id, 'read');
          if (fresh.kind === 'ok') {
            const usage = await readAccountUsage(fresh.pair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          } else if (fresh.kind === 'rejected') {
            deps.reconnectRegistry?.mark(meta.id);
          }
          // 'unavailable' / 'vault-write-failed' / 'missing': carga null, sem marca.
        }

        accounts.push({ id: meta.id, label: meta.label, plan: meta.plan, active: false, available, load });
      }
      return { kind: 'ok', accounts };
    },

    /**
     * D9 (adendo) — sempre garante um par fresco via `ensureFreshPair`,
     * inclusive para conta já marcada no registro: a troca MANUAL é o gesto
     * de tentar de novo.
     */
    async switchTo(id): Promise<SwitchToResult> {
      const meta = deps.accounts.find((a) => a.id === id);
      if (!meta) return { kind: 'failed', reason: 'unknown-account' };

      const fresh = await ensureFreshPair(id, 'switch');
      if (fresh.kind === 'ok') return { kind: 'ok', pair: fresh.pair };
      if (fresh.kind === 'missing') return { kind: 'failed', reason: 'unknown-account' };
      if (fresh.kind === 'rejected') return { kind: 'failed', reason: 'expired-credentials' };
      // 'unavailable' | 'vault-write-failed'
      return { kind: 'failed', reason: 'offline' };
    },

    /** Grava o par rotacionado no cofre — a mesma escrita write-only de sempre, nada sai daqui. */
    async captureRotatedPair(id, pair): Promise<void> {
      deps.vault.write(id, JSON.stringify(pair));
    },

    // SEM `keepAlive` — switch-time-only é decisão fechada (D4). O motor
    // testa a presença deste método antes de chamar (contracts/account-mod.md).
  };
}
