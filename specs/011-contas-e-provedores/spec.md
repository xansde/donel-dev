# Spec — 011 Contas & Provedores (motor de contas com mods + registry de providers)

> Origem: discovery da esteira `dsc-dfeead0d-bf9` (04/08) + mapa wayfinder
> **cumprido** em `.scratch/contas-e-provedores/` (7/7 tickets resolvidos).
> Cada decisão abaixo carrega a marca `[T-n]` do ticket que a fechou — o
> detalhe integral (fatos de research, alternativas descartadas) vive no
> ticket, não aqui. Referências verificadas em código:
> `seazone-tech/claude-switcher-api` e `pingdotgg/t3code` (MIT).

## Problema

O operador caça na mão uma conta com cota livre e reinicia a sessão para
trocar de conta. O mecanismo atual — perfis paralelos via
`CLAUDE_CONFIG_DIR` + junctions (`~/.claude-profiles`) — tem três defeitos
estruturais:

1. **Não troca sozinho**: o headroom aparece no dropdown, mas a troca é
   manual e por sessão nova.
2. **Duplica config**: cada perfil carrega seu próprio `.claude.json` — MCPs
   configurados N vezes, divergindo em silêncio.
3. **É órfão de futuro**: as contas compartilhadas são da Seazone; num
   desligamento, o app não pode depender de repositório nem infra deles.

O `claude-switcher` da Seazone resolve a dor (auto-switch por carga, sem
reiniciar o CLI), mas é controlado por eles. Esta entrega **absorve a lógica**
para dentro do Donel — funcionando independente da Seazone — e, de quebra,
abre o launcher para provedores LLM alternativos (modelos gratuitos).

## Modelo

### Princípio — mods `[T-3]`

O motor de contas é uma **interface**; cada backend é um **mod**: módulo
TypeScript in-repo do main process, escolhido por config. A interface nasce
**extraída dos dois mods concretos** abaixo — nenhum framework genérico antes
do terceiro mod real. Contrato inicial: `listAccounts()` (com carga),
`switchTo(account)`, `captureRotatedPair()`; `keepAlive()` opcional.

Mods **não** são carregáveis de fora do repo (código externo no processo que
toca credencial é superfície de ataque — névoa futura, com sandbox pensado).

### Mod Seazone `[T-2][T-3]`

Consome a API do switcher (`GET /accounts`, `POST /session/switch`,
`POST /session/heartbeat`; auth JWT via `sessionRefreshToken` de 30 dias).
**Nunca renova token Anthropic** — o refresh é do servidor deles (fato de
código: `anthropic_client.py`; há ainda um monitor externo refrescando o
pool — renovar localmente colidiria, pois o refresh token é de uso único).
Nenhum segredo no app além do token de sessão do switcher.

### Mod local (pool próprio) `[T-3]`

O "servidorzinho" solo, para contas do próprio dono:

- **Cofre**: pares access/refresh guardados via `safeStorage` do Electron
  (criptografia do SO). Nunca arquivo plano; segredo nunca ecoado à UI
  (write-only, padrão T3).
- **Switch-time-only, sem heartbeat**: no switch, (1) captura o par
  **rotacionado** da conta que sai (o CLI rotaciona em uso) e grava no cofre;
  (2) escreve o par da que entra em `~/.claude/.credentials.json` e apaga o
  bloco `oauthAccount` de `~/.claude.json` — é isso que faz o CLI adotar a
  conta sem reiniciar. Refresh HTTP local (`POST
  platform.claude.com/v1/oauth/token`, client_id público) **só** como
  fallback de token vencido na hora do switch. Consequência aceita: conta
  meses sem uso pode expirar e pedir re-login uma vez. Nenhum processo
  periódico toca credencial com o app fechado.
- **Carga por conta**: endpoint OAuth de uso
  (`api.anthropic.com/api/oauth/usage`, janelas 5h/7d diretas) com o token de
  cada conta — sem `npx quota-axi` no caminho quente.

### Exceção à regra de credenciais `[T-3]`

A regra do projeto "o app NUNCA lê, grava ou exibe credenciais" ganha uma
**emenda explícita**: o mod local é **a** exceção deliberada, confinada num
único módulo nomeado do main process. O core do Donel continua nunca tocando
credencial; a UI continua nunca exibindo segredo. (Atualizar o CLAUDE.md do
repo junto com a implementação.)

### Auto-switch `[T-2][T-3]`

Política absorvida do switcher: troca quando a carga da conta ativa (máx. de
5h/7d/sonnet) ≥ **90** E existe conta com folga ≥ **20** pontos; seleção
power-of-two-choices. Vale para os dois mods (no Seazone, a decisão local usa
a carga que a API devolve). Desligável.

### Registry de providers `[T-5]`

