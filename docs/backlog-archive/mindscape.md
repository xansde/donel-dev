# Backlog arquivado — Mindscape V1 (`mindscape`)

> Arquivado em 2026-10-24 pelo `/fatiamento` de `mindscape-desenho` (varredura de demanda
> encerrada). As 5 fatias estavam `implementada` e o PR que as entregou, #114, foi mergeado em
> `staging` em 2026-10-24T04:50:37Z (conferido com `gh pr view 114 --json state,mergedAt`), então
> viraram `concluida`. Nenhum worktree a remover: a V1 rodou no checkout principal.

## Mindscape — V1 por projeto, no alfa (`mindscape`)

- **Design**: `docs/design/mindscape.md`
- **Versão**: V1 — `docs/versoes/mindscape.md`
- **TaskDex**: — (sem card: ferramenta pessoal; esta execução não conta na adoção)
- **Fatiado em**: 2026-10-24
- **Gate**: aprovado por Claude por delegação de Alexandre Lentz em 2026-10-24 <!-- gatilho 3 (dependências encadeadas: 02..05 dependem de 01, 05 de 04); decidido por delegação do dono, 2026-10-23 — o corte segue a ordem do caminho feliz e todas as fatias passam nos 4 critérios -->
- **Rodadas previstas**: 01 | 02 | 03 | 04 | 05 <!-- serial: todas as fatias pisam em model.ts e nos componentes de Mindscape/; trabalho sequencial na feature/mindscape, no checkout principal (instrução do dono) -->

Convenções que valem para as 5 fatias: lógica pura com vitest test-first (vermelho → verde);
tela por smoke Playwright em `tests/smoke/mindscape.spec.ts` (`launchIsolatedApp` + claude falso,
`DONEL_MINDSCAPE_FILE` apontando para arquivo temporário); fixtures só com projetos `atlas`,
`beacon`, `vega`; UI em pt-BR; forma pela variante A (`docs/prototipos/mindscape/final.html`).
Nenhuma fatia toca `src/main/accounts/`, o Modo Dev ou o `config.json`.

### 01 — Modo Mindscape com post-its de sessão vivos, por projeto

- **Status**: concluida
- **Branch**: `feature/mindscape` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (modelo e store) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-implementacao-01.md`
- **PR**: https://github.com/xansde/donel-dev/pull/114 (revisão: `handoffs/mindscape-revisao.md`)
- **Depende de**: —
- **Conflita com**: 02, 03, 04, 05
- **Propósito**: o dono troca o seletor do casco para "Mindscape" e vê, numa aba por projeto, um
  post-it por sessão `claude` aberta, com selo "SESSÃO", glifo de estado, nome em mono e cor da
  aba, acompanhando o semáforo ao vivo; o quadro sobrevive a fechar e reabrir o app (histórias 1
  e 6; regras 7, 8, 9, 11).
- **Escopo**: entra `src/shared/mindscape/model.ts` (tipos + `ensureBoard`, `placeSessionCard`,
  `parseMindscapeDoc`), `channels.ts`, `src/main/mindscape-store.ts` (load/save atômico, schema
  guard, `DONEL_MINDSCAPE_FILE`), IPC `mindscape:load`/`mindscape:save` + preload,
  `useMindscapeDoc` (boot + debounce 500 ms), `appMode` de 3 valores no `App.tsx` (`devModeOn`
  derivado), terceira opção do `SegmentedControl`, `MindscapeScreen` com abas de projeto e
  `MindscapeCard` de sessão em grade automática (CSS com os tokens do `PostItCard`, sem roughjs).
  Aba sem projeto não entra; sessão sem aba aberta não é desenhada. NÃO entra: destaque e ir ao
  terminal (02), post-it escrito pela sessão e `mindscape:turn-ended` (03), arrastar/pan/post-it
  do dono (04), ligações e roughjs (05).
- **Dados necessários**: duas abas `claude` do falso em projetos `atlas` e `beacon` (uma delas com
  roteiro que demora, para ver o estado "trabalhando"); `DONEL_MINDSCAPE_FILE` temporário.
- **Como testar**:
  - vitest (`tests/mindscape-model.test.ts`, `tests/mindscape-store.test.ts`): `ensureBoard` cria
    quadro novo e é idempotente; `placeSessionCard` dá posição de grade sem sobrepor e mantém a
    posição já salva; `parseMindscapeDoc` devolve documento vazio para lixo/ausente e descarta
    cartão de dono com cor `permission`; o store grava por temp → rename, devolve
    `{ ok: false, reason: 'read-only' }` com `schemaVersion` maior que 1 e não reescreve o arquivo.
  - smoke: com as duas abas abertas, clicar "Mindscape" no seletor → aparecem as abas `atlas` e
    `beacon`; em `atlas`, o post-it da sessão mostra o nome da aba e o mesmo estado do semáforo da
    aba (muda para "trabalhando" e volta para "pronta" sem recarregar); trocar para `beacon` mostra
    só a sessão de lá; voltar a "Uso geral" e "Dev" funciona como antes (terminal não reinicia);
    fechar e relançar o app com o mesmo arquivo → `mindscape.json` tem os dois quadros.

### 02 — Destaque da sessão e "Ir ao terminal"

- **Status**: concluida
- **Branch**: `feature/mindscape` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (`sessionHighlight`) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-implementacao-02.md`
- **PR**: https://github.com/xansde/donel-dev/pull/114 (revisão: `handoffs/mindscape-revisao.md`)
- **Depende de**: 01
- **Conflita com**: 01, 03, 04, 05
- **Propósito**: no quadro, a sessão com novidade desde o último acesso aparece destacada, a sem
  novidade aparece apagadinha e a que trabalha aparece normal; duplo clique ou o botão "Ir ao
  terminal" leva à aba da sessão no Uso geral e zera o destaque (histórias 2 e 7; regras 3, 4, 10).
