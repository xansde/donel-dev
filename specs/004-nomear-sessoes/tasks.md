# Tasks 004 — Nomear sessões (refletir `/rename` + renomear pela UI)

**Status:** **BATCH A e BATCH B ENTREGUES** (2026-07-24) — T401–T410 fechados,
commitados e empurrados na `feature/mvp-p0`. Batch C (T411–T413, reflexo ao
vivo) **não iniciado**: espera a validação humana do roteiro
`roteiro-e2e-batch-b.md`. Branch: `feature/mvp-p0`.
**Atualizado:** 2026-07-24

> **O que mudou em relação ao plano, durante a execução** (nada de escopo novo):
> - **T403** — a medição obrigatória mostrou que a janela de cauda de 8 KB
>   alcançava o `custom-title` de só **44%** dos 317 transcripts reais desta
>   máquina. Subiu para **64 KB** (99%), o que derrubou a listagem do projeto
>   mais pesado de 654 ms para 220 ms; como o teto de ~300 ms ainda estourava a
>   frio, entrou também o **cache por `mtime+size`** (2ª listagem: ~1 ms), como
>   a task previa. Números em `medicao-t403.md`.
> - **T408** — um TERCEIRO ponto de consumo do nome resolvido entrou junto dos
>   dois previstos: a **lista de "Sessões anteriores"** (`PreviousSessions.tsx`).
>   É onde o US-A de fato acontece (achar sessão de semanas atrás pelo nome); sem
>   isso a lista continuaria mostrando a 1ª mensagem e a feature perderia o
>   caso de uso principal.
> - **T401** — uma borda que o plano não distinguia: `customTitle === null` com
>   `seenTitle` preenchido (transcript ilegível/apagado) NÃO deixa o CLI vencer.
>   Leitura que falhou não é um `/rename`, e apagar o nome do usuário por causa
>   dela seria perda de dado sem ação dele.
**13 tasks** — `T401`–`T413`, contíguas na ordem de dependência (Batch A → B → C).
**Referências:** `spec.md` (CA-1..CA-6 + decisões C1..C5 do clarify) e `plan.md`
(Fatias 0–5) deste diretório. Schema confirmado em transcritos reais:
`{"type":"custom-title","customTitle":"…","sessionId":"…"}`, o **último vence**.
**Ordem entre features (24/07):** B11 → **004 (esta)** → 006 → 005. A 004 vem
antes da 006 porque **constrói o watcher compartilhado** (Fatia 3); invertendo,
a 006 constrói e a 004 só consome.

> **Fato que barateou a feature** (descoberto no clarify, ver `spec.md` §Notas):
> o app **impõe** o `sessionId` no spawn via `--session-id <uuid>`
> (`session-correlation.ts:24-34`), reusando o id do `-r` quando é retomada. O
> path do `.jsonl` é conhecido antes de o CLI subir — não há janela cega nem
> dependência de hook. O que falta é só **expor esse id ao renderer** (T404).

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros (`resolveSessionName`, `extractCustomTitle`, validação de
nome, mutação do store) — é onde a feature realmente se decide. UI valida por
smoke roteirizado, isolado do `%APPDATA%` real.

## Fase A — Batch A: regra + persistência + leitura (invisível ao usuário)

> Nada nesta fase muda a tela. Fecha com `npm run typecheck` + `npm run test`
> verdes. Não reinstalar o app no fim desta fase — não há nada para ver.

