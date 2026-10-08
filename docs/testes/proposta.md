# Revisão dos testes — segmentação e redução (proposta, 08/10)

Pedido do dono: segmentar os testes, para saber quais rodar em cada momento,
e reduzir a redundância, aproveitando a troca do terminal pelo chat (014).

Base: três inventários de leitura estática, nesta pasta:

- `inventario-smoke.md`: 33 arquivos Playwright, 64 testes;
- `inventario-vitest-esteira.md`: Esteira, Modo Dev, TaskDex e GitHub;
- `inventario-vitest-geral.md`: o resto do vitest.

Os tempos do vitest vêm de uma rodada de 08/10, na branch
`feature/014-fase-1`. **Nada foi removido nem fundido ainda.**

## 1. O que os números dizem

| Suíte | Tamanho | Tempo | Onde dói |
|---|---|---|---|
| vitest | 147 arquivos, 3125 testes | ~19 s | **Manutenção**, não tempo. Seis arquivos levam ~22 s somados (o `transcriptWatcher` sozinho, 11 s). Os outros ~140 levam menos de 150 ms cada. |
| Smoke (Playwright) | 33 arquivos, 64 testes, 34 aberturas do app | ~3 min | **Tempo, cota e falha intermitente**: 11 arquivos abrem o `claude` real. |

**Premissa corrigida: a troca para o chat não invalida os testes em
massa.**

- Na fiação, o terminal continua montado e oculto, então nenhum teste
  unitário fica obsoleto (`cliInputBox`, `trustDialog`, `preTypeReadiness`
  e `esteiraSession` seguem valendo).
- Nos smokes, o impacto real se concentra em três arquivos (§4). Mais seis
  só usam o terminal para saber que a sessão subiu.

## 2. Segmentação proposta

Quatro camadas, cada uma com um comando:

| Camada | Quando roda | Conteúdo | Comando |
|---|---|---|---|
| **A — Unitário** | Todo commit e toda fase da Esteira | O vitest inteiro. É barato demais para valer a pena fatiar. | `npm test` |
| **B — Smoke de área** | Ao mexer numa área | Smokes com a etiqueta da área (`@abas`, `@contas`, `@provedores`, `@esteira`, `@chat`, `@config`, `@sessoes`), só com CLI falso | `npm run test:smoke -- --grep @contas` |
| **C — Gate de PR** | Antes de pedir o merge em `staging` | Todos os smokes **sem** CLI real | `npm run test:smoke:gate` (`--grep-invert "@real\|@perf"`) |
| **D — Bateria real** | Antes de promover para o beta (`main`) | Os smokes `@real`, que gastam cota, mais o `@perf` | `npm run test:smoke:real` |

- A etiqueta vai no título do `test(...)`. É o mecanismo nativo do
  Playwright, sem dependência nova.
- O `smoke-dev` (StrictMode) fica na camada D.
- Só três smokes precisam mesmo do CLI real e viram `@real`:
  - o `terminal` nº 1 (sessão sobe de verdade);
  - o `previous-sessions` (valida o `claude -r`);
  - o semáforo T009 com CLI real.
- Os outros oito que abrem o `claude` real só provam que a sessão sobe.
  Passam a usar o `fake-claude-chat` da 014: sem cota, sem diálogo de
  confiança, sem o banner de 14–21 s. É também a causa de boa parte das
  falhas intermitentes de hoje.

## 3. Redução

### Smokes (estimativa: de 34 para ~20 aberturas do app, sem perder asserção)

| Ação | Arquivos | Ganho |
|---|---|---|
| **Fundir** em `accounts.spec.ts` | Os 6 de contas | Cerca de 5 aberturas a menos. Os três testes de "o painel de contas renderiza" viram um só. |
| **Fundir** em `providers.spec.ts` | Os 4 de provedores e o `modal-focus-steal` | Cerca de 4 aberturas a menos |
| **Remover** (redundante) | `terminal` nº 4 (= `model-injection`); `tabs-v3` CA-27 (= `config-persistence`); a parte do `sidebar-favorites` que repete o `favorite-sessions` | 3 testes |
| **Remover do gate** | `terminal` nº 5: um turno real de 420 s que gasta cota, coberto pelo `chat-foundation`. Vai para `@real` ou sai. | O maior custo isolado |
| **Mover para `@perf`** | `ca7-measurement`: 5 aberturas, falha conforme a carga da máquina | — |
| **Fundir** | `session-rename-live` dentro de `session-rename` | 1 abertura |
| **Prazo de validade** | `accounts-panel-substitui-perfis` e `migration-wizard` nº 2 (demolição dos perfis) | Saem quando a migração sair. O `migration-nunca-deleta` **fica** enquanto a migração existir, porque guarda uma invariante de segurança. |

### Vitest (o foco é manutenção)

