# Esquema dos transcripts do Claude Code (CLI 2.1.286-2.1.293) - só estrutura

Foto de 2026-10-07 de `~/.claude/projects`: 36-45 transcripts principais (cresceu durante a análise), 271 de subagentes, 129 de agentes de workflow, 3 journals de workflow, ~145k linhas, 0 ilegíveis. Em disco só existem as versões 2.1.286-2.1.293 (sem linhas `summary`/`progress`, nada mais antigo). UTF-8, LF, sem BOM, somente-append; as contagens variam enquanto as sessões vivas crescem.

## 1. Layout
- `<proj>` = primeiro `cwd` com todo caractere não alfanumérico trocado por `-` (44/45 exatos; com perda, então leia o `cwd` das linhas). Principal: `<proj>/<sessionId>.jsonl`. Subagente: `<proj>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json` (diretório plano, mesmo quando aninhado). Agentes de workflow: `subagents/workflows/wf_<id>/agent-*.jsonl|.meta.json` + `journal.jsonl`; `<sessionId>/workflows/wf_<id>.json`.
- `<sessionId>/tool-results/*.txt`: saídas grandes despejadas em disco (`toolUseResult.persistedOutputPath`). `<proj>/memory/` guarda outros .jsonl que não são transcripts: ignorar.

## 2. `type` das linhas
Linhas-nó têm `uuid`, `parentUuid` (str|null), `isSidechain`, `timestamp` (ISO-8601 ms Z), `sessionId`, `cwd`, `version`, `gitBranch` (cwd/branch podem mudar no meio do arquivo), `userType`="external", `entrypoint` (cli|claude-desktop|sdk-ts|sdk-cli); às vezes `slug` e `session_id` duplicado. Arquivos de subagente trazem `agentId` em toda linha e `isSidechain:true` (principal: sempre false).

| type | n principal | chaves específicas |
|---|---|---|
| attachment | 10112 (sub 61k) | `attachment{type,...}`; algumas têm `rendered[{content}]`+`renderedRole` system\|user (cópia voltada ao modelo); sem `message` |
| assistant | 4327 (sub 25k) | `message`, `requestId`, `apiBlockIndex`, `effort`, `perTurnEffort`, `advisorModel`, `thinkingDurationMs`, `wireToolInputs` (ignorar), `attribution{Agent,Skill,McpServer,McpTool}` |
| user | 2674 (sub 15k) | `message{role,content}`, `promptId`, `toolUseResult`, `sourceToolAssistantUUID`, proveniência (s4) |
| system | 845 | `subtype`, `level`, `content`, `isMeta` (s6) |

Linhas de metadados (sem uuid; `type`+`sessionId`+carga), reescritas várias vezes e em bloco final: `last-prompt{leafUuid,lastPrompt?}`, `ai-title{aiTitle}` (vale a última), `custom-title{customTitle}`+`agent-name{agentName}` (só após renomear), `mode`, `permission-mode` (bypassPermissions|default|auto|plan), `atis-latch{atis}` (opaco), `bridge-session` (ids da ponte remota), `pr-link{prNumber,prUrl,prRepository,timestamp}`, `cost-state{totalCostUSD,totalDuration,totalAPIDuration,totalLinesAdded/Removed,startTime,modelUsage{model:{tokens...,costUSD}}}`, `history-suppression`, `queue-operation{operation enqueue|dequeue|remove,timestamp,content?,reason? absorbed_mid_turn|delivered_to_agent,commandUuid?,deliveryId?}`, `file-history-snapshot{messageId=uuid de um prompt do usuário,snapshot{trackedFileBackups{path:{backupFileName,version,backupTime}}},isSnapshotUpdate}` (checkpoint de rewind), `file-history-delta{messageId=uuid do assistant que editou,snapshotMessageId,trackingPath,backup}`. Journals: `started`, `result` (`key,agentId,...`), `launched`.

