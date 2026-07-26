# 008 — Fechar as pendências antes do Modo Dev · plano técnico

**Criado:** 2026-07-26 · **Branch:** `feature/mvp-p0` · **Base:** `73bb34f`

Duas demandas, requisitos JÁ APROVADOS em outro lugar — este diretório **não tem
`spec.md` de propósito**:

| Demanda | Requisito vive em | O que falta |
|---|---|---|
| **§B19** — suíte de smokes não é válida fora da pasta `donel-dev` | `specs/backlog.md` §B19 (mecanismo diagnosticado) | executar a correção |
| **T710** — esquecer a entrada órfã quando a retomada falha | `specs/007-favoritos-sessoes/spec.md` **CA-11**, 2º momento | o sinal de "falhou" + o esquecer |

**Fora de escopo por decisão dele (26/07):** **§B18** (primeira abertura em
máquina de outra pessoa) — mandou o app para um amigo testar. Nada aqui encosta
nisso.

**Nenhum requisito faltando.** As duas frentes tinham exatamente uma pergunta
aberta cada — onde mora o nome do projeto nos smokes (§B19) e como detectar a
falha de retomada (T710) — e as duas são respondidas por dado, não por decisão
de produto: a auditoria abaixo e `medicao-t710.md`.

---

## Fatia 1 — §B19: o nome do projeto passa a ser calculado

### Auditoria completa das ocorrências (todas, não só as 3 do §B19)

`'donel-dev'` aparece **26 vezes em código executável** de `tests/smoke*`,
espalhadas por 13 arquivos + 1 helper. Classificadas:

**Grupo A — OBRIGATÓRIO (cruza fixture no disco × projeto na sidebar).**
Estes são os 4 vermelhos determinísticos do §B19: semeiam `.jsonl` em
`SESSIONS_DIR` derivado da própria pasta, e clicam num projeto por nome fixo.

| Arquivo | Linhas | Ocorrência |
|---|---|---|
| `session-rename.spec.ts` | 120, 123 | `'Sessões anteriores de donel-dev'`, `/Sessões anteriores · donel-dev/` |
| `session-rename-live.spec.ts` | 80, 82, 97 | `project-row-donel-dev`, botão, texto da aba |
| `session-context.spec.ts` | 97, 99, 127 | `project-row-donel-dev`, botão, texto da aba |
| `previous-sessions.spec.ts` | 179, 183 | botão de histórico + título do diálogo |

**Grupo B — funciona hardcoded hoje, fica honesto calculado.** Só precisam de
"um projeto qualquer que exista no scan"; na worktree acertam a pasta de
verdade por sorte (ela também é escaneada).

| Arquivo | Linhas |
|---|---|
| `config-persistence.spec.ts` | 92, 180 (o projeto **escaneado**, favorito que persiste) |
| `model-injection.spec.ts` | 68 |
| `empty-state.spec.ts` | 152 |
| `profiles.spec.ts` | 127 |
| `tabs-lifecycle.spec.ts` | 202 |
| `sidebar-favorites.spec.ts` | 50, 61, 68 |
| `shell.spec.ts` | 64 |
| `terminal.spec.ts` | 159, 163, 189, 246 |
| `smoke-dev/dev-mode.spec.ts` | 117 |

**Grupo C — ARMADILHA, NÃO TROCAR.** Aqui `donel-dev` não é a pasta do repo:

| Arquivo:linha | O que é de verdade |
|---|---|
| `config-persistence.spec.ts:158` | `%APPDATA%\donel-dev\config.json` — nome do **APP** (`app.setName`), não do repo. Trocar por `basename` quebra o spec em QUALQUER worktree. |
| `config-persistence.spec.ts:36` | `TEST_ROOT = 'C:\donel-dev-smoke-t015-root'` — root fantasma inventado pelo teste. |
| `tests/smoke/userDataIsolation.ts:27` | prefixo de `mkdtemp` (`donel-dev-smoke-<spec>-`) — nome de pasta temporária. |

Fora de `tests/smoke*`, os `*.test.ts` unitários usam `'donel-dev'` como **dado
de fixture** (`projects.test.ts`, `session-indexer.test.ts`, `sessionName.test.ts`,
`sessionRegistry.test.ts`, `hooks-settings.test.ts`, …). Nada a fazer.

