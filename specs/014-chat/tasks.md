# Tasks: Chat no lugar da visão do terminal (014)

**Input**: `specs/014-chat/` — `spec.md`, `plan.md`, `research.md` (R1–R24),
`data-model.md`, `contracts/` (`conversation-rows.md`, `hook-bridge.md`,
`send-protocol.md`, `ipc-chat.md`), `quickstart.md`, `spike/` (evidência
das verificações).

**Testes**: **obrigatórios** nos módulos puros e na ponte de hooks — regra
"TDD com escopo" do `CLAUDE.md`. Cada tarefa de teste vem **antes** da
implementação e precisa **falhar** primeiro. PTY e UI são validadas por smoke
roteirizado com o CLI falso e pela bateria real do `quickstart.md`.

**Organização**:

- As fases seguem a **ordem de entrega aprovada no `plan.md`** (Fases 0–7),
  e cada tarefa traz a história que atende.
- As Fases 2–6 do plano entregam as histórias assim: US1 (leitura) + US3 →
  US1 (envio) + US6 → US2 → US4 → US5.
- Cada fase entra por PR em `staging`, atrás de `chat.enabled` desligado, e
  termina com a revisão do dono.

## Formato: `[ID] [P?] [Story] Descrição`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de
  tarefa incompleta).
- **[USn]**: história da spec atendida. Setup, Fundação e Polimento não levam
  rótulo.
- Paths relativos a `C:/Users/xansd/seazone/donel-dev`.

---

## Phase 1: Setup — Fase 0 do plano: protótipo de forma (gate)

**Propósito**: o dono vê e aprova as telas antes de qualquer código de UI.
Roda **em paralelo** com a Phase 2 (aprovado em 07/10).

- [x] T001 **(dono)** Colar o conteúdo de `design/prompt-design-chat.md` (abaixo da linha divisória) em claude.ai/design, anexando `design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html`, e gerar as 10 telas pedidas. *(07/10: a conta antiga do Claude Design não existe mais, então as 11 telas foram geradas desta sessão, a partir do mesmo brief, num canvas de design temporário da conta atual.)*
- [x] T002 Salvar o resultado do Claude Design em `design/chat-handoff/`, no mesmo formato de `design/modo-dev-v3-handoff/`:
  - `project/*.dc.html`;
  - `prints/`;
  - `README.md` com a data, o prompt usado e a lista de telas.
- [x] T003 Conferir o handoff contra `specs/014-chat/spec.md` e escrever `design/chat-verificacao.md` (modelo: `design/modo-dev-v3-verificacao.md`), contendo:
  - divergências nomeadas D-C1..D-Cn, cada uma classificada como "forma" (vence o design) ou "comportamento" (vence a spec);
  - extensões propostas pelo design, aceitas ou recusadas, com o nome final de cada componente;
  - mapa tela → componentes do design-system;
  - paleta de código, se o design propôs uma;
  - a ordem de implementação que o desenho desbloqueia.
- [x] T004 **(dono)** Aprovar `design/chat-verificacao.md`; registrar a aprovação, com data, numa seção "Aprovação" do mesmo arquivo. **Gate**: sem isto, nenhuma tarefa das Phases 3–7.

---

## Phase 2: Foundational — Fase 1 do plano: fundação sem tela

**Propósito**: ponte de hooks, troca de conversa, ambiente, leitura do
transcript, adaptador e detectores de tela. Para o dono, nada muda na tela,
exceto que semáforo, nome e cor passam a sobreviver ao `/clear`.

**⚠️ Bloqueia** todas as histórias.

### Tipos, configuração e diagnóstico

- [x] T005 [P] Criar os tipos do modelo em `src/shared/chat/rows.ts`, conforme `data-model.md` §1–§12: `ChatSession`, `ConversationSource`, `TranscriptEntry`, `LineRef`, `ConversationRow` (todas as variantes de `kind`), `ActionCategory`, `ActionSummary`, `NoticeKind`, `Turn`, `FocusItem`, `LiveAction`, `Subagent`, `Pending`, `Send`, `LiveState`, `ImageAttachment`, `PastedText`, `ComposerDraft`, `RowAttachment`. Tudo serializável: sem `Map`, `Date` nem funções.
- [x] T006 [P] Criar `src/shared/chat/ipc.ts`, conforme `contracts/ipc-chat.md` §1–§2: `CHAT_CHANNELS`, os tipos de entrada e saída de cada canal, `PendingAnswer`, `RowPatch`, `ChatSnapshot`, `RowDetail`, `CommandEntry`.
- [x] T007 [P] Escrever `tests/chat-config.test.ts` (falhando), com os casos:
  - `chat.enabled` com padrão `false` e `chat.focusMode` com padrão `true`;
  - sanitize de valores inválidos;
  - a chave `chat` preservada por canal antigo (`unknownFields`).
- [x] T008 Implementar `chat.enabled`/`chat.focusMode` em `src/main/config-store.ts`, `src/shared/config.ts`, `src/main/index.ts` e `src/preload/index.ts`:
  - `src/main/config-store.ts` (campo, sanitize, padrão);
  - `src/shared/config.ts` (`AppConfigDto`);
  - handler `config:setChatPrefs` em `src/main/index.ts` e exposição em `src/preload/index.ts`.

  Faz passar T007.
- [x] T009 [P] Escrever `tests/chat-diagnostics-log.test.ts` (falhando) e implementar `src/main/chat/diagnostics-log.ts`:
  - **Formato**: JSONL em `userData/chat-diagnostics.log`.
  - **Eventos**: `unknown-entry` (uma vez por sessão e tipo), `hook` (evento, `ptyId`, duração) e `send-failed` (motivo).
  - **Nunca** conteúdo de conversa nem payload de hook.

### Ponte de hooks HTTP (`contracts/hook-bridge.md`)

- [x] T010 [P] Reescrever `tests/hooks-settings.test.ts` (falhando) para o arquivo **por sessão**, conforme `hook-bridge.md` §1–§2:
  - eventos e timeouts da tabela;
  - entradas `type:"http"` com url `http://127.0.0.1:<porta>/h/<Evento>` e header `X-Donel-Token`, sem `matcher`;
  - `PermissionRequest` (timeout 86400) só com `chatEnabled`;
  - `SessionStart` como `command` `curl.exe -s --data-binary @- -H "X-Donel-Token: <token>" …`, com fallback para o encaminhador PowerShell que lê e envia **bytes**;
  - caminho `userData/hook-settings/<ptyId>.json`;
  - limpeza de arquivos com mais de 1 dia.
- [x] T011 Implementar em `src/main/hooks-settings.ts`:
  - `buildSessionHooksSettings({ port, token, chatEnabled, curlPath })` (puro);
  - `writeSessionHooksSettings`, `removeSessionHooksSettings` e `cleanupStaleHookSettings` (I/O);
  - `buildByteSafeForwarderScript` para o fallback.

  Faz passar T010.
