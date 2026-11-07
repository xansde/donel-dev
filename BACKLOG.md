# BACKLOG — donel-dev

<!-- Único arquivo de trabalho na raiz (FRAMEWORK). Só trabalho vivo: demanda
     encerrada (todas as tarefas em concluida) é varrida pra
     docs/backlog-archive/<demanda>.md pelo próximo /fatiamento — que também
     remove o worktree das fatias concluidas.
     Ordem das tarefas = ordem recomendada de execução.
     Fronteira (/implementacao): claimável = toda Depende de em implementada
     (ou além) E nenhum Conflita com apontando fatia em-andamento. Conflita com
     vs implementada NÃO bloqueia (o rebase do PR resolve). Rodadas previstas
     no cabeçalho = simulação da fronteira pra leitura humana — a /implementacao
     recomputa a fronteira ao vivo pelos status. Campo Onda presente = formato
     1.14.0: barreira de onda preservada, sem retrofit. Fatia com Depende de
     não mergeada usa stacked branch (ver /implementacao).
     Worktree (/implementacao): toda fatia roda em worktree isolado —
     $ESTEIRA_WT_DIR/<repo>-<branch-slug>, fallback ../wt/<repo>-<branch-slug>,
     sempre fora do repo e sem dot-dir; o clone principal fica em main.
     Claim (/implementacao): flip pra em-andamento no BACKLOG.md do CLONE
     PRINCIPAL, ANTES de trabalhar (claim dentro do worktree não protege) —
     sessões concorrentes pulam tarefas claimadas; escrita no working tree, sem
     commit. Entrega da fatia flipa pra implementada + branch + worktree (o fix
     loop da /revisao reabre); a /simplificacao flipa pra aguardando-merge ao
     fechar; concluida é só do merge (flip do autor após mergear; a varredura do
     /fatiamento confere PR mergeado como fallback).
     Modo-demanda (/implementacao demanda <slug>): a /implementacao escreve a
     linha "Modo" no cabeçalho da seção; implementada = mergeada na integradora;
     aguardando-merge e concluida flipam em bloco (PR único da demanda). -->

## Cadeiras no Mindscape e tela de cadeira (`cadeiras`)

