# /implementacao — Mindscape desenho, fatia 02

**Fatia**: 02 — Ctrl+Z e Ctrl+Shift+Z no quadro, sem desfazer o que a sessão fez
**Data**: 2026-10-24 · **Branch**: `feature/mindscape-desenho` (checkout principal, sem worktree) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`history.ts`, `shortcuts.ts`) + `teste-depois` (tela, por smoke)
**Fatias anteriores lidas**: `handoffs/mindscape-desenho-implementacao-01.md`.

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-24** ("vai fundo"). Nenhuma muda regra do refinamento nem decisão do design.

- **Sem worktree, no checkout principal, `feature/mindscape-desenho`, inline, sem push.** Instrução da execução, como na fatia 01. O flip do BACKLOG entra no commit da fatia.
- **`mergeSessionFacts(snapshot, current, counterpart?)` ganhou um terceiro argumento opcional.** O design define a fusão com dois argumentos, e a regra "post-it escrito pela sessão que não existia no snapshot é mantido inteiro", lida ao pé da letra, quebra o **refazer de "Arquivar"**: o `after` não tem o post-it, o quadro atual tem (o desfazer o trouxe de volta), e o refazer o manteria. O `counterpart` é o outro lado da entrada (`after` no desfazer, `before` no refazer). Um post-it escrito pela sessão que está nele com o **mesmo `writtenAt`** e não está no snapshot foi tirado pela própria ação, então não volta. Reescrito pela sessão depois do arquivamento (`writtenAt` mais novo), é fato novo da sessão e fica. Sem o terceiro argumento, a função faz exatamente o que o design descreve (os casos do plano de testes chamam com dois).
- **`update` do `useMindscapeDoc` virou `applySession`**, com a mesma semântica (sem histórico). Quem a usa: `placeSessionCard`, `writeSessionNote` e o pan (`setBoardPan`), que segue fora do histórico, como o design manda para `setBoardView`.
- **`apply` só grava entrada quando o quadro de `projectPath` existe antes e depois e mudou.** Reducer que devolve o mesmo documento não grava nada (nem render, nem save, nem entrada). Assim, fechar o campo do post-it do dono sem mudar o texto não vira um passo de desfazer.
- **O histórico mora num `ref` do `useMindscapeDoc` como `Record<projectPath, BoardHistory>`**, com as pilhas imutáveis de `history.ts`. Desfazer/refazer gravam o documento pelo mesmo debounce de 500 ms.
- **Atalho**: `Ctrl+Z` → desfazer, `Ctrl+Shift+Z` → refazer, comparando `key.toLowerCase() === 'z'`, só com `Ctrl` (com `Alt` ou `Meta` não conta). Com o foco num campo de texto, `null` (vale o desfazer do campo). `Ctrl+Y` não entrou: o design não o lista.
- **"Gesto em andamento"** = do `pointerdown` ao fim do gesto, em qualquer ferramenta (arraste de cartão, mão, desenho). O `MindscapeBoard` avisa a tela por `onGestureChange(active)`, e a tela guarda num `ref`. O `Ctrl+Z` nesse intervalo é engolido (`preventDefault`, sem efeito).
- **O post-it criado nesta visita só abre em edição na primeira montagem.** Antes, `createdCardId` ficava marcado, e um refazer que trazia o cartão de volta o remontava em edição, com o foco no campo (o `Ctrl+Shift+Z` seguinte iria para o campo). Agora ele é limpo quando o campo fecha (`onEdit`).
- **As ações do dono saem da tela como reducers.** Os callbacks da V1 (`onArchive`, `onMoveCard`, `onAddOwnerCard`, `onEditOwnerCard`, `onSetOwnerColor`, `onToggleLinkArrow`, `onRemoveLink`) saíram das props do `MindscapeScreen` e do `App`. A tela monta o reducer e chama `onAction(projectPath, reducer)`. O `createdAt` do post-it do dono é lido na tela, no clique. `onAddLink` já tinha saído na 01.

## O que foi feito

- `src/shared/mindscape/history.ts` (novo): `HISTORY_LIMIT = 100`, `HistoryEntry`, `BoardHistory`, `EMPTY_HISTORY`, `recordHistory` (empilha, corta a mais antiga, zera o refazer), `undoHistory`/`redoHistory` (devolvem `{ history, board }` ou `null`) e `mergeSessionFacts`.
- `src/shared/mindscape/shortcuts.ts`: tipos `undo`/`redo` no `MindscapeShortcut`, mais o mapeamento de `Ctrl+Z`/`Ctrl+Shift+Z`.
- `src/renderer/src/Mindscape/useMindscapeDoc.ts`: `apply`, `applySession`, `undo` e `redo` no lugar de `update`.
- `src/renderer/src/App.tsx`: eventos da sessão e pan por `applySession`, `onAction` por `apply`, `onUndo`/`onRedo` ligados ao hook. Os 7 callbacks da V1 e os imports deles saíram.
- `src/renderer/src/Mindscape/MindscapeScreen.tsx`: props `onUndo`/`onRedo`, todas as ações do dono por `onAction`, `Ctrl+Z`/`Ctrl+Shift+Z` no `onKeyDown` da `<section>` (ignorados com gesto em andamento), `createdCardId` limpo no `onEdit`.
- `src/renderer/src/Mindscape/MindscapeBoard.tsx`: prop opcional `onGestureChange`, chamada no início do gesto (`attachGesture`) e no fim (`endGesture`).

