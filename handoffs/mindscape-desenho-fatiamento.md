# Handoff — /fatiamento do Mindscape: desenho, print, Ctrl+Z e zoom

- **Data**: 2026-10-24
- **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree — instrução do dono)
- **Skill**: `esteira:fatiamento` 1.18.0, modo esteira
- **Entrada**: `docs/design/mindscape-desenho.md` (`status: aprovado`, check mecânico ok), com
  `docs/refinamentos/mindscape-ligar-rabisco-zoom.md`, `docs/glossario.md`, ADR 0004 e o código da
  V1 em `src/shared/mindscape/` e `src/renderer/src/Mindscape/`
- **Versão**: a demanda não tem `docs/versoes/mindscape-desenho.md`. Nasceu da hipótese V2 de
  `docs/versoes/mindscape.md`; com 6 fatias (≤ 7), não houve motivo para propor `/versionamento`.
- **TaskDex**: `taskdex: []` herdado do design. Sem card: ferramenta pessoal, esta execução não
  conta na adoção. Nenhum comentário registrado.
- **Saída**: seção nova em `BACKLOG.md`; a V1 foi varrida para `docs/backlog-archive/mindscape.md`.

## Varredura

- A seção "Mindscape — V1" tinha as 5 fatias em `implementada`. O PR #114 foi mergeado em
  `staging` em 2026-10-24T04:50:37Z (`gh pr view 114 --json state,mergedAt,baseRefName` →
  `MERGED`, `staging`). Pelo fallback da skill (PR mergeado conta como concluída), as 5 viraram
  `concluida` e a seção foi movida inteira para `docs/backlog-archive/mindscape.md`, com uma nota
  no topo. Decidido por delegação do dono, 2026-10-24: o status estava em `implementada` e não em
  `aguardando-merge` porque a V1 não passou pela `/simplificacao`, mas o merge é o fato que encerra.
- Worktrees órfãos: nenhum. `git worktree list` só mostra o checkout principal.

## Corte

| # | Fatia | Depende de |
|---|---|---|
| 01 | Barra de ferramentas: formas, setas soltas e seta de post-it a post-it vira Ligação | — |
| 02 | Ctrl+Z e Ctrl+Shift+Z no quadro, sem desfazer o que a sessão fez | 01 |
| 03 | Seleção múltipla, alças, estilo e camadas | 02 |
| 04 | Lápis e borracha que apaga o pedaço tocado | 03 |
| 05 | Zoom de 25% a 400%, salvo por quadro | 04 |
| 06 | Print colado ou arrastado para o quadro | 04 |

Rodadas previstas: `01 | 02 | 03 | 04 | 05 | 06`. Todas as fatias pisam em `model.ts`,
`MindscapeScreen.tsx`, `MindscapeBoard.tsx` e na barra, então todas estão em `Conflita com` par a
par. Isso casa com a instrução de trabalho serial na mesma branch.

Todas as escolhas de corte abaixo foram **decididas por delegação do dono, 2026-10-24**:

- **Modelo v2 inteiro na 01.** `schemaVersion: 2` nasce de uma vez, com `drawings` e `zoom`
  (fixo em 1 até a 05). Assim a versão não sobe duas vezes, e a guarda contra canal antigo vale
  desde o primeiro desenho gravado. Cada fatia seguinte acrescenta ao parse o tipo que ela traz
  (`pencil` na 04, `image` na 06).
- **`view.ts` começa na 01** com `screenToWorld`/`worldToScreen`/`clampZoom`. Os gestos já nascem
  convertendo por ele, e a 05 só acrescenta `zoomAt` e a roda, sem reescrever cada gesto.
- **A Ligação desenhada entra na 01, junto das formas.** É o mesmo gesto de `A`/`L`, e
  `cardAtPoint` é pequeno. Separar daria uma fatia de "tirar o botão Ligar" sem valor próprio.
- **`Ctrl+Z` vem cedo (02).** A partir dela, toda ação nova das fatias 03 a 06 já entra no
  histórico pelo caminho único `onAction`, e cada smoke seguinte prova o desfazer da sua ação.
  O dono também ganha a rede de segurança antes de existir `Delete` (03). O `onAction` nasce na 01
  para as ações novas, sem histórico; a 02 traz os callbacks da V1 para ele.
