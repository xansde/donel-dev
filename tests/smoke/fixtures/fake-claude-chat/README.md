# fake-claude-chat (014, T040)

`claude` falso e roteirizado para os smokes do chat. Aponte
`DONEL_CLAUDE_EXECUTABLE_FIXTURE` para `claude.cmd` (que repassa os argumentos
para `fake-claude-chat.mjs`). Node puro, sem dependencias; funciona com qualquer cwd.

## Argumentos

`--session-id <id>`, `--settings <arquivo>` (o JSON por sessao do app: entradas `http`
e o `command` do `SessionStart`), `-r|--resume <id>` (usa o id e dispara `SessionStart`
com `source: resume`), `--permission-mode <modo>` (com `acceptEdits` o rodape mostra
`accept edits on`, o sinal de "pronto" que `waitForClaudeBooted(until: 'prompt')` espera). Os demais sao ignorados.

Os smokes que abrem aba `claude` usam este falso por padrao (`launchIsolatedApp`, opcao
`fakeClaude`, `tests/smoke/helpers/launch.ts`); so os `@real` passam `fakeClaude: false`.
Os transcripts do falso ficam em `<userData>/fake-claude-home` quando o helper o ativa.

## Ambiente

| Variavel | Efeito |
|---|---|
| `DONEL_FAKE_CLAUDE_SCENARIO` | Roteiro: JSON inline (comeca com `{`) ou caminho de um arquivo JSON |
| `DONEL_FAKE_CLAUDE_HOME` | Raiz dos transcripts: `<home>/projects/<cwd-codificado>/<session_id>.jsonl` (padrao: pasta temporaria do SO) |
| `DONEL_FAKE_CLAUDE_RESUME_STRICT` | `1`: `-r <id>` sem transcript (na raiz do falso nem em `~/.claude`) imprime `No conversation found with session ID` e sai com 1, como o CLI real. O `launchIsolatedApp` liga |
| `DONEL_FAKE_CLAUDE_LOG` | Se definida, acrescenta uma linha JSON por hook disparado (diagnostico) |
| `DONEL_FAKE_CLAUDE_HOOK_TIMEOUT_MS` | Espera maxima por resposta de hook `http` (padrao 5000) |
| `DONEL_FAKE_CLAUDE_PERMISSION_TIMEOUT_MS` | Espera maxima (padrao 600000) pela resposta do `PermissionRequest` dos passos segurados; depois cai no dialogo da TUI |
| `DONEL_FAKE_CLAUDE_SLOW_MS` | Duracao extra (padrao 3000) de uma rodada cujo prompt contem `demorar`; Esc a encerra antes |
| `DONEL_SMOKE_SHOTS_DIR` | (do `chatHelpers.shot`, nao do falso) copia extra dos prints dos smokes de chat para esta pasta |
| `DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER` | `1`: o primeiro Enter com texto na caixa e engolido (Enter perdido), para testar o reenvio de `\r` |
| `DONEL_FAKE_CLAUDE_HIDE_BOX_WHILE_WORKING` | `1`: durante a rodada a caixa e o rodape somem (so `● Bash(...) Running…`), como o CLI real num comando longo; o que e digitado continua indo para a caixa e o Enter para a fila |

## Comportamento

- Liga bracketed paste (`ESC[?2004h`); desenha banner, caixa entre reguas (`❯ ...`) e
  rodape: `? for shortcuts` ocioso, `! for shell mode` com texto digitado, `esc to interrupt` trabalhando.
- Colagem com 5+ linhas ou 1000+ caracteres vira `[Pasted text #N +M lines]` (M = quebras
  de linha); no Enter o texto completo volta no `prompt`. Colagem menor fica literal na caixa.
  Colagem de um caminho absoluto de imagem (`.png/.jpg/.jpeg/.gif/.webp`) vira `[Image #N]` - tambem
  quando chega sem os marcadores de colagem (ConPTY os descarta): um caminho absoluto de imagem no comeco da
  caixa, ou logo depois de outro `[Image #N]`, vira o placeholder.
- Menu `/`: texto que comeca com `/` (sem espaco) e casa com um comando nativo (`/clear /compact /config
  /cost /exit /help /mcp /memory /model /status`) desenha `  ❯ /model` (e `    /outro`) **acima da regua**.
  Esc fecha o menu mantendo o texto. **Enter com o menu aberto COMPLETA** o comando (`/mod` -> `/model`)
  em vez de enviar - e isso que o driver evita com o Esc antes do Enter. Com o texto ja igual ao comando, Enter envia.
