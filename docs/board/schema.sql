-- Quadro de tarefas (t-1e354d15, dono 16/11): the ledger as a TASK BOARD, in the owner's PERSONAL Supabase
-- (hotkktdvbjpibkigpopq), schema `board`. Never the Seazone staging (shared, not ours), never `public.tarefas` (the
-- Oráculo's mirror, src/main/ledger-mirror/), never the Oráculo itself: the Oráculo is the owner's decision desk.
--
-- Design: docs/design/quadro-de-tarefas.md. Same rules in TS: src/shared/board/rules.ts (tests/quadro-de-tarefas.test.ts
-- keeps the stage and owner-reason lists equal to the ones marked below).
--
-- HOW TO APPLY (only with the owner's OK, through the Líder único):
--   1. Run this file once (SQL editor, or psql with the db password). It is idempotent: `if not exists` everywhere,
--      functions and views are `create or replace`.
--   2. Expose the schema to the API: Dashboard → Project Settings → API → "Exposed schemas" += board (or Management
--      API `PATCH /v1/projects/{ref}/postgrest` with `db_schema`). Until then PostgREST answers 406 for
--      `Accept-Profile: board`.
--   3. Clients send `Accept-Profile: board` (GET) / `Content-Profile: board` (POST, rpc).
-- ROLLBACK: `pg_dump -n board` (keep the file) and then `drop schema board cascade;`. Nothing outside `board` is touched.
--
-- Writes go ONLY through the functions below (create_card, move_card, reclassify_card, touch_lane, request_leader,
-- mark_cron, vigia_note, resolve_leader_request): the service key bypasses RLS, so the rules live here, and the key has no write
-- grant on the tables (last block). RLS is on and has no policy: anon/authenticated see nothing.

create schema if not exists board;

-- Projects: one row per project, a stable id (slug) and the paths each machine knows it by.
create table if not exists board.projects (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name        text not null,
  host        text not null default 'vps-pessoal',   -- where it runs: vps-pessoal | homologacoes | vps-people | ...
  aliases     text[] not null default '{}',           -- project paths per machine, worktree suffix removed
  created_at  timestamptz not null default now()
);
insert into board.projects (id, name) values ('sem-projeto', 'Sem projeto') on conflict (id) do nothing;

-- Lanes: one per project; who is its Líder and when he was last seen alive.
create table if not exists board.lanes (
  project_id      text primary key references board.projects (id),
  leader_place    text,
  leader_session  text,
  leader_seen_at  timestamptz
);

create table if not exists board.cards (
  id                  text primary key default ('c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  project_id          text not null references board.projects (id),
  front               text check (front is null or char_length(front) <= 40),
  title               text not null check (char_length(title) between 1 and 120),   -- create_card cuts longer ones
  owner_request       text not null,                  -- the literal phrase of whoever asked
  criterion           text,
  requested_by        text not null,                  -- 'dono', 'Fulano (Slack)', 'sinal do X'
  stage               text not null default 'inbox',
  stage_since         timestamptz not null default now(),
  note                text check (note is null or char_length(note) <= 200),
  place_id            text,                           -- the place doing it
  session_id          text,                           -- its conversation (uuid), to wake or resume it
  justification       text,
  justification_link  text,
  justification_due   timestamptz,
  owner_reason        text,
  done_summary        text,
  oraculo_id          text,                           -- the card on the owner's desk, when there is a decision
  due                 date,
  risk                text not null default 'baixo' check (risk in ('baixo', 'alto')),
  position            integer not null default 0,
  version             integer not null default 1,
  client_ref          text unique,                    -- idempotency of create_card
  created_by          text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  woken_at            timestamptz,                    -- last time the cron/vigia woke the session
  charged_at          timestamptz,                    -- last time the cron charged an expired deadline
  charge_count        integer not null default 0,
  constraint cards_stage check (stage in -- stages
    ('inbox', 'todo', 'doing', 'blocked', 'waiting_owner', 'done')),
  constraint cards_owner_reason check (owner_reason is null or owner_reason in -- owner_reasons
    ('main_prod', 'new_credential', 'money', 'laya')),
  constraint cards_blocked_justified check (stage <> 'blocked'
    or (justification is not null and justification_link is not null and justification_due is not null)),
  constraint cards_waiting_reason check (stage <> 'waiting_owner' or owner_reason is not null),
  constraint cards_done_summary check (stage <> 'done' or done_summary is not null)
);
create index if not exists cards_project_stage on board.cards (project_id, stage);
-- For the cron: when the Líder was last told about the card in this stage, and when the current justification was
-- given (a justification in the same stage does not move stage_since; a response older than it was already seen).
alter table board.cards add column if not exists leader_noticed_at timestamptz;
alter table board.cards add column if not exists justified_at timestamptz;

-- Moves: append-only history; the andamento IS this table. `id` is the cursor clients follow: every insert here takes
-- board.lock_moves() first and is the last write of its transaction, so ids become visible in commit order and a
-- reader never skips a smaller id that commits late.
create table if not exists board.moves (
  id            bigserial primary key,
  card_id       text not null references board.cards (id),
  project_id    text not null references board.projects (id),
  from_stage    text,
  to_stage      text not null,
  note          text,
  owner_reason  text,
  done_summary  text,
  actor         text not null,
  at            timestamptz not null default now()
);
create index if not exists moves_to_stage on board.moves (to_stage, id);

-- Requests to (re)open a lane's Líder, served by the vigia on the VPS (the PC never opens a session there).
create table if not exists board.leader_requests (
  id          bigserial primary key,
  project_id  text not null references board.projects (id),
  actor       text not null,
  client_ref  text not null unique,
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  reason      text,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

-- At most one pending request per project: the PC asks every minute while the lane has no Líder.
create unique index if not exists leader_requests_one_pending on board.leader_requests (project_id) where status = 'pending';

alter table board.projects enable row level security;
alter table board.lanes enable row level security;
alter table board.cards enable row level security;
alter table board.moves enable row level security;
alter table board.leader_requests enable row level security;

-- Text that has something besides blanks (space, tab, newline): the same test as `/\S/` in rules.ts.
create or replace function board.has_text(p text)
returns boolean language sql immutable as $$ select coalesce(p ~ '\S', false) $$;

create or replace function board.valid_justification(p_text text, p_link text, p_due timestamptz)
returns boolean language sql immutable as $$
  select board.has_text(p_text) and coalesce(p_link ~ '^https?://\S+$', false) and p_due is not null
$$;

create or replace function board.lock_moves()
returns void language sql as $$ select pg_advisory_xact_lock(hashtext('board.moves')) $$;

create or replace function board.stage_rank(p_stage text)
returns integer language sql immutable as $$
  select array_position(array -- stages
    ['inbox', 'todo', 'doing', 'blocked', 'waiting_owner', 'done'], p_stage)
$$;

-- WHO IS THE LÍDER. The caller vouches for it (`p_as_leader`): only the service key reaches these functions, and its
-- holders are the daemon (which reads it from the board's picture: the Líder the OWNER put there, `isBoardOrchestrator`),
-- the cron and the PC service (never Líder). So the picture decides: a new Líder takes the lane at once, and one that
-- lost the role loses the power on its next call. Sessions never hold the key.

-- Create a card. Idempotent by client_ref. Unknown project → 'sem-projeto' (reclassify_card moves it).
-- 'todo' and a place only from the Líder; everyone else lands in 'inbox'.
drop function if exists board.create_card(text, text, text, text, text, text, text, text, text, text, text, date, text, text);
create or replace function board.create_card(
  p_project_id text, p_title text, p_owner_request text, p_criterion text default null, p_front text default null,
  p_requested_by text default null, p_actor text default null, p_client_ref text default null, p_stage text default 'inbox',
  p_place_id text default null, p_session_id text default null, p_due date default null,
  p_risk text default 'baixo', p_oraculo_id text default null, p_as_leader boolean default false
) returns board.cards language plpgsql security definer set search_path = board, pg_temp as $$
declare
  v_card board.cards;
  v_project text := p_project_id;
  v_note text := 'criado';
begin
  if p_client_ref is not null then
    select * into v_card from board.cards where client_ref = p_client_ref;
    if found then return v_card; end if;
  end if;
  if not board.has_text(p_actor) then raise exception 'quem cria é obrigatório (actor)'; end if;
  if not board.has_text(p_title) then raise exception 'título é obrigatório'; end if;
  if not board.has_text(p_owner_request) then raise exception 'a frase do pedido é obrigatória'; end if;
  if not board.has_text(p_requested_by) then raise exception 'quem pediu é obrigatório (requested_by)'; end if;
  if p_stage is null or p_stage not in ('inbox', 'todo') then raise exception 'cartão novo entra em inbox ou todo, não em %', p_stage; end if;
  if (p_stage = 'todo' or p_place_id is not null) and not coalesce(p_as_leader, false) then
    raise exception 'só o Líder do quadro cria direto em "A fazer" ou dá o lugar; crie na Entrada';
  end if;
  if not exists (select 1 from board.projects where id = v_project) then
    v_note := 'projeto desconhecido: ' || coalesce(p_project_id, '(nenhum)');
    v_project := 'sem-projeto';
  end if;
  insert into board.cards (project_id, front, title, owner_request, criterion, requested_by, stage, note,
                           place_id, session_id, due, risk, oraculo_id, client_ref, created_by)
  values (v_project, left(nullif(btrim(p_front), ''), 40), left(btrim(p_title), 120), p_owner_request, p_criterion,
          p_requested_by, p_stage, left(v_note, 200), p_place_id, case when p_place_id = p_actor then p_session_id end,
          p_due, p_risk, p_oraculo_id, p_client_ref, p_actor)
  on conflict (client_ref) do nothing
  returning * into v_card;
  if v_card.id is null then
    -- a concurrent call with the same client_ref won: return its card
    select * into v_card from board.cards where client_ref = p_client_ref;
    return v_card;
  end if;
  perform board.lock_moves();
  insert into board.moves (card_id, project_id, from_stage, to_stage, note, actor)
  values (v_card.id, v_card.project_id, null, v_card.stage, v_card.note, p_actor);
  return v_card;
end $$;

-- Move a card (or, to the same stage, update its note/justification). Mirrors checkMove in src/shared/board/rules.ts.
-- Who moves (design §2): the Líder anything; "Entrada", "A fazer", "Esperando você", giving a place and the front are
-- his only. Anyone else moves only a card that is theirs (place_id), or takes an unowned one from "A fazer" to "Fazendo".
-- Earlier versions had fewer parameters: `create or replace` with more makes a second overload, and PostgREST could not
-- choose (PGRST203). Drop them so re-running this file leaves a single move_card.
drop function if exists board.move_card(text, text, text, integer, text, text, text, timestamptz, text, text);
drop function if exists board.move_card(text, text, text, integer, text, text, text, timestamptz, text, text, text, text);
create or replace function board.move_card(
  p_card_id text, p_to text, p_actor text, p_expected_version integer, p_note text default null,
  p_justification text default null, p_justification_link text default null, p_justification_due timestamptz default null,
  p_owner_reason text default null, p_done_summary text default null,
  p_place_id text default null, p_session_id text default null, p_front text default null, p_as_leader boolean default false
) returns board.cards language plpgsql security definer set search_path = board, pg_temp as $$
declare
  v_card board.cards;
  v_leader boolean := coalesce(p_as_leader, false);
  v_changed boolean;
  v_from text;
  v_new_j boolean := p_justification is not null;
  v_j_text text;
  v_j_link text;
  v_j_due timestamptz;
  v_justified boolean;
  v_reason text;
  v_summary text;
begin
  if not board.has_text(p_actor) then raise exception 'quem move é obrigatório (actor)'; end if;
  select * into v_card from board.cards where id = p_card_id for update;
  if not found then raise exception 'cartão % não existe', p_card_id; end if;
  v_from := v_card.stage;
  if board.stage_rank(p_to) is null then raise exception 'coluna desconhecida: %', p_to; end if;
  if p_expected_version is null or v_card.version <> p_expected_version then
    raise exception 'o cartão mudou desde a sua leitura; leia de novo antes de mover';
  end if;
  v_changed := p_to <> v_card.stage;
  -- In the same stage (a note edit), what the card already has still counts: its justification, reason, summary.
  v_j_text := case when v_new_j then p_justification when not v_changed then v_card.justification end;
  v_j_link := case when v_new_j then p_justification_link when not v_changed then v_card.justification_link end;
  v_j_due := case when v_new_j then p_justification_due when not v_changed then v_card.justification_due end;
  v_justified := board.valid_justification(v_j_text, v_j_link, v_j_due) and v_j_due > now();
  v_reason := coalesce(p_owner_reason, case when not v_changed then v_card.owner_reason end);
  v_summary := coalesce(p_done_summary, case when not v_changed then v_card.done_summary end);

  if not v_leader then
    if p_to = 'waiting_owner' then raise exception 'só o Líder do quadro põe um cartão em "Esperando você"; peça a ele'; end if;
    if p_to in ('inbox', 'todo') then raise exception 'só o Líder do quadro tria (Entrada e A fazer); peça a ele'; end if;
    if p_place_id is not null then raise exception 'só o Líder do quadro dá o cartão a outro lugar'; end if;
    if p_front is not null then raise exception 'só o Líder do quadro muda a frente do cartão'; end if;
    if v_card.place_id is not null and v_card.place_id is distinct from p_actor then
      raise exception 'o cartão é de %: só ele ou o Líder do quadro o move', v_card.place_id;
    end if;
    if v_card.place_id is null and not (p_to = 'doing' and v_card.stage = 'todo') then
      raise exception 'cartão sem dono: pegue-o de "A fazer" para "Fazendo", ou peça ao Líder';
    end if;
  end if;
  if p_to = 'waiting_owner' and (v_reason is null or v_reason not in -- owner_reasons
    ('main_prod', 'new_credential', 'money', 'laya')) then
    raise exception '"Esperando você" só por: main_prod, new_credential, money, laya';
  end if;
  if p_to = 'blocked' and not v_justified then
    raise exception '"Travado" exige justificativa: o motivo, o link onde a resposta vai chegar e um prazo no futuro';
  end if;
  if p_to = 'done' and not board.has_text(v_summary) then
    raise exception '"Feito" exige o resumo do que foi entregue';
  end if;
  if v_new_j and not v_justified then
    raise exception 'justificativa incompleta: motivo, link http(s) e prazo no futuro';
  end if;

  update board.cards set
    stage = p_to,
    stage_since = case when v_changed then now() else stage_since end,
    note = coalesce(left(p_note, 200), case when v_changed then null else note end),
    front = case when p_front is not null then left(nullif(btrim(p_front), ''), 40) else front end,
    -- a justification lives in its stage: it goes away on a stage change unless a new one comes along
    justification = case when v_new_j or v_changed then case when v_justified then v_j_text end else justification end,
    justification_link = case when v_new_j or v_changed then case when v_justified then v_j_link end else justification_link end,
    justification_due = case when v_new_j or v_changed then case when v_justified then v_j_due end else justification_due end,
    owner_reason = case when p_to = 'waiting_owner' then v_reason end,
    done_summary = case when p_to = 'done' then v_summary end,
    woken_at = case when v_changed then null else woken_at end,
    charged_at = case when v_changed or v_new_j then null else charged_at end,
    charge_count = case when v_changed or v_new_j then 0 else charge_count end,
    justified_at = case when v_new_j then now() when v_changed then null else justified_at end,
    leader_noticed_at = case when v_changed or v_new_j then null else leader_noticed_at end,
    -- "Fazendo" is whoever moves it there (with its conversation, to wake it); the Líder may assign another place,
    -- and the place it was given records its own conversation on its first move.
    place_id = case when p_place_id is not null then p_place_id
                    when p_to = 'doing' and v_changed then p_actor else place_id end,
    session_id = case when p_place_id is not null then case when p_place_id = p_actor then p_session_id end
                      when p_to = 'doing' and v_changed then p_session_id
                      when p_actor = place_id and p_session_id is not null then p_session_id
                      else session_id end,
    version = version + 1,
    updated_at = now()
  where id = p_card_id
  returning * into v_card;

  if v_leader then
    update board.lanes set leader_seen_at = now() where project_id = v_card.project_id and leader_place = p_actor;
  end if;

  perform board.lock_moves();
  insert into board.moves (card_id, project_id, from_stage, to_stage, note, owner_reason, done_summary, actor)
  values (v_card.id, v_card.project_id, v_from, p_to, v_card.note, v_card.owner_reason, v_card.done_summary, p_actor);
  return v_card;
end $$;

-- A card that fell in 'sem-projeto' (unknown folder) goes to its real project. Not a session tool: the PC service or
-- the Líder único (by the PC) does it.
create or replace function board.reclassify_card(p_card_id text, p_project_id text, p_actor text)
returns board.cards language plpgsql security definer set search_path = board, pg_temp as $$
declare v_card board.cards;
begin
  if not board.has_text(p_actor) then raise exception 'quem reclassifica é obrigatório (actor)'; end if;
  if not exists (select 1 from board.projects where id = p_project_id) or p_project_id = 'sem-projeto' then
    raise exception 'projeto % não existe', p_project_id;
  end if;
  update board.cards set project_id = p_project_id, note = left('projeto: ' || p_project_id, 200), version = version + 1, updated_at = now()
   where id = p_card_id and project_id = 'sem-projeto'
  returning * into v_card;
  if v_card.id is null then raise exception 'só cartão em sem-projeto se reclassifica (%)', p_card_id; end if;
  perform board.lock_moves();
  insert into board.moves (card_id, project_id, from_stage, to_stage, note, actor)
  values (v_card.id, v_card.project_id, v_card.stage, v_card.stage, v_card.note, p_actor);
  return v_card;
end $$;

-- The lane's Líder says he is alive, or the vigia that saw him does. `p_force` (the daemon, for the Líder the picture
-- shows) takes the lane at once; without it another place takes it only when the current Líder is gone (not seen for
-- 30 min). A new Líder never inherits the previous one's conversation.
drop function if exists board.touch_lane(text, text, text);
create or replace function board.touch_lane(p_project_id text, p_leader_place text, p_leader_session text default null, p_force boolean default false)
returns board.lanes language sql security definer set search_path = board, pg_temp as $$
  insert into board.lanes (project_id, leader_place, leader_session, leader_seen_at)
  values (p_project_id, p_leader_place, p_leader_session, now())
  on conflict (project_id) do update set
    leader_place = excluded.leader_place,
    leader_session = case when board.lanes.leader_place = excluded.leader_place
                          then coalesce(excluded.leader_session, board.lanes.leader_session)
                          else excluded.leader_session end,
    leader_seen_at = now()
  where p_force
     or board.lanes.leader_place is null
     or board.lanes.leader_place = excluded.leader_place
     or board.lanes.leader_seen_at is null
     or board.lanes.leader_seen_at < now() - interval '30 minutes'
  returning *
$$;

-- Ask the vigia to (re)open a lane's Líder. Idempotent by client_ref, and by project while one is pending.
create or replace function board.request_leader(p_project_id text, p_actor text, p_client_ref text)
returns board.leader_requests language plpgsql security definer set search_path = board, pg_temp as $$
declare v_req board.leader_requests;
begin
  if not board.has_text(p_actor) then raise exception 'quem pede é obrigatório (actor)'; end if;
  select * into v_req from board.leader_requests
   where client_ref = p_client_ref or (project_id = p_project_id and status = 'pending')
   order by (client_ref = p_client_ref) desc limit 1;
  if found then return v_req; end if;
  insert into board.leader_requests (project_id, actor, client_ref) values (p_project_id, p_actor, p_client_ref)
  on conflict do nothing
  returning * into v_req;
  if v_req.id is null then
    select * into v_req from board.leader_requests
     where client_ref = p_client_ref or (project_id = p_project_id and status = 'pending')
     order by (client_ref = p_client_ref) desc limit 1;
  end if;
  return v_req;
end $$;

-- The cron marks what it did, without bumping the card's version (it is not a move, and a session that read the card
-- must still be able to move it).
create or replace function board.mark_cron(p_card_id text, p_kind text)
returns void language plpgsql security definer set search_path = board, pg_temp as $$
begin
  if p_kind not in ('woken', 'charged', 'leader') then raise exception 'marca desconhecida: %', p_kind; end if;
  update board.cards set
    woken_at = case when p_kind = 'woken' then now() else woken_at end,
    charged_at = case when p_kind = 'charged' then now() else charged_at end,
    charge_count = case when p_kind = 'charged' then charge_count + 1 else charge_count end,
    leader_noticed_at = case when p_kind = 'leader' then now() else leader_noticed_at end
  where id = p_card_id;
end $$;

-- The vigia's note on a card in "Fazendo" (design §6: "vigia: parado sem justificativa"). Its own function, not
-- move_card: the card belongs to the place working on it, and move_card refuses any other actor unless it is the Líder;
-- passing p_as_leader would give the vigia the whole power of the Líder. This writes only the note, on a card still in
-- "Fazendo", without bumping the version (the session that read the card must still move it), and logs it in moves
-- (same stage: not news in owner_feed). False when there is nothing to write on (card gone or no longer in Fazendo).
create or replace function board.vigia_note(p_card_id text, p_note text)
returns boolean language plpgsql security definer set search_path = board, pg_temp as $$
declare v_card board.cards;
begin
  if not board.has_text(p_note) then raise exception 'a nota do vigia é obrigatória'; end if;
  update board.cards set note = left('vigia: ' || btrim(p_note), 200), updated_at = now()
   where id = p_card_id and stage = 'doing'
  returning * into v_card;
  if v_card.id is null then return false; end if;
  perform board.lock_moves();
  insert into board.moves (card_id, project_id, from_stage, to_stage, note, actor)
  values (v_card.id, v_card.project_id, 'doing', 'doing', v_card.note, 'vigia');
  return true;
end $$;

-- The vigia answers a request for a lane's Líder: done (woken) or failed (why not).
create or replace function board.resolve_leader_request(p_id bigint, p_status text, p_reason text default null)
returns board.leader_requests language plpgsql security definer set search_path = board, pg_temp as $$
declare v_req board.leader_requests;
begin
  if p_status not in ('done', 'failed') then raise exception 'estado desconhecido: %', p_status; end if;
  update board.leader_requests set status = p_status, reason = left(p_reason, 300), handled_at = now()
   where id = p_id and status = 'pending'
  returning * into v_req;
  return v_req;
end $$;

-- Views: the read API of every client (phone, page, PC service).
-- Dropped first: `project_cards` is `c.*`, and a new column in cards cannot be folded into the old view in place.
drop view if exists board.owner_feed, board.lanes_without_leader, board.project_cards, board.overview;
create or replace view board.overview with (security_invoker = true) as
select p.id as project_id, p.name, p.host,
       count(c.id) filter (where c.stage = 'inbox')         as inbox,
       count(c.id) filter (where c.stage = 'todo')          as todo,
       count(c.id) filter (where c.stage = 'doing')         as doing,
       count(c.id) filter (where c.stage = 'blocked')       as blocked,
       count(c.id) filter (where c.stage = 'waiting_owner') as waiting_owner,
       count(c.id) filter (where c.stage = 'done')          as done,
       count(c.id) filter (where c.stage <> 'done' and c.due < current_date) as overdue,
       min(c.stage_since) filter (where c.stage in ('doing', 'blocked'))   as oldest_parked_since,
       max(c.updated_at) as last_change
from board.projects p
left join board.cards c on c.project_id = p.id
group by p.id, p.name, p.host;

create or replace view board.project_cards with (security_invoker = true) as
select c.*, board.stage_rank(c.stage) as stage_rank
from board.cards c
order by c.project_id, c.front nulls last, board.stage_rank(c.stage), c.position, c.created_at;

create or replace view board.lanes_without_leader with (security_invoker = true) as
select p.id as project_id, l.leader_place, l.leader_session, l.leader_seen_at
from board.projects p
left join board.lanes l on l.project_id = p.id
where p.id <> 'sem-projeto'
  and (l.leader_place is null or l.leader_seen_at is null or l.leader_seen_at < now() - interval '30 minutes');

-- What reaches the Jobu: every move to "Esperando você", and owner's requests that reached "Feito".
create or replace view board.owner_feed with (security_invoker = true) as
select m.id, m.card_id, m.project_id, m.to_stage, m.note, m.owner_reason, m.done_summary,
       c.title, c.owner_request, c.requested_by, c.oraculo_id, m.at
from board.moves m
join board.cards c on c.id = m.card_id
where m.from_stage is distinct from m.to_stage   -- a note or justification edit in place is not news
  and (m.to_stage = 'waiting_owner' or (m.to_stage = 'done' and c.requested_by = 'dono'))
order by m.id;

-- Only the service key reaches the schema. Functions are executable by PUBLIC by default in Postgres: take it back,
-- or anon could call create_card through the API.
revoke all on schema board from public;
revoke execute on all functions in schema board from public;
revoke all on schema board from anon, authenticated;
revoke all on all tables in schema board from anon, authenticated;
revoke execute on all functions in schema board from anon, authenticated;
-- The service key READS the tables and views and WRITES only through the functions (security definer, fixed
-- search_path): a PATCH/POST straight to a table with the same key is refused, so no write skips the rules or the
-- history in `moves` (Revisor, #449).
grant usage on schema board to service_role;
revoke all on all tables in schema board from service_role;
revoke all on all sequences in schema board from service_role;
grant select on all tables in schema board to service_role;
grant execute on all functions in schema board to service_role;
