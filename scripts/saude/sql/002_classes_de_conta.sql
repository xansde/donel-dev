-- Classes de conta (pedido do Líder do quadro, 16/11): separa as esgotadas, que renovam e mostram quando, das que estão
-- fora (desligada, token morto, Reconectar). Só acrescenta colunas e refaz visões/funções do próprio schema saude.

alter table saude.conta_amostra  add column if not exists classe text;          -- com_cota | esgotada | fora
alter table saude.gateway_minuto add column if not exists esgotadas integer;    -- em espera de renovação
alter table saude.gateway_minuto add column if not exists fora integer;         -- desligadas ou com login morto
alter table saude.gateway_minuto add column if not exists proxima_volta timestamptz;  -- a esgotada que renova primeiro
alter table saude.gateway_minuto add column if not exists voltam_1h integer;    -- esgotadas que renovam na próxima hora
alter table saude.gateway_hora   add column if not exists esgotadas_med real;
alter table saude.gateway_hora   add column if not exists fora_max integer;

create or replace function saude.compactar(p_horas integer default 3)
returns jsonb language plpgsql security definer set search_path = saude, pg_temp as $$
declare
  desde timestamptz := date_trunc('hour', now()) - make_interval(hours => greatest(p_horas, 1));
  n_m int; n_g int; n_c int; d_m int; d_g int; d_c int; d_h int := 0; x int;
begin
  insert into saude.maquina_hora as h
  select maquina, date_trunc('hour', em), count(*),
         avg(cpu_pct), max(cpu_pct), avg(carga1), max(carga1), max(ncpu), max(ram_total_mb),
         avg(ram_pct), max(ram_pct), max(ram_usada_mb), avg(swap_pct), max(swap_pct), max(disco_pct),
         avg(rede_rx_kb_s), max(rede_rx_kb_s), avg(rede_tx_kb_s), max(rede_tx_kb_s),
         avg(sessoes_claude), max(sessoes_claude), max(coletor_rss_mb)
  from saude.maquina_minuto where em >= desde group by 1, 2
  on conflict (maquina, hora) do update set
    amostras = excluded.amostras, cpu_med = excluded.cpu_med, cpu_max = excluded.cpu_max,
    carga1_med = excluded.carga1_med, carga1_max = excluded.carga1_max, ncpu = excluded.ncpu,
    ram_total_mb = excluded.ram_total_mb, ram_pct_med = excluded.ram_pct_med, ram_pct_max = excluded.ram_pct_max,
    ram_usada_mb_max = excluded.ram_usada_mb_max, swap_pct_med = excluded.swap_pct_med, swap_pct_max = excluded.swap_pct_max,
    disco_pct_max = excluded.disco_pct_max, rede_rx_kb_s_med = excluded.rede_rx_kb_s_med,
    rede_rx_kb_s_max = excluded.rede_rx_kb_s_max, rede_tx_kb_s_med = excluded.rede_tx_kb_s_med,
    rede_tx_kb_s_max = excluded.rede_tx_kb_s_max, sessoes_med = excluded.sessoes_med, sessoes_max = excluded.sessoes_max,
    coletor_rss_mb_max = excluded.coletor_rss_mb_max;
  get diagnostics n_m = row_count;

  insert into saude.gateway_hora as h (gateway, hora, amostras, alcancavel_pct, contas_max, com_cota_med, com_cota_min,
                                       ativas_med, em_429_med, em_429_max, req_ok, req_falha, esgotadas_med, fora_max)
  select gateway, date_trunc('hour', em), count(*),
         100.0 * avg(case when alcancavel then 1 else 0 end), max(contas),
         avg(com_cota), min(com_cota), avg(ativas), avg(em_429), max(em_429),
         coalesce(sum(req_ok), 0), coalesce(sum(req_falha), 0), avg(esgotadas), max(fora)
  from saude.gateway_minuto where em >= desde group by 1, 2
  on conflict (gateway, hora) do update set
    amostras = excluded.amostras, alcancavel_pct = excluded.alcancavel_pct, contas_max = excluded.contas_max,
    com_cota_med = excluded.com_cota_med, com_cota_min = excluded.com_cota_min, ativas_med = excluded.ativas_med,
    em_429_med = excluded.em_429_med, em_429_max = excluded.em_429_max, req_ok = excluded.req_ok, req_falha = excluded.req_falha,
    esgotadas_med = excluded.esgotadas_med, fora_max = excluded.fora_max;
  get diagnostics n_g = row_count;

  insert into saude.conta_hora as h
  select gateway, conta, date_trunc('hour', em), count(*), max(uso5h), max(uso7d),
         coalesce(sum(req_ok), 0), coalesce(sum(req_falha), 0), coalesce(bool_or(em_429), false)
  from saude.conta_amostra where em >= desde group by 1, 2, 3
  on conflict (gateway, conta, hora) do update set
    amostras = excluded.amostras, uso5h_max = excluded.uso5h_max, uso7d_max = excluded.uso7d_max,
    req_ok = excluded.req_ok, req_falha = excluded.req_falha, teve_429 = excluded.teve_429;
  get diagnostics n_c = row_count;

  delete from saude.maquina_minuto where em < now() - interval '7 days';
  get diagnostics d_m = row_count;
  delete from saude.gateway_minuto where em < now() - interval '7 days';
  get diagnostics d_g = row_count;
  delete from saude.conta_amostra where em < now() - interval '7 days';
  get diagnostics d_c = row_count;
  delete from saude.maquina_hora where hora < now() - interval '90 days';
  get diagnostics x = row_count; d_h := d_h + x;
  delete from saude.gateway_hora where hora < now() - interval '90 days';
  get diagnostics x = row_count; d_h := d_h + x;
  delete from saude.conta_hora where hora < now() - interval '90 days';
  get diagnostics x = row_count; d_h := d_h + x;
  delete from saude.alerta where coalesce(fim, inicio) < now() - interval '90 days';

  return jsonb_build_object('horas_maquina', n_m, 'horas_gateway', n_g, 'horas_conta', n_c,
                            'apagado_minuto', d_m + d_g + d_c, 'apagado_hora', d_h);
