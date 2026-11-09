---
demanda: ledger-fila-por-quadro
titulo: Fila por quadro no Oráculo — linhas em andamento com limite, puxada e prioridade
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev) e os Líderes (único e de quadro), que orquestram
responsavel: Dev place:b5c10ec8 (tarefas "Limite de atividades por quadro e fila priorizada" e t-d37ec300)
canal-slack: "não existe — ferramenta pessoal, sem Slack"
taskdex: []  # ferramenta pessoal, sem card (CLAUDE.md do repo: o Donel Dev não usa TaskDex)
origem: porta B — pedido do dono, 08/11, literal: "Certo, o ledger está terrível então. Vamos precisar fazer com que o orquestrador tenha noção da quantidade de atividade sem curso (Linhas em andamento) para cada quadro e saber quantas podem ter lá. Quando libera espaço, puxa mais uma. Uma possibilidade de (re)priorizar o ledger e agrupar as tarefas para, quem sabe, agilizar o desenvolvimento"
criado: 2026-11-08
status: rascunho
---

# PDA — Fila por quadro no Oráculo

## Destino

O orquestrador de cada quadro (Líder do quadro) e o Líder único sabem, a qualquer momento, **quantas linhas
estão em andamento em cada quadro e quantas cabem**; quando uma linha fecha, **a próxima da fila, por
prioridade, é puxada** sozinha ou num gesto; e o dono reordena e agrupa o ledger sem lixo por baixo. Fim
deste plano: **uma carta ao dono com protótipo (3 variantes) e recomendação, aceita por ele**, que vira as
fatias de implementação. Nada de código antes do aceite.

## Notas

- **Extensão do Ledger v5, não plano novo do zero.** [`ledger-v5.md`](ledger-v5.md) já propõe tarefa-pai
  (fatia 10), idempotência (9), responsável = papel (D2/fatia 6), "parada" em 4 h (15) e a caixa do dono, e
  espera as decisões D1–D5 do dono. Este plano acrescenta o que lá não existe: **limite por quadro, puxada,
  prioridade e limpeza antes de ligar**. Onde o v5 já decide, este plano só aponta.
- Pesquisas de base: [diagnóstico](../pesquisas/ledger-diagnostico-2026-11-07.md),
  [orquestração](../pesquisas/ledger-top-orquestracao-2026-11-07.md),
  [registro e prova](../pesquisas/ledger-top-registro-prova-2026-11-07.md).
- O schema do ledger está **congelado na v4** (`contract.ts`); campo novo (prioridade, pai) exige a subida
  para v5 (D1 do v5) ou uma marca `⟦…⟧` como o `andamento` de 08/11. Isso é decisão do dono, não deste plano.
- O dono não está nesta conversa: as perguntas HITL viram a carta. Quem fala por ele é ele.
- Dados: snapshot real do `ledger.json` de 07/11 19:38 (331 tarefas) até chegar um mais novo; o Líder mediu
  em 08/11 21:10 **400 tarefas, 44 vivas, 83 órfãs, 74 abertas**.

## Decisões até agora

<!-- Índice: uma linha por item concluído — gist + link pro artefato. -->

## Ainda não especificado

- Se a puxada é automática (o app abre a sessão) ou sugerida (o Líder confirma) — sai do protótipo (item 04).
- Como o limite conversa com a fila de abertura por máquina cheia que já existe (`fullMachines`, Faxineiro):
  provavelmente o limite por quadro fica por cima, mas depende do item 03.
- Unidade de "linha": tarefa, sessão ou pedido-raiz — é a primeira pergunta da carta (item 04).

## Fora de escopo

- Implementar qualquer fatia (vem depois do aceite, por `/fatiamento`).
- O resto do v5 que não toca fila/limite/prioridade (log com hash, carta com recibo, prova conferida).
- Agendamento por prazo/data (calendário); aqui é só ordem de fila.

---

## Itens

### 01 — Dados frescos do ledger e das duas tarefas de origem

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: obter um `tarefa_listar` (todos, situação "todas") de agora e o texto das tarefas
  "Limite de atividades por quadro e fila priorizada" e t-d37ec300 (fila do Líder único), para o protótipo
  usar números reais por quadro (vivas, em execução, abertas, órfãs, repetidas, sem título).
- **Resolução**: —

### 02 — Capacidade real: RAM do PC e das VPS e cota das contas

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: quanto custa uma linha em andamento (RAM por sessão parada e trabalhando, pico do verify/build,
  turnos por hora na cota das contas de `~/.donel/contas/cotas.md`) e quanto cabe em cada máquina, para propor
  um limite inicial por quadro com conta, não chute.
- **Resolução**: —

### 03 — O que já existe de fila e limite no app

- **Tipo**: pesquisa
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: o que o app já faz que é fila (fila de abertura por máquina cheia, teto de `sessao_abrir`,
  Faxineiro, passagem de tarefas de lugar fechado, faxina noturna de órfãs) e onde o limite por quadro e a
  puxada se encaixam sem criar um segundo mecanismo.
- **Resolução**: —

### 04 — Carta ao dono: linha em andamento, limite, prioridade, limpeza e fila do Líder único

- **Tipo**: prototipo
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 01, 02, 03
- **Pergunta**: três variantes em HTML, com os dados reais, de como o Oráculo mostra e opera a fila por quadro,
  e uma carta com recomendação que o dono responde em 5 segundos, cobrindo: (1) o que conta como linha em
  andamento; (2) o limite por quadro e quem ajusta; (3) prioridade e agrupamento (campo de prioridade,
  tarefa-pai, juntar pedidos repetidos); (4) a limpeza das órfãs e abertas antes de ligar a puxada; (5) como
  conversa com a fila do Líder único.
- **Resolução**: —

### 05 — Validar MVP e versionamento com o dono

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 04
- **Pergunta**: apresentar ao dono o MVP (a variante escolhida no item 04) e as versões (V1 = limite visível +
  puxada sugerida + limpeza; V2+ = puxada automática, prioridade e pai no schema v5); registrar o aceite dele no
  Oráculo (quem, quando, qual opção da carta).
- **Resolução**: —

### 06 — Fatiar a V1 para implementação

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 05
- **Pergunta**: regras de negócio da V1 escolhida (unidade de linha, contagem, puxada, limpeza) fechadas e
  divididas em fatias verticais com "pronto quando" que o Revisor confere; inclui o que depende do D1 do v5.
- **Resolução**: —
