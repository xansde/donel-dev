# Research & Clarifications — 011, etapa 3 (registry de providers, classe A)

> Escopo deste arquivo: **somente a etapa 3** da entrega 011 — registry de
> providers por sessão, classe A (Claude-compatible), estreia com OpenRouter,
> classe B nascendo vazia. As etapas 1 (motor de contas + mods) e 2 (demolição
> de perfis + migração) têm runs próprios; os artefatos delas
> (`../plan.md`, `../tasks.md`, `../research.md`, `../data-model.md`,
> `../contracts/*`) são **intocáveis** por esta fase e servem só de referência
> de contrato.
>
> O detalhe integral do research vive em
> `.scratch/contas-e-provedores/issues/05` (corte do registry), `06`
> (migração) e `07` (convivência com a 010). Aqui ficam (a) o recorte da etapa
> 3, (b) os fatos de código verificados no terreno real e (c) as lacunas da
> spec resolvidas por julgamento nesta fase (C13–C22).

## 1. Recorte da etapa 3

| Item da spec | Etapa 3? | Nota |
|---|---|---|
| Registry de providers: display name + binário + env vars + config dir `[T-5]` | **Sim** | É o coração da etapa |
| Classe A — Claude-compatible (mesmo binário `claude`, `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`, config dir próprio) | **Sim** | Único caminho de spawn implementado |
| Estreia com OpenRouter (chave do Bitwarden → cofre, write-only) | **Sim** | Precedida de spike de compatibilidade (§3, risco R1) |
| Classe B — CLIs terceiros | **Sim, só a estrutura** | Campo discriminante + validação; **sem** caminho de spawn, sem UI de criação |
| Escolha manual de provider **por sessão**, no launcher | **Sim** | |
| Segredo write-only via `safeStorage`, nunca ecoado à UI | **Sim** | Reusa o cofre da etapa 1, em namespace próprio (C19) |
| Fallback automático de provider quando o pool encher | **Não** — fora da 011 | Decisão de entrevista |
| Demolição de perfis, migração do dia da virada | **Não** — etapa 2 | O registry **não depende** dela (C21) |
| Motor de contas, mods, auto-switch 90/20 | **Não** — etapa 1 | Pressuposto pronto (§2) |
| Indexação/resume/semáforo/Modo Dev para CLIs da classe B | **Não** — névoa pós-v1 | O app não promete o que não tem |
| UI de gerenciamento de MCPs/integrações | **Não** — névoa pós-v1 | |

## 2. Dependências com as etapas irmãs

### 2.1 O que a etapa 3 pressupõe pronto da **etapa 1**

| Peça da etapa 1 | Como a etapa 3 a usa |
|---|---|
| `src/main/accounts/vault.ts` (`safeStorage`, write-only, IO injetável) | **Reusado tal qual** para o segredo de provider, em namespace `provider:<providerId>`. A etapa 3 **não** cria um segundo cofre |
| Padrão de sanitize/versionamento de `src/main/config-store.ts` (usado pela chave `accounts`) | Copiado para a chave nova `providers` — mesmos 4 pontos (default, sanitize, DTO, escrita atômica) |
| `account-engine.ts` e o conceito de "conta ativa" | **Só para desviar dela**: sessão com provider selecionado não passa pelo motor (C13). O motor precisa existir para que a precedência de config dir tenha um caso do meio bem definido (C13/C21) |
| `PtyCreateResult.profile` preenchido pelo motor (C10) | A etapa 3 **acrescenta** `provider` ao mesmo resultado, sem alterar `profile` |

Consequência prática: a etapa 3 **pode ser planejada agora** (é o que este run
faz) mas só é implementável depois da etapa 1 estar mergeada — senão o cofre e
a precedência de config dir não existem para encostar.

### 2.2 Relação com a **etapa 2** (demolição de perfis)

**O registry não depende da etapa 2.** O discovery diz que
`CLAUDE_CONFIG_DIR` **muda de papel** — deixa de ser "troca de conta" (perfis,
junctions) e passa a ser **isolamento de provider externo** `[T-4][T-5]`. Isso
é uma mudança de *significado*, não uma dependência de ordem: o mecanismo de
env no spawn (`buildPtyEnv`, `pty-manager.ts:72-86`) já existe e é o mesmo.

