# Tasks: Jobu Donel, o assistente na área de trabalho (015)

**Input**: `specs/015-jobu-pet/` — spec.md (FR-001–FR-033), plan.md, research.md
(R1–R21), data-model.md, contracts/ipc-pet.md, quickstart.md, duvidas.md.
**Tests**: obrigatórios no núcleo puro (TDD do repo); a tela vai por smoke `@pet`.
**Mandato**: execução autônoma (21/10). Dúvida nova → `duvidas.md` com decisão
provisória aplicada; nunca parar para perguntar.

## Format: `[ID] [P?] [Story] Descrição`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente).
- **[USn]**: user story da spec.
- Paths relativos à raiz do repo. Código, comentários e nomes em inglês; textos
  de tela em pt-BR com acento. Conventional Commits com descrição em pt-BR e as
  duas linhas de atribuição da sessão.

---

## Phase 1: Setup (arte, tipos e canais)

- [ ] T001 [P] Recortar a folha v2 em 12 poses transparentes, com âncora comum e altura de 320 px, mais `manifest.json` e a opção `--extra` → `scripts/pet/slice-sprites.py`, `src/renderer/src/pet/assets/poses/` (em curso na worktree `../donel-dev-wt/015-jobu-arte`, branch `015-jobu-arte`).
- [ ] T002 [P] Montar o protótipo navegável autocontido e os prints → `design/jobu-pet/prototipo.html`, `design/jobu-pet/prints/`, `scripts/pet/build-prototype.*` (mesma worktree).
- [ ] T003 Integrar a branch `015-jobu-arte` em `015-jobu-pet` (merge `--no-ff`), conferir a prancha `design/jobu-pet/poses-contact-sheet.png` e os prints contra a spec, e remover a worktree `../donel-dev-wt/015-jobu-arte` (sem junction de `node_modules` lá).
- [x] T004 [P] Criar os tipos do núcleo em `src/shared/pet/types.ts`: `PoseName` (15 lógicas, data-model), `WatchedSession` (`semaphore: 'idle'|'working'|'waiting'|'permission'|'done'`, `blockedKind`), `FocusSignal`, eventos (`accountSwitched`, `sessionExited`, `pendingOpened`, `silence`, `tick`), `PetState`, `TrackedSession`, `Bubble`, `BubbleTarget`, `PetView` (inclui `size`, `docked`, `align`, `silenced`, `waiting[]`).
- [x] T005 [P] Criar `src/shared/pet/ipc.ts` com `PET_CHANNELS` (todos os canais de `contracts/ipc-pet.md`, mais `app:activate-session` e `pet:prefs-changed`), os tipos de payload e os validadores `isValidPetTabsPayload`, `isValidPetDragPayload`, `isValidPetOpenPayload`, `isValidPetResizeStepPayload` e `isValidPetPrefsInput`.

---

## Phase 2: Foundational (bloqueia todas as stories)

**Checkpoint ao fim**: com `pet.enabled = true`, a janela do pet abre
transparente no canto, deixa o clique atravessar o vazio e morre com a
principal. Com `false`, nada muda no app.

### Testes primeiro (devem falhar antes da implementação)

- [x] T006 [P] `tests/pet-tab-pty-map.test.ts`:
  - `tabPtyMap` dá `tab.id → ptyId` e o reverso;
  - aba sem PTY fica fora;
  - Retomar troca o ptyId da mesma aba;
  - a lista `pet:tabs` sai só com abas `claude` e com o nome resolvido.
- [x] T007 [P] `tests/pet-placement.test.ts` (monitores sintéticos com `bounds`/`workArea`/`scaleFactor`):
  - posição padrão a 16 px da direita com a base na base da área útil;
  - `docked` com barra embaixo (tolerância de 4 px);
  - encaixe ao soltar a até 24 px;
  - validade (metade do desenho dentro de alguma área útil);
  - `align` (`left`, `center`, `right`, 160 px das bordas);
  - limites da janela por tamanho (`max(480, 3,4 × s)` × `s + 200`), ancorados no ponto da base;
  - clamp do tamanho (80–320), passo de 10 e presets 100/140/200/260.
