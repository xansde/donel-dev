-- Lista de sessões por máquina (mapa do rig, t-16393812): o coletor grava em maquina_minuto.extra->'sessoes'.
-- Só a amostra recente precisa dela: depois de 1 h a lista sai do extra (fica a contagem em sessoes_claude).
create or replace function saude.podar_sessoes()
returns integer language sql security definer set search_path = saude, pg_temp as $$
  with x as (
    update saude.maquina_minuto set extra = extra - 'sessoes' - 'sessoes_omitidas'
    where em < now() - interval '1 hour' and em > now() - interval '8 days' and extra ? 'sessoes'
    returning 1)
  select count(*)::integer from x
$$;
revoke all on function saude.podar_sessoes() from public;
grant execute on function saude.podar_sessoes() to saude_gravador;
