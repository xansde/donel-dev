// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — PURO: decide se uma
// mudança de AccountsConfig exige reconstruir o AccountEngine (o mod
// concreto só é resolvido no construtor, account-engine.ts:75 — `updateConfig`,
// account-engine.ts:102, só troca a config em memória) ou se basta
// `updateConfig`. F6 é exatamente essa lacuna: o import de conta com o mod já
// ativo e o handler `accounts:setConfig` só chamavam `updateConfig`, e a
// conta nova só entrava no motor depois de reiniciar o app.

import type { AccountsConfig, LocalAccountMeta } from '../../shared/accounts';

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
