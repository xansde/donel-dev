# Quadro de tarefas no SQLite da VPS (t-1e354d15, 20/11/2026)

Emenda ao desenho [`quadro-de-tarefas.md`](quadro-de-tarefas.md), que pôs o quadro num schema `board` do Supabase
pessoal (16/11). Em 18/11 o dono tirou o ledger do Supabase ("Vamos trazer para um sqlite local mesmo... sem custos",
`src/oraculo/ledger-sqlite.ts`) e o espelho saiu em 19/11 (passo 12 da correção da estrutura). Instalar o `board` no
Supabase agora recriaria a dependência que ele acabou de tirar, e pediria o ok dele para mexer no banco. O código do
quadro (#449, #451–#454) está na `staging`, mas nunca foi ligado.

## Decisão

O quadro mora num SQLite próprio na VPS pessoal, `~/.donel/board/board.sqlite`, ao lado do `ledger.sqlite` do
Oráculo e separado dele (o desenho já mandava não tocar `tarefa_*`). Regras, tools `card_*`, cron, vigia e página
continuam sendo os que estão na `staging`; muda só o armazenamento.

- **Interface:** um `createBoardSqlite(file)` implementa `BoardStore & BoardCronStore`
  (`src/oraculo/board-client.ts`), com a mesma semântica das funções de `docs/board/schema.sql`: `create_card`
  (idempotente por `client_ref`, corte de título e frente, projeto desconhecido cai em `sem-projeto`), `move_card`
  (compare-and-swap por `version`, as regras de `rules.ts` aplicadas dentro da transação, recusa com a frase da
  regra), `touch_lane`, `mark_cron`, `vigia_note`, `resolve_leader_request`, `request_leader`, `reclassify_card`, e
  as views `overview`, `project_cards`, `owner_feed` e `lanes_without_leader` como consultas.
- **Quem escreve:** o daemon (tools `card_*`, pelo portão) e o `board-cron`, dois processos no mesmo arquivo: WAL,
  `busy_timeout`, toda gravação em `BEGIN IMMEDIATE`. O histórico `moves` é só de acréscimo (é o andamento).
- **Configuração:** `~/.donel/board/sqlite.json` (`{ "file": "<caminho>" }`). Com ele, daemon e cron usam o SQLite;
  sem ele e com `supabase.json`, o Supabase de antes (o caminho não é apagado); sem nenhum dos dois, o quadro fica
  desligado, como hoje. Nada fixo no código, porque o repo vai ao público.
- **Projetos:** `projects` (id, name, host, aliases) semeado por um script de admin a partir dos quadros e do
  `projectPath` das tarefas vivas do Oráculo.
- **Semente:** um script só de leitura no Oráculo (`ledger.sqlite` aberto `readOnly`) cria um cartão por tarefa viva,
  com `oraculo_id`, pelo mapa do §8 do desenho. É idempotente por `client_ref = oraculo:<id>`.
- **Página:** o `board-cron ronda` grava `~/entregas/quadro/index.html` (quadro geral + tabela por projeto agrupada
  por frente). É a prova do item 1.

## O que a implementação fixou (PR deste desenho)

- `src/oraculo/board-sqlite.ts`: `createBoardSqlite(file)` com as tabelas de `schema.sql` (mesmos CHECKs). O
  `move_card` aplica o `checkMove` de `rules.ts` dentro do `BEGIN IMMEDIATE` e grava com `WHERE version = ?`; o que só
  morava no SQL foi portado ali (justificativa que some ao mudar de coluna, zerar cobranças e marcas do cron, quem
  vira dono do cartão em "Fazendo", `leader_seen_at` do Líder). Funções de admin que não são tool de sessão:
  `upsertProject`, `reclassifyCard`, `requestLeader`, `ownerFeed` e `lanesWithoutLeader`. Arquivo novo nasce 600.
- `chooseBoard` (mesmo arquivo) decide no daemon (`entregador.ts`) e no `board-cron`: `sqlite.json` válido → SQLite;
  `sqlite.json` inválido → quadro desligado com aviso (nunca cai no Supabase sem o dono saber); sem ele,
  `supabase.json` como antes. `DONEL_BOARD_SQLITE_CONFIG` troca o caminho do `sqlite.json` (teste).
- Semente = `board-cron.mjs semear [--seco] [--ledger <arquivo>] [--host <host>] [--pc-raiz <pasta>]`
  (`src/board-cron/semente.ts`). Lê o `ledger.sqlite` do Oráculo com conexão `readOnly` (ou um `ledger.json`
  exportado). Projeto = nome da pasta em slug (`Donel Dev` → `donel-dev`); aliases = a pasta como o Oráculo a tem, a
  mesma `seazone/<Pasta>` no home da VPS e na raiz do PC (tirada dos próprios caminhos Windows do ledger, ou
  `--pc-raiz`). Nenhum caminho fixo no código.
- **Mudança honesta no mapa do §8:** o desenho mandava "travada/esperando → Travado com justificativa importado;
  preencher", mas Travado exige link e prazo futuro, que o Oráculo nunca teve; inventá-los seria mentir para o cron.
  Esses cartões ficam em **Fazendo** com a nota "importado: travada — <precisa>; falta justificar (motivo, link e
  prazo)". O vigia (em sombra) avisa o Líder de cartão em Fazendo sem justificativa 30 min depois da importação; a
  sessão ou o Líder justifica com `card_justify`. Também: `rejeitada` (não cancelada) → A fazer; cartão de "Entrada"
  (precisa-do-dono) nasce sem lugar. O cartão nasce em A fazer/Entrada e leva o movimento de importação na hora; se a
  semente cair entre os dois (versão 1), a próxima rodada termina.
