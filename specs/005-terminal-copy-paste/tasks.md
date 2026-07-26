# Tasks 005 — Terminal: copiar/colar/imagem por tipo de sessão

**Status:** ✅ **T501–T509 ENTREGUES** (implementação completa + roteiro
E2E escrito) — **T510 PENDENTE** (build/reinstalação/E2E é ato humano,
depende de cota real — cota semanal esgotada em 25/07). Ver
`specs/005-terminal-copy-paste/roteiro-e2e.md` e
`.esteira-local/005-terminal-copy-paste/result.json`.
**Atualizado:** 2026-07-26 (implementação, sessão-cockpit)
**Branch:** `feature/mvp-p0` (mesma; tudo local, **sem push e sem PR**).
**10 tasks** — `T501`–`T510`, contíguas na ordem de dependência (Fatias 1–4).
**Referências:** `spec.md` (CA-1..CA-9) · `plan.md` (Fatias 1–4) ·
`spike-1-imagem-no-conpty.md` (contrato do clipboard, provado em ConPTY real).
**Ordem entre features (24/07):** B11 → 004 → 006 → **005 (esta)**. É a única
das três **independente** (mexe em xterm/PTY, não no `.jsonl`) — pode entrar a
qualquer momento sem esperar 004/006.

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
**TDD obrigatório** nos módulos puros (`resolveTerminalKeyAction`,
`clipboard-bridge`) — teste falhando primeiro. UI valida por smoke roteirizado
+ E2E manual no app instalado (padrão da rodada 5).

> **Fato herdado que não pode ser esquecido:** hoje `term.onData`
> (`TerminalPane.tsx:337-341`) repassa **todo byte cru** ao PTY, inclusive o
> `\x03` do `Ctrl+C` — é a causa da dor. Nenhuma task abaixo remove esse
> caminho; elas colocam um decisor **antes** dele.

## Fase A — Fatia 1: decisor puro (invisível ao usuário)

- ✅ **ENTREGUE** (commit `99ab347`) — **T501 — `resolveTerminalKeyAction` (TDD, módulo puro)** — `src/shared/terminalKeymap.ts` (novo)
  Módulo **sem** xterm/Electron/DOM: recebe `{ key, ctrlKey, shiftKey, altKey,
  metaKey, type }` + `TerminalKeyContext { sessionType, hasSelection,
  clipboardHasImage }` e devolve `TerminalKeyAction`
  (`passthrough` | `copySelection` | `pasteText` | `pasteImage` | `noop`).
  Implementar **exatamente** a tabela do `plan.md` (Fatia 1). Guard rails na
  ordem certa: (1) `type !== 'keydown'` → `passthrough`; (2) `shiftKey` ou
  `altKey` ou `metaKey` → `passthrough` (protege CA-7 e CA-8 e evita
  `Ctrl+Alt+V` virar colagem); (3) só então `Ctrl+C`/`Ctrl+V`.
  A constante da tecla de imagem (`IMAGE_PASTE_SEQUENCE = '\x1b\x76'`) mora
  aqui, com comentário apontando para `spike-1-imagem-no-conpty.md`.
  **DoD:** `tests/terminalKeymap.test.ts` verde com **um caso por linha da
  tabela × 2 tipos de aba**, mais: `keyup` → passthrough, `Ctrl+Alt+V` →
  passthrough, `Ctrl+Shift+C` → passthrough, `Esc`/`ArrowUp`/`Home`/`Delete`/
  `Tab` → passthrough (CA-9), `Ctrl+C` sem seleção em aba claude → `noop`
  (**assertar explicitamente que NÃO é passthrough** — é o CA-2, o coração da
  dor), `Ctrl+C` sem seleção em aba shell → `passthrough` (CA-6).

- ✅ **ENTREGUE** (commit `99ab347`) — **T502 [P] — Export no barrel do shared** — `src/shared/index.ts`
  Exportar o módulo e os tipos no padrão dos vizinhos (`export { ... } from './terminalKeymap'`).
  **DoD:** `npm run typecheck` 0 erros.

## Fase B — Fatia 2: adaptador de clipboard (main + IPC + preload)

