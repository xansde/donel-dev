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
- Semente = `board-cron.mjs semear [--seco] [--ledger <arquivo>] [--host <host>] [--host-de <projeto>=<host>]...
  [--pc-raiz <pasta>]`
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

## Reentrega: o vigia alcança a sessão e o Líder (devolução do Revisor, 20/11)

O Revisor devolveu a t-1e354d15: dos 32 cartões em Fazendo só 1 tinha `session_id`, a tabela `lanes` estava vazia, e
toda linha `[sombra]` acabava em "sem Líder aberto aqui (nenhum)", inclusive em cartão de sessão viva. A leitura do
link contava comentário da própria conta e não lia Slack. O que mudou:

- **Sessão do cartão (semente).** `session_id` sai do lugar do cartão, pelo retrato desta máquina (`retrato.json` e
  os retratos dos satélites em `portoes-retrato/`): primeiro a sessão que segura o lugar agora (`quemSou.lugar`, sem
  `renovadaPara`; a mais nova), que é a pasta `donel-<sid>` do tmux; senão o uuid de um lugar `session:<uuid>`; senão
  a conversa do card do lugar no quadro retratado (`picturedBoards`, a mesma leitura do portão). Sem retrato, só
  `session:<uuid>`. Rodar a semente de novo **preenche** os cartões que já existem sem sessão (`fillSession`: só se o
  cartão ainda não tem sessão e o lugar dele continua o mesmo; não sobe versão, não move, não grava em `moves`).
  `semear --seco` abre o quadro só para leitura e lista o que "ganharia sessão".
- **Entregue no Oráculo não é parado.** O vigia lê o Oráculo só para leitura (as linhas das tarefas dos cartões em
  Fazendo, pelo `oraculo_id`): tarefa `entregue` espera o aceite do Revisor, e o vigia não mexe no cartão; tarefa já
  fechada (aceita ou cancelada) com o cartão ainda em Fazendo vai ao Líder **uma vez**, para mover a Feito (trocado em
  20/11 pela seção "O cartão segue a tarefa do Oráculo": a ronda fecha o cartão sozinha e o vigia só pula). Escolhi
  isso a uma justificativa automática porque Fazendo com justificativa exige link, e a única página honesta seria a do
  próprio Oráculo, que não tem endereço; e a marca é o estado vivo do Oráculo, que muda sozinho quando o Revisor
  aceita ou devolve. Oráculo fora do ar = o vigia julga só pelo cartão, como antes.
- **Raias.** `board-cron.mjs raia <projeto> <lugar> [<sessão>]` faz o `touch_lane` com força (o mesmo do daemon
  quando o Líder usa uma `card_*`) e imprime a raia. É o caminho de quem não tem as `card_*` na sessão: o Líder único
  (lugar `lider`) e um Líder de outra máquina. A `ronda` mantém `leader_seen_at` de Líder vivo no tmux
  (`touchLiveLeaders`, inalterado). O Líder único é reconhecido como sessão viva: o tmux é `donel-<sid>` e o
  transcript é a conversa atual da sessão (`current` da pasta dela, `currentConversation`), não só `<sid>.jsonl`.
- **Quem ouve o aviso de Líder.** O Líder da raia vivo aqui; senão o **Líder único** vivo aqui (a mesma escolha do
  daemon, `pickLocalLeader`), que alcança todo quadro. O log diz qual e por quê.
- **Sessão fechada.** Não existe caminho reutilizável para reabrir uma sessão fora do app a partir de um cron: o
  `abrir-local.ts` (abrir e sucessora) roda dentro do daemon, com o kit e a fila dele, e não tem rota local; o
  `claude --resume` do §6 do desenho não existe no código. Não fiz um terceiro jeito de abrir sessão. O vigia leva ao
  Líder (o "ou o Líder" do critério 3), que retoma pela `sessao_retomar`, e o log diz `sessão <uuid> fechada; avisaria o Líder …`.
- **Resposta de outra pessoa.** GitHub: a conta do `gh` desta máquina (`gh api user`, uma vez por rodada) não conta
  em comentário, review, merge nem fechamento; `gh` sem conta = o link vale só pelo prazo. Slack: `slackReader`
  (`ler_fio.py`) e `slackSelf` (os nomes e ids que o leitor mostra para a conta com que as sessões escrevem) no
  `cron.json`; só conta mensagem nova de outro autor. Limite: o leitor dá o nome (ou o id, quando não sabe o nome),
  não a conta; e o dono escreve com a mesma conta a.lentz das sessões, então uma resposta dele no fio também não
  acorda a sessão.

