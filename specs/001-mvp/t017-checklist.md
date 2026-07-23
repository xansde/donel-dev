# T017 — Checklist consolidado (Smoke final)

**Data:** 2026-07-23. **Branch:** `feature/mvp-p0`. **Ambiente:** máquina real
do Alexandre, sob carga concorrente de outras sessões `claude`/subagentes da
mesma esteira (relevante para a leitura do item 9).

Legenda: ✅ automatizado-verde · ⚠️ automatizado-mas-achado (evidência real,
não é falha do app) · ❌ automatizado-e-FALHOU (achado real, ver seção) ·
🧑 humano-pendente (não automatizável com segurança/custo razoável) · 🚫 bloqueado.

| # | Item | Status | Evidência |
|---|---|---|---|
| 1 | Preferências sobrevivem a restart (FR-007) | ✅ | `tests/smoke/config-persistence.spec.ts` (restart real via `electronApp.close()`+`electron.launch()`) — verde nas duas rodadas de `test:smoke`. `%APPDATA%\donel-dev\config.json` confirmado em disco com valores reais (`projectRoots`, `favorites`, `activeProfileSlug`, `launcherDefaults`, `notificationPreference`, `theme`). |
| 1b | Escrita atômica (temp+rename) | ✅ (via código+testes) | `writeAppConfig` (`src/main/config-store.ts:282-291`) grava em `<file>.tmp-<pid>-<ts>-<rand>` e só then `renameSync` (`MoveFileExW`, atômico no NTFS); 28 testes unitários em `tests/config-store.test.ts` (vitest, verde). Forçar o timing exato de um "kill no meio da escrita" manualmente não foi tentado (roteiro já permite marcar como "confirmar na implementação" nesse caso). |
| 2 | Statusbar (conta ativa/modelo/esforço/contagem, FR-009) | 🧑 parcial | Titlebar reflete perfil ativo (`tests/smoke/profiles.spec.ts:124`) — cobertura incidental, não uma asserção completa dos 4 campos juntos. Verificação visual completa fica para o humano. |
| 3 | Empacotamento instala com Defender ativo | ✅ | Já instalado nesta máquina (T016): `Get-ItemProperty HKCU:\...\Uninstall` → `Donel Dev 0.1.0`; exe em `%LOCALAPPDATA%\Programs\Donel Dev\Donel Dev.exe`; atalho em `Desktop\Donel Dev.lnk` apontando pro exe correto (`WScript.Shell` `TargetPath` confirmado). |
| 4 | CA-1 — Launcher monta comando exato | ✅ | `tests/smoke/terminal.spec.ts` "launcher builds the exact CommandBuilder argv..." — verde nas duas rodadas. |
| 5 | CA-2 — Sessões anteriores / retomar / fork | ✅ | `tests/smoke/previous-sessions.spec.ts` (retomar + fork) — verde. |
| 6 | CA-3 — Perfis (troca sem afetar aba antiga) | ✅ | `tests/smoke/profiles.spec.ts` — verde. |
| 7 | CA-4 — Ctrl+C | 🧑 | Sem smoke automatizado dedicado (comentário do próprio `terminal.spec.ts` lista sinais de teclado/setas como fora do escopo automatizável do E2E). Coberto indiretamente por `tests/pty-manager.test.ts` (onExit real) mas não o sinal Ctrl+C especificamente. |
| 8 | CA-5 — Aviso de `claude` ausente | ✅ (unitário) | `tests/claude-executable.test.ts` (6 testes) + `tests/parse-claude-not-found.test.ts` (4 testes) — vitest verde. Repro no app real "ao vivo" descartada por segurança (mexeria no `claude.exe` real da máquina) — já documentado assim em `terminal.spec.ts` desde o T005. |
| 9 | CA-6 — Semáforo, múltiplos estados sem foco | ❌ **instável sob carga** | Ver seção "Achado — CA-6 instável" abaixo. Mecanismo em si (T009) já foi auditado/aprovado no batch 3 e não foi tocado neste batch. |
| 10 | Teclas especiais completas (setas, Home/End, Ctrl+A/E, Backspace/Delete, Tab) | 🧑 | Explicitamente fora do smoke automatizado (comentário `terminal.spec.ts` linha 30). Item 10 do roteiro batch 2 nunca foi testado (rodada 2 do feedback-e2e.md) — segue em aberto. |
| 11 | Colar multilinha numa sessão Claude | 🧑 | Explicitamente fora do smoke automatizado (mesmo comentário). |
| 12 | Resize | ✅ parcial | `tests/smoke/shell.spec.ts` (sem scrollbar após resize) + `tests/smoke/terminal.spec.ts` "resizing... does not crash" — verdes. Não cobre especificamente "resize durante output contínuo real de uma sessão gerando resposta" — nuance fica pro humano. |
| 13 | 6 abas simultâneas | ✅ | `tests/smoke/tabs-lifecycle.spec.ts` "6 sessões simultâneas (2 claude + 4 shell)" — verde nas duas rodadas. |
| 14 | Troca de perfil em pleno uso (6 abas abertas + trocar perfil + 7ª aba) | 🧑 | Profile switching testado isoladamente (`profiles.spec.ts`) e 6-abas testado isoladamente (`tabs-lifecycle.spec.ts`) — a combinação exata (trocar perfil com 6 abas de outro perfil já abertas) não tem smoke dedicado. |
| 15 | Restart com sessões abertas | ✅ parcial | Persistência de preferências confirmada (item 1). "Sessões anteriores aparecem após restart" é estrutural (SessionIndexer lê `~/.claude/projects/<slug>/*.jsonl` do filesystem, não estado do app) e coberto indiretamente por `previous-sessions.spec.ts`. Não há smoke que abra 6 abas, mate o app de propósito e confirme o estado pós-restart nesse cenário específico. |
| 16 | App via atalho do Desktop — PATH e MCPs | ✅ parcial | Script ad-hoc (`_electron.launch({executablePath})` no exe **instalado**, não no dev build) abriu aba de terminal livre e rodou `git --version; gh --version; claude --version` com sucesso: `git version 2.53.0.windows.1`, `gh version 2.92.0`, `2.1.218 (Claude Code)` — PATH do usuário resolve corretamente no processo empacotado. MCPs carregando de fato dentro de uma sessão claude real (perguntar "liste MCPs") não foi automatizado (custaria uma resposta de modelo real só pra essa checagem) — fica pro humano. |
| 17 | Notificação Windows — mecanismo (dev + instalado) | ✅ mecanismo / 🧑 disparo visual | `app.setAppUserModelId('com.seazone.doneldev')` roda antes de `createMainWindow`/qualquer notificação (`src/main/index.ts:118-123`); `electron-builder.yml` usa o mesmo `appId`; `Get-StartApps` no app **instalado** confirma `Donel Dev → com.seazone.doneldev` (mesmo valor, independente do T016). O disparo visual real do toast (não só o mecanismo) fica pro humano, conforme a task pediu. |
| 18 | Startup < 3s | ✅ | Medido no exe **instalado** via `Start-Process` + polling 100ms de `Get-Process` até `MainWindowHandle -ne 0`/`MainWindowTitle` não-vazio: **1913 ms** (run 1) e **917 ms** (run 2). Ambos bem abaixo do limite de 3000 ms. |
| 19 | RAM < 400MB com 3 abas | ❌ **acima do limite** | Ver seção "Achado — RAM acima do budget" abaixo. |

