-- Espelho do Oráculo — the registry of the owner's tasks in their PERSONAL Supabase (never a Seazone one).
-- Run once in the project's SQL editor (or through the Management API). The app upserts by `id`
-- (src/main/ledger-mirror/supabase-sink.ts) with the service key; nobody else reads or writes: RLS on, no policy.
--
-- 07/11 — `tarefas` replaces the first table, `demandas` ("quem pediu: Dev" told nothing). The columns are in the
-- order a person reads them, people and places by name, the id last (src/shared/ledger/mirror.ts, `TarefaRow`).
-- `demandas` stays until the owner drops it (last statement, commented): the app no longer writes there.

create table if not exists public.tarefas (
  quadro          text not null,
  titulo          text not null,
  frente          text,
  estado          text not null,
  esperando_dono  boolean not null default false,
  quem_pediu      text not null,
  pedido          text not null,
  quem_faz_agora  text not null,
  quem_criou      text not null,
  risco           text not null,
  prazo           date not null,
  ultima_entrega  text,
  link_da_prova   text,
  decisao         text,
  motivo          text,
  criada_em       timestamptz not null,
  entregue_em     timestamptz,
  decidida_em     timestamptz,
  prova_texto     text,
  id              text primary key,
  atualizado_em   timestamptz not null default now()
);

alter table public.tarefas enable row level security;

-- 07/11 — the front of work (`frenteOf`, the Jobu's progress by front). A table made before it gets the column here,
-- at its end; run this BEFORE the app that sends `frente`, or every upsert fails (unknown column).
alter table public.tarefas add column if not exists frente text;

comment on column public.tarefas.quem_pediu is 'A pessoa de quem veio o pedido: o dono, alguém do Slack, a fonte de um sinal. "não registrado" quando ninguém disse.';
comment on column public.tarefas.quem_faz_agora is 'O lugar dono da tarefa, pelo nome (papel · nome da sessão).';
comment on column public.tarefas.quem_criou is 'Quem registrou a tarefa no Oráculo (o dono ou um lugar, pelo nome).';
comment on column public.tarefas.frente is 'A frente de trabalho da tarefa ("Ledger", "Oráculo na VPS"), a última que o Líder disse; vazia = sem frente.';
comment on column public.tarefas.esperando_dono is 'Espera uma decisão do dono (risco alto entregue, ou a amostra diária da primeira semana).';

-- What has not closed yet: open, running, delivered (waiting for a decision) and whatever waits for the owner.
-- `frente` goes last: `create or replace view` only appends columns.
create or replace view public.tarefas_em_aberto
with (security_invoker = true) as
select quadro, titulo, estado, esperando_dono, quem_pediu, quem_faz_agora, prazo, risco, ultima_entrega, link_da_prova, pedido, criada_em, id, frente
from public.tarefas
where estado in ('aberta', 'em execução', 'entregue', 'aceita, esperando envio') or esperando_dono
order by esperando_dono desc, prazo, criada_em;

-- After checking `tarefas` filled up (the owner's call):
-- drop view if exists public.demandas_em_aberto;
-- drop table if exists public.demandas;