- **[x] T401 — `extractCustomTitle` + `resolveSessionName` (TDD, módulo puro novo)** — `src/shared/sessionName.ts` (novo)
  `extractCustomTitle(tailText)` devolve o **último** `custom-title` do texto
  (nunca o primeiro), tolerando: primeira linha cortada ao meio (a leitura de
  8 KB corta), JSON inválido, `customTitle` ausente/vazio.
  `resolveSessionName({ fallback, customTitle, stored })` aplica o dirty-check
  de C2: `stored.seenTitle === customTitle` → `stored.name` (UI vence);
  diferente → `customTitle` (o `/rename` veio depois); sem `stored` →
  `customTitle ?? fallback`. Junto, `reconcileStoredName(stored, customTitle)`
  devolvendo `null` quando a entrada deve ser descartada (caso CLI-vence).
  `sessionTabName` (`shared/sessions.ts:49-53`) **não muda** — passa a produzir
  o `fallback`, o que garante CA-2 por construção.
  **DoD:** vitest verde na matriz completa do dirty-check (4 combinações +
  `seenTitle: null`), 3 `custom-title` no mesmo texto → último vence, cauda
  cortada no meio de linha, linha não-JSON, `customTitle` string vazia.

- **[x] T402 — `sessionNames` no ConfigStore (TDD na parte pura)** — `src/main/config-store.ts`, `src/shared/config.ts`
  Chave nova `sessionNames: Record<string, { name; seenTitle; updatedAt }>`
  tocando os **quatro** pontos do padrão do arquivo, senão a chave é
  silenciosamente descartada na leitura: `AppConfig` (`:57-66`),
  `defaultAppConfig` (`:69-79`), `sanitizeAppConfig` (`:206-224`, campo a
  campo, nunca lança) e `toAppConfigDto` (`:82-89`) + `AppConfigDto`
  (`shared/config.ts`). Mutações **puras** no estilo do `toggleFavorite`
  (`:227-235`): `setSessionName` / `clearSessionName`; I/O por fora, via
  `writeAppConfig` (`:322-334`). `CONFIG_SCHEMA_VERSION` (`:43`) **não** sobe.
  **DoD:** `tests/config-store.test.ts` estendido e verde — set/clear/get,
  round-trip em disco (tmpdir, **nunca** o `%APPDATA%` real), e o caso que
  importa: `config.json` **legado sem a chave** carrega com `{}` e não perde
  `projectRoots`/`favorites`/`launcherDefaults`.

- **[x] T403 — Indexer devolve o `customTitle`** (sequencial após T401 — consome o extractor) — `src/main/session-indexer.ts`, `src/shared/sessions.ts`
  `readLastActivity` (`:210`) já lê a cauda de `TAIL_READ_BYTES = 8192`
  (`:67`, uso `:216-219`) — aproveitar **a mesma leitura** para extrair também o
  último `custom-title`, sem segunda passada no arquivo. `SessionSummary`
  (`:34-46`) e `SessionSummaryDto` (`shared/sessions.ts:23-33`) ganham
  `customTitle: string | null`; `preview` **continua** (é o fallback). Montagem
  em `:267-284` propaga o campo. Corrigir o comentário `:17`, que hoje afirma
  que o `custom-title` é descartado.
  **Gotcha obrigatório de resolver, não contornar:** o `custom-title` pode
  estar **fora** da cauda de 8 KB (`/rename` no começo de uma sessão longa) —
  que é exatamente o caso de uso do Alexandre (sessão antiga). Implementar o
  fallback recomendado no plano: varredura completa **só quando** a cauda não
  trouxe `custom-title`, e **medir** o custo na listagem real. Se passar de
  ~300 ms, trocar para varredura sempre + cache por `mtime+size`.
  **DoD:** `tests/session-indexer.test.ts` verde com `.jsonl` de fixture em
  tmpdir — `custom-title` na cauda; 3 registros (último vence); registro **só
  no começo** de um arquivo > 8 KB (cobre o gotcha); nenhum → `null`; arquivo
  corrompido não regride `corrupted`. **Medição do custo registrada** no
  próprio PR/commit, não "parece rápido".