- Rodada a seco contra o ledger real em 20/11: 4 projetos (bizops, donel-dev, homologacao, teamzone), 169 cartões
  (137 A fazer, 32 Fazendo), 1302 tarefas fechadas de fora. Semeado num arquivo temporário duas vezes: 169 criados,
  depois 0 criados e 169 existentes.

## Instalar (VPS pessoal; cada passo com o daemon e o cron como estão)

1. Build: `npm run build:oraculo && npm run build:quadro` (dá `out/oraculo/oraculo.mjs` e
   `out/board-cron/board-cron.mjs`).
2. `mkdir -p ~/.donel/board/bin && chmod 700 ~/.donel/board`; copiar `out/board-cron/board-cron.mjs` e
   `scripts/quadro/quadro-{ronda,lider}.sh` para `~/.donel/board/bin/` (`chmod 700` nos `.sh`).
3. `~/.donel/board/sqlite.json` (600): `{ "file": "~/.donel/board/board.sqlite" }`.
4. `~/.donel/board/cron.json`: `{ "host": "vps-pessoal", "vigiaSombra": true, "pagina": "<home>/entregas/quadro" }`
   (+ `slackReader` quando houver o leitor de fio).
5. Semente a seco e conferir o plano: `node ~/.donel/board/bin/board-cron.mjs semear --seco`. Depois de verdade:
   `node ~/.donel/board/bin/board-cron.mjs semear` (rodar de novo não duplica).
6. Uma `ronda` à mão (`~/.donel/board/bin/quadro-ronda.sh`) e abrir `~/entregas/quadro/index.html`.
7. Crontab, um comando por rotina (regra do global): `*/15 * * * * ~/.donel/board/bin/quadro-ronda.sh >>
   ~/.donel/board/cron.log 2>&1` e `* * * * * ~/.donel/board/bin/quadro-lider.sh >> ~/.donel/board/cron.log 2>&1`.
8. Daemon: o bundle novo do Oráculo como nas implantações anteriores (guardar `oraculo.mjs.antes-AAAAMMDD-HHMM`,
   copiar, reiniciar `donel-oraculo`). As `card_*` aparecem na lista de ferramentas das sessões da VPS.

## Fica igual

- Vigia em sombra por padrão; a `ronda` do despertador só sai depois de um dia em paralelo (§6 do desenho).
- "Esperando você" só pelo Líder do quadro, com `main_prod`, `new_credential`, `money` ou `laya` (`rules.ts`).
- O Oráculo (mesa de decisão do dono e `tarefa_*`) não muda. A troca de "andamento → `card_move`" nas instruções das
  sessões é do Líder, avisada na véspera.

## Fora desta entrega

- O contrato PostgREST do serviço do PC (§3 do desenho): com o Jobu na VPS, ele cria cartão por `card_create`.
- O porte a Rust (peça 6).
- Laya em serviço: hoje `laya_rodada.py` lê o `ledger.json`, que não existe mais. Vale a marca `laya` aceita só do
  Líder.

## Volta

Apagar `~/.donel/board/sqlite.json` e as duas linhas do crontab. O daemon e o cron voltam a ficar desligados (sem
reiniciar: o daemon lê a config a cada chamada), e o `board.sqlite` fica guardado. Nada do Oráculo é escrito.
