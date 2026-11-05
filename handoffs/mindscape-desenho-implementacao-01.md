# /implementacao — Mindscape desenho, fatia 01

**Fatia**: 01 — Barra de ferramentas: formas, setas soltas e seta de post-it a post-it vira Ligação
**Data**: 2026-10-24 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (modelo v2, `drawings.ts`, `view.ts`, `geometry.ts`, `shortcuts.ts`, store) + `teste-depois` (tela, por smoke)
**Fatias anteriores desta demanda**: nenhuma (esta é a primeira; não havia `handoffs/mindscape-desenho-implementacao-*.md` para ler).

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-24** ("vai fundo"). Nenhuma muda regra do refinamento nem decisão do design.

- **Sem worktree, no checkout principal, `feature/mindscape-desenho`, inline, sem push.** Instrução da execução, como na V1. O flip do BACKLOG entra no commit da fatia (instrução da execução, no lugar do "sem commit" da skill).
- **O tipo `MindscapeDrawing` só tem `line`, `rect` e `ellipse` nesta fatia.** O design lista também `pencil` e `image`; eles entram nas fatias 04 e 06, junto com quem os cria e os valida. Até lá, um desenho desses tipos no arquivo cai no parse, como qualquer tipo desconhecido. Motivo: não declarar tipo sem produtor nem guarda (YAGNI).
- **`parseDrawing` exportado de `model.ts` e reusado pelo `addDrawing`.** O reducer normaliza a caixa e passa pela mesma guarda do disco, então o que o reducer aceita é exatamente o que o parse aceita (id vazio, cor fora das 3, espessura desconhecida, número não finito, `w`/`h` ≤ 0 → mesmo documento).
- **Zoom do arquivo**: número finito vai por `clampZoom`; ausente ou não numérico vira 1. A tela ainda não aplica o zoom (fatia 05), mas todos os gestos já convertem por `screenToWorld` com `board.zoom`.
- **`clampZoom` de valor não finito devolve 1** (100%). O design só fixa a faixa 0,25–4.
- **Gesto descartado (até 4 px, a mesma soma `|dx|+|dy|` do limiar de arraste da V1) não troca a ferramenta.** Só um desenho (ou uma tentativa de Ligação) volta para `V`. Seta ou linha com as duas pontas no mesmo post-it também volta para `V`, sem criar nada.
- **O `id` do desenho/Ligação nasce no `pointerdown`** (`crypto.randomUUID()`): a prévia já usa o mesmo `seed` do `roughjs`, e o traço não muda ao soltar.
- **Foco da `<section>`**: ela recebe o foco ao montar e, no `pointerdown`, **só quando o foco está fora dela** (por exemplo, num terminal embaixo). O design diz "a cada `pointerdown`"; forçar o foco sempre tiraria o foco do texto do post-it do dono ao clicar nas cores dele (o `onMouseDown` com `preventDefault` existe justamente para isso, ver `MindscapeCard.tsx`), e o clique se perderia. Com o foco já dentro, o navegador cuida sozinho (a `section` tem `tabIndex={-1}`, então um clique no fundo a foca).
- **`Esc` e qualquer troca de ferramenta cancelam o gesto em curso**: o `MindscapeBoard` encerra o gesto quando a prop `tool` muda, sem gravar nada.
- **Clique que termina um desenho ou um arraste com `H` é engolido** (`onClickCapture`): soltar sobre o cartão de sessão não o seleciona, e soltar sobre uma Ligação não a seleciona. O arraste de cartão com `V` mantém o comportamento da V1.
- **`H` começa o arraste em qualquer lugar, inclusive sobre post-it e seus botões**; só campo de texto fica de fora. As ferramentas de desenho idem.
- **`onAction(projectPath, reducer)`** recebe só as ações novas (desenho e Ligação desenhada). O callback `onAddLink` da V1 saiu (ninguém mais o chamava); os outros callbacks da V1 ficam até a fatia 02, como o BACKLOG diz.
- **Rótulos da barra**: ferramentas com nome e letra visíveis ("Seleção V", "Mão H", "Seta A", "Linha L", "Retângulo R", "Elipse O"), `aria-pressed` e `title` com a letra; grupos `role="group"` "Ferramentas", "Cor do desenho" (Sem cor/Azul/Dourado), "Espessura do desenho" (Fino/Médio/Grosso) e "Ligação selecionada". A amostra de "Sem cor" na barra usa `--text-primary`, a tinta neutra que o desenho recebe.
- **Ponta da seta solta** cresce com a espessura (`12 + 2 × espessura`), para não sumir no traço grosso. A ponta da Ligação segue igual à da V1.
- **Faixa de dica**: com `V`, o texto da V1; com as outras ferramentas, uma frase curta por ferramenta (por exemplo, "Retângulo: arraste no quadro (Esc cancela)").

