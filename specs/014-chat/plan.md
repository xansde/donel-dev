# Plano técnico — 014 Chat no lugar da visão do terminal

**Branch**: `014-chat` · **Data**: 2026-10-07 · **Spec**:
`specs/014-chat/spec.md` (com as 5 clarificações de 07/10)

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementos deste
plano:

- `research.md` — R1–R24 e o resultado dos 5 itens a verificar;
- `data-model.md`;
- `contracts/conversation-rows.md` — linhas e adaptador;
- `contracts/hook-bridge.md`;
- `contracts/send-protocol.md`;
- `contracts/ipc-chat.md`;
- `quickstart.md` — validação.

Glossário técnico: **TUI** = a tela de texto que o `claude` desenha (o que a
aba mostra na vista do terminal; na spec, "terminal do Claude"). **PTY** = o
terminal virtual onde o `claude` roda escondido. **Hook** = aviso que o CLI
manda ao app a cada evento (e, no caso das pendências, a resposta que o app
devolve).

## Sumário

O chat vira a vista padrão das abas `claude` **sem trocar o motor**. O mesmo
CLI interativo segue numa PTY, e o `TerminalPane` continua montado, só
escondido.

O chat se apoia em três peças novas:

1. **Leitor + adaptador do transcript** (main + puro). Transforma o JSONL do
   CLI em "linhas da conversa", seguindo a cadeia ativa, sem ler o arquivo
   inteiro e sem guardar conteúdo pesado em memória.
2. **Ponte de hooks HTTP** (main). Substitui o encaminhador PowerShell de
   hoje e passa a segurar a resposta do `PermissionRequest`. É assim que
   pergunta, permissão e plano chegam ao painel e voltam ao CLI. O token por
   aba faz a aba seguir `/clear` e `/resume`.
3. **Driver de envio** (renderer). Escreve na PTY só quando a tela da TUI está
   pronta, cola com bracketed paste e confirma pelo hook `UserPromptSubmit` ou
   pelo transcript. Nunca recola sozinho. O auto-start da Esteira passa a
   usar o mesmo driver.

Os cinco "itens a verificar" da spec foram verificados ao vivo no CLI 2.1.293
e **todos têm caminho principal**: nenhum plano B foi necessário. A entrega é
incremental, atrás do interruptor `chat.enabled`, em 8 fases.

A **Fase 0 é um protótipo de forma aprovado pelo dono**. Nenhuma tarefa de
tela começa sem ele.

## Technical Context

**Language/Version**: TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2
**Primary Dependencies**: Electron 43.2, node-pty 1.1.0 (patch), @xterm/xterm 6.0.0; novas: react-markdown 10, remark-gfm 4, shiki 4 (núcleo + Oniguruma WASM)
**Storage**: transcripts JSONL do CLI (só leitura) + `config.json` do app (`chat.enabled`, `chat.focusMode`) + `userData/hook-settings/<ptyId>.json` + `userData/chat-attachments/` + `userData/chat-diagnostics.log`
**Testing**: vitest (módulos puros, contrato HTTP da ponte de hooks) + Playwright/Electron com CLI falso roteirizado + bateria com o CLI real no alfa (`quickstart.md`)
**Target Platform**: Windows 11 (canal alfa → beta → público), ConPTY
**Project Type**: desktop-app (Electron: main + preload + renderer, design-system em workspace)
**Performance Goals**: sessão longa abre no fim em ≤ 2 s (SC-005); linha nova na tela ≤ 1 s após o CLI gravar (SC-008); hooks não bloqueantes respondidos em ≤ 10 ms
**Constraints**: transcript nunca lido inteiro; o app não toca credencial; o CLI não é modificado; o chat só pergunta quando o CLI perguntaria; UI em pt-BR, código em inglês; espelho público sem vocabulário interno
**Scale/Scope**: um operador; dezenas de abas; transcripts de até ~40 MB e linhas de até 1,4 MB; 6 user stories, 35 FRs

## Gate de constituição

`.specify/memory/constitution.md` está **não preenchido** (template). A
constituição de fato do repo é o `CLAUDE.md`, como no plano da 011.