- [x] T008 [P] `tests/pet-poses.test.ts`:
  - `resolvePose` com o conjunto de arquivos disponíveis;
  - provisórias `impatient → skeptical`, `very-impatient → angry`, `calling → talking`;
  - `blink-*` opcional.
- [x] T009 [P] `tests/pet-config.test.ts`:
  - `sanitizePetPrefs`: `enabled` booleano (padrão `false`), `placement` com `x` e `y` finitos ou `null`, `size` limitado a 80–320 (padrão 140);
  - `pet` entra em `defaultAppConfig`/`toAppConfigDto`.
  - Ajustar os testes de forma exata em `tests/config-store.test.ts` e `tests/chat-config.test.ts`.
- [x] T010 [P] `tests/pty-kill-intent.test.ts`: `markKillRequested(ptyId)` e `consumeKillRequested(ptyId)` (`true` uma vez, depois `false`).

### Implementação

- [x] T011 [P] `src/shared/pet/tabPtyMap.ts`: funções puras de mapeamento e `buildPetTabsPayload(tabs, ptyIdOf, resolveName, activeTabId)` (passa T006).
- [x] T012 [P] `src/shared/pet/placement.ts`: `defaultPlacement`, `isDocked`, `snapOnDrop`, `isPlacementVisible`, `alignFor`, `windowBoundsFor(anchor, size)`, `anchorOf(bounds, size)`, `clampSize`, `PET_SIZE_PRESETS` (passa T007).
- [x] T013 [P] `src/shared/pet/poses.ts`: `resolvePose(logical, available)` e `PROVISIONAL_POSES` (passa T008).
- [x] T014 Config `pet` (passa T009), ligando nesta ordem:
  - `src/main/config-store.ts`: `AppConfig.pet`, `defaultAppConfig`, `sanitizePetPrefs` no `sanitizeAppConfig` e `toAppConfigDto`;
  - `src/shared/config.ts`: `AppConfigDto.pet`, `CONFIG_CHANNELS.setPetPrefs` e `DonelConfigApi.setPetPrefs`;
  - `src/preload/index.ts`: `config.setPetPrefs`.
  - O handler em `src/main/index.ts` entra na T020.
- [ ] T015 [P] `src/main/pty-kill-intent.ts` (passa T010) e uso em `src/main/index.ts`: o handler `pty:kill` (≈`:1394`) marca antes de matar; o listener de saída (≈`:975-1006`) consome e repassa `byUser` (C3).
- [ ] T016 C1 em `src/main/index.ts`:
  - `let mainWindowRef` mais `getMainWindow()`;
  - `isWindowFocused` (≈`:1114`) e o `onClick` do notifier (≈`:1124-1131`) passam a usar a principal;
  - gancho `onMainWindowClosed` chamado no `closed` da principal (≈`:1013`) **antes** do `killAll`, para o pet ser destruído.
- [x] T017 Rota `#pet` em `src/renderer/src/main.tsx`:
  - mantém os imports de CSS e do design system;
  - `location.hash === '#pet'` → `import('./pet/mountPet')`; senão → `import('./App')`, os dois dinâmicos;
  - `src/renderer/src/pet/mountPet.tsx` monta `<PetApp/>` e força fundo transparente em `html`, `body` e `#root`.
- [x] T018 Domínio `pet` no preload e nos tipos:
  - `src/shared/index.ts`: `DonelPetApi` em `DonelApi.pet`, com `sendTabs`, `onActivateSession`, `onPrefsChanged` (lado principal) e `ready`, `onView`, `setInteractive`, `click`, `open`, `setListOpen`, `openContextMenu`, `dragStart`/`dragMove`/`dragEnd`, `resizeStep` (lado pet);
  - `src/preload/index.ts`: implementação com `ipcRenderer.send` e `subscribeChannel`, como os outros domínios.
