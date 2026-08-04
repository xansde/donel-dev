# Modelo de dados — 011, etapa 2 (demolição + migração)

Tipos **novos** desta etapa (todos temporários por natureza: existem para a
migração e para o registro do que ela fez) e tipos **alterados** pela troca de
fonte do rótulo de sessão. Os tipos da etapa 1 (`AccountId`, `AccountSummary`,
`CredentialPair`, `VaultRecord`, …) ficam como estão — ver `data-model.md`.

Regra que atravessa tudo: **nenhum tipo desta etapa carrega segredo**. O
`CredentialPair` continua confinado a `src/main/accounts/` e não aparece em
nenhuma das interfaces abaixo.

## 1. Inventário de perfis (main — `accounts/migration/profile-inventory.ts`)

```ts
export type ProjectsDirKind = 'junction' | 'real-directory' | 'missing';

export interface ProfileInventoryEntry {
  /** Nome de diretório em ~/.claude-profiles (dado de máquina, nunca de pessoa). */
  readonly slug: string;
  /** De .donel-profile.json; fallback = titleCase do slug. */
  readonly displayName: string;
  readonly path: string;
  /** Só existência — o conteúdo nunca sai de credentials-import.ts. */
  readonly hasCredentials: boolean;
  /** Decide se há transcript a consolidar (C26). */
  readonly projectsDir: ProjectsDirKind;
  /** Nomes de servidor MCP do .claude.json do perfil. NUNCA os blocos. */
  readonly mcpServerNames: readonly string[];
  /** Cópias divergentes do global (só o fato, sem conteúdo). */
  readonly settingsDiffers: boolean;
  readonly claudeMdDiffers: boolean;
}
```

`readProfileInventory(deps)` nunca lança: raiz ausente ⇒ `[]`; entrada que não é
diretório ⇒ ignorada; `.claude.json` corrompido ⇒ `mcpServerNames: []`.

## 2. Diff de MCP (`accounts/migration/mcp-diff.ts`)

```ts
export interface McpDiff {
  readonly profileSlug: string;
  /** Servidores que só o perfil tem — candidatos a decisão manual. */
  readonly onlyInProfile: readonly string[];
  /** Servidores que só o global tem — informativo. */
  readonly onlyInGlobal: readonly string[];
}
```

**Invariante testada**: nenhum valor de configuração (args, env, headers)
aparece na saída — só nomes (C29/D14).

## 3. Consolidação de transcripts (`accounts/migration/transcript-consolidation.ts`)

```ts
export type ConsolidationOutcome =
  | { readonly kind: 'already-consolidated'; readonly reason: 'junction' | 'same-realpath' }
  | { readonly kind: 'nothing-to-copy'; readonly reason: 'missing' }
  | { readonly kind: 'copy'; readonly operations: readonly TranscriptCopyOperation[] };

export interface TranscriptCopyOperation {
  readonly sourcePath: string;
  readonly targetPath: string;
  /** Destino existente ⇒ `skip-existing`; nunca sobrescreve. */
  readonly mode: 'copy' | 'skip-existing';
}
```

Função **pura**: recebe o inventário + os `realpath` já resolvidos e devolve o
plano. Quem toca disco é o executor injetável.

## 4. Estado da migração (persistido — chave `accounts.migration` do `config.json`)

```ts
export type ProfileMigrationStep = 'pending' | 'imported' | 'skipped' | 'absent' | 'failed';

export interface ProfileMigrationState {
  readonly credentials: ProfileMigrationStep;
  readonly transcripts: ProfileMigrationStep;
  /** O humano viu o diff de MCP deste perfil. Nunca implica ter aplicado nada. */
  readonly mcpReviewed: boolean;
}

export interface MigrationState {
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly profiles: Readonly<Record<string /* slug */, ProfileMigrationState>>;
  /** Path do diretório arquivado; `null` enquanto a virada não aconteceu. */
  readonly archivedTo: string | null;
}
```

Persistência: chave `accounts.migration`, com `sanitizeMigrationState` no mesmo
padrão resiliente do `config-store.ts` (ausente/corrompido ⇒ defaults, nunca
lança). **Idempotência** (C28): um perfil em `imported` nunca reaparece como
pendente; `skipped` e `failed` são retomáveis.

## 5. Plano da migração (`accounts/migration/migration-plan.ts`)

```ts
export interface MigrationPlan {
  readonly entries: readonly MigrationPlanEntry[];
  readonly canArchive: boolean;   // true só quando nenhum perfil está 'pending'
}

export interface MigrationPlanEntry {
  readonly slug: string;
  readonly displayName: string;
  readonly credentials: ProfileMigrationStep;
  readonly transcripts: ConsolidationOutcome['kind'];
  readonly mcp: McpDiff;
}
```

Função pura de `(inventário, estado, diffs) ⇒ plano`. É o que a UI renderiza e o
que decide se o botão de arquivar está habilitado — nunca o inverso.

## 6. Arquivamento (`accounts/migration/archive-profiles.ts`)

```ts
export type ArchiveOutcome =
  | { readonly kind: 'archived'; readonly archivedTo: string }
  | { readonly kind: 'aborted'; readonly reason: 'junction-unlink-failed'; readonly profileSlug: string }
  | { readonly kind: 'aborted'; readonly reason: 'rename-failed' }
  | { readonly kind: 'nothing-to-archive' };
```

**Ordem invariante** (C27/D12): desfazer as 6 junctions de **todos** os perfis
⇒ só então renomear a raiz. Falha de unlink ⇒ `aborted`, sem rename. O destino é
`~/.claude-profiles.old`, ou `~/.claude-profiles.old-YYYYMMDD` se já existir.
**Nenhuma operação de deleção existe neste módulo** — o dublê de IO dos testes
nem expõe um método para isso.

## 7. Tipos alterados (troca de fonte, C24)

```ts
// src/shared/index.ts — PtyCreateResult
-  readonly profile?: { readonly slug: string; readonly name: string };
+  readonly account?: { readonly id: AccountId; readonly label: string };

// src/shared/sessionAccountLabel.ts — entrada
-  profile: { slug: string; name: string } | undefined;
+  account: { id: AccountId; label: string } | undefined;

// src/shared/devMode.ts — ArchivedPhaseSession
-  readonly profileSlug: string;
+  readonly accountId: string;   // leitura tolerante do `profileSlug` legado (C30)
```

## 8. Tipos removidos

De `src/shared/profiles.ts` (arquivo inteiro): `PROFILE_CHANNELS`,
`ProfileSummaryDto`, `ProfileDoctorReportDto`, `ProfileQuota`, `QuotaWindow`,
`ProfileHeadroomMap`, `DeleteProfileErrorReason`, `DeleteProfileOutcome`,
`DonelProfilesApi`, `parseAccountNumber`. De `src/shared/transcriptCopy.ts`:
`PlanTranscriptCopyInput` e o plano de cópia entre perfis. De
`src/main/quota-headroom.ts`: `QuotaAxiOutput`, `HeadroomCache`,
`ProfileHeadroomTarget`, `readAllProfilesHeadroom` e os demais exports.

`parseAccountNumber` (normalização "Tecnologia Claude {n}") é a única função
desse conjunto com uso possível fora do mecanismo — se a tela do motor quiser o
mesmo embelezamento de rótulo, ela **muda de casa** para o módulo de contas em
T1221; não fica órfã em `shared/profiles.ts` só para sobreviver.
