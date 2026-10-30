# /implementacao — Mindscape desenho, fatia 06

**Fatia**: 06 — Print colado ou arrastado para o quadro
**Data**: 2026-10-30 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`images.ts`, `src/main/mindscape-images.ts` com fs injetado, parse do tipo `image`, hit-test, laço, `resizeDrawing`, `eraseBoard` e reducers com print) + `teste-depois` (tela, por smoke)
**Fatias anteriores lidas**: `handoffs/mindscape-desenho-implementacao-01.md` a `-05.md`.

## Decisões tomadas no caminho

Todas **decididas por delegação do dono (2026-10-30)**: rodada autônoma, sem humano para perguntar. Critério: a opção mais simples coerente com o design. Nenhuma muda regra do refinamento.

- **O renderer aceita PNG, JPEG, WebP e GIF; o main guarda só PNG, JPEG e WebP.** O GIF vira PNG do primeiro quadro no renderer (`createImageBitmap` → canvas → `toBlob`), como o design pede, e por isso o padrão do `imageId` não tem `.gif`. Um GIF mandado direto ao main é recusado com `type`.
- **Outros erros do print também avisam na faixa de dica.** O design só nomeia "Imagem grande demais (limite de 10 MB)". Imagem que não decodifica ou falha ao gravar (`not-image`, `type`, `write-failed`) mostra "Não foi possível colar a imagem". O aviso fica 6 segundos e some sozinho. Um arquivo que não é imagem (texto, PDF) é ignorado em silêncio: o `Ctrl+V` de texto no quadro segue sem efeito.
- **O limite de 10 MB é conferido três vezes**: no tamanho do arquivo colado (antes de decodificar), nos bytes que vão ao main (o PNG de um GIF pode crescer) e de novo no main.
- **Só o primeiro arquivo de imagem de um `drop` (ou de um `paste`) vira print.** Soltar vários de uma vez não está no refinamento. Se fizer falta no alfa, vira item.
- **O print colado não fica selecionado.** A seleção e a ferramenta ativa continuam como estavam. O smoke clica no print para selecioná-lo, o que também prova o hit-test pela área.
- **A alça do print mantém a proporção pela maior das duas mudanças**: a caixa sempre alcança o ponteiro. O mínimo de 4 unidades vale no lado menor (um print 2:1 não fica menor que 8 × 4). Cruzar o canto fixo vira a caixa como no retângulo; a imagem não espelha.
- **O hit-test do print usa a área com folga de 6 px de tela**, como os outros desenhos (folga dividida pelo zoom, sem traço). Na borracha, o print sai quando um círculo dela toca a área (raio de 8 px de tela, sem tinta somada).
- **A limpeza no boot só toca nomes no padrão do `imageId`.** Qualquer outro arquivo na pasta fica. Ela lê os `imageId` do JSON cru, sem passar pelo parse (`referencedImageIds` aceita qualquer coisa): um print que o parse descartaria por outro motivo ainda protege o arquivo dele. Documento sem `boards` conta como inválido e não limpa.
- **A limpeza roda logo depois de registrar os canais**, sem esperar a janela, e não segura o boot (assíncrona, erro engolido). Arquivo que não sai fica para o próximo boot.
- **O `paste` é ouvido pelo `MindscapeBoard`, não pela `MindscapeScreen`.** O quadro sabe o último ponto do mouse sobre ele, o tamanho da visão e a visão atual. O design diz "paste no document e drop na tela"; o listener segue no `document` e só existe com um quadro montado. O `drop` fica no elemento do quadro.
- **O print nasce no último ponto do mouse sobre o quadro**, guardado no `pointermove` do quadro e mantido depois que o mouse sai dele. Sem ponto conhecido (o mouse nunca passou pelo quadro), nasce no meio da visão.
- **Tipo `InkDrawing`** (`MindscapeDrawing` sem o print) em `model.ts`, para as funções que pedem cor e espessura (`drawingShape`, a prévia do desenho). `strokeWidthOf(drawing)` em `drawings.ts` devolve 0 para o print e substitui `STROKE_WIDTH[drawing.stroke]` no hit-test, na borracha e no contorno da seleção.
- **O quadro marca o estado do arquivo** em `data-image-status` (`loading`, `ready`, `missing`) e o `imageId` em `data-image-id`, para o smoke ler sem depender de pixel.

## O que foi feito

