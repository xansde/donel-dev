# Plano técnico — 011 Contas & Provedores · **Etapa 3**: registry de providers (classe A)

**Branch**: `esteira/contas-e-provedores` · **Data**: 2026-08-04 · **Spec**:
`specs/011-contas-e-provedores/spec.md` (seção "Registry de providers `[T-5]`"
+ Clarifications C13–C22) · **Card**: `pln-registry-providers-classe-a`

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementos deste plano,
todos nesta subpasta: `research.md` (recorte, dependências, C13–C22),
`data-model.md`, `contracts/provider-registry.md`.

> Os artefatos da **etapa 1** (`../plan.md`, `../tasks.md`, `../research.md`,
> `../data-model.md`, `../contracts/*`) são **intocáveis** por esta fase.
> Foram lidos para alinhar contrato e numeração — a etapa 1 usa
> `T1101`–`T1131`; esta etapa começa em `T1301`.

## Sumário

A spec 011 cobre três entregas. **Este plano cobre só a terceira**: abrir o
launcher para provedores LLM alternativos, com escolha **manual por sessão**.
O corte é o do `[T-5]`: **classe A** (Claude-compatible — mesmo binário
`claude`, env por provider, `CLAUDE_CONFIG_DIR` próprio) implementada de ponta
a ponta, estreando **OpenRouter**; **classe B** (CLIs terceiros) nascendo
**vazia** — estrutura de dados e recusa explícita, sem caminho de spawn e sem
piloto. Sem fallback automático de provider (fora de escopo da 011 inteira).

Como na etapa 1, o mecanismo **nasce inerte**: registry vazio = launcher
idêntico ao de hoje, byte a byte.

## Contexto técnico

| | |
|---|---|
| **Linguagem** | TypeScript 5.x, Node do Electron (main) + React (renderer) |
| **Dependências novas** | **nenhuma** — `safeStorage` (via cofre da etapa 1) e `node-pty` já existem |
| **Storage** | `config.json` (`userData`, chave nova `providers`) + `accounts-vault.json` (cofre da etapa 1, namespace `provider:<id>`) + `<userData>/providers/<id>/` (config dir por provider) |
| **Testes** | vitest nos módulos puros/injetáveis; smoke roteirizado (padrão do repo) para launcher e caminho de spawn |
| **Plataforma-alvo** | Windows 11 (canal alfa) |
| **Restrição dura** | Segredo write-only; nenhum valor de env sensível cruza o preload nem entra em log |
| **Escala** | Unidades de providers (2–5), lidos do config em memória |

## Gate de constituição

`.specify/memory/constitution.md` segue não preenchido (template); a
constituição de fato é o `CLAUDE.md` do repo.

| Regra do repo | Como este plano cumpre |
|---|---|
| "O app NUNCA lê, grava ou exibe credenciais" | A emenda da spec é **da etapa 1** e confinada ao mod local. Aqui **não há emenda nova**: chave de provider é segredo do operador entrando por formulário write-only, guardado em `safeStorage`, nunca exibido nem devolvido — a UI só vê `configured`/`missing` (C19) |
| TDD com escopo | Todo módulo puro/injetável (`providers-config`, `provider-env`, `session-config-dir`, `provider-registry`, extensão do `buildPtyEnv`) nasce com vitest, teste antes; launcher e spawn por smoke roteirizado. Spike (T1302) não leva teste |
| UI em pt-BR, código em inglês | Respeitado |
| LGPD | `providerId` é slug opaco; `label` é texto livre sem nome de pessoa (C22) |
| Nada fora das tasks sem atualizar a spec | As lacunas viraram C13–C22, apendadas à `spec.md` (numeração continuada, nada reescrito) |

## Dependência de sequenciamento

### Gate bloqueante — 010 (Esteira do Donel) `[T-7]`

> **Nenhuma task de código roda antes de os batches da 010 fecharem em
> staging.** O arquivo de risco compartilhado continua sendo
> `src/main/index.ts`.

Mitigação, igual à da etapa 1 e igualmente deliberada: o código novo mora em
arquivos novos (`src/main/providers/**`, `src/shared/providers.ts`,
`src/renderer/src/ProviderPicker.tsx`), e **uma única task toca o hub**
(T1319). Se a 010 ainda estiver quente, T1319 é a última a entrar. Esta frente
continua sem tocar `esteira-*` e sem alterar `commandBuilder.ts` (C18) nem
`openPhaseSession.ts`.

### Dependência da **etapa 1** (motor de contas) — real, de código

