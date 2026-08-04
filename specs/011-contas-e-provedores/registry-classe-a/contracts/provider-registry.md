# Contrato — registry de providers (etapa 3)

Arquivos de destino: `src/main/providers/provider-registry.ts` (CRUD +
validação), `src/main/providers/provider-env.ts` (env puro),
`src/main/providers/session-config-dir.ts` (precedência pura),
`src/main/providers/providers-config.ts` (chave `providers` do config-store),
`src/main/providers/provider-secrets.ts` (adaptador do cofre da etapa 1).

O registry **não** é um framework de plugins: é uma tabela de dados validada.
Não há loader, manifesto nem código carregado de fora do repo (guard-rail
`[T-3]`/`[T-5]`).

```ts
export type ProviderId = string; // slug opaco: ^[a-z0-9][a-z0-9-]{0,31}$

export type ProviderClass = 'A' | 'B';

export interface ProviderEntry {
  readonly id: ProviderId;
  readonly label: string;
  readonly class: ProviderClass;
  /** Classe B apenas; classe A usa sempre o binário `claude` resolvido pelo app. */
  readonly command: string | null;
  /** Env NÃO sensível. Nunca CLAUDE_CONFIG_DIR, nunca marcador de sessão-filha. */
  readonly env: Readonly<Record<string, string>>;
  /** Nomes (não valores) das variáveis cujo segredo vive no cofre. */
  readonly secretEnvKeys: readonly string[];
  /** Nome do diretório sob <userData>/providers/. Default = id. */
  readonly configDirName: string;
}
```

## Operações

```ts
export interface ProviderRegistry {
  /** Nunca lança. Entrada corrompida no config é descartada, o resto sobrevive. */
  list(): readonly ProviderSummaryDto[];

  /** Cria/atualiza a entrada. Segredos vão por `setSecret`, NUNCA por aqui. */
  upsert(input: UpsertProviderInput): UpsertProviderResult;

  /** Remove a entrada e apaga os segredos dela do cofre. NÃO apaga o config dir
   *  (transcripts são do operador — apagar diretório é gesto humano). */
  remove(id: ProviderId): void;

  /** Write-only: grava o valor no cofre e devolve só o status. */
  setSecret(id: ProviderId, envKey: string, value: string): SetSecretResult;

  /** Prepara o lançamento: valida classe, resolve env + config dir (cria o
   *  diretório se preciso). Nunca devolve segredo ao chamador fora do main. */
  resolveLaunch(id: ProviderId): ResolveLaunchResult;
}

export type UpsertProviderResult =
  | { readonly kind: 'ok'; readonly id: ProviderId }
  | { readonly kind: 'invalid'; readonly reason: ValidationReason; readonly field: string };

export type SetSecretResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'vault-unavailable' };

export type ResolveLaunchResult =
  | { readonly kind: 'ok'; readonly env: Record<string, string>; readonly configDir: string }
  | { readonly kind: 'unsupported-class' }        // classe B na v1 (C20)
  | { readonly kind: 'missing-secret'; readonly envKey: string }
  | { readonly kind: 'vault-unavailable' }
  | { readonly kind: 'not-found' };
```

## Invariantes (bateria de teste obrigatória)

1. **Segredo nunca sai**: nenhum retorno de `list`/`upsert`/`setSecret` contém
   valor de env secreto — nem truncado, nem em mensagem de erro. `resolveLaunch`
   devolve env completo, mas o resultado **não cruza o preload**: é consumido
   dentro do main, no spawn.
2. **Classe B nunca spawna** na v1: `resolveLaunch` de `class: 'B'` é sempre
   `unsupported-class`, e a UI mostra recusa explícita (nunca silêncio).
3. **Env do provider nunca sequestra o app**: `CLAUDE_CONFIG_DIR` e os
   marcadores `CLAUDECODE`/`CLAUDE_CODE_*` são rejeitados na validação e
   removidos na montagem, mesmo que já estejam no `config.json` de um usuário
   que editou à mão.
4. **Falta de segredo aborta o lançamento**: sessão nunca nasce com metade do
   env — `missing-secret` para o launcher com mensagem nomeando a variável.
5. **`safeStorage` indisponível** → `vault-unavailable` em escrita e em
   lançamento; **nunca** degrada para texto plano (mesma regra do cofre da
   etapa 1).
6. **Remoção é reversível no que importa**: apaga entrada + segredos, preserva
   o config dir (transcripts).

## Canais IPC (`PROVIDER_CHANNELS`, `src/shared/providers.ts`)

| Canal | Direção | Payload de volta |
|---|---|---|
| `providers:list` | invoke | `ProviderSummaryDto[]` |
| `providers:upsert` | invoke | `UpsertProviderResult` |
| `providers:remove` | invoke | `ProviderSummaryDto[]` |
| `providers:setSecret` | invoke | `SetSecretResult` (**write-only**) |

`providers:resolveLaunch` **não existe como canal**: a resolução acontece no
main durante o `pty:create`, para o env nunca atravessar o preload. O renderer
só manda `providerId` no `PtyCreateOptions`.
