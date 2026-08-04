// T1209 (011-contas-e-provedores, etapa 2) — plano da migração
// (`data-model-etapa-2.md` §5). Função pura `(inventário, estado, diffs) ⇒
// plano`. É o que a UI renderiza e o que decide se o botão de arquivar está
// habilitado — nunca o inverso (D10).

import type { McpDiff, MigrationPlan, MigrationPlanEntry, ProfileMigrationStep } from '../../../shared/migration';
import type { ProfileInventoryEntry } from './profile-inventory';
import type { MigrationState } from './migration-state';

export type { MigrationPlan, MigrationPlanEntry } from '../../../shared/migration';

const EMPTY_DIFF = (slug: string): McpDiff => ({ profileSlug: slug, onlyInProfile: [], onlyInGlobal: [] });

/** Puro — nenhuma I/O. Idempotência (C28): perfil `imported` nunca reaparece pendente; `skipped`/`failed` são retomáveis (continuam elegíveis para nova tentativa, mas não bloqueiam o arquivamento). */
export function buildMigrationPlan(
  inventory: readonly ProfileInventoryEntry[],
  state: MigrationState,
  diffs: readonly McpDiff[],
): MigrationPlan {
  const diffBySlug = new Map(diffs.map((diff) => [diff.profileSlug, diff]));

  const entries: MigrationPlanEntry[] = inventory.map((profile) => {
    const profileState = state.profiles[profile.slug];
    const credentials: ProfileMigrationStep = profileState?.credentials ?? (profile.hasCredentials ? 'pending' : 'absent');

    return {
      slug: profile.slug,
      displayName: profile.displayName,
      credentials,
      mcp: diffBySlug.get(profile.slug) ?? EMPTY_DIFF(profile.slug),
    };
  });

  const canArchive = entries.every((entry) => entry.credentials !== 'pending');

  return { entries, canArchive };
}
