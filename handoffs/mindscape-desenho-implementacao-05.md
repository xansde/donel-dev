# /implementacao — Mindscape desenho, fatia 05

**Fatia**: 05 — Zoom de 25% a 400%, salvo por quadro
**Data**: 2026-10-30 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`zoomAt`, fator da roda, passos do indicador, roda movendo a visão, `setBoardView`) + `teste-depois` (tela, por smoke)
**Fatias anteriores lidas**: `handoffs/mindscape-desenho-implementacao-01.md` a `-04.md`.

## Decisões tomadas no caminho

Todas **decididas por delegação do dono (2026-10-30)**: rodada autônoma, sem humano para perguntar. Critério: a opção mais simples coerente com o design. Nenhuma muda regra do refinamento.

- **O indicador "− 100% +" fica no canto inferior esquerdo**, não no direito. O design diz só "canto inferior". O direito é onde os smokes (V1 e desenho) clicam para salvar o texto do post-it do dono (`largura − 30`, `altura − 30`), e o indicador ficaria embaixo desse clique. O esquerdo é também onde o Excalidraw põe o zoom.
- **`−`/`+` andam 10 pontos a partir do número mostrado.** Com 121% (duas voltas da roda), `−` leva a 111%, não a 110%. O número é sempre inteiro (`Math.round(zoom × 100)`), e o passo parte dele, para o resultado bater com o que o dono lê. Nos limites, o botão fica desabilitado.
- **Cada mudança de visão é uma função da visão atual.** O quadro chama `onViewChange(change)`, e o `App` aplica `change` sobre o quadro do documento **no momento** (`applySession` lê o `docRef`, que muda na hora). Assim, vários eventos de roda antes do próximo render se somam, em vez de cada um partir de uma visão velha. O fim do arraste com `H`/espaço passa pelo mesmo caminho.
- **`setBoardPan` saiu; `setBoardView` prende o zoom na faixa** (como o parse) e recusa número não finito. O teste de `setBoardPan` em `tests/mindscape-canvas.test.ts` passou a chamar `setBoardView` com `zoom: 1`, com as mesmas afirmações.
- **Duas escutas de `wheel`, as duas nativas e não passivas.** A do quadro faz o trabalho (zoom com `Ctrl`, visão sem `Ctrl`). A da `<section>` do Mindscape só faz `preventDefault` com `Ctrl`, para a página não dar zoom com o ponteiro sobre a barra ou as abas. Lá, o quadro não muda.
- **Roda sem `Ctrl` com `Shift`: os dois deltas vão para a horizontal.** O Chromium pode ou não ter trocado os eixos antes de entregar o evento. Somar `deltaX + deltaY` funciona nos dois casos. Os deltas passam por `normalizeWheelDelta` (linhas e páginas viram pixels).
- **A roda espera o gesto em andamento.** Durante um arraste (desenho, laço, mão, borracha), a roda não muda a visão: o gesto converte pontos com a visão em que começou. Com `Ctrl`, o `preventDefault` acontece mesmo assim.
- **Roda sobre um campo de texto em edição** (o post-it do dono) não move a visão. O campo fica com a roda dele.
- **Clique no indicador não começa gesto nem é engolido.** O `pointerdown` dele para a propagação, e o `onClickCapture` do quadro ignora alvos dentro do indicador. Sem isso, o clique que fecha um arraste com `H` poderia engolir o clique de um botão do zoom.
- **A grade de pontos acompanha a visão**: `background-size` de `22 × zoom` px e `background-position` no `pan`. Até aqui ela ficava parada ao mover a visão.
- **O quadro expõe `data-zoom`**, ao lado do `data-pan` que já existia, para o smoke ler a visão sem abrir o arquivo.

## O que foi feito

- `src/shared/mindscape/view.ts`: `zoomAt` (`pan' = p − (p − pan) × (z'/z)`, zoom preso em 0,25–4, a mesma visão quando nada muda), `wheelZoomFactor` (`1,1^(−delta/100)`), `zoomPercent`, `stepZoom` e `wheelPan`.
- `src/shared/mindscape/model.ts`: `setBoardView` no lugar de `setBoardPan`; o comentário do campo `zoom` deixou de dizer "fixo em 1".
- `src/renderer/src/App.tsx`: `handleMindscapeView` (porta `applySession`, fora do histórico) no lugar de `handleMindscapePan`; prop `onView` da tela.
- `src/renderer/src/Mindscape/MindscapeScreen.tsx`: prop `onView`, guarda de `Ctrl+roda` na `<section>`, `onViewChange` para o quadro.
- `src/renderer/src/Mindscape/MindscapeBoard.tsx`: `onViewChange` no lugar de `onPan`; escuta nativa de `wheel`; plano com `translate(pan) scale(zoom)`; grade acompanhando; `data-zoom`; indicador "− 100% +" (grupo "Zoom", botões "Diminuir zoom", número com título "Voltar a 100%", "Aumentar zoom").
- `src/renderer/src/Mindscape/Mindscape.module.css`: `transform-origin: 0 0` no plano e o estilo do indicador.

