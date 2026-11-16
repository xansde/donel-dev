-- Saúde das máquinas e das contas (t-16393812). Supabase oraculo-harrow, schema próprio `saude`.
-- Idempotente: pode rodar de novo. As senhas dos papéis entram por variável do psql (aplicar_schema.py), nunca aqui.
--   psql -v senha_gravador=... -v senha_leitor=... -f 001_saude.sql
-- Retenção: minuto 7 dias; hora 90 dias (saude.compactar).

create schema if not exists saude;
revoke all on schema saude from public;

-- ---------------------------------------------------------------------------------------------------------------
-- Máquinas: uma linha por máquina por minuto (bruto, 7 dias)
create table if not exists saude.maquina_minuto (
  maquina         text        not null,          -- pc | vps-pessoal | homologacoes | people
  em              timestamptz not null,          -- hora da medida (UTC), truncada ao minuto pelo coletor
  cpu_pct         real,                          -- 0..100, média de todos os núcleos no último intervalo
  carga1          real,                          -- load average (no PC: equivalente, ver CONTRATO.md)
  carga5          real,
  carga15         real,
  ncpu            smallint,
  ram_total_mb    integer,
  ram_usada_mb    integer,                       -- total - disponível
  ram_pct         real,
  swap_total_mb   integer,                       -- no PC: arquivo de paginação
  swap_usada_mb   integer,
  swap_pct        real,
  disco_total_gb  real,                          -- disco do sistema (/ ou C:)
  disco_usado_gb  real,
  disco_pct       real,
  rede_rx_kb_s    real,                          -- KB/s recebidos (todas as interfaces menos loopback/containers)
  rede_tx_kb_s    real,
  sessoes_claude  smallint,                      -- processos claude de topo (uma por sessão)
  coletor_rss_mb  real,                          -- RAM do próprio coletor (pico da execução ou working set)
  extra           jsonb,                         -- top processos por RAM, discos extras etc.
  recebido_em     timestamptz not null default now(),
  primary key (maquina, em)
);
create index if not exists maquina_minuto_em on saude.maquina_minuto (em);