- [ ] T019 `src/main/pet/pet-window.ts`:
  - `createPetWindow({ bounds, onReady })` com `transparent`, `frame: false`, `resizable: false`, `hasShadow: false`, `skipTaskbar`, `alwaysOnTop`, `focusable: false`, `show: false`, `backgroundColor: '#00000000'`, `webPreferences` iguais às da principal (mesmo preload, `sandbox`, `contextIsolation`) e `backgroundThrottling: false`;
  - carga `loadFile(index.html, { hash: 'pet' })` ou URL de dev + `#pet`;
  - `setIgnoreMouseEvents(true, { forward: true })` por padrão;
  - guardas de navegação iguais às da principal;
  - `showInactive()` no `pet:ready`;
  - helpers `setInteractive`, `setListOpen` (`setFocusable` + `focus`), `moveTo` e `applyBounds`.
- [ ] T020 `src/main/pet/pet-service.ts` (dependências injetadas) e ligação em `src/main/index.ts`:
  - `createPetService({ getMainWindow, config, persist, createWindow, now, setInterval })`;
  - `enable()` e `disable()` criam e destroem a janela, mais o tick de 1 s;
  - recebe `pet:tabs` e foco (`focus`/`blur` da principal);
  - a vista vai por `pet:view` só quando muda;
  - o handler de `config:setPetPrefs` aplica na hora e emite `pet:prefs-changed` à principal;
  - o serviço nasce depois do `ready-to-show` da principal (R21).
- [ ] T021 `src/renderer/src/App.tsx`:
  - efeito sempre ligado que manda `pet:tabs` (com `buildPetTabsPayload`, dedupe por JSON);
  - assina `app:activate-session` (`ptyId → tab.id` e `setActiveTabId`);
  - assina `pet:prefs-changed` e atualiza `appConfig.pet`.
- [ ] T022 `src/renderer/src/Preferences.tsx` + handler em `App.tsx`:
  - `Toggle` "Jobu na área de trabalho", com uma linha de apoio: "Avisa quando uma sessão termina ou espera você, e quando a conta muda.";
  - `data-testid="preferences-pet-toggle"`;
  - grava por `config.setPetPrefs`.

---

## Phase 3: User Story 1 — Saber de relance se alguém espera (P1) 🎯 MVP

**Objetivo**: o rosto e o selo dizem o estado das sessões.
**Teste independente**: duas sessões, Donel minimizado; uma termina →
impaciente com selo 1; abrir a aba → selo some.

- [ ] T023 [P] [US1] `tests/pet-state.test.ts` (TDD, antes da T025):
  - `idle` até o primeiro update (R2) e `error` como `done`;
  - entrada em `waiting`/`permission` com `waitingSince`;
  - "visto": ao nascer com a aba ativa e o Donel em foco, e na mudança de foco;
  - volta a contar depois de `working`;
  - aba fechada sai sem evento;
  - selo `null`, `1`…`9`, `9+`;
  - prioridade da pose (cada linha da tabela);
  - `very-impatient` aos 10 min;
  - riso 2,5 s só por visita (fechar não ri);
  - waffle aos 20 min sereno, 8 s, uma vez por período;
  - `sleeping` sem sessões.
- [ ] T024 [P] [US1] `tests/pet-view.test.ts`: `waiting[]` com a mais antiga primeiro e os rótulos `agora`, `há 1 min`, `há 12 min`, `há 2 h`, mais a forma da `PetView`.
- [ ] T025 [US1] `src/shared/pet/petState.ts`: reducer `reducePet(state, input, now)` para sessões, foco e tick (ainda sem balões), com dedupe por estado (passa T023).
- [ ] T026 [US1] `src/shared/pet/petView.ts`: `toPetView(state, now, ui)` com pose, selo, lista, `size`, `docked`, `align` e `silenced` (passa T024).
- [ ] T027 [US1] Sinais em `src/main/pet/pet-service.ts`:
  - `semaphoreManager.onUpdate` (ptyId sem update ainda conta `idle`);
  - `unregister`/saída;
  - sessões vindas de `pet:tabs` (nome, quais existem) cruzadas com o semáforo.
  - Ligação em `src/main/index.ts` perto da criação do semáforo.