| Ação | Arquivos |
|---|---|
| **Fundir** em `esteiraResultFacts.test.ts`, com um helper de card | `esteiraFatosHumanos`, `esteiraRevisaoHumana`, `esteiraCanalDaEntrega`, `esteiraGateE2eManual`, `esteiraResultIngest` e parte do `esteiraAchadosDosPrints`. Os seis têm nome de ID de spec e montam o mesmo card. |
| **Fundir pares** do mesmo módulo | `esteira-mirror` + `esteiraMirror`; `esteiraContractCoverage` + `esteiraRunInputContract`; `devMode` + `devModeDefaults`; `taskdex-board-client` + `taskdex-board-real`; os quatro `nodeGraph*`; `chat-config` → `config-store`; `projects` → `projectCatalog`; `sessionShortcuts` → `sessionOrdering` |
| **Teste de concordância** | As três listas de fases (`PHASE_CATALOG`, `ESTEIRA_PHASES` e `KNOWN_ESTEIRA_PHASES`) viram um teste "as listas concordam". As recusas e o `dispatchHint` são testados em 4 lugares. |
| **Remover** | `esteiraTiposDeclarados`: o que ele declarava já está implementado e testado no reducer. |
| **Suspeita de código morto** | `src/shared/esteira/contract/reviewPolicy.ts` só é importado pelo próprio teste. Confirmar se a fase Concluir o lê. Se não ler, sai o módulo e sobra só o caso que valida o `.esteira/review-policy.json`. |
| **Possível duplicação em `src/`** | Há duas funções `dispatchHint` (`esteiraView.ts:588` e `esteiraSession.ts:254`). Fora do escopo dos testes: só nomeio. |
| **Mover** | `carouselGeometry` e `homologationClock` vão para a suíte do `design-system`, que é o único consumidor. |
| **Acelerar** | `transcriptWatcher`: o registry já aceita `watchFn` injetável, então um falso nos casos de lógica e 3–4 casos com `fs.watch` real. Estimativa: de 11 s para ~2 s. Também: separar os 17 casos puros do `pty-manager` dos 3 com PTY real; agrupar os 14 spawns do `esteiraCheckCli`; timers falsos no `accountsIsolatedLogin`; trocar `sleep` fixo por `waitFor` num helper só. |
| **Helpers** | Fixtures de local-mod e cofre repetidas em `localModFreshness`, `accountModContract` e `refreshCoordinator` passam para `tests/helpers`. |

O espelho público importa: os testes espelhados que forem fundidos ou
removidos precisam ser levados ao público na próxima promoção. Remover o
`esteiraCheckCli` ou o `esteira-custo-fase` obriga a rever a exceção nomeada
de scripts no `CLAUDE.md`.

## 4. Preparação para a virada da Fase 7 (014)

- **Helpers de smoke primeiro**: `launchClaudeTab()` e `waitForClaudeBooted()`
  passam a ser o **único** lugar que sabe se a aba abre no terminal ou no
  chat. Com eles, os smokes de impacto médio passam pela virada sem edição
  própria: `favorite-sessions`, `session-context`, `session-rename-live`,
  `model-injection`, `shell` e `tabs-lifecycle`.
- **Reescrita só onde a virada bate de verdade**: `terminal` (1, 2), `empty-state`
  nº 2, `previous-sessions` e `chat-foundation`. O `dev-mode` (smoke-dev) também
  é de impacto alto.
- **Helpers duplicados** para consolidar:
  - o launch isolado com `mkdtempSync`;
  - `confirmCloseModalIfOpen` e `openFreeTerminalTab`;
  - a sequência do Launcher;
  - o seed de sessão sintética;
  - `listPids` (cópia idêntica em dois arquivos) e `assertNoLeak`.

  Preservar o `refuseIfRealClaudeHome` e a cerca do
  `smoke-project-name.test.ts`.

## 5. Ordem de execução sugerida (PRs pequenos contra `staging`)

1. **Etiquetas e scripts das camadas** (§2), mais os helpers de smoke (§4).
   Não remove nada; só organiza.
2. **CLI falso** nos 8 smokes que não precisam do real, e `ca7` e `terminal`
   nº 5 fora do gate.
3. **Fusões de smoke**: contas, provedores e `session-rename`.
4. **Fusões e remoções no vitest** (§3), em um PR por área (Esteira; o
   resto).
5. **Aceleração** (`transcriptWatcher`, `pty-manager` e afins).

Cada PR prova que nenhuma asserção se perdeu: lista de títulos antes e
depois, no corpo do PR.

## 6. Decisões do dono

1. As quatro camadas e os comandos do §2 servem?
2. O `terminal` nº 5 (turno real de 420 s): **sai** ou vai para `@real`?
3. Os smokes da demolição dos perfis: saem **agora** ou só quando a migração
   sair?
4. O `reviewPolicy.ts` provavelmente morto: posso confirmar e remover?
5. Quando fazer: **antes** da Fase 2 do chat, ou **intercalado** (este
   trabalho não depende dela)?

### Respostas do dono (08/10)

1. Camadas: **sim**.
2. `terminal` nº 5: **sai**.
3. Smokes da demolição dos perfis: **pela recomendação**. Ficam até a
   migração sair, e o `migration-nunca-deleta` fica enquanto ela existir.
4. `reviewPolicy.ts`: **sim**. Confirmar que está morto e remover.
5. Quando: **em paralelo** ao chat.

Execução: três frentes em paralelo.

- **Smoke**: camadas, etiquetas e helpers (empilhada sobre o #83), depois as
  fusões e remoções.
- **Vitest da Esteira**.
- **Vitest das demais áreas**.

Ficam para depois do merge do #82, porque ele altera os mesmos arquivos:

- a troca do CLI real pelo falso nos smokes (o CLI falso chega com o #82);
- a aceleração do `transcriptWatcher` e a separação do `pty-manager`.
