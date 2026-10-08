# fake-claude-chat (014, T040)

`claude` falso e roteirizado para os smokes do chat. Aponte
`DONEL_CLAUDE_EXECUTABLE_FIXTURE` para `claude.cmd` (que repassa os argumentos
para `fake-claude-chat.mjs`). Node puro, sem dependencias; funciona com qualquer cwd.

## Argumentos

`--session-id <id>`, `--settings <arquivo>` (o JSON por sessao do app: entradas `http`
e o `command` do `SessionStart`), `-r|--resume <id>` (usa o id e dispara `SessionStart`
com `source: resume`). Os demais sao ignorados.

## Ambiente

| Variavel | Efeito |
|---|---|
| `DONEL_FAKE_CLAUDE_SCENARIO` | Roteiro: JSON inline (comeca com `{`) ou caminho de um arquivo JSON |
| `DONEL_FAKE_CLAUDE_HOME` | Raiz dos transcripts: `<home>/projects/<cwd-codificado>/<session_id>.jsonl` (padrao: pasta temporaria do SO) |
| `DONEL_FAKE_CLAUDE_LOG` | Se definida, acrescenta uma linha JSON por hook disparado (diagnostico) |
| `DONEL_FAKE_CLAUDE_HOOK_TIMEOUT_MS` | Espera maxima por resposta de hook `http` (padrao 5000) |

## Comportamento

- Liga bracketed paste (`ESC[?2004h`); desenha banner, caixa entre reguas (`❯ ...`) e
  rodape: `? for shortcuts` ocioso, `! for shell mode` com texto digitado, `esc to interrupt` trabalhando.
- Colagem com mais de 2 linhas ou 800+ caracteres vira `[Pasted text #N +M lines]` (M = quebras
  de linha); no Enter o texto completo volta no `prompt`.
- Inicio: cria o transcript e roda o `command` do `SessionStart` (JSON no stdin) com `session_id`,
  `transcript_path`, `source`, `cwd`, `hook_event_name`.
- Enter: `POST UserPromptSubmit` (header de token do settings) e linha `user` no transcript; depois
  executa o turno do roteiro. Enter durante um turno enfileira.
- `/clear`: `SessionEnd` (`reason: clear`) + `SessionStart` (`source: clear`, id e transcript novos).
  `/exit` (ou Ctrl-C ocioso): `SessionEnd` (`reason: prompt_input_exit`) e sai com 0.
  Esc / Ctrl-C trabalhando: interrompe o turno (linha `[Request interrupted by user]`).
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
