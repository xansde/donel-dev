# Spec — 007 Favoritos com sessões recentes na sidebar

**Status:** ✅ **CLARIFICADA** (2026-07-25) — D1–D9 fechados na entrevista
(`discovery.md` deste diretório) e C1–C6 respondidos por ele no clarify.
`plan.md` + `tasks.md` gerados. **Nenhuma linha de código.** Aguarda OK dele no
gate de execução.
**Prioridade:** a definir. Fila atual: 006 (em implementação, outra sessão) →
005 → **esta**.
**Origem:** pedido dele em 2026-07-25; consolida o **B5** do `backlog.md` e
**substitui** a decisão de 23/07 "restauração de sessões no restart" (D7).

> **Legenda de proveniência:** `[D]` veio do discovery (é requisito, não
> inventar além disto) · `[T]` achado técnico no código, com `path:linha` ·
> `[C]` decisão em aberto para o `/clarify`.

## Problema

1. **[D]** Ele trabalha com **sessões de uso contínuo** — as mesmas conversas,
   dias seguidos, por projeto — e não tem como voltar a elas rápido. Hoje o
   caminho é: achar o projeto na sidebar → abrir "Sessões anteriores" → filtrar
   → Retomar. Três cliques e um modal para algo que ele faz várias vezes ao dia.
2. **[D]** Ele quer **acesso rápido**, não sessões vivas: *"Não quero manter as
   sessões ativas, apenas acessar as últimas sessões de trabalho de maneira
   rápida."*
3. **[T] O "fixar" de hoje promete o que não cumpre.** `TabState.pinned`
   (`App.tsx:89`) vive **só em memória** — fechar o app perde. E não mantém a
   sessão no topo: em `sessionOrdering.ts` o pin é **desempate dentro do mesmo
   estado** de semáforo, então uma fixada em "trabalhando" aparece abaixo de
   qualquer sessão em "permissão pendente".
4. **[T] A seção "Sessões" da sidebar é outra coisa.** Ela lista as **abas
   abertas agora** (`App.tsx`, `sidebarSessions` montado a partir de `tabs`) —
   não o histórico de trabalho do projeto.
5. **[T] Favoritar hoje só reordena.** `favorites` é persistido no `ConfigStore`
   e usado por `mergeFavorites`/`sortProjects` (`project-scanner.ts`) para subir
   o projeto **dentro da lista de Projetos**. Nada além disso.
6. **[T] O histórico existe, mas custa.** `sessions:list` →
   `indexProjectSessions` devolve as sessões de um projeto; medição da 004
   (`004-nomear-sessoes/medicao-t403.md`): **18 ms** no donel-dev, **684 ms a
   frio** no spotometro (72 MB em 9 transcripts). Varrer todos os favoritos no
   boot seria ~2 s de sidebar em branco.
7. **[T] A 004 já deixou meio caminho pronto:** `sessionNames` no `ConfigStore`,
   `resolveSessionName` (nome do `/rename` × nome da UI × preview),
   `customTitle` no `SessionSummaryDto` e o `transcript-watcher.ts` observando
   toda aba `claude` viva.

## User stories (todas do discovery)

- **US-A — grupo por projeto favoritado:** como usuário, vejo um grupo separado
  na sidebar com meus projetos favoritados, cada um **colapsável**, listando as
  **5 sessões mais recentes** daquele projeto.
- **US-B — fixada nunca sai da vista:** quando fixo uma sessão, ela aparece
  **além** das 5 recentes, e **sobrevive a fechar o app**.
- **US-C — voltar em um clique:** clico numa sessão da lista e caio nela — se já
  estiver aberta, na aba dela; se não, retomada.
- **US-D — não perder quem me espera:** com o grupo colapsado, ainda percebo que
  um projeto tem sessão **esperando minha permissão**.

## Critérios de aceite

- **CA-1 (grupo):** existe um grupo novo **no TOPO da sidebar** (C5), antes de
  "Projetos", contendo **só os projetos favoritados** (D6). Cada projeto é uma
  linha colapsável, e o estado aberto/fechado de cada um **persiste** entre
  execuções.
- **CA-2 (conteúdo):** cada projeto lista **até 5** sessões, as mais recentes por
  última atividade, **mais todas as sessões fixadas** daquele projeto. Uma
  fixada que já esteja entre as 5 **não** duplica; uma fixada fora das 5 aparece
  **além** delas (D2). **Sem teto de fixadas** (C4).
