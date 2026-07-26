# Spec — 007 Favoritos com sessões recentes na sidebar

**Status:** RASCUNHO pós-discovery (2026-07-25) — D1–D9 fechados na entrevista
(`discovery.md` deste diretório). Restam os `[C]` marcados abaixo para o
`/clarify`. **Nenhuma linha de código.** Aguarda OK dele no gate.
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

- **CA-1 (grupo):** existe um grupo novo na sidebar, **separado** de "Projetos" e
  de "Sessões", contendo **só os projetos favoritados** (D6). Cada projeto é uma
  linha colapsável, e o estado aberto/fechado de cada um **persiste** entre
  execuções.
- **CA-2 (conteúdo):** cada projeto lista **até 5** sessões, as mais recentes por
  última atividade, **mais todas as sessões fixadas** daquele projeto. Uma
  fixada que já esteja entre as 5 **não** duplica; uma fixada fora das 5 aparece
  **além** delas (D2).
- **CA-3 (dedupe):** as sessões exibidas sob um projeto favoritado **não**
  aparecem na lista geral de "Sessões" (D4) — com a exceção que o CA-6 obriga.
- **CA-4 (um clique):** clicar numa linha **foca a aba** daquela sessão se ela já
  estiver aberta; se não estiver, **retoma** (`-r <id>`, o mesmo caminho do
  botão "Retomar" de hoje) (D5).
- **CA-5 (fixar é da sessão e persiste):** o gesto de fixar passa a valer para a
  **sessão** (por `sessionId`), gravado no `ConfigStore`, e **sobrevive a fechar
  e reabrir o app**. Desfixar devolve a sessão à regra das 5.
- **CA-6 (o colapsado grita):** o cabeçalho de cada projeto mostra o **pior
  estado do semáforo** entre as sessões **vivas** dele, com contagem — permissão
  pendente acende no cabeçalho mesmo com o grupo fechado (D8). É o que impede o
  dedupe do CA-3 de apagar o sinal de FR-010/CA-6 do MVP.
- **CA-7 (boot instantâneo, sem varredura):** ao abrir o app, o grupo é montado a
  partir de um **registro próprio do app** (mantido enquanto ele trabalha, D9),
  **sem** ler nenhum `.jsonl`. Alvo: sidebar pintada em **< 100 ms**, medido —
  não "parece rápido".
- **CA-8 (preenchimento sob demanda):** projeto favoritado que ainda não tem nada
  no registro — primeira execução depois desta feature, ou sessão criada fora do
  Donel — preenche por **uma** leitura de disco quando o grupo é expandido, e o
  resultado **entra no registro**. Nunca varre no boot.
- **CA-9 (nada se perde ao desfavoritar):** desfavoritar um projeto remove o
  grupo dele e as sessões voltam a aparecer na lista geral / no painel de sessões
  anteriores. Nenhuma fixada é esquecida (a marca continua gravada).
- **CA-10 (rótulo consistente):** o texto de cada linha é o **nome resolvido** da
  004 (`resolveSessionName`: nome do `/rename` × nome dado na UI × preview), o
  mesmo que a aba e a lista de sessões anteriores mostram. Nunca um segundo
  jeito de nomear a mesma sessão.

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

## Para o `/clarify` (não decidir sozinho)

- **[C1] O que o registro guarda por sessão?** Mínimo viável: `sessionId`,
  `projectPath`, `lastActivityAt`. A dúvida é se guarda também um **rótulo em
  cache** — sem ele, uma sessão no registro precisa de leitura de disco para
  saber o nome (o que reintroduz I/O no boot); com ele, o rótulo pode ficar
  **velho** se o nome mudar por fora. Candidato: guardar o rótulo como cache e
  reconciliar quando a sessão for aberta.
- **[C2] Os dois "fixar" viram um só gesto?** Hoje existe o pin da aba (volátil,
  desempate do semáforo). Se o pin passa a ser da sessão e persistido, o pin da
  aba deve **desaparecer**, virar o mesmo botão, ou continuar existindo em
  paralelo? Recomendação: **um gesto só** — evita "fixei e não ficou fixado".
- **[C3] Entrada obsoleta.** Registro aponta para uma sessão cujo `.jsonl` foi
  apagado do disco. Ao clicar: mensagem e remoção silenciosa da linha, ou a linha
  já nasce marcada como indisponível? (Rima com a dívida de GC do §B12.)
- **[C4] Limite de fixadas por projeto.** Sem limite, ou um teto (ex.: 10) para o
  grupo não crescer sem controle?
- **[C5] Posição do grupo na sidebar.** Topo (antes de "Projetos") ou dentro da
  área de sessões? O B5 dizia "candidato: no topo ou dentro da área de sessões,
  mas SEPARADO da lista de projetos".
- **[C6] O registro cobre sessão criada fora do Donel?** O CA-8 cobre por leitura
  sob demanda ao expandir. Isso basta, ou o grupo deve reconciliar com o disco
  em algum outro momento (ex.: ao focar a janela)?

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
