# Fixtures de transcript do chat (T019)

Transcripts **sinteticos** no formato do CLI 2.1.293 (`specs/014-chat/spike/transcript-schema.md`).
Gerados por `build-fixtures.mjs` (deterministico: sem relogio, sem aleatoriedade):

    node tests/fixtures/chat/build-fixtures.mjs

Conteudo generico (`atlas`, `beacon`, `vega`); valores "sensiveis" sao falsos de proposito
(`fake.user@example.invalid`, `FAKE-ORG-TOKEN-0000`, `acct-fake-0000`, `org-fake-0000`).
Os `.jsonl` gerados ficam commitados. A pasta `screens/` e de outra frente.

| Arquivo | Cenario |
|---|---|
| `basic-round.jsonl` | Rodada simples: prompt, thinking, `tool_use` Read + `tool_result`, texto final, `turn_duration`; metas (`permission-mode`, `last-prompt`, `ai-title`, `cost-state`); ruido `session_context`/`credential_org`/`hook_success`; `skill_listing`. |
| `tool-results.jsonl` | Todos os `toolUseResult` da tabela do catalogo: Bash (normal, segundo plano, `persistedOutputPath`, `gitOperation`), PowerShell, Read (text/image/pdf/file_unchanged), Write (create/update), Edit, Grep (com e sem resultado), Glob, Agent, AskUserQuestion, ExitPlanMode, WebFetch, WebSearch, Skill, ToolSearch, Monitor, TaskStop, SendMessage, Workflow, TodoWrite, MCP, ferramenta desconhecida, negado pelo usuario (`toolDenialKind`), erro (`is_error`). |
| `commands.jsonl` | Comando local (`<local-command-caveat>`, `<command-name>`, `<local-command-stdout>`, `system/local_command`); skill digitada (`<command-name>` + corpo `isMeta` + `command_permissions`); skill via ferramenta; modo `!` (`<bash-input>`/`<bash-stdout>`). |
| `interrupt.jsonl` | `[Request interrupted by user]`, `... for tool use]`, `isAbortedMidStream`, resultado `interrupted`. |
| `image-prompt.jsonl` | Prompt com imagem (`image` base64 minusculo, `imagePasteIds`, `[Image #1]`, nota `isMeta` `[Image: source...]`). |
| `queue-compact.jsonl` | `queued_command` (`prompt`) com e sem linha `user` gemea, `queue-operation`; `compact_boundary` (pai nulo + `logicalParentUuid`) seguido do resumo `isCompactSummary`. |
| `tree-rewind.jsonl` | Rewind: o terceiro prompt aponta para o fim da rodada 1; a rodada 2 fica como galho abandonado. |
| `tree-parallel.jsonl` | Chamadas paralelas: dois `tool_use` do mesmo `message.id`; o resultado do primeiro e folha lateral; attachment de hook como folha lateral do prompt. |
| `errors-noise.jsonl` | Todas as linhas de metadados; todos os attachments de ruido (inclusive `session_context`/`credential_org`); erro sintetico de API e de limite (`<synthetic>`); attachments reconhecidos; attachment/system/type desconhecidos; `stop_hook_summary` (silencioso e com erro); linha `isSidechain: true` vazada; linha de JSON invalido. |
| `sess-subagent.jsonl` + `sess-subagent/subagents/` | Subagente: `tool_use` Agent assincrono, `tool_result` `async_launched`, `<task-notification>` como linha `user` (`origin.kind: task-notification`) e como `queued_command` no meio da rodada; `agent-vega01.jsonl` + `.meta.json`; `agent-vega02.meta.json` (sem arquivo de linhas). `meta.toolUseId` liga ao `tool_use`. |
| `edge-big-line.jsonl` | Linha de mais de 1 MB (`tool_result` gigante). |
| `edge-incomplete-last.jsonl` | Ultima linha cortada no meio da escrita (sem `\n`, JSON incompleto). |

Linhas maiores que 8 MB e arquivos para paginacao sao gerados em runtime pelos testes (nao ficam no repo).