### Onde o helper mora — decisão

**Módulo compartilhado novo: `tests/smoke/repoUnderTest.ts`.**

O §B19 pede que o nome e o `SESSIONS_DIR` saiam do **mesmo** lugar, para nunca
divergirem — e hoje o `slugifyProjectPath` está **copiado em 4 specs**
(`previous-sessions:60`, `session-context:35`, `session-rename-live:33`,
`session-rename:39`), cada um com seu comentário. Um módulo resolve as duas
coisas.

Isso **respeita** o padrão que existe, não o contraria:

- o padrão real dos smokes é "não importar de `src/`" (para o teste não herdar o
  bug do código que testa) — e o helper não importa de `src/`, duplica a regra
  do slug de propósito, como os specs já fazem;
- já existe precedente de helper compartilhado no mesmo diretório:
  `tests/smoke/userDataIsolation.ts`, importado inclusive de fora
  (`tests/smoke-dev/dev-mode.spec.ts:8` → `../smoke/userDataIsolation`).

Exporta: `REPO_ROOT`, `PROJECT_NAME = basename(REPO_ROOT)`, `APP_MAIN`,
`slugifyProjectPath()` e `SESSIONS_DIR`. `RECENT_PER_PROJECT` fica onde está
(constante de produto, não de ambiente).

Referência de forma: `favorite-sessions.spec.ts:20-27` — o único spec que já faz
certo, e que passa a importar do helper em vez de calcular inline.

### Cerca de regressão

Um vitest novo (`tests/smoke-project-name.test.ts`) lê os arquivos de
`tests/smoke*` e falha se `'donel-dev'` aparecer em código executável fora de
uma **allowlist explícita** (as 3 linhas do Grupo C, nomeadas com o motivo).
É o que impede a próxima sessão de reintroduzir o hardcode sem perceber — o
§B19 volta calado, senão.

---

## Fatia 2 — T710: esquecer a órfã quando a retomada falha

### O que a investigação contra o binário achou

Detalhe completo em **`medicao-t710.md`**. Resumo:

- `claude -r <uuid inexistente>` **num PTY**: imprime
  `No conversation found with session ID: <id>` e **sai com exitCode 1**,
  ~8,5–10,4 s após o spawn. 3/3, sem flake.
- Controles no mesmo PTY: `-r <uuid válido>` e sessão nova (`--session-id`)
  seguem **VIVOS** aos 40 s — nenhum `onExit`.
- **Fora do PTY o exit code não serve** (até a sessão válida sai com 1, porque o
  CLI cai no modo `--print`). Medir fora do PTY daria a conclusão oposta.