> Independente da Fase A (arquivos distintos) — pode ir em paralelo.

- ✅ **ENTREGUE** (commit `87a4a26`) — **T503 — `clipboard-bridge` (TDD)** — `src/main/clipboard-bridge.ts` (novo)
  Três funções finas sobre o `clipboard` do Electron: `hasImage()` →
  `!clipboard.readImage().isEmpty()`; `readText()`; `writeText(s)`.
  **Regra dura:** qualquer exceção do clipboard é engolida e degrada
  (`hasImage` → `false`, `readText` → `''`) — clipboard indisponível **nunca**
  pode derrubar a digitação ou quebrar a aba.
  **DoD:** `tests/clipboard-bridge.test.ts` verde com `electron.clipboard`
  mockado: imagem vazia → `false`; imagem não vazia → `true`; `readImage`
  lançando → `false` (não propaga); `readText`/`writeText` repassando.

- ✅ **ENTREGUE** (commit `87a4a26`) — **T504 — Canais IPC + contrato `DonelApi`** (sequencial após T503) — `src/shared/index.ts`, `src/preload/index.ts`, `src/main/index.ts`
  `CLIPBOARD_CHANNELS = { hasImage, readText, writeText }` no padrão de
  `PTY_CHANNELS`; handlers registrados no main (`ipcMain.handle` para
  `hasImage`/`readText`, `ipcMain.on`/`handle` para `writeText`); exposição em
  `preload` como `window.donel.clipboard.*`, tipada em `DonelApi`.
  **Não** usar `navigator.clipboard` no renderer (`contextIsolation: true`,
  sem `nodeIntegration` — ver `plan.md` decisão 6).
  **DoD:** typecheck verde; contrato tipado ponta a ponta (shared → preload →
  renderer), sem `any`.

## Fase C — Fatia 3: ligação no TerminalPane (a mudança visível)

> Depende de T502 **e** T504. Só aqui o comportamento muda para o usuário.

- ✅ **ENTREGUE** (commit `d3751db`) — **T505 — `sessionTypeRef`** — `src/renderer/src/TerminalPane.tsx`
  Ref atualizada a cada render com a prop `sessionType` (padrão já usado no
  arquivo com `ptyIdRef`/`mountEpochRef`), para o handler nunca ler valor
  congelado no closure.
  **DoD:** typecheck verde; nenhuma mudança de comportamento ainda.

- ✅ **ENTREGUE** (commit `d3751db`) — **T506 — `attachCustomKeyEventHandler` + execução das ações** (sequencial após T505) — `src/renderer/src/TerminalPane.tsx`
  Registrar o handler logo após `term.open(container)` (`:~336`), **mantendo
  `term.onData` intacto** (`plan.md` decisão 2). Mapear:
  `copySelection` → `clipboard.writeText(term.getSelection())`, retorna `false`;
  `pasteImage`/`pasteText` → ver T507; `noop` → retorna `false` sem efeito;
  `passthrough` → retorna `true`.
  **DoD:** typecheck + suíte unit inteira verdes; `Ctrl+C` com seleção copia e
  a execução não morre (verificado no smoke/E2E, não por unit).

- ✅ **ENTREGUE** (commit `d3751db`) — **T507 — Dança async do `Ctrl+V`** (sequencial após T506) — `src/renderer/src/TerminalPane.tsx`
  `attachCustomKeyEventHandler` é **sincrônico** e `hasImage()` é IPC async.
  Padrão do `plan.md` (Fatia 2): ao identificar `Ctrl+V`, **cancelar já**
  (`return false`) e resolver async qual colagem fazer — seguro porque as duas
  saídas são ações nossas, nunca há `Ctrl+V` em aba claude que devesse passar
  cru. Então: `hasImage()` → se `true`, escrever `\x1b\x76` no PTY (**e nada
  mais** — sem temp, sem base64, sem spinner nosso, CA-4/CA-4b); se `false`,
  `readText()` → escrever no PTY envolvido em `\x1b[200~`…`\x1b[201~` em aba
  **claude** (CA-3, resolve "colar multilinha" do batch-5) e **cru** em aba
  shell. Normalizar `\r\n` → `\r`. Texto vazio → não escrever nada.
  **DoD:** typecheck + suíte verdes; sem `unhandled rejection` (a promise tem
  `.catch`); nenhum byte espúrio quando o clipboard está vazio.

