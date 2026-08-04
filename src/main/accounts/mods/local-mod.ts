// T1118 (011-contas-e-provedores, etapa 1) — mod local (pool próprio),
// contracts/backends-http.md §B + D4 do plan.md: switch-time-only, SEM
// `keepAlive` (decisão fechada — sem heartbeat, sem agendador). No switch: se
// o par da conta que entra estiver vencido, tenta UM refresh HTTP de
// fallback e grava o resultado no cofre ANTES de usá-lo (refresh token de
// uso único: perder o par novo inutiliza a conta). Recusa do refresh ->
// `expired-credentials` (a UI pede re-login uma vez).

import type { AccountLoad, AccountSummary, LocalAccountMeta } from '../../../shared/accounts';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../account-mod';
import { refreshCredentialPair, type RefreshResult } from '../token-refresh';
import { readAccountUsage, type HttpFetchLike } from '../usage-client';
import type { VaultLike } from '../vault';

export interface LocalModDeps {
  /** Metadado NÃO sensível do pool local (config-store, chave `accounts.localAccounts`). */
  readonly accounts: readonly LocalAccountMeta[];
  readonly vault: VaultLike;
  /** HTTP do endpoint de usage (mod local só, `api.anthropic.com`). */
  readonly fetchImpl?: HttpFetchLike;
  /** Injetável para teste — default `refreshCredentialPair` (token-refresh.ts). */
  readonly refreshImpl?: (refreshToken: string, options?: { fetchImpl?: HttpFetchLike }) => Promise<RefreshResult>;
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

export function createLocalMod(deps: LocalModDeps): AccountMod {
  const refresh = deps.refreshImpl ?? refreshCredentialPair;

  function readPair(id: string): CredentialPair | null {
    return parsePairFromVault(deps.vault.read(id));
  }

  return {
    id: 'local',

    /** `active` sempre `false` — sobrescrito pelo motor. `available` = existe par utilizável no cofre para esta conta. Carga lida sob demanda (C4), nunca lança (usage-client já absorve falha em `null`). */
    async listAccounts(): Promise<ListAccountsResult> {
      const accounts: AccountSummary[] = [];
      for (const meta of deps.accounts) {
        const pair = readPair(meta.id);
        let load: AccountLoad | null = null;
        if (pair) {
          const usage = await readAccountUsage(pair.accessToken, { fetchImpl: deps.fetchImpl });
          if (usage) load = { fiveHour: usage.fiveHour, sevenDay: usage.sevenDay, sonnet: null, readAt: new Date().toISOString() };
        }
        accounts.push({ id: meta.id, label: meta.label, plan: meta.plan, active: false, available: pair !== null, load });
      }
      return { kind: 'ok', accounts };
    },

    async switchTo(id): Promise<SwitchToResult> {
      const meta = deps.accounts.find((a) => a.id === id);
      if (!meta) return { kind: 'failed', reason: 'unknown-account' };

      let pair = readPair(id);
      if (!pair) return { kind: 'failed', reason: 'unknown-account' };

      // Fallback SÓ quando o par está vencido no momento do switch (D4) —
      // nunca periódico, nunca fora deste caminho.
      if (pair.expiresAt <= Date.now()) {
        const result = await refresh(pair.refreshToken, { fetchImpl: deps.fetchImpl });
        if (result.kind !== 'ok') return { kind: 'failed', reason: 'expired-credentials' };

        // Uso único: grava no cofre ANTES de usar. Falha de gravação aborta o switch.
        const writeResult = deps.vault.write(id, JSON.stringify(result.pair));
        if (writeResult.kind !== 'ok') return { kind: 'failed', reason: 'offline' };
        pair = result.pair;
      }

      return { kind: 'ok', pair };
    },

    /** Grava o par rotacionado no cofre — a mesma escrita write-only de sempre, nada sai daqui. */
    async captureRotatedPair(id, pair): Promise<void> {
      deps.vault.write(id, JSON.stringify(pair));
    },

    // SEM `keepAlive` — switch-time-only é decisão fechada (D4). O motor
    // testa a presença deste método antes de chamar (contracts/account-mod.md).
  };
}