- **Plano**: `docs/planos/cadeiras.pda.md` (PR #256, rascunho) + arquitetura curta `docs/planos/cadeiras-arquitetura.md`
- **Forma**: F2a para o Mindscape e B1 com custo recolhível (`~/seazone/insumos/prototipos-cadeiras/decisao.md`, dono, 06/11)
- **Pedido** (dono, 07/11, via Líder): "Ontem aprovei protótipos de visualização do mindscape. Quero eles rodando"
- **Fatiado em**: 2026-11-07 (sessão Dev na VPS; as skills `esteira:*` não estavam carregadas, então o rito foi seguido à mão)
- **Rodadas previstas**: 01 | 02 | 03 | 04 → 05, 06, 07 | 08 <!-- 04 espera as decisões 02 e 03 do PDA (dono); 05-07 dependem da 04 -->

Convenções: um PR por fatia contra `staging`; `npm run verify` verde; tela sem teste (o dono vê no alfa);
**schema do `mindscape.json` ou do ledger que mudar ganha teste de parse/migração**; patch note em toda fatia visível;
print lado a lado com o protótipo em `docs/prototipos/cadeiras/`.

### 01 — Lente "Cadeiras" (F2a) com dados reais, sem gravar nada

- **Status**: implementada
- **Branch**: `feat/cadeiras-f2a-fatia1`
- **Depende de**: —
- **Propósito**: "Lugares | Cadeiras" nas abas do Mindscape; rig = quadro; uma cadeira por papel (nome grande,
  N sentados, borda = saúde); setas do caminho do trabalho; faixa problema/atenção/bem/sem sinal que destaca;
  gaveta (sentados, quem já sentou, onde parou, Oráculo, configurado × observado); seu desenho por
  cima/esmaecido/oculto e editável. Nenhum campo novo: `schemaVersion` fica em 5.
- **Como testar**: no alfa, Mindscape → Cadeiras; clicar em Dev; Esc; Esmaecido; voltar a Lugares (a vista volta).

### 02 — Tela de cadeira B1, lendo o papel

- **Status**: pendente
- **Depende de**: 01
- **Propósito**: "Definir cadeira ▸" abre a B1 da cadeira: seções (instruções, skills, MCPs, plugins, modelo e
  esforço, permissão) com selo de origem ("seu ~/.claude" ou "Papel"), lendo o papel e o escopo do #250; a coluna
  lateral de custo é recolhível e lembrada, e recolhida vira uma faixa com o total (estimativa, marcada como tal).
  Só leitura nesta fatia.

### 03 — B1 grava no papel

- **Status**: pendente
- **Depende de**: 02
- **Propósito**: salvar instruções, escopo, modelo, esforço e permissão pela B1, pelo `roles-store` (único dono de
  `<userData>/papeis/`); "vale para quem sentar depois de salvar". O total da coluna de custo muda ao ligar ou
  desligar um item.

### 04 — Rig e pods guardados (`mindscape.json` v6)

- **Status**: pendente, **bloqueada** pelas decisões 02 e 03 do PDA (dono): o que é cadeira guardada, cadeira
  elástica, se cadeira é só de um rig, e se o dono posiciona a cadeira ou só o pod
- **Depende de**: 01
- **Propósito**: molduras tipadas (rig | pod) com nome, missão e paradigma; cadeira dentro de pod com posição própria;
  endereço `papel@rig` estável. A F2a ganha as molduras de pod. Teste de parse v5 → v6 e canal antigo só leitura.

### 05 — Folhas de instrução do rig e do pod

- **Status**: pendente
- **Depende de**: 04 (e decisão do item 04 do PDA: onde guardar, como versionar e injetar)
- **Propósito**: folha por rig e por pod, editável na B1 com selo "Rig"/"Pod" e lida na gaveta do rig/pod;
  injeção em camadas Donel → Rig → Pod → Cadeira no spawn.

### 06 — Saúde real, onde parou e observado medido

- **Status**: pendente
- **Depende de**: 04 (e item 06 do PDA)
- **Propósito**: trocar a regra provisória de saúde pela decidida; "onde parou" escrito pela sessão (não a última
  nota); esforço observado lido do argv real de cada spawn.

### 07 — Tarefas do Oráculo presas à cadeira (ledger v5)

- **Status**: pendente
- **Depende de**: 04 (e item 07 do PDA)
- **Propósito**: a tarefa aponta a cadeira; o ocupante fica no evento; teste de parse v4 → v5.

### 08 — F2b ligável (uma linha embaixo do nó)

- **Status**: pendente, só se o dono pedir
- **Depende de**: 01
- **Propósito**: opção na faixa para mostrar "onde parou" em até 6 palavras e o selo de estado embaixo de cada nó.

## Cartas do Oráculo, forma A (`cartas-forma-a`)

- **Spec**: `docs/specs/cartas-forma-a.md` (branch `proto/cartas`, commit 321c673); forma em
  `docs/prototipos/carta-oraculo/final.html`, escolha do dono em `decisao.md`
- **Pedido** (dono, 05/11): "A ideia é ser a forma A. Mas não existe suporte para eu ver os protótipos nas próprias cartas nem como escrever lá."
- **Fatiado em**: 2026-11-05 (sessão Dev na VPS; sem MCP `donel`, o registro fica nos PRs). A ordem é a da spec.
- **Rodadas previstas**: 01 | 02 | 03 | 04, 05, 06 <!-- 04-06 dependem da 01 e correm depois da 02 e da 03 (spec) -->

Convenções: testes só os que a spec lista; tela sem teste (o dono vê no alfa); `npm run verify`
verde; um PR por fatia contra `staging`; patch note em toda fatia visível.

### 01 — Contrato (Parte C)

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a`
- **Depende de**: —
- **Propósito**: `titulo` no `tarefa_criar`; bloco `paraODono` no `tarefa_entregar` (gravado como
  `forOwner`), obrigatório no risco alto; `findCode` recusa código no texto do dono; decisão grava
  `option`; evento `comentada` já no schema; `schemaVersion` 3; régua de quando sobe nas descrições.
- **Como testar**: `tests/ledger.test.ts` (parse v2→v3 sem perda; `findCode`; risco alto sem bloco
  recusado; decisão por opção grava `option`).

### 02 — Carta A no celular

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a-02-celular` (empilhada na 01)
- **Depende de**: 01
- **Propósito**: frente e verso lendo o bloco; opções com nome decidindo; quadro de checagens; verso
  único para entrega sem bloco; nenhum id fora de "Detalhes técnicos".

### 03 — Carta A no desktop

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a-03-desktop` (empilhada na 02)
- **Depende de**: 01
- **Propósito**: o "esperando você" da faixa do Mindscape abre a mão de cartas (como no `final.html`).

### Futura — amostra do Revisor em forma A (anotada, sem data)

- **Status**: anotada
- **Origem**: decisão do Líder único em 05/11, até o dono dizer o contrário: a carta da amostra do dia
  (aceite do Revisor que o dono confere) segue na forma antiga por enquanto; vira forma A numa fatia futura.
- Decididas na mesma conversa: dois toques para decidir (mantém); arrastar não escolhe o recomendado
  (decidir pede gesto explícito); a mesa do desktop cobre só o quadro (ajuste no #238); o protótipo nunca
  abre fora da carta.

### 04 — Protótipo dentro da carta (Parte A)

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a-04-prototipo` (empilhada na 03)
- **Depende de**: 01 (depois da 02 e da 03)
- **Propósito**: HTML como prova (2 MB); bilhete de uso único + CSP `sandbox allow-scripts` no
  celular; protocolo `donel-prova:` no desktop.

### 05 — Escrever na carta (Parte B)

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a-05-escrever` (empilhada na 04)
- **Depende de**: 01 (depois da 02 e da 03)
- **Propósito**: op `comentar`; mensagem à sessão dona, ou ao Líder, ou guardada; recibo e conversa
  no verso; reentrega depois de `comentada`.

### 06 — Prova de arquivo vinda da VPS

- **Status**: implementada
- **Branch**: `feat/cartas-forma-a-06-vps` (empilhada na 05)
- **Depende de**: 01 (depois da 02 e da 03)
- **Propósito**: a cópia da prova pelo ssh do próprio lugar remoto, sem interpolar caminho em shell.

## Mindscape — desenho, print, Ctrl+Z e zoom (`mindscape-desenho`)

- **Design**: `docs/design/mindscape-desenho.md`
- **Versão**: — (demanda própria, sem versionamento; nasceu da hipótese V2 de `docs/versoes/mindscape.md`)
- **TaskDex**: — (sem card: ferramenta pessoal; esta execução não conta na adoção)
- **Fatiado em**: 2026-10-24
- **Gate**: aprovado por Claude por delegação de Alexandre Lentz em 2026-10-24 <!-- gatilho 3 (dependências encadeadas: 02 de 01, 03 de 02, 04 de 03, 05 de 04, 06 de 04); decidido por delegação do dono, 2026-10-24 — as 6 fatias passam nos 4 critérios e a ordem segue a dependência de código -->
- **Rodadas previstas**: 01 | 02 | 03 | 04 | 05 | 06 <!-- serial: todas pisam em model.ts, MindscapeScreen.tsx, MindscapeBoard.tsx e na barra; trabalho sequencial na feature/mindscape-desenho, no checkout principal (instrução do dono) -->

Convenções que valem para as 6 fatias: lógica pura com vitest test-first (vermelho → verde) nos
módulos de `src/shared/mindscape/` e `src/main/` que o design lista; tela por smoke Playwright em
`tests/smoke/mindscape-desenho.spec.ts` (um `test` por fatia, `launchIsolatedApp` + claude falso,
`DONEL_MINDSCAPE_FILE` apontando para arquivo temporário, roteiros em
`tests/fixtures/mindscape/scenarios/`); fixtures só com projetos `atlas`, `beacon`, `vega`; UI em
pt-BR; nenhuma dependência npm nova (o design decide: nenhuma). Os smokes da V1
(`tests/smoke/mindscape*.spec.ts`) continuam verdes ao fim de cada fatia; onde o design muda um
gesto que eles usam, a fatia ajusta o passo e diz qual. Nenhuma fatia toca `src/main/accounts/`, o
Modo Dev, o `config.json` nem `src/main/chat/attachments.ts` (a 06 só importa dele). Sem tela
desenhada para esta entrega: a forma segue a barra atual e os tokens do design system, e se ajusta
no alfa.

### 01 — Barra de ferramentas: formas, setas soltas e seta de post-it a post-it vira Ligação

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (modelo, desenhos, visão, hit-test, atalhos, store) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-01.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: —
- **Conflita com**: 02, 03, 04, 05, 06
- **Propósito**: o dono escolhe na barra (ou pela tecla `V H A L R O`) uma ferramenta e desenha
  retângulo, elipse, linha e seta no quadro, com cor e espessura escolhidas; seta ou linha puxada
  de um post-it a outro vira Ligação, e o botão "Ligar" some. Tudo volta depois de relançar o app.
- **Escopo**: entra o modelo v2 em `model.ts` (tipos `MindscapeDrawing`, `drawings`, campo `zoom`
  fixo em 1 até a 05, `schemaVersion: 2`, `parseMindscapeDoc` lendo v1 e v2 e descartando desenho
  inválido dos tipos `line`/`rect`/`ellipse`, `addLink` com `arrow` no `LinkInput`, padrão `true`);
  `drawings.ts` com `addDrawing` (normaliza `w`/`h`); `mindscape-store.ts` gravando v2 com a guarda
  inalterada; `view.ts` com `screenToWorld`/`worldToScreen`/`clampZoom` (os gestos já convertem por
  ele); `geometry.ts` com `cardAtPoint`; `shortcuts.ts` com as letras `v h a l r o` e `Escape`;
  `<section>` do Mindscape focável (`tabIndex={-1}`, foco ao montar e a cada `pointerdown`),
  `MindscapeToolbar.tsx` (ferramentas com letra e `aria-pressed`, 3 cores e 3 espessuras do próximo
  desenho, "Seta"/"Remover ligação" da Ligação selecionada, "Novo post-it", "Ir ao terminal", faixa
  de dica), `MindscapeDrawingLayer.tsx` (SVG sob as Ligações, roughjs com `seed` por id, geometria
  local + `transform`), máquina `draw` no `MindscapeBoard` (`A L R O`, prévia local, gesto < 4 px
  descartado, `A L R O` voltam para `V`, `Esc` cancela e volta para `V`), `H` movendo a visão
  (com `V`, arrastar o fundo segue movendo a visão como na V1 até a 03). A tela passa a falar com o
  `App` por um único `onAction(projectPath, reducer)` para as ações novas (sem histórico ainda).
  Sai o modo "Ligar" inteiro (`linking`, `linkOrigin`, `pickForLink`, dica, `data-linking` e CSS);
  o passo "Ligar" de `tests/smoke/mindscape-links.spec.ts` passa a desenhar com `A`. NÃO entra:
  selecionar/mover/apagar desenho, alças e camadas (03), lápis e borracha (04), `Ctrl+Z` (02),
  zoom e roda (05), print (06).
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas` (roteiro `slow-turn.json`) e
  um post-it do dono criado pelo smoke; um `mindscape.json` v1 de amostra para o vitest do parse.
- **Como testar**:
  - vitest (`tests/mindscape-drawings.test.ts`, `tests/mindscape-view.test.ts`,
    `tests/mindscape-geometry.test.ts`, `tests/mindscape-shortcuts.test.ts`, mais casos em
    `tests/mindscape-model.test.ts` e `tests/mindscape-store.test.ts`): `parseMindscapeDoc` de um v1
    sai com `drawings: []` e `zoom: 1`, e grava v2; desenho com cor fora das 3, espessura
    desconhecida, número não finito ou `w`/`h` ≤ 0 cai; `addDrawing` normaliza caixa desenhada de
    baixo para cima; `addLink` sem `arrow` nasce com seta e com `arrow: false` nasce sem;
    `screenToWorld(worldToScreen(p))` volta a `p`; `clampZoom` prende em 0,25 e 4; `cardAtPoint`
    devolve o cartão de cima quando dois se sobrepõem e `null` no fundo; `mindscapeShortcut` mapeia
    as letras sem diferenciar maiúscula, devolve `null` com `Ctrl`/`Alt`/`Meta` ou `editable`; o
    store lê v1, grava v2 e fica read-only com `schemaVersion` 3.
  - smoke: no `atlas`, apertar `R` → a barra marca "Retângulo"; arrastar no fundo → aparece o
    retângulo e a ferramenta volta para `V`; `O`, `L` e `A` com uma ponta fora de post-it → elipse,
    linha e seta soltas gravadas em `drawings`; escolher Dourado e grosso antes de `R` → o
    retângulo novo sai com essa cor e espessura; `A` do post-it do dono ao da sessão → nasce
    Ligação com `data-arrow="true"` e nada entra em `drawings`; `L` entre os mesmos dois → nada
    novo (par já ligado); botão "Ligar" ausente; `Esc` no meio de um gesto → nada é criado e a
    ferramenta volta para `V`; tecla `r` com o foco no texto do post-it do dono → vai para o texto;
    relançar o app → desenhos e Ligação iguais e `mindscape.json` com `schemaVersion: 2`; os smokes
    da V1 seguem verdes.

### 02 — Ctrl+Z e Ctrl+Shift+Z no quadro, sem desfazer o que a sessão fez

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (`history.ts`, atalhos) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-02.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: 01
- **Conflita com**: 01, 03, 04, 05, 06
- **Propósito**: o dono desfaz com `Ctrl+Z` e refaz com `Ctrl+Shift+Z` qualquer ação sua no quadro
  (desenhar, criar/editar/mover/arquivar post-it, criar/remover Ligação, ligar/desligar a seta),
  um gesto por vez, sem que um post-it da sessão surgido no meio suma ou volte ao texto antigo.
- **Escopo**: entra `history.ts` (pilhas por quadro, limite de 100, ação nova zera o refazer,
  `mergeSessionFacts`), `useMindscapeDoc` com `apply(projectPath, reducer)` (grava histórico),
  `applySession(reducer)` (não grava) e `undo`/`redo`, mapa `projectPath → { undo, redo }` num `ref`
  que sobrevive à troca de modo; no `App.tsx`, os callbacks da V1 (`onMoveCard`, `onArchive`,
  `onAddOwnerCard`, `onEditOwnerCard`, `onSetOwnerColor`, `onAddLink`, `onToggleLinkArrow`,
  `onRemoveLink`) viram o `onAction` da 01, e `placeSessionCard`/`writeSessionNote` passam por
  `applySession`; `setBoardView` não existe ainda (vem na 05) e o `pan` segue fora do histórico;
  `Ctrl+Z`/`Ctrl+Shift+Z` no `mindscapeShortcut`, ignorados durante gesto em andamento e não
  tratados com o foco no texto do post-it. NÃO entra: histórico persistido, histórico de pan/zoom.
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas` com um roteiro que termina o
  turno (`Stop` com `last_assistant_message`) depois de um prompt enviado pelo smoke, para o
  `turn-ended` cair no meio das ações do dono.
- **Como testar**:
  - vitest (`tests/mindscape-history.test.ts`, mais casos em `tests/mindscape-shortcuts.test.ts`):
    `undo` devolve o `before` e `redo` o `after`; a 101ª entrada tira a mais antiga; ação nova
    depois de um `undo` esvazia o refazer; `mergeSessionFacts` mantém post-it de sessão que não
    existia no snapshot, mantém `text`/`writtenAt`/`sessionName` atuais do post-it escrito pela
    sessão com a posição do snapshot, mantém inteiro o escrito pela sessão que nasceu depois, traz
    `pan` e `zoom` do atual e descarta Ligação cujo cartão sumiu; `Ctrl+Z`, `Ctrl+Shift+Z` (inclusive
    com `key` `Z`) mapeiam e `editable` devolve `null`.
  - smoke: desenhar um retângulo, criar um post-it do dono e arrastá-lo; mandar um prompt e esperar
    o post-it escrito pela sessão aparecer; `Ctrl+Z` três vezes → o post-it do dono volta para onde
    nasceu, depois some, depois o retângulo some, e o post-it escrito pela sessão continua com o
    texto novo;
    `Ctrl+Shift+Z` → o retângulo volta; com o foco no texto do post-it, `Ctrl+Z` desfaz só a
    digitação; trocar para "Uso geral" e voltar → o refazer continua lá; relançar o app → `Ctrl+Z`
    não faz nada (histórico vazio).

### 03 — Seleção múltipla, alças, estilo e camadas

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (reducers, hit-test, atalhos) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-03.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: 02
- **Conflita com**: 01, 02, 04, 05, 06
- **Propósito**: com `V`, o dono clica num desenho ou post-it para selecionar, soma com
  `Shift+clique`, faz laço arrastando o fundo, seleciona tudo com `Ctrl+A`, move a seleção junta,
  apaga com `Delete`, redimensiona pelas alças, troca cor/espessura e muda a camada; move a visão
  com `H` ou espaço + arrastar.
- **Escopo**: entra em `drawings.ts` `updateDrawing`, `moveItems`, `removeItems` (post-it do dono e
  escrito pela sessão saem por `archiveCard`, post-it de sessão é ignorado), `setDrawingsStyle`,
  `bringToFront`/`sendToBack`; em `geometry.ts` hit-test de linha, retângulo e elipse (só perto do
  contorno, tolerância `stroke/2 + 6 px de tela`), `hitTestDrawings`, `itemsInsideRect`,
  `drawingBounds`, `resizeDrawing` (cantos de retângulo e elipse, pontas de linha solta, mínimo de
  4 unidades) e `linkEndpoints` movido de `roughShapes.ts` (que o re-exporta);
  `MindscapeSelectionLayer.tsx` (contorno, alças só com um desenho selecionado, laço); seleção
  `{ cards, drawings }` no `MindscapeScreen` substituindo a seleção única; `Delete`, `Ctrl+A`,
  `Ctrl+Shift+]`/`}` e `Ctrl+Shift+[`/`{` (por `event.key`) no `mindscapeShortcut`; botões de
  camada na barra; cor/espessura da barra aplicadas à seleção e ao próximo desenho; Ligação
  selecionada removida também por `Delete`; "Ir ao terminal" ativo com exatamente um post-it de
  sessão selecionado; espaço segurado no `keydown`/solto no `keyup`/`blur`. Arrastar o fundo com
  `V` deixa de mover a visão e vira laço: o passo 3 de `tests/smoke/mindscape-canvas.spec.ts`
  passa a mover a visão com `H`. Alça de ponta de linha solta nunca a converte em Ligação. NÃO
  entra: Rabisco no hit-test e na seleção (04), print (06), zoom (05).
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas`; um post-it do dono e
  desenhos criados pelo próprio smoke.
- **Como testar**:
  - vitest (casos novos em `tests/mindscape-drawings.test.ts` e `tests/mindscape-geometry.test.ts`;
    `tests/mindscape-links.test.ts` segue verde sem mudança): `moveItems` move cartões e desenhos
    juntos; `removeItems` arquiva post-it do dono, ignora post-it de sessão e tira desenho;
    `setDrawingsStyle` muda cor e espessura; `bringToFront`/`sendToBack` mantêm a ordem relativa do
    grupo; todo reducer devolve o mesmo objeto quando nada muda; `hitTestDrawings` acerta o de cima,
    acerta o contorno do retângulo e erra o miolo; `itemsInsideRect` pega só o que fica inteiro
    dentro; `resizeDrawing` não passa de 4 unidades no mínimo; `mindscapeShortcut` mapeia
    `Delete`, `Ctrl+A` e os colchetes por `key`.
  - smoke: desenhar dois retângulos; clicar no primeiro e `Shift+clique` no segundo → os dois
    selecionados; arrastar um → os dois andam e `Ctrl+Z` os traz de volta numa vez; laço em volta
    de um retângulo e do post-it do dono → ambos selecionados; escolher Azul → só o retângulo muda;
    puxar a alça de canto → o retângulo cresce; "Mandar para trás" → a ordem em `drawings` inverte;
    `Ctrl+A` e `Delete` → desenhos somem, o post-it do dono vai para arquivado e o post-it de sessão
    fica; clicar na Ligação e `Delete` → some; espaço + arrastar e `H` + arrastar movem a visão;
    selecionar só o post-it de sessão → "Ir ao terminal" ativo; os smokes da V1 seguem verdes.

### 04 — Lápis e borracha que apaga o pedaço tocado

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (`eraser.ts`, parse e amostragem do Rabisco, `pencilPath`, hit-test, atalhos) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-04.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: 03
- **Conflita com**: 01, 02, 03, 05, 06
- **Propósito**: com `P`, o dono rabisca à mão livre; com `E`, passa a borracha e apaga só o trecho
  tocado (um Rabisco ou linha solta pode virar dois), enquanto retângulo, elipse e Ligação saem
  inteiros e post-it nunca sai; cada passada se desfaz com um `Ctrl+Z`.
- **Escopo**: entra o tipo `pencil` no parse (`points` par, com 2 pontos ou mais) e na amostragem
  do traço (mínimo de 2 unidades entre pontos, teto de 5.000, arredondado a 0,1); `pencilPath` em
  `roughShapes.ts`; Rabisco no `hitTestDrawings`, no laço e na seleção (só move e apaga, sem alça);
  `eraser.ts` com `erasePolyline` e `eraseBoard` (`newId` injetado; só o pedaço que mantém a ponta
  original da seta continua com seta); letras `p` e `e` no `mindscapeShortcut`; `P` e `E` ficam
  ativos depois do gesto; círculo de prévia de 8 px de tela no cursor; prévia local da passada e
  `eraseBoard` rodando de novo no `pointerup` sobre o quadro atual, numa entrada de histórico. NÃO
  entra: print na borracha (06), traço com pressão (fora pelo design).
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas`; desenhos e uma Ligação
  criados pelo smoke.
- **Como testar**:
  - vitest (`tests/mindscape-eraser.test.ts`, mais casos em `tests/mindscape-geometry.test.ts`,
    `tests/mindscape-model.test.ts` e no teste de `roughShapes`): `erasePolyline` com a borracha no
    meio de um traço reto devolve dois trechos; nas pontas, um trecho mais curto; longe, o traço
    inteiro; corrida com menos de 2 pontos ou menor que 1 unidade some; `eraseBoard` mantém o `id`
    no primeiro pedaço e usa `newId` nos outros, tira retângulo/elipse quando toca o contorno e
    não no miolo, tira a Ligação tocada e nunca tira post-it; seta partida deixa a ponta só no
    pedaço final; `parseMindscapeDoc` descarta Rabisco com `points` ímpar; `pencilPath` é estável
    para os mesmos pontos.
  - smoke: `P` → riscar uma linha horizontal → um Rabisco em `drawings` e a ferramenta segue `P`;
    `E` → passar a borracha no meio dele → `drawings` tem dois Rabiscos; passar sobre o contorno de
    um retângulo → some inteiro; passar sobre a Ligação → some; passar sobre um post-it → fica;
    `Ctrl+Z` → a última passada volta inteira; com `V`, clicar no Rabisco seleciona e arrastar
    move; relançar o app → como deixado.

### 05 — Zoom de 25% a 400%, salvo por quadro

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (`zoomAt`, fator da roda, passos do indicador, `wheelPan`, `setBoardView`) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-05.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: 04 <!-- usa applySession (02) para setBoardView e divide pelo zoom as tolerâncias do hit-test (03) e o raio da borracha (04) -->
- **Conflita com**: 01, 02, 03, 04, 06
- **Propósito**: o dono dá zoom com `Ctrl+roda` ou pinça, centrado no mouse, entre 25% e 400%, vê
  e ajusta no indicador "− 100% +", move a visão com a roda (`Shift+roda` na horizontal), e cada
  quadro volta com o zoom em que ficou; o zoom da página do Electron não dispara no quadro.
- **Escopo**: entra em `view.ts` `zoomAt` (ponto do quadro sob o mouse fixo) e o fator
  `1,1^(−delta/100)` com `normalizeWheelDelta` de `src/shared/pet/gestures.ts`; `setBoardView`
  substituindo `setBoardPan` (porta `applySession`, fora do histórico, debounce de 500 ms);
  plano com `translate(pan) scale(zoom)` e `transform-origin: 0 0`, grade de pontos acompanhando;
  listener nativo não passivo de `wheel` na tela do Mindscape (`preventDefault` sempre com
  `ctrlKey`); indicador no canto inferior (`−`/`+` andam 10 pontos centrados no meio da visão,
  clicar no número volta a 100%); "Novo post-it" calculando o canto visível com `screenToWorld`;
  tolerâncias e raio da borracha em px de tela divididos pelo zoom. NÃO entra: zoom da página por
  `Ctrl+=`/`Ctrl+-` (fora pelo design), minimapa, histórico de zoom.
- **Dados necessários**: abas `claude` do falso nos projetos `atlas` e `beacon`, para provar que o
  zoom é por quadro.
- **Como testar**:
  - vitest (casos novos em `tests/mindscape-view.test.ts` e `tests/mindscape-model.test.ts`):
    `zoomAt` mantém fixo o ponto do quadro sob o mouse e respeita 0,25 e 4; o fator da roda é
    maior que 1 para delta negativo e menor para positivo; `setBoardView` grava `pan` e `zoom` e
    devolve o mesmo objeto sem mudança; `parseMindscapeDoc` corrige zoom fora da faixa para o
    limite.
  - smoke: no `atlas`, `Ctrl+roda` para cima sobre o quadro → o indicador passa de 100% e
    `webContents.getZoomFactor()` segue 1; o ponto sob o mouse fica no lugar (posição em tela de um
    post-it perto do mouse quase não muda); `−` → indicador cai 10 pontos; clicar no número → 100%;
    roda sem `Ctrl` → move a visão na vertical, `Shift+roda` na horizontal; desenhar um retângulo
    com zoom 200% → ele nasce sob o ponteiro; `beacon` segue em 100%; relançar → `atlas` volta no
    mesmo zoom; `Ctrl+Z` não desfaz zoom. A pinça do touchpad fica para o alfa (não dá para gerar
    no Playwright).

### 06 — Print colado ou arrastado para o quadro

- **Status**: concluida
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (`images.ts`, `mindscape-images.ts` com fs injetado, parse do print, hit-test, `resizeDrawing`, `eraseBoard`) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-desenho-implementacao-06.md`
- **PR**: #126 (mergeado em `staging` em 2026-10-30)
- **Depende de**: 04
- **Conflita com**: 01, 02, 03, 04, 05
- **Propósito**: o dono cola uma imagem com `Ctrl+V` ou arrasta um arquivo de imagem para o
  quadro, e o print nasce onde está o mouse, com até 480 de largura; seleciona, move, redimensiona
  mantendo a proporção, apaga e desfaz; acima de 10 MB vê o aviso; o arquivo sem referência some
  na abertura seguinte do app.
- **Escopo**: entra `images.ts` (padrão do `imageId`, `fitImage`, `referencedImageIds`, limites e
  tipos) e o tipo `image` no parse; `src/main/mindscape-images.ts` (`save`, `read`, `sweepOrphans`
  com fs injetado, reusando `looksLikeImage`/`extensionFor` de `src/main/chat/attachments.ts` sem
  mexer nele); canais `mindscape:save-image`/`mindscape:read-image` em `channels.ts`, handlers no
  `index.ts` e API no preload; limpeza no boot (arquivo ausente, inválido ou com `schemaVersion`
  maior não limpa; só apaga não referenciado com `mtime` de mais de 1 hora); `useMindscapeImage.ts`
  (cache de `blob:` por `imageId`, revogado ao desmontar, caixa tracejada "imagem não encontrada");
  `paste` no `document` e `drop` na tela (alvo editável filtrado), GIF decodificado para PNG;
  `<image>` no `MindscapeDrawingLayer`; print no `hitTestDrawings` (área toda), no laço, no
  `resizeDrawing` (proporção mantida) e no `eraseBoard` (sai quando a borracha toca a área); aviso
  "Imagem grande demais (limite de 10 MB)" na faixa de dica. NÃO entra: seletor de arquivo, tecla
  de print, print animado, SVG (fora pelo design).
- **Dados necessários**: um PNG pequeno de amostra gerado pelo próprio teste (sem foto real); um
  arquivo órfão plantado em `mindscape-images/` com `mtime` antigo antes do boot e outro recente;
  pasta temporária para o vitest do main.
- **Como testar**:
  - vitest (`tests/mindscape-images.test.ts`, `tests/mindscape-images-main.test.ts`, mais casos em
    `tests/mindscape-model.test.ts`, `tests/mindscape-geometry.test.ts` e
    `tests/mindscape-eraser.test.ts`): o padrão aceita `img-<base36>-<8 hex>.png` e recusa `..`,
    separador e extensão fora da lista; `fitImage` limita a 480 mantendo a proporção;
    `referencedImageIds` junta os de todos os quadros; `save` recusa tipo fora da lista, mais de
    10 MB e bytes que não são imagem, e grava com nome no padrão; `read` recusa `imageId` fora do
    padrão; `sweepOrphans` apaga só o não referenciado com mais de 1 hora e não roda com documento
    ausente, inválido ou de versão maior; o parse descarta print com `imageId` fora do padrão;
    `resizeDrawing` mantém a proporção do print; `eraseBoard` tira o print tocado.
  - smoke: `clipboard.writeImage` pelo `electronApp.evaluate` + `Ctrl+V` no quadro → o print
    aparece perto do mouse e o arquivo existe em `mindscape-images/`; `Delete` → some; `Ctrl+Z` →
    volta (arquivo ainda lá); relançar → o print continua, o órfão antigo plantado sumiu e o recente
    ficou; arrastar a alça → a proporção se mantém. A recusa de mais de 10 MB e o `drop` de arquivo
    ficam no vitest e no alfa se o Playwright não conseguir gerar o evento (registrar no relato).

## Slack só com carta do Oráculo, e aviso no celular (`slack-carta`)

- **Design**: — (pedido direto do dono, 05/11 ~14h50: "Preciso que toda mensagem que for enviada para o slack em meu nome seja uma carta no oráculo antes de qualquer coisa. Também preciso que ele tenha notificação no meu celular." Prazo: 06/11)
- **Versão**: — (demanda própria)
- **TaskDex**: — (sem card: ferramenta pessoal)
- **Fatiado em**: 2026-11-05 (à mão, na VPS: a skill `esteira:fatiamento` não está instalada aqui; formato desta seção copiado das demandas anteriores)
- **Gate**: pedido literal do dono com as três fatias e a ordem; sem passo extra de aprovação
- **Rodadas previstas**: 01 | 02 | 03 | 04 <!-- serial: 02 só funciona na VPS com a 01; 03 avisa da carta que a 02 cria; 04 (pedido do Líder, 05/11 noite) fecha a 02 com o app fora do ar -->

Convenções: lógica pura com vitest; uma PR contra `staging` por fatia; `npm run verify` na VPS. Convive
com a demanda `cartas-forma-a` (outro Dev, mesmas áreas: `src/shared/ledger/contract.ts`, `tools.ts`,
`src/main/celular/pwa/`): a branch desta demanda se mantém em dia com `staging`, e o conflito é desta.

### 01 — A sessão na VPS fala com o Oráculo (B38, primeiro item)

- **Status**: implementada
- **Branch**: `feat/slack-so-com-carta` (worktree `../donel-wt/slack-carta`)
- **Depende de**: —
- **Conflita com**: —
- **Propósito**: uma sessão aberta pelo Donel num lugar remoto conecta no MCP `donel` (hoje leva 403
  "Host not allowed") e passa a criar e ler cartas, ler o quadro e abrir sessões.
- **Escopo**: o gate HTTP do MCP aceita `Host: 127.0.0.1:<porta remota do túnel>` só junto com o
  token da sessão para a qual aquele túnel foi aberto. Nenhuma porta nova: a sessão já chega pelo
  `ssh -R` que o app abre, com token de 128 bits por sessão. Fica de fora: anexos e arquivos da VPS
  no painel (os outros itens do B38).

### 02 — Mensagem ao Slack só sai com carta aceita

- **Status**: implementada
- **Branch**: `feat/slack-so-com-carta-02` (empilhada sobre a 01, mesma worktree)
- **Depende de**: 01
- **Conflita com**: `cartas-forma-a` 01 (contract.ts, tools.ts)
- **Propósito**: toda mensagem que uma sessão do Donel mandaria ao Slack em nome do dono vira antes
  uma carta "mensagem para o Slack" (destino, thread, texto exato, motivo). Aceitar libera o envio
  daquele texto para aquele destino; rejeitar não envia; o motivo da rejeição pede o ajuste.
- **Escopo**: tipo de carta no contrato do Oráculo + ferramenta MCP para criar; a ponte de hooks
  responde ao `PreToolUse` de toda ferramenta que posta no Slack (MCP do Slack, Composio
  `SLACK_SEND_MESSAGE` e afins, `chat.postMessage` por curl, `canal-produto.js postar|responder`)
  com recusa, a menos que exista carta ACEITA cujo hash de texto e destino bata com o envio. A
  recusa ensina a sessão a criar a carta e esperar. Teste: sem carta recusa; carta aceita do mesmo
  texto passa; texto diferente recusa.

### 03 — Aviso no celular quando uma carta espera o dono

- **Status**: implementada
- **Branch**: `feat/slack-so-com-carta-03` (empilhada sobre a 02, mesma worktree)
- **Depende de**: 02
- **Conflita com**: `cartas-forma-a` 02 (`src/main/celular/pwa/`)
- **Propósito**: quando uma carta passa a esperar o dono, o celular recebe notificação de verdade
  (Web Push no PWA, com service worker), mesmo com o app fechado; o texto é o título humano da
  carta, sem código; o toque abre a carta. Só pela tailnet, sem serviço de terceiros com dado do dono.
- **Escopo**: service worker + inscrição no PWA, chaves VAPID geradas e guardadas pelo main, envio
  ao mudar para "esperando você". Se exigir HTTPS: `tailscale serve`/cert da tailnet, com o passo
  do dono descrito no handoff.

### 04 — Com o app fora do ar, envio ao Slack é recusado (falha fechada)

- **Status**: implementada
- **Branch**: `feat/slack-so-com-carta-04` (empilhada sobre a 03, mesma worktree)
- **Depende de**: 02
- **Conflita com**: —
- **Propósito**: a regra do dono é "a carta antes de qualquer coisa": o que não se confirma não sai. Uma
  sessão remota sobrevive ao app (tmux na VPS) e o hook `http` sem resposta não bloqueia; agora, sem o app
  (ou com um app que não conhece a sessão), envio ao Slack é recusado, e a recusa diz por quê.
- **Escopo**: hook de comando `sh` no `PreToolUse` das sessões remotas (matcher `Bash|mcp__.*`): pergunta à
  ponte `/h/Ping`; no ar e com o token conhecido, não diz nada (a ponte decide pela carta); fora do ar, recusa
  o que pareça envio ao Slack. Sessão local fica só com o `http`: ela é filha do app e morre com ele. Fica de
  fora, como decisão pendente do dono: trava para um `claude` aberto à mão.

## Hill climbing no lugar do Modo Dev (`hill-climbing`)

- **Fonte**: dossiê `estudo-treinamento-bill.md`, seção m) (decidido no brainstorm de 05/11; pontos
  abertos decididos pela Pesquisa por delegação do dono)
- **Pedido** (dono, 05/11, via Líder único): o Modo Dev sai ("absurdamente datado"); fica só o visual
  da barra esquerda (trilha + carrossel); a direita sai ("terrível e só me atrapalhava"). Hill climbing
  entra como jeito de rodar uma missão.
- **Fatiado em**: 2026-11-05 (modo avulso; sessão Dev aberta pelo Líder único)
- **Modo**: demanda — PR único `feature/hill-climbing` → `staging`, sem merge (Revisor confere)
- **Gate**: gatilho 3 (dependências encadeadas) disparado; dispensado pelo Líder único com o dono
  dormindo ("Implementação decidida, não precisa perguntar nada"). Não é aprovação do dono.
- **Rodadas previstas**: 01 | 02 | 03 | 04

Regras fixas da seção m), com o ajuste da seção n) (gravação do Bill, 06/11): laço em código (conta
rounds, chama juízes, junta notas, fecha rodada); conselho de 3 juízes por chamada direta à chave de
LLM, às cegas (só critérios, versão atual e quem vai ler o resultado; **nunca o alvo**); a 1ª rodada
começa pelo inventário do que já existe e abre 3 direções do zero, e daí em diante se sobe a melhor;
corte ≥ 9 em todos os critérios por todos os juízes; X = 5, Y = 3, N = 2; "estacionou" = 2 rounds de
subida seguidos sem subir a menor nota, fechando com uma carta de decisão; nunca começa sozinho (proposta no Oráculo, roda só com
aceite do dono; rodada extra pede o gesto do dono). A chave de LLM não existe: o conselho fica atrás
de uma interface de provedor, com juiz falso nos testes e "falta a chave" na tela. Nunca chamar API paga.