- [x] T012 [P] Escrever o teste de contrato `tests/hook-bridge.contract.test.ts` (falhando), com servidor real e cliente HTTP que imita o CLI:
  - `401` sem token ou com token desconhecido; `400` com JSON inválido; `413` acima de 32 MB;
  - eventos não bloqueantes respondidos `{}` em ≤ 10 ms;
  - `PermissionRequest` segurado até `respond(decision)`;
  - conexão fechada pelo cliente → evento `expired`;
  - `PreToolUse` guardado por 10 s, o que permite casar `tool_use_id` pela tripla (`agent_id`, `tool_name`, `tool_input`);
  - `PostToolUse` com a mesma tripla de uma decisão segurada → responde `{}` e emite `resolved-elsewhere`;
  - `SessionStart` (`source` clear/resume/fork) emite `conversation-switched` com o `session_id` e o `transcript_path` novos;
  - `SessionEnd` com `reason` clear/resume **não** emite fim.
- [x] T013 Implementar `src/main/hook-bridge.ts`:
  - `createHookBridge()` com porta efêmera em 127.0.0.1;
  - `registerSession(ptyId) → token` e `unregisterSession(ptyId)`;
  - rotas `/h/<Evento>`, limite de corpo, parse tolerante;
  - emissor tipado de eventos por `ptyId`;
  - `PendingDecisionHandle` (`respond`, `release`), registro de `PreToolUse` por 10 s e medições para o T009.

  Faz passar T012.
- [x] T014 Migrar o semáforo para a ponte, em `src/main/session-semaphore-manager.ts` e `src/main/semaphore-state-machine.ts`:
  - eventos por `ptyId` (sai o mapa por `session_id`);
  - `SessionEnd` com `reason` clear/resume deixa de levar a `done`;
  - caminho antigo (encaminhador PowerShell + `/hook`) selecionável por uma versão via `DONEL_HOOKS_TRANSPORT=legacy`.

  Atualizar `tests/session-semaphore-manager.test.ts` e `tests/semaphore-state-machine.test.ts`, com casos novos para `/clear` e `/resume`.
- [x] T015 Ligar a ponte no spawn, em `src/main/index.ts` (handler em ~988–1155):
  - gerar token e arquivo `--settings` por sessão no lugar do arquivo único;
  - registrar o token antes do spawn e, no `onExit`, apagar o arquivo e desregistrar;
  - no boot, detectar `curl.exe` (`where.exe curl`) e rodar `cleanupStaleHookSettings`;
  - aba de login continua sem hooks.
- [x] T016 Re-apontar a conversa da aba (FR-033, nas duas vistas) em `src/main/transcript-watcher.ts`, `src/main/index.ts` e `src/renderer/src/App.tsx`:
  - **Main**: `src/main/transcript-watcher.ts` ganha `repoint(ptyId, { sessionId, transcriptPath })`, que espera o arquivo nascer. `src/main/index.ts` reage ao `conversation-switched` da ponte re-apontando o watcher e emitindo `session:switched` ao renderer.
  - **Renderer**: `src/renderer/src/App.tsx` atualiza `claudeSessionId` da aba (nome, cor e aparência passam a usar o id novo).
  - **Testes**: caso novo em `tests/transcriptWatcher.test.ts` (re-apontar para arquivo que ainda não existe).

### Ambiente e modo de permissão (FR-030, R17)

- [x] T017 [P] Escrever casos (falhando) em `tests/pty-manager.test.ts` e `tests/commandBuilder.test.ts`.
  - **`buildPtyEnv`**:
    - acrescenta `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`;
    - remove as variáveis de ponte/mensageria herdadas de uma sessão-mãe;
    - acrescenta `127.0.0.1,localhost` ao `NO_PROXY`;
    - mantém o overlay de provedor por cima;
    - não varre `CLAUDE_*`.
  - **Spawn de sessão `claude`**: sem `--permission-mode` no argv, ganha o resolvido.

  Antes de escrever, confirmar os nomes exatos das variáveis de ponte/mensageria buscando `BRIDGE_SESSION_ID` e `MESSAGING` no binário (`grep -a -o -E` em `~/.local/bin/claude.exe`, com `timeout 120`).
- [x] T018 Implementar o modo de permissão e o ambiente em `src/main/cli-user-settings.ts`, `src/shared/commandBuilder.ts`, `src/main/index.ts` e `src/main/pty-manager.ts`:
  - `src/main/cli-user-settings.ts`: lê **só** `permissions.defaultMode` de `~/.claude/settings.json`, sem credencial e tolerando arquivo ausente;
  - `resolvePermissionMode(argv, userDefault)` em `src/shared/commandBuilder.ts`: launcher > padrão do usuário > `default`;
  - aplicação no handler de spawn de `src/main/index.ts`, que cobre barra lateral, retomar/fork, favoritos, mapa e Esteira;
  - ambiente em `src/main/pty-manager.ts`.

  Faz passar T017.

### Leitura do transcript e adaptador (`contracts/conversation-rows.md`)

- [x] T019 [P] Criar as fixtures sintéticas em `tests/fixtures/chat/`, geradas por `tests/fixtures/chat/build-fixtures.mjs` (determinístico, conteúdo genérico com `atlas`/`beacon`/`vega`), com um `README.md` dos cenários. Base de estrutura: `specs/014-chat/spike/transcript-schema.md`. Cenários:
  - **Básicos**: rodada simples (text, thinking, tool_use, tool_result); todos os `toolUseResult` da tabela do catálogo; comando `/` + corpo de skill `isMeta`; modo `!`; interrupção; prompt com imagem.
  - **Fila e compactação**: `queued_command` + `queue-operation`; `compact_boundary` com `logicalParentUuid`.
  - **Árvore**: galho de rewind; resultados paralelos.
  - **Erros e ruído**: erro sintético de API e de limite; attachments de ruído, incluindo `session_context` e `credential_org`; tipo desconhecido; linhas de metadados.
  - **Subagentes**: arquivo de subagente + `.meta.json` + `<task-notification>`.
  - **Bordas**: linha de mais de 1 MB; última linha incompleta.
- [x] T020 [P] Escrever `tests/chat-transcript-entry.test.ts` (falhando), cobrindo `conversation-rows.md` §2:
  - ordem de precedência;
  - metadados;
  - ruído descartado **antes** de `unknown`;
  - `isSidechain` descartado;
  - inválido e grande demais.
- [x] T021 Implementar `src/shared/chat/transcriptEntry.ts` (`classifyLine(raw, lineRef)`). Faz passar T020.
- [x] T022 [P] Escrever `tests/chat-active-chain.test.ts` (falhando), cobrindo `conversation-rows.md` §3:
  - escolha da folha;
  - subida por `parentUuid`;
  - salto de compactação;
  - completar por `message.id`;
  - `tool_result` preso por `tool_use_id`;
  - paginação para trás com `expectedParent` e resultados pendurados;
  - rewind detectado no seguimento adiante.
- [x] T023 Implementar `src/shared/chat/activeChain.ts`. Faz passar T022.
- [x] T024 [P] Escrever `tests/chat-tool-summary.test.ts` (falhando), cobrindo `conversation-rows.md` §4:
  - verbos, alvos e estatísticas em português por ferramenta;
  - caminho relativo ao `cwd`;
  - rótulo de Bash/PowerShell sem invólucros;
  - MCP;
  - ferramenta desconhecida.