- ✅ **ENTREGUE** (commit `842ea39`) — **T508 [P] — Smoke roteirizado** — `tests/smoke/`
  No padrão dos smokes da rodada 5 (isolados do `%APPDATA%` real): garantir que
  o decisor está ligado no caminho real — aba claude não emite `\x03` no
  `Ctrl+C`, aba shell emite. Se montar xterm em jsdom se mostrar caro demais,
  registrar aqui a decisão e cobrir só por E2E manual — **não** inflar o smoke.
  **DoD:** smoke verde e rodando no comando de suíte existente.

  **Entregue parcialmente por decisão registrada, dentro da própria cláusula
  de escape acima:** `tests/smoke/terminal-copy-paste.spec.ts` prova CA-6
  (aba shell, `Ctrl+C` sem seleção mata um `ping -t` real — custo zero de
  cota, 3x sem flake). A metade "aba claude não emite `\x03`" NÃO tem
  equivalente automatizado aqui — provar isso sem gastar cota real exigiria
  ou um hook só-de-teste fora do escopo do tasks.md, ou confiar num sinal
  falso-positivo (CLI ocioso sobrevive a um `\x03` cru de qualquer jeito,
  com ou sem a correção). Cobertura real: unit exaustivo (T501) + passo (a),
  obrigatório, do roteiro E2E (T509/T510). Detalhes no cabeçalho do próprio
  arquivo de spec.

## Fase D — Fatia 4: validação real (só o humano fecha)

- ✅ **ENTREGUE** — **T509 — `roteiro-e2e.md`** — `specs/005-terminal-copy-paste/roteiro-e2e.md`
  Roteiro no formato do `specs/002-quota-headroom/roteiro-e2e.md`, cobrindo o
  que está no `plan.md` Fatia 4. Passos obrigatórios que **não** podem faltar:
  (a) `Ctrl+C` sem seleção **durante uma execução longa** em aba claude — a
  execução **não pode morrer** (é a dor original relatada); (b) colar print →
  `[Image #N]` em ~1,5 s; (c) colar 5 linhas → `[Pasted text #N]`, não 5
  Enters; (d) aba shell: `Ctrl+C` mata `ping -t`; (e) `Ctrl+Shift+C/V` ainda
  funcionam (CA-7); (f) `Alt+V` ainda cola imagem (CA-8); (g) setas/Home/End/
  PgUp/PgDn/Del/Tab nas duas abas (CA-9, C3).
  **DoD:** roteiro escrito, com resultado esperado por passo.

- ✅ **T510 EXECUTADO E APROVADO por ele em 2026-07-26** — o E2E rodou no build
  **integrado** (005 + 007 no mesmo instalador, branch `lote/005-007-e2e`, merge
  `--no-ff` das duas sobre `6894d00`), pelo roteiro único
  `specs/roteiro-e2e-lote-005-007.md`, e ele reportou: *"O e2e rodou
  corretamente!"*.
  **Por que num build integrado e não dois apps lado a lado:** os dois installs
  compartilham `%APPDATA%\donel-dev\config.json` e o `AppConfig` do build da 005
  tem lista fechada de campos — sem `sessionRegistry`/`collapsedFavorites`. Toda
  escrita do app da 005 apagaria o registro de favoritos da 007 (verificado no
  código, não suposto), sabotando o E2E da 007.
  **O que isso fecha:** a prova ponta-a-ponta que faltava desde 25/07 por cota
  esgotada — antes desta rodada, CA-1..CA-5, CA-7 e CA-8 tinham só prova unit
  (`tests/terminalKeymap.test.ts` prova a DECISÃO, não o fio até o PTY real).
  **Detalhe não capturado:** ele aprovou o roteiro como um todo, sem reportar
  resultado passo a passo — em particular não confirmou explicitamente se o passo
  3 (`Ctrl+C` sem seleção DURANTE uma execução longa, o único que exige turno real
  de modelo) rodou com cota folgada ou foi pulado. Se foi pulado, esse CA
  específico segue sem prova E2E.
  **Consequência para o §B14/`docs/LEIA-ME-colegas.md`:** o item "Ctrl+C" em
  "Limitações conhecidas" fica FALSO quando esta branch mergear — é edição à mão,
  o `scripts/publicar.ps1` não sabe disso (já está no `todo.md` do vault).

