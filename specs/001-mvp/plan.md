# Plan 001 — Donel Dev MVP (P0): arquitetura técnica

**Status:** draft — aguardando revisão do Alexandre
**Criado:** 2026-07-22
**Spec:** [spec.md](spec.md)

## Decisões de stack

| Decisão | Escolha | Por quê | Rejeitadas |
|---|---|---|---|
| Shell do app | **Electron** (LTS atual) | Base provada para terminal embedado (VS Code usa Electron + xterm + pty); Node 22/npm já na máquina; subagentes dominam o ecossistema | Tauri (PTY em Rust no Windows = risco/prazo), WebView2 puro (sem story de PTY), adotar VS Code (usuário quer app próprio) |
| Terminal | **@xterm/xterm** + addon-fit (+ addon-webgl opcional) | Padrão de mercado, ConPTY-friendly | — |
| PTY | **node-pty** (ConPTY) | Único caminho maduro em Node no Windows | child_process puro (sem TTY → CLI degrada) |
| UI | **React + TypeScript + electron-vite** | Scaffold pronto, HMR, familiar aos subagentes | vanilla (mais lento de evoluir) |
| Empacotamento | **electron-builder** (NSIS) + atalho via `/create-executable` | Instalável e atalho no Desktop | — |
| Testes | **vitest** nos módulos puros; smoke manual roteirizado | TDD onde há lógica; PTY/UI é smoke | — |

## Arquitetura de processos

```
┌─ Main process (Node/TS) ──────────────────────────────┐
│ PtyManager      spawn/kill/resize de PTYs (node-pty)  │
│ ProjectScanner  scan dos roots (FR-001)               │
│ SessionIndexer  parse dos JSONL (FR-004)              │
│ ProfileManager  perfis + junctions + doctor (FR-005)  │
│ ConfigStore     %APPDATA%\DonelDev\config.json        │
│ CommandBuilder  launcher → argv (FR-003, puro)        │
└──────────────── IPC (contextBridge, tipado) ──────────┘
┌─ Renderer (React) ────────────────────────────────────┐
│ Sidebar (projetos+sessões) · Tabs (xterm) · Launcher  │
│ ProfileSwitcher · Statusbar                            │
└────────────────────────────────────────────────────────┘
```

- Renderer com `contextIsolation: true`, sem Node integration; toda a API passa
  pelo preload (`window.donel.*`), tipada de ponta a ponta.
- Canais IPC: `pty:create|input|data|resize|exit|kill`, `projects:list|favorite`,
  `sessions:list`, `profiles:list|create|activate|doctor`, `config:get|set`.
- `pty:data` com batching (~16 ms) para não afogar o IPC em outputs longos.

## Pontos técnicos que merecem atenção

1. **Spawn do claude.** Spawnar `claude.exe` (resolvido no PATH; fallback
   `~/.local/bin/claude.exe`) direto no PTY — não dentro de um PowerShell — para
   a aba ser "a sessão". Quando o processo sai, a aba mostra estado encerrado
   (FR-006). Aba de terminal livre (FR-008) spawna `powershell.exe -NoLogo`.
2. **Env do PTY.** Herdar o env do usuário + `CLAUDE_CONFIG_DIR` quando perfil
   ≠ principal. Nunca sobrescrever PATH. **Gotcha Windows:** app aberto via
   atalho do Desktop herda o PATH do Explorer, que pode estar desatualizado —
   afeta a resolução do `claude.exe` (por isso o fallback de CA-5) e também os
   subprocessos que o próprio `claude` spawna (MCPs stdio). T017 valida o app
   aberto via atalho, não só via terminal de dev.
3. **CommandBuilder puro.** `buildClaudeArgs(opts): string[]` sem I/O — 100%
   coberto por unit tests (tabela FR-003, incluindo omissão de flags e escaping
   do `-n`).
4. **SessionIndexer.** Ler só o necessário: stat (mtime/size) + streaming das
   primeiras linhas até achar a primeira mensagem de usuário; tail opcional para
   última atividade. Transcript gigante nunca é carregado inteiro (NFR).
5. **Junctions.** `mklink /J` via `fs.symlinkSync(..., 'junction')` (não requer
   admin). Doctor = verificar que cada junction resolve para o alvo esperado.
6. **Semáforo (FR-010).** Abordagem preferida: o app registra hooks `Stop` e
   `Notification` (via `--settings` adicional na sessão, para não sujar o
   settings.json do usuário) que fazem POST num endpoint localhost do app com o
   session id — estado confiável sem parsing frágil. Fallback: heurística por
   título do terminal/atividade do PTY. Validar em spike curto junto do T002.
7. **Injeção de comandos (FR-011).** Escrever `/model <alias>\r` no stdin do
   PTY só com o prompt ocioso (detectar via estado do semáforo). Existência de
   comando equivalente para esforço: confirmar na implementação; sem ele, a UI
   oferece reinício com `--effort`.
8. **Hover-preview de sessões (§3 ui-spec).** O PtyManager (main process)
   mantém um ring buffer das últimas ~50 linhas por PTY, com ANSI stripado,
   exposto via IPC sob demanda — o preview de 3 linhas no hover nunca depende
   do componente xterm do renderer estar montado para a sessão fora de foco.