- [x] T025 Implementar `src/shared/chat/toolSummary.ts` e adaptar `pingdotgg/t3code@9f48092 packages/client-runtime/src/work-log/commandLabel.ts` em `src/shared/chat/t3/commandLabel.ts`, com o cabeçalho MIT de `research.md` R20. Faz passar T024.
- [x] T026 [P] Escrever `tests/chat-grouping.test.ts` (falhando), cobrindo `conversation-rows.md` §5:
  - grupo só com 2 ou mais ações;
  - `thinking` absorvido;
  - o que quebra um grupo;
  - rótulo "N ações — leu a, editou b, rodou c";
  - lista de falhas no cabeçalho;
  - id estável `group:<toolUseId>`.
- [x] T027 Implementar `src/shared/chat/grouping.ts`. Faz passar T026.
- [ ] T028 [P] Escrever `tests/chat-adapter.test.ts` (falhando), rodando sobre as fixtures do T019:
  - linhas produzidas (`kind`, `id`, `turnId`, `status`);
  - leitura incremental igual à leitura de uma vez;
  - patches `append`/`replace`/`prepend`/`reset`;
  - avisos de `conversation-rows.md` §7;
  - subagente ligado por `.meta.json`;
  - skill, `question`, `plan`, `shell`, `local-command`;
  - `unknown` com o gancho de diagnóstico;
  - **privacidade**: nenhum dado de `session_context`/`credential_org` em linha nenhuma.
- [ ] T029 Implementar `src/shared/chat/adapter.ts` (`adapt(state, entries) → { state, patches }`), usando T021, T023, T025 e T027. Faz passar T028.
- [x] T030 [P] Escrever `tests/chat-focus-fold.test.ts` (falhando), cobrindo `data-model.md` §5:
  - dobra por rodada e `finalRowId`;
  - `hasQuestion` (nota recolhida terminando em `?`);
  - rodada em andamento;
  - rodada aberta por notificação.
- [x] T031 Implementar `src/shared/chat/focusFold.ts`. Faz passar T030.
- [x] T032 [P] Escrever `tests/chat-transcript-io.test.ts` (falhando), com arquivos temporários.
  - **Seguidor**: offset; resto de linha; debounce de 50 ms; arquivo que nasce depois; re-apontar.
  - **Paginador**: blocos de 256 KB; linhas de até 8 MB atravessando blocos; página de 30 rodadas ou 2 MB.
  - **Leitura nunca inteira**: afirmar bytes lidos menores que o tamanho do arquivo.
- [x] T033 Implementar `src/main/chat/transcript-follower.ts` e `src/main/chat/transcript-pager.ts`. Faz passar T032.

### Tela do terminal do Claude (R6, R16)

- [x] T034 [P] Criar as fixtures de tela em `tests/fixtures/chat/screens/` (JSON: `lines[]` com `text` e máscara `dim`, nos layouts fullscreen e inline), derivadas de `specs/014-chat/spike/b2/logs/*.txt`. Estados:
  - **Ciclo de vida**: fases do boot; ocioso vazio; ocioso com texto; trabalhando; com fila; interrompido.
  - **Caixa de entrada**: placeholder e sugestão fantasma (*dim*); prompt `!`; caixa de 15 linhas.
  - **Menus e marcadores**: menu `/` aberto; menu `@` aberto; `[Pasted text #N +M lines]`; `[Image #N]`.
  - **Diálogos**: confiança 2.1.293; "external imports"; cada tela com título da lista R16; diálogos de pergunta, plano e permissão.
  - **Mensagens**: "Unknown command"; "Transcript saving is off"; "Press Ctrl-C again to exit"; "Esc again to clear".
- [x] T035 [P] Atualizar `tests/cliInputBox.test.ts` e `tests/trustDialog.test.ts` (falhando):
  - leitura da caixa considerando *dim* (placeholder e fantasma não são texto);
  - prompt `!`;
  - até 15 linhas;
  - diálogo de confiança pelos textos da 2.1.293 ("Quick safety check", "Yes, I trust this folder", "Enter to confirm · Esc to cancel").
- [x] T036 Corrigir `src/shared/cliInputBox.ts` e `src/shared/trustDialog.ts` (a assinatura passa a aceitar linhas com máscara *dim*). Fazem passar T035, sem regressão em `tests/esteiraSession.test.ts` e `tests/preTypeReadiness.test.ts`.
- [x] T037 [P] Escrever `tests/chat-screen.test.ts` (falhando) sobre as fixtures do T034, para os detectores de `src/shared/chat/screen.ts`:
  - `isReadyForInput` (gate do `send-protocol.md` §1) e `readInputText` (*dim*-aware);
  - `isWorking`, `hasQueuedMessages`, `slashMenuOpen`, `atMenuOpen`;
  - `blockingScreen() → { kind, title } | null`, `modelDialog()`, `transcriptSavingOff`;
  - `pastedPlaceholder()`, `imagePlaceholderCount()`.
- [x] T038 Implementar `src/shared/chat/screen.ts`. Faz passar T037.
- [x] T039 Ampliar o handle de `src/renderer/src/TerminalPane.tsx`, conforme `contracts/ipc-chat.md` §3:
  - `write(data)`;
  - `readScreen()`, lendo do buffer do xterm (não do DOM): linhas com máscara *dim* via `IBufferCell.isDim()`, `bracketedPaste`, `altScreen`, `cols`, `rows`;
  - `onScreenUpdate(cb)`;
  - `respawn({ resume?: sessionId })` (`-r <id>` + os mesmos flags de modelo e modo);
  - `ptyId`.

  Spawn com a aba oculta usa o tamanho da área calculado pelas métricas de célula, e não 80×24.

### CLI falso e smoke da fundação

- [ ] T040 Criar o CLI falso roteirizado em `tests/smoke/fixtures/fake-claude-chat/` (`claude.cmd` → `node fake-claude-chat.mjs %*`, padrão do `fake-claude-login`):
  - **Argumentos**: lê `--session-id`, `--settings` (URLs, token e comando do `SessionStart`) e `-r`.
  - **Tela**: desenha a caixa entre réguas e o rodapé ("? for shortcuts" / "esc to interrupt"); liga o bracketed paste; ecoa colagens, inclusive os placeholders.
  - **No Enter**: faz `POST` de `UserPromptSubmit` e acrescenta a linha `user` a um transcript numa pasta temporária, anunciada pelo `transcript_path` do `SessionStart`.
  - **Roteiro**: `DONEL_FAKE_CLAUDE_SCENARIO` (JSON) descreve linhas de assistente e de ferramenta e chamadas de hook.
  - **Comandos**: atende `/clear` (`SessionEnd` + `SessionStart` com id novo) e `/exit`.
- [ ] T041 Escrever a smoke `tests/smoke/chat-foundation.spec.ts`, com `DONEL_CLAUDE_EXECUTABLE_FIXTURE` apontando para o T040:
  - o semáforo muda pela ponte HTTP (trabalhando → aguardando);
  - depois de `/clear` na vista do terminal, semáforo, nome e cor seguem a conversa nova.

  Depois rodar a suíte inteira (`npm run build; npm run test:smoke`) sem regressão.