- `src/shared/mindscape/images.ts` (novo): `IMAGE_ID_PATTERN`/`isImageId`, `MAX_PRINT_BYTES` (10 MB), `PRINT_MAX_WIDTH` (480), `ORPHAN_MIN_AGE_MS` (1 hora), `isPrintInputType`/`isPrintStoredType`, `fitImage`, `imageBoxAt`, `referencedImageIds`.
- `src/shared/mindscape/model.ts`: tipo `image` no `MindscapeDrawing` (sem cor nem espessura), `InkDrawing`, `parseDrawing` aceitando print com `imageId` no padrão e caixa positiva.
- `src/shared/mindscape/drawings.ts`: `strokeWidthOf`; `setDrawingsStyle` pula o print. `addDrawing`, `moveItems`, `removeItems`, camadas e `translateDrawing` já serviam.
- `src/shared/mindscape/geometry.ts`: print no `distanceToDrawing` pela área (0 dentro), `hitTestDrawings` com `strokeWidthOf`, `resizeDrawing` com proporção mantida. `drawingBounds` e o laço já serviam.
- `src/shared/mindscape/eraser.ts`: o print sai quando a borracha toca a área.
- `src/shared/mindscape/channels.ts`: canais `mindscape:save-image` e `mindscape:read-image`, tipos dos payloads e dos retornos, `saveImage`/`readImage` na API.
- `src/main/mindscape-images.ts` (novo): `mindscapeImagesDir` (ao lado do `mindscape.json`), `createMindscapeImages` com `save`, `read` e `sweepOrphans`, fs injetado (`nodeMindscapeImagesFs` é o padrão). Reusa `looksLikeImage` e `extensionFor` de `src/main/chat/attachments.ts` só por import.
- `src/main/index.ts`: os dois handlers e a limpeza no boot dentro de `registerMindscapeIpcHandlers`.
- `src/preload/index.ts`: `window.donel.mindscape.saveImage`/`readImage`.
- `src/renderer/src/Mindscape/useMindscapeImage.ts` (novo): `useMindscapeImages` (cache de `blob:` por `imageId`, revogado quando o Mindscape desmonta, `missing` quando o main não devolve) e `preparePrint` (decodifica, mede, GIF → PNG).
- `src/renderer/src/Mindscape/MindscapeBoard.tsx`: `paste` no `document` (alvo editável filtrado), `dragover`/`drop` no quadro, último ponto do mouse, prop `onImageFile(file, at)`.
- `src/renderer/src/Mindscape/MindscapeScreen.tsx`: `handleImageFile` (limites, decodificação, `saveImage`, `fitImage`, `addDrawing` numa entrada de histórico), aviso na faixa de dica.
- `src/renderer/src/Mindscape/MindscapeDrawingLayer.tsx`: `<image>` dentro do SVG de desenhos (obedece à camada), caixa tracejada "imagem não encontrada", placeholder enquanto carrega.
- `src/renderer/src/Mindscape/MindscapeSelectionLayer.tsx` e `roughShapes.ts`: tipos (o print tem as 4 alças de canto; `drawingShape` só recebe desenho com tinta).
- `src/renderer/src/Mindscape/Mindscape.module.css`: estilos da caixa tracejada e do placeholder.

Nada mudou em `src/main/accounts/`, em `src/main/chat/attachments.ts` (só importado), no Modo Dev, no `config.json` nem no `schemaVersion`: o tipo `image` já fazia parte da v2 desenhada, e a v2 nunca saiu desta branch. Ver "Notas fora do escopo". A CSP já tinha `img-src … blob:`. Nenhuma dependência npm entrou.

### Testes existentes alterados (e por quê)

- `tests/mindscape-drawings.test.ts`: no caso de `setDrawingsStyle` que já existia, `drawing.color`/`drawing.stroke` passaram a ler `(drawing as InkDrawing)`, porque o print não tem esses campos e o `tsc` recusava. Só o tipo mudou; as afirmações são as mesmas. Casos novos no fim.
- `tests/mindscape-model.test.ts`, `tests/mindscape-geometry.test.ts`, `tests/mindscape-eraser.test.ts`: só casos novos.
- `tests/smoke/mindscape-desenho.spec.ts`: `test` novo da fatia 06, helpers `writeClipboardImage` e `dropImageFile`, `imageId` no tipo `SavedDrawing`, `existsSync`/`utimesSync` no import. Os testes 01–05 não mudaram.
- Nenhum smoke da V1 foi tocado. Nenhum gesto que eles usam mudou.

## Vermelho → verde (vitest, test-first)

Antes do código (`npx vitest run tests/mindscape-images.test.ts tests/mindscape-images-main.test.ts tests/mindscape-model.test.ts tests/mindscape-geometry.test.ts tests/mindscape-eraser.test.ts tests/mindscape-drawings.test.ts`):

