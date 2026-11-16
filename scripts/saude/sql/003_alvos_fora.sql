-- Máquinas e gateways que saíram do escopo (t-16393812): a página os mostra como "fora desde", sem alerta.
-- 16/11: a vps-people e o gateway da People saíram pela t-2abb614a (VPS entregue ao time de People).
create table if not exists saude.alvo_fora (
  alvo    text        primary key,          -- nome da máquina (ex.: people) ou gw:<gateway> (ex.: gw:people)
  desde   timestamptz not null,
  motivo  text        not null
);
insert into saude.alvo_fora (alvo, desde, motivo) values
  ('people',    '2026-11-16 18:29:00-03', 'saída da VPS de People (t-2abb614a)'),
  ('gw:people', '2026-11-16 18:29:00-03', 'saída da VPS de People (t-2abb614a)')
on conflict (alvo) do nothing;
grant select on saude.alvo_fora to saude_gravador, saude_leitor;
