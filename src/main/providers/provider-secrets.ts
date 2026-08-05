// T1309 (011-contas-e-provedores, etapa 3) — adaptador do cofre da ETAPA 1
// (`src/main/accounts/vault.ts`) no namespace `provider:<id>:<ENV_KEY>`
// (C19/data-model.md §4). REUSA o cofre existente — não cria um segundo
// arquivo/mecanismo e não altera `vault.ts` (regra dura do tasks.md, T1309
// DoD: `git diff` vazio nesse arquivo). Write-only pra fora deste módulo:
// só `provider-registry.ts` (dentro de `src/main/providers/`) chama
// `readProviderSecret`; `secretsStatus` é a única coisa que sai daqui em
// direção a um DTO que atravessa o preload, e é boolean/enum — nunca valor.

import { decryptVaultEntry, deleteVaultEntry, writeVaultEntry } from '../accounts/vault';
import type { SafeStorageLike, VaultIoDeps, VaultWriteResult } from '../accounts/vault';

export function providerSecretKey(providerId: string, envKey: string): string {
  return `provider:${providerId}:${envKey}`;
}

export function writeProviderSecret(
  vaultPath: string,
  safeStorage: SafeStorageLike,
  io: VaultIoDeps,
  providerId: string,
  envKey: string,
  plainText: string,
): VaultWriteResult {
  return writeVaultEntry(vaultPath, safeStorage, io, providerSecretKey(providerId, envKey), plainText);
}

/** `null` se ausente ou se a decifragem falhar — nunca lança (mesmo contrato de `decryptVaultEntry`). */
export function readProviderSecret(vaultPath: string, safeStorage: SafeStorageLike, io: VaultIoDeps, providerId: string, envKey: string): string | null {
  return decryptVaultEntry(vaultPath, safeStorage, io, providerSecretKey(providerId, envKey));
}

export function deleteProviderSecrets(vaultPath: string, io: VaultIoDeps, providerId: string, envKeys: readonly string[]): void {
  for (const envKey of envKeys) {
    deleteVaultEntry(vaultPath, io, providerSecretKey(providerId, envKey));
  }
}

export type SecretsStatus = 'configured' | 'missing' | 'vault-unavailable';

/**
 * Deriva o status agregado (C19 — "a UI só vê configurado/não
 * configurado/cofre indisponível"): nunca devolve o valor, só o enum.
 * `vault-unavailable` vence quando o `safeStorage` não está disponível
 * (mesma regra do cofre: nunca degrada pra texto plano, então "ler" não
 * seria confiável de qualquer forma). Sem `secretEnvKeys`, não há nada a
 * configurar — `configured` por vacuidade.
 */
export function providerSecretsStatus(
  vaultPath: string,
  safeStorage: SafeStorageLike,
  io: VaultIoDeps,
  providerId: string,
  secretEnvKeys: readonly string[],
): SecretsStatus {
  if (!safeStorage.isEncryptionAvailable()) return 'vault-unavailable';
  const allConfigured = secretEnvKeys.every((envKey) => readProviderSecret(vaultPath, safeStorage, io, providerId, envKey) !== null);
  return allConfigured ? 'configured' : 'missing';
}