- [ ] T042 Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - `npm test`, `npm run typecheck` e smokes verdes;
  - abrir o PR da Phase 2 contra `staging` (o merge é do dono);
  - roteiro de validação no alfa em `specs/014-chat/e2e.md` (seção "Fase 1"): semáforo durante uma sessão real e `/clear` mantendo nome e cor.

**Checkpoint**: fundação pronta. Com o gate T004 aprovado, as histórias podem
começar.

---

## Phase 3: US1 (leitura) + US3 — Fase 2 do plano: chat de leitura (fatia vertical) 🎯

**Goal**: o dono lê sessões reais no chat (markdown, código, ações, Modo
Foco, histórico, alternância, fim de sessão). Escrever ainda é pelo terminal.

**Independent Test**: `quickstart.md` B1 (passos 1, 2, 4 e 5), B5, B7, B8, B10
e B11; smokes `chat-reading`, `chat-long-session` (SC-005) e
`chat-live-latency` (SC-008).

**Forma**: toda tarefa de UI desta fase segue `design/chat-handoff/` e as
divergências de `design/chat-verificacao.md`.

- [ ] T043 [US1] Pedir OK do dono para instalar `react-markdown@10`, `remark-gfm@4` e `shiki@4` (regra do baseline) e, com o OK, instalar como `dependencies` em `package.json`; rodar `npm run typecheck` e `npm run build`.
- [ ] T044 [P] [US1] Escrever `tests/chat-link-policy.test.ts` (falhando) e implementar `src/shared/chat/linkPolicy.ts`:
  - `isExternalUrlAllowed`: só `http:`/`https:`;
  - `isGeneratedFileOpenable`: só extensões de documento ou imagem (`html`, `md`, `pdf`, `png`, `jpg`, `svg`, `csv`, `txt`), dentro do `cwd` ou da pasta de anexos;
  - `isAssetPathAllowed`.
- [ ] T045 [US1] Segurança da janela (R21) em `src/main/index.ts`, `src/renderer/index.html` e `src/main/chat/chat-ipc.ts`:
  - em `src/main/index.ts`, `will-navigate` com `preventDefault` e `setWindowOpenHandler` negando tudo;
  - CSP de `src/renderer/index.html` (`script-src 'self' 'wasm-unsafe-eval'`, `img-src 'self' data: blob: donel-asset:`);
  - handlers `chat:open-external` e `chat:open-generated` em `src/main/chat/chat-ipc.ts`, usando o T044.
- [ ] T046 [P] [US1] Protocolo `donel-asset:` em `src/main/chat/assets-protocol.ts` (`protocol.handle`):
  - serve bloco de imagem por `LineRef` + `blockIndex` e anexo por id;
  - valida caminho pelo T044;
  - teste da resolução pura em `tests/chat-assets-protocol.test.ts`.
- [ ] T047 [US1] Escrever `tests/chat-hub.test.ts` (falhando), com eventos de ponte falsos e transcripts temporários:
  - `attach` devolve a primeira página a partir do fim, e `load-older` pagina;
  - `row-detail` relê o `LineRef`;
  - troca de conversa reinicia e põe o aviso no topo;
  - `accounts:changed` gera o aviso `account-switch`;
  - `reception` vira `missing` (arquivo não nasce) e `stale` (atividade sem crescimento);
  - nenhum handler registrado com `chat.enabled = false`.
- [ ] T048 [US1] Implementar `src/main/chat/chat-hub.ts` e `src/main/chat/chat-ipc.ts` (`registerChatIpcHandlers`): por `ptyId`, fonte + seguidor + paginador + adaptador e `LiveState` básico (`starting`/`idle`/`working`/`ended`). Emite:
  - `chat:rows`, `chat:live`;
  - `chat:conversation-switched`, `chat:reception`.

  Responde `chat:attach`, `chat:detach`, `chat:load-older` e `chat:row-detail`. Faz passar T047.
- [ ] T049 [US1] Expor `window.donel.chat.*` em `src/preload/index.ts` (tipos no `DonelApi` de `src/shared/index.ts`) e criar `src/renderer/src/chat/ChatStore.ts` (uma assinatura por canal, distribuída por `ptyId` — trava de `src/preload/subscribeChannel.ts:35`) + `useChatSession(ptyId)`.
- [ ] T050 [P] [US1] Implementar no `design-system/` as extensões aprovadas em `design/chat-verificacao.md` que a leitura usa (ex.: faixa de aviso, linha de conversa, cabeçalho de alternância), com tokens apenas e exportadas em `design-system/src/index.ts`.
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Peças da leitura conforme a §4 de `design/chat-verificacao.md`: `OwnerMessage`, `MessageHeader`, `NoticeLine`, `ActionLine`, `ActionGroup`, `WorkFold`, `CodeBlock` + tokens `--code-*`, `DiffBlock`, `CommandOutput`, `Banner`, `Kbd`, `Button·link` e `SubagentRow` (só leitura). Atualizar a regra de cor do `design/design-system.md`: coral fixo = falhou; coral pulsando = precisa de você (D-C26).
- [ ] T051 [US1] Markdown e código em `src/renderer/src/chat/markdown/`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Paleta = tokens `--code-*` (§4 da conferência); caminho no cabeçalho do bloco só quando vier na cerca (D-C6); "copiar tabela" como markdown (FR-005, decisão 4).
  - `src/renderer/src/chat/markdown/Markdown.tsx`: `react-markdown` + `remark-gfm`, sem HTML cru; links pelo `chat:open-external`; caminho do Windows não vira link quebrado.
  - `CodeBlock.tsx`: rótulo da linguagem e copiar.
  - `shiki.ts`: núcleo + Oniguruma WASM; gramáticas sob demanda; tema em variáveis CSS dos tokens ou paleta aprovada; destaque quando visível; cache LRU com `src/shared/chat/t3/lruCache.ts` adaptado do T3, com cabeçalho MIT.
  - "Copiar resposta inteira" com `src/shared/chat/t3/markdownClipboard.ts` adaptado.
- [ ] T052 [US1] Linhas de mensagem em `src/renderer/src/chat/rows/`, conforme o design:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): `Notice` → `NoticeLine` (critério G3); `Unknown` mostra o tipo (D-C8); `ShellRow` e `LocalCommand` = `OwnerMessage` mono + `CommandOutput`; anexos dentro do `OwnerMessage`.
  - `UserMessage.tsx`, com miniaturas via `donel-asset:`;
  - `AssistantMessage.tsx`;
  - `Notice.tsx` (todos os `NoticeKind`, incluindo "Gerou … — abrir");
  - `Unknown.tsx` ("ver bruto");
  - `LocalCommand.tsx` e `ShellRow.tsx`.
- [ ] T053 [US3] Linhas de trabalho em `src/renderer/src/chat/rows/`, conforme o design:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Sem estatística de teste (D-C3); verbo no gerúndio enquanto roda (D-C4, nota no `conversation-rows.md` §4); chevron do "pensou" só com `hasText` (D-C5); diff cortado em 40 linhas (D-C7); `QuestionRow` e `PlanRow` a partir do `ActionLine`.
  - `ActionRow.tsx`: resumo em português, ícone por categoria, `error`/`denied` visíveis;
  - `ActionGroup.tsx`: recolhido com a lista de falhas visível; expande;
  - `Thinking.tsx`: "pensou" + duração;
  - `SkillBadge.tsx`, `QuestionRow.tsx`, `PlanRow.tsx`;
  - `SubagentRow.tsx`: só leitura nesta fase.

  Detalhes pelo `chat:row-detail`: `markdown/DiffView.tsx` (a partir do `structuredPatch`), saída de comando cortada + "ver tudo" e lista de arquivos.
