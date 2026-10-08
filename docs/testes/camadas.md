# Camadas de teste

Quatro camadas, cada uma com um comando. Decisão do dono em 08/10 (revisão dos
testes, proposta em `docs/revisao-testes`).

| Camada | Quando roda | Conteúdo | Comando |
|---|---|---|---|
| **A — Unitário** | Todo commit e toda fase da Esteira | O vitest inteiro | `npm test` |
| **B — Smoke de área** | Ao mexer numa área | Smokes com a etiqueta da área | `npm run test:smoke -- --grep @contas` |
| **C — Gate de PR** | Antes de pedir o merge em `staging` | Todos os smokes **sem** `@real` e `@perf` | `npm run test:smoke:gate` |
| **D — Bateria real** | Antes de promover para o beta (`main`) | Os smokes `@real` (gastam cota) e o `@perf`; mais o `smoke-dev` | `npm run test:smoke:real` e `npm run test:smoke:dev` |

Todo smoke precisa de `npm run build` antes (o Playwright dirige `out/main`).
A máquina tem pouca memória: rode por área, não a suíte inteira várias vezes.

## Etiquetas

A etiqueta vai no fim do título do `test(...)`, por exemplo
`test('... @contas', ...)`. É o mecanismo nativo do Playwright (`--grep`).

| Etiqueta | O que cobre |
|---|---|
| `@abas` | Abas, terminal, Launcher, StatusBar, layout do shell, empty state |
| `@contas` | Painel e motor de contas, login isolado, migração de perfis |
| `@provedores` | Registro de provedores, env de sessão, recusa de classe B, foco do painel |
| `@sessoes` | Sessões anteriores, nomes, favoritos, contexto na StatusBar |
| `@projetos` | Criar projeto, configuração por projeto (board + repo) |
| `@config` | Persistência de preferências entre restarts |
| `@esteira`, `@chat` | Reservadas: ainda não há smoke Playwright dessas áreas neste branch |
| `@real` | Precisa do CLI `claude` real e/ou gasta cota. Fora do gate (camada C) |
| `@perf` | Medição de desempenho (`ca7-measurement`). Fora do gate: falha conforme a carga |

Um teste leva **uma** etiqueta de área, mais `@real` ou `@perf` quando couber.

Hoje são `@real`: `terminal` (sessão claude sobe de verdade) e
`previous-sessions` (valida o `claude -r`). O `smoke-dev`
(`tests/smoke-dev/dev-mode.spec.ts`, StrictMode) tem config própria
(`npm run test:smoke:dev`), então já está fora do gate; leva `@real` só para
documentar que usa o CLI real.

## Helpers

`tests/smoke/helpers/` concentra o que antes era copiado em cada spec:

- `launch.ts`: `launchIsolatedApp` / `closeIsolatedApp` (sempre com
  `--user-data-dir` temporário; nenhum smoke toca o userData real).
- `ui.ts`: `launchClaudeTab`, `openProjectClaudeTab`, `waitForClaudeBooted`,
  `openFreeTerminalTab`, `confirmCloseModalIfOpen`, `openPreviousSessionsDialog`.
  `launchClaudeTab` e `waitForClaudeBooted` são o **único** lugar que sabe que a
  aba claude mostra o terminal; na virada do chat (014, Fase 7) só eles mudam.
- `processes.ts`: `listPids`, `waitForNewPids`, `waitForPidsGone` (prova de
  vazamento por `tasklist`).
- `sessions.ts`: `seedSession` / `removeSessionFile` (transcript sintético).
- `leaks.ts`: `assertNoLeak`.

Cercas mantidas: `refuseIfRealClaudeHome` (`accountsCredentialGuard.ts`) nos
smokes de conta e `tests/smoke-project-name.test.ts` (nenhum smoke hardcoda o
nome do projeto).
