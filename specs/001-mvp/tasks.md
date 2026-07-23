# Tasks 001 — Donel Dev MVP (P0)

**Status:** EM IMPLEMENTAÇÃO (overnight 2026-07-23, branch `feature/mvp-p0`) —
gate liberado: (a) referência visual recebida em
`design/referencia/galeria-completa-dos-13-briefs/` (Donel Dev.dc.html, 13
telas) e (b) OK do Alexandre ("Implement", 23/07).
**Atualizado:** 2026-07-23

> **Insumo novo:** a branch `feat/design-system-package` trouxe
> `design-system/` — pacote React + Storybook com 16 componentes prontos
> (StateDot, SmartZoneMeter, TerminalTab, AccountBadge, PhaseChip,
> PostItCard, SplitButton, SegmentedControl, Select, TextInput, Toggle,
> Modal, Toast, StatusBar, Button + tokens.css e lib/smartZone.ts). As tasks
> de UI **consomem esses componentes** (workspace npm) — nunca recriar. A
> fidelidade visual segue `Donel Dev.dc.html` + `_ds/*/styles.css`.

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros (CommandBuilder, SessionIndexer, profile paths,
SemaphoreStateMachine); PTY/UI validam por smoke roteirizado.

## Fase 0 — spikes (sem UI; podem rodar ANTES da referência de design)

- **T001 — Spike perfis/credenciais** (bloqueante p/ Fase 3)
  Roteiro do plan (§Spike T001), incluindo o comportamento de `~/.claude.json`
  sob `CLAUDE_CONFIG_DIR`. DoD: 4 critérios de saída respondidos em
  `specs/001-mvp/spike-t001-resultado.md`.
- **T002 — Spike semáforo via hooks** [P] (bloqueante p/ T009)
  Validar FR-010: sessão real com `--settings` extra registrando hooks
  `Stop`/`Notification` que fazem POST em endpoint localhost; medir latência e
  cobertura dos 4 estados (trabalhando / aguardando resposta / permissão
  pendente / encerrada); documentar fallback heurístico se algum estado não
  for coberto. DoD: matriz estado→sinal em
  `specs/001-mvp/spike-t002-resultado.md`.

## Fase 1 — fundação

- **T003 — Scaffold electron-vite**
  React+TS, contextIsolation, janela única com layout do shell (ui-spec §2);
  npm workspaces integrando `design-system/` como dependência local do app
  (importar componentes e tokens.css de lá). DoD: `npm run build` verde com
  um componente do design-system renderizado no shell.
- **T004 — PTY + xterm, 1 aba**
  PtyManager + IPC com batching; spawna PowerShell. DoD: shell interativo
  completo (cores, setas, Ctrl+C, colar, resize, scrollback).
- **T005 — Spawn do claude na aba**
  Resolução do exe (PATH → `~/.local/bin`), estado "sessão encerrada", aviso
  CA-5. DoD: sessão claude plena dentro do app.
- **T006 — CommandBuilder (TDD)** [P]
  `buildClaudeArgs(opts)` cobrindo FR-003 + escaping + omissões.
  DoD: vitest verde em todos os mapeamentos.

## Fase 2 — cockpit (coração do P0)

- **T007 — Sidebar de projetos + sessões fixadas**
  ProjectScanner (FR-001), favoritos, sessões agrupadas por projeto (US-1).
  DoD: abrir projeto pela sidebar funciona.
- **T008 — Launcher**
  Painel conforme ui-spec §4 ligado ao CommandBuilder. DoD: CA-1 passa.
- **T009 — Semáforo de sessões (FR-010)**
  Implementar o mecanismo validado no T002 + SemaphoreStateMachine (TDD) +
  indicadores na lista de abas/sidebar + notificação Windows opcional.
  Inclui atalhos de troca de sessão (FR-013): `Ctrl+1..9` e `Ctrl+Tab`.
  DoD: CA-6 passa (os 4 estados visíveis sem focar a aba).
- **T010 — Abas múltiplas + ciclo de vida + terminal livre**
  FR-006 e FR-008. DoD: 6 sessões simultâneas estáveis; fechar/reabrir sem
  vazamento de PTY; aba de terminal livre funcional.
- **T011 — Injeção de modelo/esforço em sessão viva (FR-011)**
  Controle na UI → `/model` no stdin com prompt ocioso (estado do semáforo);
  degradação p/ reinício com flag. DoD: troca de modelo refletida na sessão
  sem perder contexto.

## Fase 3 — sessões e perfis

- **T012 — SessionIndexer (TDD)** [P]
  Slug (não-alfanumérico → `-`, fixture com `.`), preview com filtros do
  FR-004, tolerância a corrompidos. DoD: vitest verde com fixtures reais,
  incluindo transcript que abre com registros de controle.
- **T013 — UI de sessões anteriores**
  Lista + retomar/fork (FR-004). DoD: CA-2 passa.
- **T014 — ProfileManager + headroom + UI de perfis**
  Conforme resultado do T001; dropdown "Tecnologia Claude {n}" com % de quota
  (`quota-axi` sob o `CLAUDE_CONFIG_DIR` do perfil, FR-012). DoD: CA-3 passa.

## Fase 4 — acabamento

- **T015 — ConfigStore + statusbar** [P]
  FR-007 (escrita atômica) + FR-009. DoD: preferências sobrevivem a restart.
- **T016 — Empacotamento**
  electron-builder NSIS; atalho via `/create-executable`; decisão de
  assinatura (risco SmartScreen). DoD: instala e roda numa máquina limpa com
  Defender ativo (ou bloqueio documentado com contorno).
- **T017 — Smoke final roteirizado**
  CA-1..CA-6, teclas especiais, colar multilinha, resize, 6 abas, troca de
  perfil, restart, app via atalho do Desktop (PATH/MCPs), notificação do
  Windows disparando tanto via `npm run dev` quanto via atalho instalado
  (`app.setAppUserModelId`), medição startup (< 3 s) e RAM com 3 abas
  (< 400 MB) via `Get-Process`. DoD: checklist 100% com evidências.
  **Status (2026-07-23):** parte automatizável executada — checklist
  completo em [t017-checklist.md](t017-checklist.md). Startup passou
  (917-1913ms). **2 achados reais em aberto:** RAM com 3 abas ficou
  ACIMA do budget (423.8-451.4MB vs. 400MB) e o smoke de CA-6 falhou 2/2
  por carga concorrente da máquina (precisa revalidação limpa). Itens
  não-automatizáveis (teclas especiais, colar multilinha, Ctrl+C, etc.)
  seguem no roteiro manual para o humano — DoD ainda não é 100%.

## Fora deste ciclo

P1 (tokens/smart zone, subagentes, post-its, todo, quota claude-monitor,
rotinas, MCP toggles, skills, busca, temas) e P2 (modo Dev/Esteira, transcript
viewer, splits, templates, git, atalhos) ganham specs de tasks próprias após o
P0 em uso real. As TELAS de P1/P2 já estão especificadas no
[ui-spec.md](ui-spec.md) para o design nascer completo.