- **[x] T404 — Expor o `sessionId` ao renderer** [P] com T403 — `src/main/index.ts`, `src/preload/index.ts`, `src/shared/`
  O handler `PTY_CHANNELS.create` (`:192`) já calcula o `correlationId`
  (`:212`) e o entrega ao semáforo (`:228`) — passa a **devolvê-lo também na
  resposta do create**. Hoje o id não chega ao renderer por nenhum caminho
  (`SemaphoreUpdate`, `shared/index.ts:133-138`, só tem
  `ptyId`/`state`/`stateEnteredAt`). Descartado acoplar ao `SemaphoreUpdate`
  (chegaria só no primeiro tick e amarra nome a semáforo).
  **DoD:** typecheck verde; contrato do create refletindo o id ponta a ponta
  (main → preload → shared); `tests/session-correlation.test.ts` segue verde
  (a função pura **não** muda).

- **[x] T405 — Gate do Batch A** (sequencial, fecha a fase)
  `npm run typecheck` + `npm run test` COMPLETOS verdes. Auditoria opus ≥95
  (padrão da esteira). **Nada visível mudou** — não empacotar, não reinstalar.

## Fase B — Batch B: rename pela UI ponta a ponta (o que você vê primeiro)

> Entregável e validável sozinho: renomeia, fecha o app, reabre, o nome está
> lá (CA-3 + CA-6). **Sem** o reflexo ao vivo ainda (isso é o Batch C).

- **[x] T406 — IPC de escrita + validação de C5 no `main` (TDD na validação)** — `src/main/index.ts` (`registerSessionIpcHandlers`, `:343-347`), `src/preload/index.ts`, `src/shared/sessions.ts`
  `SESSION_CHANNELS` (`shared/sessions.ts:19-21`) hoje tem só `list`,
  read-only — entra `sessions:setName` (grava/limpa via T402, carimbando
  `seenTitle` com o `customTitle` corrente da sessão). **A validação de C5 mora
  no `main`, não só na UI**, porque é o `main` que persiste: `trim`, `\r\n` →
  espaço, corte em 60 chars, vazio após trim → `clearSessionName`.
  **DoD:** vitest da validação (módulo puro, sem IPC): trim, 61 chars → 60,
  nome com `\n` → espaço, `"   "` → limpa a entrada. Typecheck verde.

- **[x] T407 — `EditableLabel` no design-system (o gesto, uma vez só)** — `design-system/src/components/…` (novo), `TerminalTab.tsx`, `TerminalTab.module.css`
  Aba e sidebar precisam do **mesmo** gesto; escrever duas vezes é garantir dois
  comportamentos diferentes. Componente novo: duplo-clique **ou** F2 abre um
  `input` inline no lugar do label (mesma largura, sem pular layout, texto atual
  pré-selecionado); **Enter** e **blur** confirmam, **Esc** cancela e restaura.
  `TerminalTab` (`design-system/src/components/TerminalTab/TerminalTab.tsx`,
  props `:5-19`, nome no `<span>` `:42`) passa a usá-lo.
  **Corrigir a truncagem:** `TerminalTab.module.css:10` tem `white-space:
  nowrap` mas **não** `overflow: hidden` + `text-overflow: ellipsis` — com o
  limite de 60 chars isso deixa de ser cosmético; somar `title` com o nome
  inteiro.
  **Cuidado de interação (lição do `ProfileSwitcher` na entrega 002):** clicar
  na aba **ativa** e o `×` **fecha** — o input e o gesto de edição precisam de
  `stopPropagation` para não borbulhar em ativar/fechar, e o duplo-clique não
  pode disparar ativação duas vezes.
  **DoD:** componente renderiza, edita e cancela; `TerminalTab` sem regressão
  visual; **nada** de cor/ícone/indicador novo (`spec.md` §Fora de escopo).

