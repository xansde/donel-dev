// T1214 (011-contas-e-provedores, etapa 2) — tipos IPC da migração assistida
// (contracts/migration-etapa-2.md). Espelha o padrão de `src/shared/accounts.ts`:
// o shared só declara canais e DTOs puros, sem I/O. Nada aqui carrega
// segredo — `CredentialPair` fica confinado a `src/main/accounts/`.

export type ProfileMigrationStep = 'pending' | 'imported' | 'skipped' | 'absent' | 'failed';

export interface McpDiff {
  readonly profileSlug: string;
  /** Servidores que só o perfil tem — candidatos a decisão manual. */
  readonly onlyInProfile: readonly string[];
  /** Servidores que só o global tem — informativo. */
  readonly onlyInGlobal: readonly string[];
}

export interface MigrationPlanEntry {
  readonly slug: string;
  readonly displayName: string;
  readonly credentials: ProfileMigrationStep;
  readonly mcp: McpDiff;
}

export interface MigrationPlan {
  readonly entries: readonly MigrationPlanEntry[];
  readonly canArchive: boolean; // true só quando nenhum perfil está 'pending'
}

export type ImportResult =
  | { readonly kind: 'imported'; readonly accountId: string; readonly label: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly reason: 'vault-unavailable' | 'unreadable' | 'invalid-format' };

export type ConsolidationKind = 'already-consolidated' | 'nothing-to-copy' | 'copy';

export interface ConsolidateResult {
  readonly result: ConsolidationKind;
  readonly copied: number;
}

export type ArchiveOutcome =
  | { readonly kind: 'archived'; readonly archivedTo: string }
  | { readonly kind: 'aborted'; readonly reason: 'junction-unlink-failed'; readonly profileSlug: string }
  | { readonly kind: 'aborted'; readonly reason: 'rename-failed' }
  | { readonly kind: 'nothing-to-archive' };

export const MIGRATION_CHANNELS = {
  /** Inventário + diffs + estado ⇒ MigrationPlan. Somente leitura. */
  scan: 'migration:scan',
  /** UM perfil por chamada, com OK explícito na tela. */
  importCredentials: 'migration:importCredentials',
  /** Consolida transcripts de UM perfil (no-op quando junction). */
  consolidateTranscripts: 'migration:consolidateTranscripts',
  /** Marca que o humano viu o diff de MCP de um perfil. Não aplica nada. */
  markMcpReviewed: 'migration:markMcpReviewed',
  /** Desfaz junctions e renomeia a raiz. Habilitado só com plan.canArchive. */
  archive: 'migration:archive',
} as const;

/** API tipada exposta pelo preload em `window.donel.migration` (contextBridge). Sem canal de leitura de credencial, em nenhuma direção. */
export interface DonelMigrationApi {
  scan(): Promise<MigrationPlan>;
  importCredentials(profileSlug: string): Promise<ImportResult>;
  consolidateTranscripts(profileSlug: string): Promise<ConsolidateResult>;
  markMcpReviewed(profileSlug: string): Promise<MigrationPlan>;
  archive(): Promise<ArchiveOutcome>;
}
