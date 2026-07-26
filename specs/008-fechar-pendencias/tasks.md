# 008 — Fechar as pendências antes do Modo Dev · tasks

**Criado:** 2026-07-26 · **Referência:** `plan.md` deste diretório +
`medicao-t710.md` · requisitos em `specs/backlog.md` §B19 e
`specs/007-favoritos-sessoes/spec.md` CA-11.

**11 tasks** — `T801`–`T811`, em 3 batches. Convenções: TDD nos módulos puros;
`npm run typecheck` + `npm test` verdes antes de cada commit de batch; smokes
exigem `npm run build` ANTES (rodam `out/main/index.js`); commit por task ou
batch, Conventional Commits, **por caminho explícito** (nunca `git add -A`).

---

## Batch A — §B19: o nome do projeto passa a ser calculado

> Só toca `tests/`. Fecha com `npm test` verde + os 5 specs do §B19 passando na
> worktree (a prova real fica no T809, com a suíte inteira).

- **T801 — Helper compartilhado do repo sob teste** — `tests/smoke/repoUnderTest.ts` (novo)
  Exporta `REPO_ROOT` (`path.resolve(__dirname, '../..')`), `PROJECT_NAME`
  (`path.basename(REPO_ROOT)`), `APP_MAIN`, `slugifyProjectPath()` (duplicado de
  propósito de `src/main/session-indexer.ts` — smokes não importam de `src/`) e
  `SESSIONS_DIR`. Comentário de topo explica **por que** é calculado (§B19) e por
  que o nome e o `SESSIONS_DIR` saem do MESMO módulo.
  `favorite-sessions.spec.ts` passa a importar dele em vez de calcular inline.
  **DoD:** `npm run typecheck` verde; `favorite-sessions.spec.ts` continua verde
  na pasta principal (é a referência de forma, não pode regredir).

- **T802 — Grupo A: os 4 specs que cruzam fixture × sidebar** (sequencial após T801) — `tests/smoke/session-rename.spec.ts` · `session-rename-live.spec.ts` · `session-context.spec.ts` · `previous-sessions.spec.ts`
  Trocar o nome hardcoded pelo `PROJECT_NAME` do helper e apagar as 4 cópias
  locais de `slugifyProjectPath`/`SESSIONS_DIR` (linhas nomeadas na tabela do
  Grupo A do `plan.md`). São estes que falham 100% das vezes em worktree.
  **DoD:** os 4 arquivos verdes na pasta principal; `session-rename` 4/4 e
  `session-rename-live` 1/1 (mesmos números do grupo de controle do §B19).
  `previous-sessions` mantém os 2 vermelhos da dívida T013 — e **só** eles.

- **T803 — Grupo B: os 9 specs que passavam por sorte** [P] (independente do T802 — arquivos disjuntos) — `config-persistence.spec.ts` (92, 180) · `model-injection.spec.ts` · `empty-state.spec.ts` · `profiles.spec.ts` · `tabs-lifecycle.spec.ts` · `sidebar-favorites.spec.ts` · `shell.spec.ts` · `terminal.spec.ts` · `smoke-dev/dev-mode.spec.ts`
  Mesmo helper. **NÃO TOCAR** nas 3 ocorrências do Grupo C:
  `config-persistence.spec.ts:158` (`%APPDATA%\donel-dev` = nome do APP),
  `config-persistence.spec.ts:36` (root fantasma) e
  `userDataIsolation.ts:27` (prefixo de `mkdtemp`).
  Em `terminal.spec.ts`, preservar a escolha deliberada de as linhas 101–105
  usarem **outro** projeto (evita colisão de clique na sidebar).
  **DoD:** `npm run typecheck` verde; cada arquivo tocado roda verde isolado na
  pasta principal (ou com o vermelho já nomeado no §B11, declarado).

- **T804 — Cerca de regressão do §B19 (TDD)** [P] — `tests/smoke-project-name.test.ts` (novo)
  Vitest que lê os arquivos de `tests/smoke/` + `tests/smoke-dev/` e falha se
  `'donel-dev'` aparecer em código executável fora de uma **allowlist explícita**
  (as 3 do Grupo C, cada uma com o motivo no próprio teste).
  **DoD:** o teste **falha** no HEAD atual (prova que pega o hardcode) e passa
  depois do T802+T803; adicionar um hardcode novo em qualquer smoke faz falhar.

