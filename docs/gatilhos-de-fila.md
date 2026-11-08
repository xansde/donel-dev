# Gatilhos de fila do Donel Dev

Frases do dono que abrem uma fila de trabalho no vault Claude Seazone (`Projects/donel-dev/`). Saíram do `CLAUDE.md` em 2026-11-06 sem mudança de texto: só valem quando o pedido chega, então moram aqui, atrás do ponteiro do `CLAUDE.md`. Antes de seguir uma delas, confira no `PROXIMO.md` da fila se ainda há item `⬜`.

## Gatilho — "implementar melhorias Modo Dev"

Pedido "**implementar melhorias Modo Dev**" (ou "implementar o próximo lote do
Modo Dev") = abrir a fila
`Claude Seazone/Projects/donel-dev/implementar-009-modo-dev-v3/PROXIMO.md` no
vault e pegar o **primeiro lote `⬜`**. Aqui a ordem **é** sequencial. Prompt
pronto (e a variante de retomada) em `prompt.md`, na mesma pasta.

Fonte de verdade do escopo: `specs/009-modo-dev-v3/spec.md` (31 CA). Forma da UI:
`design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html` **lido junto de**
`design/modo-dev-v3-verificacao.md`, que nomeia **7 divergências (D-V1..D-V7)** —
ler ANTES de implementar. Regra de conflito: **forma** → vence o design, sem
abrandar; **alcance ou comportamento** → vence a spec. Um lote por sessão; o PR
para `staging` pode ser aberto pelo Claude (ver "PR e merge" no `CLAUDE.md`).

> **Fila anterior (003), cumprida:** `implementar-modo-dev/PROXIMO.md` zerou em
> 28/07 (PRs #2 e #3). A forma da v2 (`design/modo-dev-handoff/` +
> `design/modo-dev-verificacao.md`, divergências D1–D5) fica como registro do que
> foi construído — a v3 a sucede. A divergência mais séria de lá **reincidiu** na
> leva nova e continua valendo **enquanto o modelo atual existir**: a trava é
> **etiqueta do board**, nunca arquivo `.lock` (D-V3). **A spec 010 supersede
> isto**: com o tracker virando opcional, a trava passa a ser **local** (fato com
> dono, hora e sessão, visível e liberável num gesto), com espelho opcional em
> etiqueta. O que a D-V3 proibia — trava invisível e órfã — continua proibido.

## Gatilho — "rodar a próxima fase da 010"

Pedido "**rodar a próxima fase da 010**" (ou "próxima fase da Esteira do Donel")
= abrir a fila `Claude Seazone/Projects/donel-dev/esteira-010/PROXIMO.md` no
vault e pegar a **primeira fase `⬜`**. A ordem **é** estritamente sequencial:
cada fase depende do contrato que a anterior fixou, e rodar duas em paralelo
recria o desencontro de contrato que originou a spec. Prompts prontos, um por
fase, em `prompts.md` na mesma pasta.

Fonte de verdade do escopo: `specs/010-esteira-donel/spec.md` (16 decisões
fechadas por `grilling` em 03/08 — são requisito — e 6 pendências propostas).
Cada fase termina com **revisão do Alexandre** antes da seguinte começar.

**Congelado enquanto a 010 não avança:** issues #41 e #42 (polir apresentação de
um mapa que será substituído) e #35 (a trilha sintética **será revertida** — ela
pinta "não realizada" o que é "não consegui ler").

## Gatilho — "executar a próxima onda da 012"

Pedido "**executar a próxima onda da 012**" (ou "próxima onda da Esteira 4.0")
= abrir `specs/012-esteira-4/execucao.md` — o plano completo da rodada (grafo,
trilhas por arquivo, gates, regras, riscos) — e pegar a primeira onda `⬜` da
fila `Claude Seazone/Projects/donel-dev/execucao-012-esteira4/PROXIMO.md`.
Prompts prontos (execução, retomada e fechamento no alfa) em `prompt.md`, na
mesma pasta.

**Escopo:** os **14 itens `open`** do discovery «Definicao esteira dev»
(`dsc-15a7e7f5-fbb`). **Fora do escopo por decisão do dono (11/08):** os planos
`forma-e-leitura` e `donel-leitor` — começam **depois** desta rodada fechar.

**Dentro de uma onda as frentes são PARALELAS** (uma worktree por frente);
**entre ondas a ordem é estritamente sequencial** — cada gate existe porque a
onda seguinte assume o que ele provou. Bloco `ships_with` é **uma entrega**,
construída sequencialmente na mesma branch: dois workers na mesma árvore foi o
incidente dos commits entrelaçados de 04/08. A rodada **termina no alfa**
(Onda 5) — liberado sem pedir permissão, ao contrário de `main` e do repo
público, que seguem no bloqueio total.

## Gatilho — "rodar a próxima fase das contas"

Pedido "**rodar a próxima fase das contas**" (ou "próxima fase do pool de
contas") = abrir `specs/011-contas-e-provedores/plan-etapa-3.md` — o plano da
etapa 3 (estado medido, os furos F1–F6, fases, riscos) — e pegar a primeira
fase `⬜` da fila
`Claude Seazone/Projects/donel-dev/contas-4-pool-proprio/PROXIMO.md`. Prompts
prontos, um por fase (+ retomada), em `prompt.md`, na mesma pasta.

**Escopo:** 4 contas próprias no alfa, trocando entre elas **durante** sessões
vivas. O pool Seazone saiu da UI em 13/09 e **voltou em 28/10 como opção**; a
regra dele e a das ferramentas da Seazone (decisão do dono, 28/10) estão no
`CLAUDE.md`, em "Regras do projeto".

A ordem é **estritamente sequencial**. A **Fase 0 era o gate** da promessa
central da 011 — "trocar de conta sem reiniciar sessão" — e **passou com CLI
real em 13/09** (`e2e.md` §3): a sessão viva adota a conta nova na mensagem
seguinte, e o MCP segue respondendo. Por isso as fases 1 e 2 seguem como
escritas, com o F6 dentro da Fase 1.

## Gatilho — "rodar a próxima fase do chat"

Pedido "**rodar a próxima fase do chat**" (ou "próxima fase da 014") = abrir a
fila `Claude Seazone/Projects/donel-dev/execucao-014-chat/PROXIMO.md` no vault
e pegar a primeira fase `⬜` que não seja do dono e cujo gate de entrada esteja
cumprido. Prompts prontos (execução e retomada) em `prompt.md`, na mesma pasta.

Fonte de verdade: `specs/014-chat/plan.md` + `specs/014-chat/tasks.md`
(T001–T102). A **Fase 0 é o protótipo de forma no Claude Design** (do dono;
`design/prompt-design-chat.md`) e corre em paralelo com a **Fase 1**, que não
tem tela. Da Fase 2 em diante: sequencial, só com `design/chat-verificacao.md`
aprovado, e tudo atrás de `chat.enabled` até a virada (Fase 7).
