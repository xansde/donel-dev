# Handoff — Mindscape desenho, etapa /arquitetura (2026-10-24)

Rodada com decisões delegadas pelo dono ("Vai fundo"). Branch `feature/mindscape-desenho`.
Modo avulso (sem plano): a demanda vem direto do refinamento
`docs/refinamentos/mindscape-ligar-rabisco-zoom.md` (status fechado).

## O que foi feito

- Registro TaskDex: `taskdex: []` herdado da ata (ferramenta pessoal).
- Self-assessment: `apto` (decidido por delegação do dono) → ramo apto, frentes cobertas sem
  pergunta ao humano. Gate **não** fechado: `status: rascunho`, quem aprova é o dono.
- Post no #arquitetura-champions: **não feito**. Repo pessoal (xansde/donel-dev) fora da
  Seazone, sem canal (decidido por delegação; registrado em `champions-post`).
- Artefatos:
  - `docs/design/mindscape-desenho.md` (novo, rascunho)
  - `docs/adr/0004-base-do-quadro-mindscape.md`: nota "Confirmado em 2026-10-24" em
    Consequências (sem mudar a decisão; nenhum ADR novo, nada passou no critério triplo)
  - `CLAUDE.md`, seção Domínio: uma linha-invariante ("campo novo no `mindscape.json` sobe o
    `schemaVersion`"). Passa no teste de docs-vivos: um agente numa demanda futura erraria sem ela.
- Código lido: `src/shared/mindscape/{model,channels,highlight}.ts`, `src/main/mindscape-store.ts`,
  `src/main/index.ts` (handlers `mindscape:*`, `registerChatDomain`, `createMainWindow`),
  `src/preload/index.ts`, `src/renderer/src/Mindscape/*` (Board, Screen, Links, Card,
  roughShapes, useMindscapeDoc, CSS), `App.tsx` (fiação do Mindscape, listener global de
  `Ctrl`), `PetApp.tsx:184` + `src/shared/pet/gestures.ts` (roda nativa não passiva,
  `normalizeWheelDelta`), `src/main/chat/{attachments,assets-protocol}.ts` +
  `src/shared/chat/assetUrl.ts` (precedente de imagem), `ChatComposer.tsx` (paste/drop),
  `src/renderer/index.html` (CSP), `tests/smoke/mindscape.spec.ts`.
- Medições e fatos (2026-10-24):
  - `npm view perfect-freehand`: última versão 1.2.3, publicada em 2026-02-01, MIT,
    `dist.unpackedSize` 112.085, sem `dependencies`. **Não adotado.**
  - `git ls-tree origin/main`: 0 arquivos `mindscape` (beta sem Mindscape); `origin/staging`: 52.
  - CSP do renderer: `img-src 'self' data: blob: donel-asset:`.
  - `donel-asset:` só é registrado com `chat.enabled = true` (`registerChatDomain`).
  - Janela principal: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; sem
    `Menu.setApplicationMenu` (o menu padrão do Electron vale).
  - `parseMindscapeDoc` (V1) reconstrói o quadro só com campos conhecidos: campo novo some no parse.
  - O smoke da V1 não tem passo com "Ligar".

## Decisões (por delegação, 2026-10-24)

- ADR 0004 confirmado; nenhuma dependência nova (rabisco = `path` SVG suavizado por função pura).
- Modelo: `drawings: MindscapeDrawing[]` no quadro (ordem do array = camada; tipos `pencil`,
  `line` com `arrow`, `rect`, `ellipse`, `image`), `zoom` ao lado do `pan`, coordenadas do quadro.
- `schemaVersion` sobe para 2. O parse da V1 apagaria `drawings` e o canal antigo gravaria por
  cima; com a versão 2, ele cai na guarda read-only que já existe. Parse aceita 1 e 2.
- A/L de post-it a post-it → `addLink` (com `arrow`) via `cardAtPoint` puro; o modo "Ligar" sai.
- Print: binário em `<userData>/mindscape-images/<imageId>`, IPC `mindscape:save-image` e
  `mindscape:read-image`, exibido por `Blob` + `URL.createObjectURL` (CSP já permite `blob:`),
  GIF vira PNG do 1º quadro, limpeza de órfãos no boot (só com JSON válido e versão conhecida,
  e só arquivo com mais de 1 h).
- Undo: snapshot `{before, after}` do quadro + `mergeSessionFacts` (evento da sessão nunca
  volta), 100 entradas por quadro, em memória no `useMindscapeDoc`, portas `apply` (dono) e
  `applySession` (sessão); todas as ações do dono por um `onAction` único.
- Borracha: `erasePolyline`/`eraseBoard` puros (interseção segmento × círculo); recalculada
  sobre o quadro atual no `pointerup`.
- Zoom: `view.ts` puro (`zoomAt`, `screenToWorld`, `clampZoom`); listener nativo de `wheel`
  não passivo; espaço + arrastar; indicador "− 100% +".
- Atalhos: função pura `mindscapeShortcut`, `onKeyDown` na `<section>` focada do Mindscape;
  colchetes por `event.key` (ABNT2).

## Riscos

- **Pinça e zoom de página**: que a pinça chega como `wheel` com `ctrlKey` e que o zoom visual
  vem desligado no Electron é documentação, não medido. O smoke confere
  `getZoomFactor() === 1` depois de `Ctrl+roda`; a pinça real só no alfa.
- **Foco e teclado**: os atalhos dependem de a `<section>` ter foco; o `paste` ouvido no
  `document` e o `Ctrl+Shift+]`/`[` no ABNT2 não foram medidos (a barra tem botões de camada como
  caminho garantido).
- **Dois canais abertos ao mesmo tempo** seguem com o risco da V1 (o último a gravar vence);
  a margem de 1 h só protege prints recém-colados de serem limpos pelo outro canal.

## Não verificado

- Comportamento de `paste` em elemento não editável no Electron 43 (a confirmar no smoke).
- `createImageBitmap` em GIF devolvendo o primeiro quadro (comportamento do Chromium, não executado).
- Desempenho com muitos rabiscos longos (cache do `roughjs` por geometria local; rabisco sem
  `roughjs`).

## Próximo passo

Dono revisa e aprova o design (`status: aprovado`); depois `/fatiamento` sobre
`docs/design/mindscape-desenho.md`.