| Regra do repo | Como este plano cumpre |
|---|---|
| O app nunca lê, grava ou exibe credenciais; a exceção de `src/main/accounts/` não se generaliza | **Leitura.** O chat não importa nada de `src/main/accounts/` (usa só o evento `accounts:changed` para o rótulo do aviso). O adaptador descarta os attachments com dado de conta (`session_context`, `credential_org`) antes de qualquer regra. O app lê o `~/.claude/settings.json` só para `permissions.defaultMode`, sem credencial. **Escrita.** O app não grava configuração do CLI: "permitir sempre" é gravado pelo próprio CLI. |
| Gotcha: `/logout` revoga o token no servidor | O menu `/` não lista `/login` nem `/logout`. Digitados, ganham o selo "afeta a conta — use o painel de Contas" antes do envio. |
| TDD com escopo | O que é puro nasce com vitest antes do código: adaptador, cadeia ativa, foco, grupos, resumos, fila de pendências, máquina de envio, detectores de tela, catálogo e tradução de respostas de hook. PTY e UI são validadas por smoke roteirizado com o CLI falso. |
| UI em pt-BR, código em inglês | Respeitado; os resumos de ação são gerados em português. |
| Spec é a fonte do escopo | O plano cobre FR-001 a FR-035. Os ajustes propostos à spec estão listados abaixo, **não aplicados**. |
| Transcript nunca lido inteiro | Seguidor por offset + paginador por blocos a partir do fim (R11). |
| Espelho público: vocabulário genérico e `specs/` fora | Fixtures sintéticas com `atlas`/`beacon`/`vega`. A atribuição do T3 fica em `src/` e vai junto. As dependências novas exigem editar o `package.json` público à mão (o script avisa). |
| LGPD | Nenhum conteúdo real de transcript em fixture, teste ou log; o log de diagnóstico não grava conteúdo. |
| PR para `staging` livre; merge humano; `main` e público bloqueados | Cada fase entra por PR em `staging`; o merge é do dono, depois da validação. |
| Baseline: instalar dependência pede confirmação | As 3 dependências novas (tabela "Complexidade") pedem OK na tarefa que as instala. |

**Resultado**: passa. Nenhuma violação; as relaxações conscientes estão em
"Complexidade".

## Arquitetura em uma tela

```text
                       ┌──────────────────────────── renderer (por aba claude) ───────────────────────────┐
                       │  ChatView (vista padrão)                       TerminalPane (oculto, sempre montado) │
                       │   ├─ Timeline ◀── ChatStore ◀── chat:rows/live │   xterm buffer ──▶ readScreen()        │
                       │   ├─ PendingPanel ──chat:answer──┐            │   PTY dona: spawn / write / respawn     │
                       │   ├─ Composer ──▶ sendDriver ────┼────────────┼──▶ write(bytes) ──────────┐            │
                       │   └─ SubagentPanel               │            └────────────────────────────┼────────────┘
                       └──────────────────────────────────┼─────────────────────────────────────────┼──────────────
                                                          │ IPC                                     │ pty:input
┌──────────────────────────────── main ───────────────────┼─────────────────────────────────────────┼─────────────┐
│ ChatHub (por ptyId) ◀────────────────────────────────────┘                                         ▼             │
│   ├─ TranscriptFollower/Pager ──▶ adapter (puro) ──▶ rows                                   node-pty ──▶ claude  │
│   ├─ SubagentTracker (subagents/*.jsonl + meta)                                                   │   (CLI)    │
│   ├─ PendingQueue ◀──────────┐                                                                    │            │
│   └─ notificações (Electron) │                                                                    │            │
│ HookBridge (127.0.0.1, /h/<Evento>, X-Donel-Token) ◀─── http / curl (SessionStart) ───────────────┘            │
│   └─▶ semáforo · nome/contexto/cor (re-apontados no /clear) · ChatHub                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        transcript JSONL (~/.claude/projects/…) ──▶ lido pelo Follower/Pager (offset, blocos, LineRef)
```

