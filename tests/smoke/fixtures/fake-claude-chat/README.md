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
| `DONEL_FAKE_CLAUDE_SLOW_MS` | Duracao extra (padrao 3000) de uma rodada cujo prompt contem `demorar`; Esc a encerra antes |
| `DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER` | `1`: o primeiro Enter com texto na caixa e engolido (Enter perdido), para testar o reenvio de `\r` |

## Comportamento

- Liga bracketed paste (`ESC[?2004h`); desenha banner, caixa entre reguas (`❯ ...`) e
  rodape: `? for shortcuts` ocioso, `! for shell mode` com texto digitado, `esc to interrupt` trabalhando.
- Colagem com 5+ linhas ou 1000+ caracteres vira `[Pasted text #N +M lines]` (M = quebras
  de linha); no Enter o texto completo volta no `prompt`. Colagem menor fica literal na caixa.
  Colagem de um caminho absoluto de imagem (`.png/.jpg/.jpeg/.gif/.webp`) vira `[Image #N]`.
- Menu `/`: texto que comeca com `/` (sem espaco) e casa com um comando nativo (`/clear /compact /config
  /cost /exit /help /mcp /memory /model /status`) desenha `  ❯ /model` (e `    /outro`) **acima da regua**.
  Esc fecha o menu mantendo o texto. **Enter com o menu aberto COMPLETA** o comando (`/mod` -> `/model`)
  em vez de enviar - e isso que o driver evita com o Esc antes do Enter. Com o texto ja igual ao comando, Enter envia.
- Esc Esc numa escrita so, ocioso: descarta o texto da caixa.
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

Exemplo (trabalhando -> aguardando): `{"default":{"steps":[{"type":"hook","event":"Notification","payload":{"message":"Claude needs your permission"}},{"type":"wait","ms":800},{"type":"hook","event":"Stop"}]}}`

Teste do proprio falso: `tests/fake-claude-chat.test.ts`.