- Esc Esc numa escrita so, ocioso: descarta o texto da caixa.
- **Caixa como a do CLI real** (2.1.293, capturas em `specs/014-chat/spike/b2/logs/q6.txt`): `❯ ` + 1a linha; cada LF abre uma linha nova; linha longa quebra no ultimo espaco que cabe na largura do PTY (`columns - 2`; 100 sem TTY) e **esse espaco nao e desenhado**; toda linha depois da primeira ganha recuo de 2 colunas. E o que fazia o envio multilinha/longo falhar no alfa (`readInputBox` juntava as linhas sem separador). Suposicao sem captura: a largura exata da quebra e o tratamento de espaco duplo no ponto de quebra (o spike mostra linhas de 116 colunas num terminal de 120, que o modelo reproduz). Antes, o falso colava tudo numa linha so e por isso nao reproduzia o bug.
- **Colagem grande sem marcadores (T089)**: como o ConPTY descarta os marcadores, um pedaco de entrada sem eles com 5+ linhas ou 1000+ caracteres vira `[Pasted text #N +M lines]` do mesmo jeito, e os pedacos que chegam em ate 250 ms depois (o PTY parte uma escrita em varias) continuam a MESMA colagem. Sem isso, 500 linhas encheriam a caixa e o chat diria "o texto nao entrou na caixa".
- LF (`\n`) insere quebra de linha na caixa; so CR (`\r`) envia. No Windows o ConPTY descarta os marcadores de bracketed paste antes de um filho Node, entao uma colagem de varias linhas chega como texto puro com LF (como o Ctrl+J do CLI real).
- Inicio: cria o transcript e roda o `command` do `SessionStart` (JSON no stdin) com `session_id`,
  `transcript_path`, `source`, `cwd`, `hook_event_name`.
- Enter: `POST UserPromptSubmit` (header de token do settings) e linha `user` (`turnOrigin: human`,
  `promptSource: typed`) no transcript; depois executa o turno do roteiro. Prompt com `demorar` segura a
  rodada por `DONEL_FAKE_CLAUDE_SLOW_MS`.
- **Fila**: Enter durante a rodada grava `queue-operation enqueue` (`content`, sem uuid) e mostra
  `⎿ queued: ...`; sem `UserPromptSubmit` ainda. No fim da rodada: `queue-operation remove` + attachment
  `queued_command` (`commandMode: prompt`, `humanTurn: true`), depois processa (linha `user` com
  `promptSource: queued` + `UserPromptSubmit`).
- Comandos: `/clear` (abaixo); `/compact` -> `system/compact_boundary` + `SessionStart` (`source: compact`);
  `/config /cost /help /mcp /memory /model /status` -> caveat meta, linha `<command-name>`, stdout e
  `system/local_command` (`commandRun.command`); `/outro` -> `system/informational` `Unknown command: /outro`
  (sem `UserPromptSubmit`); `!cmd` -> linhas `<bash-input>` e `<bash-stdout>`.
- `/pick`: abre um dialogo "Select model" no lugar da caixa de entrada; fica ate Esc (smoke da faixa "o terminal precisa de voce").
- `/clear`: `SessionEnd` (`reason: clear`) + `SessionStart` (`source: clear`, id e transcript novos).
  `/exit` (ou Ctrl-C ocioso): `SessionEnd` (`reason: prompt_input_exit`) e sai com 0.
  Esc / Ctrl-C trabalhando: interrompe o turno (linha `[Request interrupted by user]`); a fila segue.
- Hook cujo evento nao esta no settings e ignorado; porta fechada e fail-open, como o CLI real.

## Formato do roteiro

```json
{
  "turns": [
    { "match": "re:^oi", "steps": [ ... ] },
    { "steps": [ ... ] }
  ],
  "default": { "steps": [ ... ] }
}
```

Opcao de turno `"skipTurnDuration": true`: nao grava a linha `system/turn_duration` no fim da rodada. Sem ela a ultima linha do transcript antecede o hook `Stop` (a ordem que o alfa mostrou), o que o smoke de recepcao precisa para reproduzir o falso "nao estou recebendo a conversa".

Turno escolhido: o primeiro com `match` que casa com o prompt (substring, ou `re:<regex>`); senao
o proximo turno **sem** `match`, em ordem; senao `default` (padrao: espera 150 ms, assistente `OK`, `Stop`).

Passos (`type`):

- `{"type":"wait","ms":N}`
- `{"type":"assistant","text":"..."}` - linha assistant (bloco `text`)
- `{"type":"thinking","text":"..."}`
- `{"type":"hook","event":"Stop","payload":{...}}` - qualquer evento (`Notification`, `StopFailure`,
  `SubagentStart`...); `payload` e mesclado ao corpo base
- `{"type":"tool","name":"Bash","input":{...},"result":"...","delayMs":N,"isError":false,"permission":false,"id":"toolu_x"}`
  - grava `tool_use`, (se `permission`) `PermissionRequest`, `PreToolUse`, espera `delayMs`, grava
  `tool_result` e dispara `PostToolUse`. `PermissionRequest` segura ate a resposta HTTP (limite: timeout acima).

### Pedidos segurados (014, T080)