## O que foi feito

- `src/shared/mindscape/model.ts`: `MINDSCAPE_SCHEMA_VERSION = 2`; tipos `DrawingColor`, `DrawingStroke`, `MindscapeDrawing`; `zoom` e `drawings` no quadro; `ensureBoard` com `zoom: 1, drawings: []`; `parseDrawing`; parse lê v1 e v2 e sai sempre v2; `LinkInput.arrow` (padrão `true`).
- `src/shared/mindscape/drawings.ts` (novo): `addDrawing` (normaliza `w`/`h`) e `STROKE_WIDTH` (1,5 / 3 / 5).
- `src/shared/mindscape/view.ts` (novo): `screenToWorld`, `worldToScreen`, `clampZoom`, `MIN_ZOOM`/`MAX_ZOOM`.
- `src/shared/mindscape/geometry.ts` (novo): `cardAtPoint`.
- `src/shared/mindscape/shortcuts.ts` (novo): `mindscapeShortcut`, `MindscapeTool`, `TOOL_KEYS` (`v h a l r o`, `Escape`).
- `src/main/mindscape-store.ts`: **sem alteração de código**. A guarda compara com `MINDSCAPE_SCHEMA_VERSION`, que agora é 2, então o store grava v2 e fica read-only com 3 (provado no vitest).
- `src/renderer/src/Mindscape/MindscapeToolbar.tsx` (novo), `MindscapeDrawingLayer.tsx` (novo, SVG sob as Ligações, `pointer-events: none`), `roughShapes.ts` (`drawingShape`, geometria local + `transform`, cache por id e tamanho; a ponta de seta virou função comum à Ligação).
- `MindscapeBoard.tsx`: máquina de gestos por ferramenta (`card`/`pan`/`draw`), prévia local em `requestAnimationFrame`, hit-test das pontas por `cardAtPoint`, cancelamento na troca de ferramenta, `data-tool` na vista.
- `MindscapeScreen.tsx`: ferramenta e estilo em estado de tela, `onKeyDown`/`tabIndex={-1}`/foco na `<section>`, `handleDraw` (Ligação × desenho solto), "Novo post-it" por `screenToWorld`. **Saiu o modo "Ligar" inteiro**: botão, `linking`, `linkOrigin`, `pickForLink`, `onClickCapture`/`onDoubleClickCapture`, dica, `data-linking` e o CSS de cursor.
- `App.tsx`: `handleMindscapeAction` → `onAction`; saiu `handleMindscapeAddLink`.
- `Mindscape.module.css`: grupos da barra, amostras de cor e espessura, camada de desenhos, cursores por ferramenta.

Nada mudou em `src/main/accounts/`, no Modo Dev, no `config.json` nem em `src/main/chat/attachments.ts`. Nenhuma dependência npm entrou.

### Testes existentes alterados (e por quê)