## 3. Linhas assistant
- `message{id,type:"message",role,model,content[],stop_reason,stop_sequence,stop_details,usage,container,context_management,diagnostics,input_transformations}`; `usage{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,iterations[],speed,...}`.
- Exatamente UM bloco de conteúdo por linha. Uma resposta da API = N linhas com o mesmo `message.id` + `requestId`, `apiBlockIndex` 0..N-1, `uuid`s distintos, `parentUuid` normalmente = bloco anterior. Adjacentes em 96% dos casos; no resto, linhas de tool_result/hook se intercalam. `stop_reason` e `output_tokens` só são finais na última linha (as anteriores podem estar null ou já copiadas).
- Blocos: `tool_use{id:"toolu_*",name,input,caller{type:"direct"}}` 57%; `thinking{thinking,signature}` 37% (texto vazio em 98%, senão ~240 caracteres; duração em `thinkingDurationMs` da linha; sem `redacted_thinking`); `text{text}` 6% (sem citations). Ferramentas MCP são `tool_use` comuns chamadas `mcp__server__tool`; sem server_tool_use.
- Erros: `model:"<synthetic>"`, `isApiErrorMessage:true`, `error` (authentication_failed|server_error|unknown), `apiErrorStatus?` (529), um bloco de texto, `stop_reason:"stop_sequence"`. `isAbortedMidStream:true` = stream cortado.

## 4. Linhas user
`content` = string (prompts digitados, notificações, blocos de tags) ou array. Exatamente um `tool_result` por linha user (chamadas paralelas = várias linhas). Classificar nesta ordem:
1. `tool_result{tool_use_id,content,is_error?}`; `content` = string ou array de `text`|`image`|`tool_reference{tool_name}`|`document`. `sourceToolAssistantUUID` = linha assistant que contém o tool_use. `toolUseResult` é irmão (obj|arr; string simples quando is_error). Extras: `permissionDecision{decision,source,reasonType}`, `toolDenialKind` permission-rule|user-rejected. Os diálogos de permissão não são gravados, só os resultados.
2. `origin.kind` task-notification|peer|coordinator (`turnOrigin` task_notification|peer): não é humano (s8).
3. `isMeta:true`: só para o modelo (caveats, corpos de skill, notas `[Image: ...]`, texto de peer). Ocultar/colapsar.
4. `isCompactSummary` (+`isVisibleInTranscriptOnly`): resumo pós-compactação.
5. String com `<command-name>`, `<command-message>`, `<command-args>` (ordem varia; forma de skill acrescenta `<skill-format>`). Comando local: linha meta `<local-command-caveat>`, linha do comando, depois linha `<local-command-stdout>` (a 2.1.293 acrescenta `system/local_command`). Comando-prompt ou skill digitado pelo usuário: linha de comando não-meta, depois corpo meta em array de texto (+ attachment `command_permissions`); via ferramenta Skill: tool_result, depois o mesmo corpo meta.
6. Linha `<bash-input>` e depois linha `<bash-stdout>`+`<bash-stderr>` (modo `!`; sem toolUseResult).
7. Array com texto `[Request interrupted by user]` ou `[Request interrupted by user for tool use]` (+`interruptedMessageId` = `message.id` interrompido).
8. Senão, humano: `turnOrigin:"human"`, `promptSource` typed|queued|suggestion_accepted|sdk, `permissionMode`, `turnPosition{promptIndex,turnIndex}`. Prompts com imagem: `[text,image{source{type:"base64",media_type,data}}]`, `imagePasteIds[]`, placeholders `[Image #n]`, depois uma linha meta `[Image: source...]`.
`promptId` = id do turno (o prompt e seus tool_results o compartilham). Prompt humano digitado no meio do turno vive em `attachment/queued_command{commandMode:"prompt",humanTurn:true}`: 17/28 não têm gêmeo em linha user, 11 também aparecem como linha user (deduplicar por texto); prompts drenados depois do turno aparecem como linhas user `promptSource:"queued"`.

Chaves de `toolUseResult`:

| ferramenta | chaves |
|---|---|
| Bash/PowerShell | `stdout,stderr,interrupted,isImage,noOutputExpected`; opc. `backgroundTaskId,returnCodeInterpretation,persistedOutputPath/Size,timedOutAfterMs,gitOperation{commit,push,pr,branch},bashEditDiff{files,changedFiles,moreFiles}` |
| Read | `type` text\|image\|pdf\|file_unchanged; `file{filePath,content(cru),numLines,startLine,totalLines}` ou, em imagem, `file{base64,type,originalSize,dimensions}` (a string do tool_result vem com prefixos de cat -n) |
| Write | `type` create\|update, `filePath,content,originalFile,structuredPatch[],userModified` (create: patch vazio) |
| Edit | `filePath,oldString,newString,originalFile,structuredPatch[{oldStart,oldLines,newStart,newLines,lines[]}],userModified,replaceAll`; linhas prefixadas com ` `/`+`/`-` |
| Grep / Glob | `mode,numFiles,filenames[],content?,numLines?,appliedLimit?` / `filenames[],numFiles,durationMs,truncated` |
| Agent | `status:"async_launched",agentId,description,prompt,isAsync,outputFile,canReadOutputFile,resolvedModel`; sem duração/tokens/usage (chegam na notificação) |
| AskUserQuestion | `questions[{question,header,multiSelect,options[]}],answers{textoDaPergunta:resposta}` |
| ExitPlanMode | `plan,filePath,isAgent` (input `plan,planFilePath`) |
| WebFetch / WebSearch | `url,code,codeText,bytes,durationMs,result` / `query,results[],durationSeconds` |
| Skill / ToolSearch | `commandName,success` / `matches[],query,total_deferred_tools` (content = blocos `tool_reference`) |
| Monitor, TaskStop, SendMessage, Workflow | `taskId,timeoutMs,persistent`; `task_id,task_type,command,message`; `success,message,pin,resumedAgentId?`; `runId,taskId,status,transcriptDir,workflowName` |
| MCP | array `[{type:"text",text}]` |

