// T1105 (011-contas-e-provedores, etapa 1) — chave `accounts` do
// `config.json` (ConfigStore, config-store.ts). Sanitize resiliente no mesmo
// espírito de `sanitizeAppConfig`: nunca lança, campo a campo cai no default
// correspondente. Sem I/O próprio — a leitura/escrita atômica é a mesma de
// `readAppConfig`/`writeAppConfig` (config-store.ts), esta chave só entra no
// objeto `AppConfig` maior.

import type { AccountId, AccountsConfig, AutoSwitchPolicy, LocalAccountMeta, ModId, SeazonePoolConfig } from '../../shared/accounts';

const KNOWN_MOD_IDS: readonly ModId[] = ['seazone', 'local'];

function isModId(value: unknown): value is ModId {
  return typeof value === 'string' && (KNOWN_MOD_IDS as readonly string[]).includes(value);
}

function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function sanitizeAutoSwitchPolicy(value: unknown, fallback: AutoSwitchPolicy): AutoSwitchPolicy {
  if (typeof value !== 'object' || value === null) return fallback;
  const candidate = value as Partial<AutoSwitchPolicy>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    switchAtLoad: isValidThreshold(candidate.switchAtLoad) ? candidate.switchAtLoad : fallback.switchAtLoad,
    minAdvantage: isValidThreshold(candidate.minAdvantage) ? candidate.minAdvantage : fallback.minAdvantage,
  };
}

function sanitizeSeazoneConfig(value: unknown): SeazonePoolConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { baseUrl?: unknown; preferredLabels?: unknown };
  if (typeof candidate.baseUrl !== 'string' || !candidate.baseUrl.trim()) return null;
  const preferredLabels = sanitizePreferredLabels(candidate.preferredLabels);
  return preferredLabels.length > 0 ? { baseUrl: candidate.baseUrl, preferredLabels } : { baseUrl: candidate.baseUrl };
}

/** B25 — strings não vazias, aparadas, sem repetição; qualquer outra coisa some. */
function sanitizePreferredLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const labels = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  return [...new Set(labels)];
}

/**
 * Entrada malformada (sem id/label válidos) é descartada isolada — as demais
 * sobrevivem (mesmo espírito de `sanitizeSessionRegistry`).
 *
 * 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — `fingerprint` (opaco,
 * só existe em conta de login isolado) é preservado quando for string não
 * vazia; caso contrário a CHAVE nem entra no objeto de saída (nunca vira
 * `fingerprint: undefined`) — é assim que uma conta antiga (token colado à
 * mão, migrada de perfil) permanece indistinguível de uma que nunca teve
 * fingerprint.
 */
function sanitizeLocalAccounts(value: unknown): readonly LocalAccountMeta[] {
  if (!Array.isArray(value)) return [];
  const sanitized: LocalAccountMeta[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Partial<LocalAccountMeta>;
    if (typeof candidate.id !== 'string' || !candidate.id) continue;
    if (typeof candidate.label !== 'string' || !candidate.label.trim()) continue;
    const plan = typeof candidate.plan === 'string' ? candidate.plan : null;
    const fingerprint = typeof candidate.fingerprint === 'string' && candidate.fingerprint ? candidate.fingerprint : null;
    sanitized.push(fingerprint ? { id: candidate.id, label: candidate.label, plan, fingerprint } : { id: candidate.id, label: candidate.label, plan });
  }
  return sanitized;
}

function sanitizeAccountId(value: unknown): AccountId | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Nunca lança para config ausente/corrompida/tipos errados — campo a campo
 * cai no default correspondente (mesmo padrão de `sanitizeAppConfig`,
 * config-store.ts). `parsed` não-objeto (ou array) devolve `defaults` inteiro.
 */
export function sanitizeAccountsConfig(parsed: unknown, defaults: AccountsConfig): AccountsConfig {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
  const candidate = parsed as Partial<AccountsConfig>;

  return {
    mod: isModId(candidate.mod) ? candidate.mod : null,
    autoSwitch: sanitizeAutoSwitchPolicy(candidate.autoSwitch, defaults.autoSwitch),
    claudeHome: typeof candidate.claudeHome === 'string' && candidate.claudeHome.trim() ? candidate.claudeHome : null,
    seazone: sanitizeSeazoneConfig(candidate.seazone),
    localAccounts: sanitizeLocalAccounts(candidate.localAccounts),
    activeAccountId: sanitizeAccountId(candidate.activeAccountId),
  };
}

/** DTO idêntico ao domínio — nada sensível em `AccountsConfig` (segredo mora só no cofre, vault.ts). */
export function toAccountsConfigDto(config: AccountsConfig): AccountsConfig {
  return config;
}
