---
demanda: ledger-bom
titulo: Um bom ledger para o ambiente inteiro — lançamentos, estado derivado, fila por quadro e prioridade
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev); os Líderes (único e de quadro) que orquestram
responsavel: Dev place:b5c10ec8 (dono do plano da frente Ledger, 08/11)
canal-slack: "não existe — ferramenta pessoal, sem Slack"
taskdex: []  # ferramenta pessoal, sem card (o Donel Dev não usa TaskDex)
origem: |
  porta B, três pedidos do dono unidos pelo Líder do quadro em 08/11:
  - t-147e6783: "organizar o ledger como um BOM ledger e toda a integração do meu ambiente";
  - t-d37471a5: a tela "Progresso - Seus pedidos" alinhada ao ledger, com o dono priorizando ali;
  - limite por quadro: "o orquestrador tenha noção da quantidade de atividade sem curso (Linhas em andamento) para
    cada quadro e saber quantas podem ter lá. Quando libera espaço, puxa mais uma. Uma possibilidade de
    (re)priorizar o ledger e agrupar as tarefas para, quem sabe, agilizar o desenvolvimento".
  Unir sem duplicar: t-1a2ca09e, t-d37ec300 (fila do Líder único), t-49934e83 (andamento no ledger), t-c12f8b2e.
criado: 2026-11-08
status: em-execucao
aprovado-por: Líder único, 08/11 22:20 (a fundação; F4 e a tela esperam a carta)
---

# PDA — Um bom ledger para o ambiente inteiro

> Substitui o rascunho `ledger-fila-por-quadro.pda.md` (o limite por quadro virou parte deste plano). Parte de
> [`ledger-v5.md`](ledger-v5.md): o que lá está decidido ou proposto é reaproveitado; o que muda está dito.

## Destino

Um ledger no sentido padrão — **só acréscimo, ordenado, imutável, auditável, correção como lançamento novo e estado
derivado** — que **todas as pontas do ambiente** (PC, as duas VPS, todos os quadros, Jobu, celular, crons, workflows
e bots) leem e gravam pelo mesmo caminho, sem depender do Oráculo para existir. Em cima dele, o dono vê em
"Progresso - Seus pedidos" o que pediu, prioriza ali, e cada quadro trabalha num número limitado de linhas em
andamento, puxando a próxima por prioridade quando uma fecha.

Fim deste plano: a **fundação** em produção no alfa (as fatias F1–F9), e a **tela** escolhida pelo dono por carta,
fatiada.

## Notas

- **Bom ledger, definição padrão** (pesquisa [registro e prova](../pesquisas/ledger-top-registro-prova-2026-11-07.md)):
  um diário de lançamentos; cada lançamento tem número de ordem, quando, quem, o quê e uma chave de idempotência;
  nada se edita nem se apaga; corrigir é lançar de novo (estorno/correção apontando o lançamento corrigido); o estado
  de cada tarefa é a soma dos lançamentos (projeção). A cadeia de hash torna adulteração visível.
- **Sem acoplar ao Oráculo.** Hoje o "Oráculo" é ao mesmo tempo o registro (`ledger.json`, `contract.ts`), o
  serviço (`donel-oraculo` na VPS) e as telas. O ledger novo é um **módulo próprio** (`src/shared/livro/`, puro) e um
  **escritor único** (hoje hospedado no mesmo daemon da VPS, mas sem regra de tela dentro). Oráculo, Jobu,
  celular, espelho do Supabase e Mindscape passam a ser **leitores** da projeção e **clientes** da mesma escrita.
- **Compatibilidade de canal** (regra do repo): o `ledger.json` v4 continua existindo como **projeção**, para o Alfa
  instalado e o beta lerem. Quem só fala v4 não grava mais nele quando o diário assumir (é o D1 do v5).