## Batch B — T710: esquecer a órfã quando a retomada falha

> Investigação já feita (`medicao-t710.md`) — não re-medir. Fecha com
> `npm test` verde + o smoke novo verde.

- **T805 — Decisão de esquecer, módulo puro (TDD)** — `src/shared/resumeFailure.ts` (novo) + `src/shared/index.ts`
  `RESUME_FAILURE_WINDOW_MS = 90_000` (justificado no `plan.md`: 9× o pior tempo
  medido; a prova real é o disco), `resumedSessionIdFromArgs(args)` — extrai o id
  de `-r <id>`, `null` sem `-r` — e
  `shouldForgetOnResumeFailure({ resumedSessionId, exitCode, msSinceSpawn })`.
  **DoD:** vitest verde — `-r <id>` + `exitCode 1` + 8.600 ms → `true`;
  `exitCode 0` → `false`; sem `-r` → `false` (sessão nova nunca é esquecida);
  `msSinceSpawn` acima da janela → `false`; `-r` no fim do argv sem valor →
  `null`/`false` (nunca `undefined` virando id); `--fork-session` também conta
  como retomada da sessão de origem.

- **T806 — Esquecer VERIFICADO no main (TDD no puro + handler fino)** (sequencial após T805) — `src/shared/resumeFailure.ts` · `src/shared/sessions.ts` · `src/main/index.ts` · `src/preload/index.ts`
  Puro: `forgetIfOrphan(registry, sessionId, transcriptExists)` — remove **só**
  quando `transcriptExists === false`. Canal novo `sessions:forgetIfOrphan`
  (o `sessions:forget` do T705 fica intacto — remoção incondicional é outra
  operação). O handler resolve o caminho pelo `Map<sessionId, transcriptPath>`
  gravado no spawn (linha 289 do `main/index.ts`, que já calcula o caminho
  exato com o perfil de nascimento), com fallback em `resolveTranscriptPath`
  pelo `projectPath` da entrada.
  **Nenhuma chave nova de config** → os QUATRO pontos do `config-store.ts` não
  se aplicam (só removemos entradas de `sessionRegistry`, que já existe).
  **DoD:** vitest do puro verde (existe → no-op; não existe → removida,
  inclusive fixada, C3; id inexistente → no-op; não muta o mapa recebido);
  `npm run typecheck` verde.

- **T807 — Ligar o sinal: `onExit` do PTY até a decisão** (sequencial após T806) — `src/renderer/src/TerminalPane.tsx` · `src/renderer/src/App.tsx`
  `TerminalPane`: prop nova `onProcessExit?: ({ exitCode, signal, msSinceSpawn })`,
  disparada na assinatura de `pty.onExit` que já existe (linha 328) —
  `msSinceSpawn` medido no próprio componente (é quem sabe a hora do spawn); o
  `ptyId` continua **não** subindo para o `App.tsx`, igual a
  `onAliveChange`/`onClaudeSessionIdResolved`.
  `App.tsx`: `handleTabProcessExit(tabId, info)` → lê `tab.launchArgs` →
  `shouldForgetOnResumeFailure` → `sessions.forgetIfOrphan(...).then(setAppConfig)`.
  Sem aviso na tela (CA-11: "removida sem aviso").
  **DoD:** `npm run typecheck` + `npm test` verdes; nenhuma mudança de
  comportamento para aba que sai com código 0.

- **T808 — Smoke do 2º momento do CA-11** (sequencial após T807) — `tests/smoke/favorite-sessions.spec.ts`
  Teste novo: registra visita **fixada** para um `sessionId` que **não existe**
  no disco (via `evaluate`, sem semear `.jsonl` — e com o projeto já tendo
  entradas, para a semeadura do CA-8 não podar antes e roubar a prova), clica na
  linha do grupo Favoritos, e espera a linha **desaparecer** depois do
  `claude -r` falhar.
  **Custo: nenhum turno de API** — a retomada inválida morre em ~8,5–10,4 s
  (`medicao-t710.md`), antes de qualquer chamada ao modelo. Timeout da asserção
  com folga (60 s) por causa da contenção da suíte.
  **DoD:** verde na pasta principal e na worktree; os 3 testes que já existem no
  arquivo continuam verdes.

