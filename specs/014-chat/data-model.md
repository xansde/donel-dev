# Modelo de dados — 014 Chat

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementa `plan.md`
(arquitetura), `research.md` (decisões R1–R24) e `contracts/` (fronteiras).

O chat tem **duas camadas de dados**, e a tela só conhece a segunda (D3 da spec):

1. **Entrada** — o que o app observa do CLI: o transcript JSONL, os hooks e a
   tela da PTY oculta. Formato do CLI, sujeito a mudar de versão.
2. **Modelo da conversa** — linhas (`ConversationRow`) + estado vivo
   (`LiveState`). Formato do Donel, estável. Trocar o transporte no futuro
   troca só o adaptador entre as duas.

Os tipos abaixo vivem em `src/shared/chat/` (puros, testáveis com vitest) e
cruzam o IPC como estão — por isso todos são serializáveis (sem funções, sem
`Map`, sem `Date`; instantes em ISO-8601).

---

## 1. Sessão de chat (`ChatSession`)

Uma por aba `claude` com o chat ligado. Vive no main (`src/main/chat/`) e
espelhada no renderer.

| Campo | Tipo | Regra |
|---|---|---|
| `ptyId` | `string` | Chave estável enquanto a aba vive (a PTY não muda numa troca de conversa). |
| `tabKind` | `'claude'` | Abas de login (`sessionType:'claude'` sem hooks) e abas de shell **não** têm `ChatSession` (FR-001). |
| `source` | `ConversationSource` | Conversa ativa; muda com `/clear`, `/resume`, `/branch` (FR-033). |
| `process` | `'starting' \| 'alive' \| 'ended'` | `ended` carrega `exitCode`; leva à barra "Sessão encerrada" (FR-034). |
| `reception` | `'ok' \| 'missing' \| 'stale'` | `missing`: o arquivo da conversa não apareceu; `stale`: há atividade na PTY sem o arquivo crescer (FR-030, aviso do FR-004). |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'plan' \| 'bypassPermissions' \| 'auto'` | Valor de partida = o passado explicitamente no spawn (FR-030); depois segue as linhas `permission-mode` do transcript e o campo `permission_mode` dos hooks. |
| `view` | `'chat' \| 'terminal'` | Por aba, em memória (abas não são restauradas no reinício do app). Padrão `chat` (D5). |
| `draft` | `ComposerDraft` | Por aba, em memória; sobrevive a troca de aba, de vista e ao fim da sessão (FR-013, FR-034). |
| `subagentPanel` | `string \| null` | `agentId` aberto no painel lateral (FR-027). |

**Invariantes**

- Existe no máximo uma `ChatSession` por `ptyId`.
- Hooks chegam identificados pelo **token da PTY** (`contracts/hook-bridge.md`
  §1), que sobrevive à troca de conversa; `source.sessionId` identifica a
  conversa ativa. Toda troca dela re-aponta o transcript e as features que
  dependem dele (semáforo, nome, contexto, cor) — FR-033, "nas duas vistas".

## 2. Fonte da conversa (`ConversationSource`)

| Campo | Tipo | Regra |
|---|---|---|
| `sessionId` | `string` (uuid) | Id da conversa ativa. |
| `transcriptPath` | `string` | Vem do payload do hook `SessionStart` (`transcript_path`) quando houver; senão é derivado de `cwd` + `sessionId`. |
| `cwd` | `string` | Pode mudar no meio do arquivo (`/cd`); o caminho do arquivo **não** é recalculado por isso — vale o do `SessionStart`. |
| `forward` | `{ offset: number; partial: string }` | Bytes já consumidos + resto de linha incompleta. Só cresce. |
| `backward` | `{ offset: number; done: boolean }` | Ponto até onde o histórico já foi carregado para trás (FR-010). |
| `leafUuid` | `string \| null` | Folha da cadeia ativa (última linha-nó `user`/`assistant`/`system` na ordem do arquivo). |
| `expectedParent` | `string \| null` | Próximo `uuid` aceito ao paginar para trás (ver contrato do adaptador §3). |

**Transições**

```text
startup ──SessionStart(source=startup|resume)──▶ ativa
ativa ──SessionStart(source=clear)──▶ nova fonte (sessionId novo, offsets zerados)
ativa ──SessionStart(source=resume|fork) com sessionId ≠ atual──▶ nova fonte
ativa ──SessionStart(source=compact)──▶ mesma fonte (compactação vira aviso)
ativa ──PTY exit──▶ congelada (lida, não seguida) até Retomar
```

Ao trocar de fonte, o renderer recebe `conversation-switched` e recomeça a
timeline com a linha de aviso de troca no topo (FR-033).

## 3. Entrada do transcript (`TranscriptEntry`)

Resultado de classificar **uma linha** do JSONL. Classificação completa,
ordem de precedência e campos lidos: `contracts/conversation-rows.md` §2.

```ts
type TranscriptEntry =
  | { k: 'node'; uuid; parentUuid; logicalParentUuid?; role: 'user' | 'assistant' | 'system' | 'attachment'; at; raw: LineRef }
  | { k: 'meta'; type: 'permission-mode' | 'last-prompt' | 'custom-title' | 'ai-title' | 'queue-operation' | 'cost-state' | string; payload }
  | { k: 'invalid'; reason: 'json' | 'too-large'; raw: LineRef };

