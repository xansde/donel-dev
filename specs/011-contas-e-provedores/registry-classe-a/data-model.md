# Data model — 011, etapa 3 (registry de providers, classe A)

Complemento de `plan.md`. Tipos em inglês; UI em pt-BR. Nenhum campo abaixo
carrega segredo — o valor de segredo vive **só** no cofre (C19).

## 1. Entrada de registry (`ProviderEntry`)

Persistida na chave `providers` do `config.json` (`userData`).

| Campo | Tipo | Nota |
|---|---|---|
| `id` | `ProviderId` (slug opaco) | Gerado do rótulo; estável, usado no caminho do config dir e no namespace do cofre (C22) |
| `label` | `string` | Texto livre do operador, exibido na UI. Nunca nome de pessoa (LGPD) |
| `class` | `'A' \| 'B'` | `'A'` = Claude-compatible (único com spawn na v1); `'B'` = CLI terceiro, aceito e persistido, recusado no lançamento (C20) |
| `command` | `string \| null` | Só classe B. Classe A **sempre** usa o binário `claude` resolvido por `claude-executable.ts`; o campo é `null` e a validação recusa valor não nulo em `'A'` |
| `env` | `Record<string, string>` | Env **não sensível** (ex.: `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`). Genérico de propósito (C15) |
| `secretEnvKeys` | `readonly string[]` | Nomes das variáveis cujo valor está no cofre (ex.: `ANTHROPIC_AUTH_TOKEN`). O valor **nunca** aparece aqui |
| `configDirName` | `string` | Nome do diretório sob `<userData>/providers/`; default = `id` (C16) |

**Invariantes** (testadas em `providers-config.test.ts` e
`provider-registry.test.ts`):

1. `id` único, `^[a-z0-9][a-z0-9-]{0,31}$`; colisão na criação → sufixo
   numérico, nunca sobrescrita silenciosa.
2. Nenhuma chave de `env` pertence a `secretEnvKeys` (segredo nunca em texto
   plano no `config.json`).
3. Nenhuma chave de `env` está na lista de marcadores de sessão-filha do Claude
   Code (`CLAUDECODE`, `CLAUDE_CODE_*`) nem é `CLAUDE_CONFIG_DIR` — o config
   dir é do app, não da entrada.
4. `class: 'A'` exige `command === null`; `class: 'B'` exige `command`
   não vazio.
5. Entrada inválida no `config.json` é **descartada** pelo sanitize (o resto do
   registry sobrevive), nunca aborta o boot.

## 2. Estado do provider para a UI (`ProviderSummaryDto`)

O que atravessa o preload. **Nunca** contém valor de env sensível.

| Campo | Tipo | Nota |
|---|---|---|
| `id` / `label` / `class` | como acima | |
| `secretsStatus` | `'configured' \| 'missing' \| 'vault-unavailable'` | Derivado do cofre; é **tudo** que a UI sabe sobre o segredo (C19) |
| `supported` | `boolean` | `false` para `class: 'B'` na v1 → listado como "não suportado nesta versão" (C20) |
| `envKeys` | `readonly string[]` | Só os **nomes** (diagnóstico), incluindo os secretos |

## 3. Config do registry (`ProvidersConfigDto`)

Chave `providers` do `config.json`:

```ts
{
  version: 1,
  entries: ProviderEntry[]   // nasce [] — registry inerte (C14)
}
```

`sanitizeProvidersConfig` segue o padrão de `config-store.ts`: chave ausente,
JSON corrompido, tipo errado ou entrada inválida → default seguro (`entries:
[]` ou descarte da entrada ruim), sem lançar.

## 4. Segredo no cofre

Reusa `src/main/accounts/vault.ts` (etapa 1). Namespace de chave:
`provider:<providerId>:<ENV_KEY>` → valor. Write-only para fora do main: o
único getter é interno ao builder de env (§5) e ao cálculo de `secretsStatus`
(que devolve **boolean**, não valor).

## 5. Env efetivo da sessão (`buildProviderEnv`, puro)

```
buildProviderEnv(entry, secrets) -> Record<string,string>
```

Regras:

1. Começa dos pares de `entry.env`.
2. Acrescenta cada `secretEnvKeys[i]` com o valor lido do cofre; chave sem
   valor no cofre → falha explícita `missing-secret` (a sessão **não** nasce
   meio-autenticada).
3. Nunca inclui `CLAUDE_CONFIG_DIR` (§6 decide isso), nunca inclui os
   marcadores de sessão-filha.
4. A função nunca loga; erro carrega o **nome** da variável, nunca o valor.

Aplicado sobre o env base pelo `buildPtyEnv` estendido
(`pty-manager.ts`), que continua sendo o único ponto que monta o env do spawn.

## 6. Config dir efetivo (`resolveSessionConfigDir`, puro — C21)

```
resolveSessionConfigDir({
  providerConfigDir?: string,     // provider selecionado nesta sessão
  accountsEngineActive: boolean,  // etapa 1
  activeProfileConfigDir?: string // mecanismo de hoje (morre na etapa 2)
}) -> string | undefined
```

Ordem: **provider > motor > perfil**. `undefined` = sem override (o `~/.claude`
real). Tabela-verdade completa nos testes de T1310.

## 7. Fato de nascimento da sessão

`PtyCreateResult` ganha um campo **novo**, sem alterar os existentes:

```ts
provider?: { id: ProviderId; label: string }
```

Preenchido só quando a sessão nasceu de um provider classe A (`undefined` = a
sessão é de conta/perfil, o caso de hoje). É o que permite ao renderer rotular
a statusbar e resolver a origem do transcript/retomada (C17).