### 01 — A barra do hill climbing no lugar do Modo Dev

- **Caminho**: teste-depois (UI; o teste cobre o store)

- **Status**: implementada
- **Branch**: `feature/hill-climbing` (modo demanda, worktree `.claude/worktrees/hill-climbing`)
- **Depende de**: —
- **Conflita com**: 02, 03, 04 (`App.tsx`, `HillClimb/`)
- **Propósito**: a aba "Dev" do seletor de modo vira "Hill climbing": a barra esquerda (trilha +
  carrossel, mesma forma) lista as missões; a barra direita, a esteira nova e o mapa de nós somem.
  Sem chave de LLM, a barra diz "falta a chave" sem quebrar.
- **Escopo**: entra o store `<userData>/hill-climb.json` (só leitura nesta fatia), o canal de
  snapshot e o estado do conselho; sai o fluxo antigo do Modo Dev no renderer (DiscoveryMap,
  PhaseDetailsPanel, EsteiraScreen, NodeGraphOverlay e o encanamento só deles). NÃO entra: apagar
  o lado main da esteira 010 (fica para depois, sem tela que o chame) nem nada em `userData`.
- **Dados necessários**: —
- **Como testar**: abrir o app → seletor mostra "Uso geral · Hill climbing · Mindscape"; no Hill
  climbing aparece a barra esquerda com "Nenhuma missão ainda" e "Falta a chave de LLM"; não há
  barra direita nem botões da esteira/mapa de nós no titlebar. Teste: store lê arquivo ausente,
  ilegível e de versão maior sem apagar nada.