Provider é a **segunda família de mods**. Entrada de registry: display name +
binário + env vars (segredos write-only) + `CLAUDE_CONFIG_DIR` próprio.
Duas classes, fronteira honesta:

- **Classe A — Claude-compatible (experiência completa)**: mesmo binário
  `claude`, env por provider (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`),
  config dir próprio para isolar. Transcripts, hooks/semáforo, resume/fork e
  Modo Dev funcionam **sem obra** — o binário é o mesmo.
- **Classe B — CLIs terceiros (só terminal)**: abrir sessão = aba PTY com o
  binário configurado. Sem indexação, resume, semáforo ou Modo Dev — o app
  não promete o que não tem (cada CLI é um formato de transcript e um
  mecanismo de hooks diferentes; obra por CLI, quando doer).

**V1 lança só com a classe A**, estreando **OpenRouter** (modelos gratuitos).
A classe B nasce **vazia**: estrutura no registry, sem piloto (verificado em
04/08: WSL não tem CLI de agente nem config OpenRouter — nada a migrar;
config do zero no Windows). Chave do OpenRouter: já no Bitwarden — lida só na
implementação, direto do cofre para o storage seguro do provider, nunca via
chat/arquivo/commit. Escolha de provider é **manual, por sessão**, no
launcher.

### MCPs e integrações `[entrevista]`

Com a config única (`~/.claude`), MCPs são configurados **uma vez** e
sobrevivem a qualquer troca de conta — a troca reescreve só
`.credentials.json`. Composio é ortogonal: MCP server hospedado com API key
própria; entra como entrada de config quando a conta existir. UI dedicada de
MCPs/integrações: névoa pós-v1.

## Demolição e destino dos dependentes `[T-1][T-4]`

| Hoje | Destino |
|---|---|
| `profile-manager.ts` + junctions + doctor/repair | **Morre inteiro** (provider externo usa diretório comum — junction nunca foi necessária) |
| 4 suítes (`profile-manager.test`, smokes de perfil/quota/foco) | **Morrem**; nova cobertura nasce com o motor |
| Dropdown de headroom (spec 002) | **Vira a UI do motor**: contas do mod ativo, duas janelas explícitas, refresh |
| `sessionAccountLabel` ("perfil de nascimento") | **Muda de fonte**: conta ativa no momento do disparo, gravada como fato da sessão |
| B8/US-12 (painel de cotas) | **Absorvido no motor** (tela do pool = painel); sai do backlog |
| auto-switch (backlog P1) | **Absorvido no motor** (política 90/20); sai do backlog |
| B10 (userData por canal) | **Fica e simplifica** (sem junctions entre canais) |
| Injeção de env no spawn (`pty-manager`) | **Fica, reaproveitada**: perde "config dir por perfil", ganha "env por provider da classe A" |
| Spec 002 + histórico 001 (spikes T001/T002, análise switch-account) | **Registro histórico** — esta spec os supersede |

## Migração (dia da virada) `[T-6]`

Assistida, única, com humano no loop:

1. **Credenciais**: primeiro boot do motor oferece importar os pares de cada
   perfil de `~/.claude-profiles/*/.credentials.json` para o cofre — seed do
   pool próprio, OK na tela **perfil a perfil**. Evita relogar conta a conta.
2. **Transcripts**: copiar `<perfil>/projects/*.jsonl` para
   `~/.claude/projects/<slug>/` (ids de sessão únicos) — histórico e
   "retomar" preservados.
3. **MCPs**: **sem merge automático** — `~/.claude` real é a base; MCPs
   exclusivos de um perfil viram um diff listado para decisão manual.
4. **Junctions**: desfeitas; `~/.claude-profiles` **arquivado** (renomeado
   `.old`), **nunca deletado** na virada — deleção é gesto humano, semanas
   depois.
5. Favoritos/defaults do launcher (userData): intocados.

## Convivência com a 010 `[T-7]`

- **Spec já, código depois**: a implementação só começa quando os batches da
  010 fecharem em staging. Único arquivo de risco compartilhado:
  `src/main/index.ts` (hub) — dois refactors simultâneos nele recriariam o
  desencontro que originou a 010.
- **Fronteiras**: esta frente não toca `esteira-*`; a 010 não toca
  perfil/quota/credenciais. `openPhaseSession`/`commandBuilder` pertencem a
  esta frente — e a v1 **não precisa mudá-los** (classe A usa o mesmo
  binário; classe B vazia; Modo Dev segue Claude-only).

## Cadência de entrega `[T-7]`

Três entregas, cada uma testável e utilizável sozinha:

1. **Motor + mod Seazone** — mata a dor imediata (caçar conta/reiniciar) sem
   demolir nada. Dropdown atual passa a ser alimentado pelo motor.
2. **Demolição + migração** — perfis saem, migração assistida roda, backlog
   limpo (B8/auto-switch absorvidos, 002 superseded).
3. **Registry classe A + OpenRouter** — providers no launcher, escolha por
   sessão.

## Fora de escopo

- **Fallback automático** para provedor gratuito quando o pool encher —
  escolha manual basta (decisão de entrevista; voltaria só com destino
  redesenhado).
- **Dependência de runtime** do repositório/infra da Seazone — a API deles é
  um backend plugável atrás da interface de mod, nunca acoplamento.
- **Mods externos carregáveis**, **classe B plena** (indexação/resume para
  CLIs terceiros) e **UI de MCPs/integrações** — névoa pós-v1 registrada no
  mapa, não prometida aqui.

## Clarifications

### 2026-08-04 — fase Plano, recorte da **etapa 1** (motor + mods)

Lacunas resolvidas por julgamento na fase Plano (sem humano no loop), todas
dentro do que o discovery já decidiu. Razão de cada uma em
`research.md` §4; o recorte etapa 1 × etapas irmãs está em `research.md` §1.

- **C1** — Motor tem alvo de config dir (`claudeHome`, default `~/.claude`);
  com mod ativo, sessão `claude` nasce **sem** override de `CLAUDE_CONFIG_DIR`.
- **C2** — `accounts.mod` nasce `null`: motor **inerte**, comportamento de hoje
  intocado até o operador escolher um mod.
- **C3** — `keepAlive()` é timer de 15 min do processo vivo, só para mods que o
  implementam (Seazone sim, local não). Nenhum agendador de SO.
- **C4** — Carga lida sob demanda + poll de 5 min com sessão viva; auto-switch
  avaliado nesses momentos.
- **C5** — Auto-switch **adia** enquanto houver sessão trabalhando (semáforo);
  switch manual nunca é adiado.
- **C6** — `captureRotatedPair()` lê o par vigente antes de sobrescrever;
  chamado antes de todo switch e no encerramento do app.
- **C7** — Metadado não sensível na chave `accounts` do `config.json`; segredo
  em `accounts-vault.json` separado, cifrado por `safeStorage`.
- **C8** — Conta = id opaco + label. Nunca e-mail, nunca nome de pessoa (LGPD).
- **C9** — Backend fora → estado `unavailable`: nunca bloqueia abrir sessão,
  auto-switch pausa, sem troca automática de mod.
- **C10** — `sessionAccountLabel` **não muda de contrato** na etapa 1; o main
  preenche `PtyCreateResult.profile` com a conta ativa do motor.
- **C11** — O `sessionRefreshToken` do mod Seazone mora no mesmo cofre; a
  *exceção* de regra continua sendo o mod local ler credencial da Anthropic.
- **C12 (leitura da cadência)** — a entrega 1 (`[T-7]`, "Motor + mod Seazone")
  inclui **também o mod local**: a spec exige interface *extraída de dois mods
  concretos*, o que é impossível com um mod só. Nome curto do lote, não
  exclusão. Ver `research.md` §2. **Confirmada pelo dono em 2026-08-04**
  (revisão pós-fase Plano): etapa 1 com os dois mods juntos.

### 2026-08-04 — fase Plano, recorte da **etapa 3** (registry de providers, classe A)

Lacunas resolvidas por julgamento na fase Plano (sem humano no loop), todas
dentro do que o discovery já decidiu `[T-5]`. Razão de cada uma em
`registry-classe-a/research.md` §4; o recorte da etapa 3 e as dependências com
as etapas 1 e 2 estão em `registry-classe-a/research.md` §1–§2.

- **C13** — Provider e motor de contas são **mutuamente exclusivos por sessão**:
  a sessão nasce de conta Anthropic **ou** de provider classe A, nunca dos dois.
  Auto-switch ignora sessões de provider.
- **C14** — Registry **nasce inerte** (`providers.entries = []`): sem entrada
  configurada, o launcher não muda e o spawn é byte a byte o de hoje.
- **C15** — O contrato da classe A é o **mecanismo env do Claude Code**, não a
  API de um provider: entrada carrega `env` genérico (não sensível) +
  `secretEnvKeys` (nomes das variáveis cujo valor vive no cofre). Base URL e
  mapeamento de modelo são **dados**, não código.
- **C16** — Config dir do provider = `<userData>/providers/<id>/`, criado
  **vazio**: nenhuma cópia automática de MCPs, `CLAUDE.md` ou `settings.json`.
  A promessa "MCP configurado uma vez sobrevive" é sobre **troca de conta**,
  não sobre provider externo. Dito na UI.
- **C17** — A sessão grava o `providerId` de nascimento; "Sessões anteriores"
  consulta o home do provider **selecionado** (mesmo padrão de hoje com perfil).
  Sem união de raízes na v1; a origem da lista é mostrada, nunca silenciosa.
- **C18** — Com provider classe A selecionado, `--model`/`--effort` são
  **omitidos** do argv (o modelo vem do env da entrada); `-n`,
  `--permission-mode` e o `--settings` dos hooks seguem iguais.
  `commandBuilder.ts` **não** é alterado.
- **C19** — Segredo de provider vai para o **mesmo cofre** da etapa 1, namespace
  `provider:<id>`. Write-only: a UI só vê `configurado`/`não configurado`. A
  chave do OpenRouter é lida do Bitwarden **na implementação**, direto para o
  formulário do app — nunca em chat, arquivo, fixture, log ou commit.
- **C20** — Classe B nasce vazia **com definição**: `class: 'B'` é aceito e
  persistido, mas não há caminho de spawn nem UI de criação na v1; entrada `'B'`
  é listada como "não suportada nesta versão" e recusada com mensagem — nunca
  ignorada em silêncio.
- **C21** — Precedência única de `CLAUDE_CONFIG_DIR`: **provider > motor >
  perfil**, numa função pura. Enquanto perfis existirem, provider selecionado
  vence o perfil ativo (e a UI de perfil fica desabilitada). O registry **não**
  depende da etapa 2.
- **C22** — `providerId` é slug opaco; `label` é texto livre sem nome de pessoa
  (LGPD). Erro de provider nomeia a variável, nunca o valor.

### 2026-08-04 — fase Plano, recorte da **etapa 2** (demolição + migração)

Mesma regra da etapa 1: lacunas resolvidas por julgamento na fase Plano (sem
humano no loop), todas dentro do que o discovery já decidiu (tickets 04 e 06).
Razão de cada uma em `research-etapa-2.md` §4; o inventário de código que as
sustenta está em `research-etapa-2.md` §2–3. **A numeração continua depois do
bloco da etapa 3** (C13–C22), commitado em paralelo pelo run
`pln-registry-providers-classe-a` — as duas fases rodaram no mesmo dia.

- **C23** — Pré-condição de demolição: etapa 1 implementada, validada em
  dogfooding no alfa e com mod **ativo**. Demolir com o motor inerte deixaria o
  app sem meio nenhum de trocar de conta.
- **C24** — `sessionAccountLabel` muda de **fonte e vocabulário, não de forma**:
  `PtyCreateResult.profile` vira `account: { id, label }`, preenchido pelo motor
  no disparo e imutável pela vida da aba. Nenhum store novo é criado.
- **C25** — Uma unidade só: com o dropdown de perfis morto, `ProfileQuota`
  (% livre) sai e sobra `AccountLoad` (% consumido) — fecha o achado A3 do
  analyze da etapa 1.
- **C26** — Transcripts: `projects` é junction para `~/.claude/projects` em todo
  perfil, então o passo "copiar" vira **inventariar e copiar só o que for
  diretório real** (comparação de `realpath`).
- **C27** — Arquivamento tem ordem invariante: desfazer as 6 junctions de cada
  perfil **antes** de renomear `~/.claude-profiles` → `.old` (sufixo de data se
  já existir). Nunca deletar.
- **C28** — Estado da migração em `accounts.migration` (`config.json`),
  sanitizado como os demais blocos; assistente **reexecutável** e idempotente,
  perfil a perfil.
- **C29** — Diff de MCP é **leitura de nomes** de servidor, nunca do bloco de
  configuração (argumento de MCP carrega token). Sem merge, sem "aplicar".
- **C30** — Config legada (`activeProfileSlug`, `archivedPhaseSessions[].profileSlug`)
  deixa de ser escrita mas continua **tolerada na leitura** — os canais
  alfa/beta/stable compartilham `userData`.
- **C31** — "Reiniciar sessão em foco" (CA-24 da 009) **morre inteiro**
  (decisão do dono, 2026-08-04): botão, diálogo e cópia de transcript saem;
  o equivalente passa a ser trocar a conta ativa no motor + retomar por
  Sessões anteriores.
- **C32** — Superseded é **marcação** (bloco de cabeçalho), nunca deleção — vale
  para a spec 002 inteira e para os artefatos históricos da 001.
- **C33** — `CLAUDE_CONFIG_DIR` **não morre como mecanismo**: morre como meio de
  trocar de conta. `claudeConfigDir`/`buildPtyEnv` do `pty-manager` ficam
  intactos e passam a ser alimentados pelo provider da classe A na etapa 3.
- **C34** — A conta honesta das suítes: são **9** que morrem (as 4 nomeadas
  + `quota-headroom.test.ts`, `transcript-copy.test.ts`, `transcriptCopy.test.ts`,
  todas porque seus módulos morrem, + os 2 smokes de restart pela decisão da
  C31). As demais são **ajustadas**, nunca removidas.

## Pendências

Nenhuma que trave o plano — o mapa fechou com frontier zerada. As névoas
pós-v1 estão na seção acima e no `map.md`.