- **Escopo**: entra `src/shared/mindscape/highlight.ts` (`sessionHighlight`), mapa `seenAt` em
  memória no `App.tsx` (carimbo ao focar aba no Uso geral e ao sair do Uso geral com a aba em
  foco), as três aparências no `MindscapeCard`, seleção de cartão, duplo clique e botão
  "Ir ao terminal" (`setAppMode('geral')` + `setActiveTabId`). Erro conta como destacada. NÃO
  entra: persistir `seenAt` (fora da V1), post-it escrito pela sessão (03).
- **Dados necessários**: duas abas `claude` do falso no projeto `atlas`, uma delas terminando o
  turno (hook `Stop`) enquanto outra aba está em foco.
- **Como testar**:
  - vitest (`tests/mindscape-highlight.test.ts`): `working` → normal; `ready`/`error`/`permission`
    com `stateEnteredAt > seenAt` → destacada; com `stateEnteredAt <= seenAt` → apagadinha;
    `seenAt` ausente conta como 0.
  - smoke: sessão B termina o turno com a aba A em foco → no Mindscape o post-it de B está
    destacado; duplo clique em B → modo "Uso geral" com a aba B focada; voltar ao Mindscape → B
    apagadinha; selecionar A e clicar "Ir ao terminal" → aba A focada.

### 03 — Post-it escrito pela sessão a cada fim de turno

- **Status**: concluida
- **Branch**: `feature/mindscape` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (modelo, cauda do transcript, `onTurnEnded`) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-implementacao-03.md`
- **PR**: https://github.com/xansde/donel-dev/pull/114 (revisão: `handoffs/mindscape-revisao.md`)
- **Depende de**: 01
- **Conflita com**: 01, 02, 04, 05
- **Propósito**: ao lado de cada sessão aparece o post-it escrito por ela com a última resposta e
  a hora; cada fim de turno sobrescreve o texto; o post-it fica no quadro quando a aba fecha, até
  o dono arquivar (história 3; regras 1, 2, 11).
- **Escopo**: entra `onTurnEnded` no `SessionSemaphoreManager` (`Stop` e `StopFailure`, ponte e
  servidor legado), `lastAssistantText` no `extractTranscriptTail` (fallback quando
  `last_assistant_message` vem vazio; nenhum dos dois → mantém o texto anterior), tradução
  `ptyId → claudeSessionId` e push `mindscape:turn-ended` no `index.ts`, `writeSessionNote` e
  `archiveCard` no modelo (corte em 4.000 caracteres), cartão `session-note` (8 linhas +
  `title` com o texto inteiro, nome da sessão guardado) nascendo ao lado do da sessão, ação
  "Arquivar". O roteiro do claude falso passa a mandar `last_assistant_message` no `Stop`
  (e um roteiro sem o campo, para o fallback). NÃO entra: histórico de post-its (V2),
  arrastar o cartão (04).
- **Dados necessários**: roteiros do falso para o projeto `vega`: um com `Stop` trazendo
  `last_assistant_message`, outro sem o campo e com a resposta só no `.jsonl`.
- **Como testar**:
  - vitest: `writeSessionNote` cria `note:<sessionId>` na primeira vez e sobrescreve texto e hora
    nas seguintes, mantendo a posição; corta em 4.000; `archiveCard` remove o cartão (e as
    ligações que o tocam); `extractTranscriptTail` devolve `lastAssistantText` da última mensagem
    do assistente numa cauda de amostra; `onTurnEnded` dispara em `Stop` e em `StopFailure` com o
    texto do payload, e com `null` quando o campo falta.
  - smoke: enviar um prompt na sessão `vega` → no Mindscape o post-it escrito pela sessão mostra a
    resposta do roteiro e a hora; segundo prompt → o texto é trocado; roteiro sem o campo → o texto
    vem da cauda do `.jsonl`; fechar a aba → o post-it da sessão some e o escrito por ela fica;
    "Arquivar" → some; relançar o app → continua como deixado.

### 04 — Canvas livre: arrastar, mover a visão e post-its do dono

- **Status**: concluida
- **Branch**: `feature/mindscape` (checkout principal, sem worktree — instrução do dono) · commit `0e11291` · caminho: `tdd` (reducers do modelo) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-implementacao-04.md`
- **PR**: https://github.com/xansde/donel-dev/pull/114 (revisão: `handoffs/mindscape-revisao.md`)
- **Depende de**: 01
- **Conflita com**: 01, 02, 03, 05
- **Propósito**: o dono arrasta qualquer post-it, move a visão do quadro arrastando o fundo e cria
  post-its seus ("✎ você", canto dobrado) com texto editável, cor Sem cor/Azul/Dourado e
  arquivar; tudo persiste ao reabrir o app (história 4; regras 6 e 7; decisão do protótipo).