```
FAIL tests/mindscape-images-main.test.ts [ tests/mindscape-images-main.test.ts ]   (módulo inexistente)
FAIL tests/mindscape-images.test.ts [ tests/mindscape-images.test.ts ]             (módulo inexistente)
FAIL tests/mindscape-drawings.test.ts > the print in the reducers > … (3)
FAIL tests/mindscape-eraser.test.ts > the print under the eraser > … (1)
FAIL tests/mindscape-geometry.test.ts > the print in the geometry > … (4)
FAIL tests/mindscape-model.test.ts > parseMindscapeDoc — print > … (3)
Test Files  6 failed (6)
Tests  11 failed | 91 passed (102)
```

Depois: `npx vitest run tests/mindscape` → `Test Files 14 passed (14)`, `Tests 230 passed (230)`.

## Gates (saída observada, 2026-10-30)

- `npx vitest run`: `Test Files 1 failed | 218 passed (219)`, `Tests 2 failed | 5095 passed (5097)`. As 2 falhas são de `tests/esteiraContractPackageLocation.test.ts`, a falha ambiental conhecida (varre `.claude/worktrees/`, não versionado). Nenhum teste de tempo falhou nesta rodada.
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json` sem erro (inclui `tests/`, então o spec do smoke também).
- `npm run build`: `✓ built in 7.02s`.
- Smoke da fatia, sozinho: `-g "desenho 06"` → `1 passed`, de primeira, com `DONEL_SMOKE_SHOTS_DIR` (print conferido: o print 600 × 300 colado nasce com 480 de largura, sob o mouse, abaixo do post-it de sessão).
- `npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/mindscape`: **`11 passed (1.6m)`**. São a V1 (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`) e o desenho 01 a 06.
- Lint: o repo não tem script de lint (lacuna conhecida).

## Plano de testes, item a item

- vitest: o padrão aceita `img-<base36>-<8 hex>.png` ✔ (e `.jpg`, `.webp`) e recusa `..` ✔, separador ✔ e extensão fora da lista ✔. A mais: maiúscula, 7 hex, base36 vazia, espaço no fim, marca de drive, não-string.
- vitest: `fitImage` limita a 480 mantendo a proporção ✔. A mais: imagem menor fica no tamanho natural, arredonda a 0,1, tamanho não positivo ou não finito dá `null`; `imageBoxAt` centra a caixa.
- vitest: `referencedImageIds` junta os de todos os quadros ✔. A mais: ignora `imageId` fora do padrão e lixo; mantém o de um print que o parse descartaria por outro motivo.
- vitest: `save` recusa tipo fora da lista ✔ (GIF, SVG, ausente), mais de 10 MB ✔ (e aceita exatamente 10 MB), bytes que não são imagem ✔ (e vazios, e payload sem bytes), e grava com nome no padrão ✔ (`ArrayBuffer` e `Uint8Array`, `.png`/`.jpg`/`.webp`). A mais: falha de escrita dá `write-failed`.
- vitest: `read` recusa `imageId` fora do padrão ✔ sem tocar o disco (fs espionado). A mais: devolve bytes e tipo do arquivo gravado; arquivo ausente dá `ok: false`.
- vitest: `sweepOrphans` apaga só o não referenciado com mais de 1 hora ✔ e não roda com documento ausente ✔, inválido ✔ ou de versão maior ✔. A mais: documento v1 limpa os órfãos antigos; nome fora do padrão nunca é tocado; pasta ausente não é erro.
- vitest: o parse descarta print com `imageId` fora do padrão ✔. A mais: ida e volta sem cor nem espessura, só os campos conhecidos, caixa ≤ 0 e número não finito caem.
- vitest: `resizeDrawing` mantém a proporção do print ✔ (pelos cantos `se` e `nw`), com mínimo de 4 no lado menor; alça de linha não muda o print.
- vitest: `eraseBoard` tira o print tocado ✔, inclusive no meio e logo fora da borda dentro do raio; longe, fica.
- vitest (a mais): o hit-test acerta o print pela área toda e erra fora da folga; um desenho por cima vence; laço só com o print inteiro dentro; `addDrawing` recusa `imageId` ruim; `moveItems` move o print; `setDrawingsStyle` pula o print; `removeItems` o tira.
- smoke: `clipboard.writeImage` pelo `electronApp.evaluate` + `Ctrl+V` no quadro → o print aparece perto do mouse ✔ (centro a menos de 1 unidade do ponto do mouse no arquivo e a menos de 2 px na tela, 480 × 240 a partir de 600 × 300) e o arquivo existe em `mindscape-images/` ✔. O `paste` chega ao `document` com o foco na `<section>` do Mindscape: a dúvida do design ("a confirmar no smoke") fica respondida.
- smoke: `Delete` → some ✔ (o arquivo continua); `Ctrl+Z` → volta ✔ (arquivo ainda lá, imagem carregada, com o tamanho de antes do `Delete`).
- smoke: relançar → o print continua ✔ (os dois, com o arquivo lido de novo), o órfão antigo plantado sumiu ✔ e o recente ficou ✔. A mais: no primeiro boot, sem `mindscape-06.json`, o órfão antigo ainda estava lá (documento ausente não limpa).
- smoke: arrastar a alça → a proporção se mantém ✔ (canto `se` puxado 120 × 10 px: 480 × 240 vira 600 × 300, canto oposto parado).
- smoke (a mais, o BACKLOG deixava para o alfa se não desse): o `drop` de arquivo deu para gerar. Um PNG de 120 × 80 desenhado num canvas pelo teste, solto com `DataTransfer` + `DragEvent` sintéticos, nasce centrado no ponto do drop no tamanho natural, com o arquivo gravado.
- smoke (a mais): a recusa de mais de 10 MB também deu. Uma imagem de ruído de 2.500 × 2.500 no clipboard vira um PNG acima de 10 MB no `paste`, a faixa de dica mostra "Imagem grande demais (limite de 10 MB)" e nada entra no quadro.

