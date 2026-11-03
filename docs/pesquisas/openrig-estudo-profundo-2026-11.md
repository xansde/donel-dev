# OpenRig — estudo profundo: papéis, conexões e multitarefa (03/11/2026)

Item 11 do [PDA mindscape-openrig](../planos/mindscape-openrig.pda.md). Sucede a
[pesquisa rasa](openrig-referencia-mindscape-2026-11.md), que deixou papéis, conexões e trabalho
entre sessões para "depois". Pedido do dono (03/11): "as conexões de sessões, o multitasking, os
papéis de sessões, etc. É um material de OURO para nos basearmos, com o layout do donel dev".
Duas lentes acrescentadas a pedido do dono no mesmo dia: CLI, TUI e MCP como requisito ("Espero
que as ideias de CLI, TUI e MCP do openrig se mantenham", seções 5.2–5.5 e 6.1) e a esteira
montada no Mindscape, item 15 do PDA (seção 9).

**Fonte lida:** clone raso de `github.com/mvschwarz/openrig`, commit
`c9b1ae480f9551a1e4ba731cfbaa2a314a80ef96` (03/11/2026), versão `0.7.1` no `package.json`. Os
documentos `docs/as-built/*` dizem ter sido conferidos contra o commit `e8f0ab34` (0.6.7, 08/10).
Nada do clone foi executado. Caminhos abaixo são relativos à raiz do OpenRig; o que é **inferência
minha** está marcado assim.

## Resumo

1. O **seat** é o conceito que mais importa: um endereço estável (`dev-build@starter`) com papel,
   motor e regras; a conversa dentro dele (o *occupant*) troca em compactação, handover e restore,
   e o estado (atividade, fila, histórico) fica preso ao seat, não à conversa.
2. O **papel** é um AgentSpec (YAML) que aponta para arquivos Markdown de orientação, skills,
   plugins e motor padrão; o RigSpec escolhe motor, modelo, esforço e permissão por seat. Tudo é
   entregue em camadas aditivas a cada lançamento, retomada e handover, por isso sobrevive à
   troca de conversa.
3. A **edge (ligação) quase não faz nada no runtime**: só `delegates_to`/`spawned_by` ordenam o
   lançamento e `delegates_to`/`escalates_to` dizem para quem escalar trabalho não assumido. Não
   rotear mensagem, não dá permissão. O resto é intenção desenhada e informação que o agente lê
   (`rig whoami`). O próprio doc chama isso de "aspiracional".
4. **Mensagem** = colar no terminal com um envelope `From/To/---/corpo/---/↩ Reply`, depois de
   checar que o alvo não está num prompt de permissão e (se o seat pedir) que o humano não tem
   rascunho na caixa. **Trabalho** = linha durável numa fila (SQLite) + um "wake" curto colado no
   terminal que só aponta para a linha. A linha carrega a obrigação uma vez; o wake pode repetir.
5. **Multitarefa** = um seat líder (a raiz das `delegates_to`) fala com a pessoa e reparte; os
   outros pegam linhas da fila, passam adiante (`handoff`) e escalam. O humano vê um feed de
   atenção (decisões primeiro) com verbos (aprovar, negar, rotear, segurar, descartar, responder)
   e o grafo animado.
6. Para o Donel Dev, o que vale trazer já: **post-it de sessão como lugar** (id estável acima do
   `claudeSessionId`, e que pode existir antes de ter conversa), **papel como arquivo + injeção
   pelo app**, **ligação com tipo que o agente enxerga**, e **mandar mensagem entre sessões pelo
   MCP do app sem digitar sobre o rascunho do dono**. A fila durável e o feed com verbos vêm
   depois. tmux, daemon, YAML escrito à mão, chatroom, rosters e startup proof não vêm.
7. **Três portas para o mesmo time** (requisito do dono, 03/11): no OpenRig, CLI `rig` (~91
   comandos, saída humana ou `--json`), TUI (bare `rig`, roda em qualquer terminal, com socket
   de controle) e servidor MCP (37 ferramentas `rig_*`, stdio ou HTTP com token) são clientes da
   mesma API do daemon. No Donel Dev: uma API local no main com três caras, **MCP `donel`**
   (expandir o que já existe com `navegador_*`), **CLI `donel`** (a porta mais agnóstica: qualquer
   motor com shell usa) e **TUI `donel tui`** (inclusive remota, só com token). Seção 5.2–5.5.
8. **Esteira montada no Mindscape** (item 15, próximo passo): o OpenRig separa o time (RigSpec,
   seats e edges declarados) do fluxo (workflow spec: passos com papel, saídas
   `handoff/waiting/done/failed`, caminho por saída, `depends_on` para fan-out/fan-in, gate
   humano, teto de laço). **A saída que decide o caminho é um enum declarado pelo agente com
   ponteiro de evidência, nunca a leitura da prosa.** O Donel Dev já tem metade disso (store de
   fatos, contrato `result.json`, guardas do disparo, grafo canônico e spec do motor da 012);
   falta o molde desenhado no quadro e o motor andar sobre ele. Seção 9.

---

## 1. Modelo mental

| Conceito | O que é | Exemplo real no repo |
|---|---|---|
| **Rig** | Um time de agentes declarado num `rig.yaml` (RigSpec `version: "0.2"`), com pods, edges, cultura e políticas. Vira registro no SQLite do daemon e sessões tmux. | `packages/daemon/specs/rigs/launch/starter/rig.yaml`: "A Claude Code builder and a Codex reviewer in your repository." |
| **Pod** | Grupo de seats com contexto compartilhado (camada de startup própria, edges internas). Na UI, moldura tracejada. Tem `continuity_policy`, mas "nothing acts on" ela hoje. | No starter, um pod só: `id: dev`, `label: Project`. No `factory`: pods `orch`, `dev`, `review`. |
| **Seat** (membro/nó) | O lugar estável dentro do pod. Id lógico `pod.member` (`dev.build`), endereço de sessão `pod-member@rig` (`dev-build@starter`). Guarda motor, modelo, esforço, permissão, cwd, papel, política de restore e de compactação. | `members: - id: build, agent_ref: local:../../../agents/development/implementer, runtime: claude-code` |
| **Occupant** | A conversa/processo que ocupa o seat agora. Troca em handover, compactação gerida, restore. "A handover or generation swap is its own visible event — never an activity transition." | `docs/reference/agent-state-taxonomy.md`, seção "Seat-keyed". |
| **Edge** | Relação dirigida entre dois seats: `delegates_to`, `spawned_by`, `can_observe`, `collaborates_with`, `escalates_to`. Pode ser interna ao pod ou entre pods (`pod.member`). | Starter: `delegates_to` de `build` para `review`. Factory: `orch.lead` delega a todos; `review.r1` `can_observe` `dev.build`. |
| **AgentSpec** | O "papel" reutilizável: `agent.yaml` com motor padrão, perfis (skills, plugins, recursos de runtime), arquivos de orientação e startup. | `agents/development/qa/agent.yaml`: `defaults.runtime: codex`, skills `[development-team, systematic-debugging, verification-before-completion, agent-browser, dogfood]`, `startup.files: guidance/role.md (send_text, required)`. |
| **Culture** (`CULTURE.md`) | A "constituição" do time, entregue a todos os seats depois de um `CULTURE-default.md` do próprio OpenRig. Diz como receber trabalho, como passar adiante, limites. | Starter: "Hand off through `rig queue handoff` … Do not use chat text as the work record." |
| **Queue / qitem** | Trabalho durável com dono: `pending · in-progress · done · blocked · failed · denied · canceled · handed-off`, com motivo de fechamento obrigatório. | `docs/as-built/architecture/coordination-primitive.md` §1 e §3. |
| **Mission / slice** | Pastas de trabalho de produto no workspace do OpenRig (`missions/<m>/slices/<s>`), indexadas só para leitura. Linhas da fila são marcadas `slice:<id>` / `project:<id>`. | `docs/as-built/architecture/workspace-primitive.md` §4; o líder do starter cria "one mission, one slice, then work" (`starter/guidance/lead-first-move.md`). |
| **Kernel** | Um rig sempre ligado, de "classe única": `advisor.lead` (pilota a intenção da pessoa), `operator.agent` + `operator.human` (terminal com a TUI), `queue.worker` (classifica o fluxo em fila). | `packages/daemon/specs/rigs/launch/kernel/rig.yaml`. |

Equivalente mais curto para o Donel Dev **[inferência]**: rig ≈ o Mindscape de um projeto;
pod ≈ moldura (item 06); seat ≈ post-it de sessão tratado como lugar; occupant ≈ o
`claudeSessionId` da vez; AgentSpec ≈ papel (item 12); edge ≈ ligação (item 13); mission/slice ≈
Esteira/PDA (já existem no Donel Dev).

## 2. Papéis de sessão

### Como se define

- **Duas camadas de autoria.** O AgentSpec (`agent.yaml`) é o papel reutilizável: descrição,
  `defaults.runtime`, `profiles.<nome>.uses` (skills, guidance, subagents, plugins,
  runtime_resources), `resources.guidance` e `startup.files`. O RigSpec escolhe, por seat,
  `agent_ref`, `profile`, `runtime`, `model`, `effort`, `cwd`, `permission_policy`,
  `restore_policy`, `compaction_strategy`, `role` (rótulo livre) e overlays de startup
  (`docs/as-built/architecture/agent-spec-and-startup.md` §1; `docs/reference/rig-spec.md`,
  tabela de membros).
- **O mesmo papel em motores diferentes.** No `factory`, o mesmo `independent-reviewer` ocupa
  `r1` com `claude-code` e `r2` com `codex`. O papel é texto + skills; o motor é escolha do seat.
- **O texto do papel é Markdown curto.** `agents/development/qa/guidance/role.md`: "Verify the
  assigned user outcome against its actual contract … When independent QA is selected, the
  evaluator must not be the author." Inclui como começar (`rig whoami --json`, ler a fila) e
  regras práticas para não travar a pessoa com pedidos de permissão.
- **Rótulo de papel na UI.** O cartão pinta o cabeçalho escuro quando `role` é `architect`,
  `lead` ou `orchestrator` (`isCoreRole`, `packages/ui/src/components/topology/HybridTopologyNodes.tsx`).

### O que carrega e como chega ao agente

Camadas aditivas, sempre nesta ordem, sem deduplicar
(`docs/reference/agent-startup-guide.md` "The Layering Model";
`startup-resolver.ts:15–22` citado no as-built):

1. agente (AgentSpec) · 2. perfil · 3. cultura (`CULTURE-default.md` do OpenRig, depois o
`CULTURE.md` do rig) · 4. rig · 5. pod · 6. membro · 7. operador (`openrig-start.md` e, em
lançamento novo, o pacote de onboarding).

Três jeitos de entregar (`agent-startup-guide.md`, "Delivery Mechanisms"):

| `delivery_hint` | Quando | Como |
|---|---|---|
| `guidance_merge` | antes do motor subir | bloco gerido dentro do `CLAUDE.md` (ou `CLAUDE.local.md`) / `AGENTS.md` **do repositório** |
| `skill_install` | antes do motor subir | copia para a pasta de skills do motor |
| `send_text` | depois que o motor está pronto | colado no terminal como mensagem; no lançamento novo vai num turno só junto com a mensagem de identidade (rig, pod, membro, id lógico) |

Para Claude há ainda campos por seat que entram na linha de comando: `append_system_prompt_file`
(vira `--append-system-prompt-file`), `agent_file` (vira `--agent openrig:<nome>`),
`plugin_dirs` (via `CLAUDE_CODE_PLUGIN_DIRS`) e `claude_mcp: none` (`rig-spec.md`, tabela de
membros).

### Como sobrevive à troca de conversa

- **O orquestrador de startup grava o contexto de replay** (`node_startup_context`: arquivos
  resolvidos, ações, runtime) e o token de retomada do motor
  (`startup-orchestrator.ts:282`, `:313`, citados em `agent-spec-and-startup.md` §4). Restore e
  handover reaplicam o papel a partir disso.
- **Retomada, fork e rebuild** reenviam as ações `after_ready` aplicáveis antes do primeiro
  `send_text`. Ações não idempotentes não rodam em restore ("retry-as-restore safety").
- **Handover** (`rig seat handover <seat> --source fresh|rebuild|fork:<seat>`) respawna o mesmo
  pane com o mesmo nome de sessão; `fresh` entrega um "restore packet" montado pelo daemon,
  `rebuild` prepara a partir da cadeia durável do seat
  (`docs/as-built/architecture/lifecycle-snapshot-restore.md`, "Single-seat recovery and handover").
- **Compactação gerida** (`compaction_strategy: managed-compaction`, só Claude): antes do
  `/compact` o seat escreve um `RESTORE-MAP.md` em `<cwd>/.openrig/compaction/preparation/` e,
  depois, recebe um pedido de restauração que aponta para ele
  (`agent-startup-guide.md`, "Claude compaction preparation directory"). Outras estratégias:
  `handover`, `apprentice-handover` (com um `mechanic` que conduz).
- **Refocus channel**: hooks `UserPromptSubmit`, `Stop` e `PostCompact` do plugin `openrig-core`
  reentregam orientação a um seat **em execução** quando ela é devida, porque "editing a file is
  not delivery" (`docs/reference/refocus-channel.md`).
- **"Salvo × rodando" é explícito.** Mudar modelo, esforço, permissão ou cwd de um seat vale "na
  próxima continuação gerida"; a UI mostra o configurado ao lado do observado e diz `UNKNOWN`
  quando não sabe (`agent-startup-guide.md`, "What a seat is set to, and what it's running").

**Lição para o Donel Dev [inferência]:** o papel sobrevive porque **o dono do processo reinjeta
o papel em todo lançamento**, não porque o modelo "lembra". O Donel Dev já é dono do comando
(CommandBuilder) e da renovação em voo (item 07); basta o papel morar no app e entrar em todo
`spawn`/`--resume`/renovação.

## 3. Conexões

### O que uma edge faz no código

Fonte: `docs/reference/edge-types.md` (fonte de verdade declarada:
`rigspec-schema.ts`, `rigspec-instantiator.ts`, `queue-owner.ts`, `escalation-owner.ts`).

| Tipo | Efeito de runtime | Intenção desenhada |
|---|---|---|
| `delegates_to` | **sim**: a origem sobe antes do destino; a origem é o "orquestrador" do destino na fila (escalação de linha não assumida, achados de linha travada) | quem dá trabalho a quem |
| `spawned_by` | **sim**: o pai sobe antes do filho | quem criou quem |
| `escalates_to` | **sim**: destino de escalação quando o seat não tem pai `delegates_to`; um salto só | quem sobe problema para quem |
| `can_observe` | não | quem acompanha a saída de quem (revisor ↔ implementador) |
| `collaborates_with` | não | pares |

E o que ela **não** faz, nas palavras do doc: "Route messages — `rig send` can target any session,
regardless of edges"; "Enforce delegation"; "Control permissions — there's no edge-based access
control"; "Affect transport". "These are aspirational capabilities. The edge vocabulary is
intentionally richer than the current runtime behavior so that the topology captures design intent
even before the runtime enforces it."

A edge também chega ao agente: `rig whoami --json` traz `edges.outgoing`/`edges.incoming` com o
tipo e a identidade do vizinho, e `peers[]` (o resto do rig, sem filtro)
(`packages/daemon/src/domain/whoami-service.ts:30–48`, `:286–291`). A ferramenta MCP `rig_team`
devolve o líder ("the rig's one delegates_to root") e, por seat, `reportsTo`/`delegatesTo`
(`packages/cli/src/mcp-server.ts:1514`). O layout do grafo usa só `delegates_to`/`spawned_by` como
hierarquia (`HIERARCHY_EDGE_KINDS`, `packages/ui/src/lib/graph-layout.ts:47`).

### Mensagem: `rig send` / `broadcast` ponta a ponta

Fonte: `docs/as-built/architecture/transport-and-transcripts.md` §3 e
`docs/reference/seat-delivery.md`.

1. **Resolver o destino** pelo nome de sessão (404 se não existe, 409 se ambíguo). `broadcast`
   resolve pod, rig, lista ou "topologia" e manda a cada um em sequência.
2. **Pegar o lease do seat**: toda escrita no terminal passa por um lease serializado por seat.
3. **Guarda de digitação** (`typing guard`), por seat, seis modos: `off` (padrão), `draft-aware`
   (só cola numa caixa reconhecidamente vazia e reconfere antes do Enter), `openrig-urgent`,
   `urgent-only`, `sends-only` (padrão de seat-terminal) e `hold` (nunca digita). Mensagem retida
   devolve `outcome: "retained"`, guarda o texto (até 100 mensagens / 8 MiB por seat) e **não
   tenta de novo sozinha**; o remetente é avisado e o humano lê com `rig seat held-messages`.
4. **Prontidão do alvo**: se o alvo está num prompt interativo (`needs_input`, ex. pedido de
   permissão), recusa com `target_needs_input`, salvo `--dangerously-interact --reason` (que
   grava auditoria). Alvo trabalhando ou desconhecido: manda com aviso.
5. **Colar em dois passos**: `paste-buffer -d -r -p` (bracketed paste) no pane registrado, espera
   ~200 ms, `Enter` separado. "A successful paste proves transport execution, not runtime
   consumption."
6. **Opcional `--verify`**: compara capturas antes/depois; resultado `delivered`,
   `rendered-unconfirmed`, `failed` ou `retained`.

O texto que chega ao terminal (`packages/cli/src/commands/send.ts:84–98`):

```
From: dev-build@starter
To: dev-review@starter
Sent: 11-03 14:05Z · gen 1a2b3c4d
---
<corpo>
---
↩ Reply: rig send dev-build@starter "..."
```

`To:` vira `broadcast to <rig> (N seats)` num broadcast. Remetente sem identidade sai como
`<unknown sender>` em vez de recusar.

**Detalhe de comportamento** (`seat-delivery.md`): mensagem para um seat Codex ocupado "joins its
running turn and may redirect it. For separate work, create a queue row instead."

### Trabalho: fila, inbox, handoff

Fonte: `coordination-primitive.md`, `mission-control.md`,
`packages/daemon/src/domain/queue-wake-ladder.ts` (cabeçalho), `queue-nudge-text.ts`.

- **Linha da fila** (`queue_items`): destino, origem, resumo, corpo (arquivo), estado, prioridade/
  tier, e no fechamento um `closure_reason` obrigatório (`handed_off_to`, `denied`, `canceled`,
  `no-follow-on`, `escalation`, `superseded`). É o "hot-potato contract": trabalho não some, ou
  termina com motivo ou passa para alguém. Log de transições só cresce.
- **Wake** = ponteiro curto colado no terminal do destino, nunca o corpo:
  `Queue handoff: <qitem-id> - check your queue. Summary: <até 120 caracteres>`, dentro do mesmo
  envelope From/To. O resumo é saneado para não forjar linhas do envelope.
- **Invariante declarado**: "THE ROW CARRIES THE OBLIGATION EXACTLY-ONCE; THE WAKE IS
  AT-LEAST-ONCE." Wake que falha sobe uma escada: novas tentativas → orquestrador do destino (via
  `delegates_to`) → superfície do operador; cada degrau é uma transição gravada.
