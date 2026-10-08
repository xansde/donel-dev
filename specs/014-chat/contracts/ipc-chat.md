# Contrato — IPC do chat (main ⇄ renderer)

Canais novos do domínio `chat:`, no padrão do repo: constantes em
`src/shared/chat/ipc.ts` (`CHAT_CHANNELS`), tipos de payload em
`src/shared/chat/`, `window.donel.chat.*` no preload e handlers registrados
por `registerChatIpcHandlers` no `index.ts`.

O preload tem trava de **um assinante por canal**
(`src/preload/subscribeChannel.ts:35`). Por isso o renderer tem uma única
`ChatStore` que assina cada evento uma vez e distribui por `ptyId`.

Todos os payloads são serializáveis. Linha da conversa, pendência e estado
vivo seguem `data-model.md`.

## 1. Pedidos (renderer → main, `invoke`)

| Canal | Entrada | Saída | Nota |
|---|---|---|---|
| `chat:attach` | `{ ptyId }` | `ChatSnapshot` = `{ source, rows, cursor, live, permissionMode }` | Primeira página a partir do fim (FR-010). Idempotente. |
| `chat:detach` | `{ ptyId }` | `void` | Aba fechada; para os seguidores. |
| `chat:load-older` | `{ ptyId, scope, cursor }` | `{ rows, cursor \| null }` | `null` = início da conversa. |
| `chat:row-detail` | `{ ptyId, scope, rowId, part: 'diff' \| 'output' \| 'output-full' \| 'files' \| 'raw' \| 'content' }` | `RowDetail` | Relê o `LineRef` no disco; saída longa vem truncada, salvo `output-full`. |
| `chat:answer` | `{ ptyId, pendingId, answer: PendingAnswer }` | `{ ok: true } \| { ok: false, reason: 'not-open' \| 'unknown' }` | `not-open`: alguém respondeu antes (TUI ou outro hook). |
| `chat:subagent-open` | `{ ptyId, agentId }` | `ChatSnapshot` do subagente | Passa a seguir `agent-<id>.jsonl` (AS 5.2). |
| `chat:subagent-close` | `{ ptyId, agentId }` | `void` | |
| `chat:catalog` | `{ ptyId }` | `CommandEntry[]` = `{ name, aliases, description, source: 'builtin' \| 'skill' \| 'command' \| 'plugin', opensScreen }` | Menu `/` (R3), com cache por `cwd`. |
| `chat:files` | `{ ptyId, query, limit }` | `string[]` | Menu `@`: arquivos do projeto, relativos ao `cwd`; `git ls-files` (+ não rastreados não ignorados) ou varredura limitada. |
| `chat:save-image` | `{ ptyId, bytes: ArrayBuffer, mediaType }` | `{ id, path }` | Grava em `userData/chat-attachments/<sessionId>/` (R4). |
| `chat:ack-lookup` | `{ ptyId, text, since }` | `{ matched: boolean, via? }` | Aceite tardio antes do "tentar de novo" (contrato de envio §7). |
| `chat:open-external` | `{ url }` | `void` | Só `http:`/`https:` (R21). |
| `chat:open-generated` | `{ ptyId, path }` | `void` | Só extensões de documento ou imagem, e dentro do `cwd` ou da pasta de anexos. |
| `chat:focus-state` | `{ activePtyId \| null }` | `void` | Aba ativa, para a regra de notificação (R23). O main lê o foco da janela por conta própria. |
| `chat:screen-state` | `{ ptyId, terminalNeeded: 'hook-timeout' \| 'interactive-screen' \| 'permission-dialog' \| 'unrecognized' \| null }` | `void` | Fontes de tela que pedem o terminal (R16 item 3-4: diálogo >2 s, "Transcript saving is off", comando `opensScreen`); `null` = a caixa voltou. O main combina com a fonte dos hooks (`Notification` sem pendência) num só `LiveState.terminalNeeded`. |
| `config:setChatPrefs` | `{ enabled?, focusMode? }` | `AppConfigDto` | Padrão de `config:set*`. |

`PendingAnswer`:

```ts
type PendingAnswer =
  | { kind: 'allow' }
  | { kind: 'allow-always' }
  | { kind: 'deny'; reason?: string }
  | { kind: 'answers'; answers: Record<string, string> }   // AskUserQuestion
  | { kind: 'plan-approve' }
  | { kind: 'plan-adjust'; text: string }
  | { kind: 'interrupt' };                                   // Parar com pendência aberta
```

O main traduz cada `PendingAnswer` na resposta do hook
(`contracts/hook-bridge.md` §3). O renderer nunca monta JSON de hook.

## 2. Eventos (main → renderer)

| Canal | Payload | Quando |
|---|---|---|
| `chat:rows` | `{ ptyId, scope, patches: RowPatch[] }` | Linhas novas, alteradas (ação terminou, grupo cresceu, subagente mudou de estado) ou recalculadas (rewind). |
| `chat:live` | `{ ptyId, live: LiveState }` | Mudança de estado vivo, ação atual, pendências ou subagentes ativos. |
| `chat:conversation-switched` | `{ ptyId, sessionId, reason: 'clear' \| 'resume' \| 'fork' }` | A conversa da aba mudou (FR-033): o renderer zera a timeline e chama `chat:attach`. |
| `chat:prompt-signal` | `{ ptyId, signal: 'submit' \| 'enqueue' \| 'deliver' \| 'command' \| 'shell' \| 'local' \| 'unknown-command' \| 'session-switch' \| 'compact', text?, at, origin?: 'hook' | 'transcript' }` | Sinais de aceite do envio (contrato de envio §5). |
| `chat:reception` | `{ ptyId, reception: 'ok' \| 'missing' \| 'stale' }` | Aviso de "não estou recebendo a conversa" (FR-030). |

`RowPatch` = `{ op: 'append' | 'replace' | 'prepend' | 'reset', rows }`.

## 3. Interface interna do renderer (não é IPC)

O driver de envio usa o `TerminalPane` da aba por um handle imperativo
ampliado:

| Membro | Uso |
|---|---|
| `write(data: string)` | Bytes crus para a PTY: colagem, Enter, Esc. |
| `readScreen(): ScreenSnapshot` | `{ lines: { text, dim: boolean[] }[], bracketedPaste, altScreen, cols, rows }`, lido do buffer do xterm (não do DOM). |
| `onScreenUpdate(cb)` | Reavaliar o gate a cada escrita na tela. |
| `respawn({ resume?: sessionId })` | "Retomar" do FR-034 = `-r <id>` + os mesmos flags. |
| `ptyId` | Para chamar o main. |

- **Montagem**: o `TerminalPane` continua montado (oculto por CSS) em toda
  aba `claude`. Desmontar mata a PTY.
- **Tamanho no spawn oculto**: quando a aba nasce na vista de chat, a PTY é
  criada com o tamanho da área da aba, calculado pelas métricas de célula,
  e não 80×24. O `fit()` não roda em elemento oculto.

## 4. Regras

- Nada sobre credencial trafega por estes canais (FR-031).
- `chat:files`, `chat:open-generated` e o protocolo `donel-asset:` validam
  caminhos no main; o renderer nunca passa caminho que o main não tenha
  emitido ou que esteja fora das raízes permitidas.
- Com `chat.enabled = false`, nenhum handler `chat:*` é registrado e a UI
  não monta a vista. A ponte de hooks continua existindo, porque é ela que
  serve o semáforo depois da Fase 1 do plano (`plan.md`). As pendências
  ficam com a TUI, sem segurar resposta.