- [ ] T028 [US1] `src/renderer/src/pet/PetApp.tsx`, `PetApp.module.css` e `hitTest.ts`:
  - desenho da pose (`import.meta.glob('./assets/poses/*.png', { eager: true, import: 'default' })` mais `resolvePose`);
  - selo dourado (`var(--donel-accent)`, nunca roxo);
  - atributos `data-pose`, `data-badge` e `data-size`;
  - teste de clique pelo alfa (canvas fora da tela), mandando `pet.setInteractive` só na mudança;
  - altura do desenho = `view.size`.
- [ ] T029 [US1] `tests/smoke/pet.spec.ts` (`@pet`, parte 1):
  - config semeada com `pet.enabled` e CLI falso com roteiro de espera antes do `Stop` (fixture em `tests/fixtures/pet/scenarios/*.json`);
  - acha o pet pela URL `#pet`;
  - `sleeping` → aba aberta (`incense`) → prompt (`reading`);
  - minimiza a principal via `electronApp.evaluate` → `Stop` → `impatient` e `data-badge="1"`;
  - ativa a aba e restaura → selo some.

**Checkpoint**: US1 funcional e testada sozinha.

---

## Phase 4: User Story 2 — Aviso na hora (P1)

**Objetivo**: balão com pose de momento; o Windows não repete.
**Teste independente**: cada evento com o Donel minimizado gera o balão certo,
e nenhum aviso do Windows sai.

- [ ] T030 [P] [US2] `tests/pet-bubble.test.ts` (TDD):
  - textos exatos do FR-015 e corte em 28 caracteres + `…`;
  - pose por evento;
  - agregação até 1 s depois do nascimento, com o mesmo `id` (`N sessões terminaram` / `N sessões esperando você`);
  - refino do tipo por `pendingOpened`;
  - `waiting → permission` sem evento (R3);
  - `ended` só com `byUser = false`;
  - nascida vista sem balão;
  - silêncio bloqueia o balão;
  - conta nunca se junta;
  - expira em 6 s;
  - `target` certo.
- [ ] T031 [US2] `src/shared/pet/bubble.ts` (textos, corte, agregação) e eventos no `petState.ts` (passa T030).
- [ ] T032 [US2] Fontes de evento no main (`src/main/index.ts` + `pet-service.ts`):
  - `pendingOpened` do chat (≈`:1143`) → `onPendingOpened(ptyId, pending.kind)`;
  - saída de PTY com `consumeKillRequested` → `onSessionExited(ptyId, byUser)`.
- [ ] T033 [US2] Supressão dos avisos do Windows (R8):
  - `src/renderer/src/App.tsx` (efeito ≈`:1884`) sai cedo com `appConfig.pet?.enabled`;
  - `src/main/chat/notifications.ts` ganha a dependência `isPetEnabled` (com o pet ligado, não notifica);
  - caso novo em `tests/chat-notifications.test.ts`.
- [ ] T034 [US2] Balão no `PetApp.tsx`:
  - acima do desenho, alinhado por `view.align`, largura até 300 px, reticências;
  - pulinho só quando o `bubble.id` muda;
  - `data-bubble` com o texto.
- [ ] T035 [US2] `tests/smoke/pet.spec.ts` parte 2: com a principal minimizada, o balão `atlas · terminou` aparece; com chat e permissão, o stub `DONEL_SMOKE_NOTIFICATIONS_LOG` fica vazio com o pet ligado.

---

## Phase 5: User Story 3 — Um clique até a sessão (P1)

**Objetivo**: o clique leva à sessão certa.
**Teste independente**: uma sessão → um clique; três → lista.

- [ ] T036 [P] [US3] `tests/pet-click.test.ts`: `decideClick(view)` dá `session(ptyId)` com uma esperando, `list` com várias e `donel` com nenhuma; o alvo do balão vem de `bubble.target`.
- [ ] T037 [US3] `src/shared/pet/click.ts` (passa T036).
- [ ] T038 [US3] `pet-service.ts`:
  - `pet:click` e `pet:open` → `restore`/`show`/`focus` da principal e `app:activate-session`;
  - reserva `setAlwaysOnTop` liga e desliga se o foco falhar (R7, isolada numa função).
