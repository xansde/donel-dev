# Plano técnico — 011 Contas & Provedores · **Etapa 2**: demolição dos perfis + migração assistida

**Branch**: `esteira/contas-e-provedores` · **Data**: 2026-08-04 · **Spec**:
`specs/011-contas-e-provedores/spec.md` (seções "Demolição e destino dos
dependentes" e "Migração (dia da virada)") · **Card**:
`pln-demolicao-perfis-migracao`

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementos deste plano:
`research-etapa-2.md` (inventário medido + clarifications C23–C34),
`data-model-etapa-2.md`, `contracts/migration-etapa-2.md`. Os artefatos da
**etapa 1** (`plan.md`, `tasks.md`, `research.md`, `data-model.md`,
`contracts/*`) são **intocados** por este plano.

## Sumário

A etapa 1 constrói o motor de contas e o deixa **inerte**. Esta etapa faz dele o
**único caminho**: mata o mecanismo de perfis paralelos (`profile-manager.ts`,
as 6 junctions por perfil, doctor/repair, o dropdown de perfis e a leitura de
cota por `CLAUDE_CONFIG_DIR`), roda **uma vez** a migração assistida do dia da
virada — importar credenciais para o cofre com OK humano perfil a perfil,
consolidar transcripts, listar (sem aplicar) o diff de MCPs, desfazer junctions
e **arquivar** `~/.claude-profiles` — e limpa o registro (backlog e specs
antigas marcadas superseded).

Saldo de código medido: **≈ 1 876 linhas de produção e ≈ 1 997 linhas de teste
removidas**, contra ≈ 6 módulos novos e pequenos de migração, todos temporários
por natureza mas **testados como código de produção** (eles tocam credencial e
apagam links no home do usuário — é onde um bug custa caro).

O que **não** é desta etapa: o registry de providers, a classe A, o OpenRouter e
o env por provider no spawn (etapa 3); o motor, os mods, o cofre e o auto-switch
(etapa 1, pré-condição implementada).

## Contexto técnico

| | |
|---|---|
| **Linguagem** | TypeScript 5.x, Node do Electron (main) + React (renderer) |
| **Dependências novas** | **nenhuma** — `fs`/`path` do Node e o cofre que a etapa 1 já entregou |
| **Storage tocado** | `~/.claude-profiles/**` (leitura, unlink de junction, rename), `~/.claude/projects/**` (cópia só quando não for junction), `config.json` do `userData` (chave `accounts.migration`; chaves de perfil param de ser escritas) |
| **Nunca tocado** | `~/.claude/.credentials.json` e `~/.claude.json` — quem escreve neles é o `claude-state.ts` da etapa 1, e só ele |
| **Testes** | vitest nos módulos puros/injetáveis da migração; smoke roteirizado para a UI do assistente e para a virada; regressão declarada da suíte inteira |
| **Plataforma-alvo** | Windows 11 (canal alfa). Junction é conceito NTFS; o código de desfazer trata "não é junction" como caso normal |
| **Restrição dura** | Nada é **deletado** na virada. O verbo é renomear |
| **Escala** | Dezenas de perfis no pior caso; a migração é um gesto humano, não um caminho quente |

## Gate de constituição

`.specify/memory/constitution.md` continua **não preenchido** (template). A
constituição de fato é o `CLAUDE.md` do repo — mesmo gate da etapa 1:

| Regra do repo | Como este plano cumpre |
|---|---|
| "O app NUNCA lê, grava ou exibe credenciais" | A **emenda** aberta na etapa 1 (exceção confinada a `src/main/accounts/`) cobre esta etapa **sem ser ampliada**: quem lê `<perfil>/.credentials.json` é um módulo dentro de `src/main/accounts/migration/`, e o par vai direto para o cofre. O renderer recebe apenas `{ profileSlug, temCredencial: boolean, resultado }` — nunca o par, nunca um prefixo dele |
| TDD com escopo | Inventário, diff de MCP, transformação de path de transcript, planejador e estado da migração são **módulos puros/injetáveis com vitest, teste antes do código**; UI do assistente e a virada em si por **smoke roteirizado** |
| UI em pt-BR, código em inglês | Respeitado |
| LGPD | Conta = id opaco + label. O relatório de migração cita **slug de perfil** (dado de máquina), nunca e-mail ou nome de pessoa; o diff de MCP cita **nome de servidor**, nunca o bloco de configuração |
| `~/.claude-profiles` fica no home local, nunca no OneDrive | O arquivamento renomeia **dentro** de `homedir()`, sem mover para outro volume |
| Nada fora das tasks sem atualizar a spec | As lacunas viraram **C23–C34** na spec, com razão em `research-etapa-2.md` §4 |

## Dependência de sequenciamento — **bloqueante** (dupla) `[T-7]`

> **1. A etapa 1 precisa estar implementada, validada em dogfooding no alfa e
> com um mod ATIVO (`accounts.mod ≠ null`).** O motor nasce inerte (C2);
> demolir perfis antes de ele estar de pé deixaria o app sem meio nenhum de
> trocar de conta.
>
> **2. Os batches da 010 precisam estar fechados em staging.** `src/main/index.ts`
> é o hub compartilhado, e esta etapa **remove** ~120 linhas dele — um refactor
> de remoção concorrente é pior que o da etapa 1, que só somava.

Consequências operacionais:

- Este plano e o `tasks-etapa-2.md` são **documento**: revisáveis e commitáveis
  agora; nenhuma task de código roda antes do gate (T1201).
- Ao contrário da etapa 1, aqui **não dá** para concentrar o toque no hub em uma
  task só: a remoção atravessa `index.ts`, `preload`, `shared/index.ts` e
  `App.tsx`. A mitigação é outra: **a demolição só começa depois que a fonte
  nova já está ligada e verde** (Fase 3 antes da Fase 4), então cada remoção é
  de código comprovadamente sem consumidor.
- **Relação com a etapa 3 (planejada em paralelo, `registry-classe-a/`)**: as
  duas são **independentes** — o registry declara não depender desta (C21 da
  etapa 3), e esta não depende do registry. O ponto de contato é um só e é de
  mão dupla: a etapa 3 introduz a função pura de precedência
  `resolveSessionConfigDir` (**provider > motor > perfil**) e esta etapa
  **preserva** `claudeConfigDir`/`buildPtyEnv` de propósito (C33). Consequência
  prática, dependendo da ordem em que caírem: se a etapa 3 entrar primeiro,
  **T1222 também remove o ramo "perfil"** dessa função (a tabela-verdade dela já
  prevê o mundo sem perfil); se esta entrar primeiro, a etapa 3 nasce com dois
  ramos em vez de três. Em nenhuma ordem alguém remove o parâmetro de config dir
  do `pty-manager`.

## Arquitetura em uma tela

```
   RENDERER
     AccountsPanel.tsx            ← já existe (etapa 1); ganha a entrada do assistente
       └─ MigrationWizard.tsx     ← NOVO, temporário: uma linha por perfil,
            │                       botão "Importar" individual (OK humano)
            │                       + relatório read-only do diff de MCP
            ▼  migration:scan / migration:importCredentials / migration:consolidate
               migration:archive / migration:getState
   ─────────────────────────── preload (src/preload/index.ts) ───────────────────
   MAIN
     accounts/migration/
       ├─ profile-inventory.ts        PURO(+IO injetável): varre ~/.claude-profiles
       │                              slug, nome, tem credencial?, projects é junction?
       ├─ mcp-diff.ts                 PURO: nomes de servidor presentes/ausentes
       ├─ transcript-consolidation.ts PURO: plano de cópia (junction ⇒ vazio)
       ├─ migration-plan.ts           PURO: inventário + estado ⇒ o que falta fazer
       ├─ credentials-import.ts       DENTRO da fronteira de credencial:
       │                              lê <perfil>/.credentials.json ⇒ vault (etapa 1)
       └─ archive-profiles.ts         IO: desfaz as 6 junctions, DEPOIS renomeia
                                      ~/.claude-profiles → .claude-profiles.old
     accounts/vault.ts, account-engine.ts   ← etapa 1, reusados sem alteração
```

E, **fora** desse fluxo, a demolição: `profile-manager.ts`, `quota-headroom.ts`,
`transcript-copy.ts`, `shared/profiles.ts`, `shared/transcriptCopy.ts` e
`ProfileSwitcher.tsx` deixam de existir.

## Decisões de desenho

### D8 — A demolição vem depois da fonte nova estar ligada e verde

A ordem das fases é: migração (Fases 1–2) → **troca de fonte** do rótulo e da
tela de cotas (Fase 3) → **remoção** (Fase 4). Nunca o inverso. Isso torna cada
remoção uma operação sobre código que já não tem consumidor — verificável por
`typecheck`, não por leitura. Remover primeiro e religar depois cria uma janela
em que o app não tem tela de conta nenhuma, e é nessa janela que o dogfooding
para.

### D9 — Os módulos da migração são puros, apesar de descartáveis

Tentação registrada: "é código de uma vez só, script basta". Rejeitado. Este
código **lê credencial**, **apaga links** dentro do home do usuário e
**renomeia** um diretório com o histórico de contas. O ciclo de vida curto é
argumento para o código ser **pequeno**, não para ser não testado. O que é I/O
fica em `*-io` injetável; o que decide fica puro e com vitest antes da
implementação.

### D10 — Inventário antes de plano, plano antes de ação

`profile-inventory.ts` só **lê e classifica**; `migration-plan.ts` só
**decide**; a execução é passo a passo, disparada pela UI, perfil a perfil.
Nenhum passo é encadeado automaticamente com outro. É o que permite ao humano
parar no meio, e é o que torna o assistente reexecutável (C28).

### D11 — Transcripts: comparar `realpath`, não confiar na topologia

`projects` é junction para `~/.claude/projects` em todo perfil criado pelo app
(`PROFILE_LINK_DIRS`), então na máquina real **não há transcript a copiar**. O
plano de consolidação compara `realpath(origem)` com `realpath(destino)`: iguais
⇒ `already-consolidated`, zero cópias. Diferentes ⇒ copia `.jsonl` preservando
o id de sessão e **nunca sobrescreve** destino existente (C26). O mesmo código
cobre os dois mundos — é a lição que o `transcript-copy.ts` já tinha aprendido
em 30/07 e que morre com ele.

### D12 — Desfazer junction é parte do arquivamento, não um passo opcional

`archive-profiles.ts` desfaz as 6 junctions de **cada** perfil e só então
renomeia a raiz. Se o unlink de alguma falhar, o rename **não acontece** e o
relatório diz qual perfil travou. Motivo (C27): renomear com junction viva
deixa uma armadilha para o `rm -rf` humano de semanas depois, que pode
atravessar o link e apagar o `~/.claude` real. O próprio `deleteProfileDirectory`
(`profile-manager.ts:624–644`) já fazia nessa ordem — a lição sobrevive ao
módulo que a aprendeu.

### D13 — Nada é deletado; o verbo é renomear

`~/.claude-profiles` → `~/.claude-profiles.old` (com sufixo de data se já
existir). Nenhuma task desta etapa remove diretório de perfil, nem oferece
botão para isso. A deleção é gesto humano, semanas depois, fora do app.

### D14 — MCPs: diff é relatório, e é sobre nomes

`mcp-diff.ts` devolve `onlyInProfile` / `onlyInGlobal` como **listas de nomes**
de servidor. Sem merge, sem botão "aplicar", sem exibir o bloco de configuração
— argumento de MCP carrega token com frequência (C29).

### D15 — Config legada é tolerada, nunca destruída

`activeProfileSlug` e `archivedPhaseSessions[].profileSlug` deixam de ser
escritos, mas o sanitize continua **aceitando** os dois, e o `profileSlug`
legado é lido como `accountId` quando o campo novo não existir (C30). Motivo
direto do `CLAUDE.md`: os três canais compartilham `userData`, e um canal antigo
aberto depois não pode ter o estado destruído por um sanitize novo.

### D16 — `CLAUDE_CONFIG_DIR` sobrevive como mecanismo

`PtyCreateOptions.claudeConfigDir` e `buildPtyEnv` (`pty-manager.ts:26–86`)
ficam **intactos**, com seu teste. O que morre é o **alimentador** deles (o
perfil ativo). Na etapa 3 quem alimenta passa a ser o provider da classe A
(env + config dir próprio, ticket 05). Fechar essa porta agora custaria
reabri-la na etapa seguinte — e é a interpretação que o discovery explicitou.

## Estratégia de teste

**Testes não são opcionais nesta etapa.** O template do spec-kit os marca como
opcionais; o `CLAUDE.md` do repo manda o contrário para código de produção, e
código que lê credencial e mexe no home do usuário é o caso mais duro disso.

**Vitest (módulo puro/injetável — onde a etapa se decide):**

| Módulo | O que o teste fixa |
|---|---|
| `profile-inventory.ts` | Raiz ausente ⇒ lista vazia sem lançar; perfil sem `.credentials.json`; perfil sem metadado (nome vem do slug); `projects` junction × diretório real × ausente; entrada que não é diretório é ignorada |
| `mcp-diff.ts` | Só nomes; `.claude.json` ausente/corrompido ⇒ diff vazio, nunca lança; **nenhum valor de configuração aparece na saída** (asserção explícita com fixture contendo token plantado) |
| `transcript-consolidation.ts` | `realpath` igual ⇒ zero cópias; diferente ⇒ uma cópia por `.jsonl` com id preservado; destino existente ⇒ pulado, nunca sobrescrito |
| `migration-plan.ts` | Idempotência (perfil já importado não reaparece); perfil pulado é retomável; estado corrompido ⇒ sanitize resiliente com defaults |
| `credentials-import.ts` | Importa **um** perfil por chamada; par nunca aparece em retorno, log ou mensagem de erro (varredura da saída); cofre indisponível ⇒ recusa explícita, nada é lido |
| `archive-profiles.ts` | **Ordem invariante**: todo unlink antes do rename; falha de unlink aborta o rename; `.old` existente ⇒ sufixo de data; **nenhuma chamada de deleção** no dublê de IO (asserção de que o método sequer é invocado) |
| `sessionAccountLabel.ts` (adaptado) | Entrada `account`; rótulo com conta ativa do disparo; `formatArchivedAccountLabel` sobre `accountId` com leitura tolerante do legado |
| `config-store.ts` (ajustado) | `accounts.migration` sanitizada; `activeProfileSlug`/`profileSlug` legados **preservados na leitura** e não escritos de novo |

**Smoke roteirizado (isolado do `%APPDATA%` e do `homedir()` reais, com árvore
de perfis falsa em `mkdtemp`):**

- `migration-wizard.spec.ts` — inventário aparece, importar um perfil deixa os
  outros pendentes, reabrir o assistente mostra o estado correto.
- `migration-nunca-deleta.spec.ts` — depois da virada completa, a árvore
  original continua existindo sob `.old`, com as junctions desfeitas e
  `~/.claude/projects` **intacto** (a asserção que protege contra o pior caso).
- `accounts-panel-substitui-perfis.spec.ts` — não existe mais dropdown de
  perfis; a tela de contas está no lugar dele, com uma unidade só (C25).

**Regressão declarada (T1232):** `npm test` inteiro verde **sem** as 9 suítes
mortas, com a lista das suítes ajustadas e o `git diff` mostrando que nenhuma
outra foi tocada. É o critério de "o que prova que nada quebrou": a suíte global
verde na ausência delas, não a promessa de que elas não eram necessárias.

## Riscos

| Risco | Mitigação |
|---|---|
| **Deleção acidental de `~/.claude` através de junction** (pior caso da etapa) | D12 + smoke `migration-nunca-deleta` + dublê de IO sem método de deleção; o app nunca oferece deletar |
| Demolir com o motor ainda inerte ⇒ app sem troca de conta | Gate duplo (T1201), verificado em dogfooding no alfa antes de qualquer remoção |
| Credencial vazando para a UI durante a importação | Importador dentro de `src/main/accounts/`; retorno da IPC é enum de resultado; teste de varredura da saída |
| Merge de MCP feito por engano | Não existe caminho de escrita: `mcp-diff` só devolve nomes (D14) |
| Conflito com a 010 no `index.ts` (agora removendo linhas) | Gate de "batches fechados em staging"; a remoção do hub é uma task só (T1222), depois de tudo já religado |
| Canal alfa/beta antigo aberto depois da virada apaga config nova | Sanitize com passthrough do legado (D15); risco conhecido registrado no `CLAUDE.md` |
| Perfil com credencial expirada importado para o cofre | Aceito e já previsto na etapa 1 (`expired-credentials` pede re-login uma vez); o assistente marca o perfil como importado, não como "funcionando" |
| Fechar a porta da etapa 3 ao demolir demais | D16: `claudeConfigDir` e seu teste são **intocáveis** nesta etapa |

## Achados do cruzamento spec × plan × tasks (`analyze`, 04/08)

Todos resolvidos nesta fase; nada ficou aberto. Os HIGH estão resolvidos no
plano, como a etapa 1 fez.

| # | Severidade | Achado | Resolução |
|---|---|---|---|
| **A7** | **HIGH** | O passo 2 da migração ("copiar `<perfil>/projects/*.jsonl` para `~/.claude/projects`") assume transcripts separados por perfil — mas `projects` é uma das 6 junctions (`profile-manager.ts:52`), então **todos os perfis já apontam para o mesmo diretório físico**. Implementado ao pé da letra, o passo copiaria arquivo sobre si mesmo | Passo redesenhado como **inventariar → comparar `realpath` → copiar só o que for diretório real** (C26, D11). A spec não encolhe: ela passa a descrever a topologia verdadeira, e o mesmo código cobre a máquina onde a junction não existir |
| **A8** | **HIGH** | A spec fala em "4 suítes de perfil", mas o inventário mede **7** morrendo (as 4 + `quota-headroom.test.ts` 495 L + `transcript-copy.test.ts` 102 L + `transcriptCopy.test.ts` 67 L) — a task de morte escrita com "4" deixaria três suítes órfãs de módulo, quebrando o build | Registrado como **C34** com a razão de cada uma (morrem porque o módulo dono morre, ambos já classificados "morre inteiro" no ticket 01), e a task T1226 lista as 7 nominalmente. Nenhuma outra suíte é removida — as de raspão são **ajustadas** (T1227) |
| **A9** | **HIGH** | "Reiniciar sessão em outra conta" (CA-24 da 009) promete na UI que "a sessão passa a existir nas duas contas; a original congela" (`App.tsx:2954–2958`). Com credencial única e global, isso deixa de ser verdade — o app afirmaria na tela um comportamento que não acontece mais | Resolução inicial era conservadora (manter o gesto, matar só a cópia). Na revisão desta fase (2026-08-04) o **Alexandre decidiu remover o botão também**: com o motor, o equivalente é trocar a conta ativa + retomar por Sessões anteriores — botão dedicado era redundância dos perfis. C31 atualizada: fluxo de reinício morre inteiro (botão, diálogo, estado, cópia, 2 smokes — contados na C34, total 9) e o CA-24 da 009 fica superseded (T1224) |
| A10 | MEDIUM | A spec diz "`sessionAccountLabel` muda de fonte", sem dizer **onde** a conta é gravada; "fato da sessão" podia ser lido como store novo | C24: fato gravado no **nascimento da aba** (mesmo contrato "por valor na criação" de hoje), sem repositório novo; onde já havia persistência (`archivedPhaseSessions`), o campo troca de nome com leitura tolerante |
| A11 | MEDIUM | A etapa 1 aceitou conviver com duas unidades na tela (A3: `AccountLoad` % consumido × `ProfileQuota` % livre). Se a demolição não fechar isso explicitamente, o risco temporário vira permanente | C25 + T1221: com o dropdown de perfis morto, sobra **uma** unidade; a conversão acontece uma vez, na borda de apresentação, e o achado A3 da etapa 1 é dado por fechado |
| A12 | MEDIUM | Arquivar `~/.claude-profiles` **com junctions vivas** deixa uma armadilha para uma deleção humana posterior atravessar o link e apagar `~/.claude` | C27/D12: ordem invariante com teste próprio (todo unlink antes do rename; falha de unlink aborta) + smoke que verifica `~/.claude/projects` intacto após a virada |
| A13 | LOW | O template do spec-kit marca tarefas de teste como opcionais | Sobrescrito no cabeçalho do `tasks-etapa-2.md`, como na etapa 1 |
| A14 | LOW | `.specify/memory/constitution.md` em branco (template) | Gate roda contra o `CLAUDE.md` do repo; registrado na seção correspondente |
| A16 | MEDIUM | **Colisão de numeração entre runs paralelos**: a fase Plano da etapa 3 (`pln-registry-providers-classe-a`) commitou C13–C22 no mesmo dia, enquanto esta fase escrevia. Publicar C13–C24 daqui criaria doze clarifications duplicadas na mesma spec | Renumerado para **C23–C34** em todos os artefatos desta etapa, com nota na spec explicando a continuidade. Achado colateral aproveitado: a etapa 3 declara **não depender** desta (C21 dela), então a frase "a etapa 3 não pode começar antes" foi corrigida no §Dependência para o interlock real (o ramo "perfil" da precedência) |
| A15 | LOW | `ProjectSwitcher.tsx:22` cita um componente de badge que o `ProfileSwitcher` também usa | T1225 confere se o componente é compartilhado **antes** de apagar o arquivo |

## Entregável desta etapa

Depois desta etapa o app não tem mais perfis: existe **uma** config
(`~/.claude`), **um** lugar de conta (a tela do motor), **uma** unidade de cota,
e o histórico dos perfis está preservado em `~/.claude-profiles.old`, com as
junctions desfeitas e as credenciais que o Alexandre aprovou já dentro do cofre.
O backlog perde os itens absorvidos e as specs antigas continuam legíveis,
marcadas como superseded.