## Spike T001 — validação de perfis (bloqueante, antes de qualquer UI)

Hipótese a validar: `CLAUDE_CONFIG_DIR` isola login por perfil no Windows.

Roteiro: criar `~/.claude-profiles/teste` com junctions; rodar
`claude auth --help` e inspecionar onde credenciais são gravadas
(`.credentials.json` no config dir é o esperado no Windows); logar uma conta de
teste com `CLAUDE_CONFIG_DIR` apontado; confirmar que `~/.claude` original não
foi tocado e que skills/CLAUDE.md aparecem na sessão do perfil.

**Passo crítico (achado do review):** a identidade da conta também vive em
`~/.claude.json` — irmão de `~/.claude/`, com `oauthAccount`, `mcpServers`
globais, `machineID` e projetos confiados. Verificar se, com
`CLAUDE_CONFIG_DIR` setado, o CLI passa a ler/gravar um `.claude.json` dentro
do config dir do perfil (e não o global). Se NÃO redirecionar, o isolamento
por env var não fecha sozinho — avaliar `HOME`/`USERPROFILE` por perfil ou
outro mecanismo antes de qualquer UI.

Critérios de saída: (a) login isolado confirmado; (b) comportamento do
`.claude.json` sob `CLAUDE_CONFIG_DIR` documentado, incluindo como manter
`mcpServers` iguais entre perfis; (c) lista definitiva de dirs/arquivos a
linkar vs copiar; (d) decisão sobre `settings.json` (cópia sincronizada vs
hardlink). Se a hipótese falhar, plano B: perfis via `claude auth` (subcomando
de gerenciamento) ou multi-instância com `--settings` — decidir com o
resultado do spike em mãos.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| node-pty × ABI do Electron no Windows (build nativo) | bloqueia o terminal | usar prebuilds; `@electron/rebuild` no postinstall; pin de versões testadas; se travar, VS Build Tools |
| `CLAUDE_CONFIG_DIR` não isolar credenciais | perfis caem | Spike T001 antes de tudo; planos B acima |
| Teclas especiais/resize mal mapeados | UX de terminal ruim | ConPTY default; addon-fit; roteiro de smoke com checklist de teclas |
| JSONL grandes travarem índice | sidebar lenta | streaming + stat only; índice em cache com invalidação por mtime |
| OneDrive/AV interferindo em junctions | perfis quebram | profiles fora do OneDrive; profile doctor |
| SmartScreen/Defender barrando instalador NSIS ou `conpty.node` (binário nativo sem assinatura) | app não instala/abre | decidir assinatura (mesmo autoassinada p/ uso interno) no T016; passo de verificação com Defender ativo |
| Escrita concorrente no vault (OneDrive + Obsidian) ao marcar checkbox do todo.md | corrompe o todo.md / vault | escrita via REST local do Obsidian (mesmo mecanismo do MCP `obsidian`); se REST indisponível, painel cai para read-only |
| X-Frame-Options/CSP do claude-monitor.seazone.dev bloqueia iframe | embed do painel de quota (§6) renderiza em branco sem erro | checar headers antes de comprometer (`curl -I`); fallback API ou manter só o link externo |
| Notification API do Electron sem `app.setAppUserModelId` no Windows | notificações saem atribuídas a "Electron" ou falham em silêncio fora do dev | setar `app.setAppUserModelId` no main process; validar no smoke do T017 via `npm run dev` e via atalho instalado |

## Estrutura do repositório (alvo)

```
donel-dev/
  specs/001-mvp/{spec,plan,tasks}.md
  src/main/        (PtyManager, scanners, ProfileManager, ConfigStore)
  src/preload/
  src/renderer/    (React)
  src/shared/      (tipos IPC, CommandBuilder)
  tests/           (vitest — módulos puros)
```

## Operação interina — amanhã, antes do app existir

Sem o Donel Dev pronto, a dinâmica de contas compartilhadas já funciona no
Windows Terminal. Procedimento manual (que o app depois absorve):

```powershell
# criar um perfil para a conta compartilhada B (uma vez)
$p = "$env:USERPROFILE\.claude-profiles\conta-b"
New-Item -ItemType Directory -Force $p | Out-Null
foreach ($d in "projects","skills","commands","rules","plugins","templates") {
  cmd /c mklink /J "$p\$d" "$env:USERPROFILE\.claude\$d"
}
Copy-Item "$env:USERPROFILE\.claude\settings.json" $p -ErrorAction SilentlyContinue
Copy-Item "$env:USERPROFILE\.claude\CLAUDE.md" $p -ErrorAction SilentlyContinue
```

```powershell
# abrir o claude com a conta B (a cada sessão; 1º uso pede /login)
$env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-profiles\conta-b"; claude
```

> Validar este procedimento é exatamente o Spike T001 — se rodar amanhã na mão,
> o resultado já alimenta o plano.

## Sequência de implementação

Detalhada em [tasks.md](tasks.md). Ordem: spike de perfis → scaffold → terminal
1 aba → sidebar/projetos → launcher → abas múltiplas (+ terminal livre) →
sessões anteriores → perfis (UI) → statusbar → empacotamento → smoke final.