- **Escopo**: entra `moveCard`, `addOwnerCard`, `editOwnerCard`, `setOwnerColor` (recusa
  `permission`), pan no `MindscapeBoard` (`transform: translate`, pointer events, posição em
  `requestAnimationFrame` gravada no `pointerup`), barra do quadro com "Novo post-it", cartão do
  dono com edição inline, seletor de 3 cores e "Arquivar" (reusa `archiveCard` da 03 se já
  existir; senão o introduz). NÃO entra: zoom, minimapa, rabisco, prints (V2), ligações (05).
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas`.
- **Como testar**:
  - vitest: `moveCard` muda só x/y do cartão alvo; `addOwnerCard` cria com id único, `createdAt` e
    cor `none`; `editOwnerCard` troca o texto; `setOwnerColor` aceita as 3 cores e ignora
    `permission`; `parseMindscapeDoc` preserva cartões do dono e o `pan`.
  - smoke: "Novo post-it" → digitar texto → escolher Dourado → o cartão mostra "✎ você" e o
    dourado; arrastar o cartão e o post-it da sessão para outro ponto; arrastar o fundo desloca
    todos os cartões juntos; relançar o app → posições, pan, texto e cor iguais; "Arquivar" no
    post-it do dono → some e não volta ao relançar.

### 05 — Ligações com seta, em traço à mão

- **Status**: concluida
- **Branch**: `feature/mindscape` (checkout principal, sem worktree — instrução do dono) · caminho: `tdd` (reducers + `roughShapes`) + `teste-depois` (tela, por smoke) · relato: `handoffs/mindscape-implementacao-05.md`
- **PR**: https://github.com/xansde/donel-dev/pull/114 (revisão: `handoffs/mindscape-revisao.md`)
- **Depende de**: 04
- **Conflita com**: 01, 02, 03, 04
- **Propósito**: o dono liga dois post-its quaisquer do mesmo mindscape, liga e desliga a seta e
  remove a ligação; ligações e contorno dos cartões aparecem em traço à mão, que não "treme" a
  cada render (história 5; regra 5; ADR 0004).
- **Escopo**: entra a instalação de `roughjs@4.6.6` (versão exata), `addLink`, `toggleLinkArrow`,
  `removeLink`, `roughShapes.ts` (`rough.generator()` com `seed` fixo por id e cache por
  geometria), camada SVG sob os cartões, modo "Ligar" na barra (clicar origem e destino), ações de
  seta e remover na ligação selecionada, contorno à mão dos cartões. Ligação para sessão sem aba
  aberta fica guardada e só não é desenhada. NÃO entra: significado de cores/ligações (V2+).
  `Depende de 04` porque usa a barra do quadro, o pan e o post-it do dono como origem/destino.
- **Dados necessários**: uma aba `claude` do falso no projeto `atlas` e um post-it do dono.
- **Como testar**:
  - vitest: `addLink` recusa ligação de um cartão para ele mesmo e entre cartões ausentes do
    quadro; `toggleLinkArrow` inverte `arrow`; `removeLink` remove só a alvo; `archiveCard` remove
    as ligações do cartão; `roughShapes` devolve o mesmo `d` para o mesmo id e geometria.
  - smoke: modo "Ligar" → clicar no post-it do dono e no da sessão → aparece a ligação com seta;
    desligar a seta → some a ponta; mover um cartão → a ligação acompanha; fechar a aba da sessão →
    a ligação some da tela e volta ao reabrir a sessão; remover → some e não volta ao relançar o
    app; `npm ls roughjs` mostra 4.6.6.