- [ ] T039 [US3] Lista no `PetApp.tsx`:
  - itens com nome e rótulo de espera, clique → `pet.open`;
  - `pet.setListOpen(true|false)`;
  - Esc e `blur` da janela fecham;
  - clique no balão → `open(target)` ou abre a lista.
- [ ] T040 [US3] C2 em `src/renderer/src/App.tsx`: `chat:focus-state` passa a mandar ptyIds e nomes por ptyId (`tabPtyMap`), e `chat:focus-pending` mapeia ptyId → `tab.id` antes do `setActiveTabId`.
- [ ] T041 [US3] `tests/smoke/pet.spec.ts` parte 3:
  - clique no desenho com uma esperando → a principal fica visível e a aba ativa;
  - com duas esperando, a lista mostra duas e o clique na segunda ativa a aba dela.

---

## Phase 6: User Story 4 — Troca de conta (P2)

- [ ] T042 [P] [US4] Casos em `tests/pet-bubble.test.ts`: `accountSwitched` dá `Conta → Interno 3`, pose `mirror` e alvo `donel`, e substitui o balão de sessão sem se juntar a ele.
- [ ] T043 [US4] `src/main/index.ts` `broadcastAccountsChanged` (≈`:791-802`) → `petService?.onAccountSwitched(label)`, independente do chat.
- [ ] T044 [US4] `tests/smoke/pet.spec.ts` parte 4 (`DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`, como `tests/smoke/accounts.spec.ts`): trocar de conta via `accounts.switch` → `data-bubble` com o rótulo.

---

## Phase 7: User Story 5 — Convivência (P2)

- [ ] T045 [P] [US5] `tests/pet-fullscreen-state.test.ts`: parser da saída do auxiliar (`2|3|4` → oculto, resto → livre; lixo → livre).
- [ ] T046 [US5] Arraste:
  - `src/renderer/src/pet/usePetDrag.ts`: limiar de 4 px, `dragStart`/`dragMove`/`dragEnd` com coordenadas de tela, sem `-webkit-app-region`;
  - `pet-service.ts`: move a janela, encaixa ao soltar, grava `pet.placement` e recalcula `docked` e `align`;
  - esmaecimento da base (máscara nos 18% de baixo) quando `!docked`, no `PetApp.module.css`.
- [ ] T047 [US5] Menu nativo em `pet-service.ts`:
  - Silenciar por 1 hora / Retomar avisos;
  - Esconder (`pet.enabled = false`, destrói a janela, `pet:prefs-changed`);
  - Voltar ao canto (`placement = null`);
  - submenu Tamanho (presets com marca no atual).
- [ ] T048 [US5] Redimensionar (FR-033):
  - Ctrl + roda sobre o desenho → `pet.resizeStep(±1)`;
  - `pet-service.ts` limita o tamanho, recalcula os limites ancorados na base (`windowBoundsFor`), grava `pet.size` e manda a vista.
- [ ] T049 [US5] Eventos de `screen` (`display-added`, `display-removed`, `display-metrics-changed`) → revalidam a posição (FR-005) e o `docked`.
- [ ] T050 [US5] `src/main/pet/fullscreen-watcher.ts` + `src/shared/pet/fullscreenState.ts` (passa T045):
  - PowerShell `-NoProfile` de vida longa com `Add-Type` P/Invoke `SHQueryUserNotificationState`, consulta a cada 1,5 s;
  - existe só com o pet ligado e reinicia com recuo;
  - em tela cheia faz `hide()`; ao voltar, `showInactive()`;
  - os avisos do Windows seguem calados (Q2).
- [ ] T051 [US5] `tests/smoke/pet.spec.ts` parte 5:
  - Esconder (pelo mesmo caminho do menu, exposto para teste) → a janela do pet fecha e o toggle das Preferências aparece desligado;
  - religar → volta;
  - `resizeStep` → `data-size` muda e o desenho continua no lugar (base fixa).

