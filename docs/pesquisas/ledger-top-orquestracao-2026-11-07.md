# Ledger "top de linha": como a orquestração multiagente registra trabalho, prova e aceite (07/11/2026)

Pedido do dono (07/11), repassado pelo Líder: "o ledger está uma bosta. Quero ele em padrão top de linha, manda
as pesquisas todas." Este documento cobre um ângulo: **orquestração multiagente**. Ficaram de fora a interface
do cartão e o espelho no Supabase.

**Como li:** documentação pública de cada sistema (links nas linhas), o estudo local do OpenRig
([openrig-estudo-profundo-2026-11.md](openrig-estudo-profundo-2026-11.md), clone do commit `c9b1ae4`), o
[treinamento do Bill](treinamento-liderancas-tech-2026-11-03.md) e o nosso contrato em `origin/staging`
(`src/shared/ledger/contract.ts` v4, `faxina.ts`, `src/main/ledger-store.ts`). O que é **inferência minha** está
marcado assim.

## Resumo

- **Onde já estamos à frente do mercado:** "entrega sem prova é recusada" e "quem entregou não aceita" são
  regras de código. Só o GitHub Copilot tem uma trava parecida, e só no aceite: quem pediu o PR não o aprova
  ([GitHub](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations)).
  A carta para o dono e a amostra diária do Revisor não têm par direto nos sistemas que li.
- **Onde estamos atrás:** nos estados de espera, nas dependências, na idempotência, na detecção de trabalho
  parado, na prova **verificada** (hoje só checamos se ela existe), no teto de retrabalho e nos motivos de
  fechamento tipados. Hoje o cancelamento e a transferência moram como marca `⟦…⟧` dentro de texto livre.
- **Recomendação:** juntar as dez práticas do fim numa única subida de schema (v5), coordenada com o Alfa
  instalado. As marcas em texto já são dívida: cada fato novo vira mais uma convenção para interpretar.

## O que cada sistema faz