- [ ] T054 [US3] Modo Foco na timeline (`src/renderer/src/chat/Timeline.tsx`):
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Liga/desliga = `Toggle` no cabeçalho da aba + clique na barra da rodada; rótulo da dobra por estado (G1); a mensagem que lança subagentes e as linhas deles ficam fora da dobra (FR-009, decisão 1).
  - liga/desliga onde o design indicar, persistido por `config:setChatPrefs` (`chat.focusMode`);
  - `foldForFocus` (T031) aplicado na timeline;
  - bloco "trabalhou — N ações, M notas" com o selo "tem pergunta aqui", que expande.
- [ ] T055 [US1] Timeline em `src/renderer/src/chat/Timeline.tsx` + `src/renderer/src/chat/scrollController.ts` (R19):
  - **Ajuste da conferência** (`design/chat-verificacao.md`): A pílula "novas mensagens ↓" só aparece com linha nova (D-C9).
  - **Rolagem**: modo "seguindo o fim" quando a rolagem está a até 40 px do fim; modo livre com a pílula "novas mensagens ↓".
  - **Histórico**: prepend preservando a posição pela diferença de `scrollHeight`; "carregando mensagens anteriores…" ao chegar no topo.
  - **Desempenho**: `content-visibility: auto` por rodada.
  - **Do T3**: geometria de âncora em `src/shared/chat/t3/scrollAnchor.ts`, se servir.
- [ ] T056 [US1] Vista e alternância em `src/renderer/src/chat/ChatView.tsx` e `src/renderer/src/App.tsx`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Controles somados ao `sessionHeader` atual (D-C22); `Toggle` do Modo Foco escondido na vista Terminal (D-C21); `SESSION_STATE_LABEL_PT.permission` → "Esperando você" (D-C20); aviso de troca de conversa como `Banner·compact`, com "abrir" e texto próprio para o `/resume`.
  - `src/renderer/src/chat/ChatView.tsx` e `ReceptionBanner.tsx` ("não estou recebendo a conversa" → Abrir terminal);
  - em `src/renderer/src/App.tsx`: `TabState.view` (padrão `chat` com `chat.enabled` em aba `claude` que não é de login); botão no cabeçalho da aba conforme o design; atalho `Ctrl+\`` no mapa global (`App.tsx:1673-1698`, com `capture`); `TerminalPane` sempre montado, oculto por CSS;
  - o aviso "Conversa nova — a anterior está em Sessões anteriores" no topo;
  - o interruptor "Chat (experimental)" nas Configurações.
- [ ] T057 [US1] Fim de sessão (FR-034) em `src/renderer/src/chat/SessionEndedBar.tsx` e `src/renderer/src/TerminalPane.tsx`:
  - `src/renderer/src/chat/SessionEndedBar.tsx` toma o lugar da caixa, com "Sessão encerrada (código N)", Retomar (`TerminalPane.respawn({ resume: sessionId atual })`) e Fechar aba;
  - a conversa continua legível e copiável;
  - o "Reabrir" do overlay do terminal (`TerminalPane.tsx:586-592`) passa a retomar a mesma conversa.
- [ ] T058 [P] [US1] Criar o gerador `tests/fixtures/chat/generate-large.mjs` (sessão sintética de ~10 mil linhas, com linhas grandes) e o cenário do CLI falso para leitura.
- [ ] T059 [US1] Escrever as smokes com o CLI falso em `tests/smoke/`:
  - `tests/smoke/chat-reading.spec.ts`: a aba abre no chat; markdown, tabela e código renderizados; copiar bloco e resposta; alternar 10× preserva a sessão; aviso após `/clear`; barra de fim + Retomar.
  - `tests/smoke/chat-long-session.spec.ts`: fim em ≤ 2 s e rolagem sem salto (SC-005).
  - `tests/smoke/chat-live-latency.spec.ts`: ≤ 1 s do append até a linha na tela (SC-008).
- [ ] T060 [US1] Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - suíte verde;
  - PR contra `staging`;
  - bateria no alfa com o dono (B1 passos 1, 2, 4 e 5; B5; B7; B8; B10; B11), registrada em `specs/014-chat/e2e.md`, seção "Fase 2";
  - se a medição do SC-005 falhar, abrir tarefa para adotar `react-virtuoso` (plano B do R19).

**Checkpoint**: chat de leitura usável no alfa; US3 completa.

---

## Phase 4: US1 (envio) + US6 — Fase 3 do plano: envio confiável

**Goal**: escrever no chat com certeza de "entrou" ou "não foi"; fila do CLI;
"interromper e mandar agora"; Parar; faixa "o terminal precisa de você";
Esteira pelo mesmo envio.

**Independent Test**: `quickstart.md` B1 completo, B2 itens 1, 3 e 9–13, B4;
smoke `chat-send` (SC-003, SC-006).

- [ ] T061 [P] [US1] Escrever `tests/chat-send-machine.test.ts` (falhando), cobrindo `contracts/send-protocol.md`:
  - **Entrada**: gate do §1, incluindo `/` e `!` só com o CLI ocioso; saneamento do §2; sobras do §3.
  - **Bytes** (§4): imagens uma por colagem; Esc do menu `/` só ocioso; Enter separado.
  - **Aceite**: tabela de sinais do §5; prazos do §6 (12 s na primeira colagem; 15 s de aceite; 30 s sem motivo).
  - **Falhas**: reenvio e anti-duplicidade do §7.
  - **Modos**: estados `waiting-cli`/`typing`/`confirming`/`queued`/`accepted`/`failed`; modo `interrupt-first`.
- [ ] T062 [P] [US1] Escrever `tests/chat-prompt-match.test.ts` (falhando), cobrindo:
  - desembrulhar `<pasted_content id=…>`;
  - normalizar `\n`, TAB e bordas;
  - `[Image #N]` casando com qualquer número;
  - mensagens idênticas seguidas casadas em ordem.
- [ ] T063 [US1] Implementar `src/shared/chat/sendMachine.ts` e `src/shared/chat/promptMatch.ts`. Fazem passar T061 e T062.
- [ ] T064 [US1] Sinais de aceite no main, em `src/main/chat/chat-hub.ts`/`chat-ipc.ts`:
  - **Fontes**: `UserPromptSubmit` da ponte (anel dos últimos 20 por aba); `queue-operation` enqueue/remove e `queued_command`; `<command-name>`, `<bash-input>`, `system/local_command`, `compact_boundary` e "Unknown command" do transcript; troca de conversa.
  - **Saídas**: evento `chat:prompt-signal` e handler `chat:ack-lookup`.
  - **Testes**: casos novos em `tests/chat-hub.test.ts`.