Não observados (só builds antigos, não verificado): TodoWrite, MultiEdit, NotebookEdit, resultado síncrono de Agent/Task (`status:"completed"`, `content[]`, `totalDurationMs`, `totalToolUseCount`, `usage`). `toolUseResult` só falta nos arquivos de agentes de workflow.

## 5. Attachments (contagem principal / subagente)
Mostrar no chat: `queued_command` 54/322 `{prompt(str|arr),commandMode prompt|task-notification,origin,humanTurn?,isMeta?,usage?{durationMs,toolUses,totalTokens},source_uuid,delivery_id}`; `file` (@-menção) `{filename,displayPath,content{file}}`; `edited_text_file{filename,snippet}`; `plan_mode{planFilePath,planExists,isSubAgent}`; `task_status{taskId,taskType,status,description,outputFilePath}`; `hook_non_blocking_error|hook_system_message|hook_additional_context|hook_permission_decision`; `nested_memory`.
Ruído (ocultar): `hook_success` 6,5k/48,9k `{hookEvent,hookName,command,stdout,exitCode,toolUseID,...}`, `total_tokens_reminder`, `deferred_tools_record`, `prompt_snapshot` (system prompt + schemas das ferramentas, até 190 KB), `environment`, `date`, `model`, `language`, `instructions`, `session_context` (contém o e-mail do usuário), `credential_org`, `auto_mode`, `remote_session_change`, `thinking_drop`, `structured_output`, `command_permissions{allowedTools}` e outros lembretes.
Catálogos: `skill_listing{names[],skillCount,content,isInitial}` uma vez por sessão (~85 nomes, incluindo `plugin:skill`; `content` = uma linha `- nome: descrição` por skill; comandos nativos de UI como compact/clear/model não aparecem); `agent_listing_delta{addedTypes[],builtInTypes[],removedTypes[]}`; `deferred_tools_delta{addedNames[]...}`; `mcp_instructions_delta{addedNames[]}`. Nenhum attachment enumera slash commands.

## 6. Linhas system
`stop_hook_summary` 416 `{hookCount,hookInfos[],hookErrors[],hasOutput,preventedContinuation,stopReason,toolUseID,level:"suggestion"}`; `turn_duration` 408 `{durationMs,messageCount,pendingBackgroundAgentCount?,pendingWorkflowCount?}` (marcador de fim de turno; pending diferente de zero = agentes ainda rodando); `informational{content,level notice|warning}`; `compact_boundary{content,level,parentUuid:null,logicalParentUuid,compactMetadata{trigger,preTokens,postTokens,durationMs,cumulativeDroppedTokens,preservedSegment{headUuid,tailUuid,anchorUuid},preservedMessages{...}}}` seguido de linha user de resumo, caveat meta e eco do comando; `local_command{content,level,commandRun{command,args}}` (2.1.293). `api_error`/retry não observados.

