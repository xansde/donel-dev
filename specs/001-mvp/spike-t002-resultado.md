# Spike T002 — Resultado: semáforo de sessões via hooks (FR-010)

**Status:** concluído (parcial — ver "Não verificado")
**Data:** 2026-07-23
**Branch:** `feature/mvp-p0`
**Artefatos:** `specs/001-mvp/spike-t002/` (`server.mjs`, `hook-forward.ps1`,
`hooks-settings.json`, `hooks-settings-curl.json`, `hooks-settings-ask.json`,
`server.log` com ~48 linhas de evidência real)

## Resumo executivo

- **3 dos 4 estados têm sinal confiável e de baixa latência via hooks**:
  trabalhando, aguardando resposta, encerrada (saída graciosa).
- **"Permissão pendente" via `Notification`: NÃO observado em nenhum teste**,
  apesar de 5 tentativas deliberadas para provocá-lo, incluindo um cenário que
  forçou de verdade um pedido de permissão (o CLI respondeu em texto "Preciso
  de sua permissão..."). Hipótese mais provável, com evidência indireta forte:
  `Notification` só dispara numa sessão com TTY real interativo — o
  `claude -p` (headless) e o `claude` sem `-p` com stdin não-TTY resolvem a
  permissão pendente sozinhos (auto-negam com explicação em texto) sem nunca
  ficar "pendente" de fato. Isso precisa ser validado dentro do node-pty real
  do Donel Dev (T004/T009), porque é exatamente esse o ambiente do app: PTY
  de verdade, não headless.
- **"Encerrada" via `SessionEnd`: confiável só para saída graciosa do CLI.**
  Kill forçado do processo (`Stop-Process -Force`, equivalente a fechar uma
  aba/matar o PTY) **NÃO dispara `SessionEnd`** — confirmado empiricamente
  matando uma sessão real em pleno `Start-Sleep -Seconds 120`. Fallback:
  `PtyManager.onExit` do node-pty (já previsto no plan.md) é obrigatório, não
  opcional.
- **Correlação sessão↔aba**: o melhor mecanismo é `--session-id <uuid>` fixo
  no spawn — testado e confirmado deterministicamente (não é best-effort como
  variável de ambiente). Variável de ambiente customizada (`DONEL_TAB_ID`)
  também funciona, mas só quando lida de **dentro de um script** (`$env:VAR`
  no PowerShell); a sintaxe inline `%VAR%` no próprio comando do hook **não
  expande** no Windows neste CLI — testado e confirmado que falha
  silenciosamente (chega como o literal `"%DONEL_TAB_ID%"`).
- **Latência**: dominada pelo trabalho interno do CLI (flush de transcript,
  telemetria) e não pelo mecanismo do hook em si — `curl.exe` vs
  `powershell.exe Invoke-RestMethod` não fizeram diferença estatística
  perceptível. Gap `Stop`→`SessionEnd` (o segmento mais limpo, sem
  interferência de tempo de modelo/ferramenta): média **1.33 s** (n=10, min
  0.95 s, max 1.62 s) — mais que suficiente para uma UI de semáforo, que opera
  em escala de percepção humana.
- `--settings` adicional funcionou exatamente como o plan.md previa: **soma**
  hooks aos hooks globais do usuário (`~/.claude/settings.json`) sem
  substituí-los. `~/.claude/settings.json` foi verificado byte-a-byte
  (mtime+tamanho) e permanece **idêntico** ao estado antes do spike.

## Matriz estado → sinal

| Estado do semáforo | Hook(s) | Confiabilidade | Payload relevante | Latência observada |
|---|---|---|---|---|
| **Trabalhando** | `UserPromptSubmit` (início do turno) + `PreToolUse`/`PostToolUse` (cada chamada de ferramenta) | Alta — sempre dispara quando há atividade real | `session_id`, `cwd`, `prompt`, `tool_name`, `tool_input`, `tool_response`, `duration_ms` (tempo de execução da ferramenta medido pelo próprio CLI) | Sub-segundo após o CLI decidir agir; o delay visível é o "pensar" do modelo, não o hook |
| **Aguardando resposta** | `Stop` | Alta — dispara sempre ao final de cada turno completo, inclusive quando o turno termina em "não posso, preciso de permissão" | `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons` | 2–8 s após a última ação (função do modelo/ferramenta, não do hook) |
| **Permissão pendente** | `Notification` (esperado) | **NÃO CONFIRMADA** — 0 ocorrências em 5 tentativas deliberadas (ver "Não verificado") | — | — |
| **Encerrada (saída graciosa)** | `SessionEnd` | Alta para saída normal do processo (`reason: "other"` em todos os 10 testes que completaram normalmente) | `reason` | 0.95–1.62 s após o `Stop` (média 1.33 s, n=10) |
| **Encerrada (kill forçado)** | `SessionEnd` **NÃO dispara** | Confirmado: hook não roda em `TerminateProcess`/`Stop-Process -Force` | — | N/A — usar `PtyManager.onExit` do node-pty (evento de processo do SO, não hook) |

Bônus (não estava no roteiro, mas surgiu ao testar o Task tool): `SubagentStop`
dispara de forma confiável para subagentes lançados via `Task`, com
`agent_id`, `agent_type`, `agent_transcript_path`, `background_tasks` — útil
se o Donel Dev algum dia expuser estado de subagentes na UI (fora do escopo
do P0).

## Evidências (logs reais, `server.log`)

Servidor: `node server.mjs 8765`, escutando em `127.0.0.1:8765/hook`, log
JSONL append-only em `server.log`. 11 sessões com `session_id` distinto
registradas no log (~13 execuções de `claude`/`claude -p` ao todo — algumas
sem par completo de eventos capturado; modelo `haiku`, prompts triviais como
"Responda apenas OK"), 48 POSTs recebidos.

**1. `UserPromptSubmit` (trabalhando — início do turno):**
```json
{"hook_event_name":"UserPromptSubmit","session_id":"0c3f87e5-...","cwd":"C:\\Users\\xansd\\seazone\\donel-dev","prompt_id":"3b7ade30-...","permission_mode":"bypassPermissions","prompt":"Responda apenas OK"}
```

**2. `PreToolUse`/`PostToolUse` (trabalhando — ferramenta em execução):**
```json
{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello-from-spike","description":"Echo hello-from-spike"},"tool_use_id":"toolu_01B8DAQ..."}
{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_response":{"stdout":"hello-from-spike","stderr":"","interrupted":false},"duration_ms":2598,"tool_use_id":"toolu_01B8DAQ..."}
```

**3. `Stop` (aguardando resposta — turno concluído):**
```json
{"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"OK","background_tasks":[],"session_crons":[]}
```

**4. `SessionEnd` (encerrada — saída graciosa):**
```json
{"hook_event_name":"SessionEnd","reason":"other"}
```

**5. Cenário de permissão forçada (o que substitui `Notification`):** usando
`hooks-settings-ask.json` (`"permissions": {"ask": ["Bash","PowerShell"]}`
para sobrescrever a allowlist ampla do settings global do usuário), pedi
explicitamente para rodar um `echo` via Bash. Resultado — **sem
`Notification`**, direto `PreToolUse` → `Stop` com o texto:
```json
{"hook_event_name":"Stop","last_assistant_message":"Preciso de sua permissão para usar o Bash. A solicitação de permissão foi enviada — você pode aprová-la nas opções que aparecerem no Claude Code."}
```
seguido de `SessionEnd` imediato. Repetido em modo `-p` e em modo interativo
sem TTY (stdin `< /dev/null`) — mesmo resultado nos dois.

**6. Teste de kill forçado:** sessão real rodando `Start-Sleep -Seconds 120`
via PowerShell (dentro do Bash tool do Claude), morta com
`Stop-Process -Id <pid> -Force` ~9 s após o `PreToolUse`. Log confirma
`UserPromptSubmit` → `PreToolUse` e **nada mais** — sem `PostToolUse`, sem
`Stop`, sem `SessionEnd`. Processo confirmado terminado via
`Get-Process -Id <pid>` (erro "não é possível localizar").

**7. Correlação via `--session-id`:** rodei
`claude -p ... --session-id 11111111-2222-3333-4444-555555555555` e os 3
hooks disparados carregaram exatamente esse UUID em `session_id` — mecanismo
determinístico confirmado.

**8. `%VAR%` vs `$env:VAR`:** com `hooks-settings-curl.json` usando
`-H "X-Donel-Tab-Id: %DONEL_TAB_ID%"` inline no comando do hook, o header
chegou literalmente como a string `"%DONEL_TAB_ID%"` — não expandiu. Com
`hook-forward.ps1` lendo `$env:DONEL_TAB_ID` de dentro do script PowerShell, o
valor chegou correto (`"donel_tab_id":"tab-test-1"` etc.) em todos os testes
que usaram esse script.

## Decisão de arquitetura para T009 (`SemaphoreStateMachine`)

### Mecanismo de registro dos hooks

- Um único arquivo de settings gerado pelo app por sessão/aba (equivalente ao
  `hooks-settings.json` deste spike), passado via `--settings <path>` no
  spawn do `claude` dentro do PTY. Nunca tocar
  `~/.claude/settings.json` do usuário — confirmado neste spike que a soma é
  aditiva.
- Hooks a registrar: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
  `SessionEnd`, `Notification` (mesmo sem confirmação, registrar por
  segurança — custo zero se nunca disparar).
- Comando do hook: **script PowerShell dedicado** (como `hook-forward.ps1`),
  não `curl.exe` com `%VAR%` inline — a correlação por variável de ambiente
  só funciona lendo `$env:` de dentro de um script.
- **Correlação primária: `--session-id <uuid>` gerado pelo Donel Dev no
  momento de criar a aba**, não variável de ambiente. É determinístico, não
  depende de expansão de shell, e o `session_id` já vem em 100% dos payloads
  de hook. A variável de ambiente (`DONEL_TAB_ID` ou similar) pode continuar
  como sinal redundante de debug, mas não é a fonte de verdade.

### Estados e transições

```
IDLE ──(UserPromptSubmit)──> WORKING
WORKING ──(PreToolUse)──> WORKING (tool_name conhecido, exibir o quê)
WORKING ──(Stop)──> IDLE  [turno concluído, prompt disponível de novo]
WORKING ──(PreToolUse sem PostToolUse/Stop em N segundos)──> heurística
    AWAITING_PERMISSION (ver fallback abaixo)
qualquer estado ──(SessionEnd)──> ENDED
qualquer estado ──(evento onExit do node-pty, processo morreu)──> ENDED
    [tem PRIORIDADE sobre SessionEnd — cobre kill forçado, que não dispara hook]
```

Estado inicial de uma aba recém-criada: `WORKING` até o primeiro `Stop` (ou
`IDLE` otimista, ajustar por UX).

### Fallback heurístico para "permissão pendente"

Como `Notification` não foi confirmado neste ambiente headless, o T009 deve:

1. **Validar primeiro dentro do PTY real** (node-pty, TTY de verdade) assim
   que T004 existir — é plausível que `Notification` funcione ali e este
   fallback nem seja necessário. Esse é o teste mais importante pendente.
2. Se não disparar nem no PTY real, usar heurística por **combinação de dois
   sinais**:
   - **Sinal A (hooks):** `PreToolUse` disparou para uma ferramenta, mas nem
     `PostToolUse` nem `Stop` chegaram dentro de um timeout curto
     (ex.: 2–3 s — no spike, `PostToolUse` normalmente chega em bem menos que
     isso quando a ferramenta é auto-aprovada; ver tabela de latências).
   - **Sinal B (ring buffer do PTY, já previsto no plan.md item 8):** regex
     nas últimas ~10 linhas ANSI-stripadas procurando por padrões conhecidos
     de prompt de permissão do Claude Code (ex.: variações de "Do you want
     to proceed", opções numeradas "1.", "2." em sequência, ou texto
     equivalente em pt-BR se o CLI localizar).
   - Estado `AWAITING_PERMISSION` só é declarado quando os dois sinais
     concordam (evita falso positivo por ferramenta simplesmente lenta,
     tipo download ou build).

Pseudocódigo:
```
function onPreToolUse(sessionId, toolName):
  markPending(sessionId, toolName, now())

function onPostToolUse(sessionId) / onStop(sessionId):
  clearPending(sessionId)

function tick():  // a cada ~500ms
  for session in pendingSessions:
    if now() - session.pendingSince > PERMISSION_TIMEOUT_MS:
      if ptyBufferMatchesPermissionPrompt(session.ptyRingBuffer):
        setState(session, AWAITING_PERMISSION)
```

### Fallback heurístico para "encerrada" (kill forçado)

Já resolvido pela arquitetura existente: `PtyManager` do main process já
observa o `onExit` do `node-pty` (evento do SO, não do CLI) — esse é o sinal
de verdade para "encerrada" em qualquer cenário, gracioso ou não. `SessionEnd`
é um sinal **complementar e mais rico** (dá o `reason`) quando disponível, mas
nunca a única fonte para o estado `ENDED`.

## Não verificado

- **`Notification` em sessão com TTY real.** Não foi possível reproduzir um
  terminal interativo de verdade a partir deste ambiente de shell não
  interativo (`winpty` foi tentado e falhou com `"stdin is not a tty"` — o
  próprio `winpty` exige um console real para funcionar, indisponível aqui).
  Isso é exatamente o cenário que o node-pty do Donel Dev vai criar
  (PTY real), então este item **precisa** ser o primeiro teste de T009, não
  pode ser assumido a partir deste spike.
- **`SessionEnd.reason` com valores diferentes de `"other"`.** Só observei
  `"other"` (10/10 saídas graciosas via `-p`/headless). Não testei `/exit`
  explícito dentro do REPL interativo, `Ctrl+D`, ou outros encerramentos que
  poderiam ter `reason` diferente — exigem TTY real (mesma limitação acima).
- **`Notification` por idle timeout** (>60 s esperando input na REPL
  interativa) — mesma limitação de TTY real; não testado.
- **Se os hooks globais do usuário (`SessionStart`, `Stop` com
  `task-complete-notify.ps1`) continuaram disparando em paralelo aos hooks do
  spike.** Inferência forte a favor (comportamento documentado de merge
  aditivo entre fontes de settings, e o `--settings` do spike nunca sobrescreveu
  `hooks` — só adicionou chaves de evento) mas não confirmei visualmente (ex.:
  não fiquei observando se toasts do Windows apareceram durante os ~13 runs).
  Não é bloqueante para T009, mas vale uma checagem rápida.
- **Latência isolada do subprocesso do hook** (spawn + exec + POST, sem
  ruído do trabalho interno do CLI). Medi o proxy mais limpo disponível
  (gap `Stop`→`SessionEnd`, que não tem atividade de modelo/ferramenta no
  meio) — mas mesmo esse gap inclui flush de transcript/telemetria do
  próprio CLI antes de disparar `SessionEnd`, então o número (~1.33 s
  médio) é um teto superior da latência do hook, não uma medição pura dele.
- **Comportamento de `permission_mode: "manual"`** — passei
  `--permission-mode manual` num teste e o payload reportou
  `"permission_mode":"default"`, sugestão de que ou o valor não é aceito como
  documentado no `--help`, ou há uma normalização interna não documentada.
  Não investiguei mais a fundo por não ser bloqueante (o modo `"default"`
  combinado com `permissions.ask` já foi suficiente para forçar o cenário de
  permissão pendente).

## Prova de que arquivos globais não foram tocados

| Arquivo | Antes do spike | Depois do spike | Veredito |
|---|---|---|---|
| `~/.claude/settings.json` | mtime `2026-07-21T17:30:37.95Z`, 3503 bytes | mtime `2026-07-21T17:30:37.95Z`, 3503 bytes | **Idêntico — não tocado** |
| `~/.claude.json` | mtime `2026-07-23T03:58:25.52Z`, 71595 bytes | mtime `2026-07-23T04:13:12.93Z`, 72159 bytes | **Mudou** — mas por escrita própria e automática do CLI a cada sessão real (registro de projeto/histórico), não por qualquer escrita minha. Rodei ~13 sessões `claude`/`claude -p` reais como o roteiro pedia; esse arquivo já vinha sendo atualizado por outras sessões concorrentes (mtime já era de minutos atrás no snapshot inicial). Validado que continua JSON válido após todos os testes (`JSON.parse` sem erro). Nenhum credential/token foi lido, exibido ou gravado por mim. |

Nenhum comando de login foi executado; nenhuma credencial foi tocada. Todos os
testes usaram sessões já autenticadas na conta padrão do usuário (mesma conta
de sempre, sem troca de perfil).

## Artefatos mantidos

Todos em `specs/001-mvp/spike-t002/` (nada commitado — cabe ao orquestrador):
- `server.mjs` — servidor HTTP de captura (Node puro)
- `hook-forward.ps1` — script PowerShell que os hooks chamam (lê stdin,
  enriquece com `donel_tab_id`, faz POST)
- `hooks-settings.json` — settings extra com hooks via PowerShell (usado na
  maioria dos testes)
- `hooks-settings-curl.json` — variante com `curl.exe` direto (comparação de
  latência)
- `hooks-settings-ask.json` — variante com `permissions.ask` para forçar
  cenário de permissão pendente
- `server.log` — log JSONL bruto de todas as 48 requisições recebidas
  (evidência primária deste relatório)