## Achado — RAM acima do budget (item 19)

Medido no exe **instalado** (`Donel Dev.exe`, packaged/asar), via
`_electron.launch({ executablePath })` do Playwright: app inicia com 1 aba
default (sessão claude) + 2 abas de terminal livre abertas (`Terminal`),
totalizando 3 abas exatamente como o roteiro pede. `Get-Process | Where
ProcessName -like "*Donel*" | Measure-Object WorkingSet64 -Sum`:

- Rodada 1 (settle 3s): **451.4 MB** (4 processos: 128.4 + 40.7 + 174.1 + 108.1 MB)
- Rodada 2 (settle 10s, pra descartar warm-up transitório): **423.8 MB** (127.9 + 40.9 + 108.2 + 147.5 MB)

Ambas as medições ficam **acima dos 400MB** do requisito não-funcional
(spec.md). O tempo extra de settle reduziu ~28MB mas não foi suficiente pra
entrar no budget. **Não investiguei/otimizei a causa raiz** (fora do escopo
desta task, que é medir e documentar) — candidatos prováveis por eliminação
(ver tabela "Se falhar" do roteiro batch-5): xterm.js com scrollback grande
por padrão × 3 instâncias, overhead do design-system CSS (`style.css` sozinho
gera 478KB / 501KB no bundle final), ou o próprio custo-base do
Chromium/Electron multi-processo (4 processos nativos: browser + renderer +
GPU + utility) somado ao React/xterm de cada aba. **Decisão pro Alexandre**:
aceitar o budget como estava (talvez otimista para o design real com 16
componentes do design-system) e ajustar o NFR, ou abrir uma task de
otimização de memória antes do MVP ser considerado pronto para uso diário.

