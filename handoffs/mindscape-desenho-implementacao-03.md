# /implementacao — Mindscape desenho, fatia 03

**Fatia**: 03 — Seleção múltipla, alças, estilo e camadas
**Data**: 2026-10-30 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`drawings.ts`, `geometry.ts`, `shortcuts.ts`) + `teste-depois` (tela, por smoke)
**Fatias anteriores lidas**: `handoffs/mindscape-desenho-implementacao-01.md`, `-02.md`.

## Validação do dono

O dono testou a seleção no app e aprovou em 2026-10-30 ("Agora sim! Ficou maravilhoso!"). O código
foi escrito numa sessão anterior, que não deixou relato. Este relato foi escrito na sessão seguinte, a
partir do diff e dos gates rodados de novo antes do commit.

## O que foi feito

- `src/shared/mindscape/drawings.ts`: `updateDrawing`, `translateDrawing`, `moveItems`,
  `removeItems` (post-it do dono e escrito pela sessão saem por `archiveCard`, post-it de sessão é
  ignorado), `setDrawingsStyle`, `bringToFront`/`sendToBack`.
- `src/shared/mindscape/geometry.ts`: `Rect`, `CardRect`, `ItemIds`, `linkEndpoints` (movido de
  `roughShapes.ts`, que o re-exporta), `distanceToSegment`, `hitTestDrawings` (só perto do
  contorno), `drawingBounds`, `itemsInsideRect`, `resizeDrawing` com `MIN_DRAWING_SIZE = 4`.
- `src/shared/mindscape/shortcuts.ts`: `Delete`, `Ctrl+A` e os colchetes de camada por `key`.
- `src/renderer/src/Mindscape/MindscapeSelectionLayer.tsx` (novo): contorno da seleção, alças com
  um desenho só, laço.
- `MindscapeScreen.tsx`, `MindscapeBoard.tsx`, `MindscapeToolbar.tsx`, `MindscapeCard.tsx`,
  `MindscapeDrawingLayer.tsx`, `Mindscape.module.css`: seleção `{ cards, drawings }`, laço no fundo
  com `V`, espaço + arrastar e `H` para mover a visão, botões de camada, cor/espessura aplicadas à
  seleção, `Delete` na Ligação selecionada.

### Testes existentes alterados (e por quê)

- `tests/smoke/mindscape-canvas.spec.ts`, passo 3: com `V` o fundo agora faz laço, então o passo
  passa a mover a visão com `H` (previsto na fatia).
- `tests/mindscape-drawings.test.ts`, `tests/mindscape-geometry.test.ts`,
  `tests/mindscape-shortcuts.test.ts`: casos novos; os anteriores seguem.
- `tests/smoke/mindscape-desenho.spec.ts`: `test` novo da fatia 03.

## Gates (saída observada, 2026-10-30)

- `npx vitest run`: `Test Files 215 passed | 1 failed (216)`, `Tests 5003 passed | 2 failed`. As 2
  falhas são de `tests/esteiraContractPackageLocation.test.ts` e são do ambiente: ele varre o repo
  e acha cópias do contrato nos worktrees locais em `.claude/worktrees/` (pasta não versionada).
  Nada a ver com o Mindscape; num clone limpo passa.
- `npm run typecheck`: sem erro.
- `npm run build`: ok.
- `npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/mindscape`: **8 passed
  (1.3m)** — V1 (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`) e desenho 01,
  02 e 03.
- Lint: o repo não tem script de lint (lacuna conhecida).

## Plano de testes

Coberto pelos casos de vitest e pelo `test` "Mindscape desenho 03" do smoke, que seguem o roteiro
da fatia no BACKLOG (dois retângulos, `Shift+clique`, arraste conjunto com um `Ctrl+Z`, laço,
cor só no desenho, alça de canto, "Mandar para trás", `Ctrl+A` + `Delete`, `Delete` na Ligação,
espaço/`H` movendo a visão, "Ir ao terminal" com um post-it de sessão).

## Próxima etapa

Fatia 04 (lápis e borracha).
