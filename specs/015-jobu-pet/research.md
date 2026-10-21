# Pesquisa — 015 (pet do Jobu Donel)

Levantamento do código em 21/10/2026 (branch `015-jobu-pet`, base `staging`
`ae8b103`). Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Cada item:
**Decisão**, **Por quê**, **Alternativas**.

## R1 — Onde o núcleo roda: no main

- **Decisão**: o núcleo puro (`src/shared/pet/`) roda no **main**, alimentado
  pelos sinais que já estão lá (semáforo, troca de conta, saída de PTY, foco da
  janela principal) e pelo que só o renderer da janela principal sabe (abas,
  nomes, aba ativa). O main manda a vista pronta (`PetView`) à janela do pet,
  que só desenha e devolve gestos.
- **Por quê**: o caso principal é o Donel **minimizado**, e o renderer dele tem
  timer estrangulado em segundo plano. Os prazos (balão de 6 s, 10 min, 20 min)
  precisam de relógio confiável, e o main tem. O semáforo e a troca de conta já
  vivem no main, sem IPC.
- **Alternativas**: calcular no renderer principal (timers estrangulados,
  janela minimizada) ou na própria janela do pet (precisaria de todos os sinais
  por IPC e de uma cópia do estado a cada reabertura).

## R2 — Semáforo como fonte e a sessão que nasce "trabalhando"

- O semáforo tem `working | waiting | permission | done` na máquina
  (`src/main/semaphore-state-machine.ts:23`) e `error` no público quando a saída
  é ≠ 0 (`src/main/session-semaphore-manager.ts:161-167`). O
  `SessionSemaphoreManager` oferece `onUpdate(SemaphoreUpdate)`, com
  `{ ptyId, state, stateEnteredAt }` (`:27-32`, `:177`), sem dedupe: todo hook
  mapeado emite (`:257-258`).
- **Problema**: toda sessão nasce `working` e fica assim até o primeiro hook
  (`:145-149`; comentário em `src/main/index.ts:1336-1345`). O pet mostraria
  "lendo" para uma aba aberta e parada.