- **CA-3 (dedupe):** as sessões exibidas sob um projeto favoritado **não**
  aparecem na lista geral de "Sessões" (D4) — com a exceção que o CA-6 obriga.
- **CA-4 (um clique):** clicar numa linha **foca a aba** daquela sessão se ela já
  estiver aberta; se não estiver, **retoma** (`-r <id>`, o mesmo caminho do
  botão "Retomar" de hoje) (D5).
- **CA-5 (fixar é da sessão e persiste):** **um gesto só** de pin (C2), que
  passa a valer para a **sessão** (por `sessionId`), é gravado no `ConfigStore` e
  **sobrevive a fechar e reabrir o app** — e que **continua servindo de
  desempate** na lista geral dentro do mesmo estado de semáforo, como
  `sessionOrdering.ts` faz hoje. Desfixar devolve a sessão à regra das 5.
- **CA-6 (o colapsado grita):** o cabeçalho de cada projeto mostra o **pior
  estado do semáforo** entre as sessões **vivas** dele, com contagem — permissão
  pendente acende no cabeçalho mesmo com o grupo fechado (D8). É o que impede o
  dedupe do CA-3 de apagar o sinal de FR-010/CA-6 do MVP.
- **CA-7 (boot instantâneo, sem varredura):** ao abrir o app, o grupo é montado a
  partir de um **registro próprio do app** (mantido enquanto ele trabalha, D9),
  **sem** ler nenhum `.jsonl`. O registro guarda, por sessão, `sessionId`,
  `projectPath`, `lastActivityAt` e o **rótulo em cache** (C1). Alvo: sidebar
  pintada em **< 100 ms**, medido — não "parece rápido".
- **CA-8 (semeadura única, só quando não há nada):** projeto favoritado **sem
  nenhuma** entrada no registro (primeira execução depois desta feature) preenche
  por **uma** leitura de disco na primeira vez que o grupo é expandido, e o
  resultado entra no registro. Projeto que **já tem** registro nunca lê o disco
  por conta própria — nem no boot, nem ao expandir (C6). Sessão criada fora do
  Donel fica de fora do grupo, por decisão (C6): o caminho dela é o painel
  "Sessões anteriores".
- **CA-9 (nada se perde ao desfavoritar):** desfavoritar um projeto remove o
  grupo dele e as sessões voltam a aparecer na lista geral / no painel de sessões
  anteriores. Nenhuma fixada é esquecida (a marca continua gravada).
- **CA-10 (rótulo consistente):** o texto de cada linha é o **nome resolvido** da
  004 (`resolveSessionName`: nome do `/rename` × nome dado na UI × preview), o
  mesmo que a aba e a lista de sessões anteriores mostram. Nunca um segundo
  jeito de nomear a mesma sessão.
- **CA-11 (órfã some):** entrada do registro cujo `.jsonl` não existe mais é
  **removida sem aviso**, inclusive se estiver fixada (C3). Como não há varredura
  de disco, "perceber" acontece em dois momentos: na semeadura do CA-8 e quando
  uma tentativa de retomar aquela sessão falha.

## Decisões já fechadas (discovery de 2026-07-25) — são requisito

- **[D1 ✔]** Nada de reabrir ou manter sessões vivas. Esta feature é **acesso
  rápido**; o custo de subir sessões no boot (RAM, cota) fica fora.
- **[D2 ✔]** 5 recentes **+** fixadas além das 5.
- **[D3 ✔]** Colapsável por projeto, com estado persistido.
- **[D4 ✔]** Dedupe: sessão listada no grupo sai da lista geral.
- **[D5 ✔]** Clique = focar se aberta, retomar se não. **Fork continua só no
  painel** de sessões anteriores (fora do escopo aqui).
