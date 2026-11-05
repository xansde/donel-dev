# /implementacao — Mindscape desenho, fatia 04

**Fatia**: 04 — Lápis e borracha que apaga o pedaço tocado
**Data**: 2026-10-30 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`eraser.ts`, parse do `pencil`, amostragem, `pencilPath`, hit-test do Rabisco, atalhos `p`/`e`) + `teste-depois` (tela, por smoke)
**Fatias anteriores lidas**: `handoffs/mindscape-desenho-implementacao-01.md`, `-02.md`, `-03.md`.

## Decisões tomadas no caminho

Todas **decididas por delegação do dono (2026-10-30)**: rodada autônoma, sem humano para perguntar. Critério: a opção mais simples coerente com o design. Nenhuma muda regra do refinamento.

- **O alcance da borracha conta a tinta: `raio + espessura/2`.** O design fixa o raio em 8 px de tela, mas não diz se a espessura do traço entra. Entra. A borracha apaga a tinta que toca, e um traço grosso fica mais fácil de acertar, como já acontece no hit-test da seleção (`stroke/2 + 6 px`). Vale para o corte parcial (Rabisco e linha solta), para o contorno do retângulo e da elipse e para a Ligação (espessura 1,5, a mesma do `roughShapes.ts`).
- **`eraseBoard` ganhou um 5º argumento opcional, `cardSizes`.** A assinatura do design (`board, eraserPath, radius, newId`) não tem como achar o segmento da Ligação: ele depende do tamanho medido dos cartões, que o quadro não guarda. A tela passa os tamanhos dos cartões que estão na tela (os mesmos `cardRects` do laço e do `A`/`L`). Uma Ligação sem o tamanho das duas pontas não está desenhada (post-it de sessão sem aba aberta), então a borracha não a apaga. Também entrou `eraseDoc(doc, projectPath, …)`, o mesmo cálculo como reducer de documento, para passar pelo `onAction`.
- **Um clique com `E`, sem arrastar, também apaga.** O lápis segue a regra dos outros desenhos (gesto menor que 4 px é descartado). A borracha não tem esse limite, porque tocar um ponto do traço é um gesto legítimo de apagar. O clique que fecha a passada é engolido e não seleciona nem abre nada.
- **A prévia da passada é incremental.** Apagar é uma união, então a prévia aplica `eraseBoard` só no trecho novo, sobre o quadro já apagado, com ids de prévia. No `pointerup`, `eraseDoc` roda de novo com o caminho inteiro sobre o documento **atual**, com `crypto.randomUUID()` nos pedaços novos, numa entrada só de histórico (como o design manda).
- **Passada que não apaga nada não vira entrada de histórico.** O `eraseBoard` devolve o mesmo quadro, e o `apply` da fatia 02 já ignora reducer sem mudança. Por isso, no smoke, passar sobre o post-it não gasta um `Ctrl+Z`.
- **O Rabisco é desenhado em coordenadas absolutas**, com `transform="translate(0 0)"` e cache do `d` num `WeakMap` pelo array `points`. O design pede geometria local + `transform` para as formas do `roughjs`, para o arraste não invalidar o cache. O Rabisco não usa `roughjs`. Como `translateDrawing` cria um array novo ao mover, o cache por geometria local não ganharia nada. Um traço parado mantém o mesmo array entre renders, e o cache acerta.
- **A amostragem do lápis roda a cada `pointermove`, não a cada quadro.** A prévia continua num `requestAnimationFrame`, mas os pontos vêm de todos os eventos, para o traço ter a forma da mão. O caminho da borracha também é guardado por evento.
- **Os pedaços ficam na camada do traço original.** O primeiro mantém o `id` e a posição no array. Os outros entram logo depois dele, com a mesma cor e espessura.
- **O parse não corta Rabisco com mais de 5.000 pontos.** O teto é da amostragem, como o design diz. As regras de descarte do parse são as do design: `points` ímpar, menos de 2 pontos ou número não finito.
- **Escolher `E` limpa a seleção**, como escolher uma ferramenta de desenho já limpava na 03. Sem isso, o contorno da seleção ficaria sobre traços que a borracha está cortando.
- **O círculo da borracha substitui o cursor.** Com `E`, o quadro fica com `cursor: none`, e um círculo de 16 px de diâmetro (raio de 8 px de tela) segue o ponteiro. Ele é posicionado direto no DOM, sem render por movimento do mouse, e some quando o ponteiro sai do quadro. Com `P`, o cursor é a mira, como nas outras ferramentas de desenho.

