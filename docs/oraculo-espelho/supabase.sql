-- Espelho do Oráculo — the registry of the owner's tasks in his PERSONAL Supabase (never a Seazone one).
-- Run once in the project's SQL editor (or through the Management API). The app upserts by `id`
-- (src/main/ledger-mirror/supabase-sink.ts) with the service key; nobody else reads or writes: RLS on, no policy.

create table if not exists public.demandas (
  id             text primary key,
  quadro         text not null,
  titulo         text not null,
  pedido         text not null,
  quem_pediu     text not null,
  estado         text not null,
  esperando_dono boolean not null default false,
  risco          text not null,
  dono           text not null,
  prazo          date not null,
  criada_em      timestamptz not null,
  entregue_em    timestamptz,
  decidida_em    timestamptz,
  decisao        text,
  motivo         text,
  prova          text,
  prova_link     text,
  atualizado_em  timestamptz not null default now()
);

alter table public.demandas enable row level security;

-- What has not closed yet: open, running, delivered (waiting for a decision) and whatever waits for the owner.
create or replace view public.demandas_em_aberto
with (security_invoker = true) as
select quadro, titulo, estado, esperando_dono, risco, dono, prazo, criada_em, entregue_em, pedido, quem_pediu, id
from public.demandas
where estado in ('aberta', 'em execução', 'entregue') or esperando_dono
order by esperando_dono desc, prazo, criada_em;