- `tests/mindscape-model.test.ts` → `ensureBoard` cria o quadro com `zoom: 1` e `drawings: []` (o modelo mudou de propósito).
- `tests/mindscape-store.test.ts` → o caso "recusa gravar por cima de versão mais nova" passou a usar `schemaVersion: 3` (2 agora é a versão atual).
- `tests/smoke/mindscape-links.spec.ts` → **passo "Ligar" trocado por desenhar com `A`** (o BACKLOG já mandava), e o botão "Seta" da Ligação selecionada passou a ser procurado com `exact: true`, porque a ferramenta da barra se chama "Seta A". O roteiro e as asserções seguem os mesmos.
- O smoke `tests/smoke/mindscape.spec.ts` não foi tocado.

## Vermelho → verde (vitest, test-first)

Antes do código (`npx vitest run` nos 6 arquivos):

```
Test Files  6 failed (6)
Tests  7 failed | 16 passed (23)
FAIL tests/mindscape-drawings.test.ts / mindscape-geometry / mindscape-shortcuts / mindscape-view  (módulo inexistente)
FAIL mindscape-model > ensureBoard > creates an empty board ...            (sem zoom/drawings)
FAIL mindscape-model > parseMindscapeDoc — schema v2 > (4 casos)           (v2 inexistente)
FAIL mindscape-model > addLink — arrow on the input > ... arrow: false     (recebia true)
FAIL mindscape-store > reads a v1 file and writes it back as v2            (expected 1 to be 2)
```

Depois: `npx vitest run tests/mindscape` → `Test Files 10 passed (10)`, `Tests 89 passed (89)`.

## Gates (saída observada)

