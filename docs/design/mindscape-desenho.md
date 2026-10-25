---
demanda: mindscape-desenho
plano:
refinamento: docs/refinamentos/mindscape-ligar-rabisco-zoom.md
data: 2026-10-24
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
autor: Claude por delegação de Alexandre Lentz
self-assessment: apto  # decidido por delegação do dono, 2026-10-24
complexidade: —
status: aprovado
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-24 ("vai fundo")
aprovado-em: 2026-10-24
champions-post: "não postado — repo pessoal fora da Seazone (xansde/donel-dev), sem canal; decidido por delegação do dono"
adrs: []  # ADR 0004 confirmado, com nota de 2026-10-24 em "Consequências"
---

# Design — Mindscape: desenho, print, Ctrl+Z e zoom

## Demanda

Segunda entrega do Mindscape, sobre a V1 em `staging` (PR #114): barra de ferramentas de
desenho com atalho de uma tecla (`V H A L R O P E`), print colado, seta/linha de post-it a
post-it virando **Ligação**, seleção múltipla, borracha que apaga o pedaço tocado,
`Ctrl+Z`/`Ctrl+Shift+Z`, camadas livres entre **Desenhos** e zoom de 25% a 400% salvo por
quadro. Fonte de verdade do comportamento: [refinamento](../refinamentos/mindscape-ligar-rabisco-zoom.md).
Base: [design da V1](mindscape.md), [ADR 0004](../adr/0004-base-do-quadro-mindscape.md),
[glossário](../glossario.md), [versões](../versoes/mindscape.md).

> Todas as decisões abaixo foram **decididas por delegação do dono, 2026-10-24** ("Vai
> fundo"). Critério: a opção mais simples que cumpre o refinamento, sem generalização
> especulativa. Nenhuma regra do refinamento foi alterada. Topologia, região e domínio não se
> aplicam: app desktop local, sem servidor.

## Decisões

### Base do quadro: ADR 0004 confirmado

- **O quadro próprio continua.** A demanda acende 3 dos 4 gatilhos de reabertura (rabisco,
  formas e prints; texto livre ficou fora por decisão do dono), mas o critério que decidiu o
  ADR, o **Post-it de sessão** vivo (glifo, pulso e destaque a cada evento do semáforo,
  duplo clique que leva ao terminal), não mudou. Trocar para o Excalidraw agora jogaria fora
  a V1 inteira e ainda deixaria o post-it vivo sem solução. O que esta entrega pede cabe no
  que já existe: uma camada SVG a mais sob os cartões, desenhada com o `roughjs` que já está
  no app. Nota registrada em "Consequências" do ADR 0004.
- **Nenhuma dependência nova.** O Rabisco é um `path` SVG suavizado (curvas quadráticas pelos
  pontos médios, `stroke-linecap/linejoin: round`), gerado por função pura. O
  `perfect-freehand@1.2.3` (MIT, 112.085 bytes desempacotado, sem dependências, publicado em
  2026-02-01, medido com `npm view` em 2026-10-24) **não entra**: o refinamento não pede traço
  com pressão nem espessura variável, e o traço dele é um polígono preenchido, o que
  complicaria a borracha parcial (ela corta a linha de pontos). Fica como candidato se o
  traço parecer "chapado" no alfa.

### Modelo de dados (`src/shared/mindscape/model.ts`)

```ts
type MindscapeDoc = { schemaVersion: 2; boards: Record<string /* projectPath */, MindscapeBoard> };

type MindscapeBoard = {
  projectPath: string;
  pan: { x: number; y: number };   // px de tela, como na V1
  zoom: number;                    // 0.25 a 4; 1 = 100%
  cards: Record<string, MindscapeCard>;      // inalterado
  links: MindscapeLink[];                    // inalterado
  drawings: MindscapeDrawing[];              // ordem do array = camada (0 = mais ao fundo)
};

type DrawingColor = OwnerCardColor;          // 'none' | 'accent' | 'donel-accent'
type DrawingStroke = 'thin' | 'medium' | 'thick';

type MindscapeDrawing =
  | { kind: 'pencil';  id: string; color: DrawingColor; stroke: DrawingStroke; points: number[] } // [x0,y0,x1,y1,…]
  | { kind: 'line';    id: string; color: DrawingColor; stroke: DrawingStroke; arrow: boolean;
      x1: number; y1: number; x2: number; y2: number }
  | { kind: 'rect';    id: string; color: DrawingColor; stroke: DrawingStroke; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; id: string; color: DrawingColor; stroke: DrawingStroke; x: number; y: number; w: number; h: number }
  | { kind: 'image';   id: string; imageId: string; x: number; y: number; w: number; h: number };
```

- **Coordenadas do quadro**: todo desenho mora em unidades do quadro, as mesmas de `card.x/y`.
  O zoom não altera o que está salvo, só a visão.
- **`A` e `L` soltas são um tipo só** (`line` com `arrow`), como a Ligação já é. A borracha
  parte uma seta em pedaços, e só o pedaço que mantém a ponta original continua com seta.
- **Rabisco** guarda pontos achatados (`number[]`, arredondados a 0,1), com amostra mínima de
  2 unidades entre pontos e teto de 5.000 pontos por traço. Retângulo e elipse guardam a caixa
  (`w`/`h` sempre positivos, normalizados pelo reducer) e são sempre vazados (regra do
  refinamento, sem campo de preenchimento). Print não tem cor nem espessura.
- **Cor**: as 3 do post-it do dono, com os mesmos tokens (`STRIPE_BY_TOKEN`: `none` vira
  `currentColor`, que acompanha o tema). **Espessura** em unidades do quadro: fino 1,5, médio
  3, grosso 5. O estilo atual da barra (padrão: Sem cor, médio) vive só em memória.
- **Camadas**: a ordem livre vale só entre desenhos (array `drawings`). A pilha na tela é fixa:
  desenhos → ligações → post-its → contorno dos post-its. Post-it fica sempre por cima.
- **`schemaVersion` sobe para 2.** O acréscimo **não** é aditivo seguro: o `parseMindscapeDoc`
  da V1 descarta campos que não conhece. Um canal com a V1 (um alfa antigo instalado, ou um
  beta futuro promovido sem esta entrega) abriria o arquivo, perderia `drawings` e `zoom` no
  parse e **gravaria por cima**, apagando os desenhos. Com a versão 2, esse canal cai na
  guarda que já existe (`isNewerSchema`): lê e não grava. Hoje só o alfa tem Mindscape (o
  `origin/main` não tem nenhum arquivo `mindscape`, conferido em 2026-10-24), então o custo
  prático é nulo e a proteção fica para quando os canais divergirem.
- **`parseMindscapeDoc` tolerante**: aceita versão 1 e 2. Da 1 sai `drawings: []` e
  `zoom: 1`. Zoom inválido ou fora da faixa é corrigido para o limite (`clampZoom`). Desenho
  inválido cai sozinho, como cartão e ligação já caem: cor fora das 3, espessura
  desconhecida, número não finito, `points` ímpar ou com menos de 2 pontos, `w`/`h` ≤ 0,
  `imageId` fora do padrão (ver Print). Grava sempre a versão 2.
- **Reducers novos (puros, vitest)**, todos devolvendo o mesmo objeto quando nada muda:
  `addDrawing`, `updateDrawing` (redimensionar/editar alças), `moveItems(ids, dx, dy)` (cartões
  e desenhos de uma vez), `removeItems(ids)` (desenho sai; post-it do dono e escrito pela sessão
  saem por `archiveCard`; post-it de sessão é ignorado), `setDrawingsStyle(ids, {color?, stroke?})`
  (ignora print), `bringToFront(ids)` / `sendToBack(ids)` (mantêm a ordem relativa do grupo),
  `setBoardView(path, {pan, zoom})` (substitui `setBoardPan`). `addLink` ganha `arrow` no
  `LinkInput` (padrão `true`, para não mudar a V1).
- Arquivo grande: os reducers de desenho vão para `src/shared/mindscape/drawings.ts`; os
  tipos ficam em `model.ts`, que é quem o `parseMindscapeDoc` e o store importam.

### Ligação desenhada com `A`/`L`

- O gesto de `A`/`L` grava o cartão sob o ponteiro no `pointerdown` e no `pointerup`, por
  hit-test **puro**: `cardAtPoint(point, rects)`, com os retângulos que a tela já mede
  (`useCardSizes` + posição), percorridos do último desenhado para o primeiro.
- As duas pontas em post-its **diferentes** → `addLink({ id, from, to, arrow: tool === 'A' })`.
  Par já ligado → nada acontece (o `addLink` já devolve o mesmo documento). As duas pontas no
  **mesmo** post-it → nada é criado (a linha ficaria escondida sob o cartão). Alguma ponta fora
  de post-it → `addDrawing` de uma `line` solta. Gesto menor que 4 px de tela → descartado.
- Alça de ponta de uma linha solta **nunca** a converte em Ligação, mesmo se soltar sobre um
  post-it: a conversão só existe no gesto de desenhar (regra do refinamento, lida literalmente).
- **Sai do modo "Ligar"**: o botão "Ligar", o estado `linking`/`linkOrigin`, o `pickForLink`
  (`onClickCapture` e `onDoubleClickCapture` da tela), o texto de dica do modo e
  `data-linking` (CSS de cursor incluso). **Fica**: clicar na Ligação seleciona, e a barra
  mostra "Seta" (liga/desliga) e "Remover ligação"; `Delete` com a Ligação selecionada também
  remove.

### Print

- **Entrada**: `paste` (`Ctrl+V`) e `drop` de arquivo no Mindscape, com o foco fora de campo de
  texto. Aceita `image/png`, `image/jpeg`, `image/webp` e `image/gif`; mais de 10 MB é recusado
  com aviso na faixa de dica da barra ("Imagem grande demais (limite de 10 MB)"). Nasce
  centrado no último ponto do mouse sobre o quadro (no `drop`, o ponto do drop; sem ponto
  conhecido, o centro da visão), com largura `min(larguraNatural, 480)` e proporção mantida.
- **GIF estático**: o renderer decodifica o primeiro quadro (`createImageBitmap`) e grava como
  PNG. O print não anima.
- **Onde mora o binário**: `<userData>/mindscape-images/<imageId>`, ao lado do
  `mindscape.json` (no smoke, ao lado do arquivo de `DONEL_MINDSCAPE_FILE`). O JSON guarda só o
  `imageId`. O nome é gerado pelo main, `img-<tempo base36>-<8 hex>.<png|jpg|webp>`; o
  renderer nunca escolhe nome nem caminho.
- **IPC novo** (`src/shared/mindscape/channels.ts`, `window.donel.mindscape`):

| Canal | Direção | Payload | Retorno |
|---|---|---|---|
| `mindscape:save-image` | renderer → main (invoke) | `{ bytes: ArrayBuffer; mediaType: string }` | `{ ok: true; imageId: string } \| { ok: false; reason: 'type' \| 'too-big' \| 'not-image' \| 'write-failed' }` |
| `mindscape:read-image` | renderer → main (invoke) | `imageId: string` | `{ ok: true; bytes: Uint8Array; mediaType: string } \| { ok: false }` |

- O main valida tudo de novo: tipo na lista, ≤ 10 MB, número mágico (reusa `looksLikeImage`
  e `extensionFor` de `src/main/chat/attachments.ts`, sem mexer nele), e `imageId` casando
  `^img-[0-9a-z]+-[0-9a-f]{8}\.(png|jpg|webp)$` antes de montar qualquer caminho (sem
  separador, sem `..`). O mesmo padrão é a regra do `parseMindscapeDoc` para `imageId`.
- **Como a tela exibe**: o renderer pede os bytes por `mindscape:read-image`, cria um `Blob` e
  um `URL.createObjectURL`, guardados num cache por `imageId` enquanto a tela do Mindscape está
  montada e revogados quando ela desmonta. A imagem entra como `<image href>` dentro do SVG de
  desenhos, para obedecer à ordem de camada. A CSP atual já permite `img-src … blob:`
  (`src/renderer/index.html`), e a janela segue `contextIsolation: true`, `sandbox: true`, sem
  `nodeIntegration`. Nada muda na segurança. Arquivo sumido → caixa tracejada "imagem não
  encontrada" no lugar, que o dono pode apagar.
- **Por que não um protocolo**: o `donel-asset:` existente só é registrado com
  `chat.enabled = true` (`registerChatDomain`) e é do domínio do chat. Um esquema próprio
  exigiria mexer no registro privilegiado de esquemas, feito antes do `app.ready`. O
  caminho IPC + `blob:` não toca em nada disso, e o volume (poucos prints de até 10 MB por
  quadro) não pede streaming.
- **Limpeza de órfãos na abertura**: no boot, depois de registrar o IPC, o main lê o
  `mindscape.json` cru, junta os `imageId` de todos os quadros (`referencedImageIds`, pura) e
  apaga da pasta o que não é referenciado **e** tem `mtime` de mais de 1 hora. A limpeza **não
  roda** se o arquivo estiver ausente, inválido ou com `schemaVersion` maior que a conhecida:
  um parse vazio apagaria todos os prints. A margem de 1 hora protege um print recém-colado
  por outro canal aberto ao mesmo tempo, que ainda não gravou o JSON. Nunca há limpeza durante
  a execução, para o `Ctrl+Z` poder trazer o print de volta (regra do refinamento).

### Ctrl+Z / Ctrl+Shift+Z

- **Forma: snapshot do quadro, com fusão dos fatos da sessão.** Cada ação do dono grava
  `{ before: MindscapeBoard, after: MindscapeBoard }` do quadro tocado. Os reducers são
  imutáveis, então o snapshot compartilha estrutura e custa pouco. Comando com inversa por
  ação foi descartado: seriam ~15 inversas, cada uma com seus próprios bugs.
- **Um evento da sessão nunca "volta" com um undo.** Desfazer aplica
  `mergeSessionFacts(snapshot, current)` (pura): parte do `before` e traz do quadro atual o que
  é da sessão. Post-it de sessão que existe no atual e não no snapshot é mantido. Post-it
  escrito pela sessão fica com `text`, `writtenAt` e `sessionName` do atual (a posição vem do
  snapshot) e, se não existia no snapshot, é mantido inteiro. `pan` e `zoom` vêm do atual.
  Ligações cujo cartão não existe no resultado são descartadas. Refazer aplica a mesma função
  com o `after`.
- **Duas portas no `useMindscapeDoc`**: `apply(projectPath, reducer)` para ação do dono, que
  grava no histórico, e `applySession(reducer)` para evento da sessão (`placeSessionCard`,
  `writeSessionNote`), que não grava. `setBoardView` (pan, zoom) usa a porta que não grava:
  mover a visão não é ação no quadro.
- **Um caminho só para as ações do dono**: os callbacks da V1 (`onMoveCard`, `onArchive`,
  `onAddOwnerCard`, `onEditOwnerCard`, `onSetOwnerColor`, `onAddLink`, `onToggleLinkArrow`,
  `onRemoveLink`) e os novos viram um único `onAction(projectPath, reducer)` da tela.
  Com um caminho só, não tem como uma ação nova esquecer de entrar no histórico.
- **Granularidade**: um gesto = uma entrada. Arraste (grava no `pointerup`, como hoje),
  traço inteiro do lápis, passada inteira da borracha, redimensionar, mudar cor/espessura da
  seleção, camada, colar print, editar texto do post-it do dono (grava no `blur`, como hoje).
- **Limite e escopo**: 100 entradas por quadro; ação nova zera o "refazer". Mapa
  `projectPath → { undo, redo }` num `ref` do `useMindscapeDoc`, que vive no `App` e por isso
  sobrevive à troca de modo. Só memória: começa vazio a cada abertura do app. Pilhas e fusão
  em `src/shared/mindscape/history.ts` (pura).
- Durante um gesto em andamento, `Ctrl+Z` é ignorado. Com o foco no texto do post-it, o
  atalho não é tratado (vale o desfazer do campo).

### Borracha parcial e hit-test (puros)

- **`erasePolyline(points, eraser, radius) → number[][]`** (`src/shared/mindscape/eraser.ts`):
  o caminho da borracha é adensado até amostras a cada `radius / 2` e vira uma lista de
  círculos. Para cada segmento do traço, a interseção segmento × círculo (equação de 2º grau)
  dá os intervalos `t` apagados. A união deles, complementada, dá os trechos que ficam, e os
  trechos contíguos entre segmentos se emendam em corridas. Corrida com menos de 2 pontos ou
  comprimento < 1 unidade some. Um pré-filtro por caixa evita custo com traço longe da
  borracha.
- **`eraseBoard(board, eraserPath, radius, newId) → MindscapeBoard`**: Rabisco e linha solta
  perdem o trecho tocado (o primeiro pedaço mantém o `id`, os outros recebem `newId()`,
  injetado para a função seguir pura). Retângulo e elipse saem inteiros quando a borracha
  toca o contorno (são vazados); print sai quando a borracha toca a área dele; Ligação sai
  inteira quando toca o segmento desenhado (`linkEndpoints`, já puro em `roughShapes.ts`, vai
  para `geometry.ts` para o shared não importar do renderer; `roughShapes.ts` passa a
  importá-lo de lá e o re-exporta, para `tests/mindscape-links.test.ts` não quebrar). Post-it
  nunca sai.
- Raio da borracha: 8 px de tela (`8 / zoom` no quadro), com um círculo de prévia no cursor. A
  prévia da passada é local. No `pointerup`, o `eraseBoard` roda de novo sobre o quadro
  **atual** com o caminho inteiro, numa entrada só de histórico, para não atropelar um post-it
  escrito pela sessão durante a passada.
- **Hit-test** (`src/shared/mindscape/geometry.ts`): distância ponto–segmento e
  ponto–polilinha; elipse amostrada em 64 pontos; tolerância `stroke/2 + 6 px de tela`.
  Retângulo e elipse são acertados só perto do contorno (vazados), print pela área toda.
  `hitTestDrawings(drawings, point, tol)` devolve o de cima (percorre do fim do array).
  `itemsInsideRect(rect, cards, drawings)` (laço: só o que fica inteiro dentro, pela caixa).
  `drawingBounds(drawing)`. `resizeDrawing(drawing, handle, point)`: cantos para retângulo,
  elipse e print (print mantém a proporção), pontas para linha solta, tamanho mínimo de
  4 unidades.

### Zoom e visão (`src/shared/mindscape/view.ts`, puro)

- **Transformação**: `tela = quadro × zoom + pan`. `screenToWorld(p, view)`,
  `worldToScreen(p, view)`, `clampZoom(z)` (0,25 a 4), `zoomAt(view, screenPoint, nextZoom)`,
  que mantém fixo o ponto do quadro sob o mouse: `pan' = p − (p − pan) × (z'/z)`. O plano usa
  `transform: translate(pan) scale(zoom)` com `transform-origin: 0 0`, e a grade de pontos do
  fundo acompanha (`background-size` e `background-position`). Os tamanhos medidos dos cartões
  (`offsetWidth`) não sentem a escala do CSS: já saem em unidades do quadro.
- **Roda e pinça**: um listener **nativo, não passivo**, de `wheel` na tela inteira do
  Mindscape, como o do Jobu (`PetApp.tsx:184`; o `onWheel` do React é passivo e não consegue
  `preventDefault`). Com `ctrlKey`, faz `preventDefault` sempre, para a página não dar zoom, e
  aplica `zoomAt` com fator `1,1^(−delta/100)` (delta normalizado por `normalizeWheelDelta` de
  `src/shared/pet/gestures.ts`) se o ponteiro estiver sobre o quadro. Sem `ctrlKey`, a roda
  move a visão na vertical (e `deltaX` na horizontal, para o touchpad), e `Shift+roda`
  move na horizontal. A pinça do touchpad no Chromium chega como `wheel` com `ctrlKey`, e o
  zoom visual vem desligado no Electron: os dois pela documentação, **a medir no smoke e no
  alfa**.
- **Indicador "− 100% +"** no canto inferior do quadro: `−`/`+` andam 10 pontos percentuais
  centrados no meio da visão; clicar no número volta a 100%.
- **Mover a visão**: roda, `H` (arrastar em qualquer lugar, inclusive sobre post-it) ou
  **espaço + arrastar** (em qualquer ferramenta). Com `V`, arrastar o fundo agora é laço.
- Pan e zoom vão por `setBoardView`, com o debounce de 500 ms que já existe, fora do histórico.
  "Novo post-it" passa a calcular o canto visível com `screenToWorld`.

### Ferramentas, seleção e atalhos

- **Estado de tela, não persistido** (`MindscapeScreen`): ferramenta ativa, estilo atual,
  seleção `{ cards: Set, drawings: Set }` e Ligação selecionada (uma, por clique, como hoje).
- **Seleção**: `V` + clique seleciona; `Shift+clique` soma ou tira; arrastar no fundo desenha o
  laço; `Ctrl+A` seleciona os cartões visíveis e todos os desenhos (Ligação não entra no laço
  nem no `Ctrl+A`). Arrastar um item selecionado move a seleção inteira (`moveItems`, uma
  entrada). `Delete` chama `removeItems`. Cor/espessura na barra chamam `setDrawingsStyle` e
  também viram o estilo dos próximos desenhos. Alças só com **um** desenho selecionado
  (retângulo, elipse, print, linha solta); Rabisco não tem alça. "Ir ao terminal" fica ativo
  com exatamente um post-it de sessão selecionado. O duplo clique no post-it de sessão segue
  levando ao terminal com `V`.
- **Depois do desenho**: `A`, `L`, `R` e `O` voltam para `V`; `P` e `E` ficam ativos. `Esc`
  cancela o gesto em curso e volta para `V`.
- **Atalhos em função pura** `mindscapeShortcut({ key, ctrl, shift, alt, meta, editable })
  → MindscapeShortcut | null` (`src/shared/mindscape/shortcuts.ts`). Letras `v h a l r o p e`
  (sem diferenciar maiúscula), só sem `Ctrl/Alt/Meta`; `Delete`; `Escape`; `Ctrl+Z`;
  `Ctrl+Shift+Z` (`key.toLowerCase() === 'z'`); `Ctrl+A`; `Ctrl+Shift+]`/`}` (trazer para
  frente) e `Ctrl+Shift+[`/`{` (mandar para trás), por `event.key` e não `event.code`, porque no
  ABNT2 as posições físicas dos colchetes não batem com o US. Com `editable` verdadeiro
  (`input`, `textarea`, `select`, `contenteditable`), devolve `null`. A barra também tem os
  botões "Trazer para frente"/"Mandar para trás", que valem como caminho garantido.
- **Onde vivem**: `onKeyDown`/`onKeyUp` na `<section>` do Mindscape (`tabIndex={-1}`), que
  recebe o foco ao montar e a cada `pointerdown` no quadro. Os atalhos só existem com o modo
  Mindscape montado e o foco dentro dele. Isso também resolve um furo: os terminais seguem
  montados embaixo, e uma tecla de uma letra com o foco esquecido no xterm iria para a
  sessão. Espaço é segurado no `keydown` (com `preventDefault`) e solto no `keyup`/`blur`. O
  `paste` é ouvido no `document` enquanto a tela está montada (o alvo editável é filtrado),
  porque o Chromium entrega o `paste` ao elemento em foco; **a confirmar no smoke**. O
  listener global do `App` (`Ctrl+1..9`, `Ctrl+Tab`, `` Ctrl+` ``) não colide com esses
  atalhos.
- **Barra** (`MindscapeToolbar.tsx`): grupo de ferramentas com a letra de cada uma e a ativa
  marcada (`aria-pressed`); 3 cores e 3 espessuras; camada (com desenho selecionado); "Seta" e
  "Remover ligação" (com Ligação selecionada); "Novo post-it"; "Ir ao terminal"; faixa de dica
  (avisos do print e ferramenta ativa). A forma segue a barra atual e os tokens do design
  system: **não há protótipo desta entrega**, então a forma se ajusta no alfa.

### Renderização

- `MindscapeDrawingLayer.tsx` (novo): um `<svg>` sob as Ligações, com os desenhos na ordem do
  array. Retângulo, elipse e linha são traço à mão do `roughjs` (`seed` fixo pelo `id`, como
  as Ligações), gerados **em coordenadas locais** e posicionados por `transform`. Assim, o
  arraste não invalida o cache por geometria (mesmo truque do `cardOutlinePath`). Rabisco é
  `pencilPath(points)` (pura, em `roughShapes.ts`), print é `<image>`. A prévia de arraste é um
  `transform` de deslocamento nos itens selecionados; o valor só é gravado no `pointerup`.
- `MindscapeSelectionLayer.tsx` (novo): contorno da seleção, alças e retângulo do laço, num
  SVG **acima** dos post-its (as alças precisam ser clicáveis). `pointer-events` só nas alças.
- `MindscapeBoard.tsx` ganha a máquina de gestos por ferramenta: `select` (clique, laço,
  mover seleção, alça), `pan` (H/espaço), `draw` (A/L/R/O/P, prévia local), `erase`. Continua
  com listeners de `window` e `requestAnimationFrame`, como hoje.

### Módulos e fronteira de teste

| Módulo | Novo/alterado | Teste |
|---|---|---|
| `src/shared/mindscape/model.ts` | alterado: tipos, v2, parse v1/v2, `addLink` com `arrow`, `setBoardView` | vitest (test-first) |
| `src/shared/mindscape/drawings.ts` | novo: reducers de desenho, seleção e camada | vitest |
| `src/shared/mindscape/geometry.ts` | novo: hit-test, laço, caixas, `cardAtPoint`, `resizeDrawing`, `linkEndpoints` (movido) | vitest |
| `src/shared/mindscape/eraser.ts` | novo: `erasePolyline`, `eraseBoard` | vitest |
| `src/shared/mindscape/view.ts` | novo: tela ↔ quadro, `zoomAt`, `clampZoom`, fator da roda | vitest |
| `src/shared/mindscape/history.ts` | novo: pilhas, limite, `mergeSessionFacts` | vitest |
| `src/shared/mindscape/shortcuts.ts` | novo: tecla → ação | vitest |
| `src/shared/mindscape/images.ts` | novo: padrão do `imageId`, `fitImage` (480), `referencedImageIds`, limites e tipos | vitest |
| `src/shared/mindscape/channels.ts` | alterado: `saveImage`, `readImage` | — (tipos) |
| `src/main/mindscape-store.ts` | alterado: versão 2 (guarda inalterada) | vitest (v1 lido, v3 read-only) |
| `src/main/mindscape-images.ts` | novo: `save`, `read`, `sweepOrphans` com fs injetado | vitest (pasta temporária) |
| `src/main/index.ts`, `src/preload/index.ts` | alterados: 2 handlers, limpeza no boot, API | smoke |
| `src/renderer/src/Mindscape/useMindscapeDoc.ts` | alterado: `apply`/`applySession`/`undo`/`redo` | smoke (a lógica está em `history.ts`) |
| `MindscapeBoard.tsx`, `MindscapeScreen.tsx`, `roughShapes.ts`, `Mindscape.module.css` | alterados | smoke; `pencilPath` no vitest |
| `MindscapeDrawingLayer.tsx`, `MindscapeSelectionLayer.tsx`, `MindscapeToolbar.tsx`, `useMindscapeImage.ts` | novos | smoke |
| `App.tsx` | alterado: callbacks da V1 → `onAction`, eventos da sessão → `applySession` | smoke |

- **Smoke Playwright** (`tests/smoke/mindscape-desenho.spec.ts`, fixtures `atlas`/`beacon`):
  desenhar `R` e mover com `V`; `A` de post-it a post-it vira Ligação (`data-arrow="true"`) e
  `L` com uma ponta fora vira desenho solto; lápis + borracha parte um traço em dois; `Ctrl+Z`
  e `Ctrl+Shift+Z`, com um `turn-ended` da sessão no meio que continua lá depois do undo;
  `Ctrl+roda` muda o indicador sem mudar o zoom da página (`webContents.getZoomFactor()` segue
  1); zoom e desenhos voltam depois de relançar; print colado (`clipboard.writeImage` pelo
  `electronApp.evaluate` + `Ctrl+V`) aparece, o arquivo existe em `mindscape-images/`, e um
  arquivo órfão antigo plantado antes do boot some. O smoke da V1
  (`tests/smoke/mindscape.spec.ts`) não tem passo com "Ligar" (grep em 2026-10-24) e segue como
  está.

## O que fica de fora

- Copiar/colar e duplicar desenhos, minimapa, alinhar/distribuir, agrupar de verdade,
  losango, texto livre (fora pelo refinamento).
- Rabisco com pressão ou espessura variável (`perfect-freehand`): candidato se o alfa pedir.
- Converter linha solta em Ligação pela alça da ponta; Ligação curva ou com cotovelo.
- Ligação na seleção por laço ou `Ctrl+A`; cor ou espessura na Ligação.
- Seletor de arquivo ou tecla para print; print animado; SVG como print (pode carregar script,
  mesma recusa do chat).
- Histórico persistido entre aberturas do app; histórico de pan/zoom.
- Zoom da página pelo teclado (`Ctrl+=`/`Ctrl+-` do menu padrão do Electron): não é gesto do
  quadro e não faz parte do refinamento. Se incomodar no alfa, vira item próprio.
- Dois canais abertos **ao mesmo tempo** editando o mesmo `mindscape.json`: risco que já existe
  desde a V1 (o último a gravar vence). Esta entrega só protege os prints recém-colados (margem
  de 1 hora na limpeza).
- Não-funcionais de web (cache, paginação, feature flag, idempotência de API): não há servidor.
  O que vale aqui: escrita atômica, schema guard, debounce e validação no main, já acima.

## Trade-offs

- **Reabrir o ADR 0004 e trocar para o Excalidraw**: descartado. Compraria rabisco, formas e
  print prontos, mas o post-it vivo continua sem solução lá, e a V1 já existe em cima do
  quadro próprio. Ver a nota de 2026-10-24 no ADR.
- **`perfect-freehand@1.2.3` no lápis**: descartado nesta entrega (ver Base do quadro).
- **Acréscimo aditivo mantendo `schemaVersion: 1`**: descartado. Um canal com a V1 gravaria por
  cima e apagaria os desenhos, porque o parse dela joga fora o campo desconhecido.
- **Print em base64 dentro do `mindscape.json`**: descartado pelo refinamento (arquivo de
  10 MB reescrito inteiro a cada debounce de 500 ms).
- **Esquema de protocolo próprio (`donel-mindscape:`) ou reuso do `donel-asset:`**: descartado.
  O `donel-asset:` só existe com o chat ligado, e um esquema novo mexe no registro privilegiado
  feito antes do `app.ready`. IPC + `blob:` cabe na CSP atual sem mudança.
- **Undo por comandos com inversa**: descartado. São ~15 inversas, cada uma com seus bugs. O
  snapshot com `mergeSessionFacts` resolve "evento da sessão não volta" numa função só,
  testável.
- **Undo por snapshot do documento inteiro**: descartado. O histórico é por quadro, e um
  snapshot do documento desfaria mudanças de outros quadros.
- **Hit-test da ponta da seta pelo DOM (`elementFromPoint`)**: descartado em favor do
  `cardAtPoint` puro, que é testável no vitest e usa os mesmos retângulos que as Ligações já
  usam.
- **Desenhos em `<canvas>`**: descartado. O SVG mantém o mesmo modelo das Ligações e do
  contorno (seleção por elemento, `transform` no arraste, `roughjs` gerando `d`), e um quadro
  pessoal tem dezenas de desenhos, não milhares.
- **Atalhos de camada por `event.code`**: descartado. No teclado ABNT2, a posição física dos
  colchetes difere da US.
