# /implementacao — Mindscape, fatia 01

**Fatia**: 01 — Modo Mindscape com post-its de sessão vivos, por projeto
**Data**: 2026-10-24 · **Branch**: `feature/mindscape` (checkout principal) · **taskdex**: [] (ferramenta pessoal, sem card)

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-23** ("Você pode seguir a estrutura atual da esteira, só que vai tomando as decisões"):

- **Sem worktree, no checkout principal, branch `feature/mindscape`** — a skill pede worktree por fatia; o despacho e o cabeçalho do BACKLOG mandam trabalho sequencial na `feature/mindscape`. Por quê: serial, todas as fatias pisam nos mesmos arquivos.
- **Modo de execução: inline** (sem oferta despachar × inline) — sessão já é o worker desta fatia.
- **Grade automática**: 4 colunas, cartão 230 × 96, folga de 24 px, origem (40, 40); primeiro espaço livre que não sobrepõe nenhum cartão. Por quê: o mais simples que cumpre "sem sobrepor".
- **Abas do Mindscape = quadros do documento** (não só os com sessão viva agora), na ordem em que nasceram; abre no projeto da aba em foco, senão no primeiro. Por quê: o quadro persiste e deve aparecer depois de relançar.
- **"Aba com projeto"** = aba `claude` com `claudeSessionId`, `cwd` e `projectName` (o mesmo critério que já liga aba a projeto na barra lateral).
- **Glifos de estado copiados** de `TerminalTab` (`SESSION_STATE_ICON` não é exportado pelo design system) em vez de mexer no design system.
- **Sessão nova aparece "Trabalhando"** até o primeiro `Stop`: é o comportamento atual do semáforo da aba; o post-it só o espelha. O smoke manda um prompt rápido antes para ver "Aguardando resposta".
- **`parseMindscapeDoc` não poda ligações órfãs** — guarda toda ligação bem formada (o design manda guardar ligação para sessão sem aba).
- **Store relê o disco a cada `save`** para checar `schemaVersion` (outro canal pode ter atualizado o arquivo no meio-tempo).

## O que foi feito

- `src/shared/mindscape/model.ts` — tipos do design + `emptyMindscapeDoc`, `ensureBoard`, `placeSessionCard`, `parseMindscapeDoc`.
- `src/shared/mindscape/channels.ts` — `mindscape:load` / `mindscape:save`, `DonelMindscapeApi`.
- `src/main/mindscape-store.ts` — load/save atômico (temp → fsync → rename via `ConfigIoDeps`), schema guard (`read-only`), `write-failed`, `DONEL_MINDSCAPE_FILE`.
- `src/main/index.ts` (handlers), `src/preload/index.ts` (`window.donel.mindscape`), `src/shared/index.ts` (tipo no `DonelApi`).
- `src/renderer/src/Mindscape/` — `useMindscapeDoc.ts` (boot + debounce 500 ms, nada grava antes do load), `MindscapeScreen.tsx`, `MindscapeCard.tsx`, `Mindscape.module.css` (forma da variante A).
- `src/renderer/src/App.tsx` — `appMode` de 3 valores (`devModeOn` derivado), terceira opção "Mindscape" no seletor, sessões vivas derivadas das abas, `placeSessionCard` automático depois do load, tela por cima do miolo (terminais seguem montados).
- Testes: `tests/mindscape-model.test.ts` (10), `tests/mindscape-store.test.ts` (6), `tests/smoke/mindscape.spec.ts` + `tests/fixtures/mindscape/scenarios/slow-turn.json`.

Nenhuma dependência nova (o `roughjs` é da fatia 05). Nada em `src/main/accounts/`, Modo Dev ou `config.json`.

## Gates (saída observada)

- `npm test` → `Tests  4870 passed (4870)` (exit 0)
- `npm run typecheck` → `> tsc --noEmit -p tsconfig.json` (exit 0, sem erros)
- `npm run build` → `✓ built in 7.92s` (exit 0)
- Smoke: `npx playwright test -c tests/smoke/playwright.config.ts mindscape tabs-v3 empty-state` → `4 passed (19.6s)`

Observação: numa rodada anterior do `npm test` o `tests/hook-bridge.contract.test.ts > release answers {}` falhou uma vez ("no pending event", espera por `tick()` sob carga); passou isolado com e sem as mudanças e na rodada completa seguinte. Instável, não relacionado à fatia; nada foi alterado nele.

## Plano de testes, item a item

- `ensureBoard` cria quadro novo e é idempotente → vitest (cria; mesmo objeto de volta; não mexe nos outros quadros).
- `placeSessionCard` dá posição de grade sem sobrepor e mantém a posição salva → vitest (6 cartões sem sobreposição; desvia de cartão do dono no 1º espaço; posição salva preservada, mesmo objeto).
- `parseMindscapeDoc` → vitest (lixo/ausente → vazio; ida e volta; cartão do dono `permission` descartado; `pan` e ligações preservados).
- Store → vitest (temp → rename; payload validado; `schemaVersion: 2` → `{ ok: false, reason: 'read-only' }` sem escrever; rename falho → `write-failed` e temp apagado; override `DONEL_MINDSCAPE_FILE`).
- Smoke: abas `atlas` e `beacon` aparecem; em `atlas`, um post-it com o nome da aba, selo "Sessão" e o mesmo rótulo de estado do ícone da aba; prompt lento → `working` e volta a `waiting` sem recarregar; `beacon` mostra só a sessão de lá; Dev e Uso geral voltam, as 2 abas seguem e o terminal mantém o conteúdo; `mindscape.json` tem os dois quadros e, relançado com o mesmo arquivo, as duas abas voltam e o arquivo continua com os dois.

## Dados necessários (seed)

Não há banco. O estado do smoke é montado pelo próprio spec: root temporário com `atlas/CLAUDE.md` e `beacon/CLAUDE.md`, `config.json` com `projectRoots`, `DONEL_MINDSCAPE_FILE` temporário e o roteiro `tests/fixtures/mindscape/scenarios/slow-turn.json` (prompt `pedido` segura 4 s).

## Pendências e lacunas

- `npm run test:smoke:dev` (Modo Dev) e a suíte smoke inteira não foram rodados; só os 3 specs acima.
- `npm install` falhou no `postinstall` (`electron-rebuild` do `node-pty` sem Visual Studio na máquina); o app roda com o prebuild `win32-x64` do `node-pty` e o binário do Electron foi baixado à mão (`node node_modules/electron/install.js`). `package-lock.json` não mudou.
- Débito fora do escopo: `SESSION_STATE_ICON` poderia ser exportado pelo design system para não duplicar os glifos.
- Próxima etapa: `/revisao` desta fatia (ou seguir para a fatia 02, que depende desta).
