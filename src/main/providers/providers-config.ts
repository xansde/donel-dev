// T1305 (011-contas-e-provedores, etapa 3) — chave `providers` do
// `config.json` (ConfigStore, config-store.ts). Sanitize resiliente no mesmo
// espírito de `sanitizeAccountsConfig`: nunca lança, entrada inválida é
// DESCARTADA isolada (as boas sobrevivem, invariante 5 de data-model.md §1).
// Sem I/O próprio — a leitura/escrita atômica é a mesma de `readAppConfig`/
// `writeAppConfig` (config-store.ts); esta chave só entra no `AppConfig`
// maior, no mesmo padrão da chave `accounts` (etapa 1).

import type { ProviderClass, ProviderEntry, ProvidersConfigDto } from '../../shared/providers';
import { defaultProvidersConfig } from '../../shared/providers';
import { isReservedProviderEnvKey } from './reserved-env-keys';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KNOWN_CLASSES: readonly ProviderClass[] = ['A', 'B'];

function isValidProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value);
}

function isValidEnvMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([, v]) => typeof v === 'string');
}

function isValidSecretEnvKeys(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Uma entrada malformada é descartada sozinha (invariante 5) — nunca deriva
 * um valor default parcial para um campo ruim, como o resto do config-store
 * faz: aqui, campo ruim invalida a ENTRADA inteira, porque uma entrada de
 * provider pela metade (ex.: `class: 'A'` com `command` não-nulo) é pior que
 * nenhuma entrada.
 */
function sanitizeProviderEntry(value: unknown): ProviderEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ProviderEntry>;

  if (!isValidProviderId(candidate.id)) return null;
  if (typeof candidate.label !== 'string' || !candidate.label.trim()) return null;
  if (!(KNOWN_CLASSES as readonly string[]).includes(candidate.class as string)) return null;
  const providerClass = candidate.class as ProviderClass;

  // Invariante 4: classe A exige command === null; classe B exige command não vazio.
  if (providerClass === 'A' && candidate.command !== null && candidate.command !== undefined) return null;
  if (providerClass === 'B' && (typeof candidate.command !== 'string' || !candidate.command.trim())) return null;

  const env = candidate.env ?? {};
  if (!isValidEnvMap(env)) return null;

  const secretEnvKeys = candidate.secretEnvKeys ?? [];
  if (!isValidSecretEnvKeys(secretEnvKeys)) return null;

  const envKeys = Object.keys(env as Record<string, string>);
  // Invariante 2: nenhuma chave de `env` pertence a `secretEnvKeys`.
  if (envKeys.some((key) => (secretEnvKeys as readonly string[]).includes(key))) return null;
  // Invariante 3: nenhuma chave (de `env` OU `secretEnvKeys`) é reservada
  // (CLAUDE_CONFIG_DIR / marcador de sessão-filha).
  if (envKeys.some(isReservedProviderEnvKey)) return null;
  if ((secretEnvKeys as readonly string[]).some(isReservedProviderEnvKey)) return null;

  if (typeof candidate.configDirName !== 'string' || !candidate.configDirName.trim()) return null;

  return {
    id: candidate.id,
    label: candidate.label,
    class: providerClass,
    command: providerClass === 'A' ? null : (candidate.command as string),
    env: env as Record<string, string>,
    secretEnvKeys: secretEnvKeys as readonly string[],
    configDirName: candidate.configDirName,
  };
}

/**
 * Nunca lança para config ausente/corrompida/tipos errados — cai no registry
 * vazio (`{ version: 1, entries: [] }`, C14/D6). Cada entrada é validada
 * isoladamente; a inválida é descartada, o resto do registry sobrevive.
 */
export function sanitizeProvidersConfig(parsed: unknown): ProvidersConfigDto {
  const defaults = defaultProvidersConfig();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;

  const candidate = parsed as Partial<ProvidersConfigDto>;
  if (!Array.isArray(candidate.entries)) return defaults;

  const entries: ProviderEntry[] = [];
  for (const rawEntry of candidate.entries) {
    const entry = sanitizeProviderEntry(rawEntry);
    if (entry) entries.push(entry);
  }

  return { version: 1, entries };
}
