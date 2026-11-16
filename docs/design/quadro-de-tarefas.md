# Ledger como quadro de tarefas: desenho (t-1e354d15)

16/11/2026. Status: **aprovado pelo Líder do quadro** (as 6 decisões da seção 10, todas como recomendado), com os
ajustes de contrato do serviço do PC (t-c3fbe852). Base: `~/seazone/_docs/arquitetura-alvo.md` peça 2. Esquema:
`docs/board/schema.sql`; regras em TS: `src/shared/board/rules.ts`.

## 0. O que existe hoje (e muda o desenho)

- **"Fonte no Supabase, como hoje" não existe para o ledger.** O Supabase pessoal do dono (`hotkktdvbjpibkigpopq`)
  tem só `public.tarefas`, um espelho de mão única do **Oráculo**, regravado inteiro pela ponte `donel-espelho.service`
  na VPS. Não há tabela de quadro, coluna, justificativa nem projeto. Portanto o quadro é **novo**, com tabelas
  próprias, e nada dele toca `public.tarefas`, o `ledger.json` nem as tools `tarefa_*` (Oráculo = mesa do dono).
- **Cron de justificativa:** o `despertador_resposta.py` (*/5) é o embrião, mas não confere link nenhum: lê o log da
  escuta do Theo e procura qualquer mensagem do autor. Em 16/11: 999 eventos, 988 "campo ocupado", nenhuma resposta
  detectada. O mecanismo de acordar (tmux com campo livre, teto e recuo, aviso ao Líder do quadro) se reaproveita;
  a conferência do link precisa ser escrita (Slack por `ler_fio.py`, GitHub por `gh`).
- **Vigia:** o vigia do repo só cria carta de trava no Oráculo e, na VPS, nem roda (bundle de 09/11 sem ele). Quem
  acorda sessão hoje é o `despertador_sessoes.py ronda` (*/20), que lê o Oráculo e usa um juiz Haiku. O vigia novo
  **substitui o `ronda`** (senão duas rotinas acordam a mesma sessão) e não toca o vigia de travas.
- **Líder do quadro** já se reconhece sem confiar na sessão: `isBoardOrchestrator` (`src/shared/mindscape/reach.ts`),
  com o `board` que o daemon da VPS já tem no `retrato.json`. **Laya** não existe em código: entra como marca opcional.

## 1. Onde mora

- **Supabase pessoal `hotkktdvbjpibkigpopq`, schema novo `board`** (exposto no PostgREST; cabeçalhos
  `Accept-Profile`/`Content-Profile: board`). Não o staging Seazone compartilhado.
- **Escrita só por funções (RPC)**, nunca `insert/update` direto: a chave de serviço passa por cima da RLS, então as
  regras moram no banco (`board.create_card`, `board.move_card`, `board.touch_lane`, `board.request_leader`; justificar é `move_card` para a
  mesma coluna). A mesma
  regra existe em TS puro em `src/shared/board/` para teste e para recusar cedo.
- **Chave:** a que já existe na VPS (`~/.config/donel-espelho/service-key`, usada pela ponte) e a do cofre do PC.
  Nenhuma credencial nova na V1. Papel Postgres restrito ao schema `board` fica como melhoria (é credencial nova:
  pede OK do dono).
- **Sessões nunca recebem a chave.** Elas chegam ao quadro por tools MCP `card_*` servidas pelo **daemon da VPS**
  (portão 47817 intercepta `card_*` antes de repassar ao PC), que confere quem é a sessão pelo retrato. Funciona com o
  PC desligado (modo sem PC, peça 6). Deploy do daemon: só com OK do dono, pelo Líder único.

## 2. Modelo (contrato; nomes em inglês, como o código do repo)

Colunas do quadro (`stage`; `column` é palavra reservada do SQL):

| stage | Nome na tela | Quem move para cá |
|---|---|---|
| `inbox` | Entrada | quem cria (Jobu/serviço do PC, Líder, sessão) |
| `todo` | A fazer | Líder do quadro (triagem: frente + lugar executor) |
| `doing` | Fazendo | o lugar executor |
| `blocked` | Travado | o lugar executor ou o Líder; **exige justificativa** |
| `waiting_owner` | Esperando você | **só o Líder do quadro**, com `owner_reason` |
| `done` | Feito | o lugar executor ou o Líder; com `done_summary` |