- **Decisão**: sessão **sem nenhum update desde o registro** conta como parada.
  Só um update de hook ou da heurística a promove a `working`. É a mesma regra
  que o motor de contas adotou em 13/09 ("contar só sessão com evento de
  hook"). `error` é tratado como `done`. O pet faz o próprio dedupe por estado.
- **Alternativas**: corrigir o nascimento otimista no semáforo (é o B27 do
  backlog, com efeito em outras telas — fora do escopo).

## R3 — "Travou": quando nasce o balão e com qual tipo

- **Fatos**:
  - Com o chat ligado, a pendência sai do hub com o tipo
    (`question | permission | plan`, `src/shared/chat/pendingQueue.ts:68-88`).
    O main recebe `events.pendingOpened({ ptyId, pending })`
    (`src/main/chat/chat-hub.ts:73,518`; tratado em `src/main/index.ts:1138-1145`).
    O público do semáforo vira `permission` enquanto ela está aberta.
  - Com o chat desligado, só o hook `Notification` (de qualquer tipo) ou a
    heurística levam a `permission`, **sem tipo**. Isso inclui o
    `idle_prompt`, que o CLI manda quando a sessão está parada esperando
    mensagem (`src/main/chat/chat-hub.ts:139-144`).
- **Decisão**:
  - O balão de "travou" nasce na transição **de trabalhando** (ou de parada) **para
    `permission`**, ou num `pendingOpened` do chat.
  - `waiting → permission` **não** gera balão nem reinicia a espera, porque a
    sessão já está contada. Assim o `idle_prompt` não vira um falso "quer
    permissão".
  - O tipo vem do `pendingOpened` quando há chat. Sem chat, o texto é
    `quer permissão`.
- **Limite aceito**: com o chat desligado, uma pergunta ou um plano aparecem
  como `quer permissão`. O chat vira padrão na Fase 7 da 014.

## R4 — Abas, nomes e aba ativa: canal novo, com o id certo

- **Fatos**:
  - A aba do renderer tem `id = tab-N` (`src/renderer/src/App.tsx:583-584`),
    não o ptyId. O ptyId fica em `chatPtyIds[tab.id]` e em
    `terminalRefs.current[tab.id].ptyId`, e muda em Retomar e Reabrir.
  - O nome exibido é `resolveTabName` (`App.tsx:1753-1760`).
  - O main só conhece a aba ativa por `chat:focus-state`, que existe apenas com
    o chat ligado (`App.tsx:1917-1923`).
- **Decisão**: um canal novo **sempre ligado**, `pet:tabs`, do renderer
  principal para o main. Payload:
  `{ activePtyId: string | null, sessions: { ptyId, name }[] }`. Ele leva só as
  abas `claude` que têm PTY e o nome resolvido, mapeia `tab.id → ptyId` num
  helper puro e é enviado com dedupe a cada mudança.
- **Bug existente revelado** (correção C2):
  - `chat:focus-state` manda `tab.id` onde o main compara ptyId
    (`src/main/chat/notifications.ts:24,64`). Com isso, a notificação de
    pendência sai até para a aba ativa e com título "Donel Dev".
  - `chat:focus-pending` manda o ptyId e o renderer o usa como `tab.id`
    (`App.tsx:1927-1935`). Com isso, o clique na notificação não ativa a aba.
  - Os dois passam pelo mesmo helper de mapeamento, com teste.

## R5 — A segunda janela muda o significado de "todas as janelas"

- **Fatos**: hoje o app supõe uma janela só.
  - `isWindowFocused` usa `getAllWindows().some(isFocused)`
    (`src/main/index.ts:1114`).
  - O clique da notificação pega "a primeira janela não destruída" (`:1125`).
  - `window-all-closed` encerra o app (`:2605-2617`), e `activate` recria a
    janela quando não há nenhuma (`:2598-2602`).
  - `mainWindow` é local de `createMainWindow` (`:936`).
- **Decisão** (correção C1):
  - Guardar a referência da janela principal num acessor (`getMainWindow()`).
  - Trocar os dois usos de "qualquer janela" por ela.
  - **Destruir a janela do pet quando a principal fecha**, antes do
    `killAll`. Assim `window-all-closed` continua encerrando o app e o FR-001
    vale.
  - Os broadcasts a todas as janelas (`accounts:changed`, `chat:*` etc.) chegam
    também ao pet. O preload do pet não assina esses canais, e o custo é
    desprezível.

## R6 — "Encerrou sozinha" × "o dono fechou"

- **Fato**: o main não distingue os dois casos. `PtyManager.kill` não guarda
  intenção, e o listener de saída recebe só `(id, exitCode, signal)`
  (`src/main/pty-manager.ts:150,239,269-275`).
- **Decisão** (correção C3): o handler de `pty:kill` (`src/main/index.ts:1394-1396`)
  marca o ptyId num conjunto `killRequested` antes de matar. A saída com a
  marca é `byUser = true`. Retomar e Reabrir passam pelo mesmo kill e contam
  como "do dono". `/exit` digitado conta como saída sozinha, mas com a aba ativa
  e o Donel em foco a sessão nasce vista e não gera balão.

## R7 — Levar o dono à sessão

- **Decisão**: um canal novo do main para o renderer principal,
  `app:activate-session { ptyId }`, que funciona sem o chat.
  - O renderer mapeia `ptyId → tab.id` pelo mesmo helper do R4 e ativa a aba.
  - Antes, o main faz `restore` (se minimizada), `show` e `focus` na janela
    principal.
  - O clique vem de um gesto do dono numa janela do próprio app, então o
    Windows libera o primeiro plano.
- **Verificar no alfa**: se em algum caso só a barra de tarefas piscar, aplicar
  o truque `setAlwaysOnTop(true)`/`(false)` na janela principal.

## R8 — Um canal de aviso por vez

- **Decisão**: com `pet.enabled = true`, os dois emissores de aviso do Windows
  ficam calados para esses eventos.
  - **Renderer**: o efeito de `App.tsx:1884-1913` sai cedo.
  - **Main**: o `notifyPending` recebe a dependência `isPetEnabled()` e devolve
    `false`.
  - A supressão vale também durante a tela cheia (dúvida Q2) e durante o
    silêncio (FR-020).

## R9 — A janela do pet

- **Decisão**: uma `BrowserWindow` com estas opções:
  - `transparent: true`, `frame: false`, `resizable: false`,
    `hasShadow: false`, `skipTaskbar: true`;
  - `alwaysOnTop: true` no nível padrão. Ele **não** fica sobre tela cheia
    exclusiva, e o R10 cuida das outras telas cheias;
  - `focusable: false`, para não roubar foco no clique;
  - `show: false` até o primeiro `PetView`, depois `showInactive()`;
  - `backgroundThrottling: false`, para as animações.
- **Clique que atravessa o vazio**: `setIgnoreMouseEvents(true, { forward: true })`
  por padrão.
  - O renderer recebe o `mousemove` repassado e testa o ponto contra o alfa do
    desenho (canvas fora da tela), o balão, o selo e a lista.
  - Ele avisa `pet:interactive(true | false)` só quando o valor muda.
- **Tamanho**: `max(480, 3,4 × tamanho)` × `tamanho + 200` DIP (tamanho do desenho no FR-033; Médio = 140).
  - O desenho fica embaixo, no centro, com cerca de 140 px de altura.
  - Balão e lista crescem para cima e se alinham pelo `align` da vista.
  - A janela pode passar da borda da tela. O centro do desenho fica sempre no
    monitor escolhido, então o Windows aplica a escala desse monitor.

## R10 — Tela cheia sem dependência nova

- **Decisão**: um processo auxiliar do PowerShell, de vida longa, que roda só
  com o pet ligado.
  - Ele chama `SHQueryUserNotificationState` (shell32) por P/Invoke a cada
    1,5 s e imprime o estado.
  - `QUNS_BUSY (2)`, `QUNS_RUNNING_D3D_FULL_SCREEN (3)` e
    `QUNS_PRESENTATION_MODE (4)` escondem o pet. O resto mostra.
  - O parser da saída é puro e testado. O processo morre com o app e reinicia
    com recuo se cair.
- **Alternativas**:
  - FFI (`koffi`): dependência nova, o que pede confirmação e esbarra no
    espelho público.
  - Medir a janela em primeiro plano: o Electron não enxerga janela de outro
    app.
  - Ficar sem a detecção: fere o FR-007.

## R11 — Arrastar, encaixar e lembrar

- **Decisão**: arraste manual. O renderer manda `pet:drag-start` e
  `pet:drag-move` com coordenadas de tela, e `pet:drag-end`. O main move a
  janela.
  - Sem `-webkit-app-region: drag`, que engole o clique.
  - Limiar de 4 px separa clique de arraste.
  - Ao soltar:
    - a até 24 px da base da área útil (com a barra embaixo), encaixa
      (`docked`);
    - a posição vai para `pet.placement`;
    - o `align` é recalculado.
  - Monitor removido ou resolução mudada (eventos do módulo `screen`)
    revalidam a posição (FR-005).

## R12 — Lista com Esc e clique fora

- **Decisão**: ao abrir a lista, o main faz `setFocusable(true)` e `focus()` no
  pet.
  - O `blur` da janela fecha a lista, e o Esc também.
  - Ao fechar, o pet volta a `setFocusable(false)`.
  - O foco só sai do app do dono quando ele mesmo clicou no Jobu.

## R13 — Menu do botão direito

- **Decisão**: `Menu.buildFromTemplate(...).popup({ window: petWindow })` no
  main. O renderer só avisa `pet:context-menu`.
- **Itens**: "Silenciar por 1 hora" (ou "Retomar avisos"), "Esconder" e
  "Voltar ao canto".

## R14 — Relógio e envio da vista

- **Decisão**: com o pet ligado, um tick de 1 s no main alimenta o núcleo. A
  vista só vai ao pet quando muda (comparação estrutural). A lista mostra o
  tempo em minutos, então o tick de 1 s basta e custa nada. Com o pet
  desligado, nem tick nem processo auxiliar.

## R15 — Arte e poses provisórias

- **Decisão**:
  - As poses vivem em `src/renderer/src/pet/assets/poses/*.png`, recortadas da
    folha v2 por `scripts/pet/slice-sprites.py`.
  - O renderer do pet descobre no build quais existem
    (`import.meta.glob(..., { eager: true })`).
  - Uma função pura resolve a pose lógica, com a tabela de provisórias do
    FR-029. Arte nova entra só adicionando o PNG, sem tocar no código.
  - **A arte sai inline, como `data:` URI** (achado da US1). O teste de clique
    pelo alfa (R9) lê a imagem de um canvas, e numa página `file://` cada
    arquivo é outra origem: um PNG servido como arquivo deixaria o canvas
    ilegível (`getImageData` lança). Medido no Vite 5.4: o sufixo `?inline` não
    vale para `import.meta.glob` (a URL sai com `?inline` colado e quebrada), e a
    opção `build.assetsInlineLimit` não passa no tipo do electron-vite. Quem
    inlina é o plugin `inlinePetArt` de `electron.vite.config.ts`, só para
    `src/pet/assets/poses/`. Em dev a arte é servida pelo próprio servidor, da
    mesma origem da página (conferido com `electron-vite dev`: o canvas lê e o
    teste de clique acerta). O custo é o chunk do pet (~1,6 MB), que só a
    janela do pet carrega.
  - **A geometria da arte** (tela 264×320, âncora (132, 312)) está em
    `src/shared/pet/art.ts`, e `tests/pet-art.test.ts` a confronta com o
    `manifest.json` e com o cabeçalho dos PNGs: re-cortar a folha com outra
    âncora reprova em vez de deixar o Jobu flutuando.

## R16 — Riso só por visita

- **Decisão**: a fila "zerada" que faz o Jobu rir (FR-012) é a que cai a zero
  porque a última sessão foi **vista**. Fechar a aba esperando não faz rir.

## R17 — Espelho público

- **Fato**: `src/` inteiro é espelhado no `xansde/donel` (MIT) quando o beta
  vira stable.
- **Decisão**: a arte fica em `src/` para alfa e beta. A promoção ao stable
  espera a resposta do dono sobre publicar o personagem (dúvida Q1).

## R18 — Rota `#pet` no mesmo HTML e no mesmo preload

- **Fatos**:
  - O electron-vite resolve as entradas por convenção, com um HTML
    (`src/renderer/index.html`) e um preload (`src/preload/index.ts`).
  - Declarar `build.rollupOptions.input` quebra o `tsc --noEmit` com Vite 5
    (`electron.vite.config.ts:5-13`).
  - A janela principal usa `sandbox: true`, e um preload sandboxed não carrega
    chunk compartilhado.
- **Decisão**: a janela do pet carrega o mesmo `index.html` com hash `#pet`
  (`loadFile(..., { hash: 'pet' })` em produção; URL + `#pet` em dev).
  - `src/renderer/src/main.tsx` decide pela rota e importa `App` ou `PetApp`
    **dinamicamente**, então o pet nunca avalia o módulo do `App`.
  - O pet usa o mesmo preload, com um domínio `pet` novo no `DonelApi`.
  - O `PetApp` garante fundo transparente em `html`, `body` e `#root`.
- **Alternativas**:
  - Segundo HTML e segundo preload: hack de tipos na config e risco de chunk em
    preload sandboxed.
  - `App` importado de forma estática: o pet carregaria e executaria o app
    inteiro.

## R19 — O renderer principal precisa saber quando o pet desliga

- **Fato**: não existe push de config (`config:changed`). O renderer só vê a
  config que ele mesmo gravou.
- **Decisão**: o push `pet:prefs-changed { enabled }` vai à janela principal
  sempre que o main muda `pet.enabled`, seja pelas Preferências, seja pelo
  "Esconder". O `App` atualiza `appConfig.pet` com ele, e com isso a supressão
  de toasts (R8) e o toggle ficam certos.
- **Alternativa**: reler a config ao abrir as Preferências. Isso não corrige a
  supressão, que lê `appConfig` o tempo todo.

## R20 — A chave `pet` sobrevive a canal antigo

- **Fato**: `sanitizeAppConfig` guarda chave de topo desconhecida em
  `unknownFields` e a regrava (`src/main/config-store.ts:593-604,784-803`).
- **Decisão**: `pet` é chave de **topo**. O beta atual (sem 015) preserva a
  chave intacta, enquanto uma subchave nova dentro de `chat` seria apagada. Os
  testes de forma exata da config passam a incluir `pet`.

## R21 — Ordem das janelas e os smokes

- **Fato**: todo smoke pega `electronApp.firstWindow()`
  (`tests/smoke/helpers/launch.ts:56`).
- **Decisão**: o pet só nasce depois do `ready-to-show` da janela principal,
  então a primeira janela continua sendo a principal. O smoke `@pet` acha o pet
  pela URL (`#pet`).