- `npm test` → `Test Files 215 passed (215)`, `Tests 4956 passed (4956)`. Duas rodadas anteriores falharam em testes de tempo **fora do Mindscape** e que não importam nada dele: `tests/chat-transcript-io.test.ts` (1 caso) numa, `tests/hook-bridge.contract.test.ts` ("answers {} within 10 ms": `expected 15.99 to be less than 10`) e `tests/sweep-fs-git-parse.test.ts` noutra. Rodados isolados, passam; o `hook-bridge` sozinho deu 2 verdes e 1 vermelho em 3 rodadas, o que indica instabilidade de tempo com a máquina carregada. A terceira rodada completa saiu toda verde.
- `npm run typecheck` → `tsc --noEmit -p tsconfig.json`, sem erro (exit 0). O `tsconfig` inclui `tests/`, então os specs também passam pelo typecheck.
- `npm run build` → `✓ built in 28.14s`, exit 0.
- Smoke da fatia + Ligação: `npx playwright test -c tests/smoke/playwright.config.ts mindscape-desenho mindscape-links` → `2 passed (2.1m)`.
- Smoke dos vizinhos: `npx playwright test -c tests/smoke/playwright.config.ts mindscape tabs-v3 empty-state` → `8 passed, 1 failed (4.6m)`. Os 6 smokes do Mindscape (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`, `-desenho`) e o `tabs-v3` passaram. A falha foi no `afterAll` do `empty-state.spec.ts` (`"afterAll" hook timeout of 30000ms exceeded` ao fechar o app), que não abre o Mindscape. Rodado de novo sozinho: `2 passed (25.6s)`.
- O repo não tem script de lint. É lacuna conhecida e não montei um.

## Plano de testes, item a item

- vitest `parseMindscapeDoc` de um v1 (`tests/fixtures/mindscape/v1-sample.json`) sai com `drawings: []`, `zoom: 1` e versão 2 ✔; o store lê o v1 e grava v2 ✔
- vitest: desenho com cor fora das 3, espessura desconhecida, número não finito ou `w`/`h` ≤ 0 cai ✔ (mais: linha sem `arrow`, tipo desconhecido, id vazio, lixo)
- vitest `addDrawing` normaliza caixa desenhada de baixo para cima ✔ (mais: id repetido, quadro ausente, inválido → mesmo documento; outros quadros intocados)
- vitest `addLink` sem `arrow` nasce com seta ✔, com `arrow: false` nasce sem ✔
- vitest `screenToWorld(worldToScreen(p))` volta a `p` ✔ (4 visões, inclusive zoom 2,5 e 0,25)
- vitest `clampZoom` prende em 0,25 e 4 ✔
- vitest `cardAtPoint` devolve o de cima na sobreposição ✔ e `null` no fundo ✔ (borda conta como dentro)
- vitest `mindscapeShortcut` mapeia as letras sem diferenciar maiúscula ✔, devolve `null` com `Ctrl`/`Alt`/`Meta` ✔ e com `editable` ✔
- vitest: store fica read-only com `schemaVersion` 3 ✔
- smoke: `R` → a barra marca "Retângulo" ✔; arrastar no fundo → retângulo aparece e a ferramenta volta para `V` ✔
- smoke: `O`, `L` e `A` com uma ponta fora de post-it → elipse, linha e seta soltas gravadas em `drawings` ✔ (`[rect, ellipse, line/false, line/true]` no arquivo; a `A` saiu do post-it do dono para o fundo)
- smoke: Dourado e Grosso antes de `R` → retângulo com `donel-accent`/`thick` na tela e no arquivo ✔
- smoke: `A` do post-it do dono ao da sessão → Ligação com `data-arrow="true"`, `from`/`to` certos, gravada, e nada novo em `drawings` ✔; o cartão de sessão não ficou selecionado ✔
- smoke: `L` entre os mesmos dois → nada novo ✔
- smoke: botão "Ligar" ausente ✔
- smoke: `Esc` no meio do gesto (com a prévia na tela) → prévia some, nada criado, ferramenta em `V` ✔
- smoke: "Novo post-it" abre em edição e o texto "rascunho" entra inteiro (o `r` foi para o campo, não para a ferramenta) ✔
- smoke: relançar o app → os 5 desenhos voltam (o último ainda Dourado) e `drawings`/Ligação/`schemaVersion: 2` do arquivo iguais aos de antes ✔
- smokes da V1 verdes ✔ (acima)
- Conferi o print do smoke (`mindscape-desenho-formas.png`): retângulo, elipse, linha, seta solta saindo do post-it e o retângulo dourado grosso, em traço à mão; a barra mostra "Seleção V" pressionada, Dourado e Grosso marcados.

## Dados necessários (seed)

Não há banco. O spec monta um root temporário com `atlas/CLAUDE.md`, `config.json` com `projectRoots`, `DONEL_MINDSCAPE_FILE` temporário e o roteiro `slow-turn.json` do claude falso. O post-it do dono é criado pelo próprio smoke. Para o vitest, a amostra v1 está em `tests/fixtures/mindscape/v1-sample.json`.

## O que ficou sem verificar

- **Ligação visível depois de relançar**: no relançamento a aba da sessão não volta aberta, então a Ligação fica guardada e não é desenhada (regra da V1). O smoke confere a Ligação no arquivo, não na tela, depois do relançamento.
- O smoke não mede o cursor por ferramenta (`crosshair`/`grab`) nem a dica de cada ferramenta; ficam para a olhada no alfa.
- `H` não tem passo de smoke próprio nesta fatia (o plano não pede); o caminho é o mesmo `pan` da V1, que o `mindscape-canvas` cobre com `V`.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.

## Notas fora do escopo (candidatas a item)

- Testes de tempo instáveis com a máquina carregada: `hook-bridge.contract.test.ts` (limite de 10 ms), `sweep-fs-git-parse.test.ts`, `chat-transcript-io.test.ts`; e o `afterAll` do `empty-state.spec.ts`.
- A seta solta que sai de dentro de um post-it começa no centro dele, escondida sob o cartão (desenho fica sempre abaixo dos post-its, regra do refinamento); visualmente parece sair da borda.

## Próxima etapa

Fatia 02 (`Ctrl+Z`/`Ctrl+Shift+Z`), que depende desta. Ela leva os callbacks da V1 para o `onAction` e liga o histórico.
