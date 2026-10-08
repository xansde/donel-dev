# Contrato — linhas da conversa e adaptador do transcript

Fronteira D3 da spec: **a tela só conhece `ConversationRow` + `LiveState`**
(`data-model.md` §4 e §10). Este contrato fixa como o adaptador
(`src/shared/chat/adapter.ts`, puro) transforma o transcript do CLI nesse
modelo. Base empírica: catálogo de estrutura do CLI 2.1.286–2.1.293
(`research.md` R11), sem conteúdo real.

Trocar o transporte no futuro (ex.: Agent SDK) = escrever outro adaptador que
produza as mesmas linhas. Nada abaixo da §1 vaza para os componentes.

## 1. Garantias do adaptador

1. **Puro e incremental**: `adapt(state, entries) → { state, patches }`.
   `patches` = `append` / `replace` (mesmo `id`) / `prepend` (histórico).
   O mesmo arquivo lido de uma vez ou em pedaços produz as mesmas linhas.
2. **Nunca lança** por conteúdo: linha inválida vira `unknown`; tipo novo
   vira `unknown` ou é ignorado se estiver na lista de ruído (§6).
3. **Ordem = cadeia ativa** (§3), nunca `timestamp`.
4. **Sem conteúdo pesado em memória**: saída de comando, conteúdo lido,
   imagens e diffs ficam no disco; a linha guarda `LineRef` e o resumo.
5. **Sem credencial e sem dado de conta**: os attachments de conta e de
   contexto de sessão são descartados antes de qualquer outra regra (FR-031).

## 2. Classificação de uma linha (ordem de precedência)

Cada linha do JSONL passa pela primeira regra que casar.

| # | Condição | Resultado |
|---|---|---|
| 0 | JSON inválido ou linha > 8 MB | `unknown` (`reason: json \| too-large`) |
| 1 | Sem `uuid` e com `type` de metadados (`permission-mode`, `last-prompt`, `custom-title`, `ai-title`, `agent-name`, `mode`, `cost-state`, `pr-link`, `queue-operation`, `file-history-snapshot`, `file-history-delta`, `bridge-session`, `atis-latch`, `history-suppression`) | `meta` — alimenta estado (modo de permissão, fila, título); não vira linha |
| 2 | `isSidechain: true` no arquivo principal | descartada (subagente tem arquivo próprio) |
| 3 | `type: attachment` com `attachment.type` na lista de ruído (§6) | descartada |
| 4 | `type: attachment` reconhecido (§2.1) | linha ou efeito conforme a tabela |
| 5 | `type: system` | §2.2 |
| 6 | `type: assistant` | §2.3 (um bloco por linha) |
| 7 | `type: user` | §2.4 (subordem obrigatória) |
| 8 | qualquer outro | `unknown` (`typeLabel` = `type`) |

### 2.1 Attachments reconhecidos

| `attachment.type` | Vira |
|---|---|
| `queued_command` (`commandMode: prompt`, `humanTurn: true`) | `user` com `queued: true` (deduplicar com a linha `user` gêmea pelo texto) e sinal de aceite de envio na fila |
| `queued_command` (`commandMode: task-notification`) | atualização do `subagent` correspondente (§8) |
| `file` (menção `@`) | anexo `mention` da mensagem do dono mais próxima na cadeia |
| `plan_mode` | `notice` discreto "entrou no modo plano" |
| `edited_text_file` | `notice` `informational` "arquivo alterado fora da conversa: `x`" |
| `task_status` | atualização de `action` em segundo plano (Bash `backgroundTaskId`) |
| `hook_non_blocking_error`, `hook_system_message`, `hook_permission_decision` | `notice` `informational` com o nome do hook |
| `skill_listing` | não vira linha; alimenta o catálogo do menu `/` (R3) |

### 2.2 `system`