Passos que simulam o CLI pedindo permissao/pergunta/plano. Cada um grava o `tool_use` no transcript, dispara
`PreToolUse` e depois `PermissionRequest` (**sem** `tool_use_id`, como o CLI real; com `permission_suggestions` se houver,
e `agent_id`/`agent_type` para subagentes) e **espera** a resposta do hook por `DONEL_FAKE_CLAUDE_PERMISSION_TIMEOUT_MS`.
Enquanto espera, desenha no lugar da caixa um dialogo da TUI (barra `▔▔▔`, nome da ferramenta, "Do you want to proceed?").
Campos comuns (todos opcionais): `id` (tool_use_id), `result` (texto do `tool_result` ao permitir), `delayMs`,
`denyReply` (texto do assistente apos uma negacao), `suggestions` (`permission_suggestions`).

- `{"type":"bash_permission","command":"npm install left-pad","description":"Install","rule":"npm install:*"}` - Bash; sugestao
  `addRules` `Bash(<rule>)` (`rule` padrao: duas primeiras palavras do comando + `:*`).
- `{"type":"edit_permission","file_path":"a.ts","old_string":"a","new_string":"b"}` - Edit (sem sugestao de regra).
- `{"type":"ask","questions":[{"question":"Which db?","header":"DB","options":[{"label":"Postgres"},{"label":"SQLite"}],"multiSelect":false}]}` - `AskUserQuestion`. O `tool_result` segue o CLI real (2.1.314): uma observacao em `updatedInput.annotations[pergunta].notes` entra como `"pergunta"="resposta" notes: ...`.
- `{"type":"plan","plan":"# Plan\n- a","planFilePath":"C:/x/plan.md"}` - `ExitPlanMode`.
- `{"type":"permission","name":"WebFetch","input":{...},"suggestions":[...]}` - qualquer ferramenta.
- `{"type":"subagent_permissions","requests":[{"type":"bash_permission","command":"npm test","agentType":"tester"},{"type":"edit_permission",...}]}` -
  dispara `SubagentStart` (`agent_id` `agent-1`, `agent-2`..., ou `agentId` explicito) e segura **todos os pedidos em
  paralelo**, cada um com a sua resposta; ao fim, `SubagentStop`. Pedidos de subagente nao gravam `tool_use`/`tool_result` no
  transcript principal (no CLI real ficam no arquivo do subagente); `"transcript":true` forca. O dialogo da TUI mostra o
  primeiro da fila ("1 of N"); responder o dialogo avanca para o seguinte.

Resposta do hook (`hookSpecificOutput.decision`) e como o falso a aplica:

| Decisao | Efeito |
|---|---|
| `allow` (+ `updatedInput` opcional) | `tool_result` (em `AskUserQuestion` traz as `answers` do `updatedInput`) e `PostToolUse` |
| `allow` + `updatedPermissions` (`addRules`, `destination` `localSettings`) | alem do acima, grava/mescla `<cwd>/.claude/settings.local.json` (`permissions.allow` com `Tool(ruleContent)` ou `Tool`) |
| `deny` + `message` | `tool_result` com `is_error` e a mensagem; sem `PostToolUse`; o turno segue (`denyReply`) |
| `deny` + `interrupt:true` | sem `tool_result`; linha `[Request interrupted by user]` e o turno termina sem os passos seguintes (sem `Stop`) |
| `{}`, corpo vazio, timeout ou porta fechada | cai no dialogo da TUI |
| `allow` **sem** `updatedInput` em `ExitPlanMode` | **ignorado**, como no CLI real: segue esperando (TUI) |

**Responder pela TUI** (vale a primeira resposta - a do hook que chegar depois e ignorada e registrada como `lateHookResponse`):

- permissao/plano: `1` = permitir (`tool_result` + `PostToolUse`); `2` = permitir sempre (grava a regra sugerida, ou `Tool`, em
  `settings.local.json`); `3` ou `Esc` = negar (`tool_result` de erro, sem `PostToolUse`; o turno segue).
- `ask`: `1`..`N` escolhe a opcao N da primeira pergunta (as demais pegam a primeira opcao); `Esc` nega.

`DONEL_FAKE_CLAUDE_LOG` registra, alem dos hooks disparados: `{"hookResponse":"PermissionRequest","tool_use_id","tool_name","agent_id"?,"body","effective"}`
para cada resposta recebida (`effective:false` = vazia/ignorada), `{"permissionOutcome":"allow|deny","source":"hook|tui","tool_use_id",...}` e
`{"lateHookResponse":"PermissionRequest","tool_use_id"}`.

Exemplo (trabalhando -> aguardando): `{"default":{"steps":[{"type":"hook","event":"Notification","payload":{"message":"Claude needs your permission"}},{"type":"wait","ms":800},{"type":"hook","event":"Stop"}]}}`

Teste do proprio falso: `tests/fake-claude-chat.test.ts` e `tests/fake-claude-chat-permissions.test.ts` (pedidos segurados).