Prova (20/11, ronda em sombra numa **cópia** do quadro, com o retrato, o Oráculo e o tmux reais só para leitura; o
cartão com justificativa saiu de Fazendo na cópia para nada ser digitado): "acordaria a sessão
9f4d5fd8-… (cartão c-3aa3a031daab, woken): campo livre", "sessão 9c10729a-… fechada; avisaria o Líder lider da raia
donel-dev, sessão d908a6ae-…" e, na raia bizops com o Líder fechado, "avisaria o Líder único (a sessão 757511b0-… do
Líder place:e8e2842d-… da raia está fechada)".

### Instalar a reentrega (VPS pessoal)

1. `npm run build:quadro` no clone em dia; guardar o bundle de agora
   (`cp ~/.donel/board/bin/board-cron.mjs ~/.donel/board/bin/board-cron.mjs.antes-AAAAMMDD-HHMM`) e copiar
   `out/board-cron/board-cron.mjs` para `~/.donel/board/bin/`.
2. `~/.donel/board/cron.json`: acrescentar `"slackReader": "<home>/seazone/theo-west/vigia-dono/ler_fio.py"` e
   `"slackSelf": ["<nome da conta das sessões no Slack>", "<id dela>"]`.
3. `node ~/.donel/board/bin/board-cron.mjs semear --seco > <arquivo>` e conferir as linhas "ganharia sessão"; depois
   `node ~/.donel/board/bin/board-cron.mjs semear`.
4. Raias, uma por Líder (rodar de novo quando a sessão do Líder mudar; o Líder que usa `card_*` se registra sozinho):
   - Líder único (donel-dev e teamzone, decisão r-1eaf1e4e): `node ~/.donel/board/bin/board-cron.mjs raia donel-dev
     lider <sid do Líder único>` e o mesmo com `teamzone`.
   - Líder do BizOps: `node ~/.donel/board/bin/board-cron.mjs raia bizops <place: dele> <sid dele>`.
   - Dalton (Homologação): `node ~/.donel/board/bin/board-cron.mjs raia homologacao <place: dele> <sid dele>`. A raia
     é da Homologações (`projects.host`): o cron desta VPS não olha esses cartões; vale para quando o cron rodar lá.
5. `quadro-lider` no crontab (passo 7 de cima), um comando só para ele.
6. Volta: o bundle `.antes-…` de volta e as duas chaves novas fora do `cron.json`. As raias e as sessões gravadas
   ficam (são só quem acordar); para limpar, `DELETE FROM lanes` no `board.sqlite`.

## Sobras antes de tirar a sombra do vigia (20/11)

O que o Revisor e a prova da reentrega deixaram, resolvido antes de o vigia agir de verdade:

- **Lugar → sessão pela mais nova.** O resolvedor (`sessionResolver`) compara quem segura o lugar no retrato e o card
  do lugar no quadro retratado pela hora de cada entrada (o `at` da sonda, senão o `pcAt` do último envio do PC que a
  trouxe, senão o `at` do retrato, como o `pickLocalLeader`) e fica com o mais novo. Com o PC ligado, a entrada que o
  PC parou de mandar há uma hora não vale como de agora. **Empate fica com o card do quadro** (decisão de 20/11): "mais
  nova" é a hora da sondagem, não a idade da sessão; o detentor antigo retomado e sondado agora ganha `at` igual ao do
  quadro da própria entrada, e o quadro é o que o dono vê. O detentor antigo que fechou sem `renovadaPara` (ex.: o 757511b0 do Líder do
  BizOps) não volta a vencer se for retomado no tmux, e entre dois quadros retratados do mesmo projeto vale o mais
  novo, não o primeiro lido. Sem quem segure o lugar, `session:<uuid>` continua antes do card.
- **O cartão segue a sessão do lugar.** A `ronda` resolve o lugar de cada cartão em Fazendo/Travado para a sessão viva
  aqui que o segura agora (`followCardSession`, o mesmo resolvedor das raias) e acorda essa; o log diz "cartão …:
  sessão …, a que segura o lugar … aqui agora (o cartão diz …)". Nada é gravado no cartão (quem acordar não é passo
  dele; sem versão nem movimento). Ninguém vivo no lugar = o cartão fica com a sessão dele, e o Líder ouve que ela
  está fechada, como antes.