- [ ] T065 [US1] Implementar o driver `src/renderer/src/chat/sendDriver.ts`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): A faixa de texto não enviado é `Banner·waiting`; com o CLI trabalhando, fica sem "Descartar".
  - executa a `sendMachine` sobre o handle do `TerminalPane` (`write`, `readScreen`, `onScreenUpdate`) e os `chat:prompt-signal`;
  - mostra o aviso "Há texto não enviado no terminal: «…»" com Descartar e enviar (`\x1b\x1b` numa escrita só e releitura) e Abrir terminal.
- [ ] T066 [P] [US1] Adaptar `pingdotgg/t3code@9f48092 apps/web/src/components/chat/composerPromptHistory.ts` em `src/shared/chat/t3/promptHistory.ts`, com cabeçalho MIT e `tests/chat-prompt-history.test.ts` (↑ só com a caixa vazia ou na borda; sem duplicatas seguidas).
- [ ] T067 [US1] Caixa básica em `src/renderer/src/chat/composer/Composer.tsx`, conforme o design:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Causa do "na fila" e motivo do "não foi" visíveis (D-C10); regra do "entrou" (D-C11).
  - TextArea do design-system que cresce até ~10 linhas e depois rola; Enter envia, Shift+Enter quebra;
  - rascunho por aba em memória, que sobrevive à troca de aba e de vista e ao fim da sessão;
  - ↑ do histórico;
  - estados de envio na mensagem ("enviando…", "entrou", "não foi · tentar de novo", "na fila").
- [ ] T068 [US1] Pé de trabalho em `src/renderer/src/chat/WorkingFooter.tsx`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Gerúndio; "Aguardando N subagentes" (D-C18); estado "Interrompido" (G2); Esc na precedência do FR-008 (D-C24, decisão 4).
  - "trabalhando — <ação atual>" a partir do `LiveAction`/`PreToolUse` da ponte;
  - Parar = `\x1b` só com "esc to interrupt" visível;
  - interrupção detectada pelo marcador do transcript ou pela tela.
- [ ] T069 [US6] "Interromper e mandar agora" em `src/renderer/src/chat/composer/Composer.tsx` (gesto conforme o design) → modo `interrupt-first` da máquina. Mensagem enviada durante a rodada mostra "na fila" até a entrega (`queue-operation remove` + `queued_command`).
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Gesto: com o Claude trabalhando, o Enviar vira `SplitButton`. O clique manda para a fila, e o menu oferece "Interromper e mandar agora"; sem atalho novo (decisão 5).
- [ ] T070 [US1] Faixa em `src/renderer/src/chat/TerminalNeededBanner.tsx` + `LiveState.terminalNeeded` no hub (R16). Fontes:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Um texto por `terminalNeeded.reason`.
  - `Notification` dos tipos de diálogo sem pendência aberta;
  - `blockingScreen`/`modelDialog` por mais de 2 s sem pendência;
  - `transcriptSavingOff`;
  - envio de comando marcado `opensScreen`.

  Some quando a caixa de entrada volta sem diálogo. Botão Abrir terminal.
- [ ] T071 [US1] Esteira pelo driver (FR-020) em `src/renderer/src/App.tsx`:
  - `armEsteiraAutoStart` (`src/renderer/src/App.tsx:1323-1421`) passa a usar o `sendDriver`;
  - comando pré-digitado vai para o rascunho do chat quando a aba está no chat;
  - `tests/esteiraSession.test.ts` continua verde.
- [ ] T072 [US1] Escrever a smoke `tests/smoke/chat-send.spec.ts` com o CLI falso:
  - **SC-003**:
    - várias linhas;
    - `/mod` não vira `/model`;
    - comando desconhecido → "não foi" com motivo;
    - enviando → entrou;
    - na fila → entrou;
    - interromper e mandar;
    - auto-start da Esteira;
    - Enter reenviado sem duplicar.
  - **SC-006**: alternar 10× com rascunho.
- [ ] T073 [US1] Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - suíte verde;
  - PR contra `staging`;
  - bateria no alfa (B1 completo; B2 itens 1, 3 e 9–13; B4), registrada em `specs/014-chat/e2e.md`, seção "Fase 3".

**Checkpoint**: US1 e US6 completas; o dono conversa só pelo chat
(pendências ainda pela faixa do terminal).

---

## Phase 5: US2 — Fase 4 do plano: pendências

**Goal**: perguntas, permissões e planos respondidos num painel que não some,
um por vez, com notificação em segundo plano.

**Independent Test**: `quickstart.md` B3; smoke `chat-pending` (SC-002).

- [ ] T074 [P] [US2] Escrever `tests/chat-pending-queue.test.ts` (falhando):
  - fila FR-035 (cabeça = menor `arrivedAt`; "mais N esperando");
  - estados de `data-model.md` §8;
  - `toHookDecision(pending, answer)` conforme `hook-bridge.md` §3: permitir; permitir sempre com `permission_suggestions` (`destination` forçado a `localSettings`) e `{toolName}` sem sugestão; negar com motivo padrão; respostas múltiplas unidas por `", "`; aprovar plano ecoando o `tool_input` inteiro; pedir ajuste; interromper.
- [ ] T075 [US2] Implementar `src/shared/chat/pendingQueue.ts`. Faz passar T074.
- [ ] T076 [US2] Pendências no hub e na ponte (`src/main/chat/chat-hub.ts`, `src/main/hook-bridge.ts`):
  - `PermissionRequest` entra no `--settings` quando `chat.enabled` (T011);
  - o hub segura pelo `PendingDecisionHandle` e casa o `tool_use_id` pela tripla;
  - fecha como `resolved-elsewhere` (`PostToolUse`, `hook_permission_decision` ou `tool_result` do mesmo id), `expired` (conexão fechada → `terminalNeeded`) ou `cancelled` (PTY saiu ou interrupção);
  - handler `chat:answer` (`not-open` quando já respondida) e `LiveState.pendings`.

  Casos novos em `tests/chat-hub.test.ts` e `tests/hook-bridge.contract.test.ts`.
- [ ] T077 [P] [US2] Adaptar `apps/web/src/pendingUserInput.ts` e `apps/web/src/proposedPlan.ts` do T3 em `src/shared/chat/t3/pendingUserInput.ts` e `src/shared/chat/t3/proposedPlan.ts` (cabeçalho MIT):
  - assistente de perguntas: única ou múltipla; texto livre vence a opção; até 4 perguntas;
  - regra de recolher plano longo.

  Testes em `tests/chat-question-wizard.test.ts`.
- [ ] T078 [US2] Painel em `src/renderer/src/chat/pending/`, conforme o design:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Frase-modelo + `description` do Claude, sem explicação inventada (D-C12); o rótulo do "sempre" diz a regra real, e vale para o projeto inteiro (FR-022, decisão 2) — edição: "sempre: todas as edições neste projeto"; comando: "sempre: `<regra sugerida>`" (D-C13); diff da pendência a partir da entrada, sem número de linha (D-C14, nota no `data-model.md` §8); próxima pendência na hora e "(Recomendado)" intacto (D-C15); plano sem metadados calculados (D-C16); Esc = Negar sem motivo, na precedência do FR-008 (decisão 4).
  - `PendingPanel.tsx`: acima da caixa, persistente; mostra a cabeça da fila + "mais N esperando" e a origem ("pedido do subagente <descrição>").
  - `QuestionCard.tsx`: cartões com rótulo e descrição; prévia; múltipla; "Outra"; um Responder para até 4 perguntas.
  - `PermissionCard.tsx`: ação descrita em português; diff em `Edit`/`Write` via `DiffView`; Permitir / Permitir sempre neste projeto / Negar + motivo.
  - `PlanCard.tsx`: markdown recolhível; Aprovar e seguir; Pedir ajuste — a caixa vira o campo do ajuste, que sai como `plan-adjust`.

  Parar com pendência aberta → resposta `interrupt`.