Já estavam prontos desde as fatias 01–04 e não mudaram: o parse corrigindo zoom fora da faixa (`clampZoom`), o "Novo post-it" calculando o canto visível com `screenToWorld`, e as tolerâncias em px de tela divididas pelo zoom (hit-test `6 / zoom`, raio da borracha `8 / zoom`, alças e contorno da seleção, deslocamento do arraste). Esta fatia exercitou esses pontos com zoom diferente de 100% pela primeira vez.

Nada mudou em `src/main/` (inclusive `src/main/accounts/` e `src/main/chat/attachments.ts`), no Modo Dev, no `config.json` nem no `schemaVersion` (o campo `zoom` já existia na v2). Nenhuma dependência npm entrou.

### Testes existentes alterados (e por quê)

- `tests/mindscape-canvas.test.ts`: `setBoardPan` deixou de existir. O `describe` e o caso de ida e volta pelo JSON passaram a usar `setBoardView` com `zoom: 1`. As afirmações são as mesmas.
- `tests/mindscape-view.test.ts` e `tests/mindscape-model.test.ts`: só casos novos.
- `tests/smoke/mindscape-desenho.spec.ts`: `test` novo da fatia 05, helpers novos (`savedView`, `viewOf`, `pageZoomFactors`, `ctrlWheel`, `boardTab`) e o tipo `ElectronApplication` no import. Os testes 01–04 não mudaram.
- Nenhum smoke da V1 foi tocado. Nenhum gesto que eles usam mudou.

## Vermelho → verde (vitest, test-first)

Antes do código (`npx vitest run tests/mindscape-view.test.ts tests/mindscape-model.test.ts tests/mindscape-canvas.test.ts`):

```
FAIL tests/mindscape-canvas.test.ts > setBoardView (the pan) > … (2)
FAIL tests/mindscape-model.test.ts > setBoardView > … (4)
FAIL tests/mindscape-view.test.ts > zoomAt / wheelZoomFactor / stepZoom / wheelPan > … (11)
Test Files  3 failed (3)
Tests  17 failed | 33 passed (50)
```

Depois: `npx vitest run tests/mindscape-` → `Test Files 12 passed (12)`, `Tests 188 passed (188)`.

## Gates (saída observada, 2026-10-30)

- `npx vitest run`: `Test Files 1 failed | 216 passed (217)`, `Tests 2 failed | 5053 passed (5055)`. As 2 falhas são de `tests/esteiraContractPackageLocation.test.ts`, a falha ambiental conhecida: o teste varre `.claude/worktrees/` (não versionado) e acha cópias do contrato. Nenhum teste de tempo falhou nesta rodada.
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json` sem erro (inclui `tests/`, então o spec do smoke também).
- `npm run build`: `✓ built in 5.26s`.
- Smoke da fatia, sozinho: `-g "desenho 05"` → `1 passed`, de primeira, e de novo com `DONEL_SMOKE_SHOTS_DIR` (print conferido: post-its a 121%, indicador "− 121% +" no canto inferior esquerdo, grade acompanhando).
- `npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/mindscape`: **`10 passed (1.5m)`**. São a V1 (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`) e o desenho 01 a 05.
- Lint: o repo não tem script de lint (lacuna conhecida).

## Plano de testes, item a item

