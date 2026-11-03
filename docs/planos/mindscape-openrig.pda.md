---
demanda: mindscape-openrig
titulo: O que vale do OpenRig no Donel Dev — Mindscape vivo, sessão que não morre, navegador integrado
cliente: Alexandre Lentz (dono e usuário diário do Donel Dev)
responsavel: Claude por delegação de Alexandre Lentz
canal-slack: "não existe — ferramenta pessoal, sem Slack (memória donel-dev-sem-taskdex-sem-slack)"
taskdex: []  # ferramenta pessoal, sem card
origem: porta B — pedido do dono em 03/11 ("Veja o que realmente vale e pode dar início em TUDO do que está listado"), sobre docs/pesquisas/openrig-referencia-mindscape-2026-11.md; mais o feedback do navegador (03/11) e o B36 do backlog
criado: 2026-11-03
status: em-execucao
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-11-03 ("pode dar início em TUDO do que está listado")
---

# PDA — O que vale do OpenRig no Donel Dev

## Destino

O Alexandre trabalha em sessões longuíssimas que nunca entram na "dumb zone", acompanha e
retoma tudo a partir de um Mindscape vivo (cartões com estado honesto, prévia do terminal,
grupos) e tem um navegador de verdade dentro do app, que qualquer motor de IA usa. Tudo chega
ao alfa.

## Notas

- Ferramenta pessoal: sem card, sem Slack. PR e merge em `staging` livres com verificação
  verde; `main` e o repo público seguem bloqueados.
- Referência: [pesquisa do OpenRig](../pesquisas/openrig-referencia-mindscape-2026-11.md). O
  OpenRig não roda no Windows nativo: é referência de design, nunca dependência (mesma régua
  do B28, herdr).
- Memórias que mandam aqui: `llm-agnostico` (nada preso a uma IA; sem "Claude" em rótulo de
  recurso), `navegador-integrado-nao-claude-in-chrome`, `autonomia-e-seazone-opcional`,
  `versao-diaria-com-patchnotes` (toda mudança visível ganha item em `patchnotes/notes.ts`).
- Base: Mindscape V1 + desenho + fatia de 31/10 ([PDA](mindscape-lugar-principal.pda.md)),
  adormecidas e Organizar já no alfa.
- Perímetro proibido: `src/main/accounts/` (exceção de credencial). Fixtures genéricas
  (atlas, beacon, vega). `mindscape.json` com campo novo sobe o `schemaVersion`.
- Frentes paralelas em worktrees separadas; as fatias do Mindscape (04, 05, 06) mexem nos
  mesmos arquivos e por isso andam em sequência numa frente só.

## Decisões até agora

- **01 — O que vale do OpenRig** → vale: cartão-lugar, cartão rico com estado em 3 eixos, prévia do terminal, molduras de grupo, salvar e reabrir o quadro, ferramentas do quadro por MCP; não vale agora: fila/inbox/chatroom entre agentes, topologia em YAML, tmux/daemon ([pesquisa](../pesquisas/openrig-referencia-mindscape-2026-11.md))
- **02 — Validar MVP e versionamento com o cliente** → validado por delegação do dono, 03/11; ele revê no alfa diário

## Ainda não especificado

- Orquestração entre sessões (fila de trabalho, uma sessão entregando para outra): depende do
  B32 (hibernar) e do agente do B34. Volta quando houver um caso real de passagem de trabalho.
- Vista em tabela e grade de terminais (as outras duas vistas do OpenRig): revisitar quando a
  barra lateral nascer recolhida.

## Fora de escopo

- Adotar o OpenRig (ou tmux) como runtime: sem Windows nativo, e o Donel Dev já é dono dos PTYs.
- Topologia declarada em YAML antes de rodar: o quadro nasce do uso.
- Claude in Chrome (`--chrome`): rejeitado pelo dono em 03/11; sai do app.

---

## Itens

### 01 — O que vale do OpenRig

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: o que do OpenRig serve ao Mindscape e ao Donel Dev, e o que não serve?
- **Resolução**: ver Decisões até agora ([pesquisa](../pesquisas/openrig-referencia-mindscape-2026-11.md))

### 02 — Validar MVP e versionamento com o cliente

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 01
- **Pergunta**: apresentar ao dono o MVP proposto e as versões; registrar o OK.
- **Resolução**: dono, 03/11, no chat: "Veja o que realmente vale e pode dar início em TUDO do
  que está listado". Onda 1 = itens 03–07; onda 2 = 08–10.