- **Host por projeto na semente.** `--host-de <projeto>=<host>` (repetível) dá o host do projeto no primeiro cadastro
  (ex.: `--host-de homologacao=homologacoes`); o resto leva `--host`. Projeto que já existe guarda o host dele
  (`upsertProject` só junta aliases). Formato errado = sai com 2 sem semear nada. Projeto que não está no plano
  (erro de digitação, ou projeto sem tarefa viva) não é usado e sai um aviso no stderr com os projetos do plano.
- **Saída inteira em pipe.** O `board-cron` sai só depois de stdout e stderr esvaziarem (`exitAfterFlush`):
  `semear --seco | tee` e o log do crontab não perdem o fim.
- **Bot não é resposta.** No GitHub, conta com login terminado em `[bot]` ou `type: "Bot"` (CI, preview, dependabot,
  app de review) não conta como resposta de outra pessoa.

## O cartão segue a tarefa do Oráculo (r-a01b8ca6, 20/11)

Pedido do Líder único, em uso real: "cartões importados do Oráculo ficam com dono 'lider' mesmo depois de
tarefa_transferir para uma sessão, e não fecham quando a tarefa é aceita ou cancelada. [...] Conserto: o cartão segue
o dono da tarefa a cada tarefa_transferir, e vai a Feito ou Cancelado quando a tarefa é aceita ou cancelada."

- **Por quê.** A semente gravou o dono da tarefa da hora em que rodou (11:42 de 20/11: `lider`), e nada atualizava
  depois. O gancho do `tarefa_assumir` (#545) só pegou os assumir depois do deploy dele; os 8 cartões do caso foram
  assumidos antes. E transferir, aceitar e cancelar chegam ao ledger por caminhos que não passam pelo portão (o app
  do PC, o `leaderLedger` do Líder único com o PC fora, o `servico:reconciliador`).
- **Regra** (`src/shared/board/task-follow.ts`, pura): só cartão com `oraculo_id` cuja tarefa está no ledger. Tarefa
  fechada → **Feito** com o dono dela como lugar; o quadro não tem coluna Cancelado (as colunas são fixas em
  `rules.ts`, no SQL e na página), então o resumo diz qual: "aceita no Oráculo", "cancelada no Oráculo: <motivo>" ou
  "carta rejeitada no Oráculo: <motivo>". Tarefa viva → o lugar é o dono da tarefa (para dar o cartão a outro lugar,
  transfira a tarefa); em-execucao/entregue tira o cartão de Entrada ou A fazer para Fazendo; aberta (transferida e
  não assumida) tira de Fazendo/Travado do dono antigo para A fazer do novo; rejeitada viva (devolvida) leva Entrada a
  A fazer e deixa Fazendo/Travado como estão; "Esperando você" nunca muda de coluna; Feito só reabre se a tarefa se
  mexeu depois (assumida, rejeitada ou transferida mais nova que o `stage_since` do cartão). Nada a mudar = nada
  gravado (sem versão).
- **Quem move** é `servico:oraculo`, como Líder (a triagem é dele), com nota curta ("dono da tarefa: <lugar>",
  "assumida no Oráculo", …) no andamento; a sessão do lugar novo vem do resolvedor da ronda (lugar → sessão viva aqui)
  e entra depois do movimento (`fillSession`). Cartão que mudou entre a leitura e a escrita: o compare-and-swap recusa,
  sai uma linha no log e a próxima ronda resolve.
- **Onde roda.** Na `ronda` (a cada 15 min), antes do vigia (`followOracle`), e uma vez à mão:
  `board-cron.mjs sincronizar [--seco] [--ledger <arquivo>]`, que imprime cada mudança (`--seco` abre o quadro e o
  ledger só para leitura). O vigia não manda mais o Líder "mover para Feito". Sem gancho novo no portão: o
  `afterAssume` já dá o cartão a quem assume na hora, e o resto (transferir, aceitar, cancelar) espera no máximo uma
  ronda; um gancho no portão não cobriria os caminhos de fora dele e pediria deploy do daemon.
- Quadro no Supabase (sem `sqlite.json`): não segue (o cliente não tem `cardsWithTask`).

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
