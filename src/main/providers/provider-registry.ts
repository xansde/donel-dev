// T1313 (011-contas-e-provedores, etapa 3) — CRUD + validação + resolveLaunch
// (contracts/provider-registry.md). IO e cofre são INJETADOS via
// `ProviderRegistryDeps` (mesmo espírito de `ConfigIoDeps`/`VaultLike`) —
// este módulo não conhece o path real do config.json nem do cofre, só as
// operações. Nenhuma string de provider real (ex. "openrouter") aparece
// aqui — o registry é agnóstico ao formato (D1).

import type {
  ProviderClass,
  ProviderEntry,
  ProviderId,
  ProviderSummaryDto,
  ProvidersConfigDto,
  ResolveLaunchResult,
  SetSecretResult,
  UpsertProviderInput,
  UpsertProviderResult,
  ValidationReason,
} from '../../shared/providers';
import { buildProviderEnv } from './provider-env';
import type { SecretsStatus } from './provider-secrets';
import { isReservedProviderEnvKey } from './reserved-env-keys';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_ID_LENGTH = 32;

export interface ProviderRegistryDeps {
  readonly getConfig: () => ProvidersConfigDto;
  readonly setConfig: (config: ProvidersConfigDto) => void;
  /** `null` = ausente no cofre. */
  readonly readSecret: (providerId: ProviderId, envKey: string) => string | null;
  readonly writeSecret: (providerId: ProviderId, envKey: string, value: string) => SetSecretResult;
  readonly deleteSecrets: (providerId: ProviderId, envKeys: readonly string[]) => void;
  readonly secretsStatus: (providerId: ProviderId, envKeys: readonly string[]) => SecretsStatus;
  /** Cria `<userData>/providers/<configDirName>/` se preciso (vazio, C16/D4) e devolve o path absoluto. */
  readonly ensureConfigDir: (configDirName: string) => string;
}

export interface ProviderRegistry {
  list(): readonly ProviderSummaryDto[];
  upsert(input: UpsertProviderInput): UpsertProviderResult;
  remove(id: ProviderId): void;
  setSecret(id: ProviderId, envKey: string, value: string): SetSecretResult;
  resolveLaunch(id: ProviderId): ResolveLaunchResult;
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH);
  return base.length > 0 && /^[a-z0-9]/.test(base) ? base : `provider-${base}`.slice(0, MAX_ID_LENGTH);
}

function uniqueId(desired: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(desired)) return desired;
  let suffix = 2;
  // Sufixo numérico, truncando a base pra caber no limite de 32 chars.
  while (true) {
    const suffixStr = `-${suffix}`;
    const candidate = `${desired.slice(0, MAX_ID_LENGTH - suffixStr.length)}${suffixStr}`;
    if (!existingIds.has(candidate)) return candidate;
    suffix += 1;
  }
}

interface ValidationError {
  readonly reason: ValidationReason;
  readonly field: string;
}

function validateEntryShape(input: UpsertProviderInput): ValidationError | null {
  if (!input.label || !input.label.trim()) return { reason: 'invalid-label', field: 'label' };

  const providerClass: ProviderClass = input.class;
  if (providerClass !== 'A' && providerClass !== 'B') return { reason: 'invalid-class', field: 'class' };

  if (providerClass === 'A' && input.command !== undefined && input.command !== null) {
    return { reason: 'invalid-command', field: 'command' };
  }
  if (providerClass === 'B' && (!input.command || !input.command.trim())) {
    return { reason: 'invalid-command', field: 'command' };
  }

  const env = input.env ?? {};
  const secretEnvKeys = input.secretEnvKeys ?? [];
  const envKeys = Object.keys(env);

  if (envKeys.some((key) => secretEnvKeys.includes(key))) {
    return { reason: 'secret-key-conflict', field: 'env' };
  }
  if (envKeys.some(isReservedProviderEnvKey)) {
    return { reason: 'reserved-env-key', field: 'env' };
  }
  if (secretEnvKeys.some(isReservedProviderEnvKey)) {
    return { reason: 'reserved-env-key', field: 'secretEnvKeys' };
  }

  return null;
}

export function createProviderRegistry(deps: ProviderRegistryDeps): ProviderRegistry {
  function findEntry(id: ProviderId): ProviderEntry | undefined {
    return deps.getConfig().entries.find((entry) => entry.id === id);
  }

  return {
    list(): readonly ProviderSummaryDto[] {
      return deps.getConfig().entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        class: entry.class,
        secretsStatus: deps.secretsStatus(entry.id, entry.secretEnvKeys),
        supported: entry.class === 'A',
        envKeys: [...Object.keys(entry.env), ...entry.secretEnvKeys],
      }));
    },

    upsert(input: UpsertProviderInput): UpsertProviderResult {
      const shapeError = validateEntryShape(input);
      if (shapeError) return { kind: 'invalid', ...shapeError };

      const config = deps.getConfig();
      const existing = input.id ? config.entries.find((entry) => entry.id === input.id) : undefined;
      if (input.id && !existing) return { kind: 'invalid', reason: 'not-found', field: 'id' };

      const id = existing ? existing.id : uniqueId(slugify(input.label), new Set(config.entries.map((entry) => entry.id)));
      if (!PROVIDER_ID_PATTERN.test(id)) return { kind: 'invalid', reason: 'invalid-id', field: 'id' };

      const entry: ProviderEntry = {
        id,
        label: input.label.trim(),
        class: input.class,
        command: input.class === 'A' ? null : (input.command as string).trim(),
        env: { ...(input.env ?? {}) },
        secretEnvKeys: [...(input.secretEnvKeys ?? [])],
        configDirName: input.configDirName?.trim() || existing?.configDirName || id,
      };

      const nextEntries = existing ? config.entries.map((current) => (current.id === id ? entry : current)) : [...config.entries, entry];
      deps.setConfig({ version: 1, entries: nextEntries });
      return { kind: 'ok', id };
    },

    remove(id: ProviderId): void {
      const entry = findEntry(id);
      if (!entry) return;
      const config = deps.getConfig();
      deps.setConfig({ version: 1, entries: config.entries.filter((current) => current.id !== id) });
      // Apaga os segredos do cofre; NÃO toca o config dir (transcripts são do
      // operador — apagar diretório é gesto humano, contracts/provider-registry.md).
      deps.deleteSecrets(id, entry.secretEnvKeys);
    },

    setSecret(id: ProviderId, envKey: string, value: string): SetSecretResult {
      return deps.writeSecret(id, envKey, value);
    },

    resolveLaunch(id: ProviderId): ResolveLaunchResult {
      const entry = findEntry(id);
      if (!entry) return { kind: 'not-found' };
      if (entry.class !== 'A') return { kind: 'unsupported-class' };

      const status = deps.secretsStatus(entry.id, entry.secretEnvKeys);
      if (status === 'vault-unavailable') return { kind: 'vault-unavailable' };

      const envResult = buildProviderEnv(entry, (envKey) => deps.readSecret(entry.id, envKey));
      if (envResult.kind === 'missing-secret') return envResult;

      const configDir = deps.ensureConfigDir(entry.configDirName);
      return { kind: 'ok', env: envResult.env, configDir };
    },
  };
}