```
board.projects(
  id text pk,               -- slug estável: 'donel-dev', 'bizops'...
  name text, host text,     -- 'vps-pessoal' | 'homologacoes' | 'vps-people'
  aliases text[]            -- caminhos por máquina (C:\Users\compu\seazone\Donel Dev, /home/.../Donel Dev)
)
board.cards(
  id text pk,               -- 'c-xxxxxxxx'
  project_id text fk, front text,         -- frente, até 40
  title text, owner_request text,         -- frase literal do pedido
  criterion text, requested_by text,      -- 'dono', 'Fulano (Slack)', 'sinal do X'
  stage text, stage_since timestamptz, note text,   -- nota curta (≤200) do último movimento
  place_id text, session_id text,         -- lugar executor e sessão (uuid) para acordar
  justification text, justification_link text, justification_due timestamptz,
  owner_reason text,        -- só em waiting_owner: main_prod | new_credential | money | laya
  done_summary text,        -- só em done
  oraculo_id text,          -- carta ligada no Oráculo (decisão do dono), opcional
  due date, risk text, position int,
  version int,              -- compare-and-swap em move_card
  created_at, updated_at, woken_at, charged_at timestamptz
)
board.moves(                -- histórico só de acréscimo = o andamento; id é o cursor dos clientes
  id bigserial pk, card_id, project_id, from_stage, to_stage, note, owner_reason, done_summary, actor, at
)
board.leader_requests(      -- pedido de (re)abrir o Líder de uma raia, atendido pelo vigia (modo leader, */1)
  id bigserial pk, project_id, actor, client_ref unique, status pending|done|failed, reason, created_at, handled_at
)
board.lanes(                -- uma raia por projeto
  project_id pk, leader_place text, leader_session text, leader_seen_at timestamptz
)
```

Regras no banco (`move_card` recusa com erro legível):
- `blocked` sem `justification` + `justification_link` + `justification_due` futuro.
- `waiting_owner` se `actor <> lanes.leader_place` do projeto, ou sem `owner_reason` na lista.
- `done` sem `done_summary`. Movimento com `version` velha (corrida).
- Cartão em `doing` pode carregar justificativa ("parado de propósito"); ela some ao mudar de stage.

Views (a API de leitura de qualquer cliente: celular, página, PC):
- `board.overview`: uma linha por projeto (ID), contagem por stage, cartão parado mais antigo, prazos vencidos,
  quantos em Esperando você, última mudança.
- `board.project_cards`: cartões do projeto ordenados por `front`, `stage`, `position`.
- `board.lanes_without_leader`: raias com `leader_place` nulo ou `leader_seen_at` há mais de 30 min, com
  `leader_place` e `leader_session` (para retomar em vez de abrir outro).
- `board.owner_feed`: o que chega ao Jobu numa consulta só: todo movimento para `waiting_owner` e os pedidos do dono
  (`requested_by='dono'`) que chegaram a `done`, com `owner_reason`, `done_summary`, `owner_request`, ordenado por id.

## 3. Contrato para o serviço do PC (Dev 65ef0caf, t-c3fbe852)

Tudo por PostgREST no projeto `hotkktdvbjpibkigpopq`, schema `board`, chave de serviço do cofre do PC.

1. **Criar na Entrada:** `POST /rest/v1/rpc/create_card` com
   `{p_project_id, p_title, p_owner_request, p_criterion, p_front, p_requested_by:'dono', p_actor:'jobu',
   p_client_ref}` → a linha inteira do cartão (o `id` vem nela). Sobe em `inbox`; título acima de 120 caracteres e
   frente acima de 40 são cortados. `project_id` desconhecido cai em `sem-projeto` (o Líder reclassifica).
   Idempotente por `p_client_ref`, inclusive em duas chamadas simultâneas.
2. e 3. **Esperando você e Feito do dono:** `GET /rest/v1/owner_feed?id=gt.<cursor>&order=id`. O cursor em
   `moves.id` é estável: toda gravação em `moves` passa por um lock de transação, então os ids ficam visíveis na ordem
   do commit e nenhum id menor aparece depois de um maior. Editar a nota sem mudar de coluna não entra no feed. Realtime do Supabase fica opcional (pede o schema na publicação).
