# Tasks 001 — Donel Dev MVP (P0)

**Status:** draft — execução só após OK do Alexandre sobre spec+plan
**Criado:** 2026-07-22

> **Atenção (2026-07-22, pós-entrevista):** a spec ganhou US-3 (semáforo),
> US-5 (modelo/esforço em sessão viva) e FR-010..012 no P0. Este arquivo ainda
> reflete o corte anterior — será refeito junto com o clarify pendente
> (semáforo entra como task própria na Fase 2; quota mínima na Fase 3).

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD aplica-se aos módulos puros (CommandBuilder, SessionIndexer, paths de
perfil); PTY/UI validam por smoke roteirizado.

## Fase 0 — validação

- **T001 — Spike perfis/credenciais** (bloqueante)
  Executar o roteiro do plan (§Spike T001). DoD: os 3 critérios de saída
  respondidos por escrito em `specs/001-mvp/spike-t001-resultado.md`.

## Fase 1 — fundação

- **T002 — Scaffold electron-vite**
  React+TS, contextIsolation, janela única, CI local (`npm run dev` sobe).
  DoD: janela abre com layout vazio de 3 colunas.
- **T003 — PTY + xterm, 1 aba**
  PtyManager no main, xterm no renderer, IPC com batching; spawna PowerShell.
  DoD: shell interativo completo (cores, setas, Ctrl+C, resize) dentro do app.
- **T004 — Spawn do claude na aba**
  Resolver claude.exe (PATH → `~/.local/bin`); estado "sessão encerrada";
  aviso CA-5 quando não encontrado. DoD: sessão claude plena dentro do app.

## Fase 2 — organização

- **T005 — CommandBuilder (TDD)** [P]
  `buildClaudeArgs(opts)` cobrindo a tabela FR-003 + escaping + omissões.
  DoD: suíte vitest verde cobrindo todos os mapeamentos.
- **T006 — Sidebar de projetos**
  ProjectScanner (FR-001), favoritos, clique abre aba com defaults.
  DoD: CA-1 parcial (abrir projeto) passa.
- **T007 — Launcher**
  Painel direito (modelo/esforço/permissões/nome) ligado ao CommandBuilder.
  DoD: CA-1 completo passa.
- **T008 — Abas múltiplas + ciclo de vida + terminal livre**
  FR-006 (confirmação ao fechar viva, estado encerrado) e FR-008 (ação "novo
  terminal" abrindo PowerShell no cwd do projeto). DoD: 3 sessões simultâneas
  estáveis; fechar/reabrir sem vazamento de PTY; aba de terminal livre
  funcional.

## Fase 3 — sessões e perfis

- **T009 — SessionIndexer (TDD)** [P]
  Slug de projeto→dir (todo não-alfanumérico → `-`; fixture com `.` no path),
  parse streaming de preview com as regras de filtro do FR-004 (pular tipos de
  controle, `isMeta:true` e payloads `<command-*>`), tolerância a corrompidos.
  DoD: vitest verde com fixtures reais copiadas de `~/.claude/projects`,
  incluindo uma cujas primeiras linhas são registros de controle.
- **T010 — UI de sessões anteriores**
  Lista por projeto + retomar/fork (FR-004). DoD: CA-2 passa.
- **T011 — ProfileManager + UI de perfis**
  Criar/ativar/doctor conforme resultado do T001; dropdown no topo (FR-005).
  DoD: CA-3 passa com uma conta de teste.

## Fase 4 — acabamento

- **T012 — ConfigStore + statusbar** [P]
  FR-007 (escrita atômica) + FR-009. DoD: preferências sobrevivem a restart.
- **T013 — Empacotamento**
  electron-builder NSIS; atalho no Desktop via `/create-executable`; decisão
  de assinatura de código (risco SmartScreen/Defender do plan).
  DoD: instalar numa pasta limpa com Defender ativo e rodar sem ambiente de
  dev e sem bloqueio (ou bloqueio documentado com contorno).
- **T014 — Smoke final roteirizado**
  Checklist: CA-1..CA-5, teclas especiais, colar multilinha, resize, 3 abas,
  troca de perfil, restart, **app aberto via atalho do Desktop** (PATH do
  Explorer: claude.exe e MCPs stdio resolvem), **medição de startup (< 3 s) e
  RAM com 3 abas (< 400 MB)** via `Get-Process`. DoD: checklist 100% com
  evidências (prints e números).

## Fora deste ciclo

P1 (MCP toggles, skills, busca, quota, temas) e P2 (transcript viewer, splits,
templates, git, atalhos) ganham specs próprias após o P0 em uso real.