---

## Phase 8: User Story 6 — Vida (P3)

- [ ] T052 [US6] `PetApp.module.css`:
  - balanço leve em repouso (±2 px, 3,5 s), quase parado em `sleeping`;
  - pulinho (classe ligada ao `bubble.id`);
  - `prefers-reduced-motion` desliga os dois.
- [ ] T053 [US6] Piscar em `PetApp.tsx`: com `blink-neutral`/`blink-impatient` disponíveis e pose `neutral`/`impatient`, troca o quadro por 120 ms a cada 4–7 s; sem a arte, não pisca.

---

## Phase 9: Polish e entrega

- [ ] T054 Verificação completa, lendo a saída:
  - `npm run typecheck`, `npx vitest run` e `npm run build`;
  - smokes `@pet`, os de chat e o de config, por área.
  - Flake conhecido (`AttachConsole`, PTY sob carga): repetir isolado e registrar.
- [ ] T055 Fechar a documentação:
  - status de spec, plano e tarefas;
  - `duvidas.md` final;
  - `design/design-system.md` §10: pet implementado, com o mapa de poses.
- [ ] T056 Fazer push da branch, abrir PR para `staging` e mergear com `gh pr merge --merge` depois de verde (nunca `--admin`; `main` e o público não são tocados).
- [ ] T057 Gerar o alfa:
  - worktree `../donel-dev-alfa`: `git fetch` + `merge --ff-only origin/staging`, `npm install` e `npm run dist:alfa`;
  - conferir os marcadores do pet no `app.asar` do `win-unpacked`;
  - instalar só se o Alfa estiver fechado; senão, deixar o instalador pronto e dizer.
- [ ] T058 Página de resultado em HTML local (nunca Artifact), em `design/jobu-pet/resultado.html`, aberta com `Start-Process`:
  - prints **reais** do pet sobre a área de trabalho, capturados com o app rodando (`@pet` + captura de tela inteira);
  - link para o protótipo;
  - as dúvidas;
  - a bateria B1–B6 com "funcionou / não funcionou" e nota, em `localStorage`, com botão que baixa `.json` para Downloads.
- [ ] T059 Vault: `Projects/donel-dev/jobu-donel/PROXIMO.md` (fases ✅), `context.md` (marco) e `todo.md` (item vivo com o que é do dono).

---

## Dependencies & Execution Order

- **Setup (T001–T005)**: T001/T002 correm na worktree de arte. T003 depende dos dois. T004/T005 não têm dependência.
- **Foundational (T006–T022)**: depende de T004/T005. Testes T006–T010 em paralelo; T011–T013 em paralelo; T014–T022 em sequência (mesmos arquivos `index.ts`/`App.tsx`). **Bloqueia todas as stories.**
- **US1 (T023–T029)** → **US2 (T030–T035)** → **US3 (T036–T041)**: em sequência. Todas mexem em `petState.ts`, `pet-service.ts` e `PetApp.tsx`.
- **US4 (T042–T044)** depende de US2 (balão). **US5 (T045–T051)** depende de US3 (lista, clique). **US6 (T052–T053)** depende de US1.
- **Polish (T054–T059)**: depende de todas.

### Parallel Opportunities

- T001 ‖ T002 ‖ T004 ‖ T005 (arte na worktree, tipos no checkout principal).
- T006 ‖ T007 ‖ T008 ‖ T009 ‖ T010, depois T011 ‖ T012 ‖ T013.
- Dentro de cada story, os testes `[P]` podem ser escritos juntos. A implementação é sequencial, porque divide arquivo.

## Implementation Strategy

- **MVP = Foundational + US1**: o rosto e o selo, já úteis sem balão.
- Depois US2 e US3 (os P1 restantes), US4/US5 (P2) e US6 (P3).
- Um executor por fase, gate verificado pelo orquestrador (typecheck + vitest
  e, a partir da US1, o smoke `@pet` da fase), commit atômico por tarefa ou
  grupo coeso, e um PR só para `staging` no fim (T056).