## Achado — CA-6 instável sob carga concorrente (item 9)

O smoke `tests/smoke/terminal.spec.ts` "semáforo: StateDot muda de
trabalhando pra aguardando resposta em background" (T009, FR-010/CA-6) **falhou
nas duas rodadas completas de `npm run test:smoke`** rodadas nesta sessão —
mas com sintomas DIFERENTES em cada rodada, o que aponta pra
**degradação de performance da máquina sob carga**, não um bug determinístico
de código:

- Rodada 1: o `StateDot` ficou preso em "Trabalhando" além do timeout de 45s
  (nunca chegou a "Aguardando resposta").
- Rodada 2: a sessão `claude` nem chegou a renderizar o banner "Claude Code"
  dentro de 15s (texto do pane ficou vazio) — ou seja, o próprio boot da
  sessão ficou anormalmente lento, antes mesmo do Stop hook entrar em jogo.

Evidência de carga concorrente real no momento dos dois runs: **14
processos `claude.exe` vivos simultaneamente** nesta máquina (`Get-Process
-Name claude`), a maioria iniciada horas antes desta sessão (10:05-10:06,
13:19, 13:38, 14:17) — ou seja, outras sessões/subagentes da mesma esteira
(o próprio comentário de `tests/smoke/tabs-lifecycle.spec.ts` já documenta
esse padrão: "esta máquina roda VÁRIAS sessões claude/powershell
concorrentes"). Some a isso a atividade desta própria sessão (múltiplas
chamadas `claude -p --debug` pra investigar o item 4 abaixo, retries do
smoke, dois launches do exe instalado). O mecanismo do semáforo em si
(`SessionSemaphoreManager`, `session-semaphore-manager.ts`,
`hooks-settings.ts`) **não foi tocado neste batch** e já tinha sido
auditado/aprovado no batch 3 — não há motivo estrutural pra ele ter
regredido; o padrão "mesmo teste falha sempre no fim de uma suite longa, com
sintomas diferentes a cada vez" é a assinatura clássica de contenção de
recursos (spawn de processo, lock de `~/.claude.json`, rate limit de API),
não de uma race condition determinística no código do app.

**Não tentei "forçar o verde"** rodando a suite mais vezes — cada rodada
completa (`npm run test:smoke`) já usa ~15 sessões `claude`/`powershell`
reais e ~3-4 minutos; insistir só queimaria mais cota sem mudar a conclusão.
**Recomendação:** revalidar este teste específico numa janela sem outras
sessões `claude` concorrentes rodando (ex.: fora do horário de execução da
esteira, ou isolado numa VM/CI dedicado) antes de considerar CA-6
definitivamente regredido ou aprovado.

## Item 4 do roteiro (`Hooks quebrados em sessão de perfil`, feedback-e2e.md)

Investigado com sessões reais `claude -p --model haiku --debug hooks`
(headless, prompt trivial "reply with OK only"), comparando `CLAUDE_CONFIG_DIR`
global vs. o perfil `spike-test`:

1. **`settings.json` do perfil é copiado por `copyFileSync`
   (`profile-manager.ts:54`, `PROFILE_COPY_FILES`)** — `diff`/MD5 contra o
   global mostram que a ÚNICA diferença de conteúdo é `model`/`effortLevel`
   (defaults do perfil, esperado); a seção `hooks` (com os paths
   `C:\\Users\\xansd\\.local\\bin\\*.ps1`) é **byte-idêntica**, barras
   preservadas. **ProfileManager não corrompe nada.**