## O que foi feito

- `src/shared/mindscape/model.ts`: tipo `pencil` (`points: number[]`, achatado) no `MindscapeDrawing` e no `parseDrawing`.
- `src/shared/mindscape/drawings.ts`: `PENCIL_MIN_STEP = 2`, `PENCIL_MAX_POINTS = 5000`, `appendPencilPoint` (arredonda a 0,1 e devolve o mesmo array quando pula o ponto); `translateDrawing` e a normalização sabem do Rabisco.
- `src/shared/mindscape/geometry.ts`: `toPoints`, `distanceToPolyline` e `distanceToDrawing` exportados; Rabisco no `hitTestDrawings` (pela polilinha), no `drawingBounds` (min/max dos pontos, que o laço usa) e no `resizeDrawing` (sem alça: devolve o mesmo desenho).
- `src/shared/mindscape/eraser.ts` (novo): `erasePolyline` (caminho adensado a cada `raio/2`, interseção segmento × círculo pela equação de 2º grau, complemento dos intervalos, corridas emendadas entre segmentos, corrida com menos de 2 pontos ou menor que 1 unidade cai, pré-filtro por caixa), `eraseBoard` e `eraseDoc`.
- `src/shared/mindscape/shortcuts.ts`: ferramentas `pencil` (`p`) e `eraser` (`e`).
- `src/renderer/src/Mindscape/roughShapes.ts`: `pencilPath` (curvas quadráticas pelos pontos médios) e o caso `pencil` no `drawingShape`.
- `src/renderer/src/Mindscape/MindscapeBoard.tsx`: `pencil` é ferramenta de desenho, com `points` no `DrawGesture`; gesto `erase` com prévia local; prop `onErase`; `links` no `BoardRender` (a prévia esconde a Ligação tocada); círculo da borracha; `ERASER_RADIUS_PX = 8` e `sizesOf` exportados.
- `src/renderer/src/Mindscape/MindscapeScreen.tsx`: `P` fica ativo depois do traço; `handleErase` com `eraseDoc` pelo `onAction`; dicas das duas ferramentas; as Ligações vêm do `BoardRender`.
- `src/renderer/src/Mindscape/MindscapeToolbar.tsx`: botões "Lápis P" e "Borracha E", depois de "Elipse".
- `src/renderer/src/Mindscape/MindscapeSelectionLayer.tsx`: Rabisco sem alças.
- `src/renderer/src/Mindscape/Mindscape.module.css`: mira para `P`, `cursor: none` para `E` e o estilo do círculo.

Nada mudou em `src/main/` (inclusive `src/main/accounts/` e `src/main/chat/attachments.ts`), no Modo Dev, no `config.json` nem no `schemaVersion` (o tipo `pencil` já estava previsto na v2 do design). Nenhuma dependência npm entrou.

### Testes existentes alterados (e por quê)

- `tests/mindscape-shortcuts.test.ts`: o caso "returns null for keys that are not shortcuts (yet)" listava `p` e `e`, que agora são atalhos. Eles foram trocados por `q`, e um caso novo cobre `P`/`E`.
- `tests/mindscape-geometry.test.ts`, `tests/mindscape-drawings.test.ts`, `tests/mindscape-model.test.ts`, `tests/mindscape-links.test.ts`: só casos novos. Os anteriores seguem iguais.
- `tests/smoke/mindscape-desenho.spec.ts`: `test` novo da fatia 04 e o campo opcional `points` no tipo `SavedDrawing`. Os testes 01–03 não mudaram.
- Nenhum smoke da V1 foi tocado.

