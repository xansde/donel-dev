# 019 — Fila de pedidos e de cadeiras

Pedido do dono (17/11/2026, literal): "Temos que ter queue pow. Já falei antes. Vamos organizar spec sobre queue de
solicitações e de cadeiras. Isso entra na fila de coisas a serem feitas" e "Isso entra no ledger. Dali a gente toca
depois". Tarefa t-b9877007 (frente Ambiente do Donel).

Status: **só spec, sem código.** O código espera o dono mandar tocar (critério da tarefa). As decisões abertas estão
no fim, cada uma com a recomendação.

## 1. O que o dono já disse sobre cadeiras e fila

| Quando | Onde | Frase ou decisão |
| --- | --- | --- |
| 03/11 | Treinamento das lideranças (síntese na memória, `projects-donel-dev-reunioes-2026-11-03-…`) | Lema do Billverso, que o dono trouxe: "Os agentes mudam. As cadeiras ficam." Cada agente ocupa uma cadeira; cada tarefa tem dono e critério de aceite. |
| 05/11 | `src/shared/teamPrefs.ts` | "Onde eu escolho o limite de sessões abertas pelos líderes de cada mindscape? Quero tirar o limite" (virou o `team.openCap`, padrão sem limite). |
| 06/11 | PDA das cadeiras (PR #256, ainda aberto: `docs/planos/cadeiras.pda.md` não está na staging) | "Rig é um time de pods, que é um squad de cadeiras." |
| 07/11 | `docs/planos/cadeiras-arquitetura.md`, decisão 2 | **Cadeira = papel no quadro**; o pod arruma as próprias cadeiras. "Sentar alguém / acordar a cadeira (com fila)" ficou fora daquela rodada. |
| 09/11 | Inventário de crons do BizOps (`handoffs/FAIXA-PRETA-inventario-crons.md`) | "Relógio de 1 dia útil não é cadeira, é cron job né amigão": cadeira é sessão que trabalha, não rotina com horário. |
| 16/11 | `~/seazone/_docs/arquitetura-alvo.md`, peça 2 | "o ledger vira o quadro de tarefas: os Líderes puxam o trabalho de lá, e o andamento é o cartão mudando de coluna". |
| 16/11 | Mesma fonte, peça 3 item 4 e recomendação 2 (aprovadas) | Até 10 sessões ao mesmo tempo na VPS pessoal; "acima de 85% de RAM, a VPS não abre sessão nova e **põe na fila**". |
| 17/11 | Passagem da orquestradora (memória, `passagem-2026-11-17-183131-…`) | O pedido desta spec. Entre as decisões do dia: "queue/cadeiras vira spec; uma coisa por vez". |
| 19/11 | `CLAUDE.md`, cadeira Dev rápido | "Os 50 minutos eram fila (`verify.lock`, vaga do limitador) e espera de Revisor/dono, não teste." |

Na memória não achei frase mais antiga com "queue" ou "fila de pedidos" do que estas. O "já falei antes" pode estar
num chat que a memória não guardou.

## 2. O que existe hoje

### Por onde o pedido entra (cinco portas, cinco filas)

| Porta | Onde espera | Vira o quê |
| --- | --- | --- |
| Chat do celular com o Líder único | `celular-local.json` (`src/oraculo/celular-local.ts`), depois `fila.json` do relay (`src/oraculo/relay.ts`) | Mensagem ao Líder único, que decide se vira tarefa. |
| "Pedir" do celular | `fila.json` do relay | Mensagem ao Líder único. |
| Tarefa pedida no celular | `celular-local.json` → `src/oraculo/tarefas-pedidas.ts` | Tarefa no Oráculo, sem dono executor. |
| `tarefa_criar` de uma sessão | Oráculo (`src/shared/ledger/`) | Tarefa; o cartão nasce no `tarefa_assumir` (`src/oraculo/cartao-da-tarefa.ts`) ou pela semente (`src/board-cron/semente.ts`). |
| `card_create` de uma sessão | Quadro de tarefas, coluna Entrada (`src/oraculo/board-sqlite.ts`; quadro em SQLite e movimento do cartão nos PRs #541 a #547, 19–20/11) | Cartão; o Líder do quadro tria para A fazer. |

Nenhuma delas diz ao dono "seu pedido é o 3º da fila e espera vaga".

### Por onde a sessão senta (a "fila de cadeiras" de hoje é física e invisível)

- O Líder abre a sessão na hora (`sessao_abrir`; com o PC desligado, `src/oraculo/abrir-local.ts`, ADR 0009).
- A sessão nasce no tmux e **espera dentro do próprio `claude.sh`**: o `~/.donel/proxy-saida.env` chama
  `~/bin/rotinas/limitador/espera_sessao.sh`, que espera a vaga até 240 min (`limitador.py espera --tipo sessao`).
  Sem vaga no fim, o `claude` não abre (sai 75).
- A vaga é do limitador: `sessoes_max` (5 desde 18/11; volta a 10 em 25/11 pelo cron `volta_estrutura_25_11.sh`),
  mais memória, PSI e carga. Ordem da espera (20/11, Líder único; BizOps #127, mesclado em 20/11): o Revisor antes do
  resto, depois a chegada.
  Passam direto, sem fila: renovação, retomada, Líder único, Theo e a isenção temporária com prazo.
- Há um segundo teto, sem conversa com o primeiro: `team.openCap` (por Líder e por quadro; acima dele o dono precisa
  permitir).
- Efeito colateral medido em 20/11: três lugares ficaram vivos por horas com a caixa vazia, porque o app só digita o
  pedido nos primeiros 240 s. O remendo é `src/oraculo/primeiras.ts`, que guarda o pedido até a sessão subir. Pelo
  comentário do arquivo, o que nenhuma sessão reclama sai em um dia.

### Cadeira no app

- Cadeira é **derivada**, nunca guardada: os lugares do quadro com o mesmo papel (`src/shared/mindscape/chairs.ts`,
  lente "Cadeiras" do Mindscape). Os pods entraram no `mindscape.json` na v6 (hoje `MINDSCAPE_SCHEMA_VERSION` é 8), e só eles são guardados.
- Estados da cadeira hoje: problema, atenção, bem, sem sinal (saúde de quem está sentado). Não há "vaga" nem "fila".

## 3. Problema

1. O pedido não tem um lugar só onde espera. Cada porta tem a sua fila, e o dono não vê a ordem.
2. A espera por vaga acontece **dentro de uma sessão já aberta**. Ela ocupa tmux e pasta, esconde o pedido e
   pode perdê-lo (caixa vazia; desistência em 4 h).
3. A ordem não tem regra de produto: só "Revisor primeiro" e a chegada. O pedido do dono não passa à frente.
4. Dois tetos (`openCap` e `sessoes_max`) respondem perguntas diferentes e ninguém vê os dois juntos.
5. Quando uma sessão morre sem entregar, o pedido não volta sozinho para a fila.

## 4. Desenho

Vocabulário: **Lugar**, **Papel**, **Oráculo** e **Líder único** como em `docs/glossario.md`. Termos novos (entram
no glossário quando o dono aprovar):

- **Pedido**: trabalho que alguém pediu e ainda não tem sessão. Tem quem pediu, as palavras dele, critério, prazo,
  quadro, papel e prioridade.
- **Cadeira**: um papel num quadro, numa máquina (decisão de 07/11). Quem senta nela é uma sessão; o lugar é a
  posição dessa sessão no quadro. "Os agentes mudam. As cadeiras ficam."
- **Vaga**: licença para mais uma sessão sentar agora. Vem do limitador da máquina (a única porta física).
- **Fila de pedidos**: os pedidos que ainda não foram triados.
- **Fila de cadeiras**: os pedidos já triados (com papel e quadro), em ordem, esperando vaga.

### 4.1 Fila de pedidos = Entrada do quadro de tarefas

Não nasce um armazém novo. A fila de pedidos é a coluna **Entrada** do quadro de tarefas
(`docs/design/quadro-de-tarefas.md`), que já é "o ledger como quadro de tarefas" que o dono pediu em 16/11.

- Toda porta grava um cartão na Entrada, com a chave da porta (`client_ref`: `oraculo:<id>`, `celular:<id>` …). A
  mesma chave de novo devolve o mesmo cartão: nada duplica.
- O chat com o Líder único continua conversa. Vira pedido só quando o Líder registra (`tarefa_criar` ou
  `card_create`).
- O Líder do quadro tria (já é dele): dá papel, quadro, máquina e prioridade, e move para A fazer.

### 4.2 Fila de cadeiras = A fazer, em ordem

- Um cartão em A fazer com papel e sem lugar é um pedido esperando cadeira.
- Ordem, da classe mais alta para a mais baixa:
  1. palavras do dono (quem pediu = dono);
  2. desbloqueio: Revisor de algo entregue, ou cartão que trava outro (é a regra "Revisor primeiro" de hoje,
     ampliada);
  3. prazo vencido ou vencendo em 24 h;
  4. o resto.
  Dentro da classe, a chegada. O Líder pode furar a fila, com o motivo registrado no cartão.
- Quem não espera, como hoje: renovação em voo, retomada, Líder único, Theo e a isenção temporária com prazo.

### 4.3 Como um pedido vira cadeira

1. **Entra**: cartão na Entrada, por qualquer porta.
2. **Triagem**: o Líder do quadro move para A fazer com papel, quadro e prioridade.
3. **Despacho**: um laço no daemon do Oráculo da VPS (a cada 30 s) pega o primeiro de A fazer de cada máquina e
   pergunta ao limitador `limitador.py vaga --tipo sessao`. O limitador segue a única fonte de vaga física.
4. **Com vaga**: o despachante abre a sessão pelo caminho que já existe (`abrir-local.ts`), com o pedido completo
   na primeira mensagem (forma da skill `abrir-sessao-com-pedido-completo`), e move o cartão para Fazendo com o
   lugar e a sessão. A sessão já nasce com vaga: nada espera no `claude.sh`.
5. **Sem vaga**: o cartão fica em A fazer, **sem processo nenhum**, com a posição e o motivo ("5 de 5 sessões",
   "memória abaixo do piso"). Ninguém abre tmux para esperar.
6. **Fim**: tarefa entregue → cartão em Feito → a vaga volta → o próximo senta.
7. **Volta**: a sessão morreu ou foi fechada sem entregar (faxina de 6 h, erro, limite de uso) → o cartão volta ao
   topo da sua classe em A fazer, com "voltou: <motivo>" e o link da passagem do lugar. Na 3ª volta vai para
   Travado e o Líder do quadro é avisado.
8. **Espera longa**: pedido em A fazer há mais de 2 h sem vaga → um aviso ao Líder do quadro, uma vez. Pedido do dono
   nunca vence (mesma regra de `src/oraculo/vencimento.ts`).

O guarda do `espera_sessao.sh` continua no `claude.sh` para quem abrir fora do despachante; só deixa de ser o
caminho normal.

### 4.4 Estados e quem vê o quê

| Estado do pedido | Coluna | O que se vê |
| --- | --- | --- |
| recebido | Entrada | "Chegou, espera o Líder triar." |
| na fila | A fazer | "Posição N na cadeira Dev do Donel Dev; espera vaga: 5 de 5 sessões." |
| sentado | Fazendo | Lugar, sessão e andamento (como hoje). |
| travado / esperando você | Travado / Esperando você | Como hoje (justificativa; motivo do dono). |
| feito | Feito | Resumo do que entregou. |

Cadeira: **livre** (há vaga), **cheia** (sem vaga e com N na fila), **parada** (ninguém sentado e fila vazia).

- **Celular, tela de tarefas**: a fila por quadro e cadeira, com posição e motivo; os pedidos do dono em destaque.
- **Celular, Oráculo** (a mesa de decisão, "Oráculo ≠ ledger", 16/11): só o que é decisão dele. Fila cheia não é
  carta para o dono; mudar o teto é do Líder único (t-4748ca17).
- **Mapa do rig**: cada cadeira com "N sentados · M na fila".
- **Líder do quadro e Líder único**: `card_list` com A fazer em ordem, posição e motivo.

## 5. O que fica de fora

- Código (esta tarefa é só a spec).
- Mudar o limitador: continua a única porta física, com os mesmos tetos e isenções.
- Fila de Workflow, de build pesado e de rotina (já têm a delas no limitador).
- Homologações e o rig do Dalton: têm coordenação própria. O `sessao-agentica/cadeiras.md` de lá não foi lido daqui.
- VPS de People (decisão do dono, 16/11: nada nosso se liga a ela).
- Campo novo no `mindscape.json`: a cadeira segue derivada do papel. Vaga por cadeira, se vier, é outra fatia, com
  `schemaVersion` novo.
- Conta por cadeira, arquivo do time, cadeiras do OpenRig no mesmo quadro (fora desde o PDA de 06/11).
- Prioridade dada pela Laya.

## 6. Perguntas abertas (com recomendação)

1. **A fila de pedidos mora no quadro de tarefas ou num armazém novo?** Recomendo o quadro (Entrada e A fazer): o
   dono já pediu "ledger como quadro de tarefas", e um terceiro armazém seria mais uma fila sem dono.
2. **Quem abre a sessão: o despachante ou o Líder?** Recomendo o despachante abrir o que o Líder já triou. O Líder
   segue dono da triagem e da ordem, e para de esperar vaga no lugar da máquina.
3. **Vaga por cadeira, além do teto da máquina?** Recomendo não na V1: o teto da máquina e a ordem bastam. Vaga por
   cadeira (a "cadeira elástica" do PDA) pede campo novo e decisão de produto.
4. **O `team.openCap` continua?** Recomendo aposentar quando o despachante ligar: dois tetos confundem, e o dele
   pergunta ao dono o que não é decisão do dono.
5. **Pedido pode sentar numa sessão viva e parada da mesma cadeira, em vez de abrir outra?** Recomendo não na V1:
   mistura contextos e esconde o fim de um pedido. Fica para depois de medir quantas vagas isso pouparia.
6. **A ordem das classes (dono > desbloqueio > prazo > resto) está certa?** Recomendo assim. É a regra de hoje
   (Revisor primeiro) com o dono e o prazo acima.
7. **Quem é avisado da espera longa?** Recomendo só o Líder do quadro, uma vez em 2 h; o dono vê a fila no celular,
   sem carta.

## 7. Fatias (quando o dono mandar tocar; um PR cada, contra `staging`)

1. **Glossário e ADR**: Pedido, Cadeira, Vaga, Fila de pedidos e Fila de cadeiras em `docs/glossario.md`; ADR 0011
   com as respostas da seção 6.
2. **Portas na Entrada**: as portas de hoje gravam o cartão com a chave da porta. Teste: o mesmo pedido duas vezes dá
   um cartão; nenhuma porta perde pedido.
3. **Despachante em sombra**: o laço só registra o que faria (como o `vigiaSombra` do quadro), por um dia.
4. **Despachante ligado**: abre pelo `abrir-local`, move o cartão e devolve o pedido quando a sessão morre. Teste: o
   pedido nunca some nem senta duas vezes.
5. **Telas**: fila no celular e "N sentados · M na fila" no mapa do rig.

## 8. Critérios de aceite (para a implementação)

- Pedido que chega sem vaga aparece "na fila, posição N, motivo" no celular em até 1 min, e nenhuma sessão abre para
  ele até haver vaga.
- Ao abrir vaga, o primeiro da classe mais alta senta em até 1 min, com o pedido completo na primeira mensagem
  (conferido no transcript).
- Sessão que morre sem entregar devolve o pedido à fila com o motivo. Nada some e nada duplica.
- Nenhuma sessão viva com a caixa vazia por esperar vaga.

## Fontes

- Memória (wiki do BizOps, `wiki/memoria/donel-lider/`): `passagem-2026-11-17-183131-orquestradora-…`,
  `projects-donel-dev-reunioes-2026-11-03-treinamento-liderancas-tech-sintese-…`, `passagens/donel-dev/ESTADO-place-ddb23b03.md`
  (teto t-4748ca17), `notas/2026-11-19-…-cadeira-dev-rapido-…`.
- `~/seazone/_docs/arquitetura-alvo.md` (peças 2, 3 e 4; recomendação 2).
- `~/seazone/BizOps/handoffs/FAIXA-PRETA-inventario-crons.md`.
- `~/bin/rotinas/limitador/limitador.py`, `espera_sessao.sh`, `INSTALAR.md`.
- Repo: `docs/planos/cadeiras-arquitetura.md`, PDA `docs/planos/cadeiras.pda.md` (commit d66ea486, PR #256 ainda aberto, fora da staging),
  `docs/design/quadro-de-tarefas.md`, `docs/adr/0009-abrir-sessao-sem-pc.md`, `src/shared/mindscape/chairs.ts`,
  `src/shared/teamPrefs.ts`, `src/shared/board/rules.ts`, `src/oraculo/{abrir-local,primeiras,relay,celular-local,tarefas-pedidas,cartao-da-tarefa,vencimento}.ts`,
  `src/board-cron/semente.ts`.
- Skills: `abrir-sessao-com-pedido-completo`, `dev-rapido`.