Nada mudou em `src/main/` (inclusive `src/main/accounts/`), no Modo Dev, no `config.json` nem em `src/main/chat/attachments.ts`. Nenhuma dependência npm entrou.

### Testes existentes alterados (e por quê)

- `tests/mindscape-shortcuts.test.ts`: 3 casos novos de `Ctrl+Z`. Os anteriores seguem iguais.
- `tests/smoke/mindscape-desenho.spec.ts`: `test` novo da fatia 02. O `env()` passou a ler `scenario` e `mindscapeFile` de variáveis (a 02 usa `session-note.json` e o próprio `mindscape-02.json`). O `test` da 01 não mudou.
- Nenhum smoke da V1 foi tocado. Nenhum passo deles usava os callbacks removidos de forma visível; o comportamento é o mesmo.

## Vermelho → verde (vitest, test-first)

Antes do código (`npx vitest run tests/mindscape-history.test.ts tests/mindscape-shortcuts.test.ts`):

```
FAIL tests/mindscape-history.test.ts  Error: Failed to load url ../src/shared/mindscape/history ... Does the file exist?
FAIL tests/mindscape-shortcuts.test.ts > mindscapeShortcut > maps Ctrl+Z to undo and Ctrl+Shift+Z to redo
     AssertionError: expected null to deeply equal { type: 'undo' }
Test Files  2 failed (2)
Tests  1 failed | 8 passed (9)        (os 15 casos do history não chegaram a rodar: módulo inexistente)
```

Depois: os mesmos 2 arquivos → `Test Files 2 passed (2)`, `Tests 24 passed (24)`. `npx vitest run tests/mindscape` → `Test Files 11 passed (11)`, `Tests 107 passed (107)`.

## Gates (saída observada)