## Vermelho → verde (vitest, test-first)

Antes do código (`npx vitest run` nos 6 arquivos: `mindscape-eraser`, `-geometry`, `-drawings`, `-model`, `-shortcuts`, `-links`):

```
FAIL tests/mindscape-eraser.test.ts [ tests/mindscape-eraser.test.ts ]      (módulo eraser.ts inexistente)
FAIL tests/mindscape-drawings.test.ts > appendPencilPoint > … (4) e > the pencil stroke in the reducers > … (3)
FAIL tests/mindscape-geometry.test.ts > the pencil stroke in the geometry > … (4)
FAIL tests/mindscape-links.test.ts > pencilPath > … (4)
FAIL tests/mindscape-model.test.ts > parseMindscapeDoc — pencil > … (2)
FAIL tests/mindscape-shortcuts.test.ts > maps P to the pencil and E to the eraser … (expected null to deeply equal { type: 'tool', tool: 'pencil' })
Test Files  6 failed (6)
Tests  18 failed | 80 passed (98)        (os casos do eraser não chegaram a rodar)
```

Depois: `npx vitest run tests/mindscape-` → `Test Files 12 passed (12)`, `Tests 173 passed (173)`.

## Gates (saída observada, 2026-10-30)

- `npx vitest run`: `Test Files 1 failed | 216 passed (217)`, `Tests 2 failed | 5038 passed (5040)`. As 2 falhas são de `tests/esteiraContractPackageLocation.test.ts`, a falha ambiental conhecida: o teste varre `.claude/worktrees/` (não versionado) e acha cópias do contrato. Nada a ver com o Mindscape. Nenhum teste de tempo falhou nesta rodada.
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json` sem erro. O `tsconfig` inclui `tests/`, então o spec do smoke também passa pelo typecheck.
- `npm run build`: `✓ built in 6.15s`.
- Smoke da fatia, sozinho: `-g "desenho 04"` → `1 passed (13.0s)`, de primeira, e de novo com `DONEL_SMOKE_SHOTS_DIR` (print conferido: dois pedaços do Rabisco, círculo da borracha no cursor, Ligação de volta depois do `Ctrl+Z`, retângulo apagado).
- `npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/mindscape`: **`9 passed (1.9m)`**. São a V1 (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`) e o desenho 01, 02, 03 e 04.
- Lint: o repo não tem script de lint (lacuna conhecida).

## Plano de testes, item a item

