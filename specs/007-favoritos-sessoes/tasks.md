# Tasks 007 — Favoritos com sessões recentes na sidebar

**Status:** ⏸️ **PLANEJADO — aguardando OK dele no gate de execução.** Nenhuma
linha de código. Branch: `feature/mvp-p0`.
**Atualizado:** 2026-07-25
**12 tasks** — `T701`–`T712`, contíguas na ordem de dependência
(Batch A: T701–T706 · Batch B: T707–T712).
**Referências:** `spec.md` (CA-1..CA-11 + D1–D9 + C1–C6) e `plan.md`
(Fatias 0–5) deste diretório; `discovery.md` para as falas dele.

> **Ordem entre features:** a **006** está sendo implementada agora (outra
> sessão, mesma branch) e a **005** está planejada e pronta. Esta é a terceira.
> **Rebase antes de começar** — a 006 toca `App.tsx`, que esta também toca.

> **O que esta feature NÃO é:** restaurar/manter sessões vivas. Ele foi
> explícito: *"Não quero manter as sessões ativas, apenas acessar as últimas
> sessões de trabalho de maneira rápida."* Nada aqui sobe sessão no boot.

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros (registro, seleção, decisão de gravar) — é onde a feature
se decide. UI valida por smoke roteirizado isolado do `%APPDATA%` real, com
fixture de transcript; **nunca** abrir sessão claude real só para popular a lista.

## Batch A — registro, persistência e contrato (invisível ao usuário)

> Nada nesta fase muda a tela. Fecha com `npm run typecheck` + `npm test`
> verdes. **Não empacotar nem reinstalar** — não há o que ver.

- **T701 — Modelo do registro + poda na escrita (TDD, módulo puro novo)** — `src/shared/sessionRegistry.ts` (novo)
  `RegisteredSession { sessionId, projectPath, label, lastActivityAt, pinned }`,
  `SessionRegistry = Record<sessionId, RegisteredSession>`, `RECENT_PER_PROJECT = 5`.
  `upsertVisit` grava a visita **e poda o projeto na mesma operação**: mantém as
  5 não-fixadas mais recentes + **todas** as fixadas (CA-2, sem teto — C4).
  Visita em sessão fixada **preserva** `pinned`.
  **DoD:** vitest verde — 6ª visita empurra a mais antiga não-fixada; fixada não
  é podada nem com 10 visitas novas depois; visita não desfixa; registro de
  outro projeto não interfere; `label` vazio é rejeitado (nunca linha sem texto).

- **T702 — `setPinned` / `removeSession` (TDD)** (sequencial após T701 — mesmo arquivo) — `src/shared/sessionRegistry.ts`
  `setPinned(registry, sessionId, pinned)`: fixar marca; **desfixar NÃO remove** —
  a sessão volta a concorrer pelas 5 vagas por recência (CA-5).
  `removeSession` é o "esquecer" do CA-11 (órfã).
  **DoD:** vitest — desfixar mantém a entrada e ela é podada depois se for velha;
  `setPinned` em sessionId inexistente é no-op (não cria entrada fantasma);
  `removeSession` de inexistente é no-op; nenhuma função muta o mapa recebido.

- **T703 — `selectProjectSessions` + `selectRegisteredIds` (TDD)** (sequencial após T702) — `src/shared/sessionRegistry.ts`
  `selectProjectSessions`: união das 5 recentes + fixadas, ordenada por
  `lastActivityAt` **desc**, fixada fora das 5 incluída (CA-2), sem duplicar.
  `selectRegisteredIds(registry, projectPaths)`: conjunto de ids que aparecem em
  algum grupo — é o insumo do **dedupe do CA-3**, para o renderer não recalcular
  a regra.
  **DoD:** vitest — ordena por atividade desc; fixada antiga aparece **além** das
  5; nenhuma duplicata quando a fixada já está entre as 5; projeto sem nada →
  `[]`; `selectRegisteredIds` com 2 projetos devolve a união e ignora os demais.