- `npm test` (vitest inteiro): **`Test Files 216 passed (216)`, `Tests 4974 passed (4974)`** nas 2 últimas de 5 rodadas. As 3 primeiras tiveram falhas de tempo **fora do Mindscape**, sem nenhum import dele, e diferentes a cada rodada: 1ª, 1 falha (não anotei qual); 2ª, `tests/hook-bridge.contract.test.ts` ("two simultaneous requests from different agents are independent": `expected [] to have a length of 2`); 3ª, `tests/chat-shiki.test.ts` e `tests/chat-transcript-io.test.ts`. Rodados sozinhos, passaram (`hook-bridge` 25/25; `chat-shiki` e `chat-transcript-io` 38/38). É a mesma instabilidade com a máquina carregada que o relato da 01 registrou.
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json` sem erro (exit 0). O `tsconfig` inclui `tests/`, então os specs também passam pelo typecheck.
- `npm run build`: `✓ built in 28.66s`, exit 0.
- Smoke da fatia: `npx playwright test -c tests/smoke/playwright.config.ts mindscape-desenho` → `2 passed (2.0m)` (01 e 02). A primeira rodada da 02 falhou no passo 7: esperei o campo vazio depois do `Ctrl+Z`, mas o Chromium desfez só a última letra (`"ab"`). Ajustei a asserção para "o campo desfez parte da digitação, segue em foco e o quadro não mudou", que é o que o plano pede ("desfaz só a digitação").
- Smokes do Mindscape (V1 + desenho): `npx playwright test -c tests/smoke/playwright.config.ts mindscape` → **`7 passed (2.6m)`** (`mindscape`, `-canvas`, `-highlight`, `-links`, `-session-note`, `-desenho` 01 e 02). Uma rodada anterior deu `6 passed, 1 failed`: o `afterAll` do `mindscape-highlight` não conseguiu apagar a pasta temporária do `userData` (`EPERM` no `rmSync`). O teste em si tinha passado. Na rodada seguinte, os 7 passaram.
- Lint: o repo não tem script de lint. É lacuna conhecida e não montei um.

## Plano de testes, item a item

- vitest: `undo` devolve o `before` e `redo` devolve o `after` ✔ (mais: ordem inversa, `null` sem entrada, nada é mutado)
- vitest: a 101ª entrada tira a mais antiga ✔
- vitest: ação nova depois de um `undo` esvazia o refazer ✔
- vitest: `mergeSessionFacts` mantém o post-it de sessão que não existia no snapshot ✔; mantém `text`/`writtenAt`/`sessionName` atuais do post-it escrito pela sessão, com a posição do snapshot ✔; mantém inteiro o escrito pela sessão que nasceu depois ✔; traz `pan` e `zoom` do atual ✔; descarta a Ligação cujo cartão sumiu ✔ (mais: post-it de sessão nos dois fica com a posição do snapshot; cartões do dono e desenhos vêm do snapshot; refazer de "Arquivar" arquiva de novo; reescrito depois do arquivamento fica)
- vitest: `Ctrl+Z` e `Ctrl+Shift+Z` (inclusive com `key` `Z`) mapeiam ✔; `editable` devolve `null` ✔ (mais: `Z` sem `Ctrl`, ou com `Alt`/`Meta`, não conta)
- smoke: primeiro turno da sessão (post-it escrito pela sessão já existe), depois retângulo, post-it do dono (vazio) e arraste dele; segundo turno → texto novo no post-it da sessão ✔
- smoke: `Ctrl+Z` 3× → o post-it do dono volta para onde nasceu (posição do `style`) ✔, depois some ✔, depois o retângulo some ✔; o post-it escrito pela sessão segue com "Segunda resposta (hook)." ✔, e o arquivo fica com `drawings: []` ✔
- smoke: `Ctrl+Shift+Z` → o retângulo volta ✔
- smoke (a mais): `Ctrl+Z` com um retângulo sendo arrastado (prévia na tela) não desfaz nada ✔ (`Esc` cancela o gesto sem criar nada)
- smoke: "Uso geral" e volta → o refazer continua lá: `Ctrl+Shift+Z` traz o post-it de volta, fora de edição, onde nasceu ✔, e o seguinte refaz o arraste ✔
- smoke: com o foco no texto do post-it, digitar "abc" e `Ctrl+Z` → o campo desfaz a digitação e segue em foco; o quadro não muda (cartão, posição e desenho iguais) ✔
- smoke: relançar o app → `Ctrl+Z` e `Ctrl+Shift+Z` não fazem nada (desenho, post-it e posição iguais) e o `mindscape.json` não é regravado ✔

**Ordem dos passos no smoke.** O plano lista "foco no texto" antes de "trocar de modo". No smoke, a troca de modo veio antes. Motivo: o post-it do dono só existe de novo depois de refazer, e fechar o campo com texto novo seria uma ação nova, que zera o refazer. Todos os itens do plano estão cobertos.

## Dados necessários (seed)

Não há banco. O spec reaproveita o root temporário da 01 (`atlas/CLAUDE.md`, `config.json` com `projectRoots`) com um `mindscape-02.json` próprio, apontado por `DONEL_MINDSCAPE_FILE`. O roteiro do claude falso é `tests/fixtures/mindscape/scenarios/session-note.json`, que já existia: os prompts "primeiro" e "segundo" terminam com `Stop` + `last_assistant_message`. Nenhuma fixture nova.

## O que ficou sem verificar

- **Interação com o menu padrão do Electron** (Editar → Desfazer, `Ctrl+Z`): o app não define menu próprio (só `autoHideMenuBar`). O smoke mostra o comportamento certo nos dois casos (quadro e campo de texto), mas não investiguei se o acelerador do menu também dispara. Se disparar, é o `webContents.undo()` do campo em foco, que fora de um campo não faz nada.
- Desfazer/refazer de cor do post-it do dono, de "Arquivar", de Ligação desenhada, seta e remover Ligação: cobertos pelo caminho único (`onAction` → `apply`) e pelo vitest do refazer de "Arquivar", mas sem passo de smoke próprio.
- Agrupamento do desfazer nativo do campo de texto: o Chromium desfez uma letra por vez com a digitação do Playwright. Com digitação humana pode agrupar diferente.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.

## Notas fora do escopo (candidatas a item)

- Testes de tempo instáveis com a máquina carregada (de novo): `hook-bridge.contract.test.ts`, `chat-shiki.test.ts`, `chat-transcript-io.test.ts`. Também o `afterAll` com `EPERM` ao apagar a pasta temporária no Windows (`mindscape-highlight`, e o `empty-state` na 01).
- O post-it do dono criado e logo escrito vira duas entradas (criar e editar), então são 2 `Ctrl+Z` para sumir com ele. É o que o design diz (um gesto = uma entrada; editar grava no `blur`). Se incomodar no alfa, juntar as duas na primeira edição é uma mudança pequena.

## Próxima etapa

Fatia 03 (seleção múltipla, alças, estilo e camadas), que depende desta. Os reducers novos dela (`moveItems`, `removeItems`, `setDrawingsStyle`, camadas) entram por `onAction` e já caem no histórico.