O registry pressupõe pronto: o **cofre** (`src/main/accounts/vault.ts`,
reusado em namespace próprio, C19), o **padrão de extensão do config-store**
(chave `accounts` como modelo para a chave `providers`) e o conceito de
**"motor ativo"**, que é o ramo do meio da precedência de config dir (C21).
Sem a etapa 1 mergeada, T1305/T1313/T1310 não têm onde encostar. Ordem de
implementação aprovada no discovery — 1 → 2 → 3 — permanece.

### Dependência da **etapa 2** (demolição de perfis) — **não existe**

O discovery diz que `CLAUDE_CONFIG_DIR` **muda de papel**: deixa de ser troca
de conta (perfis + junctions) e vira **isolamento de provider externo**
`[T-4][T-5]`. É mudança de significado, não de ordem — o mecanismo de env no
spawn já existe (`buildPtyEnv`) e é o mesmo. A convivência com perfis vivos é
resolvida por **uma função pura de precedência** (`resolveSessionConfigDir`,
C21): **provider > motor > perfil**. Com a etapa 2 feita, o terceiro ramo
some sem tocar nos dois primeiros; com ela pendente, selecionar um provider
vence o perfil ativo e a UI de perfil aparece desabilitada — nunca duas
verdades na tela. Detalhe em `research.md` §2.2.

## Arquitetura em uma tela

```
   RENDERER
     Launcher.tsx  ──► campo novo "Provedor" (só aparece com registry não vazio)
     ProviderPicker.tsx / ProviderForm.tsx
       │  providers:list / upsert / remove
       │  providers:setSecret  ← ÚNICO ponto por onde segredo ENTRA (write-only)
       ▼  pty:create { ..., providerId }
   ───────────────────── preload (src/preload/index.ts) ─────────────────────
   MAIN
     src/main/index.ts  ── registra handlers + resolve provider no spawn
       │                    (T1319 — ÚNICA task no hub compartilhado)
       ▼
     providers/provider-registry.ts     ← CRUD + validação + resolveLaunch
       ├─ providers/providers-config.ts ← chave `providers` no config-store
       ├─ providers/provider-env.ts     ← PURO: env efetivo (C15)
       ├─ providers/session-config-dir.ts ← PURO: precedência provider>motor>perfil (C21)
       └─ providers/provider-secrets.ts ← adaptador do cofre da ETAPA 1 (namespace provider:*)
     pty-manager.ts  ── buildPtyEnv ganha 2º parâmetro (envOverrides) — T1317
```

Fronteira de segredo: o valor de env sensível existe **só** dentro de
`src/main/providers/` e do `buildPtyEnv`. Nenhum canal IPC o devolve; não há
canal `providers:resolveLaunch` justamente para ele não ter por onde sair
(`contracts/provider-registry.md`).

## Decisões de desenho

### D1 — O contrato da classe A é o mecanismo env do Claude Code, não a API do provider

Este é o **risco central da etapa** e a decisão que o neutraliza. A lição da
etapa 1 diz: interface extraída de **uma** implementação vira o formato dessa
implementação. Aqui só há um piloto (OpenRouter) — logo, o registry **não pode
ter campos nomeados** (`baseUrl`, `apiKey`, `model`). A entrada carrega
`env: Record<string,string>` genérico + `secretEnvKeys: string[]` (C15):
base URL, mapeamento de modelo e qualquer header futuro são **dados**, não
código. Nenhuma string `openrouter` existe fora de uma fixture e do texto que
o operador digitar. O teste que prova isso: a mesma bateria do registry roda
com duas entradas fictícias de formatos diferentes (T1313).

### D2 — Provider e motor de contas são mutuamente exclusivos por sessão (C13)

Uma sessão nasce *ou* de conta Anthropic (motor) *ou* de provider classe A —
nunca dos dois. Auto-switch ignora sessões de provider. Razão: são dois
mecanismos de autenticação no mesmo processo; misturá-los produz sessão
autenticada por acidente, com credencial de conta viajando para um endpoint de
terceiro.

### D3 — Precedência única e pura de config dir (C21)

`resolveSessionConfigDir` é a única resposta do app para "qual
`CLAUDE_CONFIG_DIR` esta sessão usa". Ordem provider > motor > perfil, tabela
verdade testada. Sem essa função, a precedência ficaria espalhada em `if`s no
hub — o tipo de coisa que a etapa 2 quebra sem ninguém perceber.

### D4 — O config dir do provider nasce vazio, e isso é dito na cara (C16)