## 7. Ramificação e cadeia ativa
Das 17,8k linhas-nó principais, 87,8% têm `parentUuid` = linha-nó anterior. As outras 2.132: 2.130 são tool_results cujo pai é o tool_use anterior do assistant (distância p50 3, p90 4, máx 41), 3 raízes de compactação, 1 pai não resolvido (linha inicial apontando para outro arquivo, já removido ou não carregado). É uma árvore: attachments de hook PreToolUse e, em chamadas paralelas, tool_results anteriores ficam como irmãos sem saída, então a maioria dos arquivos tem 6+ folhas (até 400): nunca use "qualquer folha". Bifurcações reais: 2 em ~40 arquivos, ambas prompts abandonados (um prompt enfileirado ao lado de um tool_result; um prompt redigitado que divide o pai com o anterior, cujo galho só tem attachments). Não havia rewind de longo alcance; um rewind acrescentaria uma nova linha user apontando para um nó antigo (nada é apagado).
Algoritmo: (1) indexar linhas-nó por uuid, tool_results por `tool_use_id`, linhas assistant por `message.id`. (2) Folha = última linha-nó user|assistant|system na ordem do arquivo. `last-prompt.leafUuid` é só dica (igual à folha em 31/36 arquivos, senão um ancestral ou galho). (3) Subir por `parentUuid`; em null + `logicalParentUuid`, pular a compactação (desenhar divisor); pai não resolvido = raiz. (4) Renderizar os nós da cadeia, mas incluir TODAS as linhas de cada `message.id` da cadeia (24 de 4.327 estão fora dela) e anexar tool_results por id (6,7% no principal e 8,2% em subagentes estão fora da cadeia). (5) Descartar attachments de ruído, `isMeta` e metadados; filtrar `isSidechain:true` por precaução. Nunca ordenar por timestamp (15% dos passos voltam no tempo, até 219 s). `preservedSegment` só descreve o contexto do modelo.

## 8. Subagentes e tarefas em background
- `meta.json`: `agentType` (general-purpose|Explore|claude-code-guide|workflow-subagent), `description`, `model?`, `effort?`, `requestShape` background|foreground, `requestNonInteractive`, `spawnDepth`, `toolUseId?` (id do tool_use Agent que o lançou, no principal ou no arquivo do agente pai), `parentAgentId?`, `workflowPhase?`. 5 arquivos auxiliares minúsculos de 7 linhas não têm meta.
- Vínculo: tool_use.id do Agent == `meta.toolUseId`; `toolUseResult.agentId` == id no nome do arquivo; content do tool_result = um bloco de texto ("Async agent launched...", agentId, output_file). Linhas de subagente nunca aparecem no principal (0 uuids em comum); cada uma tem o `sessionId` do pai, `agentId`, `isSidechain:true`; primeira linha = prompt user com pai null; `attributionAgent` = agentType. Todas as 266 chamadas Agent daqui foram assíncronas.
- Conclusão: linha user de topo, string `<task-notification>` com `task-id` (== agentId / `backgroundTaskId` / `taskId`), `tool-use-id`, `status` completed|failed|killed|stopped, `summary`, `result`, `usage{subagent_tokens,tool_uses,duration_ms}`, `output-file`, `event` (Monitor), contadores de workflow. No principal: `origin.kind:"task-notification"`, `turnOrigin:"task_notification"`, `promptSource:"system"`; se o agente principal estava no meio de um turno, chega como `queued_command` + `queue-operation remove(absorbed_mid_turn)`. Arquivos de subagente recebem como linha user meta atrás de um banner fixo "[SYSTEM NOTIFICATION ...]"; mensagens peer/coordinator usam modelos fixos com `origin.kind` peer|coordinator.

## 9. Tamanhos
| classe | arquivos | MB p50/p90/máx | linhas p50/p90/máx |
|---|---|---|---|
| principal | 42 | 1,1/4,2/13,8 | 399/1378/6446 |
| subagente | 271 | 1,0/3,7/38,1 | 256/973/1920 |
| agente de workflow | 129 | 0,4/0,7/1,5 | 83/218/729 |
Tamanho de linha (caracteres): p50 0,9k, p90 5k, p99 84k, p99,9 541k, máx 1,36M; 1,2% passam de 64 KB, 17 passam de 1 MB (tool_result grande ou imagem base64; `instructions` e `prompt_snapshot` chegam a 200 KB). Leitor de cauda: voltar até achar um `\n`, tolerando linhas de 1,4 MB; 64 KB comportam ~20 linhas, em geral incluindo `last-prompt`/`cost-state`.

## 10. Notas de versão
Primeira aparição (não necessariamente introdução): 2.1.287 `attributionAgent`, `thinkingDurationMs`, `bridge-session`; 289 `history-suppression`, `informational`, `nested_memory`, `command_permissions`, `task_status`, `attributionSkill`; 292 `isAbortedMidStream`; 293 `permissionDecision`, `system/local_command`, `plan_mode`, `hook_permission_decision`. `serverClassifier*` só aparece na 286. Ignore tipos desconhecidos de linha, subtype e attachment em vez de falhar.