4. **Raia sem Líder vivo:** `GET /rest/v1/lanes_without_leader`. `leader_seen_at` é atualizado pelo banco a cada
   `move_card` do Líder, pelo daemon (`touch_lane`) e pelo vigia quando vê a sessão do Líder viva no tmux. Para
   reabrir: `POST /rest/v1/rpc/request_leader {p_project_id, p_actor:'jobu', p_client_ref}`; há no máximo um
   pedido pendente por projeto (pedir de novo devolve o pendente). O vigia atende em até 1 min e marca `done` ou
   `failed` com o motivo.

Cabeçalhos `Accept-Profile: board` / `Content-Profile: board`; o schema entra em "Exposed schemas" no passo de
migração (antes disso, 406). Os parâmetros das RPCs têm prefixo `p_` (ver `docs/board/schema.sql`).

## 4. Tools das sessões (servidas pelo daemon da VPS; `card_*`, não `quadro_*`, que é do Mindscape)

- `card_create` (cai em `inbox`, ou em `todo` se quem cria é o Líder), `card_move {id, to, note, justification?,
  owner_reason?, done_summary?}`, `card_justify {id, text, link, due}`, `card_list {project?, stage?}`.
- O ator é o lugar da sessão (do retrato), nunca um argumento. `waiting_owner` recusado para quem não é Líder.
- Implementação (PR 2): `src/shared/board/tools.ts` (argumentos em pt-BR, como as `tarefa_*`), `src/oraculo/board-tools.ts`
  e `board-client.ts`. O portão responde as `card_*` **antes** do túnel, com o PC ligado ou não, e acrescenta as
  `card_*` à lista de ferramentas que o PC devolve. Desligado sem `~/.donel/board/supabase.json`
  (`{url, serviceKeyFile}`): nada fixo no código, que vai ao repo público. Fazendo é de quem move (grava lugar e
  conversa); só o Líder dá o cartão a outro lugar (`lugar`).
- Atenção no deploy: o bundle instalado do daemon é de 09/11. Um bundle novo leva tudo o que entrou desde então
  (inclusive o vigia de travas da fase 2), não só as `card_*`.
- **Andamento passa a ser `card_move`.** O `tarefa_andamento` do Oráculo fica para quem tem carta lá. Trocar a
  regra nas instruções (CLAUDE.md global e do servidor `donel`) é decisão do Líder/dono, depois que as tools existirem;
  até lá nada muda para as sessões.

## 5. Cron de justificativa (VPS, a cada 15 min)

Script único no crontab da VPS pessoal (`node ~/.donel/board/bin/board-cron.mjs justify`, `flock`, `nice`),
construído do repo como o daemon. Lê cartões com justificativa (`blocked`, ou `doing` com justificativa, vencida ou
não):
- Link de PR/issue do GitHub: `gh pr view|issue view --json updatedAt,comments,reviews,state`; houve algo novo
  depois de `stage_since` → acorda a sessão do cartão.
- Link do Slack: lê o fio (`ler_fio.py`, xoxp/Composio da conta a.lentz; nunca o MCP nativo do Slack); mensagem de
  outra pessoa depois de `stage_since` → acorda.
- Outro tipo de link: só o prazo vale.
- Prazo vencido → cobra a sessão; repete a cada 2 h, até 3 vezes; depois avisa o Líder do quadro.
- Acordar = digitar no tmux só com o campo livre, teto e recuo (reaproveita `despertador_sessoes.py`), e grava
  `woken_at`/`charged_at` no cartão para não repetir. Log em `~/.donel/board/cron.log` (é a prova do critério 2).
- O `despertador_resposta.py` fica até o quadro rodar; depois sai do crontab (as 13 esperas viram justificativas).

## 6. Vigia (VPS, mesmo script, modo `vigia`, a cada 15 min)

- Só olha `doing` **sem** justificativa válida, com a sessão do cartão parada (último turno `end_turn` há ≥ 30 min).
- Sessão viva no tmux → digita "retome o cartão c-…" (teto 2 por 24 h, recuo 15/30/60).
- Sessão morta → reabre no tmux da VPS com `claude --resume <session_id>` no cwd do lugar; sem sessão viável ou no
  teto → acorda o Líder do quadro e grava a nota "vigia: parado sem justificativa" (move_card para a mesma coluna).
  O vigia não move para `blocked`: Travado exige justificativa com link, que só quem trabalha no cartão tem.
