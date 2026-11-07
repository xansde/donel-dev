# Ledger (Oráculo Harrow) × as melhores ferramentas de gestão de trabalho

Pesquisa · 07/11/2026 · pedido do dono: "o ledger está uma bosta. Quero ele em padrão top de linha".
Pergunta: como Linear, Jira, GitHub Projects, Shortcut, Asana, Notion, ServiceNow e Zendesk modelam e mostram
tarefas, e o que disso falta na nossa tabela `demandas`. Height ficou fora: fechou em 24/09/2025
([Creativerly](https://www.creativerly.com/height-app-is-shutting-down/), [X @height_app](https://x.com/height_app)).

## Resumo

- **A causa do "Quem pediu = Dev" é de modelo, não de rótulo.** Todas as ferramentas maduras separam quem
  pede, quem registra, quem faz e quem aprova. Nós temos só o autor do evento `criada` (a sessão que gravou), e o
  nome dela cai para o papel quando o lugar não tem nome.
- **"dono" significa duas coisas na mesma tabela**: a coluna `dono` (o lugar que faz) e `esperando_dono`
  (o Alexandre). Nenhuma das ferramentas usa a mesma palavra para responsável e aprovador.
- **Faltam três colunas que as líderes põem no centro**: com quem está a próxima ação, o estado do prazo (no
  prazo, em risco, vencido) e o critério de pronto.
- **O que já está acima da média**: a regra de transição em código, a prova obrigatória, a proibição de aceitar a
  própria entrega e o histórico que guarda todas as rodadas. O Jira, por exemplo, perde as decisões
  quando a aprovação volta (detalhe na seção 2).
- **Recomendação**: renomear e desdobrar as colunas como na seção 3, criar uma tabela de eventos e promover
  "cancelada" a estado de verdade. Primeiro mudar o contrato (subir a versão do schema), depois o espelho.

## 1. O que temos hoje (lido no código)

- **Campos da tarefa**: `title`, `request` (frase literal), `doneWhen`, `due` (data obrigatória), `ownerPlaceId`,
  `risk` (baixo/alto), `state` (aberta → em-execucao → entregue → aceita | rejeitada) e `events` com `by`
  (`origin/staging:src/shared/ledger/contract.ts:42-173`).
- **Origem do "Dev"**: `quem_pediu = who(created?.by, …)`, onde `created` é o primeiro evento `criada`
  (`origin/feature/oraculo-espelho:src/shared/ledger/mirror.ts:131,145`). O nome vem de `actorLabel`:
  "sem nome, o papel" (`src/shared/ledger/labels.ts`). A pessoa que deu a ordem original só existe dentro do
  texto `pedido`.
- **A tabela `demandas`** não tem o critério de pronto, quem executou, transferências, número de rodadas nem a
  última atividade (`origin/feature/oraculo-espelho:docs/oraculo-espelho/supabase.sql`).
- **Cancelar e transferir** gravam uma marca no texto de eventos antigos: `⟦cancelada⟧` num `rejeitada`, e
  `⟦transferida de A para B⟧` num `criada`, para não subir o schema
  (`origin/feat/ledger-de-verdade:src/shared/ledger/contract.ts:263-268`). O espelho escreve
  `STATE_LABELS[task.state]` (`mirror.ts:146`), e o ramo dele ainda não tem o cancelamento.
  **Suposição**: quando os dois ramos se juntarem, uma tarefa cancelada vai aparecer como "rejeitada", com a
  marca crua no motivo.

## 2. Como as líderes fazem

**Papéis: quem pede ≠ quem registra ≠ quem faz ≠ quem aprova**
- Zendesk: *requester* é a pessoa para quem é o ticket. *Submitter* é quem o criou, não pode mudar e é o autor
  do 1º comentário. *Assignee* é quem resolve ([glossário](https://support.zendesk.com/hc/en-us/articles/4408883411354-Zendesk-glossary),
  [Tickets API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/)).
- Jira: *Reporter* é "the person who originally raised the request". *Assignee* é "the person tasked with
  resolving". Há ainda *Watchers* e *Approvers* ("responsible for approving or declining")
  ([Atlassian](https://support.atlassian.com/jira-service-management-cloud/docs/see-everyone-involved-in-a-request/)).
  O *Creator* é um campo separado do *Reporter* ([Community](https://community.atlassian.com/forums/Jira-questions/What-is-the-Purpose-of-the-Reporter-field/qaq-p/110989)).
- ServiceNow: `caller_id` (quem relatou), `assigned_to` + `assignment_group`
  ([referência da tabela](https://thesnowball.co/table/incident)). `opened_by` é quem registrou.
  **Não verificado em fonte**: tirei isso do que eu já sabia.
- Shortcut: `requestedById` e `ownerIds` são campos distintos ([SDK](https://jensastrup.github.io/shortcut/classes/Story.html),
  [shortcut-cli](https://github.com/shortcut-cli/shortcut-cli)).
- **Linear com agentes (o caso mais parecido com o nosso)**: você delega a um agente "while keeping a human
  teammate as the assignee"; "the assignee remains responsible". O histórico mostra quem atribuiu e quem
  delegou ([Linear](https://linear.app/docs/assigning-issues)).

**Estados: poucas categorias fixas, nomes livres, e o estado diz com quem está**
- Linear tem as categorias Triage, Backlog, Unstarted, Started, Completed, Canceled e Duplicate. Recusar na
  triagem leva a Canceled, com comentário ([status](https://linear.app/docs/configuring-workflows),
  [triage](https://linear.app/docs/triage)).
- Notion agrupa os status em To-do, In progress e Complete
  ([Notion](https://www.notion.com/help/database-properties)). Shortcut usa Unstarted, Started e Done
  ([blog Shortcut](https://www.shortcut.com/blog/how-we-use-teams-projects-product-management-clubhouse/)).
- Zendesk: *Pending* espera o solicitante; *On-hold* espera um terceiro; *Closed* só o sistema fecha
  ([ciclo de vida](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses)).
- Asana separa Approved, Request changes e Rejected ([guia](https://www2.asana.com/id/guide/help/premium/approvals)).
  A queixa mais votada: "changes requested" conta como concluída e some do "My tasks"; também não há contagem de
  rodadas ([fórum](https://forum.asana.com/t/approvals-request-change-should-keep-the-task-incomplete/76962),
  [BlinkMetrics](https://blinkmetrics.com/asana-approval-revision-cycles/)).
- Jira põe a aprovação como um status do workflow, com o número de aprovadores exigido. Quando a tarefa volta a
  "Waiting for approval", o campo zera e perde as decisões anteriores
  ([Community](https://community.atlassian.com/forums/Jira-Service-Management/Workaround-for-Approval/qaq-p/3113318);
  fonte única, de usuário, sem doc oficial). O nosso histórico guarda todas as rodadas.
- Jira valida cada transição em três camadas: condição, validador e ação posterior
  ([Atlassian](https://support.atlassian.com/jira-cloud-administration/docs/configure-advanced-issue-workflows/)).
  É o mesmo papel do nosso `applyLedgerOp`.

**Prazo e SLA**
- Linear: o SLA nasce de regra (Urgent = 24 h, High = 1 semana) e o estado vai de Low/Medium/High risk para
  Breached, Achieved ou Failed. Toda vista filtra por ele, e quem acompanha a tarefa é avisado no risco e no
  estouro ([Linear SLA](https://linear.app/docs/sla)).
- Jira SM: o relógio tem início, pausa e fim. A pausa típica é "Waiting for customer"
  ([Atlassian](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-sla-conditions/)).

**Histórico e auditoria**
- Zendesk guarda cada mudança como *audit*: `author_id`, os eventos e `via` (o canal: web, API, regra, celular)
  ([audits](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/),
  [via](https://developer.zendesk.com/documentation/ticketing/reference-guides/via-object-reference/)).
- ServiceNow separa *work notes* (só a equipe vê) de *additional comments* (o solicitante vê)
  ([Community](https://www.servicenow.com/community/itsm-articles/guide-to-servicenow-incident-text-fields/ta-p/2316108)).
- Notion preenche sozinho Created by, Created time, Last edited by e Last edited time
  ([Notion](https://www.notion.com/help/database-properties)).

**Vistas para quem decide**
- Linear: Inbox com aba Priority, adiar (*snooze*) e lembrete ([Inbox](https://linear.app/docs/inbox)). A triagem
  tem um responsável nomeado, com rodízio ([triage](https://linear.app/docs/triage)).
- GitHub Projects: tabela, quadro e roadmap; agrupar, esconder campos, limite por coluna; "maintain a single
  source of truth" ([boas práticas](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects),
  [layouts](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view)).

## 3. Esquema de colunas recomendado para `demandas`

A ordem é a de leitura, da esquerda para a direita. Os nomes ficam em português, como na tabela de hoje. Os
valores são texto de gente, e os nomes de pessoa e de lugar são gravados no momento do evento.
**Suposição**: o "Dev" sem nome vem de lugar já fechado ou sem nome, e por isso congelar o nome resolve.

| # | Coluna | O que mostra | Inspirado em |
|---|---|---|---|
| 1 | `codigo` | chave curta, "H-142" (o `id` longo vai para o fim) | Linear, Jira |
| 2 | `titulo` | nome humano, até 60 caracteres | todos |
| 3 | `situacao` | categoria fixa: Entrada · A fazer · Fazendo · Esperando decisão · Concluída · Cancelada | Linear, Notion |
| 4 | `com_quem_esta` | "você decide" · "Dev · painel do Jobu faz" · "Revisor confere" | Zendesk Pending/On-hold |
| 5 | `pedido_por` | a origem: "Alexandre", "Líder", "Rotina X" | requester, reporter, caller |
| 6 | `registrado_por` | a sessão que gravou | submitter, opened_by |
| 7 | `responsavel` | o lugar que faz (substitui `dono`) | assignee |
| 8 | `executado_por` | quem fez de fato, quando outro fez | delegado do Linear |
| 9 | `decide` | "você" ou "Revisor" (vem do risco) | approver |
| 10 | `risco` | baixo, alto | — |
| 11 | `prazo` | data | — |
| 12 | `prazo_status` | no prazo · em risco · vencido · cumprido · cumprido com atraso | SLA do Linear |
| 13 | `pedido_literal` | a frase literal | — |
| 14 | `criterio_pronto` | `doneWhen` (falta hoje) | — |
| 15 | `rodadas` | nº de entregas; rejeições contam | lacuna do Asana |
| 16 | `decisao` | aceita · pediu ajustes · rejeitada · cancelada, com a opção escolhida | Asana |
| 17 | `decidida_por` / `decidida_em` | — | — |
| 18 | `motivo` | sem marcas internas (`⟦…⟧`) | — |
| 19 | `prova_resumo` / `prova_link` | — | — |
| 20 | `ultima_atividade` / `ultima_atividade_em` | "Dev entregou com 2 provas · 14:03" | Notion Last edited |
| 21 | `transferencias` | "de A para B: motivo" | — |
| 22 | `quadro`, `id`, `atualizado_em` | técnico, no fim | — |

Junto da tabela: uma tabela `demandas_eventos` (tarefa, quando, quem, o que, canal, texto), uma linha por
evento, como o *audit* do Zendesk. E uma vista `esperando_voce`, ordenada por `prazo_status` e pela idade.

## 4. As 10 práticas que mais faltam

1. **Separar quem pediu de quem registrou** (Zendesk, Jira, ServiceNow, Shortcut). O `criar` passa a receber
   `pedidoPor`.
2. **Uma palavra por papel**: "responsável" para quem faz e "você" só para o Alexandre. Some a coluna `dono`
   (Jira, Zendesk).
3. **Mostrar com quem está a próxima ação**, derivada do estado (Pending e On-hold do Zendesk).
4. **Cancelada e duplicada como estados de verdade**, não marca em texto (Linear). Isso pede subir o schema;
   a regra atual de "marca para não subir" troca legibilidade por compatibilidade.
5. **"Pedir ajustes" separado de "rejeitar"**, com contagem de rodadas (Asana e as queixas sobre ele).
6. **Prazo com estado de risco e aviso antes de estourar**, e pausa enquanto espera você (Linear SLA, Jira SM).
7. **Caixa "esperando você" com prioridade e adiar** (Inbox do Linear), em vez de só a lista.
8. **Auditoria com canal**: app, celular, sessão via MCP ou rotina (`via` do Zendesk). Hoje o canal só aparece
   indiretamente, pelo `requestId` do celular.
9. **Nota interna separada da nota para você** (work notes × comments do ServiceNow). Hoje só o risco alto
   tem `paraODono`.
10. **Nomes congelados no evento, chave curta e uma fonte única**: a tabela deriva tudo do ledger e nunca
    recebe edição (GitHub Projects, Notion Created by).

Fora do recorte e não pesquisado: permissões por linha no Supabase e a vista do celular.