O que muda conforme a etapa 2 já tenha rodado ou não:

- **Etapa 2 ainda não rodou** (perfis vivos): o config dir da sessão passa a
  ter três candidatos — perfil ativo (mecanismo antigo), motor de contas
  (etapa 1, que pede *ausência* de override, C1) e provider (etapa 3).
  Precedência única e testada: **provider > motor > perfil** (C21).
- **Etapa 2 já rodou**: o candidato "perfil" simplesmente desaparece; a mesma
  função pura de precedência continua correta com uma alternativa a menos.

Por isso a etapa 3 é entregável em qualquer ordem em relação à 2 — mas a
**ordem aprovada** no discovery `[T-7]` continua sendo 1 → 2 → 3, e nada aqui
pede para inverter.

### 2.3 Gate da 010 (Esteira do Donel)

Idêntico ao da etapa 1 e igualmente **bloqueante**: código só depois dos
batches da 010 fecharem em staging. O arquivo de risco compartilhado é
`src/main/index.ts`. Mitigação: quase todo o código novo mora em arquivos
novos (`src/main/providers/**`, `src/shared/providers.ts`,
`src/renderer/src/ProviderPicker*`), e o toque no hub está concentrado em
**uma única task** (T1319).

## 3. Fatos de código verificados no terreno (04/08)

Lidos nesta fase, não presumidos:

1. **A injeção de env já existe e é pura** — `buildPtyEnv(baseEnv,
   claudeConfigDir)` (`src/main/pty-manager.ts:72-86`) copia o env, apaga os
   marcadores de sessão-filha do Claude Code
   (`INHERITED_CLAUDE_SESSION_MARKERS`) e seta/remove `CLAUDE_CONFIG_DIR`.
   Ela **não** aceita nenhuma outra variável hoje: a classe A precisa de um
   segundo parâmetro (mapa de env do provider). É o achado A2 da etapa 1
   materializado.
2. **O spawn resolve o config dir num lugar só** —
   `src/main/index.ts:517-528` passa `claudeConfigDir: activeProfileConfigDir`
   ao `ptyManager.create`. É exatamente o ponto onde a precedência do C21 vai
   morar.
3. **O transcript segue o config dir** — `resolveTranscriptPath`
   (`index.ts:460-462`) e `indexProjectSessions`/`resolveProjectSessionsDir`
   (`session-indexer.ts:101-102, 449-450`) recebem `claudeHome` como
   parâmetro; o indexer aceita **um** home por chamada. Logo, "transcripts e
   resume funcionam sem obra" `[T-5]` é verdade sobre o *mecanismo* (o binário
   é o mesmo, o `.jsonl` nasce no formato de sempre) e **falso sobre o
   encanamento**: alguém tem de passar o home do provider. Ver achado A1 do
   analyze e C17.
4. **Hooks/semáforo independem do config dir** — o `--settings` apontado no
   spawn (`index.ts:514`) é um caminho **absoluto** em `userData`
   (`hooks-settings.ts:55-60`). Um provider com config dir próprio continua
   com semáforo funcionando. O que ele **não** herda é o
   `~/.claude/settings.json` do usuário (C16).
5. **O launcher não conhece env** — `Launcher.tsx` coleta modelo/esforço/
   permissão/nome/projeto e devolve por `onLaunch`; quem monta o argv é o
   `App.tsx` via `buildClaudeArgs` (`commandBuilder.ts`, puro). Acrescentar
   "Provedor" é um campo a mais no mesmo formato — **sem** tocar o
   `commandBuilder` (C18), como `[T-7]` previa.
6. **`config.json` tem padrão de extensão consolidado** —
   `AppConfig`/`defaultAppConfig`/`toAppConfigDto`/`sanitizeAppConfig`
   (`config-store.ts:73-134, 486+`). A chave `providers` entra pelos mesmos
   quatro pontos, sem tocar nas existentes.

## 4. Clarifications — lacunas resolvidas nesta fase (C13–C22)