- **T704 — `sessionRegistry` no ConfigStore (TDD na parte pura)** [P] com T701 — `src/main/config-store.ts`, `src/shared/config.ts`
  Chave nova tocando os **quatro** pontos do padrão do arquivo, senão ela é
  silenciosamente descartada na leitura (armadilha real da T402/004):
  `AppConfig` (`:59-68`), `defaultAppConfig` (`:72`), `sanitizeAppConfig`
  (campo a campo, **entrada a entrada**, nunca lança) e `toAppConfigDto` +
  `AppConfigDto`. `CONFIG_SCHEMA_VERSION` **não** sobe.
  **DoD:** `tests/config-store.test.ts` estendido e verde — round-trip em disco
  (tmpdir, **nunca** `%APPDATA%` real); `config.json` legado **sem** a chave
  carrega com `{}` e não perde `favorites`/`sessionNames`/`projectRoots`;
  entrada malformada é descartada isolada, preservando as boas.

- **T705 — IPC de escrita: `registerVisit`, `setPinned`, `forget`** (sequencial após T704) — `src/shared/sessions.ts`, `src/main/index.ts`, `src/preload/index.ts`
  Três canais, todos devolvendo `AppConfigDto` (padrão do `sessions:setName` da
  004). O `main` **valida o payload** (sessionId/projectPath/label vazios = no-op)
  porque é ele que persiste. **Só o renderer escreve o registro** (ver plan.md
  §Fatia 2: dois escritores exigiriam recalcular o rótulo no main, duplicando a
  regra de resolução).
  **DoD:** typecheck verde ponta a ponta (main → preload → shared); unit da
  validação de payload; nenhum `any` no contrato.

- **T706 — `sessions:seedProject` (a única leitura de disco da feature)** (sequencial após T705) — `src/main/index.ts`
  Chamado **só** quando o projeto não tem NENHUMA entrada (CA-8). Roda
  `indexProjectSessions` uma vez, converte as 5 mais recentes em visitas
  (rótulo via `resolveSessionName` com o `sessionNames` do config) e **remove
  órfãs** daquele projeto (CA-11). **Guarda dura:** se o projeto já tem entrada,
  o handler **não lê disco** — protege contra o renderer chamar em loop.
  **DoD:** unit com `claudeHome` de fixture — projeto sem registro semeia até 5;
  projeto COM registro não lê disco (spy no indexer: zero chamadas); entrada
  cujo `.jsonl` não existe sai do registro; projeto sem sessão nenhuma não cria
  entrada nem lança.

- **Gate do Batch A:** `npm run typecheck` + `npm test` COMPLETOS verdes.
  Commitar (commit em branch de feature é default). **Nada visível mudou.**

## Batch B — o que ele vê

- **T707 — Gatilhos de visita + decisão de gravar (TDD na parte pura)** — `src/shared/sessionRegistry.ts`, `src/renderer/src/App.tsx`
  Função pura `shouldRecordVisit({ lastWriteMs, nowMs, previous, next })` e três
  gatilhos, todos já existentes no código: (1) `onClaudeSessionIdResolved`
  (T404/004), (2) `handleRenameTab` (004), (3) a assinatura ÚNICA de
  `onTranscriptChanged` (T412/004 — **reaproveitar**, não abrir a segunda).
  **Debounce de ~10 s por sessão**, gravando fora dele só quando `label` mudar.
  O gatilho 3 dispara a cada turn; sem isso o `config.json` — que guarda
  favoritos, roots e perfil ativo — seria reescrito dezenas de vezes por minuto.
  **DoD:** vitest — mesma sessão em < 10 s sem mudança → **não** grava; rótulo
  mudou → grava na hora; sessão diferente → grava; primeira visita → grava.

- **T708 — Seção "Favoritos" no topo da sidebar, colapsável** (sequencial após T707) — `src/renderer/src/ProjectSidebar.tsx` (+ `.module.css`), `src/renderer/src/App.tsx`
  Seção nova **antes** de "Projetos" (C5; hoje Projetos `:158` → Sessões `:235`),
  uma linha por projeto favoritado, colapsável, com **estado de colapso
  persistido** (CA-1). Linhas = rótulo do registro + botão de pin; clique na
  linha do projeto abre/fecha.
  **DoD:** typecheck + unit verdes; grupo aparece só com projetos favoritados;
  colapso sobrevive a restart (verificado no smoke da T711).