interface LineRef { path: string; offset: number; length: number } // reler sob demanda
```

`LineRef` é o que permite **não guardar** conteúdo pesado (saídas longas,
imagens em base64, linhas de até 1,4 MB): a linha da conversa guarda só o
resumo e o endereço; o detalhe é relido do disco quando o dono expande.

## 4. Linha da conversa (`ConversationRow`)

Unidade que a tela exibe. Toda linha tem:

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `string` | Estável entre recargas: `uuid` da linha do transcript, `toolUseId` da ação, `group:<id da 1ª ação>`, `agent:<agentId>` ou `app:<evento>`. |
| `turnId` | `string \| null` | Rodada a que pertence (§5). |
| `at` | `string` | Só exibição — **nunca** ordenação (15% dos passos do transcript voltam no tempo). |
| `scope` | `'main' \| { agentId: string }` | Conversa principal ou de um subagente. |

Variantes (`kind`):

| `kind` | Campos próprios | Origem |
|---|---|---|
| `user` | `text`, `attachments: RowAttachment[]`, `command?: { name; args }`, `queued?: boolean` | Prompt humano; comando `/` digitado; prompt drenado da fila. |
| `assistant` | `markdown`, `blockIndex`, `messageId` | Bloco `text` de resposta. |
| `thinking` | `durationMs?`, `hasText: boolean` | Bloco `thinking` (texto vem vazio em ~98% — a linha mostra só "pensou"). |
| `action` | `toolUseId`, `tool`, `category`, `summary: ActionSummary`, `status`, `detail?: LineRef` | `tool_use` + seu `tool_result`. |
| `action-group` | `children: string[]`, `counts: Record<ActionCategory, number>`, `failed: string[]` | Ações consecutivas (≥ 2) sem texto entre elas (FR-006). |
| `skill` | `name`, `how: 'loaded-by-user' \| 'used-by-claude'` | Comando de skill do dono / ferramenta `Skill` do Claude (AS 3.6). |
| `subagent` | `agentId`, `toolUseId`, `description`, `agentType`, `model?`, `status: SubagentStatus`, `startedAt`, `durationMs?`, `lastAction?`, `background: boolean`, `depth` | Chamada `Agent` + `.meta.json` + notificação de término (§7). |
| `question` | `questions: Question[]`, `answers: Record<string, string>` | `AskUserQuestion` já respondida (a aberta é pendência, §8). |
| `plan` | `markdown`, `outcome: 'approved' \| 'adjust-requested' \| 'pending'` | `ExitPlanMode` (FR-023). |
| `shell` | `command`, `stdout?`, `stderr?` | Comando `!` rodado pelo dono. |
| `local-command` | `command`, `args?`, `output?` | `/color`, `/model x` e afins — discreto. |
| `notice` | `notice: NoticeKind`, `params` | Avisos (abaixo). |
| `unknown` | `typeLabel`, `raw: LineRef` | Tudo que o adaptador não reconhece e não está na lista de ruído (FR-012). |

`NoticeKind` = `'compact' | 'account-switch' | 'limit' | 'api-error' |
'interrupted' | 'conversation-switch' | 'informational' | 'generated-file'`.
`account-switch` e `conversation-switch` nascem de **eventos do app** (não há
marca no transcript para a troca de conta); os demais vêm do transcript.

`ActionCategory` = `'read' | 'edit' | 'write' | 'bash' | 'search' | 'web' |
'agent' | 'skill' | 'mcp' | 'task' | 'other'`.

`ActionSummary` = `{ verb: string; target?: string; stats?: string }`, já em
português ("Leu" / `src/x.ts`; "Editou" / `App.tsx` / `+12 −3`; "Buscou" /
`'z'` / `em 8 arquivos`). Regras por ferramenta: `contracts/conversation-rows.md` §4.

`status` da ação = `'running' | 'ok' | 'error' | 'denied' | 'interrupted'`
(`denied` quando o `tool_result` traz `toolDenialKind`).

**Invariantes**

- Ações com `status` `error` aparecem no cabeçalho recolhido do grupo
  (`failed`), sem expandir (AS 3.3).
- Corpo de skill (`isMeta`), lembretes do sistema e attachments de ruído
  **nunca** viram linha. Isso inclui `session_context` e `credential_org`
  (dados da conta) — FR-031.

## 5. Rodada (`Turn`)

| Campo | Tipo | Regra |
|---|---|---|
| `turnId` | `string` | `promptId` do prompt que a abriu; para rodadas sem prompt humano, `uuid` da linha de abertura. |
| `opener` | `'human' \| 'notification' \| 'resume'` | Notificação de subagente/tarefa também abre rodada (sem mensagem do dono). |
| `rows` | `string[]` | Ids das linhas, na ordem da cadeia ativa. |
| `complete` | `boolean` | Fechada por `system/turn_duration`, pelo início da próxima rodada ou pelo estado vivo `idle`. |
| `finalRowId` | `string \| null` | Último `assistant` com texto, se a rodada estiver completa. |

**Modo Foco** (FR-009) é uma transformação de vista, pura
(`foldForFocus(turns, rows) → FocusItem[]`): por rodada mostra a mensagem do
dono e `finalRowId`; o resto vira `{ kind: 'folded', actions: n, notes: m,
hasQuestion: boolean, rows: string[] }`. `hasQuestion` = alguma nota
recolhida termina em `?` (ignorando espaços e pontuação de markdown no fim).
Rodada em andamento: mostra a mensagem do dono + o bloco recolhido parcial; a
resposta final entra quando a rodada fecha.

## 6. Ação ao vivo (`LiveAction`)

`{ toolUseId, tool, summary, startedAt, scope }` — vem do hook `PreToolUse`
(o transcript só grava o `tool_use` depois do bloco). Some no `PostToolUse`
correspondente. Alimenta o pé "trabalhando — <ação>" (FR-008) e a "última
ação" do subagente.

## 7. Subagente (`Subagent`)

| Campo | Tipo | Fonte |
|---|---|---|
| `agentId` | `string` | `toolUseResult.agentId` = nome do arquivo `agent-<agentId>.jsonl` |
| `toolUseId` | `string` | `tool_use.id` da chamada `Agent` = `meta.toolUseId` |
| `agentType`, `description`, `model?`, `effort?` | | `.meta.json` |
| `background` | `boolean` | `meta.requestShape === 'background'` |
| `depth` | `number` | `meta.spawnDepth`; `parentAgentId` liga o aninhado ao pai |
| `status` | `'running' \| 'completed' \| 'failed' \| 'killed' \| 'stopped' \| 'unknown'` | `running` ao lançar; final pela notificação `<task-notification>` (`status`) |
| `startedAt`, `durationMs?`, `usage?` | | lançamento / notificação (`usage.duration_ms`, `tool_uses`, `subagent_tokens`) |
| `lastAction?` | `ActionSummary` | Cauda do arquivo do subagente ou hook `PreToolUse` com `agent_id` |
| `transcriptPath` | `string` | `<sessão>/subagents/agent-<agentId>.jsonl` |

**Transições**: `running → completed | failed | killed | stopped`; sessão
encerrada com subagente ainda `running` e sem notificação → `unknown`
(nunca "terminou" por suposição).

## 8. Pendência (`Pending`)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `string` | Gerado pelo app ao receber o hook `PermissionRequest`. |
| `kind` | `'question' \| 'permission' \| 'plan'` | `AskUserQuestion` / pedido de permissão / `ExitPlanMode` — os três chegam pelo mesmo hook. |
| `match` | `{ agentId?; toolName; toolInput }` | Tripla usada para achar o `tool_use_id` (pelo `PreToolUse` anterior) e para fechar a pendência pelo `PostToolUse`. |
| `toolUseId` | `string \| null` | Preenchido quando a tripla casa; liga a pendência à linha da conversa. |
| `scope` | `'main' \| { agentId; description }` | AS 2.8 — "pedido do subagente <descrição>". |
| `payload` | `QuestionPayload \| PermissionPayload \| PlanPayload` | Perguntas/opções/prévia/multi; ferramenta + entrada + diff + `permission_suggestions`; plano em markdown. |
| `arrivedAt` | `string` | Ordem da fila (FR-035). |
| `state` | ver abaixo | |

Enquanto a pendência está `open`, a TUI mostra o mesmo diálogo no terminal
oculto: o dono pode responder em qualquer das duas vistas, e **vale a
primeira resposta** (`contracts/hook-bridge.md` §3).

```text
open ──resposta do dono no chat──▶ answered
open ──respondida na TUI ou por outro hook (PostToolUse / tool_result do mesmo tool)──▶ resolved-elsewhere
open ──CLI fechou a conexão (timeout do hook)──▶ expired + faixa "o terminal precisa de você" (FR-025)
open ──PTY saiu / rodada interrompida──▶ cancelled
```

**Fila (FR-035)**: o painel mostra a pendência `open` mais antiga
(`arrivedAt`), com "mais N esperando" = demais `open`. Qualquer saída de
`open` da cabeça promove a próxima.

## 9. Envio (`Send`)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `string` | Local do renderer. |
| `text` | `string` | Exatamente o que o dono escreveu (com textos colados expandidos). |
| `images` | `ImageAttachment[]` | Ver §11. |
| `kind` | `'prompt' \| 'slash' \| 'shell'` | `/…` e `!…` têm confirmação própria (contrato de envio §5). |
| `mode` | `'normal' \| 'interrupt-first'` | "Interromper e mandar agora" (FR-019). |
| `state` | ver abaixo | |
| `attempts` | `number` | Enter reenviado conta como tentativa; colar de novo só no "tentar de novo". |
| `createdAt`, `confirmedAt?` | `string` | |

```text
waiting-cli ─(CLI pronto e caixa do terminal vazia)─▶ typing
typing ─(texto visto na caixa)─▶ confirming
confirming ─(sinal de aceite)─▶ accepted          rótulo: "entrou"
confirming ─(CLI ocupado: entrou na fila do CLI)─▶ queued   rótulo: "na fila"
queued ─(entregue: queue-operation / linha user / queued_command)─▶ accepted
confirming | waiting-cli ─(tempo esgotado)─▶ failed     rótulo: "não foi" + "tentar de novo"
failed ─(tentar de novo, sem aceite tardio)─▶ waiting-cli
```

Rótulos na tela: `waiting-cli` e `queued` = "na fila"; `typing` e
`confirming` = "enviando…". Nunca há um estado sem saída (SC-003): todo
estado transitório tem prazo. Sinais de aceite, prazos e a regra contra
duplicidade: `contracts/send-protocol.md`.

## 10. Estado vivo (`LiveState`)

| Campo | Tipo |
|---|---|
| `status` | `'starting' \| 'idle' \| 'working' \| 'waiting-you' \| 'terminal-needed' \| 'ended' \| 'not-receiving'` |
| `currentAction` | `LiveAction \| null` |
| `pendings` | `Pending[]` (as `open`, na ordem de chegada) |
| `sends` | `Send[]` não finalizados |
| `activeSubagents` | `string[]` (agentIds `running`) |
| `terminalNeeded` | `{ reason: 'hook-timeout' \| 'interactive-screen' \| 'permission-dialog' \| 'unrecognized' } \| null` |

Precedência de `status` para a aba (semáforo/notificação):
`ended` > `terminal-needed` > `waiting-you` > `working` > `idle` > `starting`.

## 11. Anexos e rascunho

- `ImageAttachment` = `{ id, mediaType, path, width?, height? }` — a imagem
  colada/arrastada é gravada em `userData/chat-attachments/<sessionId>/`
  (limpeza: ao fechar a aba e, no boot, o que tiver mais de 7 dias).
- `PastedText` = `{ id, text, lines }` — colagem acima do limite (FR-016) vira
  ficha "texto colado — N linhas"; no envio, o texto volta inteiro ao lugar
  da ficha.
- `ComposerDraft` = `{ text, images, pastes, historyCursor }`.
- `RowAttachment` (mensagem já na conversa) = `{ kind: 'image'; ref: LineRef;
  blockIndex } | { kind: 'mention'; path }`.

## 12. Preferências persistidas (`config.json`)

| Chave | Tipo | Padrão | Nota |
|---|---|---|---|
| `chat.enabled` | `boolean` | `false` até a Fase 7; depois `true` | Interruptor da entrega incremental (R22). |
| `chat.focusMode` | `boolean` | `true` | Global, lembrado (FR-009). |

Chaves novas entram por campo + sanitize + DTO + handler (padrão do
`config-store.ts`). Canal antigo que não conheça `chat.*` preserva a chave
(`unknownFields`).

## 13. Regras de validação (FR → invariante)

| FR | Invariante verificável |
|---|---|
| FR-010 | Nenhuma leitura do transcript lê o arquivo inteiro; o pager lê blocos a partir do fim. |
| FR-012 | Linha não reconhecida e fora da lista de ruído ⇒ `unknown`, nunca exceção. |
| FR-017 | Um `Send` só sai de `confirming` por sinal de aceite ou prazo; reenvio de texto só a partir de `failed`. |
| FR-021/22 | Pendência só existe se um hook de decisão chegou; o app nunca inventa pergunta. |
| FR-025 | Toda pendência `expired` gera `terminalNeeded`. |
| FR-031 | Nenhum tipo deste modelo carrega credencial; attachments de conta são descartados no adaptador. |
| FR-033 | `conversation-switched` zera a timeline e re-correlaciona hooks e watcher. |
| FR-035 | O painel exibe exatamente uma pendência `open`, a de menor `arrivedAt`. |