- vitest: `zoomAt` mantém fixo o ponto do quadro sob o mouse ✔ e respeita 0,25 e 4 ✔ (com o ponto ainda fixo no limite). A mais: devolve a mesma visão quando o zoom não muda ou não é número.
- vitest: o fator da roda é maior que 1 para delta negativo e menor para positivo ✔ (`−100` dá 1,1, `100` dá 1/1,1, `0` dá 1, não finito dá 1).
- vitest: `setBoardView` grava `pan` e `zoom` ✔ e devolve o mesmo objeto sem mudança ✔. A mais: só o quadro tocado muda, quadro ausente e número não finito devolvem o mesmo documento, o zoom fica preso na faixa e sobrevive à ida e volta pelo JSON.
- vitest: `parseMindscapeDoc` corrige zoom fora da faixa para o limite ✔ (o caso já existia desde a fatia 01 e segue verde).
- vitest (a mais): `stepZoom` anda 10 pontos a partir do número mostrado e para em 25% e 400%; `zoomPercent` arredonda; `wheelPan` move na vertical, `deltaX` na horizontal, `Shift` na horizontal com ou sem eixos trocados, e devolve o mesmo `pan` sem movimento.
- smoke: no `atlas`, `Ctrl+roda` para cima sobre o quadro → o indicador passa de 100% ✔ (110%) e `webContents.getZoomFactor()` segue 1 ✔ (em todas as janelas).
- smoke: o ponto sob o mouse fica no lugar ✔. Mais exato que "quase não muda": o canto do post-it do dono, a 30 px do mouse, se afasta dele na razão do zoom (1,1), com erro menor que 2 px, e a largura cresce 10%.
- smoke (a mais): `Ctrl+roda` sobre a barra não muda o quadro nem a página.
- smoke: `−` → o indicador cai 10 pontos ✔ (121% → 111%); clicar no número → 100% ✔.
- smoke: roda sem `Ctrl` → move a visão na vertical ✔ (`pan.y − 100`, `x` igual); `Shift+roda` na horizontal ✔ (`pan.x − 100`, `y` igual).
- smoke: desenhar um retângulo com zoom 200% → ele nasce sob o ponteiro ✔. No arquivo, `x`/`y` batem com o ponto do `pointerdown` convertido pela visão, e `w`/`h` são metade do arraste em tela (80 × 50 para 160 × 100). Na tela, a caixa desenhada fica sob o caminho do ponteiro. A mais: com `V`, um clique na borda seleciona o retângulo a 200%.
- smoke: `Ctrl+Z` não desfaz zoom ✔. O `Ctrl+Z` desfaz o retângulo e o indicador segue em 200%; `Ctrl+Shift+Z` traz o retângulo de volta, ainda em 200%.
- smoke: `beacon` segue em 100% ✔, e de volta no `atlas`, 200%.
- smoke: relançar → `atlas` volta no mesmo zoom ✔ (200% e o mesmo `pan` do arquivo), com o retângulo; `beacon` em 100%.
- A pinça do touchpad fica para o alfa, como o BACKLOG prevê (não dá para gerar no Playwright).

## Dados necessários (seed)

Não há banco. O spec reaproveita o root temporário (`atlas/CLAUDE.md`, `config.json` com `projectRoots`) e cria `beacon/CLAUDE.md` no começo do teste 05, antes de lançar o app. O `mindscape-05.json` é próprio, apontado por `DONEL_MINDSCAPE_FILE`, com o roteiro `slow-turn.json` do claude falso nas duas abas. O post-it do dono e o retângulo são criados pelo próprio smoke. Nenhuma fixture nova.

## O que ficou sem verificar

- **Pinça do touchpad.** Pela documentação, o Chromium a entrega como `wheel` com `ctrlKey`, e o código trata os dois do mesmo jeito. Medir no alfa.
- **Se o Electron daria zoom na página sem o `preventDefault`.** O smoke prova que o fator da página segue 1, mas não rodei a contraprova (tirar a guarda e ver o fator mudar). Se o Electron não der zoom com `Ctrl+roda` por padrão, a afirmação passa de qualquer jeito.
- **Roda de mouse com `Shift` de verdade.** O Playwright gera o evento pelo CDP. Com um mouse real no Windows, o Chromium pode trocar os eixos antes. O `wheelPan` cobre os dois casos no vitest.
- **Borracha com zoom diferente de 100%.** O raio é `8 / zoom` desde a fatia 04, mas não há passo de smoke apagando com zoom.
- **Desempenho do zoom com muitos desenhos.** Cada evento de roda gera um render do quadro (como cada quadro do arraste de mão já gerava). Não medi com centenas de desenhos.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.

## Notas fora do escopo (candidatas a item)

- Zoom da página por `Ctrl+=`/`Ctrl+-` (menu padrão do Electron) segue fora pelo design. Se incomodar no alfa, vira item próprio.
- Minimapa e histórico de zoom: fora pelo escopo.
- Com zoom baixo (25%), a grade de pontos fica densa (5,5 px entre pontos). Se pesar visualmente no alfa, dá para esconder a grade abaixo de um limite.

## Próxima etapa

Fatia 06 (print colado ou arrastado para o quadro), que depende da 04. O print nasce no último ponto do mouse sobre o quadro, convertido por `screenToWorld` com a visão atual, que agora tem zoom.