- **O que existe e é reaproveitado:** `applyLedgerOp` (as regras: prova obrigatória, quem entregou não aceita,
  risco alto com o dono) vira a validação de cada lançamento; a faxina noturna (`faxina.ts`), o fechamento legível
  (`closing.ts`), a caixa (`inbox.ts`), o andamento (`andamento.ts`, #324), a credencial de serviço (`servicos.ts`,
  #312) e o espelho (`mirror.ts`).
- **Dados para as fatias e a carta:** cópia real do `ledger.json` de 07/11 19:38
  (`~/seazone/_scratch/ledger-copia-2026-11-07.json`, 331 tarefas: Donel Dev 48 vivas, BizOps 50, Homologação 11;
  49 grupos de pedido repetido somando 116 tarefas; 75 sem título). Em 08/11 21:10 o Líder mediu 400 tarefas, 44
  vivas, 83 órfãs e 74 abertas. Nenhuma fatia roda sobre o arquivo do dono: sempre sobre cópia.

## Decisões até agora

<!-- Índice: uma linha por item concluído — gist + link pro artefato. -->
- **02 — Fatias da fundação que começam já** → três Devs na VPS (F1+F2/F3, F5/F7, F8/F9/F6), aberto pelo Líder único em 08/11.

## Ainda não especificado

- Onde o escritor único mora quando o PC está desligado e a VPS que o hospeda cai (hoje: o daemon numa VPS; o vigia
  de travas, #349, só avisa). Gradua para item quando o F4 estiver em sombra e houver números de queda.
- Se crons e bots gravam direto no escritor (credencial de serviço) ou por uma fila local que reenvia (outbox).
  Depende do F6 medido.

## Fora de escopo

- Assinatura criptográfica, Merkle, Sigstore; CRDT e vários escritores.
- O resto do v5 que não toca o modelo (carta com recibo do Slack, prova conferida pelo `gh`): seguem as fatias do v5.
- Agenda por data (calendário).

---

## A fundação e a tela

**Fundação** — o que muda por baixo, sem decisão do dono sobre o que ele vê. Cada fatia é pequena, vai contra
`staging`, roda sobre **cópia** do ledger e **não muda o que o dono vê** até a F4 sair da sombra:

| # | Fatia | Pronto quando (o Revisor confere) | Depende de | Começa já? |
|---|---|---|---|---|
| F1 | **Formato do lançamento** — módulo puro `src/shared/livro/`: o lançamento `{ seq, id, em, quem, tipo, tarefa, dados, chave, anterior }`, JSON canônico, hash encadeado (`anterior` = sha256 do lançamento anterior), parse estrito que recusa campo desconhecido com a versão. | Testes: ida e volta sem perda; trocar um byte de um lançamento no meio faz a conferência apontar **aquele** `seq`; a mesma `chave` com outro conteúdo é recusada; lançamento de versão maior é lido e marcado "só leitura". | — | **sim** |
| F2 | **Projeção** — `projetar(lançamentos) → LedgerDoc v4` (o estado de hoje), usando `applyLedgerOp` como regra de cada passo; estado nunca é gravado à mão, só derivado. | Teste: um diário montado à mão com criar → assumir → entregar → aceitar projeta exatamente a tarefa que o `applyLedgerOp` de hoje produz; um lançamento recusado pelas regras fica no diário como **recusado** e não muda a projeção. | F1 | **sim** (junto com F1, mesma branch) |
| F3 | **Importação v4 → diário, só leitura** — converte cada evento do `ledger.json` de hoje em lançamentos (ordem por `at`, `chave` = id do evento) e confere que a projeção bate. | Sobre a cópia de 07/11: **331 tarefas**, projeção igual ao original tarefa a tarefa (o script imprime 331/331 e a lista vazia de diferenças); nada é escrito fora de uma pasta temporária. | F1, F2 | **sim** (depois de F1+F2) |
| F4 | **Escritor único em sombra** — o daemon que guarda o ledger passa a acrescentar cada escrita também ao `lancamentos.jsonl` (trava de arquivo + fsync), sem mudar quem lê; a cada escrita compara a projeção com o `ledger.json`. | Num `userData` de teste com o daemon, 50 escritas variadas (criar, transferir, entregar com prova, cancelar) deixam **50 lançamentos** e **0 divergências** no log de sombra; matar o processo no meio de uma escrita não deixa linha pela metade. | F1–F3 | **não**: espera a carta (é o D1 do v5: depois dela, o v4 só lê) |
| F5 | **Faxina por lançamento (simulação)** — regras puras que dão destino a toda órfã, entregue parada e aberta velha, **com motivo, sem apagar nada**: repassar ao primeiro vivo acima (regra de hoje), devolver ao Líder do quadro, arquivar por idade ("aberta há N dias sem dono vivo"), juntar com repetida. Saída: a lista de lançamentos que **seriam** feitos. | Sobre a cópia (e sobre a de hoje, quando chegar): relatório com **cada** órfã, entregue parada e aberta velha e o destino proposto com motivo; a soma bate com as contagens (83 órfãs e 74 abertas em 08/11); nenhuma escrita. | — (usa o v4 de hoje) | **sim** |
| F6 | **Leitura e escrita por todas as pontas** — rota de leitura incremental `GET /v1/livro?desde=<seq>` no escritor e um cliente de linha de comando (`livro ler`, `livro lancar --chave`) com a credencial de serviço, para crons, workflows e bots. | Na VPS de homologação, um cron de teste lê os últimos 10 lançamentos e lança um com `chave`; rodar o cron de novo **não duplica**; um token revogado é recusado sem reiniciar o daemon. | F1 (para o formato) | **sim** (a leitura; a escrita real liga com a F4) |
| F7 | **Pedidos repetidos e tarefa-pai (simulação)** — detector puro de pedidos iguais ou quase iguais (mesmo texto normalizado, mesmo quadro, janela de 72 h) que propõe "agrupar em pai" com a frase mais antiga como raiz. | Sobre a cópia de 07/11: **49 grupos, 116 tarefas**, listados com a raiz proposta; os 3 pedidos de 5× aparecem cada um como 1 raiz + 4 filhas; nenhuma escrita. | — | **sim** |
| F8 | **Linhas em andamento por quadro (derivação)** — função pura que conta, por quadro, as linhas em andamento nas três definições candidatas da carta (tarefa em execução; sessão viva com tarefa; pedido-raiz aberto) e a capacidade medida (RAM por sessão, pico de verify, cota das contas). | Sobre a cópia: tabela por quadro com as três contagens; com o Mindscape de teste, uma sessão fechada sai da contagem da definição 2 na hora. Os números alimentam a carta. | — | **sim** |
| F9 | **Prioridade e pai no diário** — tipos de lançamento `priorizada` (posição na fila do quadro), `agrupada` (pai) e `limite-do-quadro`; a projeção ganha a fila ordenada por quadro. | Teste: lançar `priorizada` duas vezes para a mesma tarefa deixa a **última** valendo e as duas no diário; `agrupada` numa tarefa já agrupada é recusada com motivo; desfazer é um lançamento novo. | F1, F2 | **sim** (o formato); a tela que usa espera a carta |

**Tela** — tudo que muda o que o dono vê, **só depois da carta** (regra de 09/11):

| # | Fatia | Depende de |
|---|---|---|
| T1 | "Progresso - Seus pedidos" lendo a projeção: um pedido seu = uma linha com as filhas e "N de M prontas" (t-d37471a5) | F2, F7, carta |
| T2 | Prioridade arrastando na própria tela Progresso (lança `priorizada`) | F9, carta |
| T3 | Limite por quadro visível no Mindscape e no Jobu ("3 de 4 em andamento") e puxada (sugerida ou automática, conforme a carta) | F8, F9, carta |
| T4 | Faxina ligada de verdade (os lançamentos da F5 gravados), com o relatório no Oráculo | F4, F5, carta |
| T5 | Fila do Líder único (t-d37ec300) como a soma das filas dos quadros, na mesma ordem de prioridade | T3 |

---

## Itens

### 01 — Dados frescos e texto das tarefas de origem

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: um `tarefa_listar` (todos, situação "todas") de 08/11 gravado em cópia, e o texto de t-147e6783,
  t-d37471a5, t-1a2ca09e, t-d37ec300, t-49934e83 e t-c12f8b2e, para unir sem duplicar e para os números da carta.
- **Resolução**: —

### 02 — Fatias da fundação que começam já (F1, F2, F3, F5, F6-leitura, F7, F8, F9-formato)

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: repartir entre Devs (Líder do quadro) as fatias marcadas "sim" na tabela da fundação; cada uma com
  o "pronto quando" da tabela. F1 e F2 na mesma branch; F3 depois delas.
- **Resolução**: o Líder único abriu três Devs na VPS em 08/11: F1+F2 e F3; F5 e F7; F8, F9 e F6.

### 03 — Capacidade real por máquina

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: RAM por sessão (parada e trabalhando), pico do verify/build, RAM do PC e das duas VPS e cota das
  contas (`~/.donel/contas/cotas.md`), para propor o limite inicial de cada quadro com conta. Medido nesta VPS em
  08/11: 18 sessões, ~354 MB cada, 31 GB na máquina, verify/build ~3 GB um por vez.
- **Resolução**: —

### 04 — Carta ao dono para a manhã de 09/11

- **Tipo**: prototipo
- **Prioridade**: alta
- **Status**: em-andamento (protótipo pronto em docs/prototipos/ledger-bom/; carta esperando o dono)
- **Bloqueado por**: 01, 03
- **Pergunta**: protótipo navegável (3 variantes) da tela Progresso, da prioridade e do limite por quadro, com
  dados reais, e a carta com recomendação: (1) o que é linha em andamento; (2) o limite por quadro e quem ajusta;
  (3) prioridade e agrupamento; (4) a faxina antes de ligar a puxada; (5) a fila do Líder único; (6) o D1 do v5
  (o v4 só lê depois do diário).
- **Resolução**: —

### 05 — Validar MVP e versionamento com o dono

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 04
- **Pergunta**: o dono escolhe a variante e responde as perguntas da carta; registrar o aceite (quem, quando, qual
  opção). V1 = fundação F1–F9 + T1 + T3 com puxada sugerida; V2 = puxada automática, T2, T4, T5.
- **Resolução**: —

### 06 — Fatiar a tela escolhida

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 05
- **Pergunta**: regras de negócio da variante escolhida e as fatias T1–T5 com "pronto quando".
- **Resolução**: —

### 07 — Fechar as tarefas velhas cobertas por este plano

- **Tipo**: tarefa
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 01
- **Pergunta**: das tarefas t-1a2ca09e, t-d37ec300, t-49934e83 e t-c12f8b2e, as que este plano cobre por inteiro
  fecham apontando a nova (`substitui`/cancelar com motivo); as que cobre em parte ganham nota com a fatia.
- **Resolução**: —
