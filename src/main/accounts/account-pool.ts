// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — PURO: decide se uma
// mudança de AccountsConfig exige reconstruir o AccountEngine (o mod
// concreto só é resolvido no construtor, account-engine.ts:75 — `updateConfig`,
// account-engine.ts:102, só troca a config em memória) ou se basta
// `updateConfig`. F6 é exatamente essa lacuna: o import de conta com o mod já
// ativo e o handler `accounts:setConfig` só chamavam `updateConfig`, e a
// conta nova só entrava no motor depois de reiniciar o app.

import type { AccountId, AccountsConfig, LocalAccountMeta } from '../../shared/accounts';
import { defaultAccountsConfig } from '../../shared/accounts';

const SEAZONE_SESSION_KEY = 'seazone:session';

/** Comparação posicional (não só de conjunto) — troca de ordem também conta como mudança, já que a ordem é o que a UI lista. */
function localAccountsChanged(prev: readonly LocalAccountMeta[], next: readonly LocalAccountMeta[]): boolean {
  if (prev.length !== next.length) return true;
  return prev.some((account, index) => {
    const other = next[index];
    return account.id !== other.id || account.label !== other.label || account.plan !== other.plan;
  });
}

/**
 * `true` quando `mod`, `seazone.baseUrl` ou `localAccounts` (id/label/plan/
 * ordem/tamanho) mudaram — só o construtor do `AccountEngine` resolve o mod
 * concreto com a lista nova. `false` para mudanças só de `autoSwitch`,
 * `claudeHome` ou `activeAccountId`, que `updateConfig` já absorve sem
 * reconstruir.
 */
export function needsEngineRebuild(prev: AccountsConfig, next: AccountsConfig): boolean {
  if (prev.mod !== next.mod) return true;
  if (prev.seazone?.baseUrl !== next.seazone?.baseUrl) return true;
  if (localAccountsChanged(prev.localAccounts, next.localAccounts)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 1 — "Remover conta" (plan-etapa-3.md
// §4.3). Hoje não existe remover; `disconnectMod` voltava ao default e
// deixava os pares no cofre (origem das 8 órfãs medidas em 13/09). Os dois
// planos abaixo são PUROS: só calculam a config final + as chaves que o
// cofre deve perder — quem chama (index.ts) aplica a config (persist + motor)
// e apaga do cofre.
// ---------------------------------------------------------------------------

export type RemoveAccountPlan =
  | { readonly kind: 'remove'; readonly config: AccountsConfig; readonly vaultKeys: string[] }
  | { readonly kind: 'blocked'; readonly reason: 'active-account' }
  | { readonly kind: 'unknown-account' };

/**
 * Remover a conta ATIVA é BLOQUEADO: o par dela vive só no `~/.claude` (não
 * no cofre, ver claude-state.ts), e sem `activeAccountId` a próxima troca não
 * tem `fromId` pra capturar o par rotacionado (`AccountEngine.switchTo`) — a
 * conta morreria. Trocar antes é o caminho (a UI orienta isso).
 */
export function planRemoveAccount(config: AccountsConfig, id: AccountId): RemoveAccountPlan {
  const exists = config.localAccounts.some((account) => account.id === id);
  if (!exists) return { kind: 'unknown-account' };
  if (id === config.activeAccountId) return { kind: 'blocked', reason: 'active-account' };

  return {
    kind: 'remove',
    config: { ...config, localAccounts: config.localAccounts.filter((account) => account.id !== id) },
    vaultKeys: [id],
  };
}

export interface DisconnectPlan {
  readonly config: AccountsConfig;
  readonly vaultKeys: string[];
}

/**
 * Volta ao default (motor inerte, C2) preservando só `claudeHome` (não é
 * segredo, é preferência de onde o motor escreveria se reconectado). As
 * chaves agendadas pro cofre são as das contas locais que estão SAINDO da
 * config + `seazone:session` (pool Seazone fora, decisão do dono) — nunca
 * `provider:*` (namespace do cofre compartilhado com os providers classe A).
 */
export function planDisconnect(config: AccountsConfig): DisconnectPlan {
  return {
    config: { ...defaultAccountsConfig(), claudeHome: config.claudeHome },
    vaultKeys: [...config.localAccounts.map((account) => account.id), SEAZONE_SESSION_KEY],
  };
}