## Dados necessários (seed)

Não há banco. O spec reaproveita o root temporário (`atlas/CLAUDE.md`, `config.json` com `projectRoots`). O `mindscape-06.json` é próprio, apontado por `DONEL_MINDSCAPE_FILE`, com o roteiro `slow-turn.json` do claude falso. A pasta `mindscape-images/` ao lado dele é limpa e recebe, antes do boot, dois órfãos com cabeçalho PNG: `img-1-0000000a.png` com `mtime` de 2 horas atrás e `img-2-0000000b.png` recente. As imagens coladas são bitmaps gerados no main (`nativeImage.createFromBitmap`) e a solta é um canvas do próprio teste. Nenhuma foto real, nenhuma fixture nova.

## O que ficou sem verificar

- **Arrastar um arquivo de verdade do Explorer.** O smoke usa `DragEvent` sintético com `DataTransfer`. O caminho do código é o mesmo, mas o drag nativo do SO não passou por ele. Conferir no alfa.
- **GIF colado ou solto.** A conversão para PNG (`preparePrint`) não tem passo de smoke nem vitest (precisa de `createImageBitmap` e canvas). Conferir no alfa com um GIF.
- **Caixa tracejada "imagem não encontrada".** Não há passo de smoke que apague o arquivo de um print referenciado e relance. A lógica é curta (o main devolve `ok: false`, a tela marca `missing`), mas não foi vista na tela.
- **Print com zoom diferente de 100%.** O ponto de nascimento passa por `screenToWorld` com a visão atual, mas o smoke só cola a 100%.
- **Print colado por outro app** (Paint, navegador, ferramenta de recorte do Windows). O smoke usa `clipboard.writeImage`. O formato que cada app põe no clipboard pode variar (o Chromium entrega como `image/png`).
- **Imagem com orientação EXIF** (foto de celular). O `createImageBitmap` e o `<image>` do SVG respeitam a orientação por padrão no Chromium, mas não medi.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.

## Notas fora do escopo (candidatas a item)

- **`schemaVersion` segue 2, e está certo assim.** O gotcha do `CLAUDE.md` ("campo novo sobe o `schemaVersion`") pediria atenção: um build com a v2 das fatias 01–05 descartaria o print no parse (tipo desconhecido) e gravaria por cima. Conferi que nenhum canal instalado tem essa v2: o `origin/staging` ainda está em `MINDSCAPE_SCHEMA_VERSION = 1` (2026-10-30), e as 6 fatias sobem juntas num PR só. O tipo `image` já fazia parte da v2 no design. O risco fica só para builds locais desta branch. Se alguma fatia anterior for promovida sozinha um dia, subir para 3 antes de promover esta.
- Seletor de arquivo, tecla de print, print animado e SVG seguem fora pelo design.
- Soltar ou colar vários arquivos de uma vez (hoje só o primeiro entra).
- O print colado poderia nascer selecionado (como no Excalidraw), para mover ou apagar logo em seguida.
- A faixa de dica corta o texto com reticências em janela estreita; um aviso longo pode ficar cortado.

## Próxima etapa

As 6 fatias do `mindscape-desenho` estão implementadas na `feature/mindscape-desenho`. Segue a `/revisao` da branch inteira contra o refinamento, no produto real (alfa), antes de abrir o PR para `staging`.