Sem humano no loop. Cada item escolhe a leitura **mais conservadora** dentro do
que o discovery já fechou; nenhum amplia escopo. Estão resumidos na `spec.md`
(seção Clarifications, append da etapa 3) e detalhados aqui.

**C13 — Provider e motor de contas são mutuamente exclusivos por sessão.**
Uma sessão nasce *ou* de conta Anthropic (motor da etapa 1, credencial em
`~/.claude/.credentials.json`, sem override de config dir) *ou* de provider
classe A (config dir próprio + `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`).
Nunca dos dois. Consequências: auto-switch **ignora** sessões de provider (não
as conta como "sessão viva" para poll nem para adiamento); o rótulo de conta da
statusbar mostra o provider, não uma conta. Razão: são dois mecanismos de
autenticação diferentes no mesmo processo — misturá-los produz sessão
autenticada por acidente.

**C14 — O registry nasce inerte.** `providers.entries = []`. Sem entrada
configurada, o launcher **não muda**: nenhum seletor novo aparece e o spawn é
byte a byte o de hoje (mesmo padrão do `accounts.mod = null` da etapa 1, C2).
Com ao menos uma entrada, aparece o seletor "Provedor", cujo valor default é
sempre **"Claude (conta)"** — o caminho de hoje.

**C15 — O contrato da classe A é o mecanismo env do Claude Code, não a API de
um provider.** A entrada de registry carrega `env: Record<string, string>`
(valores **não** sensíveis, ex.: `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`,
`ANTHROPIC_SMALL_FAST_MODEL`) e `secretEnvKeys: string[]` (nomes das variáveis
cujo valor vive no cofre, ex.: `ANTHROPIC_AUTH_TOKEN`). Nada específico de
OpenRouter existe em código: mapeamento de modelo, header extra ou base URL são
**dados de configuração**. Esta é a mitigação direta do risco de "registry no
formato-OpenRouter" (lição da etapa 1 sobre interface extraída de uma
implementação só).

**C16 — Onde mora o config dir do provider e o que ele contém.**
`<userData>/providers/<providerId>/`. Não `~/.claude` (seria misturar
credencial de provider com a conta Anthropic), não `~/.claude-profiles` (morre
na etapa 2). O diretório é criado vazio no primeiro spawn e **nada é copiado
automaticamente para dentro dele** — sem MCPs, sem `CLAUDE.md` global, sem
`settings.json` do usuário. Isso é uma **consequência declarada**, não um
esquecimento: a promessa de "MCP configurado uma vez sobrevive" da spec é sobre
**troca de conta**, não sobre provider externo. A UI diz isso em uma linha ao
lado do seletor.

**C17 — Transcripts e retomada por provider.** A sessão grava o `providerId` de
nascimento (mesmo espírito do "perfil de nascimento" atual). O transcript é
resolvido no home do provider (`resolveTranscriptPath` já é parametrizado). O
painel "Sessões anteriores" consulta **o home do provider selecionado no
momento** — exatamente o comportamento de hoje com perfil ativo. Sessões de
outro provider **não** aparecem enquanto ele não estiver selecionado. Sem união
de raízes na v1: unir árvores exigiria mudar a assinatura do indexer e resolver
dedup/ordenação entre origens, o que é obra que ninguém pediu. A limitação é
visível na UI (o seletor diz de qual origem a lista veio), nunca silenciosa.

**C18 — Flags do launcher com provider selecionado.** `--model` e `--effort`
são conceitos da assinatura Anthropic (`fable`/`opus`/…): com provider classe A
selecionado, **são omitidos do argv** e o modelo passa a vir do env da entrada
(`ANTHROPIC_MODEL`, C15). Os controles ficam desabilitados com uma linha de
explicação. `--permission-mode`, `-n` e o `--settings` dos hooks continuam
iguais. **`commandBuilder.ts` não é alterado** — quem decide omitir é o call
site (`App.tsx`), preservando `[T-7]`.