- **[D6 ✔]** Só projetos favoritados entram no grupo.
- **[D7 ✔]** A decisão de 23/07 ("restaurar no boot as sessões com atividade no
  dia anterior") está **cancelada** — substituída por esta feature.
- **[D8 ✔]** Cabeçalho do projeto acende com o pior estado do semáforo.
- **[D9 ✔]** **Registro próprio do app** como fonte de verdade da lista: *"Mantenha
  registro durante o trabalho. Na próxima execução do app, já tem salvo as
  últimas sessões/fixadas sem ter que carregar sessões claude."*

## Decisões do `/clarify` (2026-07-25) — todas fechadas por ele

- **[C1 ✔] O registro guarda o NOME em cache**, junto de `sessionId`,
  `projectPath` e `lastActivityAt`. É o que permite a sidebar pintar com nome sem
  tocar em disco. **Consequência aceita:** um `/rename` feito fora do Donel pode
  deixar o rótulo do grupo velho até aquela sessão ser aberta. Sem revalidação
  silenciosa (a opção de revalidar ao expandir foi descartada).
- **[C2 ✔] Um gesto só de pin, e ele CONTINUA desempatando.** O mesmo botão fixa
  a sessão (persistido) e segue servindo de desempate na lista geral dentro do
  mesmo estado de semáforo (comportamento atual de `sessionOrdering.ts`
  preservado). Nada de dois pins parecidos.
- **[C3 ✔] Entrada órfã some sozinha, SEMPRE** — inclusive fixada.
  **Consequência aceita, registrada de propósito:** uma sessão que ele fixou pode
  desaparecer do grupo sem aviso se o `.jsonl` for apagado. Ele escolheu simples
  em vez de avisado; se incomodar na prática, é ajuste de UI depois.
- **[C4 ✔] Sem teto de fixadas** por projeto. O grupo é colapsável; tamanho é
  decisão dele. Nenhum estado de erro do tipo "não pode fixar mais".
- **[C5 ✔] O grupo fica no TOPO da sidebar**, antes de "Projetos" — é a primeira
  coisa na tela quando ele abre o app, que é o momento de voltar ao trabalho de
  ontem. "Projetos" e "Sessões" descem.
- **[C6 ✔] Sessão criada FORA do Donel não é coberta.** O grupo mostra o que ele
  trabalhou dentro do app; sessão feita num terminal comum continua alcançável
  pelo painel "Sessões anteriores", como hoje. **Não** há reconciliação
  periódica com o disco, nem botão de atualizar.

> **Interpretação adotada do C6 (vetável numa palavra):** o C6 elimina
> reconciliação **contínua**, não a **semeadura inicial** do CA-8. Sem o CA-8, no
> primeiro dia depois desta feature todo projeto favoritado apareceria **vazio**
> (o registro nasce sem nada), e a feature entregaria uma tela em branco. Então:
> projeto que ainda não tem NENHUMA entrada no registro faz **uma** leitura de
> disco quando é expandido pela primeira vez; projeto que já tem registro nunca
> mais lê o disco por conta própria.

## Fora de escopo

- **Reabrir/restaurar sessões no boot** (D1/D7) — cancelado explicitamente.
- **Fork** dentro do grupo novo (o painel de sessões anteriores já faz).
- Busca/filtro dentro do grupo; agrupar sessões de projetos **não** favoritados;
  favoritar sessão de projeto não-favoritado (D6).
- Renomear sessão pelo grupo (é a 004; o rótulo aqui só **consome** a resolução).
- Mostrar `%` de contexto ou modelo nas linhas do grupo (é a 006 / US-8).

## Riscos e o que pode dar errado

| Risco | Onde mora |
|---|---|
| Registro divergir do disco (sessão apagada, renomeada por fora, criada fora do app) | C1/C3/C6 — a spec exige reconciliação, não pode ficar implícita |
| Dedupe apagar o sinal de permissão pendente | Mitigado por CA-6; é o conflito nº 1 do discovery |
| Duas noções de "fixar" convivendo e confundindo | C2 — recomendação é unificar |
| Registro crescer sem controle | Teto natural: 5 por projeto + fixadas (C4); ainda assim, medir o tamanho do `config.json` |
| Reintroduzir I/O no boot por descuido (ex.: resolver rótulo lendo transcript) | CA-7 exige medição do tempo de pintura, não impressão |
| Sidebar virar tela cheia com muitos favoritos | CA-1 (colapsável, estado persistido) + C4/C5 |

## Notas de realidade

- O grupo novo é, na prática, o painel "Sessões anteriores" **inline e por
  projeto favoritado** — mesma origem de dado, outro recorte. Vale reusar o
  máximo do que já existe (`PreviousSessions.tsx` e o resolvedor de nome) em vez
  de escrever uma segunda lista de sessões.
- O `transcript-watcher.ts` (004, generalizado pela 006) já observa toda aba
  `claude` viva — é o gancho natural para manter o registro em dia sem polling.
- Os 5 e o "além das 5" saíram da fala dele, não de teoria de UI: *"mostrando as
  últimas 5 sessões daquele projeto já me resolve. Quando uma sessão estiver
  fixada, ela aparece ALÉM das 5 últimas sessões."*
