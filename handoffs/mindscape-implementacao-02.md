# /implementacao — Mindscape, fatia 02

**Fatia**: 02 — Destaque da sessão e "Ir ao terminal"
**Data**: 2026-10-24 · **Branch**: `feature/mindscape` (checkout principal) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (`sessionHighlight`) + `teste-depois` (tela, por smoke)

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-23** ("Você pode seguir a estrutura atual da esteira, só que vai tomando as decisões"):

- **Sem worktree, no checkout principal, `feature/mindscape`; inline** — mesma instrução da fatia 01 (trabalho serial, todas as fatias pisam nos mesmos arquivos).
- **"Demais estados" inclui `done`** além de `waiting`/`error`/`permission`: o design diz "demais estados → destacada se..."; só `working` é normal. Por quê: é a leitura literal do design.
- **Botão "Ir ao terminal" numa barra do quadro** (acima do canvas), habilitado só com post-it de sessão selecionado, e não dentro do cartão. Por quê: cabe sem estourar os 96 px do cartão (a grade automática da 01 conta com essa altura) e é o lugar onde a barra da fatia 04 vai morar.
- **Aparência**: destacada = anel na cor do estado (como o `st-permission` do protótipo, generalizado); apagadinha = fundo `--bg-panel`, nome em `--text-muted`, opacidade 0,6 (como o `st-done` do protótipo); normal = sem anel. Os anéis por estado da 01 passaram a valer só para a destacada. Selecionado = contorno `--accent`. Por quê: forma do protótipo, mínimo que torna as 3 aparências distinguíveis.
- **Seleção** some ao clicar no fundo do quadro; Enter no cartão em foco também vai ao terminal (acessibilidade de teclado, mesmo gesto do duplo clique).
- **Carimbo de `seenAt`** por `claudeSessionId`, com `Date.now()` no renderer (o semáforo usa `Date.now` no main — mesmo relógio). Se a aba ainda não tem `claudeSessionId` no instante do foco, o carimbo de "sair do Uso geral" cobre.

## O que foi feito

- `src/shared/mindscape/highlight.ts` — `sessionHighlight(state, stateEnteredAt, seenAt)` → `normal | highlighted | dimmed`.
- `src/renderer/src/App.tsx` — `stateEnteredAt` nas sessões do Mindscape; mapa `mindscapeSeenAt` em memória, carimbado ao focar aba no Uso geral e ao sair do Uso geral com aba em foco; `handleMindscapeGoToTerminal` (`setAppMode('geral')` + `setActiveTabId`).
- `src/renderer/src/Mindscape/MindscapeScreen.tsx` — seleção de cartão, barra "Quadro" com "Ir ao terminal", cálculo do destaque por cartão.
- `src/renderer/src/Mindscape/MindscapeCard.tsx` — props `highlight`/`selected`/`onSelect`/`onOpen`; `data-highlight`, `data-selected`; clique, duplo clique e Enter.
- `src/renderer/src/Mindscape/Mindscape.module.css` — `.highlighted`, `.dimmed`, `.selected`, barra de ferramentas.
- Testes: `tests/mindscape-highlight.test.ts` (10, vermelho antes do código: módulo inexistente), `tests/smoke/mindscape-highlight.spec.ts`.

Nenhuma dependência nova. Nada em `src/main/accounts/`, Modo Dev ou `config.json`. `seenAt` não persiste (fora da V1).

## Gates (saída observada)

- `npm test` → `Tests  4881 passed (4881)` (206 arquivos)
- `npm run typecheck` → `> tsc --noEmit -p tsconfig.json` (exit 0, sem erros)
- `npm run build` → `✓ built in 5.33s` (exit 0)
- Smoke: `npx playwright test -c tests/smoke/playwright.config.ts mindscape tabs-v3 empty-state` → `5 passed (29.6s)`
- Repo não tem script de lint (lacuna conhecida, não montada).

## Plano de testes, item a item

- vitest `working` → normal (com `seenAt` antes, depois e ausente) ✔
- `waiting`/`done`/`error`/`permission` com `stateEnteredAt > seenAt` → destacada ✔; `<=` → apagadinha (inclui igual) ✔
- `seenAt` ausente conta como 0 ✔
- smoke: aba A (`atlas`, um turno rápido) e aba B (`atlas-b`, pelo Launcher, no mesmo projeto); B recebe o turno lento e o foco vai para A antes de B terminar → no Mindscape B `data-highlight="highlighted"` e A `dimmed` ✔; duplo clique em B → modo "Uso geral" marcado e aba B focada ✔; voltar ao Mindscape → B `dimmed` ✔; "Ir ao terminal" desabilitado sem seleção, clicar A seleciona, "Ir ao terminal" → aba A focada ✔. Inspeção visual do print (B com anel dourado, A apagada).

## Dados necessários (seed)

Sem banco. O spec monta root temporário com `atlas/CLAUDE.md`, `config.json` com `projectRoots`, `DONEL_MINDSCAPE_FILE` temporário e reaproveita o roteiro `tests/fixtures/mindscape/scenarios/slow-turn.json` da 01 (o `Stop` do turno lento é o "fim de turno" do plano).

## Pendências e lacunas

- Suíte smoke inteira e `npm run test:smoke:dev` não rodados; só os specs acima.
- Sem lint no repo.
- Próxima etapa: `/revisao` (ou seguir para a fatia 03/04, que dependem só da 01).