## Decisões de desenho

- **P1 — A PTY continua sendo do `TerminalPane`.** Ele fica montado e oculto
  por CSS na vista de chat, e o chat é um irmão na mesma aba.
  - O envio confiável e os detectores de tela leem o buffer do xterm do
    renderer, provados no auto-start da Esteira.
  - Levar a PTY para o main exigiria uma segunda emulação de terminal e
    refazer o terminal.
  - Na aba que nasce no chat, a PTY é criada com o tamanho da área (métricas
    de célula), e não 80×24.
- **P2 — Leitura, hooks, pendências e notificações no main** (`src/main/chat/`).
  Ficam fora do throttling de timers do renderer em segundo plano e perto do
  disco.
- **P3 — Toda decisão é pura** (`src/shared/chat/`) e testada com vitest; o
  main e o renderer só fazem I/O.
- **P4 — Um transporte de hooks só** (HTTP + token por aba) para semáforo e
  chat. O encaminhador PowerShell sai, e o caminho antigo fica selecionável
  por uma versão, para reverter.
- **P5 — Conteúdo pesado fica no disco.** As linhas guardam `LineRef`, e o
  detalhe é relido sob demanda. Imagens do transcript e anexos são servidos
  pelo protocolo `donel-asset:`, com caminhos validados.
- **P6 — Um driver de envio só**, para o chat e o auto-start da Esteira, com o
  gate de tela, o aceite autoritativo e a regra contra duplicidade do
  contrato.
- **P7 — Identidade da aba ≠ identidade da conversa.** Token/`ptyId` são
  fixos; `sessionId` muda com `/clear` e `/resume`. As features que dependem
  do transcript são re-apontadas juntas (FR-033).
- **P8 — Nada de escrita em configuração do CLI pelo app.** A única exceção
  é o arquivo `--settings` da própria sessão, gerado pelo app.
- **P9 — Sem virtualizador na v1**, com gate de medição do SC-005
  (`react-virtuoso` como plano B).
- **P10 — Entrega atrás de `chat.enabled`** até a virada (D5 na Fase 7).

### Valores que a spec deixou para o plano

| Assunto | Valor | Fonte |
|---|---|---|
| Colagem grande (FR-016) | Mais de **20 linhas ou 2.000 caracteres** vira ficha "texto colado — N linhas" (a caixa mostra ~10 linhas) | escolha do plano |
| Prazo de aceite do envio | **15 s** depois do Enter; 3 s para o eco; 30 s de espera pelo CLI sem motivo visível | R6, R7 |
| Espera de pendência | `timeout` de 86400 s no hook | R2 |
| Atalho chat ⇄ terminal | **`Ctrl+\``**, com botão no cabeçalho da aba; o mapa global usa só `Ctrl+Tab` e `Ctrl+<n>` | `App.tsx:1673-1698` |
| Página de histórico | 30 rodadas ou 2 MB lidos | R11 |

## Fases

Cada fase entra por PR em `staging`, atrás de `chat.enabled` (desligado), e
termina com **revisão do dono** antes da seguinte (cadência da 010). A
**Fase 1 corre junto com a Fase 0** (aprovado pelo dono em 07/10), porque
não tem tela. As demais só começam com o protótipo aprovado.

### Fase 0 — Protótipo de forma *(gate; sem código de produção)*

