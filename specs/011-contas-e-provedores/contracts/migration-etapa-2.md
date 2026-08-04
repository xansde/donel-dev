# Contrato — IPC e módulos da migração (011, etapa 2)

Espelha o padrão dos contratos da etapa 1 (`contracts/ipc-accounts.md`). Tudo
aqui é **temporário por natureza**: os canais existem enquanto houver
`~/.claude-profiles` para migrar, e a tela some depois da virada.

## 1. Canais IPC

```ts
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
```

| Canal | Entrada | Saída |
|---|---|---|
| `migration:scan` | — | `MigrationPlan` |
| `migration:importCredentials` | `{ profileSlug: string }` | `{ result: 'imported' \| 'absent' \| 'failed'; reason?: 'vault-unavailable' \| 'unreadable' \| 'invalid-format' }` |
| `migration:consolidateTranscripts` | `{ profileSlug: string }` | `{ result: ConsolidationOutcome['kind']; copied: number }` |
| `migration:markMcpReviewed` | `{ profileSlug: string }` | `MigrationPlan` |
| `migration:archive` | — | `ArchiveOutcome` |

### Invariantes dos canais

1. **Nenhum payload de saída contém segredo** — nem token, nem prefixo, nem
   tamanho. `importCredentials` devolve **enum**, não dado.
2. **Um perfil por chamada.** Não existe "importar tudo": o OK humano é perfil a
   perfil (decisão do discovery, ticket 06).
3. **`archive` recusa** quando algum perfil está `pending` — a checagem é do
   main, não da UI (botão desabilitado é conforto, não gate).
4. **Nenhum canal deleta nada.** Não existe `migration:delete`, em canal nenhum,
   em fase nenhuma desta etapa.
5. **Todos são idempotentes**: repetir uma chamada já concluída devolve o mesmo
   resultado sem refazer I/O destrutiva.

## 2. Ponte do preload

```ts
window.donel.migration = {
  scan(): Promise<MigrationPlan>;
  importCredentials(profileSlug: string): Promise<ImportResult>;
  consolidateTranscripts(profileSlug: string): Promise<ConsolidateResult>;
  markMcpReviewed(profileSlug: string): Promise<MigrationPlan>;
  archive(): Promise<ArchiveOutcome>;
};
```

Mesmo padrão de `window.donel.accounts.*` da etapa 1. Sem canal de leitura de
credencial, em nenhuma direção.

## 3. Contrato dos módulos (main)

### `profile-inventory.ts`

```ts
export interface ProfileInventoryDeps {
  homedir(): string;
  readDir(path: string): readonly string[];       // nunca lança ⇒ []
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  readJson(path: string): Record<string, unknown> | null;
  readTextOrNull(path: string): string | null;
  realpathOrNull(path: string): string | null;
}
export function readProfileInventory(deps: ProfileInventoryDeps): readonly ProfileInventoryEntry[];
```

**Nunca lê `.credentials.json`** — só verifica existência. Nunca lança.

### `credentials-import.ts` (dentro da fronteira de credencial)

```ts
export function importProfileCredentials(
  profileSlug: string,
  deps: { readCredentialsFile(path: string): CredentialPair | null; vault: Vault; paths: … },
): ImportResult;
```

Invariantes: (a) o par vai do arquivo direto para o cofre da etapa 1, sem passar
por variável de retorno; (b) cofre indisponível ⇒ recusa **antes** de ler o
arquivo; (c) nenhum `console.*` com conteúdo de par; (d) uma conta do pool local
é criada com `{ id opaco, label = displayName do perfil }` — nunca e-mail (LGPD).

### `archive-profiles.ts`

```ts
export interface ArchiveIoDeps {
  unlinkJunction(path: string): void;   // rmdir do link; NUNCA remove o alvo
  rename(from: string, to: string): void;
  exists(path: string): boolean;
  isJunction(path: string): boolean;
  // NOTA DE DESENHO: não existe `remove`/`rm` aqui, de propósito (D13).
}
export function archiveProfiles(deps: ArchiveIoDeps & { paths: … }, now: Date): ArchiveOutcome;
```

Ordem invariante: **todos os unlinks ⇒ um rename**. Falha de unlink ⇒ `aborted`
nomeando o perfil, sem rename.

## 4. O que este contrato NÃO tem

- Nenhum canal de merge de MCP, em nenhuma direção.
- Nenhum canal de deleção de perfil ou de diretório arquivado.
- Nenhum canal que devolva conteúdo de `.credentials.json`, `.claude.json`,
  `settings.json` ou `CLAUDE.md` de perfil — só nomes, contagens e enums.