| Sistema | Tarefa e estados | Pediu × faz × aprova | Prova | O que pede ao humano | Órfãs e duplicatas |
|---|---|---|---|---|---|
| **Claude Code agent teams** ([doc](https://code.claude.com/docs/en/agent-teams)) | Lista compartilhada: *pending → in progress → completed*; dependência deixa a tarefa *blocked*, e o fim da dependência a destrava sozinho | O líder cria e atribui; o colega assume ou se auto-atribui; a aprovação vem por hook | Nenhuma nativa. Os hooks `TaskCreated`/`TaskCompleted` com saída 2 **impedem** criar ou concluir e devolvem o motivo | Pedidos de permissão sobem ao líder; o colega avisa quando fica ocioso | *Lock* de arquivo na hora de assumir. A própria doc admite: "task status can lag", e o status trava os dependentes |
| **Claude Code Workflows** ([doc](https://code.claude.com/docs/en/workflows)) | Run com ID; cada `agent()` vira concluído, falho ou parado; o resultado fica salvo para retomar | O script decide; o humano aprova o plano antes de rodar | Saída validada por *schema* (até 5 tentativas); padrão de verificação adversarial; o que não deu para checar sai como "unverified", não como "refuted" | Visão `/workflows` por fase, com pausar e parar | Agente sem saída por um tempo **reinicia sozinho** (até 5 vezes); retomar não roda de novo o que já concluiu |
| **OpenAI Agents SDK** ([handoffs](https://openai.github.io/openai-agents-python/handoffs/), [HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/), [tracing](https://openai.github.io/openai-agents-python/tracing/)) | O handoff é uma ferramenta tipada (`input_type`: motivo, prioridade) | `needs_approval` por ferramenta; `approve`/`reject` sobre o `RunState` | *Trace* com *spans* de agente, ferramenta, handoff e guardrail, ligado por padrão | `interruptions` lista o que espera decisão; o `RunState` é "designed to be durable" | A doc avisa: aprovar "does not guarantee exactly-once", então efeito colateral leva **chave de idempotência** |
| **OpenAI Codex** ([lançamento, via citação](https://x.com/TheZvi/status/1924894026228236532)) | Tarefa em sandbox; termina com commit no ambiente | O humano revisa, pede revisão ou abre o PR | "verifiable evidence… through citations of terminal logs and test outputs" | Diz explicitamente quando ficou em dúvida ou quando um teste falhou | — |
| **Devin** ([v3](https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session), [v1](https://docs.devin.ai/api-reference/v1/sessions/retrieve-details-about-an-existing-session)) | `new, claimed, running, exit, error, suspended`; dentro de `running`: `working / waiting_for_user / waiting_for_approval / finished` | Quem cria a sessão manda; *playbook* como receita | `structured_output` validado + PR | Os estados `waiting_for_*` dizem **por que** parou | No v1, sessão concluída aparece como `blocked` ([relato](https://github.com/kznovo/superset/pull/7)): um estado ambíguo confunde quem consome |
| **Cursor cloud agents** ([doc](https://cursor.com/docs/cloud-agent/capabilities)) | Run com ID, dono, branch e status de ciclo de vida; eventos `pr_created`, `artifact_created` | O agente abre um PR rascunho; o humano revisa ou assume a máquina | Prints, vídeos e logs **anexados ao PR**; o agente testa a própria UI antes de enviar | Pode assumir o desktop do agente e devolvê-lo | Conserta o CI sozinho, mas **para em 10 tentativas** ou quando um humano mexe |
| **GitHub Copilot cloud agent** ([riscos e mitigações](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations)) | Uma tarefa = uma branch `copilot/` = um PR | **Quem pediu não aprova**; o agente não marca "pronto" nem mescla | Commits coassinados e assinados, log da sessão, CodeQL e varredura de segredos | Os workflows só rodam com "Approve and run" de um humano | Só empurra para a própria branch |
| **CrewAI** ([tasks](https://docs.crewai.com/en/concepts/tasks)) | `description` + **`expected_output`** (obrigatório) + `context` (tarefas de que depende) | O agente faz; `human_input` faz um humano revisar a resposta final | `guardrail` (função ou LLM) que devolve o erro ao agente, até **3** tentativas | `human_input=True` | — |
| **LangGraph** ([persistência](https://docs.langchain.com/oss/python/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)) | *Checkpoint* por `thread_id`; `interrupt()` pausa com uma carga JSON | O humano retoma com `Command(resume=…)`: aprovar, rejeitar ou editar | O próprio estado salvo | A carga do `interrupt` pode ter `response_schema` | Ao retomar, o nó roda de novo do começo, então o efeito colateral tem de ser idempotente ("creating records… causes duplicates") |
| **Magentic-One / AutoGen** ([artigo](https://arxiv.org/html/2411.04468v1)) | *Task ledger* (fatos, palpites, plano) + *progress ledger* a cada passo: acabou? em laço? progredindo? quem age? qual instrução? | O orquestrador | — | — | **Contador de estagnação**: passou de 2, replaneja. Sem os ledgers, o desempenho cai 31% |
| **OpenHands** ([runtime](https://github.com/OpenHands/OpenHands/blob/main/openhands/runtime/README.md), [config](https://docs.openhands.dev/openhands/usage/v0/advanced/V0_configuration-options)) | *Event stream* de ações e observações, só acrescenta | — | A trajetória salva em JSON pode ser repetida | — | — |
| **Factory Droids** ([modos](https://docs.factory.ai/cli/user-guides/specification-mode), [settings](https://docs.factory.ai/cli/configuration/settings)) | Spec Mode → plano aprovado → execução; nível de autonomia separado | O humano aprova a spec; `maxAutonomyLevel` da organização limita | A spec salva em `.factory/docs/` | Aprovar o plano | — |
| **OpenRig** (estudo local §3–4) | `queue_items` com fechamento por **`closure_reason` obrigatório** (`handed_off_to, denied, canceled, superseded, escalation…`); `block --on <outro>`; `depends_on` | Seat dono; `escalates_to`; *human gate* com `evidence_ref` | `evidence_ref`; o motor "does not judge the substance"; o que não dá para provar fica como "claimed" | Feed "For You" com 5 tipos de cartão e 9 verbos (aprovar, negar, rotear, segurar, responder…); aviso por ntfy ou webhook | "The row carries the obligation exactly-once; the wake is at-least-once"; recibo derivado `stalled-after-claim`; varredura de travados |
| **Billverso (treinamento)** ([notas](treinamento-liderancas-tech-2026-11-03.md)) | Dono, prazo e critério; fila com "entregues sem aceite" e retrabalho do dia | Quem entrega não aceita; um agente contrário confere a prova | A API recusa "pronto" sem prova (print ou vídeo) | Painel no celular filtrado por risco; aprovar ou reprovar "estilo Tinder" | — |

## O nosso ledger hoje (lido em `origin/staging`)

- Estados: `aberta → em-execucao → entregue → aceita | rejeitada`. "Cancelada" e "transferida" **não são
  estados**: são o texto `⟦cancelada⟧` num evento `rejeitada` e o texto `⟦transferida de X para Y⟧` num evento
  `criada`. A escolha evitou subir o schema por causa do Alfa 0.4.0 (`contract.ts`, seção "Marks").
- Prova: arquivo copiado, texto ou link. O contrato só confere **forma** (`validProof`): o link do CI não é
  aberto, e não se sabe se o CI passou.
- Duplicata: `requestId` existe só nas decisões vindas do celular. `criar` não tem chave, então dois
  `tarefa_criar` iguais geram duas tarefas.
- Órfã: a faxina noturna só pega tarefa cujo **lugar dono sumiu** e que ninguém tocou por 24 h (`faxina.ts`).
  Uma tarefa `em-execucao` com dono vivo e parado não é detectada.
- Não há dependência entre tarefas, tarefa-mãe, estado "bloqueada" ou "esperando você" antes da entrega, nem
  limite de rodadas de retrabalho. Só existe `replaces`, para substituir uma tarefa.

## As 10 práticas que mais faltam no nosso ledger

1. **Estados de espera com motivo**: `bloqueada` (por tarefa X ou por fato externo) e `esperando-dono` *durante*
   a execução, separados de "entregue". Fontes: Devin `waiting_for_user/approval`, `blocked` dos agent teams,
   `block --on` do OpenRig.
2. **Dependências e destravamento automático** (`dependeDe: [ids]`): a tarefa só é assumível quando as
   anteriores foram aceitas, e é reaberta se uma delas for rejeitada depois. Fontes: agent teams, `context` do
   CrewAI, `depends_on` do OpenRig.
3. **Tarefa-mãe e origem**: toda subtarefa aponta para a tarefa-mãe, até chegar à frase do dono. A faixa mostra
   o pedido do dono com N filhas, e o aceite da mãe exige as filhas fechadas. Fontes: *task ledger* do
   Magentic-One, handoff do OpenRig. **Inferência** sobre o desenho.
4. **Idempotência na criação**: uma chave (`chave` ou hash de pedido + dono + quadro) recusa ou devolve a
   tarefa já criada. Fontes: OpenAI SDK ("use idempotency keys"), LangGraph (efeitos repetidos duplicam), `drop`
   idempotente do OpenRig.
5. **Pulso de execução e detecção de parada**: `assumida` passa a exigir sinal de vida (o último evento da
   sessão que o main já vê). Sem sinal por N horas, o estado derivado vira `parada`, e o Líder é acordado, não
   só a faxina das 24 h. Fontes: `stalled-after-claim` e varredura do OpenRig, *stall restart* dos Workflows,
   contador do Magentic-One.
6. **Fechamento tipado e obrigatório**: o estado terminal leva `motivo ∈ {aceita, rejeitada, cancelada,
   substituída, transferida, concluída-por-PR}` em campo próprio, não em marca no texto. É a regra
   "hot-potato" do OpenRig: trabalho não some, ou termina com motivo, ou passa adiante. Exige o v5.
7. **Prova verificada pelo main, não só declarada**: link de CI e PR conferidos por `gh` no `entregar` (CI verde,
   PR existe, SHA). O que não deu para conferir fica marcado "declarada", como o "claimed" do OpenRig e o
   "unverified" dos Workflows. A faxina já fala com o `gh`, então o custo é baixo. Fontes: hook `TaskCompleted`
   (recusa com motivo), CodeQL do Copilot.
8. **Rastro automático anexado à entrega**: o main carimba sessão, trecho do transcript, branch e commit, sem
   depender do agente. Fontes: citações de log e teste do Codex, log de sessão e commits assinados do Copilot,
   run ID com eventos do Cursor, *spans* do OpenAI SDK.
9. **Teto de retrabalho com escalonamento**: contador de rodadas por tarefa. Na 3ª rejeição, a tarefa sobe ao
   Líder ou ao dono com o histórico, em vez de voltar ao mesmo lugar. Fontes: Magentic-One (estagnação > 2 →
   replaneja), `guardrail_max_retries = 3` do CrewAI, 10 tentativas de CI do Cursor, `max_hops` do OpenRig.
10. **Fila do dono com tipos e verbos, e aviso para fora**: além de "entregue alto risco", entram *pergunta*
    (responder), *aprovação de plano* (aprovar/negar) e *bloqueio* (destravar), com notificação no celular
    quando nasce um item. Fontes: feed "For You" e ntfy do OpenRig, `interrupt` com `response_schema` do
    LangGraph, painel do Billverso.

Fora das dez, para a mesma conversa: o critério de pronto poderia ganhar uma forma verificável opcional (comando
que precisa sair 0), na linha do `expected_output` + guardrail do CrewAI.
