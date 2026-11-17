-- Prova das regras do quadro (docs/board/schema.sql), sem deixar rastro: roda numa transação e termina em ROLLBACK.
-- Uso: psql -v ON_ERROR_STOP=1 -f docs/board/probe.sql  (com o schema aplicado; no Supabase, como postgres).
-- Termina em erro se uma recusa esperada não acontecer, ou se um caminho permitido for recusado; "probe ok" no fim.
\set ON_ERROR_STOP 1
begin;
set local role service_role;

create function pg_temp.refused(p_sql text, p_needle text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'PROBE FALHOU: deveria recusar (%): %', p_needle, p_sql;
exception
  when raise_exception or insufficient_privilege or not_null_violation or check_violation then
    if sqlerrm like 'PROBE FALHOU%' then raise; end if;
    if position(p_needle in sqlerrm) = 0 then raise exception 'PROBE FALHOU: recusou com outra mensagem: % (esperava %)', sqlerrm, p_needle; end if;
end $$;

create function pg_temp.card(p_ref text) returns board.cards language sql as $$ select * from board.cards where client_ref = p_ref $$;

-- the key writes only through the functions
select pg_temp.refused($q$insert into board.projects (id, name) values ('probe-x', 'x')$q$, 'permission denied');
select pg_temp.refused($q$update board.cards set stage = 'waiting_owner'$q$, 'permission denied');

reset role;
insert into board.projects (id, name) values ('probe', 'Probe');
set local role service_role;
select board.touch_lane('probe', 'place:lider', 'sess-lider', true);

-- triage is the Líder's
select board.create_card('probe', 'T1', 'pedido', null, null, 'dono', 'place:devA', 'probe-1');
select pg_temp.refused(format($q$select board.move_card(%L, 'todo', 'place:devA', 1)$q$, (pg_temp.card('probe-1')).id), 'só o Líder do quadro tria');
select pg_temp.refused(format($q$select board.move_card(%L, 'doing', 'place:devA', 1)$q$, (pg_temp.card('probe-1')).id), 'cartão sem dono');
select pg_temp.refused($q$select board.create_card('probe', 'T', 'p', null, null, 'dono', 'place:devA', null, 'todo')$q$, 'só o Líder do quadro cria');
select board.move_card((pg_temp.card('probe-1')).id, 'todo', 'place:lider', 1, p_front => 'Frente', p_as_leader => true);

-- "Fazendo" is whoever takes it; another place does not close or take it
select board.move_card((pg_temp.card('probe-1')).id, 'doing', 'place:devA', 2, p_session_id => 'sess-A');
select pg_temp.refused(format($q$select board.move_card(%L, 'done', 'place:devB', 3, p_done_summary => 'fechei')$q$, (pg_temp.card('probe-1')).id), 'o cartão é de place:devA');
select pg_temp.refused(format($q$select board.move_card(%L, 'doing', 'place:devB', 3, p_justification => 'x', p_justification_link => 'https://x.y', p_justification_due => now() + interval '1 hour')$q$, (pg_temp.card('probe-1')).id), 'o cartão é de place:devA');

-- the vigia notes a card in "Fazendo" of another place without the Líder's power and without bumping the version
select pg_temp.refused(format($q$select board.vigia_note(%L, E' \t')$q$, (pg_temp.card('probe-1')).id), 'nota do vigia');
do $$ begin
  if not board.vigia_note((pg_temp.card('probe-1')).id, 'parado sem justificativa') then raise exception 'PROBE FALHOU: vigia_note não gravou em Fazendo'; end if;
  if (pg_temp.card('probe-1')).note <> 'vigia: parado sem justificativa' or (pg_temp.card('probe-1')).version <> 3 then raise exception 'PROBE FALHOU: nota do vigia ou versão'; end if;
end $$;

-- "Esperando você": Líder and reason
select pg_temp.refused(format($q$select board.move_card(%L, 'waiting_owner', 'place:devA', 3, p_owner_reason => 'money')$q$, (pg_temp.card('probe-1')).id), 'só o Líder do quadro põe');
select pg_temp.refused(format($q$select board.move_card(%L, 'waiting_owner', 'place:lider', 3, p_owner_reason => 'parece', p_as_leader => true)$q$, (pg_temp.card('probe-1')).id), 'só por');

-- blanks, actor, justification, summary
select pg_temp.refused(format($q$select board.move_card(%L, 'done', 'place:devA', 3, p_done_summary => E'\n\t')$q$, (pg_temp.card('probe-1')).id), 'exige o resumo');
select pg_temp.refused(format($q$select board.move_card(%L, 'blocked', 'place:devA', 3, p_justification => E'\t', p_justification_link => 'https://x.y', p_justification_due => now() + interval '1 hour')$q$, (pg_temp.card('probe-1')).id), 'exige justificativa');
select pg_temp.refused(format($q$select board.move_card(%L, 'blocked', 'place:devA', 3, p_justification => 'x', p_justification_link => E'https://x.y\n', p_justification_due => now() + interval '1 hour')$q$, (pg_temp.card('probe-1')).id), 'exige justificativa');
select pg_temp.refused(format($q$select board.move_card(%L, 'done', null, 3, p_done_summary => 'x')$q$, (pg_temp.card('probe-1')).id), 'quem move é obrigatório');
select pg_temp.refused(format($q$select board.move_card(%L, 'done', 'place:devA', null, p_done_summary => 'x')$q$, (pg_temp.card('probe-1')).id), 'mudou desde a sua leitura');
select board.move_card((pg_temp.card('probe-1')).id, 'done', 'place:devA', 3, p_done_summary => 'entregue');
do $$ begin if board.vigia_note((pg_temp.card('probe-1')).id, 'x') then raise exception 'PROBE FALHOU: vigia_note fora de Fazendo'; end if; end $$;

-- the lane: the Líder the picture shows takes it at once and never inherits the old conversation; without force, a
-- live Líder keeps it
select board.touch_lane('probe', 'place:outro', 'sess-outro');
do $$ begin if (select leader_place from board.lanes where project_id = 'probe') <> 'place:lider' then raise exception 'PROBE FALHOU: raia trocou sem force'; end if; end $$;
select board.touch_lane('probe', 'place:novo', null, true);
do $$ begin
  if (select leader_place from board.lanes where project_id = 'probe') <> 'place:novo' then raise exception 'PROBE FALHOU: Líder novo não tomou a raia'; end if;
  if (select leader_session from board.lanes where project_id = 'probe') is not null then raise exception 'PROBE FALHOU: Líder novo herdou a conversa do antigo'; end if;
end $$;

-- the history: every move is in moves, and the feed sees the owner's request done
do $$ begin
  if (select count(*) from board.moves m join board.cards c on c.id = m.card_id where c.client_ref = 'probe-1') <> 5 then raise exception 'PROBE FALHOU: moves não tem os 4 movimentos e a nota do vigia'; end if;
  if not exists (select 1 from board.owner_feed f join board.cards c on c.id = f.card_id where c.client_ref = 'probe-1' and f.to_stage = 'done') then raise exception 'PROBE FALHOU: owner_feed sem o Feito do dono'; end if;
end $$;

select 'probe ok' as resultado;
rollback;