### 02 — Missão nasce proposta no Oráculo e só roda com aceite do dono

- **Status**: implementada
- **Branch**: `feature/hill-climbing` (modo demanda, worktree `.claude/worktrees/hill-climbing`)
- **Depende de**: 01
- **Conflita com**: 01, 03, 04
- **Propósito**: uma sessão (o Escalador) propõe a missão pela ferramenta `hillclimb_propor` (alvo,
  critérios, corte, X/Y/N, gasto estimado); nasce uma carta de risco alto no Oráculo ("Rodar esta
  missão?"); a barra mostra "proposta · esperando você"; com o aceite do dono vira "pronta".
- **Escopo**: ferramenta MCP, gravação no store, carta no ledger sem subir o schema dele. NÃO
  entra: rodar rounds (03).
- **Dados necessários**: —
- **Como testar**: teste: proposta cria carta de risco alto; versão enviada antes do aceite é
  recusada; aceite do dono libera; rejeição encerra a missão.

### 03 — Rounds julgados às cegas por um conselho de 3

- **Status**: implementada
- **Branch**: `feature/hill-climbing` (modo demanda, worktree `.claude/worktrees/hill-climbing`)
- **Depende de**: 02
- **Conflita com**: 01, 02, 04
- **Propósito**: o Escalador envia cada versão por `hillclimb_versao`; o laço chama os 3 juízes,
  cada um vendo só critérios, a versão e quem vai ler (nunca o alvo); junta as notas, devolve ao Escalador e fecha a
  rodada ao passar do corte, ao estacionar ou no fim dos rounds. A barra mostra a trilha (rounds,
  com divisor de rodada), o carrossel (rodadas × variantes) e as notas juiz × critério no cartão em foco.
- **Escopo**: motor puro, conselho atrás de `JudgeProvider`, juiz falso (testes e
  `DONEL_HILL_CLIMB_FAKE_JUDGES=1` para demonstração). Sem chave, o envio é recusado com "falta a chave".
- **Dados necessários**: juiz falso determinístico
- **Como testar**: testes: o juiz nunca recebe o alvo, notas nem versões anteriores; a 1ª versão
  exige o inventário e as 3 primeiras abrem direções distintas, depois a versão sobe a melhor; corte
  exige ≥ 9 de todos em tudo; as 3 direções nunca contam como "estacionou", mas 2 rounds de subida
  sem passar da melhor nota fecham a rodada com "estacionou"; a 1ª rodada fecha em 5 rounds.

### 04 — Amostra de fim de rodada com os três gestos

- **Status**: implementada
- **Branch**: `feature/hill-climbing` (modo demanda, worktree `.claude/worktrees/hill-climbing`)
- **Depende de**: 03
- **Conflita com**: 01, 02, 03
- **Propósito**: rodada fechada mostra a amostra como carta de decisão (motivo do fechamento, as
  direções com a pior nota de cada uma e a recomendada, melhor versão, curva da menor nota por round,
  2–3 intermediárias) com os gestos parar e aceitar · mais uma rodada · redirecionar (dar uma
  referência). Rodada extra tem 3 rounds; no máximo 2 extras.
- **Escopo**: gestos só do dono, pela barra; redirecionar leva o texto ao Escalador na próxima
  resposta da ferramenta. Item em `patchnotes/notes.ts`.
- **Dados necessários**: missão de exemplo com juiz falso
- **Como testar**: teste: "mais uma rodada" depois de 2 extras é recusado; versão enviada com a
  rodada fechada é recusada até o gesto. Print da barra com a missão de exemplo.