- **Achado extra:** o CLI 2.1.220 tem um diálogo novo ("Accessing workspace… Is
  this a project you trust?") que aparece **antes** da validação do `-r`. Com
  ele na frente, o processo não sai — nenhum sinal chega. Vale para toda pasta
  nova, **inclusive worktree** → é precondição do Passo 5 e vira **§B21** no
  backlog.

**Veredito:** a hipótese do prompt está confirmada — o sinal é o **exit code**,
não o texto. Nada de parsear a saída do CLI.

### O desenho: gatilho barato + prova antes de apagar

1. **Gatilho** (renderer): aba que nasceu com `-r <id>` recebe `onExit` com
   `exitCode != 0` dentro de `RESUME_FAILURE_WINDOW_MS` do spawn.
2. **Prova** (main): confere se o `.jsonl` daquela sessão existe. **Só remove se
   não existir** — que é a definição literal do CA-11.

A prova é o que torna o desenho seguro sem depender de texto: cota estourada,
`claude` não encontrado, diálogo de workspace recusado, Ctrl+C precoce — todos
podem sair com código != 0, e em todos o `.jsonl` **existe**, então nada é
apagado. A janela existe só para não confundir "sessão que o usuário usou e
fechou" com "retomada que nunca subiu"; **90 s** (≈9× o pior tempo medido) é
folgado de propósito, porque quem decide de verdade é o disco.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `src/shared/resumeFailure.ts` **(novo)** | puro, TDD: `resumedSessionIdFromArgs(args)` (extrai o `-r <id>`), `shouldForgetOnResumeFailure({resumedSessionId, exitCode, msSinceSpawn})`, `RESUME_FAILURE_WINDOW_MS` |
| `src/shared/index.ts` | reexporta o módulo novo (padrão do diretório) |
| `src/shared/sessions.ts` | canal novo `sessions:forgetIfOrphan` + assinatura no contrato `SessionsApi` |
| `src/main/index.ts` | handler do canal novo (`existsSync` do transcript → `removeSession` só se ausente) + registro do caminho do transcript por `sessionId` no spawn |
| `src/preload/index.ts` | ponte do canal novo |
| `src/renderer/src/TerminalPane.tsx` | prop nova `onProcessExit({exitCode, signal, msSinceSpawn})`, disparada na assinatura de `pty.onExit` que já existe (linha 328) |
| `src/renderer/src/App.tsx` | passa a prop; `handleTabProcessExit` decide pelo módulo puro e chama `sessions.forgetIfOrphan` |
| `tests/smoke/favorite-sessions.spec.ts` | teste novo do 2º momento do CA-11 |

Notas de desenho:

- **`sessions:forget` continua existindo e intacto** (canal do T705, remoção
  incondicional). O novo é um canal **próprio** e verificado — misturar os dois
  faria "esquecer porque sumiu" e "esquecer porque pedi" virarem a mesma coisa.
- **Nenhuma chave nova de config** → a armadilha dos **QUATRO pontos** do
  `config-store.ts` (004) **não se aplica**: só removemos entradas de
  `sessionRegistry`, que já é lida/gravada/serializada/validada.
- **Qual `.jsonl` conferir:** o main já calcula o caminho exato no spawn
  (`resolveTranscriptPath(correlationId, cwd, activeProfileConfigDir)`, linha
  289) e o passa ao transcript watcher. Guardamos esse caminho num `Map` por
  `sessionId` e é ele que o handler confere — sem re-derivar por chute e sem
  errar quando o perfil ativo mudou depois do spawn. Fallback: recalcular pelo
  `projectPath` da entrada + perfil ativo.
- **`TerminalPane` está livre** (era o bloqueio do T710; a 005 já mergeou). A
  prop nova segue o padrão de `onAliveChange`/`onClaudeSessionIdResolved`: o
  `ptyId` continua **não** subindo para o `App.tsx`, só o efeito.
- **Sem aviso na tela** — o CA-11 diz "removida sem aviso". A aba mostra o
  estado "processo saiu (código 1)" que já existe hoje; a linha só desaparece do
  grupo Favoritos.

---

## Verificação (Passo 5 do prompt — é onde o §B19 se prova)

1. **Pasta principal:** `npm run build` → `npm run typecheck` → `npm test` →
   `npm run test:smoke` → `npm run test:smoke:dev`.
2. **Worktree descartável** (`git worktree add ../donel-dev-wt-check HEAD`, com
   `npm install` + `npm run build` lá dentro): rodar a suíte **de lá** e mostrar
   os 5 specs do §B19 passando. **Precondição nova (§B21):** aceitar o diálogo
   de workspace do CLI 2.1.220 uma vez naquela pasta antes de rodar, senão
   qualquer smoke que suba `claude` trava sem sinal.

Vermelhos esperados, declarados e não mascarados: 2 de `previous-sessions.spec.ts`
(dívida T013) e o intermitente do §B15. Os dois de cota (`model-injection`,
`terminal.spec.ts:281`) já viraram verdes no gate da 006 — se voltarem a
falhar, re-rodar o arquivo isolado antes de chamar de regressão.

## Riscos

| Risco | Mitigação |
|---|---|
| Diálogo de workspace do CLI 2.1.220 travar a suíte na worktree | precondição documentada + §B21 no backlog |
| Trocar uma ocorrência do Grupo C por engano | allowlist explícita na cerca de regressão + tabela acima |
| Falso positivo apagar uma sessão viva | prova no disco antes de remover (nunca só o exit code) |
| Smoke novo do T710 depender de cota | não depende: a retomada inválida morre antes de qualquer turno de API |