2. O erro **"SessionStart:startup (SessionStart) error"** no debug log é
   só o banner padrão do PowerShell ("Windows PowerShell\nCopyright (C)
   Microsoft Corporation...") sendo logado sob o rótulo "error" porque o
   Claude Code trata qualquer stdout de hook que não comece com `{` como
   texto simples/erro — **não é uma falha real, é ruído de log** (os
   scripts `.ps1` do Alexandre não usam `-NoLogo`). Ocorre **identicamente**
   no global e no perfil.
3. O traceback real (`TypeError: 'type' object is not subscriptable` em
   `hookify/.../core/config_loader.py:87`, disparado pelos hooks
   `UserPromptSubmit`/`Stop`) também ocorre **identicamente** no global e no
   perfil — é um bug **pré-existente do plugin `hookify`** (incompatibilidade
   de sintaxe de generics com a versão de Python no PATH do Alexandre),
   **independente do Donel Dev e do CLAUDE_CONFIG_DIR**.
4. **Não encontrei** o artefato específico "path sem barras"
   (`C:Usersxansd.localbin...`) descrito no addendum do T001 em nenhum dos
   dois debug logs desta investigação (busquei por regex de paths Windows
   sem barra em ambos, zero ocorrências) — plausivelmente foi um artefato de
   renderização/transcrição do terminal no momento original, não algo
   persistido no `settings.json` em si.

**Conclusão: não é um bug do Donel Dev/ProfileManager.** Ambos os problemas
(ruído do banner PowerShell e o traceback do hookify) são pré-existentes do
ambiente pessoal do Alexandre e ocorrem igualmente com ou sem perfil — **não
mexi em `~/.claude/settings.json` nem no plugin hookify**, conforme a regra
do projeto (não consertar configuração do Alexandre sem instrução). Se ele
quiser eliminar o ruído: (a) adicionar `-NoLogo` aos scripts `.ps1` de
`SessionStart` resolveria o item 2; (b) atualizar/desabilitar o plugin
`hookify` (ou usar um Python mais novo) resolveria o item 3 — mas ambos são
decisões de configuração pessoal dele, fora do escopo deste app.

## Achado secundário — path do roteiro batch-5 (corrigido)

O passo 1 do roteiro (`batch-5-acabamento-empacotamento-smoke.md`) e o
comentário de topo de `config-store.ts` afirmavam que
`app.getPath('userData')` resolve para `%APPDATA%\DonelDev\config.json` e
que isso "bate com a grafia `DonelDev`... case-insensitive no NTFS". Isso
está **incorreto**: o path real é `%APPDATA%\donel-dev\config.json` (com
hífen — vem de `app.setName('donel-dev')`, `main/index.ts:118`, que reflete
o campo `name` do `package.json` raiz). NTFS é case-insensitive mas isso não
resolve a diferença de um **hífen ausente** — `DonelDev` e `donel-dev` são
strings diferentes, não uma diferença de capitalização. Corrigido nesta task:
o comentário em `config-store.ts` e o passo 1 do roteiro batch-5 (ver commit).
Confirmado em disco: `C:\Users\xansd\AppData\Roaming\donel-dev\config.json`
existe e reflete valores reais.

## Suítes automatizadas — números finais

- `npm run typecheck` — limpo, 0 erros.
- `npx vitest run` — **284/284 testes verdes** (21 arquivos), 8.23s.
- `npm run build` — limpo (design-system + main/preload/renderer).
- `npm run test:smoke` (build de produção, Electron real) — **14/15
  verdes** nas duas rodadas completas; a mesma falha (item 9/CA-6) nas duas,
  ver achado acima.
- `npm run test:smoke:dev` (StrictMode real, Vite dev server) — **1/1
  verde** (33.2s).

## Não verificado (explícito)

- Item 2 (statusbar completo), 7 (Ctrl+C), 10 (teclas especiais), 11 (colar
  multilinha), 14 (troca de perfil com 6 abas abertas) — sem automação
  segura/barata; roteiro manual (`roteiros-e2e/batch-5-...md`) continua
  sendo a fonte para o humano rodar esses itens.
- CA-6 (item 9) — falhou 2/2 nesta sessão sob carga concorrente real; preciso
  de uma rodada limpa (máquina sem outras sessões `claude` ativas) pra saber
  se é só a carga ou uma regressão real. Não presumi nenhum dos dois.
- RAM (item 19) — medida real e **acima do budget** (423.8-451.4 MB vs.
  400 MB); não investiguei/otimizei a causa raiz (fora do escopo desta task).
- MCPs carregando dentro de uma sessão real no app instalado (item 16,
  metade "MCPs") — só o PATH foi confirmado; perguntar "liste MCPs" pra uma
  sessão real ficou de fora por custo de API.