- [ ] T079 [US2] Notificações em `src/main/chat/notifications.ts`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Texto da notificação (D-C17); `statusText` "esperando você" na aba e rótulo na barra lateral (D-C20).
  - `Notification` do Electron quando uma pendência abre e a janela não está em foco **ou** a aba não está ativa;
  - clique foca a janela e a aba e põe o foco no painel;
  - respeita `notificationPreference`;
  - canal `chat:focus-state`;
  - semáforo em `permission` ("esperando você") enquanto houver pendência;
  - ajustar a regra que pula a aba ativa com a janela fora de foco (`src/renderer/src/App.tsx:1714-1740`).
- [ ] T080 [US2] Estender o CLI falso (`tests/smoke/fixtures/fake-claude-chat/`) com roteiros de `PermissionRequest`:
  - pergunta, permissão e plano;
  - dois pedidos simultâneos de subagentes;
  - segura até a decisão e aplica: grava o `tool_result`; "permitir sempre" grava `.claude/settings.local.json` falso.
- [ ] T081 [US2] Escrever a smoke `tests/smoke/chat-pending.spec.ts` (SC-002):
  - toda pendência aparece no painel ou na faixa;
  - contador da fila;
  - resposta pelo painel chega ao CLI falso;
  - resposta "pelo terminal" fecha o painel;
  - notificação com a janela fora de foco (stub).
- [ ] T082 [US2] Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - suíte verde;
  - PR contra `staging`;
  - bateria no alfa (B3), registrada em `specs/014-chat/e2e.md`, seção "Fase 4".

**Checkpoint**: nenhuma pergunta ou permissão perdida; US2 completa.

---

## Phase 6: US4 — Fase 5 do plano: caixa rica

**Goal**: menus `/` e `@`, imagens, colagem grande, selo de `!`.

**Independent Test**: `quickstart.md` B2 completo; smoke `chat-composer`.

- [ ] T083 [P] [US4] Escrever `tests/chat-command-catalog.test.ts` (falhando):
  - união das três fontes (nativos, disco, `skill_listing`);
  - entradas só do disco mantidas;
  - `/login` e `/logout` fora do menu e com selo de aviso quando digitados;
  - `opensScreen`;
  - invalidação por `mtime` (parte pura).
- [ ] T084 [US4] Implementar o catálogo em `src/shared/chat/commandCatalog.ts` e `src/main/chat/command-catalog-scanner.ts`:
  - `src/shared/chat/commandCatalog.ts`: lista de comandos nativos do CLI 2.1.29x com descrição em português, apelidos e `opensScreen` (R16);
  - `src/main/chat/command-catalog-scanner.ts`: só frontmatter, de `~/.claude/skills/*/SKILL.md`, `~/.claude/commands/**/*.md`, `<cwd>/.claude/skills|commands` e plugins habilitados;
  - handler `chat:catalog`.

  Faz passar T083.
- [ ] T085 [P] [US4] Adaptar do T3, para `src/shared/chat/t3/`:
  - `packages/shared/src/composerTrigger.ts` (só `/` e `@`);
  - `packages/shared/src/searchRanking.ts`;
  - `apps/web/src/components/chat/composerMenuHighlight.ts`;
  - `useComposerTriggerState.ts`.

  Com cabeçalho MIT e teste em `tests/chat-composer-trigger.test.ts`.
- [ ] T086 [US4] Arquivos do projeto para o `@` em `src/main/chat/project-files.ts`:
  - `git ls-files` + não rastreados não ignorados;
  - sem git, varredura limitada (pula `node_modules`, `.git` e `dist`; teto de 20 mil);
  - handler `chat:files`;
  - teste em `tests/chat-project-files.test.ts`, com pasta temporária.
- [ ] T087 [US4] Menu em `src/renderer/src/chat/composer/CommandMenu.tsx`, com o Menu/Popover do design-system conforme o design:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): `Listbox`; Enter envia o que está escrito e Tab escolhe; ficha de origem com "plugin"; selo de `/login` e `/logout`.
  - `/` com nome e descrição, filtrando;
  - `@` com arquivos;
  - setas e Tab escolhem, Esc fecha;
  - insere o texto;
  - selo de `/login` e `/logout`.
- [ ] T088 [US4] Imagens em `src/main/chat/chat-ipc.ts` e `src/renderer/src/chat/composer/Attachments.tsx`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Botão de clipe abre o seletor de arquivos: imagem vira anexo, outro arquivo vira `@caminho` (FR-015, decisão 4); a miniatura colada se chama "imagem colada N".
  - colar ou arrastar → `chat:save-image`, que grava em `userData/chat-attachments/<sessionId>/` (limpeza ao fechar a aba e, no boot, do que tiver mais de 7 dias);
  - miniatura removível em `src/renderer/src/chat/composer/Attachments.tsx`;
  - envio pela máquina: uma colagem por imagem, esperando `[Image #N]`;
  - arquivo não-imagem arrastado → `@relativo`.

  Para arquivo fora do `cwd`, verificar no CLI se `@` com caminho absoluto funciona e, se não, inserir o caminho como texto; registrar o resultado em `specs/014-chat/research.md`, R4.
- [ ] T089 [US4] Colagem grande e selo de shell em `src/renderer/src/chat/composer/Composer.tsx`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): A ficha de texto colado abre num `Modal` só leitura, em mono.
  - colagem com mais de 20 linhas ou mais de 2.000 caracteres vira a ficha "texto colado — N linhas", que abre para conferir e no envio volta inteira ao lugar;
  - selo "vai rodar como comando de shell" para mensagem começando com `!`.
- [ ] T090 [US4] Escrever a smoke `tests/smoke/chat-composer.spec.ts`, cobrindo:
  - menu `/` filtra e insere;
  - menu `@`;
  - imagem → miniatura, e o CLI falso recebe a colagem do caminho;
  - ficha de colagem grande;
  - selo `!`.
- [ ] T091 [US4] Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - suíte verde;
  - PR contra `staging`;
  - bateria no alfa (B2 completo), registrada em `specs/014-chat/e2e.md`, seção "Fase 5".

---

## Phase 7: US5 — Fase 6 do plano: subagentes

**Goal**: cada subagente como linha viva, faixa no topo e painel lateral ao
vivo.

**Independent Test**: `quickstart.md` B6; smoke `chat-subagents`.

- [ ] T092 [P] [US5] Escrever `tests/chat-subagent-tracker.test.ts` (falhando):
  - ligação por `.meta.json` (`toolUseId`, `agentId`);
  - `SubagentStart`/`SubagentStop`;
  - última ação por `PreToolUse` com `agent_id`;
  - estado final pela `<task-notification>`;
  - `background`;
  - agentes internos filtrados;
  - `unknown` no fim da sessão;
  - aninhado por `parentAgentId`.