| `subtype` | Vira |
|---|---|
| `compact_boundary` | `notice` `compact` (tokens antes → depois); ponto de salto da cadeia (`logicalParentUuid`) |
| `turn_duration` | não vira linha; fecha a rodada; `pendingBackgroundAgentCount > 0` mantém subagentes `running` |
| `local_command` | `local-command` (`commandRun.command`/`args`, saída) |
| `informational` | `notice` `informational` (`level: warning` destacado) |
| `stop_hook_summary` | descartada, salvo `preventedContinuation` ou `hookErrors` não vazio → `notice` |
| outro | `unknown` |

### 2.3 `assistant` (um bloco de conteúdo por linha)

| Situação | Vira |
|---|---|
| `isApiErrorMessage: true` ou `model: "<synthetic>"` | `notice` `limit` (erro de limite) ou `api-error` |
| bloco `text` | `assistant` (`messageId` + `apiBlockIndex` agrupam blocos da mesma resposta) |
| bloco `thinking` | `thinking` (`durationMs` = `thinkingDurationMs` da linha) |
| bloco `tool_use` `Agent` | `subagent` (`status: running`) |
| bloco `tool_use` `Skill` | `skill` `used-by-claude` |
| bloco `tool_use` `AskUserQuestion` | `question` (respostas chegam no `tool_result`) |
| bloco `tool_use` `ExitPlanMode` | `plan` (`outcome: pending` até o `tool_result`) |
| outro `tool_use` | `action` `status: running` (resumo provisório pelo `input`) |
| `isAbortedMidStream: true` | a linha segue o caso acima + `notice` `interrupted` |

### 2.4 `user` (subordem — a primeira que casar)

1. Bloco `tool_result` → fecha a linha do `tool_use_id`: `status` (`is_error`,
   `toolDenialKind`, `interrupted`), resumo final (§4) e `detail` (`LineRef`).
2. `origin.kind` `task-notification` → atualiza o `subagent` (`status`,
   `usage`) e **abre rodada** com `opener: notification`. `peer`/`coordinator`
   → `notice` `informational`.
3. `isMeta: true` → descartada (corpo de skill, avisos ao modelo, notas
   `[Image: …]`).
4. `isCompactSummary: true` → descartada (o aviso `compact` já marca o ponto).
5. Texto com `<command-name>` → `user` com `command: { name, args }`; se for
   skill, também `skill` `loaded-by-user`. `<local-command-caveat>` é
   descartada; `<local-command-stdout>` vira saída do `local-command`.
6. `<bash-input>` → `shell`; a linha seguinte `<bash-stdout>`/`<bash-stderr>`
   completa a mesma linha.
7. `[Request interrupted by user…]` → `notice` `interrupted`.
8. Demais (`turnOrigin: human` / `promptSource` typed\|queued\|…) → `user`;
   blocos `image` viram anexos `image` (`LineRef` + `blockIndex`), e os
   marcadores `[Image #n]` no texto são substituídos pela miniatura.

## 3. Cadeia ativa e paginação

O arquivo é uma **árvore** (`parentUuid`), não uma lista: rewind e prompts
abandonados criam galhos; attachments de hook e resultados de chamadas
paralelas ficam como folhas laterais. Regras:

1. **Folha** = última linha-nó `user`/`assistant`/`system` na ordem do
   arquivo. `last-prompt.leafUuid` é só dica.
2. **Subir** por `parentUuid`. Em `parentUuid: null` com `logicalParentUuid`,
   pular a compactação e desenhar o aviso `compact`. Pai não resolvido = raiz.
3. **Completar** cada resposta: toda linha com o mesmo `message.id` de uma
   linha da cadeia entra (≈0,5% ficam fora da cadeia), e `tool_result`s são
   presos à sua ação pelo `tool_use_id` (≈7% ficam fora da cadeia).