- Cartão com justificativa, mesmo vencida, é do cron de justificativa (que cobra e depois avisa o Líder); o vigia
  não acorda a mesma sessão de novo.
- Nunca toca `blocked`, `waiting_owner`, `todo`, `inbox`. Atualiza `lanes.leader_seen_at`.
- Modo `leader` (*/1): atende `board.leader_requests` pendentes retomando `lanes.leader_session` no tmux da VPS.
  Hoje ninguém na VPS abre sessão sem o Electron; antes de ligar, confirmar que o app reconhece o lugar retomado.
- O `despertador_sessoes.py ronda` (que lê o Oráculo) só sai do crontab **depois de um dia rodando em paralelo** com
  o vigia novo, com a mesma saída ou melhor; desligar é passo separado, com a volta escrita (Líder, 16/11). O vigia de travas
  (cartas de infraestrutura no Oráculo) não muda.
- Peça 6 pede vigia e crons em Rust: começo em TS (reusa `src/shared/board/`, uma regra só) e o porte a Rust entra
  junto do serviço Rust da VPS. Se o dono preferir Rust já, a regra em SQL não muda.

## 7. Tela (prova do critério 1)

O desktop vai sair e o app do celular ainda não tem código. Recomendação: **página na VPS** em
`~/entregas/quadro/` (pela tailnet, como as outras entregas), gerada pelo próprio cron a cada 15 min a partir das views:
quadro geral (uma linha por projeto) → tabela do projeto agrupada por frente, com stage em etiqueta e a nota do
último movimento. O app do celular consome as mesmas views depois. Alternativa: aba no Electron (sai, por isso não).

## 8. Migração sem perda e volta

- Nada existente muda: schema novo, tools novas, crontab novo. Oráculo, `public.tarefas` e a ponte seguem iguais.
- Semente: script único, só leitura no Oráculo, cria um cartão por tarefa viva (`aberta`→`todo`,
  `em-execucao`→`doing`, `entregue`→`doing`, andamento `travada/esperando`→`blocked` com justificativa
  "importado; preencher", `precisa-do-dono`→`inbox` para o Líder decidir), com `oraculo_id`. Os projetos saem dos
  quadros do Mindscape + `projectPath` do Oráculo.
- **Volta:** tirar as linhas do crontab (religar `despertador_sessoes ronda` e `despertador_resposta`), voltar o
  bundle anterior do daemon (`oraculo.mjs.antes-AAAAMMDD-HHMM`, como nas implantações anteriores) e, se for o caso,
  `pg_dump -n board` e `drop schema board cascade`. Nada do Oráculo se perde porque nada dele foi escrito.

## 9. Entregas (PRs contra staging, cada um com teste e verify pela fila)

1. **PR 1 — regra e esquema:** `src/shared/board/` (stages, `canMove`, justificativa, Esperando você só do Líder,
   "parado"), `docs/board/schema.sql` (migração: tabelas, RPCs, views), este desenho em `docs/design/`. Testes vitest
   das regras que, quebradas, o dono não veria (mover para Esperando você sem ser Líder; travado sem justificativa).
   Não toca produção.
2. **PR 2 — tools `card_*` no daemon** (portão intercepta antes do túnel) + declaração no app. Deploy do daemon com OK.
3. **PR 3 — cron e vigia** (`board-cron.mjs justify|vigia`, construído como o daemon) + página `~/entregas/quadro/`.
4. Migração no Supabase e crontab: **com OK do dono**, pelo Líder único; depois a semente.

## 10. Decisões (Líder do quadro, 16/11: todas como recomendado)

1. Projeto Supabase: **pessoal `hotkktdvbjpibkigpopq`, schema `board`** (recomendado) × staging Seazone.
2. Tela da prova até 20/11: **página na VPS** (recomendado) × aba no Electron.
3. Cron e vigia: **TS agora, Rust depois** (recomendado) × Rust já.
4. Andamento das sessões vira `card_move` quando as tools estiverem no ar: **sim**. A troca da regra nas instruções
   das sessões é do Líder; avisá-lo na véspera. O Oráculo continua sendo a mesa "Esperando você" do dono.
5. VPS de produto (peça 3.2, ledger próprio): **um Supabase, `projects.host` diz onde roda** (recomendado na V1) ×
   um banco por VPS.
6. Laya: **marca `owner_reason='laya'` aceita só do Líder, sem classificador** até a Laya existir.
