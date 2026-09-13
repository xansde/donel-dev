// 011-contas-e-provedores, etapa 3, Fase 1 — faxina do cofre no boot
// (plan-etapa-3.md §4.4). O cofre (`accounts-vault.json`) é COMPARTILHADO:
// além das contas locais, ele guarda `seazone:session` (mod seazone) e
// `provider:<id>:<ENV_KEY>` (provider-secrets.ts, T1309) — este último é
// segredo VIVO (ex.: OpenRouter); apagá-lo quebra o provider sem aviso.
// Escopo estritamente de CONTA: id opaco (sem ':') não referenciado em
// `localAccounts` + `seazone:session` (pool Seazone fora, decisão do dono).

import type { AccountsConfig } from '../../shared/accounts';
import { deleteVaultEntries, listVaultKeys, type VaultIoDeps } from './vault';

const SEAZONE_SESSION_KEY = 'seazone:session';

/**
 * PURO — decide quais chaves apagar, nunca toca disco.
 *
 * Guarda (a): só age quando o mod ATIVO é `local` E há pelo menos uma conta
 * cadastrada — config vazia/corrompida (`localAccounts: []`) ou mod `seazone`
 * (que guarda `seazone:session` como chave PRÓPRIA, não órfã) não apagam
 * nada. Sem esta guarda, uma config momentaneamente vazia apagaria as contas
 * boas em vez de só as órfãs.
 *
 * Regras: (b) remove chave SEM ':' que não esteja em `localAccounts[].id`;
 * (c) remove `seazone:session`; (d) NUNCA remove outra chave com ':' —
 * `provider:*` e qualquer namespace desconhecido sobrevivem sempre.
 */
export function planVaultReconciliation(keys: readonly string[], config: AccountsConfig): string[] {
  if (config.mod !== 'local' || config.localAccounts.length === 0) return [];

  const referencedIds = new Set(config.localAccounts.map((account) => account.id));
  return keys.filter((key) => {
    if (key === SEAZONE_SESSION_KEY) return true;
    if (key.includes(':')) return false; // provider:* e qualquer namespace desconhecido sobrevivem (regra d).
    return !referencedIds.has(key);
  });
}

/** Lista as chaves do cofre, planeja e apaga — devolve as que de fato foram removidas. */
export function reconcileAccountsVault(vaultPath: string, io: VaultIoDeps, config: AccountsConfig): readonly string[] {
  const keys = listVaultKeys(vaultPath, io);
  const toRemove = planVaultReconciliation(keys, config);
  return deleteVaultEntries(vaultPath, io, toRemove);
}