- **Claim ≠ leitura**: "A claim shows the seat took the item; it does not prove the body was read."
  O recibo de pickup é derivado: `unclaimed · working · needs-input · stalled-after-claim · parked
  · terminal`.
- **Handoff**: fecha a origem como `handed-off` e cria a linha nova do destino na mesma transação.
- **Block**: `rig queue block <id> --on <outro>` estaciona a linha esperando outra; ela volta a
  `pending` (com wake) quando a outra fecha.
- **Inbox**: depósito assíncrono idempotente (`drop`), que o destino `absorb` (vira linha) ou
  `deny`.
- **Varredura de travados** (`queue-stuck-sweep.ts`): acha linha não entregue, não assumida,
  vencida ou sem custódia e cria um "finding" para o orquestrador.

### Chatroom

`rig chatroom send <rig>` grava em `chat_messages` (SQLite, por rig) e transmite por SSE; MCP
`rig_chatroom_send`/`rig_chatroom_watch`. Na UI web existe um `RigChatPanel`, **mas nenhuma tela o
monta** (`transport-and-transcripts.md` §5). Sem canais entre rigs nem DMs.

### Como a mensagem entra sem atropelar o humano

Resumo das defesas, todas do OpenRig:

- recusa colar em prompt de permissão/pergunta (`target_needs_input`);
- modo `draft-aware`: lê a caixa de entrada sob o lease; se há texto digitado (autor
  desconhecido), retém; confere de novo imediatamente antes do Enter; edição humana depois da
  colagem bloqueia o Enter;