end $$;

-- A série de gateway ganha esgotadas e fora: muda o tipo de retorno, então a função é recriada.
drop function if exists saude.gateway_serie(text);
create function saude.gateway_serie(p_janela text)
returns table (gateway text, t timestamptz, amostras bigint, alcancavel_pct real, contas integer, com_cota real,
               com_cota_min integer, ativas real, em_429 real, em_429_max integer, req_ok bigint, req_falha bigint,
               esgotadas real, fora integer)
language sql stable as $$
  with p as (select * from saude._passo(p_janela))
  select g.gateway, to_timestamp(floor(extract(epoch from g.em) / p.passo) * p.passo), count(*),
         (100.0 * avg(case when alcancavel then 1 else 0 end))::real, max(contas), avg(com_cota)::real, min(com_cota),
         avg(ativas)::real, avg(em_429)::real, max(em_429), coalesce(sum(g.req_ok), 0), coalesce(sum(g.req_falha), 0),
         avg(esgotadas)::real, max(fora)
  from saude.gateway_minuto g, p where p_janela = '24h' and g.em > now() - p.dur group by 1, 2
  union all
  select h.gateway, to_timestamp(floor(extract(epoch from h.hora) / p.passo) * p.passo), sum(amostras),
         (sum(alcancavel_pct * amostras) / nullif(sum(amostras), 0))::real, max(contas_max),
         (sum(com_cota_med * amostras) / nullif(sum(amostras), 0))::real, min(com_cota_min),
         (sum(ativas_med * amostras) / nullif(sum(amostras), 0))::real,
         (sum(em_429_med * amostras) / nullif(sum(amostras), 0))::real, max(em_429_max), sum(h.req_ok), sum(h.req_falha),
         (sum(esgotadas_med * amostras) / nullif(sum(amostras), 0))::real, max(fora_max)
  from saude.gateway_hora h, p where p_janela <> '24h' and h.hora > now() - p.dur group by 1, 2
  order by 1, 2
$$;

drop view if exists saude.v_gateway_atual;
create view saude.v_gateway_atual as
  select distinct on (gateway) *, extract(epoch from now() - em)::integer as idade_s
  from saude.gateway_minuto where em > now() - interval '7 days' order by gateway, em desc;

create or replace view saude.v_conta_atual as
  with ult as (
    select distinct on (gateway, conta) * from saude.conta_amostra
    where em > now() - interval '3 hours' order by gateway, conta, em desc
  ), dia as (
    select gateway, conta, sum(req_ok)::bigint as req_ok_24h, sum(req_falha)::bigint as req_falha_24h,
           max(em) filter (where req_ok > 0) as ultimo_uso
    from saude.conta_amostra where em > now() - interval '24 hours' group by 1, 2
  )
  select u.gateway, u.conta, u.em, u.estado, u.disponivel, u.desligada, u.uso5h, u.volta5h, u.uso7d, u.volta7d,
         u.status_cota, u.em_429 and coalesce(u.cooldown_ate > now(), true) as em_429, u.cooldown_ate, u.motivo,
         coalesce(d.req_ok_24h, 0) as req_ok_24h, coalesce(d.req_falha_24h, 0) as req_falha_24h, d.ultimo_uso,
         (u.disponivel and coalesce(u.uso5h, 0) < 100 and coalesce(u.uso7d, 0) < 100) as tem_cota,
         u.classe
  from ult u left join dia d using (gateway, conta);

grant select on all tables in schema saude to saude_gravador, saude_leitor;
grant execute on function saude.gateway_serie(text) to saude_gravador, saude_leitor;
revoke all on function saude.compactar(integer) from public;
grant execute on function saude.compactar(integer) to saude_gravador;
