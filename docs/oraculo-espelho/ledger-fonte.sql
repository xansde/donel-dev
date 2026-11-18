-- t-89279f84 (item 4 da estrutura enxuta, 18/11) — o Supabase pessoal (oraculo-harrow) vira a FONTE do ledger.
-- O daemon do Oráculo (src/oraculo/ledger-supabase.ts) lê estas duas tabelas no boot e grava nelas a cada op, antes de
-- responder. `public.tarefas` segue como a projeção legível (mascarada), escrita pelo espelho dentro do daemon.
--
-- `doc` é a tarefa inteira, SEM máscara (provas podem ter senha): RLS ligada e nenhuma policy, só a service key lê.
-- Nunca abrir uma policy aqui; quem quer ler tarefa lê `public.tarefas`.
--
-- Volta: docs/oraculo-espelho/ledger-fonte-volta.md (o daemon volta ao ledger.json com o backup ou com um export
-- destas tabelas). Rodar uma vez; é idempotente.

create table if not exists public.ledger_tarefas (
  id            text primary key,
  doc           jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.ledger_tarefas enable row level security;

create table if not exists public.ledger_meta (
  id             int primary key default 1 check (id = 1),
  schema_version int not null,
  started_at     bigint,
  atualizado_em  timestamptz not null default now()
);
alter table public.ledger_meta enable row level security;

comment on table public.ledger_tarefas is 'Fonte do ledger do Oráculo (t-89279f84): uma linha por tarefa, o documento inteiro. Só a service key; a leitura humana é public.tarefas.';
comment on table public.ledger_meta is 'Cabeçalho do ledger do Oráculo (schemaVersion, startedAt): uma linha só.';

-- Sem policy a RLS já barra, mas a tarefa inteira tem senha em prova: tira também a permissão de anon e authenticated.
revoke all on public.ledger_tarefas, public.ledger_meta from anon, authenticated;