- **[x] T408 — Ligar na App: `updateTab`, nome resolvido, aba + sidebar** (sequencial após T406/T407) — `src/renderer/src/App.tsx`, `src/renderer/src/ProjectSidebar.tsx`
  `TabState` (`:67-79`) ganha `claudeSessionId?` (do create, T404) e
  `customName?`. **Não existe `updateTab` genérico** — o único update parcial é
  o do pin (`:651`, `setTabs` + `.map` + spread): criar `updateTab(tabId,
  partial)` nesse padrão e **migrar o pin para ele**, em vez de um terceiro
  `.map` inline. O label exibido passa a ser `resolveSessionName(...)` (T401)
  nos dois pontos que já existem: `SidebarSession[]` (`:768-776`) e a tab bar
  (`:1010-1022`); a linha da sidebar é markup inline em `ProjectSidebar.tsx`
  (nome em `:173`) — usa o `EditableLabel` também. Os caminhos que batizam a
  aba hoje seguem intactos como **fallback**: `:410` (nome do projeto) e
  `:462/482` (`sessionTabName`).
  **Aba shell (C4):** mesmo gesto, mas grava só em `tab.name` (memória) — **não**
  chama o IPC, porque não há `sessionId`. CA-6 não se aplica a ela.
  **DoD:** typecheck + unit COMPLETOS verdes; renomear pela aba reflete na
  sidebar e vice-versa (mesmo valor resolvido, não duas cópias).

- **[x] T409 — Smoke do rename pela UI** [P] com T408 (escrever junto, roda depois) — `tests/smoke/session-rename.spec.ts` (novo)
  Novo spec rodando por `npm run test:smoke`
  (`tests/smoke/playwright.config.ts`), **reusando o isolamento do `%APPDATA%`
  real** de `config-persistence.spec.ts` (vizinho mais próximo: já exercita
  "grava no ConfigStore e sobrevive ao restart") e a fixture de listagem de
  `previous-sessions.spec.ts` — **nunca** abrir sessão real só para renomear.
  **DoD:** duplo-clique edita e Enter persiste o label; Esc restaura; **vazio
  volta ao fallback**; clicar na aba ainda **ativa**; `×` ainda **fecha**; aba
  shell renomeia; **nome persiste após restart do app** (CA-6).

- **[x] T410 — Gate do Batch B + reinstalação + E2E**
  Suíte COMPLETA verde: `typecheck` + `test` + **`test:smoke`** + o smoke de
  modo dev (`test:smoke:dev` — o StrictMode que já matou PTY uma vez).
  Auditoria opus ≥95. `npm run build` + `npm run dist`, reinstalar, sincronizar
  a worktree `donel-dev-e2e` e escrever o roteiro E2E para sua validação (foco:
  renomear aba, renomear na sidebar, vazio volta ao fallback, restart mantém).
  > Nota herdada: os 2 smokes de `previous-sessions.spec.ts` (resume/fork)
  > estão VERMELHOS por dívida da restauração de sessões — código disjunto
  > desta entrega. O gate deve **registrá-los explicitamente**, não mascarar
  > como "verde" (lição da rodada 5 / entrega 002).

## Fase C — Batch C: reflexo ao vivo do `/rename` (CA-4)

> Deixado por último de propósito: é a fatia de maior risco técnico (watcher,
> handle, ciclo de vida) e a única que **não bloqueia** o resto. Se travar, os
> Batches A+B já entregam US-A, US-B e US-D.

> **⚠️ Acoplamento com a `006-contexto-consumido`** (planejada em paralelo no
> mesmo dia): as duas features observam **o mesmo `.jsonl`**, e a decisão de lá
> é que o watcher seja **um só** — este, generalizado para emitir
> `{ sessionId, customTitle, contextTokens }`. **Isso muda um DoD do T412:** o
> "emite só quando o `custom-title` mudou" passa a ser "emite quando **qualquer
> campo** mudou" (o contador de tokens muda a cada turn, sem rename nenhum).
> Quem implementar o Batch C: leia `specs/006-contexto-consumido/plan.md`
> primeiro e já construa o watcher com o payload de objeto (não com uma string
> de título), senão a 006 vai reescrever este código na semana seguinte.
> Entregar a 004 antes **encolhe** a Fase B da 006 para 2 tasks.