4. **Paginação para trás** (FR-010): o pager lê blocos de 256 KB a partir do
   fim, tolera linhas de até 8 MB atravessando blocos, e devolve linhas na
   ordem inversa. O adaptador mantém `expectedParent`: uma linha-nó lida para
   trás só entra se `uuid === expectedParent` (aí `expectedParent ←
   parentUuid`); `tool_result`s vistos antes do seu `tool_use` ficam
   pendurados por `tool_use_id` até ele aparecer. Página inicial = até 30
   rodadas **ou** 2 MB lidos, o que vier antes.
5. **Seguimento adiante**: bytes novos desde `forward.offset`; resto de linha
   incompleta guardado em `forward.partial`. Uma linha-nó nova cujo pai não é
   a folha atual = **rewind**: a timeline é recalculada a partir da nova
   folha (patch `replace` das rodadas afetadas).

## 4. Resumo das ações (português)

Caminhos: relativos ao `cwd` quando estiverem dentro dele; senão o nome do
arquivo, com o caminho inteiro no título (tooltip).

| Ferramenta | `verb` / `target` / `stats` | Detalhe ao expandir |
|---|---|---|
| `Read` | "Leu" / arquivo / "linhas a–b" se parcial; imagem: "Viu a imagem"; PDF: "Leu o PDF" | caminho e intervalo; conteúdo só por "ver conteúdo" |
| `Write` | `create`: "Criou" / arquivo / "N linhas"; `update`: "Reescreveu" / arquivo / "+a −b" | diff (`structuredPatch`) |
| `Edit` | "Editou" / arquivo / "+a −b" (somados dos `structuredPatch`) | diff colorido |
| `Bash` / `PowerShell` | "Rodou" / comando curto (rótulo sem invólucros `bash -lc`/`powershell -c`, ≤ 60 chars); segundo plano: "Rodou em segundo plano" | comando inteiro + saída (40 linhas / 8 KB, "ver tudo" relê `persistedOutputPath` ou a linha) |
| `Grep` | "Buscou" / `'padrão'` / "em N arquivos" ou "nada encontrado" | lista de arquivos (50 + "ver tudo") |
| `Glob` | "Listou" / padrão / "N arquivos" | lista de arquivos |
| `WebFetch` / `WebSearch` | "Abriu" / domínio · "Pesquisou na web" / `'consulta'` | URL ou consulta + tamanho do resultado |
| `TodoWrite` e ferramentas de tarefa | "Atualizou a lista de tarefas" | itens |
| `ToolSearch` | "Carregou ferramentas" | nomes |
| `Monitor` / `TaskStop` / `SendMessage` / `Workflow` | "Acompanhou tarefa" / "Parou tarefa" / "Mandou mensagem" / "Rodou workflow" + nome | campos do resultado |
| `mcp__<servidor>__<ferramenta>` | "Usou" / `servidor · ferramenta` | entrada (JSON truncado) + saída |
| desconhecida | "Usou" / nome da ferramenta | entrada e saída cruas, truncadas |

`category` sai da mesma tabela (`read`, `write`, `edit`, `bash`, `search`,
`web`, `task`, `mcp`, `other`). Diffs vêm **do próprio transcript**
(`structuredPatch`): o app não recalcula diff.

## 5. Agrupamento

- Grupo = sequência máxima de `action`s da mesma rodada e escopo, sem
  `assistant`, `user`, `subagent`, `skill`, `question`, `plan` ou `notice` no
  meio. Linhas `thinking` intercaladas **entram** no grupo (não o quebram).
- Só vira `action-group` com 2 ou mais ações.
- Rótulo: "N ações — leu a, editou b, rodou c" (até 3 categorias, por
  contagem; o resto vira "e mais k").