- **T709 — Cabeçalho que grita + dedupe** (sequencial após T708) — `src/renderer/src/ProjectSidebar.tsx`, `src/renderer/src/App.tsx`
  Cabeçalho do projeto mostra o **pior estado do semáforo entre as abas VIVAS
  dele** + contagem (CA-6), **reusando** a precedência de `sessionOrdering.ts`
  (`permission > error > waiting > working > done`) — não escrever uma segunda
  tabela. Sem aba viva, sem dot. Em seguida o dedupe (CA-3): `sidebarSessions`
  filtra os ids de `selectRegisteredIds`.
  ⚠️ **Ordem importa:** o dedupe só entra DEPOIS do cabeçalho funcionando —
  invertido, existe uma janela em que uma sessão em `permission` fica invisível,
  que é exatamente o conflito nº 1 do discovery.
  **DoD:** unit puro da função "pior estado do grupo"; smoke cobre que sessão de
  projeto favoritado sai da lista geral E que o cabeçalho acende.

- **T710 — Clique: focar ou retomar; pin unificado** (sequencial após T709) — `src/renderer/src/App.tsx`
  Clique na linha: se existe aba com `claudeSessionId === sessionId` → **foca**;
  senão → retoma pelo mesmo caminho de `handleResumeSession` (`-r <id>`, CA-4).
  Falha ao retomar → `sessions:forget` (CA-11). O botão de pin passa a chamar
  `sessions:setPinned` **e** segue alimentando o `pinned` do `TabState` para
  `sortSessions` (C2) — **um** gesto na UI, os dois efeitos.
  **DoD:** typecheck verde; smoke cobre focar × retomar; nenhum caminho abre uma
  segunda aba da mesma sessão.

- **T711 — Smoke do grupo** [P] com T710 (escrever junto, roda depois) — `tests/smoke/favorite-sessions.spec.ts` (novo)
  Isolado do `%APPDATA%` real (`userDataIsolation.ts`) e com **fixture** de
  transcript + escrita direta no registro via `evaluate` (mesmo padrão que
  deixou os smokes da 004 em ~6 s) — **nunca** abrir sessão claude real só para
  popular a lista.
  **DoD:** grupo mostra só favoritados; 6ª visita empurra a mais antiga; fixada
  aparece além das 5 e **sobrevive ao restart do app**; sessão do grupo **não**
  aparece na lista geral; cabeçalho acende com o pior estado; clique foca a aba
  aberta e retoma a fechada; colapso persiste no restart; desfavoritar devolve à
  lista geral (CA-9).

- **T712 — Gate final: medição do CA-7, suíte completa, dist, roteiro E2E** — `specs/007-favoritos-sessoes/medicao-ca7.md` + `roteiro-e2e.md` (novos)
  Medir o tempo do `domcontentloaded` até a sidebar pintada com o grupo cheio
  (5 favoritos × 5 sessões + fixadas): alvo **< 100 ms**, com o número
  registrado. **Medir com polling apertado** — o `expect().toPass` do Playwright
  reportou 852 ms para algo que levava ~350 ms na 004.
  Suíte COMPLETA verde (`typecheck` + `test` + `test:smoke` + `test:smoke:dev`),
  com os vermelhos herdados **declarados** (§B11: 2 da dívida T013 + 2 de cota).
  `npm run build` + `npm run dist`; **instalar é ato dele** (§B14 — avisar qual
  das duas instalações será sobrescrita). Roteiro E2E cobrindo o que só ele
  valida: trabalhar num projeto e ver a lista se manter sozinha entre execuções,
  fixar e reabrir o app, e o dia seguinte começando pelo grupo.

## Ordem e dependências

- **Batch A → Batch B.** Dentro de A: T701 → T702 → T703 (mesmo arquivo, em
  sequência); T704 é [P] com T701; T705 depende de T704; T706 de T705.
- Dentro de B: T707 → T708 → **T709 (cabeçalho ANTES do dedupe)** → T710; T711
  escreve-se junto de T710; T712 fecha.
- **Uma build por batch entregável:** A não se empacota (invisível); B fecha com
  dist + roteiro E2E.

## Fora destas tasks (não implementar por conta própria)

- Restaurar/reabrir sessões no boot — **cancelado por ele** (D1/D7).
- Fork no grupo novo; renomear sessão pelo grupo (é a 004); busca dentro do
  grupo; `%` de contexto na linha (é a 006).
- Reconciliação periódica com o disco e botão de atualizar (C6 fechou como
  fora); sessão criada fora do Donel segue pelo painel "Sessões anteriores".
- GC geral do `config.json` (§B12 do backlog).
