// T1209 (011-contas-e-provedores, etapa 2) — estado persistido da migração
// (`data-model-etapa-2.md` §4, chave `accounts.migration` do `config.json`).
// Sanitize resiliente, mesmo padrão de `sanitizeAppConfig`/`sanitizeAccountsConfig`:
// nunca lança, campo a campo cai no default correspondente.

export type ProfileMigrationStep = 'pending' | 'imported' | 'skipped' | 'absent' | 'failed';

const KNOWN_STEPS: readonly ProfileMigrationStep[] = ['pending', 'imported', 'skipped', 'absent', 'failed'];

export interface ProfileMigrationState {
  readonly credentials: ProfileMigrationStep;
  readonly transcripts: ProfileMigrationStep;
  /** O humano viu o diff de MCP deste perfil. Nunca implica ter aplicado nada. */
  readonly mcpReviewed: boolean;
}

export interface MigrationState {
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly profiles: Readonly<Record<string, ProfileMigrationState>>;
  /** Path do diretório arquivado; `null` enquanto a virada não aconteceu. */
  readonly archivedTo: string | null;
}

export function defaultMigrationState(): MigrationState {
  return { startedAt: null, completedAt: null, profiles: {}, archivedTo: null };
}

function isStep(value: unknown): value is ProfileMigrationStep {
  return typeof value === 'string' && (KNOWN_STEPS as readonly string[]).includes(value);
}

function sanitizeProfileMigrationState(value: unknown): ProfileMigrationState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ProfileMigrationState>;
  return {
    credentials: isStep(candidate.credentials) ? candidate.credentials : 'pending',
    transcripts: isStep(candidate.transcripts) ? candidate.transcripts : 'pending',
    mcpReviewed: candidate.mcpReviewed === true,
  };
}

function sanitizeProfiles(value: unknown): Record<string, ProfileMigrationState> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, ProfileMigrationState> = {};
  for (const [slug, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!slug) continue;
    const state = sanitizeProfileMigrationState(entry);
    if (state) sanitized[slug] = state;
  }
  return sanitized;
}

function sanitizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Nunca lança: ausente/corrompido/chave desconhecida/slug vazio caem no default correspondente. */
export function sanitizeMigrationState(parsed: unknown, defaults: MigrationState): MigrationState {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
  const candidate = parsed as Partial<MigrationState>;

  return {
    startedAt: sanitizeNullableNumber(candidate.startedAt),
    completedAt: sanitizeNullableNumber(candidate.completedAt),
    profiles: sanitizeProfiles(candidate.profiles),
    archivedTo: sanitizeNullableString(candidate.archivedTo),
  };
}