- **Seleção, alças, estilo e camadas numa fatia só (03).** É a maior das seis. Cortar camadas e
  estilo à parte daria duas fatias pequenas demais, com os mesmos arquivos. Fica registrado aqui
  como risco de tamanho, não como corte imperfeito: ela entrega um comportamento coeso, editar o
  que já foi desenhado.
- **Zoom (05) depois da borracha.** A 05 divide pelo zoom as tolerâncias em px de tela do hit-test
  (03) e o raio da borracha (04), e grava `setBoardView` pela porta `applySession` (02). Por isso
  o `Depende de: 04`.
- **Print por último (06).** Ele estende o hit-test, o laço, as alças (proporção) e a borracha.
  Também é a única fatia que mexe no main, no preload e no boot.

## Gate

- Gatilhos: 1 (complexidade herdada) não, porque o design tem `complexidade: —` e
  self-assessment `apto`. 2 (volume) não, são 6 fatias. 3 (dependências encadeadas) **sim**, em
  cadeia de 01 a 04, e 05 e 06 dependem de 04. 4 (corte imperfeito) não, as 6 passam nos 4
  critérios.
- Gate disparado pelo gatilho 3 e aprovado por delegação: "aprovado por Claude por delegação de
  Alexandre Lentz em 2026-10-24", conforme a instrução desta execução.

## Achados ao absorver o código (não são decisão nova)

- **O design diz que o smoke da V1 não tem passo com "Ligar"**, mas olhou só
  `tests/smoke/mindscape.spec.ts`. O `tests/smoke/mindscape-links.spec.ts` (V1, fatia 05) usa o
  botão "Ligar" e `data-linking` (linhas 87 a 94 e 127 a 138). Como o design manda tirar o modo
  "Ligar", a 01 reescreve esse passo para desenhar com `A`. Isso só cumpre o design, não muda nada
  nele.
- **`tests/smoke/mindscape-canvas.spec.ts` move a visão arrastando o fundo** (passo 3,
  `data-pan`). Com o laço da 03, arrastar o fundo com `V` deixa de mover a visão. A 03 passa esse
  passo para `H`. Até a 03, a 01 mantém o arrastar do fundo movendo a visão, para os smokes da V1
  continuarem verdes.
- O design nomeia um arquivo só, `tests/smoke/mindscape-desenho.spec.ts`. Mantive assim, com um
  `test` por fatia.

## Riscos que a /implementacao herda

- **A 03 é a maior fatia.** Se não couber numa sessão, a saída é recortar camadas e estilo numa
  fatia própria, logo depois dela. Isso é ajuste de corte, não de design.
- **A confirmar no smoke** (o design já marca): a pinça do touchpad chega como `wheel` com
  `ctrlKey`. Ela não pode ser gerada no Playwright e fica para o alfa. Também falta confirmar que o
  `paste` no `document` chega com o foco na `<section>`, e que o `drop` de arquivo e a recusa de
  10 MB podem ser gerados no smoke. Se não puderem, ficam no vitest e no alfa, registrados no relato
  da 06.
- **Instabilidade da V1 ainda aberta**: na 05 da V1, uma gravação com debounce pode se perder
  quando o app fecha (`handoffs/mindscape-implementacao-05.md`). Os smokes desta demanda relançam
  o app várias vezes. Eles devem esperar o arquivo ter o estado antes de relançar, como o da V1
  passou a fazer.
- **`App.tsx` tem 2.930 linhas.** A 02 mexe nos oito callbacks da V1. Manter a mudança no
  mínimo.

## Não verificado

- Não rodei testes nem build: esta etapa só escreve documentos.
- Não conferi se o claude falso consegue terminar o turno no meio de uma sequência de ações do
  smoke da 02 sem roteiro novo. O roteiro `session-note.json` da V1 é o ponto de partida provável.

## Próxima etapa

`/implementacao` sobre `BACKLOG.md`, começando pela 01, serial na `feature/mindscape-desenho`.