- ⏸️ ~~PENDENTE — ATO HUMANO, depende de cota real~~ — **T510 — Build + reinstalação + E2E do Alexandre** (sequencial após T509)
  **Uma única** build/reinstalação, ao fim (não reinstalar entre fatias).
  Rodar o T509 no atalho "Donel Dev" do Desktop, com um print real no
  clipboard. **Ato humano** — não declarar a entrega pronta sem esta rodada.
  **DoD:** todos os passos do roteiro com resultado registrado; falhas voltam
  como tasks novas.

  **Nada rodado aqui de propósito:** `npm run build` já foi validado (usado
  pelos smokes, T508) mas `npm run dist` (empacotar o instalador) e a
  instalação em si ficam de fora — "instalar é ato do Alexandre" (CLAUDE.md,
  §B14 do backlog: há duas instalações na máquina e instalar sobrescreve
  uma delas). O passo (a) do roteiro (`Ctrl+C` sem seleção DURANTE uma
  execução longa) também depende de cota real, esgotada em 25/07. **Sem
  validação humana:** todo o bloco "Aba claude" do roteiro (passos 1–8) —
  ver seção final de `roteiro-e2e.md`.

## Fora de escopo (decidido no clarify — não implementar)

- **C4:** copy-on-select, menu de contexto (botão direito), seleção que
  sobrevive a output novo → seguem no backlog B7.
- **C5:** schema de keybindings configuráveis em `config-store.ts`.
- Editar `~/.claude/keybindings.json` do usuário (config global, afeta o claude
  fora do Donel — `spike-1-imagem-no-conpty.md`, consequência 5).
- Colar imagem em aba **shell** (US-C é só aba claude).
- Overlay/máscara sobre o output bruto do PTY (spec própria, no `todo.md`).

## Gate do cockpit — 2026-07-26 (rodado pelo orquestrador, não pelo implementador)

Suíte rodada **serializada** (uma worktree por vez), na worktree
`donel-dev-wt-005`, commit de topo `91ae2a2`:

| Verificação | Resultado medido |
|---|---|
| `npm run build` | ok (bundle 767 KB) |
| `npm run typecheck` | limpo |
| `npm test` | **488 passed / 0 failed** (29 arquivos) |
| `test:smoke` | **22 passed / 7 failed**, 8,2 min |
| `test:smoke:dev` | **1 passed / 0 failed** |

**Nenhuma regressão desta feature.** Os 7 vermelhos, todos com causa nomeada e
verificada:

- 2 × `previous-sessions.spec.ts` → dívida T013, é o baseline do §B11.
- 3 × `session-rename.spec.ts` + 1 × `session-rename-live.spec.ts` → **artefato de
  worktree** (§B17, achado neste gate): os specs semeiam a fixture no diretório
  derivado da pasta atual (`...donel-dev-wt-005`) e clicam no projeto pelo nome
  hardcoded `donel-dev`. **Grupo de controle:** os mesmos arquivos na pasta
  principal `donel-dev`, no mesmo base `fda3e49`, passaram 4/4 e 1/1.
- 1 × `session-context.spec.ts:86` → §B15 (`fs.watch` perde evento). Falhou também
  na base `fda3e49` na pasta principal e **passou nas duas retentativas** ali.

**Merge com a `feat/007-favoritos-sessoes`: limpo** (`git merge-tree`, sem
conflito) — a disciplina aditiva nos três arquivos compartilhados funcionou.

`npm run dist` executado pelo cockpit: instalador em
`donel-dev-wt-005/release/`. **Instalar segue sendo ato do Alexandre** (§B14).