create table if not exists saude.maquina_hora (
  maquina           text        not null,
  hora              timestamptz not null,
  amostras          integer     not null,
  cpu_med           real, cpu_max real,
  carga1_med        real, carga1_max real,
  ncpu              smallint,
  ram_total_mb      integer,
  ram_pct_med       real, ram_pct_max real, ram_usada_mb_max integer,
  swap_pct_med      real, swap_pct_max real,
  disco_pct_max     real,
  rede_rx_kb_s_med  real, rede_rx_kb_s_max real,
  rede_tx_kb_s_med  real, rede_tx_kb_s_max real,
  sessoes_med       real, sessoes_max smallint,
  coletor_rss_mb_max real,
  primary key (maquina, hora)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Gateways de contas Claude (CLIProxyAPI): uma linha por gateway por minuto
create table if not exists saude.gateway_minuto (
  gateway          text        not null,          -- pc | homolog | people
  em               timestamptz not null,
  alcancavel       boolean     not null,
  contas           integer,                       -- contas Claude no pool
  ativas           integer,                       -- estado active e não indisponível
  com_cota         integer,                       -- ativas com 5 h e 7 d < 100%
  em_429           integer,                       -- em espera por cota/429 (cooldown vigente)
  com_erro         integer,
  desligadas       integer,
  req_ok           integer,                       -- pedidos atendidos no minuto (delta dos acumulados)
  req_falha        integer,
  contas_no_minuto integer,                       -- quantas contas atenderam no minuto
  conta_ativa      text,                          -- a que mais atendeu no minuto
  erro             text,                          -- quando não alcançável
  recebido_em      timestamptz not null default now(),
  primary key (gateway, em)
);
create index if not exists gateway_minuto_em on saude.gateway_minuto (em);

create table if not exists saude.gateway_hora (
  gateway        text        not null,
  hora           timestamptz not null,
  amostras       integer     not null,
  alcancavel_pct real,
  contas_max     integer,
  com_cota_med   real, com_cota_min integer,
  ativas_med     real,
  em_429_med     real, em_429_max integer,
  req_ok         integer,
  req_falha      integer,
  primary key (gateway, hora)
);

-- Contas: uma linha quando algo muda (uso, estado, pedidos) e uma foto de todas a cada hora (foto = true)
create table if not exists saude.conta_amostra (
  gateway      text        not null,
  conta        text        not null,              -- e-mail da conta
  em           timestamptz not null,
  foto         boolean     not null default false,
  estado       text,                              -- active | error | disabled
  disponivel   boolean,                           -- pode atender agora
  desligada    boolean,
  uso5h        real,                              -- % da janela de 5 h (0..100)
  volta5h      timestamptz,                       -- quando a janela de 5 h renova
  uso7d        real,                              -- % da janela de 7 dias
  volta7d      timestamptz,
  status_cota  text,                              -- allowed | allowed_warning | rejected (cabeçalho da Anthropic)
  em_429       boolean,                           -- cooldown por cota/429 vigente
  cooldown_ate timestamptz,
  motivo       text,                              -- status_message do gateway (curto)
  req_ok       integer,                           -- atendidos desde a amostra anterior
  req_falha    integer,
  ok_total     bigint,                            -- acumulados do gateway (zeram quando ele reinicia)
  falha_total  bigint,
  recebido_em  timestamptz not null default now(),
  primary key (gateway, conta, em)
);
create index if not exists conta_amostra_em on saude.conta_amostra (em);

create table if not exists saude.conta_hora (
  gateway    text        not null,
  conta      text        not null,
  hora       timestamptz not null,
  amostras   integer     not null,
  uso5h_max  real,
  uso7d_max  real,
  req_ok     integer,
  req_falha  integer,
  teve_429   boolean,
  primary key (gateway, conta, hora)
);

-- Alertas abertos e fechados (o central grava; o app lê)
create table if not exists saude.alerta (
  chave      text        not null,                -- ex.: ram:vps-pessoal, cota:pc, silencio:people
  inicio     timestamptz not null,
  fim        timestamptz,                         -- null = aberto
  nivel      text        not null,                -- aviso | grave
  alvo       text        not null,                -- máquina ou gateway
  texto      text        not null,
  enviado_a  text,                                -- lider-quadro:<quadro> | anotado | sem-emissor
  primary key (chave, inicio)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Compactação: agrega por hora as horas recentes (inclui a hora corrente, que vai sendo refeita) e apaga o velho.
-- p_horas = quantas horas para trás refazer (3 a cada 5 min; 192 uma vez por dia, para dados que chegaram atrasados).
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

  insert into saude.gateway_hora as h
  select gateway, date_trunc('hour', em), count(*),
         100.0 * avg(case when alcancavel then 1 else 0 end), max(contas),
         avg(com_cota), min(com_cota), avg(ativas), avg(em_429), max(em_429),
         coalesce(sum(req_ok), 0), coalesce(sum(req_falha), 0)
  from saude.gateway_minuto where em >= desde group by 1, 2
  on conflict (gateway, hora) do update set
    amostras = excluded.amostras, alcancavel_pct = excluded.alcancavel_pct, contas_max = excluded.contas_max,
    com_cota_med = excluded.com_cota_med, com_cota_min = excluded.com_cota_min, ativas_med = excluded.ativas_med,
    em_429_med = excluded.em_429_med, em_429_max = excluded.em_429_max, req_ok = excluded.req_ok, req_falha = excluded.req_falha;
  get diagnostics n_g = row_count;

  insert into saude.conta_hora as h
  select gateway, conta, date_trunc('hour', em), count(*), max(uso5h), max(uso7d),
         coalesce(sum(req_ok), 0), coalesce(sum(req_falha), 0), coalesce(bool_or(em_429), false)
  from saude.conta_amostra where em >= desde group by 1, 2, 3
  on conflict (gateway, conta, hora) do update set
    amostras = excluded.amostras, uso5h_max = excluded.uso5h_max, uso7d_max = excluded.uso7d_max,
    req_ok = excluded.req_ok, req_falha = excluded.req_falha, teve_429 = excluded.teve_429;
  get diagnostics n_c = row_count;

  -- Antes de apagar o bruto de mais de 7 dias, garante que as horas dele existem (dado que chegou atrasado).
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

-- ---------------------------------------------------------------------------------------------------------------
-- Leitura (página e app). Janelas: '24h' (passo 5 min, do bruto), '7d' (1 h), '30d' (4 h), '90d' (1 dia), das horas.
create or replace function saude._passo(p_janela text) returns table (dur interval, passo integer)
language sql immutable as $$
  select case p_janela when '24h' then interval '24 hours' when '7d' then interval '7 days'
                       when '30d' then interval '30 days' when '90d' then interval '90 days' end,
         case p_janela when '24h' then 300 when '7d' then 3600 when '30d' then 14400 when '90d' then 86400 end
$$;

create or replace function saude.maquina_serie(p_janela text)
returns table (maquina text, t timestamptz, amostras bigint, cpu real, cpu_max real, carga1 real, carga1_max real,
               ncpu smallint, ram_pct real, ram_pct_max real, ram_usada_mb integer, ram_total_mb integer,
               swap_pct real, swap_pct_max real, disco_pct real, rx real, rx_max real, tx real, tx_max real,
               sessoes real, sessoes_max smallint, coletor_rss_mb real)
language sql stable as $$
  with p as (select * from saude._passo(p_janela))
  select m.maquina, to_timestamp(floor(extract(epoch from m.em) / p.passo) * p.passo), count(*),
         avg(cpu_pct)::real, max(cpu_pct), avg(carga1)::real, max(carga1), max(ncpu), avg(ram_pct)::real, max(ram_pct),
         max(ram_usada_mb), max(ram_total_mb), avg(swap_pct)::real, max(swap_pct), max(disco_pct),
         avg(rede_rx_kb_s)::real, max(rede_rx_kb_s), avg(rede_tx_kb_s)::real, max(rede_tx_kb_s),
         avg(sessoes_claude)::real, max(sessoes_claude), max(coletor_rss_mb)
  from saude.maquina_minuto m, p where p_janela = '24h' and m.em > now() - p.dur group by 1, 2
  union all
  select h.maquina, to_timestamp(floor(extract(epoch from h.hora) / p.passo) * p.passo), sum(amostras),
         (sum(cpu_med * amostras) / nullif(sum(amostras), 0))::real, max(cpu_max),
         (sum(carga1_med * amostras) / nullif(sum(amostras), 0))::real, max(carga1_max), max(ncpu),
         (sum(ram_pct_med * amostras) / nullif(sum(amostras), 0))::real, max(ram_pct_max), max(ram_usada_mb_max),
         max(ram_total_mb), (sum(swap_pct_med * amostras) / nullif(sum(amostras), 0))::real, max(swap_pct_max),
         max(disco_pct_max), (sum(rede_rx_kb_s_med * amostras) / nullif(sum(amostras), 0))::real, max(rede_rx_kb_s_max),
         (sum(rede_tx_kb_s_med * amostras) / nullif(sum(amostras), 0))::real, max(rede_tx_kb_s_max),
         (sum(sessoes_med * amostras) / nullif(sum(amostras), 0))::real, max(sessoes_max), max(coletor_rss_mb_max)
  from saude.maquina_hora h, p where p_janela <> '24h' and h.hora > now() - p.dur group by 1, 2
  order by 1, 2
$$;

create or replace function saude.gateway_serie(p_janela text)
returns table (gateway text, t timestamptz, amostras bigint, alcancavel_pct real, contas integer, com_cota real,
               com_cota_min integer, ativas real, em_429 real, em_429_max integer, req_ok bigint, req_falha bigint)
language sql stable as $$
  with p as (select * from saude._passo(p_janela))
  select g.gateway, to_timestamp(floor(extract(epoch from g.em) / p.passo) * p.passo), count(*),
         (100.0 * avg(case when alcancavel then 1 else 0 end))::real, max(contas), avg(com_cota)::real, min(com_cota),
         avg(ativas)::real, avg(em_429)::real, max(em_429), coalesce(sum(g.req_ok), 0), coalesce(sum(g.req_falha), 0)
  from saude.gateway_minuto g, p where p_janela = '24h' and g.em > now() - p.dur group by 1, 2
  union all
  select h.gateway, to_timestamp(floor(extract(epoch from h.hora) / p.passo) * p.passo), sum(amostras),
         (sum(alcancavel_pct * amostras) / nullif(sum(amostras), 0))::real, max(contas_max),
         (sum(com_cota_med * amostras) / nullif(sum(amostras), 0))::real, min(com_cota_min),
         (sum(ativas_med * amostras) / nullif(sum(amostras), 0))::real,
         (sum(em_429_med * amostras) / nullif(sum(amostras), 0))::real, max(em_429_max), sum(h.req_ok), sum(h.req_falha)
  from saude.gateway_hora h, p where p_janela <> '24h' and h.hora > now() - p.dur group by 1, 2
  order by 1, 2
$$;

-- Série por conta (só as que atenderam ou tiveram 429 na janela; o resto fica de fora para não pesar).
create or replace function saude.conta_serie(p_janela text, p_limite integer default 60)
returns table (gateway text, conta text, t timestamptz, uso5h real, uso7d real, req_ok bigint, req_falha bigint, teve_429 boolean)
language sql stable as $$
  with p as (select * from saude._passo(p_janela)),
  base as (
    select c.gateway, c.conta, c.em as t0, c.uso5h, c.uso7d, c.req_ok::bigint as req_ok, c.req_falha::bigint as req_falha, c.em_429 as e429
    from saude.conta_amostra c, p where p_janela = '24h' and c.em > now() - p.dur
    union all
    select h.gateway, h.conta, h.hora, h.uso5h_max, h.uso7d_max, h.req_ok, h.req_falha, h.teve_429
    from saude.conta_hora h, p where p_janela <> '24h' and h.hora > now() - p.dur
  ),
  top as (
    select b.gateway, b.conta from base b group by 1, 2
    having sum(coalesce(b.req_ok, 0) + coalesce(b.req_falha, 0)) > 0 or bool_or(coalesce(b.e429, false))
    order by sum(coalesce(b.req_ok, 0)) desc limit greatest(p_limite, 1)
  )
  select b.gateway, b.conta, to_timestamp(floor(extract(epoch from b.t0) / p.passo) * p.passo),
         max(b.uso5h), max(b.uso7d), coalesce(sum(b.req_ok), 0)::bigint, coalesce(sum(b.req_falha), 0)::bigint,
         coalesce(bool_or(b.e429), false)
  from base b join top using (gateway, conta), p group by 1, 2, 3 order by 1, 2, 3
$$;

create or replace view saude.v_maquina_atual as
  select distinct on (maquina) *, extract(epoch from now() - em)::integer as idade_s
  from saude.maquina_minuto where em > now() - interval '7 days' order by maquina, em desc;

create or replace view saude.v_gateway_atual as
  select distinct on (gateway) *, extract(epoch from now() - em)::integer as idade_s
  from saude.gateway_minuto where em > now() - interval '7 days' order by gateway, em desc;

-- Estado atual de cada conta: a última linha (mudança ou foto de hora) das últimas 3 h, com o tráfego de 24 h.
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
         (u.disponivel and coalesce(u.uso5h, 0) < 100 and coalesce(u.uso7d, 0) < 100) as tem_cota
  from ult u left join dia d using (gateway, conta);

create or replace view saude.v_alerta_aberto as
  select * from saude.alerta where fim is null order by inicio desc;

-- ---------------------------------------------------------------------------------------------------------------
-- Papéis. saude_gravador: coletores e central (insere, lê, fecha alerta, compacta). saude_leitor: app e página (só lê).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'saude_gravador') then create role saude_gravador login; end if;
  if not exists (select 1 from pg_roles where rolname = 'saude_leitor') then create role saude_leitor login; end if;
end $$;
alter role saude_gravador with login password :'senha_gravador';
alter role saude_leitor with login password :'senha_leitor';
alter role saude_gravador set statement_timeout = '60s';
alter role saude_leitor set statement_timeout = '30s';

grant usage on schema saude to saude_gravador, saude_leitor;
grant select on all tables in schema saude to saude_gravador, saude_leitor;
grant insert on saude.maquina_minuto, saude.gateway_minuto, saude.conta_amostra, saude.alerta to saude_gravador;
grant update (fim, enviado_a) on saude.alerta to saude_gravador;
revoke all on function saude.compactar(integer) from public;
grant execute on function saude.compactar(integer) to saude_gravador;
grant execute on function saude._passo(text), saude.maquina_serie(text), saude.gateway_serie(text),
                          saude.conta_serie(text, integer) to saude_gravador, saude_leitor;
