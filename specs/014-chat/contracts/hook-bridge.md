# Contrato — ponte de hooks (CLI → app)

Como o `claude` interativo avisa o app do que acontece e como o app responde
perguntas, permissões e planos (D2, FR-021–FR-026). Evidência: verificação
ao vivo no CLI 2.1.293 de 07/10 (`research.md` R1, R2, R12–R15).

## 1. Instalação — só nas sessões que o app abre

- **Um arquivo `--settings` por sessão**: `userData/hook-settings/<ptyId>.json`,
  gravado no spawn, apagado quando a PTY sai; sobras com mais de 1 dia são
  apagadas no boot. Substitui o arquivo único de hoje (`hooks-settings.ts`).
- `--settings` **soma** aos hooks globais e de projeto do usuário — nunca os
  substitui, e o `~/.claude/settings.json` não é tocado (FR-026).
- **Token por PTY**: 128 bits aleatórios, literal dentro do arquivo da sessão
  (cabeçalho `X-Donel-Token`). Não vai para o ambiente da PTY, então os
  processos filhos da sessão não o herdam.
- O token identifica a **aba**, não a conversa: ele sobrevive a `/clear` e
  `/resume`, que trocam o `session_id` (FR-033).
- Ambiente da PTY: `NO_PROXY` acrescido de `127.0.0.1,localhost` (um proxy
  configurado no sistema não pode interceptar o hook).
- A aba de login segue sem hooks (como hoje).
- `PermissionRequest` só entra no arquivo da sessão quando `chat.enabled`
  está ligado. Com o chat desligado, as pendências ficam inteiramente com a
  TUI, como hoje. Os demais eventos entram sempre, porque servem o semáforo.

## 2. Eventos

| Evento | Tipo | `timeout` (s) | Uso no app | Resposta |
|---|---|---|---|---|
| `PermissionRequest` | `http` | 86400 | Pendência: permissão, pergunta (`AskUserQuestion`), plano (`ExitPlanMode`) | **segura** até a decisão (§3) |
| `PreToolUse` | `http` | 10 | Ação ao vivo; registro `tool_use_id` ↔ entrada (§4) | `{}` imediato — o CLI espera este hook |
| `PostToolUse` | `http` | 10 | Fim da ação; fecha pendência respondida em outro lugar | `{}` |
| `UserPromptSubmit` | `http` | 10 | Sinal de aceite do envio (contrato de envio §5) | `{}` |
| `Stop`, `StopFailure` | `http` | 10 | Fim de rodada; `error` `rate_limit`/`billing_error` → aviso `limit` | `{}` |
| `Notification` | `http` | 10 | Semáforo; diálogo sem pendência → faixa (R16) | `{}` |
| `SubagentStart`, `SubagentStop` | `http` | 10 | Subagentes ao vivo (R15) | `{}` |
| `SessionEnd` | `http` | 2 | Fim da sessão; `reason: clear\|resume` **não** é fim | `{}` |
| `SessionStart` | `command` | 10 | Troca de conversa (FR-033) — `http` não vale neste evento | nenhuma |

- `http`: `url` `http://127.0.0.1:<porta>/h/<Evento>`, `headers`
  `{ "X-Donel-Token": "<token>" }`, sem `matcher` (todas as ferramentas).
- `SessionStart` (`command`): `curl.exe -s --data-binary @- -H "X-Donel-Token:
  <token>" http://127.0.0.1:<porta>/h/SessionStart` — lê o stdin em bytes, sem
  perder acentos de caminho. Se o boot não achar `curl.exe`, cai no
  encaminhador PowerShell reescrito para ler e enviar **bytes** (R13).
- Porta fechada (app fechado ou travado): o CLI desiste em ~30 ms e segue
  pela TUI (fail-open). A sessão nunca trava por causa do app.

## 3. Decisões (`PermissionRequest`)

A pendência nasce quando o CLI **mostraria** o diálogo — regra de permissão,
modo "aprovar tudo" e leituras não chegam aqui (FR-022, AS 2.4). Enquanto o
app segura a resposta, a TUI desenha o próprio diálogo no terminal oculto:
**quem responder primeiro vence** (chat ou terminal).

Corpo da resposta = `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":D}}`:

| Ação no painel | `D` |
|---|---|
| Permitir | `{"behavior":"allow"}` |
| Permitir sempre neste projeto | `{"behavior":"allow","updatedPermissions":P}` — `P` = as sugestões `addRules` de `permission_suggestions`, com `destination` forçado para `localSettings`; sem sugestão (ex.: `Edit`, `Write`): `[{"type":"addRules","rules":[{"toolName":"<tool>"}],"behavior":"allow","destination":"localSettings"}]` |
| Negar (motivo opcional) | `{"behavior":"deny","message":"<motivo ou 'Negado pelo dono no Donel.'>"}` — o motivo chega ao Claude (AS 2.3) |
| Responder pergunta | `{"behavior":"allow","updatedInput":{...tool_input,"answers":{"<pergunta>":"<resposta>"}}}` — seleção múltipla: rótulos unidos por `", "`; "Outra": o texto livre |
| Aprovar plano e seguir | `{"behavior":"allow","updatedInput":<tool_input inteiro>}` — `allow` sem `updatedInput` é **ignorado** pelo CLI nesta ferramenta |
| Pedir ajuste no plano | `{"behavior":"deny","message":"<texto do ajuste>"}` — o Claude segue no modo plano e reescreve |
| Parar (com pendência aberta) | `{"behavior":"deny","interrupt":true}` — aborta a rodada |
| Liberar sem decidir | `{}` — o diálogo da TUI continua valendo |

O app nunca escreve em arquivo de configuração: "permitir sempre" é gravado
pelo próprio CLI no `.claude/settings.local.json` do projeto.

## 4. Correlação

- **Aba**: `X-Donel-Token` → `ptyId`. Token ausente ou desconhecido → `401`,
  sem corpo.
- **Conversa**: `session_id` + `transcript_path` do payload. `SessionStart`
  com `source` `clear`, `resume` ou `fork` e `session_id` diferente → troca
  a fonte da aba **para todas as features** (semáforo, nome, contexto, cor,
  chat). O arquivo da conversa nova pode demorar a nascer (sessão sem
  mensagem não cria arquivo): o seguidor espera o caminho aparecer.
- **Pendência ↔ linha da conversa**: `PermissionRequest` não traz
  `tool_use_id`. O app guarda por 10 s cada `PreToolUse` (`agent_id`,
  `tool_name`, `tool_input`, `tool_use_id`) e liga a pendência ao mais recente
  com a mesma tripla. Sem par, a pendência vale assim mesmo e é fechada pelo
  `PostToolUse` com a mesma tripla.
- **Subagente**: `agent_id`/`agent_type` no payload → "pedido do subagente
  <descrição>" (descrição do `.meta.json`). Payload sem `agent_id` = principal.

## 5. Ciclo de vida no servidor

```text
PermissionRequest chega ─▶ Pending(open) ─▶ painel (fila FR-035) — resposta HTTP fica aberta
  decisão do dono ─────────▶ escreve D, fecha ─▶ answered
  PostToolUse com a mesma tripla, ou tool_result / hook_permission_decision
  do mesmo tool_use_id no transcript ─▶ responde {} ─▶ resolved-elsewhere
  conexão fechada pelo CLI (timeout ou abort) ─▶ expired ─▶ faixa "o terminal precisa de você"
  PTY saiu, ou marcador de interrupção no transcript ─▶ cancelled
```

Com `timeout` de 86400 s, `expired` é raro; a regra existe porque nenhuma
pendência pode ficar sem sinal (FR-025).

## 6. Segurança

- Escuta só em `127.0.0.1`, porta efêmera.
- Corpo limitado a 32 MB (`Write` traz o conteúdo inteiro do arquivo); JSON
  inválido → `400`; nada derruba o servidor.
- Modelo de ameaça: um processo local do mesmo usuário que leia o `userData`
  consegue forjar **eventos** (pendência falsa na tela), nunca injetar uma
  decisão no CLI — decisões só trafegam na resposta à requisição do próprio
  CLI.
- Payloads não vão para log. `userData/chat-diagnostics.log` registra só
  evento, `ptyId` e duração.

## 7. Efeitos no que já existe

- O semáforo passa a consumir os mesmos eventos por esta ponte; o
  encaminhador PowerShell (um `powershell.exe` por hook, corte de 2 s) sai.
  Cada chamada de ferramenta deixa de pagar dois spawns de PowerShell.
- `SessionEnd` com `reason` `clear` ou `resume` deixa de levar o semáforo a
  `done` — hoje leva, e o `SessionStart` seguinte é descartado por ter
  `session_id` desconhecido (`session-semaphore-manager.ts:196-197`).
- `tests/hooks-settings.test.ts` (trava em 7 eventos) é reescrito para o
  formato por sessão.