`<userData>/providers/<id>/`, criado no primeiro spawn, **sem cópia automática
de nada** — sem MCPs, sem `CLAUDE.md`, sem `settings.json` do usuário. Copiar
config em silêncio é o defeito 2 do problema da spec ("duplica config,
divergindo em silêncio"), e MCP herdado exporia ferramentas locais a um
endpoint de terceiro sem decisão do operador. A UI explica em uma linha.

### D5 — Classe B: estrutura sim, caminho de execução não (C20)

`class: 'A' | 'B'` existe e é persistido; `resolveLaunch` de `'B'` devolve
sempre `unsupported-class` e a UI recusa com mensagem. Não há UI de criação de
entrada `'B'` na v1. Assim a estrutura fica pronta para o dia em que um CLI
real aparecer, sem deixar código de spawn não exercitado dentro do processo que
segura credencial.

### D6 — Registry inerte por default (C14)

`providers.entries = []`. Sem entrada, o launcher não ganha campo nenhum e o
spawn é idêntico ao de hoje. Mesmo padrão que destravou a etapa 1
(`accounts.mod = null`): a etapa vira mergeável e reversível por config,
dogfoodável no alfa sem risco para o fluxo atual.

### D7 — `commandBuilder` não muda; quem decide as flags é o call site (C18)

Com provider classe A selecionado, `--model`/`--effort` são **omitidos** do
argv (não existem fora da assinatura Anthropic) e o modelo vem do env da
entrada. A omissão acontece no `App.tsx`, onde o argv é montado — o
`commandBuilder.ts` continua puro e intocado, como `[T-7]` previa.

## Estratégia de teste

**Vitest (módulo puro/injetável — onde a feature se decide):**

| Módulo | O que o teste fixa |
|---|---|
| `providers-config.ts` | `sanitizeProvidersConfig` resiliente (chave ausente, JSON corrompido, entrada inválida descartada sem derrubar as boas, id fora do padrão, `class` desconhecida) |
| `provider-env.ts` | Env montado de `env` + segredos do cofre; `missing-secret` aborta; `CLAUDE_CONFIG_DIR`/marcadores de sessão-filha nunca entram; erro nomeia a variável, nunca o valor |
| `session-config-dir.ts` | Tabela-verdade da precedência provider > motor > perfil, incluindo o mundo pós-etapa 2 (sem perfil) |
| `provider-registry.ts` | CRUD, unicidade de id, validação por classe, `resolveLaunch` nos 5 resultados, remoção apagando segredo e preservando config dir, **duas entradas de formatos diferentes** (D1) |
| `pty-manager.ts` (`buildPtyEnv` estendido) | Overrides aplicados; base env preservado; `CLAUDE_CONFIG_DIR` continua governado pelo parâmetro próprio; marcadores herdados continuam removidos; sem override = saída **idêntica** à de hoje |
| montador de argv do `App.tsx` (função extraída, pura) | Com provider: sem `--model`/`--effort`, com `-n`/`--permission-mode`/`--settings`; sem provider: argv byte a byte o de hoje |

**Smoke roteirizado (launcher/PTY, isolado do `%APPDATA%` real, com `userData`
temporário — nunca fazendo chamada de rede real a provider):**

- `providers-inert.spec.ts` — registry vazio: launcher sem campo "Provedor",
  spawn com o mesmo env/config dir de hoje (D6).
- `providers-session-env.spec.ts` — entrada fictícia classe A: sessão nasce com
  o env da entrada e o config dir `<userData>/providers/<id>/` criado.
- `providers-secret-never-leaks.spec.ts` — varredura de todos os payloads dos
  `PROVIDER_CHANNELS` e do `pty:create` procurando o segredo plantado; nenhum
  hit.
- `providers-class-b-refused.spec.ts` — entrada `'B'` escrita à mão no config é
  listada como não suportada e recusa o lançamento com mensagem (C20).
- Regressão: suítes de perfil, `pty-manager.test.ts`, `config-store.test.ts` e
  as suítes da etapa 1 seguem verdes.

## Riscos

| Risco | Mitigação |
|---|---|
| **R1 — OpenRouter pode não expor endpoint Anthropic-compatible.** O contrato da classe A é a Messages API que o `claude` fala via `ANTHROPIC_BASE_URL`; se o piloto não falar esse dialeto, a estreia não sobe | **Spike-gate T1302, antes de qualquer UI**: verificar na máquina, com a chave do cofre, se `claude` sobe apontado ao provider. Falhou → **parar e perguntar ao humano** (aceitar um shim ou trocar o piloto é decisão de discovery, não do plano). O registry em si **não** depende do resultado (D1) |
| **R2 — registry nascer no formato-OpenRouter** (lição da etapa 1) | D1: mapa de env genérico + `secretEnvKeys`; zero campo nomeado; bateria de teste com duas entradas de formatos diferentes |
| Segredo vazando para log/UI/IPC | Sem canal de leitura de valor; `resolveLaunch` só no main; smoke de varredura; erro nomeia a variável, nunca o valor |
| Merge com a 010 no `index.ts` | Uma única task toca o hub (T1319), última da fila, atrás do gate T1301 |
| Precedência de config dir divergir entre perfil/motor/provider | Função pura única com tabela-verdade (D3), consumida em um lugar só |
| Sessão de provider "sumir" do painel de sessões anteriores | C17: origem é o provider selecionado e a UI **diz** de onde a lista veio; nunca lista vazia sem explicação |
| Operador achar que MCPs valem no provider | D4: config dir vazio declarado na UI, e o smoke de env prova que nada é copiado |
| Etapa 2 mudar o terreno debaixo desta etapa | A única superfície compartilhada é o 3º ramo da precedência; quando perfis morrerem, some um ramo e os testes da tabela-verdade acusam |

## Achados do cruzamento spec × plan × tasks (`analyze`, 04/08)

Todos os HIGH resolvidos nesta fase; nada ficou aberto.

| # | Severidade | Achado | Resolução |
|---|---|---|---|
| A1 | **HIGH** | A spec afirma que, na classe A, "transcripts, hooks/semáforo, resume/fork e Modo Dev funcionam **sem obra**". Verdade sobre o *mecanismo* (mesmo binário, mesmo formato de `.jsonl`), **falso sobre o encanamento**: `resolveTranscriptPath` e `indexProjectSessions` recebem `claudeHome` por parâmetro (`index.ts:460-462`, `session-indexer.ts:449-450`) e alguém tem de passar o home do provider | Resolvido **sem ampliar a promessa**: C17 fixa que a sessão carrega o `providerId` de nascimento e que o painel de sessões anteriores consulta o home do provider **selecionado** — exatamente o padrão que hoje vale para o perfil ativo. Sem união de raízes. Tasks T1318/T1320 fazem o encanamento; a limitação é visível na UI, nunca silenciosa |
| A2 | **HIGH** | Colisão de `CLAUDE_CONFIG_DIR` entre três donos (perfil ativo hoje, motor da etapa 1 que exige *ausência* de override, provider da etapa 3) — sem regra única, a etapa 2 quebraria o comportamento sem teste acusar | C21 + D3: função pura `resolveSessionConfigDir` com precedência **provider > motor > perfil**, tabela-verdade em T1310, consumida num único ponto do spawn (T1319). UI de perfil desabilitada quando há provider selecionado |
| A3 | **HIGH** | A estreia depende de OpenRouter falar a Messages API da Anthropic — premissa **não verificada** em nenhum ticket (o `05` a registra como decisão de produto, não como fato de código) | Vira **spike-gate explícito** (T1302), anterior a qualquer código de UI, com critério de aprovação e regra de parada: falhando, a fase para e o humano decide (shim vs. trocar o piloto). O registry (D1) é indiferente ao resultado, então o risco não contamina a arquitetura |
| A4 | MEDIUM | "Classe B nasce vazia" é ambíguo: dá para ler como "aceita entrada B e tenta spawnar" | C20/D5: `'B'` é aceito e persistido, **não** tem caminho de spawn nem UI de criação; recusa explícita testada (T1324) |
| A5 | MEDIUM | Config dir próprio contradiz a promessa central "MCP configurado uma vez sobrevive" se lida sem recorte | C16/D4: a promessa é sobre **troca de conta**, não sobre provider externo. Config dir de provider nasce vazio, dito na UI e provado no smoke de env |
| A6 | MEDIUM | Com provider, `--model fable` iria para um endpoint que não conhece esses aliases — sessão nasceria quebrada e o operador culparia o provider | C18/D7: flags de modelo/esforço omitidas com provider; modelo vem do env da entrada; `commandBuilder.ts` intocado |
| A7 | LOW | Hooks/semáforo poderiam depender do config dir | Verificado: `--settings` é caminho absoluto em `userData` (`hooks-settings.ts:55-60`) — funciona em qualquer home. O que **não** é herdado é o `~/.claude/settings.json` do usuário (registrado em C16) |
| A8 | LOW | O template do spec-kit marca tarefas de teste como opcionais | Sobrescrito no cabeçalho do `tasks.md`: teste é obrigatório para todo código de produção (regra do `CLAUDE.md`); só spike e documento ficam de fora |

## Entregável desta etapa

Com pelo menos um provider classe A configurado, o operador escolhe **por
sessão**, no launcher, entre "Claude (conta)" e o provider — e a aba nasce
apontada ao endpoint dele, isolada em config dir próprio, com semáforo,
transcript e retomada funcionando. Sem provider configurado, o app é
exatamente o de hoje.