- modos `urgent-only`/`hold` para quem não quer ser interrompido;
- lembretes do próprio OpenRig esperam 5 minutos de estado parado antes de cutucar um seat que
  acabou de passar trabalho ou de perguntar algo a uma pessoa (`seat-delivery.md`, "Watchdog
  reminders");
- o wake não carrega o trabalho, então repetir o wake não duplica a obrigação.

Limite que eles assumem: a leitura é por captura de tela do tmux, "human typing can still race the
capture and paste".

**Vantagem do Donel Dev [inferência]:** o app é dono do `xterm` e do compositor do chat, então
**sabe** quando o dono está digitando (teclas passam pelo app) e já lê a caixa do CLI
(`src/shared/chat/sendMachine.ts` com `readInputText`/`leftover`, bracketed paste, sinal de
aceitação pelo hook `UserPromptSubmit`). A guarda de digitação aqui pode ser mais forte que a do
OpenRig sem raspar tela.

## 4. Multitarefa

### Quem orquestra

- **O líder do rig** é a raiz das `delegates_to` (ninguém delega a ele). É quem fala com a
  pessoa: recebe o objetivo como linha da fila vinda do operador do kernel, assume, cria
  mission/slice se for trabalho contínuo, faz, e pede revisão a quem ele delega
  (`starter/guidance/lead-first-move.md`).
- **Regras do líder que valem copiar**: "Don't answer another seat's prompt yourself" (se um seat
  parou num pedido de permissão, avisar a pessoa qual seat e como chegar nele); não rodar `rig
  down`/`seat stop` sem a pessoa pedir; pergunta ou exploração não vira mission.
- **Kernel**: o `advisor.lead` pilota a intenção da pessoa e delega ao `operator.agent` (que opera
  o próprio OpenRig) e ao `queue.worker` (que classifica o fluxo em fila); o worker escala ao
  advisor; o operador colabora com o seat humano (`operator.human`, um terminal rodando `rig tui`)
  e escala para ele (`kernel/rig.yaml`).
- **Sem orquestrador central de verdade** **[inferência]**: o daemon não decide nada de conteúdo;
  ele guarda fila, entrega wakes, varre travados e escala. Quem decide são os agentes (pelo
  papel) e a pessoa (pelos verbos).

### Estados que o humano vê

Fonte: `docs/reference/agent-state-taxonomy.md`.

- Três eixos que não se misturam: sessão (`present · detached · exited · absent`), atividade
  (`working · idle-at-prompt · unknown`), retomabilidade (`live · resumable · context-walled`).
  **Hoje só a atividade é servida**; os outros dois estão declarados e nenhuma superfície lê.
- "Precisa de você" é **contagem + motivo** (`permission prompt`, `usage limit`, `classifier
  hold`), nunca estado.
- Diagnósticos derivados na leitura:
  - **PARKED** = (parado OU com pedido pendente) × (obrigação aberta na fila OU HELD doente).
    Atividade desconhecida dá `indeterminate`, nunca "parked".
  - **HELD** = parada deliberada, com dono e wake armado.
  - **DONE-UNSEEN** = terminou e ninguém viu (só declarado; nenhuma superfície calcula).
- Escada de evidência para atividade: auto-relato do Claude (`sessions/<pid>.json`) > hooks >
  prompt visível na tela (só para needs-input) > amostragem de janela. Raspagem de tela como
  verdade primária foi **rejeitada**.

### Mission Control / For You (o que o humano faz)

Fonte: `docs/as-built/architecture/mission-control.md`, `docs/as-built/ui/project-and-for-you.md`.

- Sete vistas: `my-queue`, `human-gate`, `fleet`, `active-work`, `recent-ships`,
  `recently-active`, `recent-observations`; cada linha com 9 campos fixos (nome, fase, estado
  `active|idle|attention|blocked|degraded`, próxima ação, decisão humana pendente, custo de leitura,
  última atualização, confiança, link de evidência).
- Nove verbos, cada um uma transação com auditoria: `approve`, `deny`, `route`, `annotate`,
  `hold`, `drop`, `handoff`, `resolve` (destrava linha estacionada num humano, com a decisão no
  texto, e cutuca o dono da linha), `answer` (responde a uma pergunta feita à pessoa e devolve ao
  seat que perguntou).
- **Feed "For You"**: cinco tipos de cartão (`action-required`, `approval`, `shipped`,
  `progress`, `observation`), **faixa de decisão primeiro**, depois o resto do mais novo para o
  mais velho; controle "All activity / Highlights / Needs you"; cartões dispensáveis.
- Avisos para fora: ntfy ou webhook quando nasce uma linha `human-gate`; gateway de Slack para a
  pessoa (`<id>@external`).
- **A superfície principal hoje é o CLI/TUI**: "The web UI is experimental, in maintenance mode
  … the CLI is primary" (`docs/reference/developing.md`). A TUI é um "k9s for rigs" com Explorer
  (Topology · Specs · Scopes · Terminals · Needs-You · System) e se declara só
  "OBSERVE / NAVIGATE / DRIVE-STRUCTURE" (`packages/tui/README.md`). As paredes de terminais
  ficam no herdr/cmux.

**Leitura [inferência]:** no OpenRig o humano age por verbos sobre a fila e entra no terminal
quando precisa; o grafo é para olhar. No Donel Dev o Mindscape é onde o dono age (decisão do
casco, 31/10), então os verbos devem morar no quadro, não numa tela separada.

## 5. Superfícies: grafo web, CLI, TUI e MCP

O dono pediu (03/11): "Espero que as ideias de CLI, TUI e MCP do openrig se mantenham". As
quatro superfícies do OpenRig são clientes da **mesma API HTTP do daemon** (rotas em
`packages/daemon/src/routes/`); nenhuma guarda estado próprio. A TUI se descreve como "two
renderers, one projection" (`packages/tui/README.md`). Abaixo, uma por uma.

### 5.1 Grafo web: como desenha e o que se faz dele

Fonte: `docs/as-built/ui/topology.md`, `docs/DESIGN.md` e o código em
`packages/ui/src/components/topology/` e `packages/ui/src/lib/`. Lembrete: a UI web está "in
maintenance mode … the CLI is primary" (`docs/reference/developing.md`).

**Base**: React Flow (`@xyflow/react`). **Nós não são arrastáveis** (`nodesDraggable={false}` em
`RigGraph.tsx:548` e `HostMultiRigGraph.tsx:360`): o layout é automático. Diferença de fundo com o
Mindscape, onde a posição é do dono.

**Layout** (`lib/graph-layout.ts`): pods viram grupos; cartão 240×160; até 3 colunas por pod;
espaçamento 36/32; padding do pod 28 e 44 no topo (para o rótulo); hierarquia pelas edges
`delegates_to`/`spawned_by`. Vista de host junta vários rigs num canvas só, com ids prefixados
`rig::nó` (`lib/hybrid-layout.ts`).

**Cartão do agente** (`HybridAgentNode`, `HybridTopologyNodes.tsx`):

- cabeçalho com o nome e um ponto de atividade (escuro invertido para `lead`/`orchestrator`/
  `architect`);
- linha com o endereço da sessão;
- selo do motor + modelo (`RuntimeBadge`; marcas: Claude, Codex, Pi, OMP, Terminal, desconhecido);
- **% de contexto** grande (verde < 60, âmbar 60–80, vermelho ≥ 80; esmaecido se a leitura não é
  fresca) e **total de tokens** ao lado; `--` quando não sabe;
- borda vermelha se o startup falhou, âmbar se pede atenção;
- ações só no hover/foco: prévia do terminal e "abrir no cmux";
- `title` com sessão, atividade (com "stale"), motor e tokens.

**Anel de atividade** (`ActivityRing.tsx`): moldura a 4 px do cartão; `active` verde,
`needs_input` âmbar, `blocked` vermelho, `idle` sem anel; pulso lento; flash de origem/destino
quando trabalho passa. Base do estado (`getBaselineActivityState`, `lib/topology-activity.ts`):
startup falhou → blocked; atenção de startup ou hook `needs_input` → needs_input; terminal com
saída recente → active. **Trabalho na fila não acende "ativo"** ("non-inference contract"); vira um
indicador separado ("n queued").

**Moldura de pod** (`HybridPodGroupNode`): borda tracejada fina, fundo quase transparente, rótulo
minúsculo em mono no canto de cima + contagem de agentes. **Moldura de rig** (`RigGroupNode`):
marcas de registro nos cantos e pulso agregado de atividade.

**Ligações** (`lib/edge-styles.ts`): `smoothstep` com seta; `delegates_to` contínua 1,5;
`spawned_by` tracejada `6 3`; `can_observe` fina tracejada `4 2`; entre rigs cinza tracejada.

**Hot-potato** (`HotPotatoEdge.tsx` + `lib/topology-activity.ts`): eventos `queue.created`,
`queue.handed_off`, `queue.updated` (com alvo de fechamento), `qitem.fallback_routed` e
`inbox.*` viram um "pacote": traço tracejado que marcha da origem ao destino e uma bolinha que
percorre a curva em 1.100 ms (1.600 entre rigs), flash de 650 ms na origem e 900 ms no destino,
rastro de 3 s. **Se não existe edge declarada entre os dois, o app desenha uma edge temporária só
para a animação** (`applyHotPotatoEdges`). Com `prefers-reduced-motion`, só um ponto parado no
destino.

**Prévia do terminal** (`TerminalPreviewPopover.tsx`): vidro escuro portado para o `body`,
espelho estático 90×27 primeiro, clique liga ao vivo no mesmo tamanho; **teto global de 2
terminais vivos** (`MAX_LIVE_TERMINALS = 2`,
`components/terminal/live-terminal-registry.ts:19`).

**Três vistas dos mesmos dados**: Graph · Table · Terminal (grade, 12 cartões por padrão,
`SAFE_N`), e a árvore no Explorer. Clique em cartão (grafo, tabela ou árvore) leva à página do
seat. Há um "placement mode" para encaixar uma sessão descoberta num pod ou nó livre (adopt).

**Motion** (`DESIGN.md`): "Motion should explain state, not decorate" — pulso lento, flash de
handoff, pacote na edge; nada de piscar.

### 5.2 CLI `rig`

Fonte: `docs/as-built/cli-reference.md` (inventário tirado da árvore real do Commander,
`packages/cli/src/index.ts`).

- **Tamanho:** 90–91 comandos de topo, 410 objetos de comando, 1.304 opções. Rodar `rig` sem
  argumento num terminal abre a TUI (`packages/cli/src/front-door.ts`).
- **Transporte:** HTTP para o daemon local (`OPENRIG_URL`, padrão `http://127.0.0.1:7433`).
  Identidade do chamador: o CLI lê `OPENRIG_SESSION_NAME` do ambiente do seat e manda no header
  `X-OpenRig-Session`; o daemon grava como `transport:v1`, e o doc avisa que "it isn't an
  authentication" (`coordination-primitive.md` §5).
- **Saída:** tabela humana por padrão; `--json` por comando (sem schema único entre comandos);
  `--fields`, `--full`, `--summary` onde cabe. Comandos estruturais têm `--plan` (mostra, não
  grava). Criação aceita `--id` para repetir com segurança depois de resultado desconhecido.
- **É a porta principal dos agentes.** A cultura do starter manda o agente rodar `rig whoami
  --json`, `rig queue list --owned`, `rig queue handoff …` pela própria shell, "as they are: don't
  pipe their output into python3 … don't put $VARIABLES in them", para não disparar pedido de
  permissão (`starter/CULTURE.md`, "Commands that don't stop the person"). **[inferência]** o CLI
  é o que torna o OpenRig agnóstico de motor: qualquer agente com shell usa, com ou sem MCP.

Comandos que operam o time (linhas da tabela do `cli-reference.md`):

| Grupo | Comandos | O que fazem |
|---|---|---|
| Ver | `rig ps [--nodes] [--json] [--fields] [--active] [--rig]` | Rigs e seats com atividade, ciclo de vida, `needsAttention`; `--full` traz a evidência do needs-input |
| | `rig whoami [--json] [--all-peers]` | Quem sou, papel, pod, edges de entrada e saída, pares, workspace |
| | `rig capture [session] [--lines] [--readable]` | Lê a tela de um seat (ou de um pod/rig) |
| | `rig parked [seat]`, `rig health`, `rig doctor`, `rig telemetry`, `rig usage` | Diagnóstico: parado com obrigação, saúde, uso e custo |
| Falar | `rig send [session] [text] [--to] [--pod] [--rig] [--verify] [--wait-for-idle] [--urgent] [--dangerously-interact --reason]` | Mensagem com envelope, sob a guarda de digitação |
| | `rig broadcast [text] [--rig] [--pod]` | Mesma coisa para um pod ou rig |
| | `rig chatroom send/history/watch/topic/wait/clear` | Sala do rig |
| | `rig queue create/show/list/claim/update/block/handoff/handoff-and-complete/resolve` | Trabalho durável (seção 3) |
| Montar | `rig up <source> [--plan] [--seat member=runtime] [--existing] [--fresh]` | Sobe um rig de um spec, bundle ou link |
| | `rig down <rig> [--snapshot] [--delete]` | Derruba (com snapshot opcional) |
| | `rig grow <rig> <members…> [--pod] [--new-pod] [--runtime]`, `rig add`, `rig shrink`, `rig remove` | Muda o time vivo |
| | `rig edge add <rig> <from> <to> --kind [--plan]`, `rig edge remove` | Muda ligações do time vivo (idempotente) |
| | `rig discover [--draft]`, `rig bind`, `rig adopt <path> --bind logicalId=session` | Acha sessões que já estão rodando e as adota como seats |
| Continuidade | `rig snapshot`, `rig restore`, `rig seat handover`, `rig seat continue`, `rig compact` | Seção 2 |
| Seat | `rig seat status/set-typing-guard/held-messages/retire-held-message/set-terminal-policy/clear-attention` | Guarda de digitação e quem pode intervir |
| Fluxo | `rig workflow validate/instantiate/project/route/resume/abort/continue/trace` | Seção 9 |
| Portas | `rig tui`, `rig terminal open <view> [--window]`, `rig mcp [serve] [token add/list/revoke]` | As outras superfícies |

### 5.3 TUI

Fonte: `packages/tui/README.md`, `packages/tui/src/sections.ts`, `packages/tui/src/`.

- **O que é:** "k9s for rigs". Explorer à esquerda, conteúdo à direita, barra de comando no
  topo, rodapé com o fluxo do rig. Uma dependência de runtime (`yaml`); só lê projeções que o
  daemon já serve.
- **Seções** (`SECTION_REGISTRY`): Topology (host › rig › pod › agente), Specs (declarado ×
  quem consome), Scopes (projeto › mission › linhas de execução › slice), Terminals (vistas
  salvas e prévia passiva), **Needs** (pedidos humanos e atualizações entregues), System
  (saúde, config, conexões, uso por provedor, uso entre hosts, custo).
- **Navegação:** setas + Enter no Explorer; `F` liga o rodapé; `q` sai. Gramática da barra:
  `:<seção>` · `/<filtro>` · `host|rig|pod|agent|spec <nome>` ·
  `tab table|recent|overview|graph|health|topology|configuration|yaml|pulse` ·
  `spec-of <agente>` · `running <spec>`. `rig tui commands --json` lista o registro de comandos.
- **Socket de controle:** um socket Unix por instância (`$OPENRIG_HOME/run/tui-<id>.sock`), um
  comando por linha, uma resposta JSON por linha, mais `state` e `commands`. Teclado, mouse,
  barra e socket mudam o **mesmo** estado por um caminho só, então um agente dirige a mesma tela
  que o humano vê.
- **Limite declarado:** verbos só de OBSERVE / NAVIGATE / DRIVE-STRUCTURE; "ACT / PRODUCE /
  REVIEW-ARTIFACT surfaces live in Studio, not here". A exceção é o feed Needs, que responde
  perguntas feitas à pessoa (`answer`/`resolve`, `packages/tui/src/attention/attention-model.ts`;
  `mission-control.md` diz "The TUI's Feed sends it").
- **"Open terminals"** abre uma parede de terminais (herdr, cmux ou tmux) com a vista escolhida.
- **O que ela tem e o grafo web não [inferência pela comparação dos docs]:** roda em qualquer
  terminal (inclusive por ssh), desenha a topologia em texto (`packages/tui/src/topology/`), tem
  uso e custo por seat, consumidores de spec, linhas de execução de mission, e o socket de
  controle. É a superfície ativa; a web está em manutenção.

### 5.4 Servidor MCP

Fonte: `packages/cli/src/mcp-server.ts`, `packages/cli/src/mcp-http.ts`,
`packages/cli/src/commands/mcp.ts`, `docs/reference/hosted-members.md`.

- **Dois transportes:** `rig mcp` (stdio; o chamador é o seat do ambiente, "declared and not
  authenticated") e `rig mcp serve --http` (Streamable HTTP em `/mcp`). Sem arquivo de tokens o
  HTTP fica no loopback e trata o chamador como dono; com tokens, **toda** requisição precisa de
  bearer, "even on loopback: a tunnel or proxy delivers remote traffic to loopback, so loopback
  proves nothing about the caller". O arquivo guarda só o sha256 do token; cada requisição ganha
  um cliente próprio com o seat do grant, "so concurrent callers never share an identity".
- **Grants:** `rig mcp token add <nome> --seat <session> [--rig] [--root] [--workspace]
  [--owner]`; `list`; `revoke`. Classes de acesso por ferramenta: `work` (laço de trabalho,
  orientação, falar com seats do escopo), `workspace` (ler árvore de trabalho e contexto),
  `owner` (subir, derrubar, snapshot, descobrir, adotar). Grant externo (`openrig.grant/v1`) é
  ainda mais estreito. O chamador local (stdio) é dono.
- **Anotações** `read` / `additive` / `destructive` em toda ferramenta, "hints … not
  enforcement", e uma tabela `MCP_OPERATIONS` (ferramenta → rotas → efeito → classe) que os
  testes de contrato conferem contra o que está registrado.
- **Instruções versionadas** no próprio servidor (`MEMBER_WORKFLOW_VERSION =
  "member-workflow/v2"`): como trabalhar a caixa de entrada, "A wake, a ring or a message only
  points at it", não fechar item que precisa de aprovação humana.
- **37 ferramentas** registradas (contagem de `if (offered("` neste commit; o as-built de
  outubro ainda diz 24):

| Grupo | Ferramentas | Classe |
|---|---|---|
| Ver o time | `rig_ps`, `rig_status`, `rig_rig_nodes`, `rig_whoami`, `rig_team`, `rig_capture` | work |
| Falar | `rig_send` (destrutiva: digita num agente), `rig_chatroom_send`, `rig_chatroom_watch` | work |
| Trabalho | `rig_queue_create/show/list/claim/update/handoff/unclaim/decide`, `rig_human_decision_room`, `rig_artifact_read`, `rig_environment_export` | work |
| Contexto | `rig_slices`, `rig_mission`, `rig_context_pack`, `rig_context_get` | workspace |
| Administrar | `rig_up`, `rig_down`, `rig_add`, `rig_snapshot_create/list`, `rig_restore`, `rig_restore_status`, `rig_discover`, `rig_bind`, `rig_bundle_inspect`, `rig_agent_validate`, `rig_rig_validate`, `rig_telemetry_events` | owner |

- **Quem usa:** principalmente **membros hospedados** (assistentes na nuvem, sem shell nem
  pane, "It never gets a pane") e clientes MCP; os seats locais usam o CLI pela shell.
  **[inferência]** pelos `CULTURE.md` e `role.md`, que só citam comandos `rig …`.

### 5.5 O desenho comum

- Uma API (rotas do daemon) e quatro clientes finos: web, CLI, TUI, MCP.
- Identidade vem do transporte (env do seat, header, token), nunca do corpo da requisição; o que
  não dá para provar é gravado como "declarado" (`claimed:v1`), não como fato.
- Toda escrita estrutural tem ensaio (`--plan`) e repetição segura (`--id`, idempotência).
- O mesmo vocabulário em todas: `rig send` ↔ `rig_send`, `rig queue handoff` ↔
  `rig_queue_handoff`, `:needs` ↔ feed Needs.

## 6. Mapa para o Donel Dev

Restrições: Windows nativo, sem tmux; nada preso a uma IA; o app já é dono dos PTYs; tela
principal = Mindscape; UI em pt-BR sem "Claude" em rótulo de recurso.

| OpenRig | Donel Dev hoje | Falta | Decisão |
|---|---|---|---|
| **Seat** (lugar estável; occupant troca) | Post-it de sessão chaveado por `claudeSessionId` (`session:<id>`, `src/shared/mindscape/model.ts`); adormecido e retomar (fatia 31/10) | Id de lugar acima da conversa: o post-it aponta para a sessão da vez e guarda as anteriores, **e pode existir sem conversa ainda** (o OpenRig trata nó sem sessão como seat: "A node is a seat whether or not it has a session yet", `mcp-server.ts`, `rig_team`). Sem isso, renovação em voo (07), papel (12), ligação (13) e as estações pré-determinadas da esteira (15) não têm onde morar | **Trazer já**, como primeira fatia do 12 (ou dentro do 07). Sobe o `schemaVersion` |
| **AgentSpec / papel** | Launcher escolhe modelo, esforço e permissão; contas e provedores (011) escolhem o motor; não existe texto de papel | Papel = Markdown + preferências (motor, modelo, esforço, permissão); guardado pelo app; injetado em todo lançamento, retomada e renovação | **Trazer já** (item 12) |
| `guidance_merge` no `CLAUDE.md` do repo | — | — | **Não trazer**: escreve no repositório do dono, briga com outros agentes e com o git |
| `append_system_prompt_file` (Claude) / `send_text` (outros) | CommandBuilder monta o argv; chat sabe colar texto no CLI | Injeção por motor: flag de system prompt onde o motor aceita; primeira mensagem onde não | **Trazer já** |
| **Culture** do rig | `CLAUDE.md` do projeto já faz esse papel | "Regras do time" do quadro, curtas, para todas as sessões com papel | **Depois** (12c) |
| **Pod** + camada de startup do pod | Moldura de grupo planejada (06) | Orientação opcional da moldura | **Depois**: a moldura nasce visual (06); orientação entra quando houver times |
| **Edge com tipo** | Ligação = desenho (`MindscapeLink { from, to, arrow }`) | Tipo (delega, revisa, conversa, escala) e o agente enxergar suas ligações | **Trazer já** (13a) |
| Edge **sem** permissão nem roteamento | — | O dono pediu "quem pode mandar trabalho ou mensagem para quem" | **Divergir de propósito**: no Donel Dev a ligação **autoriza** mandar sem pedir OK; fora das ligações, a sessão pode pedir e o dono aprova. Barato porque o app é o único carteiro |
| `rig whoami` / `rig_team` | Servidor MCP `donel` por PTY com token próprio, já com as ferramentas `navegador_*` (`src/main/browser/browser-mcp-server.ts`, commit `973dcc0`, em `staging`; desenho em `docs/design/navegador-interno.md` D9) | Ferramenta `sessao_quem_sou`: meu papel, minhas ligações, estado dos vizinhos | **Trazer já** (13a). O token por PTY dá identidade de verdade, mais forte que o header do OpenRig ("isn't an authentication") |
| `rig send` + envelope + guarda de digitação | Máquina de envio do chat (`src/shared/chat/sendMachine.ts`): bracketed paste, leitura da caixa, sinal de aceitação, envio no meio do turno vai para a fila do CLI (memória `chat-envia-na-hora`) | `sessao_enviar(destino, texto)` no MCP e "mandar" pelo quadro; envelope "De/Para/Responder"; nunca escrever sobre rascunho do dono; mensagem retida visível no post-it | **Trazer já** (13b) |
| Recusa em prompt de permissão | Semáforo tem `permission` (`semaphore-state-machine.ts`) | Regra: não colar em sessão com pedido de permissão aberto; reter | **Trazer já** (13b) |
| `broadcast` | — | Mandar para todas as sessões de uma moldura | **Depois** (com molduras) |
| **Fila durável** (qitem, handoff, block, claim, escada de wake) | Nada; a Esteira tem fases, não fila entre sessões | Passar trabalho com corpo em arquivo, estados, assumir/terminar | **Depois** (13c). Antes, provar que mensagem simples resolve |
| Inbox `drop/absorb/deny` | — | — | **Não trazer** agora: fila + mensagem cobrem; inbox é para remetente externo assíncrono |
| **Chatroom** | Chat do app é por sessão (014) | — | **Não trazer**: o OpenRig nem monta o painel; o quadro é a sala |
| **Hot-potato** | Ligação com traço à mão (`roughjs`), estática | Animar a ligação quando passa mensagem ou trabalho; ligação temporária se não houver uma | **Trazer junto com 13b** |
| **Anel de atividade + 3 eixos + motivo** | Semáforo `working/waiting/permission/done`; adormecido; item 04 já planeja 3 eixos | — | Já coberto pelo **04**. Confirmar: fila não acende "trabalhando" |
| **PARKED / HELD / DONE-UNSEEN** | DONE-UNSEEN = destaque da V1; Organizar com "Precisa de você" | PARKED precisa de "obrigação aberta" (vem com 13c); antes disso, "parada com pendência" do 04 | 04 já cobre a versão sem fila; PARKED completo **depois** |
| **Mission Control / For You** com verbos | Aviso de sessão (Jobu/toast), selo da barra de tarefas, coluna "Precisa de você" do Organizar | Faixa de decisões no quadro com motivo e ação | **Depois** (14), como variante a escolher |
| **Líder** (raiz das `delegates_to`) | O dono orquestra | Papel "líder" opcional que conversa com o dono e reparte | **Depois** (14, variante C) |
| Prévia do terminal com teto | `PtyManager` guarda 50 linhas por PTY para hover-preview; item 05 | — | Já coberto pelo **05**; usar teto 2 como o OpenRig |
| Grade de terminais | — | — | Já em "Ainda não especificado" do PDA |
| Snapshot/restore do rig com resultado por nó | Item 09 | — | Já coberto pelo **09** |
| Handover / compactação gerida / restore map | B36 → item 07 | — | Já coberto pelo **07**; o "lugar estável" acima é o pré-requisito |
| Refocus channel (reentregar orientação a sessão viva) | Hooks pela ponte (`hook-bridge.ts`) | Avisar a sessão viva que o papel mudou | **Depois**; na V1 papel novo vale na próxima retomada, como o OpenRig faz com modelo e esforço |
| Startup proof (desafio-resposta) | — | — | **Não trazer**: custo alto, ganho pequeno para um dono só |
| Rosters, missions/slices, workspace | Esteira, PDA, specs | — | **Não trazer** |
| tmux, daemon, SQLite (96 migrações), YAML de topologia, adapters por runtime | node-pty/ConPTY, `userData/*.json`, quadro nasce do uso | — | **Não trazer** (já decidido no PDA, "Fora de escopo") |
| Worktrees por seat | `session-worktree-service.ts` | Papel "dev" pode nascer numa worktree própria | **Depois**: opção do papel, não regra |
| **Workflow spec** (passos, saídas, caminho por saída, `depends_on`, gate, teto de laço) | Grafo canônico e spec do motor da 012 (sem código); contrato `result.json` e store de fatos da 010 | Molde desenhado no quadro e motor andando sobre ele | **Próximo passo** (item 15), seção 9 |
| **Chain files** (`CRAFT.md`, `LEARNED.md` por altitude; `SPEC.md`, `PROOF.md`, `PROGRESS.md` por mission/slice) | `CLAUDE.md` do projeto, vault, artefatos da Esteira | — | **Depois**: a ideia de "um nome de arquivo por altitude, lido da folha à raiz" serve para papel → moldura → quadro (12c) |
| **CLI `rig`** | Nada; o app só é operável pela janela | CLI `donel` falando com o app aberto | **Trazer já** (requisito do dono), proposta em 6.1 |
| **TUI** | Nada | `donel tui` em qualquer terminal, inclusive remoto | **Depois**, mas requisito: a API da 6.1 nasce pronta para ela |
| **Servidor MCP `rig_*`** | MCP `donel` só com `navegador_*` | Ferramentas de sessão, quadro e esteira | **Trazer já**, junto com 13a/13b e o item 08 |
| Motores (Claude Code, Codex, Pi, OMP, terminal) | 011: classe A (compatível com Claude) lança; classe B (CLI de terceiro) é aceita e recusada no lançamento | — | O papel precisa ser neutro (Markdown) e cair para "primeira mensagem" quando o motor não aceitar flag. Classe B lançável é assunto da 011 |

### 6.1 As três portas no Donel Dev: MCP, CLI e TUI

Requisito do dono (03/11): as ideias de CLI, TUI e MCP do OpenRig se mantêm. Proposta **[minha,
a refinar]**, nas restrições do app (Windows nativo, sem tmux, sem dependência nova, nada preso a
uma IA, sem "Claude" em rótulo).

**Um núcleo, três caras.** As ações de sessão, quadro e esteira viram funções do main (puras
onde der, testadas com vitest), e o servidor HTTP local que já existe para o MCP ganha duas
famílias de rota com a mesma checagem de chamador:

- `/mcp` — JSON-RPC do MCP (o que já existe);
- `/api/…` — JSON simples para o CLI e a TUI.

O OpenRig faz igual: rotas do daemon e clientes finos. Aqui o "daemon" é o próprio main do
Electron; com o app fechado, nenhuma das três portas funciona **[decisão a confirmar com o dono;
alternativa é o CLI ler arquivos do `userData` só para leitura]**.

**Identidade do chamador** (mais forte que a do OpenRig, que é declarada):

| Quem chama | Como prova | Escopo |
|---|---|---|
| Agente dentro de uma aba do Donel (qualquer motor) | token de 128 bits **por PTY**, que o app já gera para o MCP; o app também põe `DONEL_SESSION_TOKEN` e a porta no ambiente da aba, para o CLI usar | O lugar (post-it) daquela aba: seu papel, suas ligações |
| Dono num terminal comum da máquina | token de dono num arquivo do `userData` com ACL só do usuário, e a porta num `cli-endpoint.json` ao lado | Tudo |
| Cliente remoto (TUI por Tailscale, outro PC) | desligado por padrão; liga com token próprio, revogável; o app recusa ouvir fora do loopback sem token (mesma regra do `assertBindAuthInvariant` do OpenRig, `mission-control.md` §4) | O que o token disser |

Nunca aceitar nome de sessão no corpo como identidade (lição do OpenRig: `claimed:v1` é só
declaração).

**MCP `donel` (trazer já).** Expandir o servidor de `src/main/browser/browser-mcp-server.ts`
(hoje: `navegador_abrir/ler/clicar/digitar/teclar/rolar/voltar/print/esperar/pedir_humano`) com:

| Grupo | Ferramentas propostas | Efeito | Fatia |
|---|---|---|---|
| Sessão | `sessao_quem_sou`, `sessao_listar`, `sessao_ver_tela` (últimas linhas, como `rig_capture`) | leitura | 13a |
| | `sessao_enviar(destino, texto)` | altera (digita noutra sessão) | 13b |
| | `sessao_passar_trabalho`, `sessao_ver_trabalho`, `sessao_concluir_trabalho` | acrescenta / altera | 13c |
| Quadro | `quadro_ler`, `quadro_criar_post_it`, `quadro_ligar`, `quadro_mover_para_moldura` | leitura / acrescenta | item 08 |
| Esteira | `esteira_estado`, `esteira_concluir_estacao(desfecho, rota, evidencia)`, `esteira_perguntar_ao_dono` | leitura / altera | 15b |

Com a tabela ferramenta → efeito → quem pode (papel, ligação, dono) conferida por teste de
contrato, as anotações MCP `readOnlyHint`/`destructiveHint` coerentes com ela, e um texto de
instruções versionado no `initialize` (como o `member-workflow/v2`). Sem "claude" em nome de
ferramenta.

**CLI `donel` (trazer já, mínima).** É a porta mais agnóstica: qualquer motor que roda comando
de shell usa, mesmo sem MCP (provedor classe B da 011, terminal livre, script do dono).

- Entrega: um `donel.cmd` + script Node empacotado com o app, rodando com
  `ELECTRON_RUN_AS_NODE=1` no Node do próprio Electron (sem instalar Node, sem dependência
  nova); "Adicionar ao PATH" nas configurações. Dentro das abas do Donel já vem no PATH.
- Saída: texto humano em pt-BR por padrão, `--json` em todo comando, códigos de saída estáveis.
- Comandos da primeira leva (espelham o MCP, mesmo vocabulário):
  `donel ps [--projeto] [--json]` (sessões com nome, papel, motor, estado nos 3 eixos, contexto,
  pendência), `donel quem-sou`, `donel ver <sessão> [--linhas N]`,
  `donel enviar <sessão> "texto"`, `donel abrir <projeto> [--papel] [--motor]`,
  `donel retomar <sessão>`. Depois: `donel quadro …`, `donel esteira …`, `donel trabalho …`.
- Escrita estrutural com `--ensaio` (o `--plan` do OpenRig).

**TUI `donel tui` (depois, requisito).** Para usar o Donel de dentro de qualquer terminal,
inclusive por ssh/Tailscale no outro PC.

- Lê só a API `/api/…`; nada próprio. Seções na linha do OpenRig, com o vocabulário do Donel:
  **Sessões** (tabela com estado, papel, motor, contexto), **Quadro** (projeto › moldura ›
  post-it, em árvore), **Precisa de você** (pendências com motivo, responder/ir), **Esteiras**
  (iniciativas, estação atual, caminho), **Sistema** (contas, RAM, saúde).
- Barra de comando com a mesma gramática do CLI (`:sessoes`, `/filtro`, `enviar …`).
- Controle por agente: no Windows não há socket Unix; o equivalente é a própria API HTTP com o
  token da aba (o OpenRig usa socket por instância). **[inferência]** desenhar à mão com ANSI,
  sem biblioteca, cabe na régua de dependência zero; o OpenRig mostra que dá com uma dependência
  só.
- Remota só com o token remoto da tabela acima.

## 7. Fatias propostas

Ordem sugerida: 12a → 13a → 13b + P1 → (14 protótipo em paralelo com 13b) → 15a → 12b → 15b →
13c → P2. Cada fatia termina no alfa com item em `patchnotes/notes.ts`. As fatias do 15 (esteira
montada no Mindscape) estão na seção 9.

### Item 12 — Papéis de sessão

**12a — O post-it de sessão vira lugar, e o lugar tem papel.**
- Modelo: o post-it de sessão ganha id próprio e uma lista de conversas (a atual + as anteriores).
  Renovação em voo, fork "no mesmo lugar" e retomar mudam a conversa, não o post-it. O lugar
  pode existir **sem conversa ainda** (um terceiro aspecto além de vivo e adormecido: "ainda não
  começou"), que é o que a esteira montada (15) precisa para as estações pré-determinadas. Sobe o
  `schemaVersion` (regra do `mindscape.json`).
- Papel: arquivo Markdown em `<userData>/papeis/<id>.md` com cabeçalho (nome, cor, motor, modelo,
  esforço, permissão sugeridos) e o texto da orientação. Store próprio, como o `mindscape.json`,
  para não depender do sanitizador do `config.json` nem de canal antigo.
- Injeção: o CommandBuilder põe a orientação em todo lançamento, retomada e renovação. Motor
  compatível com Claude: flag de system prompt anexo (o OpenRig usa
  `--append-system-prompt-file`; conferir no binário do CLI instalado). Outro motor: primeira
  mensagem, com o mesmo texto. **[inferência a provar num spike]** o system prompt anexo sobrevive
  ao `/compact` porque não faz parte da conversa compactada; e não sobrevive a um `--resume` sem a
  flag, por isso o app repassa sempre.
- Mensagem de identidade no primeiro turno, curta: "Você é <papel> neste quadro. Para saber com
  quem você trabalha, use sessao_quem_sou." (o OpenRig faz o equivalente com rig/pod/membro).
- **O dono vê:** no post-it, um selo com o nome do papel ("Revisor"); "Nova sessão com papel…" no
  menu do quadro e no Launcher; depois de retomar ou renovar, o selo continua e a sessão continua
  agindo como revisor.

**12b — Papéis prontos e edição.**
- Três papéis de fábrica, genéricos: **Dev** (faz a mudança e pede revisão), **Revisor**
  (confere o efeito prometido, não é autor; adaptado de `agents/development/qa/guidance/role.md`),
  **Pesquisa** (lê e resume, não altera código). Textos em pt-BR, sem nome de IA.
- Editar e criar papel numa tela simples (texto + preferências).
- Trocar o papel de um post-it vivo: grava já, vale na próxima retomada ou renovação; o post-it
  mostra "papel muda na próxima retomada" até lá (a tabela "salvo × rodando" do OpenRig).
- **O dono vê:** uma lista de papéis com os três prontos; ao trocar, o aviso de quando vale.

**12c — Camadas (depois).** Regras do quadro (como a cultura do rig) e orientação da moldura
(como o pod), somadas na ordem papel → quadro → moldura. Só quando houver molduras com time.

### Item 13 — Conexões com significado

**13a — Ligação com tipo, e a sessão sabe com quem está ligada.**
- A ligação ganha tipo: **delega a**, **revisa**, **conversa com**, **escala para** (os quatro do
  OpenRig que fazem sentido aqui; `spawned_by` fica implícito no fork). Traço por tipo, como o
  OpenRig: contínuo, tracejado curto, duplo sentido, seta para cima. Ligação sem tipo continua
  sendo desenho do dono.
- Ferramenta MCP `sessao_quem_sou` (servidor `donel`, item 03/08): papel, ligações de saída e de
  entrada com o tipo, nome, papel e estado (3 eixos do 04) de cada vizinho.
- **O dono vê:** ao ligar dois post-its de sessão, escolhe o tipo num menu curto; a ligação
  mostra o tipo ao passar o mouse; perguntar à sessão "com quem você trabalha?" dá a resposta
  certa.

**13b — Mandar mensagem entre sessões, sem atropelar o dono.**
- Ferramenta `sessao_enviar(destino, texto)` e o gesto no quadro (arrastar um post-it do dono
  sobre um post-it de sessão, ou "Mandar para…" no menu).
- Permissão: pela ligação. "Delega a", "conversa com" e "escala para" autorizam no sentido da
  ligação; "revisa" autoriza o revisor a devolver achados ao revisado. Fora disso, a chamada fica
  pendente e vira aviso de sessão para o dono aprovar. Decisão de propósito contra o OpenRig, que
  deixa qualquer um mandar para qualquer um.
- Entrega pela máquina de envio do chat, com envelope curto:
  `De: <nome> (<papel>) · Para: <nome> — <texto> — Responder: sessao_enviar("<nome>", "...")`.
- Guarda de digitação (padrão "atento ao rascunho"): se o dono está digitando no terminal ou no
  chat da sessão de destino, ou a caixa do CLI tem texto, a mensagem **fica retida**; com pedido
  de permissão aberto, também. A sessão de destino ocupada (trabalhando) recebe na fila do próprio
  CLI, como o chat já faz. Retida aparece no post-it ("1 mensagem esperando") e entra sozinha
  quando a caixa esvazia **[divergência: o OpenRig não tenta de novo; aqui o app sabe quando o
  dono parou de digitar, então pode]**.
- Hot-potato: a ligação anima da origem ao destino quando a mensagem entra; se não há ligação, um
  traço temporário aparece só durante a animação. Respeita "reduzir movimento".
- **O dono vê:** a mensagem chegando no terminal/chat da outra sessão com cabeçalho "De…", a
  ligação acendendo, e nunca uma frase dele misturada com a de outra sessão.

**13c — Passar trabalho com recibo (depois).**
- `sessao_passar_trabalho(destino, resumo, corpo)`: o corpo vai num arquivo do app; o terminal do
  destino recebe só o ponteiro curto ("Trabalho novo de <nome>: <resumo>. Leia com
  sessao_ver_trabalho(<id>)."). Estados: esperando · assumido · feito · devolvido · bloqueado;
  fechar exige motivo (regra do hot-potato).
- O post-it mostra "2 na fila"; parada + trabalho aberto = **parada com pendência** (o PARKED do
  OpenRig) no Organizar.
- **O dono vê:** uma pilha de trabalho por post-it, com quem mandou e em que pé está; nada some
  sem motivo.

### Item 14 — Multitarefa: três variantes para o protótipo

Todas no layout do Donel Dev: Mindscape como tela principal, barra lateral recessiva, abas de
terminal por baixo. Cenário único para as três: um quadro com **Dev**, **Revisor** e **Pesquisa**,
o Dev esperando permissão e o Revisor devolvendo um achado.

- **A — Quadro-mesa.** Tudo no quadro: molduras como times, anel de estado nos post-its, ligações
  animadas, prévia do terminal no hover (teto 2 vivas). Uma faixa fina no topo do quadro lista o
  que precisa do dono ("Dev pede permissão para rodar testes", "Revisor devolveu 1 achado") e
  leva ao post-it. **O dono vê:** um só lugar; age clicando no post-it.
- **B — Quadro + coluna de decisões.** Quadro à esquerda; à direita uma coluna no espírito do For
  You: decisões primeiro, depois progresso e entregas, com ações no próprio cartão (ir ao
  terminal, aprovar, responder, segurar, descartar). **O dono vê:** a lista do que fazer sem caçar
  no quadro; o quadro fica para entender quem faz o quê.
- **C — Líder.** Uma sessão com papel **Líder** conversa com o dono pelo chat e reparte o trabalho
  pelas ligações "delega a"; o dono fala com um só e o quadro mostra o time trabalhando; o líder
  avisa quando uma sessão para num pedido e nunca responde por ela (regra do
  `lead-first-move.md`). **O dono vê:** uma conversa, um time se mexendo no quadro, e avisos do
  líder quando precisa dele.

Primeira fatia de execução depois da escolha **[proposta]**: "time de dois" ponta a ponta, Dev
delega a Revisor, o Revisor devolve por `sessao_enviar`, o dono vê a ligação animar e o achado
chegar. É o `starter` do OpenRig sem fila.

### Portas — CLI, TUI e MCP (requisito, seção 6.1)

- **P1 — API local + CLI mínima**, junto com 13b: rotas `/api/…` no servidor que já serve o MCP,
  token de dono e de aba, `donel ps / quem-sou / ver / enviar / abrir / retomar` com `--json`.
  **O dono vê:** num terminal qualquer, `donel ps` lista as sessões do quadro com papel e estado;
  um agente de qualquer motor manda mensagem a outra sessão com `donel enviar`.
- As ferramentas MCP entram nas fatias de cada item (13a, 13b, 13c, 08, 15b), sempre com o
  mesmo nome e efeito do comando do CLI.
- **P2 — TUI local, só leitura + responder pendência**: Sessões, Quadro, Precisa de você,
  Esteiras. **O dono vê:** `donel tui` num terminal mostra o time e o que precisa dele.
- **P3 — TUI remota**: token remoto, opt-in, revogável. **O dono vê:** do outro PC, pelo
  Tailscale, a mesma TUI.

## 8. Lições que vêm de graça

Coisas que o OpenRig aprendeu caro e estão escritas no código ou nos docs:

- "Unknown beats a confident wrong answer" (taxonomia de estado).
- "Do not use chat text as the work record" (cultura do starter): mensagem não é trabalho.
- A linha carrega a obrigação uma vez; o aviso pode repetir (`queue-wake-ladder.ts`).
- Entregue ≠ lido ≠ feito: colar prova transporte, assumir prova que pegou, só o fechamento
  prova que acabou.
- Fila não acende "trabalhando" (`topology-activity.ts`, "non-inference contract").
- Raspagem de tela é último recurso; hooks e auto-relato vêm antes.
- Mudança de configuração de sessão viva vale na próxima continuação, e a UI diz isso.
- Não responder o prompt de outra sessão.

## 9. Esteira montada no Mindscape

Item 15 do PDA, próximo passo depois do protótipo (14). Dono, 03/11: "a ideia de configurar as
esteiras no mindscape não pode morrer. Terminais pré-determinados, com conexões de caminho
gerados pelo output de cada sessão, similar ao que temos no modo dev, mas mais visual e mais
maleável. Isso DEVE CONTINUAR PODENDO EXISTIR e será o próximo passo." Base: o pedido de 24/10
(`docs/produto/modo-dev-montador-de-fluxo.spec.md`: molde de fluxo de sessões com fan-out e
fan-in, cada sessão com suas skills, um agente geral que acompanha tudo e só traz as dúvidas que
ele não resolve, um bloco por iniciativa no Mindscape com tipo Desenvolvimento, Bugfix,
Homologação…) e o contexto medido em `docs/produto/assets/modo-dev-montador-de-fluxo/contexto-atual.md`.

### 9.1 Como o OpenRig separa time e fluxo

São **dois documentos** diferentes, e isso é o que mais serve:

1. **O time** (RigSpec, `rig.yaml`): seats com papel, motor e cwd, e as edges, declarados antes
   de rodar (seção 1). Responde "quem existe".
2. **O fluxo** (workflow spec, `workflow:` em YAML; exemplos em
   `packages/daemon/src/builtins/workflow-specs/`): responde "por onde o trabalho anda". Fonte:
   `docs/as-built/architecture/workflow-runtime.md`.

Anatomia do fluxo:

- `roles`: papéis do fluxo, cada um com `preferred_targets` (seats, ex.
  `[flow-builder@acme-flow]`; aceita `member@{rig}` para reaproveitar o mesmo fluxo em outro
  rig) e `skill_refs`. Sem alvo preferido, o motor escolhe um seat vivo com aquele `role` e o
  motor exigido, o de menor fila (`selectRoleSeat`).
- `steps`: cada passo tem `id`, `actor_role`, `objective`, `allowed_exits` e `next_hop`. Pode
  fixar o motor do passo (`harness: claude-code | codex`).
- **Saídas** de um passo: `handoff`, `waiting`, `done`, `failed`.
- **Caminho por saída:** `next_hop.on: { failed: remediate }` manda a saída para um passo; sem
  mapeamento, vale a estrutura (`suggested_roles`, `mode: require | forbid`, ou o próximo da
  lista).
- **Fan-out e fan-in:** com `depends_on` o fluxo vira grafo de dependência; um `handoff` pode
  abrir vários sucessores, e um passo só fica elegível quando cada pré-requisito concluiu depois
  da última vez que ele rodou (refazer um pré-requisito faz os dependentes rodarem de novo).
- **Parada humana:** `gate: { target: human@kernel, summary, evidence_ref }` estaciona o pacote
  esperando a pessoa (`gated-release.yaml`).
- **Laço com teto:** ciclo só é aceito com `loop_guards.max_hops`; estourou, vira `failed` com
  nota `max_hops_exceeded` (`branched-remediation.yaml`: build → verify → remediate → verify, até
  8 saltos).
- **Vários ao mesmo tempo:** várias instâncias do mesmo fluxo correm juntas; "queue depth at each
  station is the backpressure signal" (`conveyor.yaml`).

**Como o output de um seat decide o próximo.** O agente termina o passo declarando a saída pelo
CLI: `rig workflow project --instance <id> --current-packet <qitem> --exit <handoff|waiting|done|failed>
[--next-owner] [--evidence-ref] [--result-note] [--acceptance-verdict] [--blocked-on]`
(`cli-reference.md`, seção workflow). O motor então, numa transação: fecha o pacote pela regra
da fila, cria o pacote do próximo passo para o dono certo, grava o rastro e manda o wake.
**"The engine checks declared fields and recorded state; it does not judge the substance of a
referenced proof document."** Ou seja: o caminho sai de um enum + ponteiro de evidência que o
agente declara, não de o motor ler a resposta do agente. Passos que exigem recibo pedem
`evidence_ref`; aceite tipado confere candidato, veredito permitido e evidência, por presença e
identidade.

Outras peças:

- **Exceções** (`unmapped_failed`, `stuck_overdue`, `human_gate_trip`) viram item urgente na
  fila, roteado **primeiro ao orquestrador, depois a um humano** (`workflow.exception_routing`:
  `orchestrator | human_only`). É o "agente geral que só traz o que não resolve", em forma de
  regra de roteamento.
- **Vigia:** keepalive a cada 15 min; passo é "atrasado" com 4 h sem fechar; ao reiniciar, a
  varredura rearma e recutuca, mas **nunca avança passo sozinha**.
- **Operações de recuperação:** `route` (troca o dono do passo), `resume` (refaz um passo que
  falhou com uma decisão escrita), `abort`, `continue` (só inspeção).
- **Editar fluxo vivo:** `reviseGraph` deixa acrescentar passos e mudar os que ainda não
  começaram; não deixa remover passo nem mexer no que já rodou, está vivo ou falhou
  (`workflow-reconciliation.ts`, citado no as-built).
- **Missions e slices** são o "bloco de iniciativa" deles: pasta por mission, com `SPEC.md`,
  `PROOF.md`, `PROGRESS.md` lidos da folha à raiz (`docs/reference/chain-file-convention.md`);
  linhas da fila marcadas `mission:`/`slice:` caem na iniciativa certa.
- **Limite:** o fluxo só aceita `claude-code` e `codex` como motor de passo
  (`WORKFLOW_AGENT_HARNESSES`).

### 9.2 O que o Donel Dev já tem para isso

Medido em `contexto-atual.md` (24/10) e nas specs:

| Peça | Onde | Estado |
|---|---|---|
| Fases com comando, modelo e esforço por fase | `src/shared/devModeDefaults.ts` | implementado (comando pré-digitado, Enter do dono) |
| Store de fatos (eventos JSONL + snapshot), estado derivado do log | `src/main/esteira-store.ts`, 010 `[D-13]` | implementado |
| Contrato app ↔ skills: a skill grava `result.json`, o app ingere, schema versionado com teste dos dois lados, erro visível no card | 010 `[D-10]`; `esteira-ingest.ts`, `esteira-result-watcher.ts` | implementado |
| Guardas do disparo: alvo explícito, trava como fato, trava por recurso de escrita, recusa de 2ª sessão viva, redisparo de fase concluída só com confirmação | `src/main/esteira-dispatch.ts` | implementado |
| Sessão por item+fase, encadeada por `continuesSessionId` | 010 `[P-6]` | implementado |
| Grafo canônico fixo de um card (Discovery → Plano → Design condicional → Implementar → … → laço fix↔validar com teto 3 → Concluir) e taxonomia de nó (`fase`, `gate`, `artefato`, nota) | `specs/012-esteira-4/catalogo.md` §1–2 | especificado |
| Motor: scheduler sobre o `esteira.grafo`, cursor por card derivado do log, 8 estados de card, teto de paralelismo, worktree por card, "a fila para e chama o dono" | `specs/012-esteira-4/motor.md` | especificado, sem código |
| Mapa de nós | `src/renderer/src/DevMode/NodeGraphOverlay.tsx` (d3-force) | implementado |
| Decisões humanas pendentes e checklist de revisão na tela | `EsteiraScreen.tsx` | implementado |
| Agente geral que sintetiza dúvidas, fan-out/fan-in executados, molde desenhado pelo dono, bloco de iniciativa, tipo de iniciativa | — | **não existe** |

**Comparação [inferência]:** o grafo canônico da 012 é um workflow spec do OpenRig com nomes do
Donel (gate = parada humana; laço com teto 3 = `max_hops`; "chama o dono" = exceção roteada ao
humano); o `result.json` da 010 é o `rig workflow project --exit` do OpenRig, só que por arquivo
(o que deixa a skill funcionar com o app fechado). O que o Donel não tem é o **dono desenhar** o
grafo e o motor **andar** nele com sessões visíveis.

### 9.3 Modelo proposto: molde e iniciativa

**[proposta, a refinar no item 15]**

- **Molde** = o desenho reutilizável de uma esteira, feito no próprio Mindscape:
  - **Estações** (os "terminais pré-determinados"): post-its de sessão no aspecto "ainda não
    começou" (12a), cada um com **papel** (12), **comando ou skill inicial** (o que hoje está em
    `devModeDefaults.ts`), **motor/modelo/esforço** e regra de pasta (repo, worktree própria ou
    não). Tipos de estação, herdando a taxonomia da 012: **sessão** (fase), **você decide**
    (gate), **artefato** (marco sem sessão).
  - **Caminhos**: ligações do tipo "caminho" (13a) com **condição sobre a saída declarada** da
    estação de origem. Saída = `desfecho` (`concluido | devolvido | esperando | falhou`, os quatro
    do OpenRig com nome pt-BR) + `rota` opcional (um rótulo que a estação escolhe, ex.
    `tem-decisao-de-estrutura`, `achou-defeito`) + `evidencia` (caminho de arquivo). O caminho diz
    "quando desfecho = falhou" ou "quando rota = achou-defeito". Nunca condição sobre o texto da
    resposta.
  - **Fan-out**: vários caminhos saindo com a mesma condição abrem várias estações.
    **Fan-in**: estação marcada "espera todas" só começa quando todas as de entrada concluíram
    (o `depends_on`). **Laço**: permitido só com teto escrito no caminho (padrão 3, como a 012).
  - **Coordenador**: estação especial, opcional, com papel próprio (ver 9.5).
- **Iniciativa** = um molde aplicado num projeto. Nasce uma **moldura** no quadro (item 06) com
  título, **tipo** (Desenvolvimento, Bugfix, Homologação… = qual molde) e as estações já
  posicionadas e ligadas. Cada iniciativa tem seu próprio rastro no store de fatos (o
  `esteira-store` serve), e várias correm ao mesmo tempo.
- **Como a saída vira a próxima sessão**: a estação termina gravando a saída pelo contrato
  `result.json` da 010 (estendido com `rota` e `evidencia`) **ou** pela ferramenta
  `esteira_concluir_estacao` do MCP `donel` / `donel esteira concluir` do CLI. O app então
  acende o caminho (animação do 13b), acorda a estação seguinte (abre a sessão com o papel, na
  pasta certa, com a primeira mensagem apontando para a evidência anterior, nunca colando o
  conteúdo) e grava o fato. Parada "você decide" vira pendência com motivo.
- **Visível por padrão**: as estações são abas e post-its de verdade, que o dono pode abrir,
  olhar e assumir; sessão sem aba (headless da 012) fica como opção da estação, depois.
- **Mais maleável que o Modo Dev**: editar a iniciativa viva com a regra do `reviseGraph`
  (acrescentar estação ou mudar uma que não começou; nunca apagar o que já rodou) e "salvar como
  molde" a partir de uma iniciativa que deu certo.
- **Onde mora o molde**: arquivo próprio no `userData` (`moldes/<id>.json`, com
  `schemaVersion`), editado pelo quadro, exportável para o repo (`.esteira/moldes/`) para levar a
  outro PC ou projeto. **Nunca YAML escrito à mão como entrada** — o PDA tem em "Fora de escopo"
  "Topologia declarada em YAML antes de rodar: o quadro nasce do uso"; o item 15 deve reler isso
  como "não escrever YAML", não como "não pré-declarar": o quadro livre e a moldura de iniciativa
  convivem.
- **Moldes de fábrica genéricos**: Desenvolvimento (o grafo canônico da 012), Bugfix (reproduzir
  → corrigir → validar → concluir, laço corrigir↔validar com teto), Revisão. **Homologação** é da
  Seazone (skills `homologacao:*` do ambiente do dono): entra como molde **do dono**, não de
  fábrica, pela régua "Seazone só como adaptador opcional" (memória `autonomia-e-seazone-opcional`)
  e para não vazar para o repo público.

### 9.4 O que do OpenRig serve aqui

| OpenRig | Uso no molde |
|---|---|
| Time e fluxo em documentos separados | Molde (fluxo) separado do quadro livre (time); a mesma estação-papel serve a moldes diferentes |
| Saída = enum + evidência declarados; motor não lê prosa | Condição de caminho só sobre `desfecho`/`rota`; `evidencia` obrigatória onde o molde pedir |
| `next_hop.on`, `depends_on`, `gate`, `max_hops` | Caminho condicionado, "espera todas", "você decide", teto de laço |
| Pacote durável + wake ponteiro | A próxima estação recebe ponteiro para a evidência; o fato fica no store |
| Exceção: orquestrador primeiro, humano depois | Coordenador recebe primeiro; só o que ele não resolve vira "Precisa de você" |
| Keepalive e "atrasado" sem avançar sozinho | Aviso de estação parada, nunca pular estação |
| `route` / `resume` / `abort` / `continue` | Gestos no quadro: trocar quem faz, refazer com decisão, encerrar, inspecionar |
| `reviseGraph` com regras | Editar iniciativa viva |
| Escolha de seat por papel + menor fila | Depois: estação "qualquer sessão livre com papel Dev" |
| Mission/slice com `SPEC/PROOF/PROGRESS` | A moldura da iniciativa aponta para a pasta de artefatos dela |

Não serve: YAML como entrada, tmux, daemon, grants, aceite tipado completo (pesado para um dono
só; fica a evidência obrigatória).

### 9.5 O agente geral (coordenador)

É a parte do pedido de 24/10 sem equivalente pronto em nenhum dos dois lados. Proposta:

- Uma estação com papel **Coordenador**, um por iniciativa, lançada no motor que o dono escolher
  (memória `llm-agnostico`).
- Lê pelo MCP: `esteira_estado` (rastro, estações, saídas, pendências), `sessao_ver_tela` e as
  perguntas abertas das estações.
- Recebe primeiro toda exceção (estação que falhou sem caminho, parada há tempo demais, pergunta
  da estação). Resolve o que pode com `sessao_enviar` à estação ou refazendo com decisão; o
  resto ele escreve como **uma** pendência sintetizada para o dono (`esteira_perguntar_ao_dono`),
  que aparece na faixa "Precisa de você" da variante escolhida no 14.
- Regras do papel, herdadas do líder do OpenRig: não responder prompt de permissão de outra
  estação; não aprovar a parada "você decide"; não encerrar estação com trabalho vivo.

### 9.6 Fatias propostas para o item 15

Pré-requisitos: 12a (lugar sem conversa + papel), 13a (ligação com tipo), 06 (moldura), P1 (API
local). O que a esteira pede de cada decisão anterior, para a porta não fechar: o post-it tem que
poder existir antes da sessão; a ligação tem que aceitar um tipo com condição; a moldura tem que
poder ter tipo e dono de rastro.

- **15a — Molde parado.** Desenhar estações e caminhos numa moldura, salvar como molde, aplicar
  num projeto. Sem motor: cada estação abre por duplo clique já com papel, pasta e comando
  pré-digitado (como o Modo Dev hoje). **O dono vê:** a trilha inteira da iniciativa no quadro
  antes de começar, com tipo e estações esperando a vez.
- **15b — A saída move a trilha.** Saída declarada (`result.json` estendido, MCP ou CLI) acende
  o caminho e acorda a(s) próxima(s) estação(ões); fan-out abre várias, "espera todas" segura o
  fan-in, "você decide" vira pendência, teto de laço chama o dono. Reaproveita o store, o
  ingestor e as guardas do `esteira-dispatch`. **O dono vê:** a próxima sessão nascendo sozinha
  na estação certa, o caminho animando, e a trilha parando só onde ele precisa decidir.
- **15c — Coordenador.** Estação/papel da 9.5. **O dono vê:** uma pendência por vez, já
  resumida, em vez de perguntas soltas de cada sessão.
- **15d — Moldes de fábrica e iniciativa viva.** Desenvolvimento, Bugfix, Revisão; editar
  iniciativa viva com as regras do `reviseGraph`; "salvar como molde"; exportar. **O dono vê:**
  ao criar uma iniciativa, escolhe o tipo numa lista e a trilha aparece montada; molde próprio
  (ex. Homologação) entra na mesma lista.

Em aberto para o refinamento do 15: se o motor da 012 é implementado como está e o molde só o
alimenta, ou se o molde substitui o `esteira.grafo`; se o Modo Dev atual some quando 15b chegar
(a 010 já previa aposentar o mapa antigo, `[P-5]`); se estação headless entra.

## 10. Fontes

Todas no clone em `c9b1ae480f9551a1e4ba731cfbaa2a314a80ef96`.

| Afirmação | Arquivo |
|---|---|
| Versão 0.7.1; UI web em manutenção, CLI primário | `package.json`; `docs/reference/developing.md` ("Wording rule") |
| Seat, pod, membro, endereço `pod-member@rig` | `docs/reference/topology-naming.md`; `docs/reference/rig-spec.md` (tabela de membros) |
| Exemplos de rig e papel | `packages/daemon/specs/rigs/launch/starter/{rig.yaml,CULTURE.md,guidance/lead-first-move.md}`; `.../factory/rig.yaml`; `.../kernel/rig.yaml`; `packages/daemon/specs/agents/development/{implementer,qa}/agent.yaml`; `.../qa/guidance/role.md` |
| Tipos AgentSpec/RigSpec, pipeline de startup, camadas, identidade | `docs/as-built/architecture/agent-spec-and-startup.md`; `docs/reference/agent-startup-guide.md` |
| Campos Claude por seat (`append_system_prompt_file`, `agent_file`, `plugin_dirs`), `compaction_strategy`, `continuity_policy` sem efeito | `docs/reference/rig-spec.md` |
| Handover, restore, resultados por nó | `docs/as-built/architecture/lifecycle-snapshot-restore.md` |
| Refocus channel | `docs/reference/refocus-channel.md` |
| O que edges fazem e não fazem | `docs/reference/edge-types.md` |
| `whoami` com edges e peers; `rig_team` | `packages/daemon/src/domain/whoami-service.ts`; `packages/cli/src/mcp-server.ts:1514` |
| Ferramentas MCP `rig_*` (send, capture, chatroom, queue, whoami, team, handoff…) | `packages/cli/src/mcp-server.ts` (registros a partir da linha 683) |
| `rig send`, broadcast, lease, recusa em needs_input, colagem em dois passos, verify | `docs/as-built/architecture/transport-and-transcripts.md` §3 |
| Envelope From/To/Reply | `packages/cli/src/commands/send.ts:66–98` |
| Guarda de digitação (6 modos), mensagens retidas, lembretes com carência | `docs/reference/seat-delivery.md` |
| Chatroom não montado na UI | `docs/as-built/architecture/transport-and-transcripts.md` §5 |
| Fila, estados, hot-potato, inbox/outbox, varredura | `docs/as-built/architecture/coordination-primitive.md` |
| Escada de wake e invariante "exactly-once / at-least-once" | `packages/daemon/src/domain/queue-wake-ladder.ts` (comentário de cabeçalho) |
| Texto do wake | `packages/daemon/src/domain/queue-nudge-text.ts` |
| Taxonomia de estado, PARKED/HELD/DONE-UNSEEN, escada de evidência | `docs/reference/agent-state-taxonomy.md` |
| Mission Control: vistas, verbos, auditoria, notificações | `docs/as-built/architecture/mission-control.md` |
| Feed For You | `docs/as-built/ui/project-and-for-you.md` §2 |
| TUI como superfície principal | `packages/tui/README.md` |
| Peças da topologia, vistas, teto de preview | `docs/as-built/ui/topology.md`; `packages/ui/src/components/terminal/live-terminal-registry.ts:19` |
| Cartão do agente | `packages/ui/src/components/topology/HybridTopologyNodes.tsx` |
| Anel e classes de atividade | `packages/ui/src/components/topology/{ActivityRing.tsx,activity-card-visuals.ts}` |
| Estado base, eventos que viram hot-potato, edge temporária | `packages/ui/src/lib/topology-activity.ts` |
| Animação do pacote | `packages/ui/src/components/topology/HotPotatoEdge.tsx` |
| Estilo por tipo de edge | `packages/ui/src/lib/edge-styles.ts` |
| Layout automático e nós não arrastáveis | `packages/ui/src/lib/graph-layout.ts`; `packages/ui/src/components/RigGraph.tsx:548` |
| Linguagem visual e regras de motion | `docs/DESIGN.md` |
| Inventário do CLI, entrada pela TUI, `--json` sem schema único | `docs/as-built/cli-reference.md`; `packages/cli/src/front-door.ts` |
| Agentes usam o CLI pela shell, comandos "plain" | `packages/daemon/specs/rigs/launch/starter/CULTURE.md` |
| TUI: seções, gramática, socket de controle, limite de verbos | `packages/tui/README.md`; `packages/tui/src/sections.ts`; `packages/tui/src/attention/attention-model.ts` |
| MCP: transportes, auth por token (sha256), grant por requisição | `packages/cli/src/mcp-http.ts` (comentário de cabeçalho); `packages/cli/src/commands/mcp.ts` |
| MCP: 37 ferramentas, classes work/workspace/owner, anotações, `MCP_OPERATIONS`, instruções versionadas | `packages/cli/src/mcp-server.ts:465–560` |
| Membros hospedados pelo MCP | `docs/reference/hosted-members.md` |
| Recusa de bind fora do loopback sem token | `docs/as-built/architecture/mission-control.md` §4 (`assertBindAuthInvariant`) |
| Workflow runtime: saídas, `next_hop`, `depends_on`, gate, `max_hops`, exceções, keepalive, revisão | `docs/as-built/architecture/workflow-runtime.md` |
| Exemplos de fluxo | `packages/daemon/src/builtins/workflow-specs/{conveyor,branched-remediation,gated-release}.yaml` |
| `rig workflow project --exit …` | `docs/as-built/cli-reference.md` (seção workflow) |
| Chain files | `docs/reference/chain-file-convention.md` |

Lado do Donel Dev consultado: `src/shared/mindscape/model.ts`, `src/shared/chat/sendMachine.ts`,
`src/main/semaphore-state-machine.ts`, `src/main/pty-manager.ts`, `src/shared/providers.ts`,
`src/shared/commandBuilder.ts`, `docs/design/navegador-interno.md`, `docs/design/mindscape.md`,
`docs/refinamentos/mindscape-lugar-principal.md`, `specs/backlog.md` (B32, B34, B36),
`docs/glossario.md`, `src/main/browser/browser-mcp-server.ts` e `src/shared/browser/mcp.ts`
(commit `973dcc0`), `src/main/esteira-dispatch.ts`, `specs/010-esteira-donel/spec.md`,
`specs/012-esteira-4/{catalogo,motor}.md`, `docs/produto/modo-dev-montador-de-fluxo.spec.md`,
`docs/produto/assets/modo-dev-montador-de-fluxo/contexto-atual.md`.

**Inferências deste documento** (não estão no OpenRig, são leitura minha): o paralelo
rig/pod/seat ↔ quadro/moldura/post-it; a vantagem do Donel Dev na guarda de digitação; o daemon
como "sem orquestrador de conteúdo"; o grafo do OpenRig como superfície de olhar e não de agir;
o comportamento do system prompt anexo em `/compact` e `--resume` (a provar num spike); a
escolha de fazer a ligação autorizar envio, que diverge do OpenRig; o CLI como a porta que torna o
OpenRig agnóstico e o MCP como porta dos membros hospedados; a comparação entre o grafo da 012 e
o workflow spec; e todo o desenho das seções 6.1 e 9.3–9.6, que é proposta, não fato.