**C19 — Segredo do provider.** Mesmo cofre da etapa 1
(`accounts-vault.json`, `safeStorage`), em namespace `provider:<providerId>`.
Entra **só** pelo formulário write-only do registry; nenhum canal de leitura
devolve o valor, nem truncado — a UI mostra apenas `configurado` /
`não configurado`. A chave do OpenRouter que já está no Bitwarden é lida **na
implementação**, uma vez, direto do cofre para o formulário do app; nunca passa
por chat, arquivo, fixture, log ou commit (task T1325, sem eco na saída).

**C20 — Classe B nasce vazia, e "vazia" tem definição.** A entrada de registry
tem `class: 'A' | 'B'`; a validação aceita `'B'` e a persiste, mas **não existe
caminho de spawn para `'B'` na v1** e **não existe UI de criação de entrada
`'B'`**. Uma entrada `'B'` inserida à mão no `config.json` é listada como
"não suportada nesta versão" e recusada no lançamento, com mensagem explícita —
nunca ignorada em silêncio. Assim a estrutura existe sem virar código morto
executável.

**C21 — Precedência única de `CLAUDE_CONFIG_DIR`.** Função pura
`resolveSessionConfigDir({ providerConfigDir, accountsEngineActive,
activeProfileConfigDir })` com a ordem **provider > motor > perfil**:
1. provider selecionado → config dir do provider;
2. senão, motor de contas ativo → `undefined` (o `~/.claude` real, C1 da
   etapa 1);
3. senão → `activeProfileConfigDir` (comportamento de hoje).
Enquanto perfis existirem, selecionar um provider **vence** o perfil ativo, e a
UI de perfil aparece desabilitada nesse estado (nunca duas verdades na tela).
Depois da etapa 2, o terceiro ramo some sem alterar os dois primeiros.

**C22 — LGPD e identidade de provider.** `providerId` é slug opaco gerado do
rótulo (ex.: `openrouter`); `label` é texto livre do operador. Nunca e-mail,
nunca nome de pessoa — em UI, log, fixture ou artefato. Erro de provider nunca
inclui valor de env sensível na mensagem.

## 5. Alternativas consideradas e rejeitadas nesta fase

| Alternativa | Rejeitada porque |
|---|---|
| Provider como **preferência global** (um provider ativo, como o perfil ativo é hoje) | O discovery fechou "escolha manual **por sessão**" `[T-5]`; global impediria comparar provider e conta lado a lado, que é o uso real (modelo gratuito numa aba, conta na outra) |
| Modelar a classe A com campos nomeados (`baseUrl`, `apiKey`, `model`) | Congela o registry no formato do primeiro provider — exatamente a lição da etapa 1 ("interface extraída de uma implementação só vira o formato dela"). Mapa de env genérico + lista de chaves secretas cobre qualquer provider Claude-compatible sem código novo (C15) |
| Copiar/semear `~/.claude` (MCPs, `CLAUDE.md`, settings) no config dir do provider | Cópia silenciosa de config é a duplicação que a spec existe para matar (defeito 2 do problema). Provider externo com MCPs herdados também expõe ferramentas locais a um endpoint de terceiro sem o operador decidir |
| Unir as raízes de transcript (todos os providers + `~/.claude`) no painel de sessões anteriores | Muda a assinatura do indexer e cria dedup/ordenação entre origens — obra não pedida. C17 entrega a mesma informação com o mecanismo que já existe, e a limitação fica visível |
| Reaproveitar `~/.claude-profiles/<slug>` como config dir de provider | O diretório morre na etapa 2; ancorar a etapa 3 nele criaria dependência de ordem que hoje não existe (§2.2) |
| Deixar o launcher passar `--model` mesmo com provider | `fable`/`opus` não existem fora da Anthropic: a sessão nasceria com erro de modelo desconhecido, e o operador culparia o provider (C18) |
| Implementar a classe B "só um pouquinho" (spawn de PTY com binário arbitrário) | O discovery mandou nascer **vazia**, sem piloto. Caminho de spawn sem nenhum CLI real para testá-lo é código não exercitado no processo que segura credencial (C20) |
| Adotar OpenRouter como piloto **sem verificar** compatibilidade Anthropic | O contrato da classe A é o mecanismo env do Claude Code; se o endpoint do provider não falar a Messages API, o piloto não sobe. Vira spike-gate (T1302) com decisão humana se falhar — não uma suposição enterrada no plano |