- vitest: `erasePolyline` com a borracha no meio de um traço reto devolve dois trechos ✔; nas pontas, um trecho mais curto ✔ (as duas pontas); longe, o traço inteiro ✔ (o mesmo array); corrida com menos de 2 pontos ou menor que 1 unidade some ✔. A mais: um clique só também corta; o caminho é adensado (uma passada longa em diagonal não pula o traço); polilinha com curva mantém os vértices que sobram, com os pontos de corte arredondados a 0,1.
- vitest: `eraseBoard` mantém o `id` no primeiro pedaço e usa `newId` nos outros ✔; tira o retângulo/elipse quando toca o contorno e não no miolo ✔; tira a Ligação tocada ✔ e nunca tira post-it ✔. A mais: os pedaços ficam na camada do original; o alcance cresce com a espessura; Ligação sem tamanho de uma ponta não sai; nada tocado devolve o mesmo quadro; `eraseDoc` preserva o post-it escrito pela sessão e devolve o mesmo documento sem mudança.
- vitest: seta partida deixa a ponta só no pedaço final ✔; apagar a ponta da seta deixa o resto sem ponta.
- vitest: `parseMindscapeDoc` descarta Rabisco com `points` ímpar ✔. Também descarta com menos de 2 pontos, vazio, `NaN`, texto, sem `points` e cor inválida, e faz o caminho de ida e volta de um Rabisco válido.
- vitest: `pencilPath` é estável para os mesmos pontos ✔. A mais: começa no primeiro ponto e termina no último; 2 pontos viram um segmento reto; menos de 2 pontos não geram path; `drawingShape` do Rabisco usa o `pencilPath` com a espessura certa.
- vitest (a mais): Rabisco no `hitTestDrawings` (perto dos segmentos sim, no miolo do "V" não, o de cima primeiro), no `drawingBounds`, no laço (só inteiro) e sem alça no `resizeDrawing`; `appendPencilPoint` (2 unidades, 0,1, teto de 5.000, ponto não finito); `translateDrawing`/`moveItems`/`setDrawingsStyle`/`removeItems` com Rabisco; `addDrawing` recusa Rabisco ímpar ou curto; `P`/`E` no `mindscapeShortcut`, sem diferenciar maiúscula, `null` com `Ctrl`/`Alt` e com `editable`.
- smoke: `P` → riscar uma linha horizontal → um Rabisco em `drawings` ✔ e a ferramenta segue `P` ✔.
- smoke: `E` → o círculo aparece no cursor (a mais) → passar a borracha no meio do Rabisco → `drawings` tem dois Rabiscos ✔, o primeiro com o `id` original, e a ferramenta segue `E` ✔.
- smoke: passar sobre o contorno de um retângulo → some inteiro ✔.
- smoke: passar sobre a Ligação → some ✔, e os dois post-its ficam.
- smoke: passar sobre um post-it → fica ✔, e nada mais muda.
- smoke: `Ctrl+Z` → a última passada volta inteira ✔. Para provar que a passada inteira é uma entrada só, a última passada corre sobre os dois Rabiscos de uma vez, e um `Ctrl+Z` devolve os dois exatamente como estavam. Um segundo `Ctrl+Z` traz a Ligação de volta, porque a passada sobre o post-it não gerou entrada.
- smoke: com `V`, clicar no Rabisco seleciona ✔ (sem alças) e arrastar move ✔ (o primeiro ponto andou +40/−30 no arquivo).
- smoke: relançar o app → como deixado ✔ (2 Rabiscos na tela, `mindscape.json` igual ao de antes do relançamento).

## Dados necessários (seed)

Não há banco. O spec reaproveita o root temporário (`atlas/CLAUDE.md`, `config.json` com `projectRoots`) com um `mindscape-04.json` próprio, apontado por `DONEL_MINDSCAPE_FILE`, e o roteiro `slow-turn.json` do claude falso. O post-it do dono, o retângulo, a Ligação e o Rabisco são criados pelo próprio smoke. Nenhuma fixture nova.

## O que ficou sem verificar

- **Zoom diferente de 100%.** O raio já é `8 / zoom` e a amostragem usa coordenadas do quadro, mas o zoom só ganha gesto na fatia 05. A 05 já prevê dividir o raio pelo zoom e vai exercitar isso.
- **Desempenho com traço longo.** Não medi um Rabisco perto de 5.000 pontos com uma passada longa por cima. A prévia é incremental e há pré-filtro por caixa (do traço e de cada segmento), mas o `pointerup` recalcula a passada inteira de uma vez.
- **Seta partida na tela.** Está no vitest, mas não tem passo no smoke.
- **Caneta e toque.** Só o mouse do Playwright foi usado. Com caneta, os eventos de ponteiro são os mesmos, mas a densidade de amostras muda.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.

## Notas fora do escopo (candidatas a item)

- O traço do lápis é um `path` liso, sem o tremido do `roughjs` das outras formas, como o design decidiu. Se parecer "chapado" demais no alfa, o `perfect-freehand` continua como candidato.
- A borracha não apaga Ligação de post-it de sessão sem aba aberta (ela nem aparece na tela). É coerente com o que se vê, mas a Ligação fica guardada e volta quando a sessão volta.
- Print na borracha fica para a 06, como o escopo manda.

## Próxima etapa

Fatia 05 (zoom de 25% a 400%), que depende desta. O raio da borracha e as tolerâncias do hit-test já estão em px de tela divididos pelo `board.zoom`.