## Batch C — verificar, empacotar, entregar

- **T809 — Verificação nos DOIS lugares** (sequencial após T808)
  1. Pasta principal: `npm run build` → `npm run typecheck` → `npm test` →
     `npm run test:smoke` → `npm run test:smoke:dev`.
  2. Worktree descartável (`git worktree add ../donel-dev-wt-check HEAD` +
     `npm install` + `npm run build`), suíte de smokes rodada **de lá**, com os 5
     specs do §B19 passando; remover a worktree depois.
  **Precondição (§B21):** aceitar o diálogo de workspace do CLI 2.1.220 uma vez
  na worktree antes de rodar — senão qualquer smoke que suba `claude` trava sem
  sinal (`medicao-t710.md`, Achado 4).
  **DoD:** as duas saídas REAIS colhidas e coladas no relatório final. Vermelhos
  declarados com causa (T013 ×2, §B15 intermitente). **Sem a 2ª execução o §B19
  não foi verificado — foi escrito.**

- **T810 — Versão 0.2.0 + pacote** (sequencial após T809) — `package.json` · `CHANGELOG.md`
  Bump para **0.2.0** (a 0.1.0 já está na mão de outra pessoa; publicar coisa
  diferente com o mesmo número é o que faz alguém dizer "estou na 0.1.0 e não
  tem esse botão"). Seção 0.2.0 do CHANGELOG na linguagem de quem usa.
  `npm run build && npm run dist` → instalador em `release/`.
  **Não republicar no Drive** — decisão dele, depois do E2E aprovado.
  **DoD:** caminho do instalador no relatório + aviso do §B14 (all-users
  substitui `C:\Program Files\Donel Dev`, o app de trabalho; o
  `%LOCALAPPDATA%\Programs\Donel Dev` de 23/07 é o ponto de retorno).
  **Instalar é ato DELE.**

- **T811 — Roteiro E2E único + registros** (sequencial após T810) — `specs/roteiro-e2e-fechamento.md` (novo) · `specs/backlog.md` · `specs/007-favoritos-sessoes/tasks.md` · `docs/roadmap.html` · vault
  **UM** roteiro, uma sessão de app, passos numerados com o resultado esperado ao
  lado, **ordenado para gastar cota UMA vez** (passos que exigem turno real do
  modelo agrupados, servidos por uma única execução longa; marcar quais precisam
  de cota e quais não). Cobertura: **T710** (fixada cuja retomada falha sai da
  lista) + regressão do que ele usa todo dia — **007** (favoritar, grupo
  colapsável, 5 recentes + fixadas além das 5, clique focando × retomando,
  cabeçalho acendendo com grupo fechado), **005** (`Ctrl+C` sem seleção não
  derruba, `Esc` interrompe, `Ctrl+C` em terminal livre interrompe, colar
  multilinha, colar print), **004** (`/rename` ao vivo), **006** (`contexto NN%`
  subindo). No fim, explícito: **o que ficou sem validação humana e por quê**.
  Registros, por caminho explícito: §B19 fechado + **§B21 novo** (diálogo de
  workspace do CLI 2.1.220) no backlog; T710 fechada no `tasks.md` da 007;
  `docs/roadmap.html` com `done: true` nas duas frentes; vault
  `Projects/donel-dev/context.md` §Status + `todo.md`.
  **DoD:** roteiro escrito e os 4 registros atualizados.

---

## Fronteiras (do prompt dele, inegociáveis)

- **`main`: BLOQUEIO TOTAL** — nada de push/PR/merge sem instrução literal.
- **Não abrir PR nenhum** (ele fechou o #1 em 26/07 e não pediu outro).
- Push na `feature/mvp-p0`: autorizado. Nunca `--no-verify`. Nunca `git add -A`.
- **§B18 fora de escopo.** Encostou? Anota no backlog e segue.
- O app não toca credenciais: `/login` é ato humano no terminal.