- **Objetivo**: o dono vê e clica as telas antes de qualquer código de UI.
- **Cobre**: conversa (mensagem, resposta com markdown/código/tabela, ações e
  grupos, Modo Foco com "tem pergunta aqui", "pensou", skill, avisos); caixa
  (várias linhas, menus `/` e `@`, anexos, selo `!`, estados de envio);
  painel de pendência (pergunta, permissão com diff, plano, fila, origem
  subagente); faixas ("o terminal precisa de você", "não estou recebendo a
  conversa"); barra "Sessão encerrada"; pé "trabalhando" + Parar;
  subagentes (linha viva, faixa no topo, painel lateral); alternância;
  aviso de conversa nova.
- **Rota decidida pelo dono (07/10): Claude Design, como no Modo Dev.**
  1. O prompt pronto `design/prompt-design-chat.md` é colado no
     claude.ai/design.
  2. O resultado é salvo em `design/chat-handoff/`.
  3. A conferência contra a spec vai para `design/chat-verificacao.md`, com
     as divergências nomeadas.

  Regra de conflito do Modo Dev: na forma vence o design; no comportamento
  vence a spec.
- **Gate**: protótipo aprovado + documento de verificação. Sem isso, nenhuma
  tarefa das Fases 2–6.

### Fase 1 — Fundação sem tela

- **Entra**:
  - ponte de hooks HTTP com `--settings` por sessão e token (`hook-bridge`),
    com o semáforo migrado;
  - `SessionStart`/`SessionEnd` re-apontando semáforo, nome, contexto, cor e
    chaves por sessão — corrige o `/clear` de hoje (FR-033, nas duas vistas);
  - ambiente garantido e modo de permissão explícito em todo spawn (FR-030);
  - seguidor e paginador do transcript, adaptador, cadeia ativa, resumos,
    grupos e Modo Foco (puros);
  - detectores de tela corrigidos (`trustDialog.ts`, `cliInputBox.ts`) —
    melhora também o auto-start da Esteira;
  - CLI falso roteirizado, `chat-diagnostics.log` e o interruptor
    `chat.enabled`.
- **O dono percebe**: nada de novo na tela. Semáforo, nome e cor passam a
  sobreviver ao `/clear`, e as chamadas de ferramenta ficam mais rápidas (sem
  PowerShell por hook).
- **Gate**:
  - vitest e contratos verdes;
  - smokes existentes verdes;
  - no alfa: semáforo e `/clear` validados pelo dono.

### Fase 2 — Chat de leitura (fatia vertical)

- **Entra**:
  - `ChatView` com a timeline: markdown, código com Shiki e copiar, ações,
    grupos, "pensou", skills, avisos, `unknown`;
  - linhas de subagente sem o painel;
  - Modo Foco, histórico sob demanda, âncora de rolagem e "novas mensagens ↓";
  - alternância por botão e atalho;
  - faixa "não estou recebendo a conversa";
  - aviso de conversa nova;
  - barra "Sessão encerrada" + Retomar (FR-034);
  - CSP, guarda de navegação, links externos e `donel-asset:`.
- Escrever ainda é pelo terminal (alternando).
- **Gate**: o dono lê sessões reais no chat — `quickstart` B1 (1, 2, 4, 5),
  B5, B7, B8, B10 e B11.

### Fase 3 — Envio confiável (US1 completa, US6)

- **Entra**:
  - caixa básica: várias linhas, Enter/Shift+Enter, rascunho por aba,
    histórico com ↑;
  - driver de envio: gate, saneamento, sobras, colagem, menu `/`, Enter,
    aceite, prazos, "tentar de novo";
  - "na fila" (fila do CLI) e "interromper e mandar agora";
  - pé "trabalhando — <ação>" + Parar;
  - faixa "o terminal precisa de você" (detectores + `Notification`);
  - auto-start e pré-digitação da Esteira pelo driver (FR-020).
- **Gate**: B1 completo; B2 nos itens 1, 3 e 9–13; B4; bateria do SC-003.

### Fase 4 — Pendências (US2)

- **Entra**:
  - `PermissionRequest` segurado e as respostas traduzidas
    (`hook-bridge` §3);
  - painel: assistente de perguntas (opções, prévia, multi, "Outra", até 4
    perguntas), permissão em português com diff e "permitir sempre", cartão
    de plano com "Pedir ajuste" pela caixa;
  - fila de pendências com "mais N esperando" (FR-035);
  - notificação do Windows e "esperando você" na aba (FR-024);
  - rótulo de subagente;
  - fechamento por resposta dada em outro lugar.
- **Gate**: B3, SC-002.

### Fase 5 — Caixa rica (US4)

- **Entra**:
  - menu `/` com o catálogo das três fontes (R3) e o selo de `/login`/`/logout`;
  - menu `@` com os arquivos do projeto;
  - imagem colada ou arrastada (miniatura, `chat:save-image`, caminho
    colado);
  - não-imagem arrastada vira `@caminho`;
  - ficha de colagem grande;
  - selo de `!`.
- **Gate**: B2 completo.

### Fase 6 — Subagentes (US5)

- **Entra**:
  - linha viva (tempo, última ação, estado);
  - painel lateral à direita, com o mesmo adaptador e Modo Foco, ao vivo;
  - faixa no topo;
  - segundo plano atualizando depois da resposta do principal;
  - aninhado com "ver" no mesmo painel.
- **Gate**: B6.

### Fase 7 — Virada

- **Entra**:
  - `chat.enabled` padrão `true`: o chat vira a vista padrão (D5);
  - as 11 smokes que esperam `terminal-pane` visível passam a abrir na vista
    de terminal ou a verificar o chat;
  - atribuição do T3 no instalador (`extraResources`);
  - nota ao espelho público (dependências);
  - remoção do transporte antigo de hooks;
  - bateria completa B1–B11 e início do diário do SC-007.
- **Gate**: o "vai" do dono para o beta.

## Correções em código existente (reveladas pela pesquisa)

| Onde | Problema hoje | Fase |
|---|---|---|
| `src/shared/trustDialog.ts` | Exige "2. No, exit", que não existe na 2.1.293: o diálogo de confiança não é detectado | 1 |
| `src/shared/cliInputBox.ts` | Lê placeholder e sugestão fantasma (*dim*) como texto, ignora o prompt `!` e limita a caixa a 8 linhas (ela vai a 15) | 1 |
| `src/main/session-semaphore-manager.ts:196-197` + `semaphore-state-machine.ts:97-99` | `SessionEnd` do `/clear` leva a `done`; o `SessionStart` seguinte é descartado | 1 |
| `src/main/hooks-settings.ts` | Encaminhador sem retorno (2 s, saída descartada), arquivo único, servidor sem autenticação e corpo sem limite | 1 |
| `src/renderer/src/TerminalPane.tsx:586-592` | "Reabrir" começa conversa nova, não retoma | 2 |
| `src/renderer/src/App.tsx:1714-1740` | Notificação pula a aba ativa mesmo com a janela fora de foco; roda no renderer | 4 |
| `src/renderer/index.html` + `src/main/index.ts` | Sem guarda de navegação; CSP bloqueia `data:`/`blob:` | 2 |
| Spawn com aba oculta | `fit()` não roda em elemento oculto: PTY nasce 80×24 | 2 |

## Estratégia de teste

Resumo (detalhes em `research.md` R24 e roteiro em `quickstart.md`):

- **vitest** antes do código em todo módulo de `src/shared/chat/`: adaptador
  por fixture sintética, por versão do CLI; cadeia ativa com rewind e
  compactação; foco; grupos; resumos em português; fila de pendências;
  máquina de envio, com todos os prazos e a regra contra duplicidade;
  detectores sobre telas capturadas nos layouts fullscreen e inline;
  catálogo; tradução `PendingAnswer` → resposta de hook.
- **Contrato HTTP da ponte de hooks**: servidor real + cliente que imita o
  CLI (segurar, responder, primeira resposta vence, `expired`, `401`,
  limite de corpo, `SessionStart` re-apontando).
- **Smokes Playwright** com o CLI falso roteirizado (SC-002, SC-003, SC-006,
  a sessão longa do SC-005 e a latência do SC-008).
- **Bateria real no alfa** a cada fase com tela, e o diário do SC-007 depois
  da virada.

## Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| O CLI muda o formato do transcript ou os textos da TUI | Linhas ou detectores errados | `unknown` tolerante; fixtures por versão; detectores com mais de um marcador; `chat-diagnostics.log` aponta tipos novos; a faixa cobre o "estado não reconhecido". |
| Envio perdido ou duplicado em condição não vista | Quebra a confiança na caixa (SC-003) | Aceite só por sinal autoritativo; nunca recolar sozinho; bateria do SC-003 a cada fase que mexe no envio. |
| Main sobrecarregado por transcript gigante | Trava a PTY de outras abas | Paginação, `LineRef`, parse em blocos com cessão ao event loop; medição na Fase 2; `worker_thread` se a medição pedir. |
| Migração do transporte de hooks quebra o semáforo | Regressão no uso diário | Fase própria (1); testes de contrato; caminho antigo selecionável por uma versão. |
| App fechado ou travado com pendência segurada | Pergunta parada | O CLI desiste do hook em ~30 ms com a porta fechada, e o diálogo da TUI continua valendo (fail-open). |
| CSP relaxada (`'wasm-unsafe-eval'`) | Superfície maior | Só WASM (nunca `unsafe-eval`); guarda de navegação; markdown sem HTML cru; `highlight.js` como reserva. |
| Throttling de timers do renderer em segundo plano | Auto-start da Esteira mais lento com a janela minimizada | Igual ao de hoje; o envio do chat é ação do dono com a janela em foco. |
| Dependências novas fora do espelho público | Clone público não builda | Nota da Fase 7; o script de sincronização já avisa sobre diferença no `package.json`. |

## Ajustes de spec aplicados na revisão do plano (07/10)

1. **AS 2.2** passou a "sem o dono precisar abrir o terminal". Com o hook
   escolhido, o diálogo é desenhado no terminal oculto enquanto espera, e é
   isso que torna verdadeiro o caso de borda "responder pelo terminal" (R1).
   A spec deixou de usar o termo "TUI": agora diz "terminal do Claude", que
   é o mesmo que o dono vê.
2. **SC-008**: linha nova na tela em até 1 s depois de o CLI gravar
   (aprovado pelo dono).

## Complexidade

| Item | Por que é preciso | Alternativa mais simples rejeitada porque |
|---|---|---|
| 3 dependências novas (`react-markdown`, `remark-gfm`, `shiki`) | FR-005: markdown renderizado e código colorido | Renderizador e destaque escritos à mão: mais código, menos fidelidade e mais manutenção |
| CSP com `'wasm-unsafe-eval'` | O motor do Shiki é WASM | Motor JavaScript do Shiki trava com regex de backtracking; `highlight.js` fica de reserva |
| Protocolo `donel-asset:` | Imagens de até MBs sem passar base64 pelo IPC | `data:` URL: payloads enormes por IPC e na memória do renderer |
| `--settings` por sessão (arquivos em `userData`) | Token literal por aba, válido em `cmd` e `bash`, e não herdado por processos filhos | Arquivo único + variável de ambiente: sintaxe diferente por shell e token herdado |

## Estrutura do projeto

### Documentação (esta feature)

```text
specs/014-chat/
├── spec.md               # spec + clarificações de 07/10
├── plan.md               # este arquivo
├── research.md           # R1–R24
├── data-model.md
├── quickstart.md         # validação (automática + bateria real)
├── contracts/
│   ├── conversation-rows.md
│   ├── hook-bridge.md
│   ├── send-protocol.md
│   └── ipc-chat.md
├── checklists/requirements.md
├── spike/                # evidência das verificações de 07/10 (harness, protocolo de referência, capturas)
└── tasks.md              # /speckit.tasks
```

### Código (novo e alterado)

```text
src/shared/chat/                 # puro, vitest
├── rows.ts                      # ConversationRow, LiveState, Pending, Send (tipos)
├── transcriptEntry.ts           # classificação de linha (contrato §2)
├── adapter.ts                   # entradas → linhas (patches)
├── activeChain.ts               # cadeia ativa + paginação para trás
├── toolSummary.ts               # resumos em português (contrato §4)
├── grouping.ts                  # grupos de ações
├── focusFold.ts                 # Modo Foco
├── pendingQueue.ts              # fila FR-035 + tradução PendingAnswer → hook
├── sendMachine.ts               # estados, prazos, anti-duplicidade
├── promptMatch.ts               # comparação de texto (pasted_content, [Image #N])
├── screen.ts                    # detectores (caixa, rodapé, diálogos, menus)
├── commandCatalog.ts            # reconciliação das 3 fontes do menu /
├── ipc.ts                       # CHAT_CHANNELS + payloads
└── t3/                          # lógica adaptada do T3 Code (cabeçalho MIT)
src/shared/trustDialog.ts, cliInputBox.ts      # corrigidos (Fase 1)

src/main/chat/
├── chat-hub.ts                  # orquestra por ptyId
├── transcript-follower.ts       # adiante (offset)
├── transcript-pager.ts          # para trás (blocos)
├── subagent-tracker.ts
├── command-catalog-scanner.ts   # disco + skill_listing
├── project-files.ts             # menu @
├── assets-protocol.ts           # donel-asset:
├── notifications.ts             # Notification do Electron
├── diagnostics-log.ts
└── chat-ipc.ts                  # registerChatIpcHandlers
src/main/hook-bridge.ts          # servidor /h/<Evento> + token + segurar resposta
src/main/hooks-settings.ts       # passa a gerar o --settings por sessão
src/main/session-semaphore-manager.ts, semaphore-state-machine.ts, transcript-watcher.ts  # re-apontar
src/main/pty-manager.ts          # ambiente garantido
src/shared/commandBuilder.ts     # --permission-mode explícito
src/main/config-store.ts, src/shared/config.ts # chat.enabled, chat.focusMode
src/main/index.ts                # fiação, guarda de navegação, protocolo

src/renderer/src/chat/
├── ChatView.tsx, ChatStore.ts, useChatSession.ts
├── Timeline.tsx, scrollController.ts
├── rows/ (UserMessage, AssistantMessage, Thinking, ActionRow, ActionGroup,
│          SkillBadge, SubagentRow, QuestionRow, PlanRow, ShellRow, Notice, Unknown).tsx
├── markdown/ (Markdown.tsx, CodeBlock.tsx, shiki.ts, DiffView.tsx)
├── composer/ (Composer.tsx, CommandMenu.tsx, Attachments.tsx, history.ts)
├── pending/ (PendingPanel.tsx, QuestionCard.tsx, PermissionCard.tsx, PlanCard.tsx)
├── WorkingFooter.tsx, TerminalNeededBanner.tsx, ReceptionBanner.tsx, SessionEndedBar.tsx
├── SubagentStrip.tsx, SubagentPanel.tsx
├── sendDriver.ts
└── vendor/t3code/LICENSE
src/renderer/src/TerminalPane.tsx    # handle: write/readScreen/onScreenUpdate/respawn; tamanho oculto
src/renderer/src/App.tsx             # vista por aba, atalho, montagem do chat, Esteira → driver
src/renderer/index.html              # CSP
design-system/src/                   # TextArea (auto-crescente), Menu/Popover (listbox), Banner

tests/
├── chat-*.test.ts                   # vitest
├── hook-bridge.contract.test.ts
├── fixtures/chat/                   # JSONL sintéticos por versão + telas capturadas + gerador grande
├── smoke/fixtures/fake-claude-chat/ # CLI falso roteirizado (padrão do fake-claude-login)
└── smoke/chat-*.spec.ts
```

**Decisão de estrutura**: segue o padrão do repo.

- Lógica pura em `src/shared/`, I/O no main e UI em `src/renderer/src/`.
- Componentes genéricos que faltam (área de texto que cresce, menu/listbox,
  faixa) vão para o `design-system/`, que é espelhado.
- O código do chat fica em pastas próprias (`chat/`) para não inchar o
  `index.ts` (2.300+ linhas) nem o `App.tsx`.

## Re-check do gate (pós-desenho)

O desenho da Fase 1 em diante mantém as regras da tabela do gate:

- nada toca credencial;
- a única escrita do app em configuração é o `--settings` da própria sessão;
- o transcript nunca é lido inteiro;
- decisão pura com testes;
- UI em pt-BR.

**Passa.** As decisões do dono de 07/10 já estão incorporadas: Claude Design
na Fase 0, Fase 1 em paralelo, AS 2.2 e SC-008.
