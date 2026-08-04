# B6 — Inventário de paridade, nos dois sentidos

Escrito em 2026-08-04, **antes** de uma linha de código do batch B6
([`batches.md` §B6](./batches.md)). É a etapa 0 do batch: o mapa antigo
(`DiscoveryMap.tsx` + `PhaseDetailsPanel.tsx` + a porta de entrada) sai de
**fome** — ele lê `~/.claude/esteira-state/` e a skill 3.0 parou de escrever ali
(`[D-3]`) —, e nada dele é removido antes de a linha ter destino escrito.

**Nos dois sentidos:** o que o mapa faz e a tela nova não faz, **e** o que a
tela nova ganhou e o mapa não tem.

**Destinos possíveis:**

- **coberta** — o B6 refaz o item sobre o store;
- **coberta por outro batch** — já existe, entregue por B1/B2/B3/B5;
- **perda consciente** — sai, com a razão escrita;
- **pendente** — não cabe neste batch e vira item nomeado no handoff.

---

## 1. O que o mapa antigo faz (e a tela da fase 1 não faz)

| # | Item do mapa | Onde estava | Destino | Razão |
|---|---|---|---|---|
| M-01 | **Carrossel de dois eixos** (níveis no Y, irmãos no X), geometria, setas e contador | `DiscoveryMap.tsx` + `LevelCarousel` | **coberta** | é a forma aprovada por handoff; o `LevelCarousel` do design-system fica intocado — só a fonte dos níveis muda |
| M-02 | **Navegação por níveis**: clique no rótulo, roda do mouse, setas ↑/↓ | `DiscoveryMap.tsx` + `moveLevelFocus` | **coberta** | mesma aritmética pura (`mapLevels.moveLevelFocus`), agora sobre os níveis novos |
| M-03 | **Nível Discovery** com o card raiz | `DiscoveryMap.tsx` | **coberta**, remodelado | o nível passa a listar **todos os discoveries do store** no eixo X — escolher qual conduzir vira navegação, não modal |
| M-04 | **Nível Planos** (cards de plano do `plan_cards[]`) | `DiscoveryMap.tsx` | **coberta**, remodelado | vira o nível dos **planos do store**; "card de plano" era um card do board, e o board deixou de ser o registro (`[D-1]`) |
| M-05 | **Níveis Implementação/Validação** (um card por `fase_num`) | `DiscoveryMap.tsx` | **perda consciente**, substituídos | `fase_num` era a unidade de PR; no modelo novo a unidade é o **item** (`[D-5]`). Os dois níveis viram **um** nível "Itens", com tipo e ciclo de vida |
| M-05b | **Nível-preview fantasma** ("PLANOS", esmaecido, com hint) | `mapLevels.nextLevelPreview` | **coberta** | a forma sobrevive: sem plano ainda, o nível seguinte aparece esmaecido com a frase do que falta acontecer |
| M-06 | **Trilha das fases por card** (chips + glifo + estado + "⌁ Preparar") | `DiscoveryMap.tsx` | **coberta** | é a forma aprovada. A fonte passa a ser `phases[]` do store e a próxima fase sai de `dispatchView` (B2) — o mapa não recalcula "esta fase pode?" |
| M-07 | **7 fases fixas** por card | `codigoTrilhaSteps`/`documentalTrilhaSteps` | **perda consciente** | `[P-4]` — nome de fase é string livre até o horizontal pequeno. A trilha mostra as fases **que rodaram** + a que o catálogo oferece; fase fixa voltaria a afirmar o que ninguém declarou |
| M-08 | **Trilha sintética** (4 etapas fixas, "não realizada") | `syntheticTrilhaSteps` + `buildFullTrilha` (issue #35) | **perda consciente — revertida na origem** | é a issue #35: pinta "não realizada" o que é "não consegui ler". A spec 010 manda revertê-la (§Fora de escopo). O sucessor honesto é o sinal `ingest-error` no card |
| M-09 | **Detalhe da etapa: artefatos declarados** | `PhaseDetailsPanel` + `phaseDetailsView` | **coberta** | o store tem `artifacts[]` (`ArtifactPointer`, `[D-8]`) e nenhuma tela mostrava — o painel volta a mostrar, agora com o ponteiro do store |
| M-10 | **PR da fase** | `PhaseDetailsPanel` (`phasePullRequestFacts`, GitHub) | **coberta** | `verifications[]` está no snapshot e ninguém mostra. Vira a seção "O que dá para conferir": PR, check, review e conclusão (`[D-4]`) — não só PR |
| M-11 | **Garantia da fase** (tipo/descrição/roteiro) | `PhaseDetailsPanel` | **perda consciente** | vinha de `outputs.fases[].garantia` do manifesto 2.x, campo que a 3.0 não grava. O que sobrevive dela é a `verification` de tipo `check` — mesmo fato, sem o campo morto |
| M-12 | **Recibos de conhecimento** (`outputs.knowledge.consulted`) | `PhaseDetailsPanel` | **perda consciente** | idem: campo do manifesto 2.x, sem contraparte no contrato v1. Fabricar a seção vazia seria a tela afirmando o que não leu |
| M-13 | **Fatos do board** (coluna, etiquetas de atenção, trava espelhada) | `boardAnnotation.ts` + `taskdex-board-client` | **coberta por outro batch (B5)** | o board deixou de ser consultado para saber estado (`[D-1]`). O que o card mostra agora é o **espelho**: o que o board ainda não recebeu (`mirrorQueue`) |
| M-14 | **Divergência disco × board** e "⇄ Preparar conciliação" | `boardAnnotation.ts` + `buildConciliationPrompt` | **perda consciente** | divergência só existia porque duas fontes disputavam o mesmo fato. Com o store como registro único, não há o que conciliar: o board é reflexo |
| M-15 | **Relógio de homologação** (24h após o merge) + promoção para a StatusBar | `HomologationClock`, `computeHomologationDeadline` | **perda consciente** | nasceu de outra necessidade (janela de homologação do Spotsys) e depende de `mergedAt` do GitHub, que o contrato v1 não carrega. Sem fonte, o relógio marcaria a hora que ninguém declarou |
| M-16 | **Faixa "worktree \<path\>"** no card de plano | `PhaseNode.artifacts.worktreePath` (frontmatter do `ctx.md`) | **pendente** | o `run-input.json` **tem** `workspace.worktree_path`, mas o `result.json` não devolve o worktree e o snapshot não o guarda. Nomeado no handoff; sem fonte, não desenho |
| M-17 | **"⊘ Liberar trava…"** com confirmação | `DiscoveryMap` + `confirmReleaseLock` | **coberta**, remodelado | a trava deixou de ser etiqueta do board: virou fato local com dono, hora e sessão, liberável num gesto (`[D-11]`, ganho da tela nova — ver T-05) |
| M-18 | **Retomar sessão arquivada** ao clicar numa etapa concluída | `decidePhaseOpen` (`kind: 'resume'`) | **pendente** | o store guarda `Session.cliSessionId` de cada fase — dá para retomar. Não entra aqui porque exige decidir o que "retomar" significa no modelo novo (`[P-6]`, cadeia de sessões). Nomeado no handoff |
| M-19 | **Abrir o artefato** quando não há sessão arquivada | `decidePhaseOpen` (`kind: 'open-artifact'`) | **pendente** | mesma família do M-18; o ponteiro do artefato aparece no painel (M-09), abrir é gesto que ainda não existe |
| M-20 | **Aviso de conta** ("esta etapa rodou na conta X") | `PhaseDetailsPanel` (`archivedAccount`) | **perda consciente** | dependia do registro de sessões arquivadas do modelo antigo (`devMode.archivedPhaseSessions`). O store guarda a sessão, não o perfil de conta — afirmar a conta sem o dado seria inventar |
| M-21 | **Porta de entrada** (modal com os cards do board, busca, dropdown de board) | `DevModeEntry.tsx` | **perda consciente**, substituída | a lista vinha do **board**, e o tracker deixou de ser consultado para saber estado (`[D-1]`). Escolher qual discovery conduzir passa a ser o eixo X do nível Discovery (M-03); criar um passa pelo painel do store. Bônus: era ela que abria sozinha por cima da tela e vazava card real de terceiro em todo print |
| M-22 | **Escolha de repo ambíguo** (issue #34) e **repo real por card** (#38) | `cardRepoResolver` + `devModeSelection.cardRepoLabel` | **perda consciente** | os dois existiam para adivinhar o repo de um card do board. No modelo novo o repo é **declarado** no card e no item (`[D-6]`), e sem repo a fase não dispara — não há o que resolver |
| M-23 | **Encerramento automático do discovery** (`allPlanCardsComplete`) | `devModeSelection.discoveriesToClose` | **perda consciente** | "encerrado" virou a macro etapa **Concluído**, derivada do grafo (`[D-13]`), e ela retrocede quando um item reabre. Um encerramento gravado à parte é justamente a etapa digitada que a spec extingue |
| M-24 | **Arquivamento automático da sessão** ao aparecer o manifesto (`devMode:watchPhase`) | `App.tsx` + `esteira-result-watcher` | **coberta por outro batch (B1)** | o ciclo equivalente existe: o disparo abre a aba, `session.claimed` marca o dono e fechar a aba encerra a sessão e solta a trava |
| M-25 | **Breadcrumb** no header da sessão (discovery › plano › fase) | `App.tsx` + `phaseDetailsView.breadcrumb` | **coberta** | volta com os nós novos: discovery › plano/item › fase |
| M-26 | **Empty state** do mapa ("nasce em `outputs.plan_cards`") | `DiscoveryMap.tsx` | **coberta**, com a frase certa | a frase citava um campo do manifesto 2.x. A nova diz o que é verdade: o histórico nasce limpo e o primeiro plano nasce da skill |

## 2. O que a tela da fase 1 ganhou (e o mapa não tem)

| # | Ganho da tela nova | Onde está | Destino no mapa | Razão |
|---|---|---|---|---|
| T-01 | **Erro de ingestão visível** ("não consegui ler", com caminho e código) | `esteiraView.ingestErrorLine` + sinal `ingest-error` | **coberta — preservar** | é a inversão da issue #35 e o motivo de a spec existir. Vai como sinal no card **e** como bloco no painel de detalhe |
| T-02 | **Trava com dono, hora e sessão, liberável num gesto** | `esteiraView.lockView` | **coberta — preservar** | `[D-11]`. O mapa mostra o bloco no painel de detalhe, com o mesmo texto (importado, nunca reescrito) |
| T-03 | **Macro etapa derivada + override sempre marcado, com a calculada ao lado** | `stageView`/`overrideLine` (B3) | **coberta** | `[D-13]`. O card do discovery mostra a etapa e, havendo ajuste, a linha inteira do ajuste |
| T-04 | **Sinais do card** (sem plano registrado, item sem plano, não consegui ler, espelho pendente) | `signalViews` | **coberta** | viram as etiquetas do card (`AnnotationTag`), no lugar exato das etiquetas de board do mapa antigo |
| T-05 | **Estados de fase com palavra própria** (preparada / sessão aberta / interrompida / concluída / abandonada / falhou) | `phaseLine` + `PhasePresence` (B1) | **coberta** | é o vocabulário da trilha. `trilhaStateLabel` do mapa antigo (5 palavras fixas) morre — a frase nasce em `esteiraView` |
| T-06 | **Item com tipo, ciclo de vida, estado em pt-BR, repo herdado e origem** | `itemLine`/`itemRepoOf` (B2/B3) | **coberta** | é o conteúdo do card de item do nível novo |
| T-07 | **Gestos do item** (começar, concluir, abandonar, reabrir, descartar) | B3 | **coberta por outro batch (B3)** | ficam no painel do store; o mapa mostra o efeito (a etapa recalculada), não duplica o gesto |
| T-08 | **Disparo por assunto, com a fase que o card não comporta desabilitada e a razão escrita** | `dispatchView` (B2) | **coberta** | o "⌁ Preparar" da trilha usa `dispatchView` como fonte — o mapa **não** recalcula o que pode |
| T-09 | **Espelho pendente + reenviar** | `mirrorLines` (B5) | **coberta** | entra como sinal no card e bloco no painel; o texto vem de `esteiraView.mirrorLines`, importado |
| T-10 | **Notas do card e do item** | B3 | **coberta** (leitura) | o painel mostra as notas; escrever nota continua no painel do store |
| T-11 | **Varredura do outbox com a frase do que entrou/foi recusado** | `scanMessage` (B3/B5) | **coberta por outro batch** | fica no painel do store; o mapa reflete o resultado (o snapshot chega por `esteira:changed`) |
| T-12 | **Aviso de compatibilidade do store** (só leitura / migração / ilegível) | `STORE_COMPATIBILITY_WARNING` | **coberta** | o mapa mostra o mesmo aviso: uma tela que aceita gesto sem poder gravar é uma tela que mente |
| T-13 | **Criação de discovery** | `EsteiraScreen` | **coberta por outro batch** | fica onde está. O mapa leva até lá num gesto ("＋ Novo discovery" abre o painel do store) — o app não ganha um segundo formulário |
| T-14 | **Proveniência "semeado"** | B4 (`seed.ts`) | **pendente** | o B4 não está mergeado nesta branch. Quando entrar, o mapa precisa da marca, senão o card semeado aparece como fato observado — o mesmo bug, na tela nova. Nomeado no handoff |
| T-15 | **Caminho do histórico e do inbox/outbox** | cabeçalho do `EsteiraScreen` | **perda consciente no mapa** | é informação de depuração; fica no painel do store, que é o lugar dela |

## 3. O destino da tela da fase 1

**Fica** — como **painel do store**, atrás do mesmo gesto interno (o ícone de
rota no titlebar), agora nomeado pelo que é.

Por quê, e não "sai de cena":

1. Ela é o único lugar onde vivem gestos que o mapa **não** vai oferecer e que a
   spec exige que existam: criar discovery, os cinco gestos do B3 (estado do
   item, descarte, override, nota), reenviar espelho e varrer o outbox. Matá-la
   agora seria perder trabalho de três batches para não deixar andaime em pé.
2. O mapa é **projeção**; o painel é onde se **age** e se depura ("o que o store
   tem, cru"). São dois papéis, não dois desenhos da mesma coisa.
3. O risco de andaime virar dívida é o de ele mentir. Ele não mente: mostra o
   snapshot e nada além.

O que muda nela neste batch: **nada de comportamento**. Só o rótulo do gesto que
a abre ("Painel do store"), para ninguém a confundir com o mapa.

## 4. O que sai do código (e o que vai junto)

| Arquivo | Destino |
|---|---|
| `src/main/discovery-tree.ts` | **removido** (`[P-5]`) |
| `src/main/esteira-reader.ts` | **removido**; o `createSystemEsteiraReaderIoDeps` — leitura de arquivo genérica, sem nada de esteira — vira `src/main/file-io.ts` |
| `src/shared/boardAnnotation.ts` | **removido** — anotava a árvore com fatos do board (M-13/M-14) |
| `src/shared/phaseDetailsView.ts` | **removido** — view-model do painel sobre `PhaseNode` (M-09..M-12) |
| `src/renderer/src/DevMode/DevModeEntry.tsx` | **removido** (M-21) |
| `src/renderer/src/DevMode/devModeSelection.ts` | **removido** — todas as suas funções serviam à porta de entrada e à árvore (M-21/M-22/M-23) |
| `src/renderer/src/DevMode/openPhaseSession.ts` | **reduzido** ao `createPrimeSequencer` (o "um comando, um Enter" que o B1 reusa). `decidePhaseOpen`, `resolveCommandSequence` e `buildConciliationPrompt` saem com o modelo antigo |
| `src/shared/mapLevels.ts` | **reduzido** ao que o carrossel novo usa (`moveLevelFocus`, `buildTrilha`, `needsCarousel`, `resolveCardDisplayTitle`); o resto sai com M-08/M-13/M-15 |
| `src/main/index.ts` → `devMode:readTree` | **removido** (não há mais árvore para ler) |
| `tests/discovery-tree.test.ts`, `tests/esteira-reader.test.ts`, `tests/boardAnnotation.test.ts`, `tests/phaseDetailsView.test.ts`, `tests/devModeSelection.test.ts` | **removidos com o código que testam** |

Fica de pé, sem uso pelo mapa: `taskdex-board-client.ts`, `github-reader.ts`,
`cardRepoResolver.ts` e os handlers `devMode:*` que os servem. Não são do mapa —
o adapter do board (B5) e o que vier de tracker vão precisar deles, e removê-los
aqui seria escopo de outro batch.