- Ações com erro aparecem no cabeçalho recolhido: "1 falhou: Rodou `npm
  test`" (AS 3.3). A ação ainda `running` aparece como última linha do grupo,
  aberta.
- Id do grupo = `group:<toolUseId da primeira ação>` — estável enquanto o
  grupo cresce (patch `replace`).

## 6. Lista de ruído (descartados sem virar linha)

Attachments: `hook_success`, `hook_additional_context`, `total_tokens_reminder`,
`deferred_tools_record`, `deferred_tools_delta`, `prompt_snapshot`,
`environment`, `date`, `model`, `language`, `instructions`, `session_context`,
`credential_org`, `auto_mode`, `remote_session_change`, `thinking_drop`,
`structured_output`, `command_permissions`, `agent_listing_delta`,
`mcp_instructions_delta`, `nested_memory`.

`session_context` e `credential_org` carregam dados da conta: o descarte
acontece **antes** do registro de `unknown`, para nunca aparecerem no bloco
bruto.

## 7. Avisos (`notice`)

| `notice` | Fonte | Texto (exemplo) |
|---|---|---|
| `compact` | `system/compact_boundary` | "Conversa compactada — 180 mil → 12 mil tokens" |
| `limit` | erro sintético de limite; hook `StopFailure` ao vivo | "Limite da conta atingido" |
| `api-error` | erro sintético; `StopFailure` | "Erro da API — a rodada parou" |
| `interrupted` | marcador de interrupção; `isAbortedMidStream` | "Interrompido" |
| `account-switch` | evento `accounts:changed` do app, inserido ao vivo no fim | "Conta trocada para <rótulo>" (rótulo, nunca e-mail) |
| `conversation-switch` | troca de fonte (FR-033) | "Conversa nova — a anterior está em Sessões anteriores" |
| `informational` | `system/informational`, hooks, `plan_mode`, `edited_text_file` | texto curto da fonte |
| `generated-file` | `Write` de arquivo com extensão de documento/imagem (`html`, `md`, `pdf`, `png`, `jpg`, `svg`, `csv`, `txt`) | "Gerou `relatorio.html` — abrir" (abre com o app padrão do sistema; extensões executáveis nunca) |

Avisos nascidos de evento do app vivem só na memória da aba: ao reabrir a
sessão, o histórico mostra o que o transcript tem.

## 8. Subagentes

- Linha `subagent` nasce no `tool_use` `Agent`, na posição dele.
- `.meta.json` (`<sessão>/subagents/agent-<agentId>.meta.json`) completa
  `agentType`, `description`, `model`, `requestShape`, `spawnDepth`,
  `parentAgentId`. Ligação: `meta.toolUseId === tool_use.id` e
  `toolUseResult.agentId === agentId`.
- Estado final vem da notificação `<task-notification>` (`status`, `usage`),
  que chega como linha `user` com `origin.kind: task-notification` ou como
  `queued_command` (`commandMode: task-notification`) no meio de rodada.
- "Última ação" ao vivo: hook `PreToolUse` com `agent_id` (R15) e, sem ele, a
  cauda do arquivo do subagente.
- A conversa do subagente usa **este mesmo contrato**, com `scope: { agentId }`
  — mesmo adaptador, mesmo Modo Foco (AS 5.2). Aninhados aparecem dentro dela
  como `subagent` com `depth` maior; "ver" abre no mesmo painel.
- Agentes de workflow (`subagents/workflows/…`) ficam na ação `Workflow`
  (fora da faixa de subagentes nesta entrega).

## 9. Evolução de versão do CLI

- Campo desconhecido em tipo conhecido: ignorado.
- `type`/`subtype`/`attachment.type`/bloco desconhecido: `unknown` com o rótulo
  do tipo e "ver bruto" (JSON truncado em 4 KB).
- Cada tipo desconhecido é registrado **uma vez por sessão** em
  `userData/chat-diagnostics.log` (JSONL: `unknown-entry`, rótulo, versão do
  CLI), sem conteúdo. É o sinal para atualizar o adaptador.
- Fixtures de teste por versão do CLI em `tests/fixtures/chat/` (sintéticas,
  com nomes genéricos — regra do espelho público).