- **T411 — `SessionNameWatcher` (TDD com `fs.watch` real em tmpdir)** — `src/main/session-name-watcher.ts` (novo)
  Abre `fs.watch` no `.jsonl` da sessão, **debounce ~300 ms**, relê a cauda,
  roda `extractCustomTitle` (T401) e emite **só quando o valor mudou**.
  `dispose()` fecha o handle.
  **Gotcha:** o `.jsonl` pode **não existir ainda** quando o watcher abre (o CLI
  cria na primeira mensagem) — `fs.watch` em path inexistente lança `ENOENT`.
  Vigiar o **diretório** e filtrar pelo nome, ou tratar o `ENOENT` com retry;
  decidir na implementação e **cobrir com teste**.
  **DoD:** vitest — append de `custom-title` dispara callback com o nome novo
  dentro do debounce; append que **não** é `custom-title` **não** dispara;
  arquivo ainda inexistente ao abrir e criado depois → dispara;
  `dispose()` fecha (segundo append não dispara nada — prova de que não vaza
  handle).

- **T412 — Ciclo de vida por aba + push ao renderer** (sequencial após T411) — `src/main/index.ts`, `src/renderer/src/App.tsx`
  Um watcher por aba `claude` **viva** (não só a em foco — evita "troquei de
  aba e o nome não seguiu"); o path vem do `correlationId` do create (`:212`).
  Fechar o watcher no **`PtyManager.onExit`** — a fonte de verdade de morte de
  sessão, inclusive em kill forçado; **não** pendurar no `SessionEnd`, que não
  dispara nesse caso (spike T002). Push por `sessions:nameChanged` via
  `webContents.send`, no padrão de `PTY_CHANNELS.data/exit` (`:155,159`) e
  `SEMAPHORE_CHANNELS.update` (`:172`) — **não** criar um segundo mecanismo.
  No renderer, o evento chama o `updateTab` (T408) e reconcilia o `stored`
  conforme `reconcileStoredName` (T401) — é aqui que o CLI-vence do C2 fecha.
  **DoD:** unit do registro/baixa dos watchers (6 abas abertas e fechadas → 0
  handles); typecheck verde; nenhum watcher sobrevive ao fechamento da aba.

- **T413 — Gate final: suíte completa + reinstalação + E2E ao vivo**
  `typecheck` + `test` + `test:smoke` + `test:smoke:dev` COMPLETOS verdes
  (com os 2 vermelhos herdados declarados). Auditoria opus ≥95. `build` +
  `dist`, reinstalar, roteiro E2E cobrindo o que **só** o humano valida:
  rodar `/rename` no meio de uma sessão viva e ver a aba trocar em < 1 s (CA-4),
  com 6 abas abertas, e conferir que a sessão renomeada dias atrás aparece com
  o nome certo na sidebar (CA-1 no caso real, sessão longa — o gotcha do T403).

## Ordem e dependências

- **Batch A → Batch B → Batch C**, nesta ordem. A é pré-requisito de B (a UI
  consome `resolveSessionName` e o store); C depende de A (extractor) e de B
  (`updateTab`).
- Dentro de A: **T401 primeiro** (todo o resto o consome). T402 é independente
  e pode ir em paralelo com T401. T403 depende de T401. T404 é [P] com T403
  (arquivos diferentes: `index.ts`/`preload` vs. `session-indexer.ts`).
- Dentro de B: T406 e T407 são independentes entre si; T408 depende dos dois;
  T409 escreve-se junto com T408 e roda depois.
- Dentro de C: T411 → T412 → T413.
- **Uma build por batch entregável**: A não se empacota (invisível); B e C
  cada um com reinstalação + roteiro E2E.

## Fora de escopo destas tasks (não implementar por conta própria)

- Cor, ícone ou qualquer indicador novo na aba — decisão explícita do Alexandre.
- Busca/filtro de sessões por nome; favoritos com sub-itens (é a **B5** do
  `backlog.md`, spec própria).
- GC de entradas órfãs em `sessionNames` (sessão apagada do disco deixa ~100
  bytes mortos) — dívida consciente, anotar no `backlog.md`, não resolver aqui.
- Renomear projetos; auto-geração de nome por LLM.
