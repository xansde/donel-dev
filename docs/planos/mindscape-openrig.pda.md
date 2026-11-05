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
- **03 — Navegador integrado para qualquer motor** → painel por sessão + ferramentas `navegador_*` no MCP `donel`; `--chrome` removido (PRs #155, #158)
- **07 — Sessão renovada em voo (B36)** → no alfa, aguardando validação do dono ([refinamento](../refinamentos/sessao-renovada-em-voo.md), PR #161)
- **11 — Estudo profundo do OpenRig** → seat como lugar, papel reinjetado, ligação que autoriza, mensagem sem atropelar, fluxo por desfecho declarado; CLI/TUI/MCP sobre uma API ([estudo](../pesquisas/openrig-estudo-profundo-2026-11.md))
- **Pausa do dono (03/11)** → nada da ideia OpenRig (04, 05, 06, 12, 13) é desenvolvido antes de ele avaliar o protótipo do 14
- **14 — Multitarefa: forma escolhida** → A + C, com o Jobu como Líder numa janela de conversa flutuante, móvel entre monitores ([decisão](../prototipos/mindscape-openrig/decisao.md))
- **Kit do Bill (04/11)** → o dono deu OK em três decisões da absorção do kit "time de agentes" (Billverso): D1 ledger local no `userData`, D2 Revisor aceita baixo risco desde a V1, D3 rotinas primeiro dentro do app. Viraram os itens 19 e 20 e a continuação do 13. Fonte: `absorcao-kit-bill.html`, sessão de Pesquisa de 04/11 (material de terceiro, só lido, fora do repo)

## Ordem (dono, 04/11)

Os itens 19 e 20 e a continuação do 13 (fila durável) vêm **depois** de duas frentes que já
estão em curso: (1) o fix da mensagem que vai direto para a fila do CLI, sem ficar "Retida"
(memória `chat-envia-na-hora`), e (2) o Líder único para todos os quadros (memória
`lider-unico-todos-quadros`). A fila durável se apoia na entrega direta, e o ledger e as
rotinas se apoiam no Líder único.

## O centro do Mindscape (dono, 03/11)

"A ideia desse excalidraw é conseguir me comunicar contigo exatamente como eu funciono:
graficamente. Palavras não são meu forte." Ver item 16.

## Próximo passo depois do protótipo (dono, 03/11)

**Esteira montada no Mindscape** (item 15): "a ideia de configurar as esteiras no mindscape não
pode morrer. Terminais pré-determinados, com conexões de caminho gerados pelo output de cada
sessão, similar ao que temos no modo dev, mas mais visual e mais maleável. Isso DEVE CONTINUAR
PODENDO EXISTIR e será o próximo passo." Nenhuma decisão deste plano pode fechar essa porta.

## Ainda não especificado

- **Persistência em nuvem** (dono, 03/11): "por enquanto [com o app fechado tudo para]. Mas vamos
  evoluir em breve para ser persistente em nuvem." O time de sessões, o quadro e as esteiras
  continuarem vivos sem o app aberto. Ainda sem formato; não fechar porta: a API local nasce como
  contrato que um servidor remoto possa servir depois.

- Vista em tabela e grade de terminais (as outras duas vistas do OpenRig): revisitar quando a
  barra lateral nascer recolhida.
- Papéis, conexões e multitarefa (itens 12–14) graduam em fatias quando o estudo (11) fechar.
  Dono, 03/11: "as conexões de sessões, o multitasking, os papéis de sessões, etc. É um material
  de OURO para nos basearmos, com o layout do donel dev". Isso promove o que antes era névoa
  ("orquestração entre sessões") a centro do plano.

## Fora de escopo

- Adotar o OpenRig (ou tmux) como runtime: sem Windows nativo, e o Donel Dev já é dono dos PTYs.
- Arquivo de topologia escrito à mão (YAML). Montar o molde **desenhando no quadro antes de rodar
  pode** (dono, 03/11) — ver item 15.
- TUI (`donel tui`): dono, 03/11 — "A TUI não é tão necessária, tendo um modo chat bem
  desenvolvido". Ficam a CLI `donel` e o MCP `donel`; a API local nasce sem depender de TUI.
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
- **Status**: concluido
- **Bloqueado por**: 02
- **Pergunta**: fechar e entregar o navegador interno de `docs/design/navegador-interno.md`
  (painel `WebContentsView` por sessão, controle por CDP, ferramentas `navegador_*` num
  servidor MCP local do app) com duas emendas do dono (03/11): (a) o toggle "Navegador
  (Chrome/Edge)" / `--chrome` sai do Launcher, do config e do CommandBuilder; (b) as
  ferramentas são contrato do app, não do `claude` — o servidor MCP `donel` é entregue a
  qualquer CLI que fale MCP (Claude Code hoje; provedores da 011 quando suportarem) e o
  nome e a UI não citam "Claude". Primeira fatia (painel) existe só local, na branch
  `feature/navegador-interno` (commit `2eb5c01`).
- **Resolução**: painel por sessão, controle por MCP `donel` para qualquer motor, Claude in Chrome removido (PRs #155 e #158)

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
- **Bloqueado por**: 05, 11
- **Pergunta**: o dono desenha uma moldura com título que agrupa cartões e post-its; mover a
  moldura move o que está dentro; o Organizar respeita molduras (não tira cartão de dentro
  delas). É a forma que o agente do B34 vai preencher com temas. Sobe o `schemaVersion`.
- **Resolução**: —

### 07 — Sessão renovada em voo (B36)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 02
- **Pergunta**: ao cruzar o limite de contexto proposto, no fim do turno, a sessão escreve a
  passagem de bastão, o app encerra o processo e abre uma sessão nova na mesma aba, mesma
  pasta e mesma conta, com a passagem como primeira leitura; o chat continua o mesmo e avisa
  "Sessão renovada em voo". O cartão do Mindscape é o mesmo lugar antes e depois (o "seat"
  do OpenRig). Fechar os "em aberto" do B36 (`specs/backlog.md`): onde fica a passagem sem
  vault, limite por tokens ou custo, veto "agora não", e nunca matar com trabalho vivo
  (agentes em background, cron, loop).
- **Resolução**: renova no fim do turno ao cruzar o limite (padrão 250k, 150k–500k), passagem em `<userData>/handoffs/`, mesma aba/conta/flags, espera trabalho vivo, "Agora não" adia 50k; chat mantém a conversa anterior acima de um divisor; cartão do Mindscape fica no lugar ([refinamento](../refinamentos/sessao-renovada-em-voo.md), PR #161). Falta a validação do dono no alfa.

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
- **Status**: descartado (absorvido pelo 13, conexões com significado, 03/11)
- **Bloqueado por**: 07
- **Pergunta**: ligações ganham tipo ("continuou em", "veio de fork", "delegou") e se animam
  quando o fato acontece. A primeira fonte real é a renovação em voo (07) e o fork; vale
  desenhar tipo que nenhum evento do app produz?
- **Resolução**: —

### 11 — Estudo profundo do OpenRig: papéis, conexões e multitarefa

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 01
- **Pergunta**: lendo o código e os docs do OpenRig (não só o README): como um papel de sessão
  é definido e sobrevive à troca de conversa; o que uma conexão (edge) significa de fato
  (roteamento? permissão de mandar? só desenho?); como send/broadcast/chatroom/fila/handoff
  chegam ao terminal sem atropelar; como vários agentes trabalham juntos e o que o humano vê.
  Entrega o mapa conceito → Donel Dev (trazer já · depois · não trazer) e fatias propostas.
- **Resolução**: seat (lugar acima da conversa) é o conceito central; papel reinjetado em todo lançamento; a edge do OpenRig quase só desenha (no Donel ela autoriza); mensagem por envelope com guarda de digitação; fluxo decidido por desfecho/rota declarados ([estudo](../pesquisas/openrig-estudo-profundo-2026-11.md))

### 12 — Papéis de sessão

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 11
- **Pergunta**: uma sessão do quadro tem um papel (ex.: dev, revisor, pesquisa) com orientação
  própria e motor escolhido; o papel sobrevive à renovação em voo (07) e à retomada. Onde o
  papel mora, como o dono cria e troca, e o que o app injeta ao lançar.
- **Recomendação (03/11), aguardando OK do dono**: o dono perguntou se papel deveria mudar ou se o
  certo é delegar. **Papel é fixo por lugar.** Trocar o papel de uma sessão viva mistura contexto
  (um "Revisor" que escreveu o código não revisa com olhos novos), confunde o quadro e as ligações
  e não tem ganho que delegar não dê. Precisa de outro papel → cria ou acorda a sessão com esse
  papel e delega pela ligação. Única troca permitida: antes da primeira mensagem (o lugar "ainda
  não começou"), para corrigir escolha errada. "Continuar este trabalho como Revisor" vira um
  lugar novo com passagem de bastão, não troca de crachá.
- **Resolução**: —

### 13 — Conexões entre sessões com significado

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 11
- **Pergunta**: a ligação entre dois cartões passa a dizer quem pode mandar trabalho ou
  mensagem para quem; mandar pelo quadro (ou pela própria sessão, via MCP do app) entrega no
  terminal da outra sem atropelar o que o dono digita; a ligação se anima quando algo passa.
  Absorve o item 10.
- **Continuação (04/11, kit do Bill): fila durável entre lugares.** A mensagem do
  `sessao_enviar` ganha id e desfecho, sobrevive ao restart do app (hoje "quem abriu quem" e as
  mensagens pendentes vivem só na memória, ver `docs/refinamentos/time-de-sessoes-v1.md`, "Ficou
  aberto"), acorda o lugar adormecido antes de entregar (o app faz isso, de forma
  determinística; nenhuma sessão precisa lembrar) e é repassada por handoff em vez de fechar uma
  e abrir outra. Regra do kit: "fila não é estado"; o estado da tarefa mora no ledger (19).
  Vem depois do fix da entrega direta ao CLI (ver "Ordem").
- **Resolução**: —

### 14 — Multitarefa: um time de sessões no quadro

- **Tipo**: prototipo
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: 11
- **Pergunta**: como o Mindscape mostra e dirige várias sessões trabalhando juntas (papéis,
  conexões, quem espera quem, o que precisa do dono) no layout do Donel Dev? Três variantes
  para o dono escolher.
- **Resolução**: A + C com o Jobu como Líder, conversa em janela flutuante própria ([decisão](../prototipos/mindscape-openrig/decisao.md), [final](../prototipos/mindscape-openrig/final.html))

### 15 — Esteira montada no Mindscape (próximo passo)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 11, 14
- **Pergunta**: o dono monta no Mindscape um molde de fluxo: terminais (sessões com papel,
  skill e motor) pré-determinados e caminhos entre eles que o output de cada sessão decide
  (fan-out, fan-in), com um agente geral que acompanha tudo e só leva ao dono as dúvidas que
  ele não resolve; um bloco por iniciativa, escolhendo o tipo (Desenvolvimento, Bugfix,
  Homologação...). É o Modo Dev mais visual e maleável. Base: pedido de 24/10 em
  [`modo-dev-montador-de-fluxo.spec.md`](../produto/modo-dev-montador-de-fluxo.spec.md) e o
  [contexto medido](../produto/assets/modo-dev-montador-de-fluxo/contexto-atual.md).
- **Requisito do dono (03/11)**: fan-out **dinâmico** é padrão de esteira e deve ser esperado:
  "após a etapa de discovery, pode-se abrir n novas branches". A estação declara na saída N partes
  independentes (enum + lista, nunca leitura da prosa); o caminho marcado "uma por parte" abre N
  estações, cada uma na sua branch/worktree, com teto de paralelismo; "espera todas" faz o
  fan-in. Sem o caminho marcado, o agente propõe o fan-out no quadro (azul tracejado) e o dono
  aceita num gesto. Base no Modo Dev de hoje e no fan-out de fatias da `/implementacao`.
- **Resolução**: —

### 16 — Falar desenhando (desenho é o canal com o agente)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 14
- **Pergunta**: o dono desenha no quadro, manda um trecho a uma sessão sem digitar, e o agente
  recebe print + leitura do desenho em texto (serve a motor sem visão) e responde desenhando no
  quadro, como proposta azul tracejada que o dono aceita ou desfaz. O gesto opera o quadro: seta
  entre cartões vira ligação, retângulo vira moldura, rabisco gruda no cartão. Puxa para a frente
  as ferramentas `quadro_*` do item 08. Forma no
  [protótipo](../prototipos/mindscape-openrig/), abas "Falar desenhando" e "Desenho = quadro".
- **Resolução**: —

### 17 — Nó de terminal (não exclusivo de uma sessão)

- **Tipo**: refinamento
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 13
- **Pergunta**: dono, 03/11: "seria interessante também um nó de terminal, em vez de ser algo
  exclusivo de um único seat". Um cartão de terminal comum (shell, dev server, testes, logs),
  sem agente dentro, que existe por si no quadro e é compartilhado: as sessões ligadas a ele leem
  a tela (`sessao_ver_tela`) e, se a ligação permitir, mandam comando; o dono vê e digita nele.
  Na esteira, vira estação sem LLM: roda um comando e o **código de saída** é o desfecho
  (0 = concluído, ≠0 = falhou), caminho determinístico. Equivale ao "terminal node" do OpenRig.
  **Regra do dono (03/11):** "definir um terminal principal para controlar o terminal. Os outros
  podem mandar comando, mas só será acatado pelo terminal principal se ele aceitar." O nó tem uma
  sessão **principal** (dona); só ela (e o dono, sempre) digita direto. Comando de outra sessão
  ligada vira **pedido** na fila do nó, que a principal aceita ou recusa — o que também resolve
  dois mandando ao mesmo tempo (fila, um por vez). Sem principal definida, o pedido vai ao dono.
  Em aberto: trocar a principal (gesto no quadro), se a principal pode aceitar sozinha por regra
  (ex.: "testes sempre") e se o processo vive sem nenhuma sessão ligada.
- **Resolução**: —

### 18 — Conversa com o Jobu (Líder) em janela flutuante

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 14
- **Pergunta**: o Jobu (015) vira o rosto do Líder: clicar nele abre uma janela de conversa
  própria (`BrowserWindow`), que o dono arrasta, redimensiona, leva a outro monitor e fixa por cima
  ou não; lembra posição e tamanho por monitor e se ajusta quando a tela muda. Por trás, uma
  sessão com papel Líder, no motor que o dono escolher, que reparte pelas ligações e avisa quando
  alguém para. **Emenda a 015** (decisão do dono, 03/11): "conversa com o Jobu" estava fora de
  escopo e D6 vetava fala em personagem; agora a conversa existe, como janela de chat, e o balão
  continua seco. Em aberto: Jobu tem um Líder por projeto ou um só para todos os quadros; o que
  acontece com a janela quando o Jobu está desligado; se a conversa reaproveita o chat da 014
  inteiro.
- **Resolução**: —

### 19 — Ledger com prova

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 13, 18
- **Pergunta**: uma tarefa entre lugares nasce com a frase literal de quem pediu, critério de
  pronto, prazo e dono, e anda em aberta → em execução → entregue → aceita (ou rejeitada).
  Ninguém marca entregue sem anexar prova (print, saída de comando ou link do CI) e **quem
  entrega não aceita**, regra no código, nunca no prompt. Quais comandos (criar, assumir,
  entregar com prova, aceitar, rejeitar), que campos, como o "esperando você" e a métrica
  "validadas sem você" saem dele, e onde ele aparece no Mindscape (faixa de números, sem painel
  à parte).
- **D1 (dono, 04/11)**: o ledger é um arquivo local no `userData`, gravado **só pelo main**
  (como o `mindscape-store`), com `schemaVersion` próprio (o `userData` é compartilhado entre
  canais). As sessões acessam pelo MCP `donel` (ferramentas `tarefa_*`). A nuvem fica para
  depois, servida pelo mesmo contrato (ver "Persistência em nuvem" em Ainda não especificado).
- **D2 (dono, 04/11)**: um lugar com papel Revisor (de preferência em outro motor que o do
  autor) aceita entregas de **baixo risco** desde a V1. Na primeira semana, o dono recebe uma
  **amostra diária** dos aceites; o resto aparece como "esperando você".
- **Teste**: dado persistido que um canal pode apagar, então vale um teste do caminho criar →
  entregar → aceitar. Nenhum smoke novo.
- **Ordem**: depois do fix da mensagem direto para o CLI e do Líder único.
- **Resolução**: —

### 20 — Rotinas que acordam lugares, com filtro sem LLM

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 19
- **Pergunta**: uma rotina tem um gerador só leitura que produz chaves de achado, um filtro
  **sem LLM** (dedup, histerese de 2 rodadas, teto por janela, desligar a fonte que passa de
  50% de descarte em 7 dias; números do kit, a recalibrar) e um lugar dono que ela acorda. O
  lugar age sozinho no que é interno, reversível e idempotente e só propõe o resto. Toda rotina
  nasce **em sombra** (só observa e registra) antes de agir. Regra do kit: nenhum lugar nasce
  sem um gatilho concreto. É a "faixa azul" do treinamento de 03/11.
- **D3 (dono, 04/11)**: as rotinas rodam primeiro **dentro do app** (timer no main, param quando
  o app fecha), num contrato gerador → chaves → filtro → acordar lugar que possa mudar para a
  VPS depois (B38/B39). A primeira é uma que **só observa**: "homologação parada" no quadro do
  Dalton.
- **Ordem**: depois do fix da mensagem direto para o CLI e do Líder único.
- **Resolução**: —