- [ ] T093 [US5] Implementar `src/main/chat/subagent-tracker.ts`:
  - vigia `<sessão>/subagents/`, lendo os `.meta.json` e a cauda só dos subagentes ativos;
  - emite patches de `subagent` e `LiveState.activeSubagents`;
  - `chat:subagent-open`/`chat:subagent-close` seguem `agent-<id>.jsonl` com o mesmo adaptador (`scope: { agentId }`).

  Faz passar T092.
- [ ] T094 [US5] UI conforme o design em `src/renderer/src/chat/`:
  - **Ajuste da conferência** (`design/chat-verificacao.md`): Contagem "N rodando · M concluídos" (D-C18); estados `failed`/`killed`/`stopped`/`unknown`; largura 460/420 px e trilho de sessões a 1280 (F); alça acessível com `role=separator` (D-C27); no Modo Dev, o painel ocupa a coluna da direita no lugar do `PhaseDetailsPanel` (FR-027, decisão 3); subagente concluído mostra "resultado:" com a primeira linha não vazia da resposta final (FR-027, decisão 4).
  - `SubagentRow.tsx`: tempo, última ação, estado e segundo plano, ao vivo;
  - `src/renderer/src/chat/SubagentStrip.tsx`: faixa no topo com a contagem; troca o subagente do painel;
  - `src/renderer/src/chat/SubagentPanel.tsx`:
    - painel lateral à direita, com a mesma `Timeline` e o mesmo Modo Foco;
    - fecha com × ou Esc;
    - aninhado com "ver" no mesmo painel;
    - comportamento em 1280 px conforme o design.
- [ ] T095 [US5] Estender o CLI falso com roteiros de subagentes (dois em paralelo, um em segundo plano, um aninhado) e escrever a smoke `tests/smoke/chat-subagents.spec.ts`.
- [ ] T096 [US5] Fechar a fase (registro em `specs/014-chat/e2e.md`):
  - suíte verde;
  - PR contra `staging`;
  - bateria no alfa (B6), registrada em `specs/014-chat/e2e.md`, seção "Fase 6".

---

## Phase 8: Polish — Fase 7 do plano: virada

- [ ] T097 Virar o padrão (D5) em `src/main/config-store.ts` e `tests/smoke/`:
  - `chat.enabled` passa a valer `true` por padrão em `src/main/config-store.ts`;
  - migrar as smokes que esperam `[data-testid="terminal-pane"]` visível (`grep -l terminal-pane tests/smoke/*.spec.ts`): abrem a vista do terminal pelo atalho ou passam a conferir o chat.
- [ ] T098 [P] Atribuição do T3 (FR-032) em `src/renderer/src/chat/vendor/t3code/LICENSE`:
  - `src/renderer/src/chat/vendor/t3code/LICENSE` com o texto MIT e "Copyright (c) 2026 T3 Tools Inc.";
  - conferir o cabeçalho em todo arquivo de `src/shared/chat/t3/`;
  - incluir o arquivo de licença em `extraResources` do electron-builder (`package.json` → `build`).
- [ ] T099 [P] Remover o transporte antigo de hooks de `src/main/hooks-settings.ts` e `src/main/session-semaphore-manager.ts`:
  - encaminhador PowerShell e `DONEL_HOOKS_TRANSPORT=legacy`, em `src/main/hooks-settings.ts` e `src/main/session-semaphore-manager.ts`;
  - os testes correspondentes.
- [ ] T100 [P] Espelho público (`scripts/sincronizar-publico.ps1`):
  - anotar as dependências novas para o `package.json` público (o `scripts/sincronizar-publico.ps1` avisa);
  - conferir que fixtures e telas de exemplo não têm vocabulário interno.
- [ ] T101 [P] Documentação em `CLAUDE.md` e no vault:
  - **`CLAUDE.md` do projeto, seção "Gotchas"**:
    - hooks HTTP com token por aba;
    - `/mod`+Enter com o menu aberto vira `/model`;
    - Esc Esc em caixa vazia abre o Rewind;
    - o transcript é uma árvore;
    - bytes escritos antes do gate se perdem.
  - **Vault**: `Projects/donel-dev/context.md`.
- [ ] T102 Bateria completa com o dono no alfa (`quickstart.md`, `specs/014-chat/diario-sc007.md`):
  - `quickstart.md` B1–B11;
  - abrir `specs/014-chat/diario-sc007.md` (SC-007);
  - **gate**: o "vai" do dono para o beta.

---

## Dependencies & Execution Order

- **Phase 1 (gate de forma) ∥ Phase 2 (fundação)** — rodam juntas (decisão de
  07/10).
- **Phase 3** precisa da Phase 2 **e** do T004 (protótipo aprovado).
- **Phases 4 → 5 → 6 → 7 → 8**, em sequência, com a revisão do dono entre
  elas.
  - A Phase 5 (US2) usa a caixa da Phase 4 ("Pedir ajuste", gate de envio
    com pendência aberta).
  - As Phases 6 (US4) e 7 (US5) mexem em arquivos quase disjuntos e podem
    correr em paralelo depois da 5, se o dono quiser.
- **Dentro de cada fase**: teste (falhando) → implementação pura → I/O do main
  → UI → smoke → bateria + PR.

### Dependências entre histórias

- **US1 (leitura)** → **US3** (mesmas linhas) e **US1 (envio)**.
- **US1 (envio)** → **US6** e **US2**.
- **US4** depende da US1 (envio). **US5** depende da US3 (formato das linhas)
  e da US1 (leitura).

## Parallel Example

```text
# Phase 2 — testes e fixtures em paralelo (arquivos distintos):
T005 rows.ts · T006 ipc.ts · T007 chat-config.test · T009 diagnostics-log
T010 hooks-settings.test · T012 hook-bridge.contract.test · T017 env/mode tests
T019 fixtures de transcript · T020/T022/T024/T026/T028/T030/T032 testes puros · T034 fixtures de tela

# Phase 3 — depois do T048/T049:
T050 design-system · T051 markdown/código · T046 protocolo de assets · T058 gerador grande

# Phase 5 — em paralelo:
T074 pending-queue.test · T077 adaptação T3 (wizard/plano)
```

## Implementation Strategy

1. **Fundação + gate de forma** (Phases 1 e 2 em paralelo). Já entrega valor:
   semáforo, nome e cor sobrevivem ao `/clear`, e as ferramentas ficam mais
   rápidas.
2. **MVP = Phases 3 e 4** (US1 + US3 + US6). O dono lê e conversa pelo chat; as
   perguntas ainda vão para o terminal pela faixa.
3. **Phase 5 (US2)** fecha a dor principal: nenhuma pergunta perdida.
4. **Phases 6 e 7** (US4, US5) completam a escrita rica e os subagentes.
5. **Phase 8** vira o padrão.

Tudo vai para `staging` atrás de `chat.enabled` até lá.

**Sessão fresca**: rodar cada fase em sessão nova (implementação consome
contexto), com `/handoff` ao fim. A fila e os prompts por fase ficam no vault
(`Projects/donel-dev/execucao-014-chat/`).
