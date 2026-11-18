-- t-ba2bb4f9 (dono, 18/11: "E sobre o ledger, tem coluna de DoD lá? Acho importante") — o DoD e o último andamento de
-- cada tarefa na projeção legível `public.tarefas`, para o app do celular mostrar "Pronto quando: …" e o andamento ao
-- tocar no pedido.
--
-- De onde vem cada coluna (src/shared/ledger/mirror.ts, `tarefaRow`; quem grava é o espelho dentro do daemon do
-- Oráculo, src/main/ledger-mirror/supabase-sink.ts):
--   criterio            o `doneWhen` da tarefa (na fonte, public.ledger_tarefas.doc->>'doneWhen'), mascarado pela
--                       mesma varredura de segredos dos outros textos;
--   ultimo_andamento    o último registro do `tarefa_andamento` (um evento `comentada` com a marca ⟦andamento⟧,
--                       src/shared/ledger/andamento.ts) numa linha "estado; precisa: …; prova: …; próximo: …",
--                       mascarado e cortado em 280 caracteres; null quando a tarefa não teve andamento;
--   ultimo_andamento_em a hora desse registro.
-- O formato do ledger e do Oráculo não muda: é só projeção. A fonte (`ledger_tarefas.doc`) segue sem coluna nova.
--
-- Ordem: rodar ANTES de subir um espelho que manda estas colunas. Sem elas o PostgREST recusa o lote com 400 PGRST204;
-- o espelho então reenvia as linhas sem as três colunas e escreve no log que falta este arquivo (não para), mas o
-- celular fica sem o DoD até rodar. Idempotente, só acréscimo. Volta: as três linhas comentadas no fim.

alter table public.tarefas
  add column if not exists criterio text,
  add column if not exists ultimo_andamento text,
  add column if not exists ultimo_andamento_em timestamptz;

comment on column public.tarefas.criterio is 'O DoD da tarefa ("Pronto quando"): o doneWhen do ledger do Oráculo (public.ledger_tarefas.doc->>''doneWhen''), mascarado pelo espelho.';
comment on column public.tarefas.ultimo_andamento is 'O texto do último andamento da tarefa (tarefa_andamento), mascarado pelo espelho; null quando não houve andamento.';
comment on column public.tarefas.ultimo_andamento_em is 'Quando foi o último andamento da tarefa.';

-- O PostgREST passa a aceitar as colunas novas sem esperar o recarregamento sozinho.
notify pgrst, 'reload schema';

-- Volta (só com ok de quem usa as colunas: a view celular.ledger do app do celular também as lê):
-- alter table public.tarefas drop column if exists criterio, drop column if exists ultimo_andamento, drop column if exists ultimo_andamento_em;
-- notify pgrst, 'reload schema';