### 03 — Navegador integrado para qualquer motor

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: fechar e entregar o navegador interno de `docs/design/navegador-interno.md`
  (painel `WebContentsView` por sessão, controle por CDP, ferramentas `navegador_*` num
  servidor MCP local do app) com duas emendas do dono (03/11): (a) o toggle "Navegador
  (Chrome/Edge)" / `--chrome` sai do Launcher, do config e do CommandBuilder; (b) as
  ferramentas são contrato do app, não do `claude` — o servidor MCP `donel` é entregue a
  qualquer CLI que fale MCP (Claude Code hoje; provedores da 011 quando suportarem) e o
  nome e a UI não citam "Claude". Primeira fatia (painel) existe só local, na branch
  `feature/navegador-interno` (commit `2eb5c01`).
- **Resolução**: —

### 04 — Cartão rico e estado em três eixos

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: o cartão de sessão mostra motor (selo neutro, nome do modelo/provedor),
  % de contexto e tokens, e um anel de estado; o estado passa a ter três eixos que não se
  misturam — processo (aberta · hibernada · fechada), atividade (trabalhando · parada ·
  desconhecido) e retomabilidade (viva · retomável · sem retomada) — com "precisa de você"
  como contagem + motivo (permissão, limite de uso, pergunta, erro), nunca como estado.
  O Organizar ganha a leitura "parada com pendência" (parada + pergunta/permissão/erro aberto).
  Quais fontes já existem (statusbar do chat, semáforo, hooks) e o que falta medir?
- **Resolução**: —

### 05 — Prévia do terminal no cartão

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 04
- **Pergunta**: passar o mouse (ou foco) num cartão vivo mostra as últimas linhas do terminal
  num espelho parado; um clique liga a prévia ao vivo, com teto de prévias vivas ao mesmo
  tempo; duplo clique continua indo para a aba. De onde vem o espelho (buffer do xterm já no
  renderer?) e qual o teto?
- **Resolução**: —

### 06 — Molduras de grupo no quadro

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 05
- **Pergunta**: o dono desenha uma moldura com título que agrupa cartões e post-its; mover a
  moldura move o que está dentro; o Organizar respeita molduras (não tira cartão de dentro
  delas). É a forma que o agente do B34 vai preencher com temas. Sobe o `schemaVersion`.
- **Resolução**: —

### 07 — Sessão renovada em voo (B36)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: ao cruzar o limite de contexto proposto, no fim do turno, a sessão escreve a
  passagem de bastão, o app encerra o processo e abre uma sessão nova na mesma aba, mesma
  pasta e mesma conta, com a passagem como primeira leitura; o chat continua o mesmo e avisa
  "Sessão renovada em voo". O cartão do Mindscape é o mesmo lugar antes e depois (o "seat"
  do OpenRig). Fechar os "em aberto" do B36 (`specs/backlog.md`): onde fica a passagem sem
  vault, limite por tokens ou custo, veto "agora não", e nunca matar com trabalho vivo
  (agentes em background, cron, loop).
- **Resolução**: —

### 08 — Ferramentas do quadro por MCP

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 03, 06
- **Pergunta**: o mesmo servidor MCP local do item 03 expõe `mindscape_*` (ler o quadro, criar
  post-it, mover para moldura, ligar cartões) para qualquer motor; é a mão do agente do B34.
  Que ações podem rodar sem confirmação do dono e quais pedem?
- **Resolução**: —

### 09 — Salvar e reabrir o quadro inteiro

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 04, 07
- **Pergunta**: "fechar o dia" encerra as sessões paradas do quadro guardando onde estavam;
  "reabrir" acorda todas e diz, por cartão, o que voltou (retomou · nova com passagem ·
  precisa de decisão). Como casa com o B32 (hibernar) e com o teto de RAM?
- **Resolução**: —

### 10 — Ligações com tipo e animação

- **Tipo**: refinamento
- **Prioridade**: baixa
- **Status**: pendente
- **Bloqueado por**: 07
- **Pergunta**: ligações ganham tipo ("continuou em", "veio de fork", "delegou") e se animam
  quando o fato acontece. A primeira fonte real é a renovação em voo (07) e o fork; vale
  desenhar tipo que nenhum evento do app produz?
- **Resolução**: —
