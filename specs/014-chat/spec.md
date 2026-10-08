# Feature Specification: Chat no lugar da visão do terminal

**Feature Branch**: `014-chat`
**Created**: 2026-10-07
**Status**: Draft
**Input**: Descrição aprovada pelo dono no `/brainstorm` de 07/10/2026 (vault
`Projects/donel-dev/chat-014/descricao.md`), seção a seção. Evidência
técnica: spike de 07/10 (hooks no CLI interativo + Agent SDK, logs no
scratchpad da sessão) e pesquisa do T3 Code (`pingdotgg/t3code`, MIT).

## Contexto

Hoje cada aba de sessão `claude` do Donel Dev mostra o terminal cru do CLI.
Ele é ruim de **ler** (texto corrido, código sem destaque, nada para copiar
com um clique), ruim de **escrever** (colar, várias linhas, anexar imagem),
desenha **perguntas e permissões como texto**, esconde **subagentes**, e o
modo foco do CLI faz o dono **perder perguntas** feitas no meio do trabalho.

Esta entrega põe uma tela de chat como vista padrão dessas abas, **sem trocar
o motor**: o mesmo CLI interativo segue vivo por trás, de modo que troca de
conta em voo, semáforo, hooks, `/color` e Esteira continuam valendo.

Neste documento, **terminal do Claude** é a tela de texto que o `claude`
desenha: a que a aba mostra hoje e que continua disponível na vista do
terminal. Nos documentos técnicos do plano ela é chamada de *TUI*.

Recorte do brainstorm: esta spec é a **frente 1 (chat núcleo)** com as
frentes **2 (decisões)** e **3 (subagentes)** dentro do desenho. As frentes
**4 (leitor de arquivos, widgets e artefatos — spec 013/B4)** e **5 (GitHub do
projeto — B3)** ficam para specs próprias.

## Decisões fechadas pelo dono (restrições, não sugestões)

- **D1 — Abordagem A (sobre o CLI interativo).** O `claude` interativo roda
  numa PTY oculta. O chat lê a conversa do arquivo que o próprio CLI grava em
  disco e escreve na PTY. Rejeitadas: Agent SDK como transporte (zona cinza de
  política de uso com login de assinatura, inclusive no repo público; medo de
  perder a versatilidade de um app próprio) e `claude -p` stream-json.
- **D2 — Perguntas e permissões por hooks.** Respondidas por hooks instalados
  **só nas sessões que o app abre**, por configuração própria da sessão; a
  configuração global do usuário não é tocada. Provado no spike: o hook
  responde AskUserQuestion sem o terminal do Claude mostrar o diálogo, nega/permite Bash sem
  prompt, e o CLI espera um hook lento (45 s) sem efeito colateral.
- **D3 — Modelo de "linhas da conversa".** A tela conhece apenas um modelo
  próprio de linhas (mensagem, pensamento, grupo de ações, ação ao vivo,
  pendência, aviso de sistema, subagente). Uma camada adaptadora o alimenta a
  partir do arquivo da conversa e dos hooks. Trocar o transporte no futuro
  troca só essa camada.
- **D4 — T3 Code como referência.** Peças independentes de transporte podem
  ser reaproveitadas com atribuição (MIT): renderização de markdown
  incremental, destaque de código, botão de copiar, bloco de comando, lógica
  de agrupamento de ações e do menu `/`/`@`. Como inspiração: timeline
  virtualizada com âncora de rolagem, painel de pendência acima da caixa,
  fila de mensagens, barra de subagentes, diff, cartão de plano. Nada do
  transporte dele (Agent SDK) entra.
- **D5 — Chat é a vista padrão** das abas de sessão `claude`; o terminal
  segue a um clique. Abas que não são do `claude` seguem terminal puro.
- **D6 — Modo Foco do chat ligado por padrão**, independente do `/focus` do
  CLI (que segue valendo só na vista do terminal). Verificado: o modo foco do
  CLI não omite nada do arquivo da conversa.

## Clarifications

### Session 2026-10-07

- Q: O que o chat mostra quando a conversa da aba muda (`/clear` e apelidos
  `/new`/`/reset`, `/resume`)? → A: Segue a conversa nova — mostra só a
  conversa ativa, com uma linha de aviso no topo apontando a anterior em
  Sessões anteriores; nome, semáforo, contexto e cor da aba acompanham a
  troca.
- Q: Onde abre a conversa de um subagente? → A: Num painel lateral dentro da
  aba, à direita, ao vivo, com a conversa principal visível e utilizável ao
  lado; a faixa do topo troca o subagente mostrado; o painel fecha com × ou
  Esc.
- Q: O que o chat mostra quando o processo `claude` da aba sai? → A: A
  conversa segue visível para ler e copiar; a caixa dá lugar à barra "Sessão
  encerrada (código N)" com Retomar (continua a mesma conversa) e Fechar aba;
  o rascunho fica guardado e volta para a caixa ao retomar.
- Q: Como o painel trata várias pendências independentes abertas ao mesmo
  tempo? → A: Uma por vez, na ordem de chegada, com o contador "mais N
  esperando"; responder uma mostra a próxima.
- Q: O que "na fila" quer dizer para mensagem enviada com o Claude
  trabalhando? → A: Fila do próprio CLI, como no terminal — a mensagem vai ao
  CLI na hora e o Claude a lê na próxima pausa entre ações, sem interromper;
  o chat mostra "na fila" até ela aparecer na conversa; depois de enviada,
  não se edita.
- Q (revisão do plano): o AS 2.2 exige que nada apareça no terminal do Claude?
  → A: Não. Basta o dono não precisar abrir o terminal. Enquanto espera, a
  pergunta também aparece no terminal oculto, e responder lá vale. Ajuste de
  redação feito no plano: o dono não conhecia o termo "TUI", que esta spec
  deixou de usar.
- Q (revisão do plano): a meta de 1 s para uma linha nova aparecer vira
  critério de sucesso? → A: Sim (SC-008).
- Q (revisão do protótipo, D-C19): com o Modo Foco ligado, as linhas de
  subagente recolhem junto com o resto? → A: Não. A mensagem que os lança e
  as linhas vivas ficam fora da parte recolhida (FR-009).
- Q (revisão do protótipo, D-C13): "Permitir sempre neste projeto" numa
  edição vale só para aquele arquivo? → A: Não. Vale para o projeto inteiro,
  e o rótulo diz isso (FR-022).
- Q (revisão do protótipo, D-C23): onde fica o painel do subagente no Modo
  Dev? → A: Na coluna da direita, no lugar do painel de detalhes da fase,
  enquanto estiver aberto (FR-027).
- Q (revisão do protótipo, D-C24/D-C25): os extras do protótipo entram? → A:
  Sim, os quatro: copiar tabela (FR-005), clipe para anexar (FR-015), Esc
  para Parar e Negar com precedência definida (FR-008), e "resultado:" no
  subagente concluído (FR-027).
- Q (revisão do protótipo, AS 6.2): qual o gesto de "interromper e mandar
  agora"? → A: Com o Claude trabalhando, o Enviar vira um botão com menu. O
  clique manda para a fila, e o menu oferece "Interromper e mandar agora".

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Conversar com o Claude pelo chat (Priority: P1)

O dono abre ou retoma uma sessão `claude` e a aba vem no chat: lê as
respostas renderizadas, escreve na caixa, envia, e sabe com certeza se a
mensagem entrou. Pode alternar para o terminal a qualquer momento sem perder
nada.

**Why this priority**: É a fundação — sem ler e escrever com confiança, nada
mais do chat tem valor. Sozinha já substitui o uso diário do terminal para
conversa comum.

**Independent Test**: Abrir uma sessão nova, trocar três mensagens com
respostas que contenham markdown, uma tabela e um bloco de código; copiar o
bloco; alternar para o terminal e voltar; retomar a sessão depois de fechar o
app.

**Acceptance Scenarios**:

1. **Given** uma aba de sessão `claude` recém-aberta, **When** ela termina de
   carregar, **Then** a vista é o chat, com a caixa de escrever focada.
2. **Given** o chat aberto, **When** o dono escreve e aperta Enter, **Then** a
   mensagem aparece como "enviando…" e passa a "entrou" quando o CLI a aceita;
   se não entrar dentro do tempo limite, vira "não foi" com as ações "tentar de
   novo" e "descartar" (que remove o cartão); o cartão "não foi" fica na posição
   do envio, em ordem cronológica com o resto da conversa, nunca preso no fim.
3. **Given** uma resposta com títulos, listas, tabela, links e blocos de
   código, **When** ela chega, **Then** aparece renderizada, com código
   colorido por linguagem, botão copiar em cada bloco e um botão para copiar
   a resposta inteira como markdown.
4. **Given** o Claude trabalhando, **When** não há texto novo ainda, **Then**
   o pé da conversa mostra "trabalhando — <ação atual>" e um botão Parar, que
   interrompe a rodada como o Esc no terminal.
5. **Given** uma conversa em andamento, **When** o dono alterna para o
   terminal, digita algo lá e volta ao chat, **Then** a mesma sessão aparece
   no chat com o que foi feito no terminal, e o rascunho da caixa continua lá.
6. **Given** uma sessão antiga retomada, **When** a aba abre, **Then** o chat
   mostra as mensagens mais recentes e carrega as anteriores conforme o dono
   rola para cima.
7. **Given** o dono rolou para cima para ler, **When** chegam mensagens novas,
   **Then** a posição de leitura não se move e aparece "novas mensagens ↓".
8. **Given** um `/compact`, uma troca de conta em voo ou um limite de conta
   atingido, **When** acontece, **Then** o chat mostra uma linha discreta de
   aviso no ponto da conversa onde ocorreu.
9. **Given** uma conversa em andamento, **When** o dono usa `/clear` (ou
   `/new`, `/reset`) ou `/resume`, pelo chat ou pelo terminal, **Then** o chat
   passa a mostrar só a conversa ativa, com uma linha no topo indicando a
   troca ("conversa nova — a anterior está em Sessões anteriores", no caso do
   `/clear`), e o nome, o semáforo, o contexto e a cor da aba acompanham a
   conversa nova.
10. **Given** uma conversa no chat, **When** o processo `claude` da aba sai
    (`/exit`, travamento, Ctrl+C duplo), **Then** a conversa segue visível
    para ler e copiar, a caixa dá lugar à barra "Sessão encerrada (código N)"
    com Retomar — que continua a mesma conversa — e Fechar aba, e o rascunho
    volta para a caixa ao retomar.

---

### User Story 2 — Nunca perder uma pergunta ou permissão (Priority: P1)

Quando o Claude pergunta com opções, pede permissão ou propõe um plano, o
dono responde por botões num painel que não some até a resposta — com o Modo
Foco ligado ou não, com a aba em foco ou não.

**Why this priority**: É a dor nomeada que o terminal não resolve (perguntas
perdidas no modo foco) e o ganho mais claro sobre o terminal do Claude.

**Independent Test**: Numa sessão em modo de permissão padrão, pedir ao
Claude que faça uma pergunta com duas opções, que rode um comando que exige
permissão e que planeje uma mudança em modo plano; responder tudo pelo
painel, com o app em segundo plano em pelo menos um dos casos.

**Acceptance Scenarios**:

1. **Given** o Claude faz uma pergunta com opções, **When** ela chega,
   **Then** aparece um painel acima da caixa com a pergunta, as opções como
   cartões (rótulo + descrição), a prévia quando houver, seleção múltipla
   quando for o caso e o campo "Outra" para resposta livre; até 4 perguntas
   aparecem empilhadas com um único botão Responder.
2. **Given** o dono responde no painel, **When** confirma, **Then** o Claude
   recebe exatamente as escolhas feitas e segue, sem o dono precisar abrir o
   terminal.
3. **Given** o Claude precisa de permissão que o CLI pediria, **When** o
   pedido chega, **Then** o painel diz em português o que ele quer fazer (com
   o diff, no caso de edição) e oferece Permitir, Permitir sempre neste
   projeto e Negar com motivo opcional; o motivo da negação chega ao Claude.
4. **Given** uma ação que o CLI aprovaria sozinho (regra de permissão, modo
   "aprovar tudo", leitura), **When** ela acontece, **Then** o chat **não**
   pergunta nada.
5. **Given** o Claude propõe sair do modo plano, **When** a proposta chega,
   **Then** o plano aparece como cartão em markdown com Aprovar e seguir e
   Pedir ajuste (que abre a caixa para o ajuste).
6. **Given** uma pendência aberta, **When** a aba não está em foco ou o app
   está em segundo plano, **Then** a aba sinaliza "esperando você" e sai uma
   notificação do sistema.
7. **Given** uma pendência que o chat não consegue responder (tempo máximo de
   espera estourado, tela interativa do CLI, estado não reconhecido), **When**
   isso acontece, **Then** o painel dá lugar à faixa "o terminal precisa de
   você" com botão para abrir o terminal; nenhuma pendência fica invisível.
8. **Given** um pedido de permissão vindo de um subagente, **When** chega,
   **Then** o painel identifica "pedido do subagente <descrição>".
9. **Given** duas ou mais pendências abertas ao mesmo tempo (ex.: pedidos de
   subagentes em paralelo e uma pergunta do principal), **When** chegam,
   **Then** o painel mostra uma por vez, na ordem de chegada, com o contador
   "mais N esperando", e responder uma mostra a próxima.

---

### User Story 3 — Ler a rodada sem o ruído das ferramentas (Priority: P1)

O dono lê o que o Claude concluiu sem rolar por dezenas de leituras, buscas e
comandos — e abre o detalhe só quando quer.

**Why this priority**: As ações de ferramenta são o que mais polui o
terminal; o Modo Foco é o hábito diário do dono.

**Independent Test**: Pedir uma tarefa que gere pelo menos 10 ações (leituras,
uma edição, um comando que falha); conferir a rodada com Modo Foco ligado e
desligado.

**Acceptance Scenarios**:

1. **Given** uma ação de ferramenta, **When** ela aparece, **Then** é uma
   linha curta em português com ícone ("Leu `x`", "Editou `y` +12 −3",
   "Rodou `npm test`", "Buscou 'z' em 8 arquivos"), que abre o detalhe:
   diff colorido na edição, comando + saída (longa cortada, com "ver tudo")
   no comando, lista de arquivos na busca.
2. **Given** várias ações seguidas, **When** a rodada as exibe, **Then** elas
   se agrupam numa linha ("9 ações — leu 5, editou 2, rodou 2") que expande.
3. **Given** uma ação que falhou, **When** ela está num grupo, **Then** o
   erro fica visível sem precisar expandir.
4. **Given** o Modo Foco ligado (padrão, lembrado entre usos), **When** uma
   rodada termina, **Then** aparecem a mensagem do dono e a resposta final;
   o resto vira "trabalhou — N ações, M notas", que expande.
5. **Given** uma nota intermediária que termina em pergunta, **When** o Modo
   Foco a recolhe, **Then** a linha recolhida ganha o selo "tem pergunta
   aqui".
6. **Given** uma skill carregada (pelo dono ou pelo Claude), **When** ela
   entra na conversa, **Then** aparece como selo recolhido "skill <nome>
   carregada" / "usou a skill <nome>", e não como o texto integral da skill.
7. **Given** um raciocínio do Claude, **When** existe, **Then** aparece como
   linha recolhida "pensou", que abre com um clique.

---

### User Story 4 — Escrever como num editor, com skills, arquivos e imagens (Priority: P2)

O dono escreve mensagens de várias linhas, chama skills e comandos e cita
arquivos com autocomplete, e anexa imagens coladas ou arrastadas.

**Why this priority**: Torna a escrita melhor que a do terminal; depende da
US1 funcionando.

**Independent Test**: Escrever uma mensagem de 5 linhas; chamar uma skill
pelo `/` com argumento; citar um arquivo pelo `@`; colar um print; colar um
texto de 500 linhas; navegar no histórico com ↑.

**Acceptance Scenarios**:

1. **Given** a caixa de escrever, **When** o dono usa Shift+Enter, **Then**
   quebra a linha; Enter envia; a caixa cresce até ~10 linhas e depois rola.
2. **Given** o dono digita `/`, **When** a lista abre, **Then** mostra as
   skills e comandos disponíveis na sessão (globais, do projeto, de plugins e
   os comandos próprios do CLI) com nome e descrição, filtrando conforme a
   digitação; setas e Tab escolhem.
3. **Given** o dono digita `@`, **When** a lista abre, **Then** mostra
   arquivos do projeto filtrando pela digitação; escolher insere a menção.
4. **Given** uma mensagem com `/skill argumento` ou `@arquivo`, **When** é
   enviada, **Then** o CLI recebe exatamente o texto escrito, sem que um
   autocomplete do terminal troque o comando ou o arquivo.
5. **Given** o dono cola ou arrasta uma imagem, **When** ela entra na caixa,
   **Then** vira anexo em miniatura removível e chega ao Claude como imagem
   legível.
6. **Given** o dono arrasta um arquivo que não é imagem, **When** solta,
   **Then** a caixa insere a menção `@caminho`.
7. **Given** uma colagem acima do limite de tamanho, **When** entra na caixa,
   **Then** vira anexo "texto colado — N linhas", que abre para conferir.
8. **Given** a caixa vazia, **When** o dono aperta ↑, **Then** volta a
   mensagem anterior da sessão.
9. **Given** uma mensagem começando com `!`, **When** o dono vai enviar,
   **Then** a caixa mostra o selo "vai rodar como comando de shell".
10. **Given** o dono troca de aba com rascunho escrito, **When** volta,
    **Then** o rascunho está intacto.
11. **Given** uma fase da Esteira que pré-digita o comando, **When** a aba
    abre, **Then** o comando aparece escrito na caixa para revisar e enviar;
    fases com auto-start enviam sozinhas pelo mesmo envio confiável.

---

### User Story 5 — Acompanhar subagentes (Priority: P2)

O dono vê cada subagente lançado, o estado dele ao vivo e o que ele fez, no
mesmo formato do chat.

**Why this priority**: Pedido explícito do dono e invisível hoje; depende das
US1 e US3.

**Independent Test**: Pedir uma tarefa que lance dois subagentes em paralelo,
um deles em segundo plano; acompanhar ambos até o fim.

**Acceptance Scenarios**:

1. **Given** o Claude lança um subagente, **When** ele começa, **Then**
   aparece uma linha na mensagem que o lançou com descrição, tipo, modelo e
   estado (rodando com tempo e última ação / terminou / falhou).
2. **Given** a linha do subagente, **When** o dono clica, **Then** abre um
   painel lateral à direita, dentro da aba, com a conversa do subagente no
   mesmo formato (ações recolhidas, foco valendo), acompanhando ao vivo se
   ainda roda; a conversa principal segue visível e utilizável ao lado, e o
   painel fecha com × ou Esc.
3. **Given** vários subagentes rodando, **When** estão ativos, **Then** uma
   faixa no topo da aba mostra quantos são e leva a cada um, trocando o
   subagente mostrado no painel lateral.
4. **Given** um subagente em segundo plano, **When** o Claude principal já
   respondeu, **Then** a linha segue "rodando" e muda sozinha ao terminar.
5. **Given** um subagente lançado por outro subagente, **When** aparece,
   **Then** o primeiro nível é mostrado com um "ver" que abre o seguinte no
   mesmo painel lateral.

---

### User Story 6 — Falar com o Claude enquanto ele trabalha (Priority: P3)

O dono manda mensagem no meio de uma rodada, para entrar na fila ou para
mudar o rumo na hora.

**Why this priority**: Conforto; o terminal já enfileira, e a US1 cobre o
essencial.

**Independent Test**: Durante uma rodada longa, enviar uma mensagem na fila e
outra com "interromper e mandar agora".

**Acceptance Scenarios**:

1. **Given** o Claude trabalhando, **When** o dono envia, **Then** a mensagem
   vai na hora para a fila do CLI e aparece "na fila" até o Claude recebê-la
   na próxima pausa entre ações, sem interromper a rodada; aí passa a
   "entrou", no ponto da conversa em que ele a leu.
2. **Given** o Claude trabalhando, **When** o dono usa "interromper e mandar
   agora", **Then** a rodada é interrompida e a mensagem é enviada em seguida.

---

### Edge Cases

- **Hook que estoura o tempo**: a pergunta fica só no terminal do Claude → faixa "o
  terminal precisa de você"; ao voltar do terminal, o chat reflete a resposta
  dada lá.
- **Responder pelo terminal** uma pendência que também está no painel: o
  painel fecha quando a conversa registra a resposta.
- **App fechado com pendência aberta**: ao reabrir/retomar, não há pendência
  fantasma no painel; o que o CLI ainda espera aparece pela faixa.
- **Arquivo da conversa ausente ou parado** (variáveis de ambiente herdadas
  desligam a gravação; CLI travado): o chat avisa que não está recebendo a
  conversa e oferece o terminal, em vez de ficar em branco.
- **Mensagem que não entra** (Enter engolido, terminal do Claude ocupado): "não foi" +
  tentar de novo ou descartar (no ponto do envio); nunca "enviando…" eterno; nunca envio em duplicidade.
- **Colagem com prefixos especiais** do CLI (`!` e outros): tratamento
  explícito, nunca disparo acidental.
- **Linha do arquivo da conversa que o chat não entende** (formato novo do
  CLI): vira bloco genérico "conteúdo não reconhecido" com o texto bruto
  disponível, sem quebrar a tela.
- **Sessão muito longa** (milhares de linhas, arquivo de dezenas de MB):
  abertura e rolagem continuam fluidas; o histórico nunca é lido inteiro.
- **Hooks globais do usuário** rodando junto aos do chat: não interferem na
  resposta do chat (e vice-versa).
- **Troca de conta em voo durante uma pendência**: a pendência segue válida.
- **`/clear` ou `/resume` enviado pelo chat**: o envio termina em "entrou"
  quando a troca de conversa acontece — nunca fica "enviando…" esperando a
  mensagem aparecer na conversa que acabou de ser deixada.
- **Tela interativa do CLI** (login, configuração): faixa "o terminal precisa
  de você".

## Requirements *(mandatory)*

### Functional Requirements

**Vista e alternância**

- **FR-001**: Toda aba de sessão `claude` aberta pelo app MUST abrir no chat;
  abas que não são do `claude` MUST seguir em terminal.
- **FR-002**: O dono MUST poder alternar chat ⇄ terminal na própria aba, por
  botão e atalho de teclado, sem reiniciar nem perder a sessão.
- **FR-003**: O chat MUST refletir o que acontecer na sessão pela vista do
  terminal.
- **FR-004**: Sempre que a sessão precisar de algo que o chat não resolve, o
  chat MUST mostrar a faixa "o terminal precisa de você" com acesso direto ao
  terminal.
- **FR-033**: Quando a conversa da aba mudar sem a aba fechar (`/clear` e
  apelidos, `/resume`), o chat MUST passar a mostrar só a conversa ativa, com
  uma linha de aviso no topo indicando a troca e apontando a conversa anterior
  em Sessões anteriores; nome, semáforo, contexto e cor da aba MUST acompanhar
  a conversa ativa, nas duas vistas.
- **FR-034**: Quando o processo `claude` da aba sair, o chat MUST manter a
  conversa visível e copiável e MUST trocar a caixa pela barra "Sessão
  encerrada (código N)" com Retomar (continua a conversa ativa) e Fechar aba,
  preservando o rascunho para depois de retomar.

**Conversa**

- **FR-005**: O chat MUST exibir mensagens do dono (com anexos) e respostas do
  Claude com markdown renderizado, código com destaque por linguagem, copiar
  por bloco de código, copiar tabela como markdown e copiar a resposta
  inteira.
- **FR-006**: O chat MUST exibir cada ação de ferramenta como linha curta em
  português com detalhe expansível (diff, comando + saída truncada com "ver
  tudo", lista de arquivos), agrupando ações consecutivas e mantendo erros
  visíveis.
- **FR-007**: O chat MUST exibir raciocínio, skills carregadas e avisos do
  sistema (compactação, troca de conta, limite) como linhas recolhidas ou
  discretas.
- **FR-008**: O chat MUST mostrar o estado vivo da rodada ("trabalhando —
  <ação>") e oferecer Parar. Com o foco na vista do chat, o Esc MUST seguir
  esta precedência:
  1. fecha o menu `/` ou `@`;
  2. cancela o campo de motivo ou de ajuste;
  3. fecha o painel lateral;
  4. nega a pendência da vez, sem motivo;
  5. Parar.
- **FR-009**: O chat MUST oferecer Modo Foco (padrão ligado, preferência
  lembrada) que mostra por rodada a mensagem do dono e a resposta final,
  recolhendo o resto com contagem e o selo "tem pergunta aqui" quando uma nota
  recolhida terminar em pergunta. A mensagem do Claude que lança subagentes,
  com as linhas vivas deles, MUST ficar fora da parte recolhida.
- **FR-010**: O chat MUST carregar o histórico de sessões retomadas a partir
  do fim, buscando o anterior sob demanda, sem ler o histórico inteiro de uma
  vez.
- **FR-011**: A rolagem MUST acompanhar o fim quando o dono está no fim e MUST
  preservar a posição de leitura quando ele rolou para cima, indicando
  mensagens novas.
- **FR-012**: Conteúdo da conversa que o chat não reconhecer MUST aparecer
  como bloco genérico com o texto bruto acessível.

**Escrita e envio**

- **FR-013**: A caixa MUST suportar várias linhas (Enter envia, Shift+Enter
  quebra), histórico por ↑, rascunho preservado por aba. Shift+Tab na caixa
  (vazia ou com texto) MUST ser repassado ao CLI, como no terminal — alterna
  o modo de permissão — em vez de mover o foco; não é repassado enquanto um
  diálogo do CLI segura a tela. A dica sob a caixa MUST mostrar o modo atual
  lido do rodapé do CLI («Shift+Tab modo: padrão / aceitar edições / plano /
  bypass»). Isto não é um botão de troca de modo (ver Out of Scope).
- **FR-014**: A caixa MUST oferecer autocomplete de skills/comandos (`/`) com
  nome e descrição e de arquivos do projeto (`@`).
- **FR-015**: A caixa MUST aceitar imagem colada ou arrastada como anexo que
  chega ao Claude como imagem legível; arquivo não-imagem arrastado MUST
  virar menção `@caminho`. Um botão de clipe MUST abrir o seletor de
  arquivos, com o mesmo destino: imagem vira anexo, outro arquivo vira
  `@caminho`.
- **FR-016**: Colagem acima de um limite de tamanho MUST virar anexo de texto
  conferível.
- **FR-017**: Todo envio MUST chegar ao CLI exatamente como escrito (sem
  interferência do autocomplete do terminal do Claude), MUST ser confirmado pela conversa
  registrada e MUST terminar em "entrou" ou "não foi" (com tentar de novo e
  descartar; o cartão fica na posição do envio, em ordem cronológica), sem
  duplicidade.
- **FR-018**: Mensagem iniciada por `!` MUST mostrar o selo de comando de
  shell antes do envio; outros prefixos com significado no terminal do Claude MUST ter
  tratamento explícito definido no plano.
- **FR-019**: Mensagens enviadas durante uma rodada MUST ir na hora para a
  fila do próprio CLI — que as entrega ao Claude na próxima pausa entre
  ações, sem interromper — e aparecer como "na fila" até a conversa
  registrá-las; por ação explícita, MUST poder interromper a rodada e ser
  enviadas em seguida. Mensagem já entregue à fila não é editável pelo chat.
- **FR-020**: Comandos pré-digitados pela Esteira MUST aparecer na caixa;
  fases com auto-start MUST usar o mesmo envio confiável do FR-017.

**Pendências**

- **FR-021**: Perguntas com opções MUST aparecer num painel acima da caixa,
  persistente até a resposta, com opções, prévia, seleção múltipla, resposta
  livre e várias perguntas por vez; a resposta MUST chegar ao Claude direto
  do painel, sem o dono precisar passar pelo terminal.
- **FR-022**: Pedidos de permissão MUST aparecer no mesmo painel **somente
  quando o CLI pediria**, descrevendo a ação em português (com diff em
  edições), com Permitir, Permitir sempre neste projeto e Negar com motivo
  que chega ao Claude. "Permitir sempre neste projeto" vale para o projeto
  inteiro: numa edição de arquivo, para todas as edições do projeto. O rótulo
  MUST dizer a regra que será gravada.
- **FR-023**: A proposta de saída do modo plano MUST aparecer como cartão com
  Aprovar e seguir e Pedir ajuste.
- **FR-024**: Pendência aberta MUST sinalizar a aba e notificar o sistema
  quando o app ou a aba não estiverem em foco.
- **FR-025**: Pendência que o chat não puder responder MUST virar a faixa do
  FR-004; nenhuma pendência MUST ficar sem sinal visível.
- **FR-026**: O mecanismo de resposta a pendências MUST valer só para sessões
  abertas pelo app e MUST NOT alterar a configuração global do usuário.
- **FR-035**: Pendências abertas ao mesmo tempo MUST aparecer uma por vez no
  painel, na ordem de chegada, com o contador "mais N esperando"; responder
  uma MUST mostrar a próxima.

**Subagentes**

- **FR-027**: Cada subagente MUST aparecer como linha viva na mensagem que o
  lançou (descrição, tipo, modelo, estado, tempo, última ação), abrindo a
  conversa dele no mesmo formato e ao vivo num painel lateral da aba, com a
  conversa principal visível e utilizável ao lado; o painel MUST fechar com ×
  ou Esc. No Modo Dev, o painel MUST ocupar a coluna da direita no lugar do
  painel de detalhes da fase, enquanto estiver aberto. Subagente concluído
  MUST mostrar "resultado:" com a primeira linha não vazia da resposta final
  dele.
- **FR-028**: Subagentes simultâneos MUST ser indicados numa faixa da aba que
  troca o subagente mostrado no painel lateral; subagentes em segundo plano
  MUST seguir atualizando após a resposta do principal; aninhados MUST
  mostrar o primeiro nível com acesso ao seguinte no mesmo painel.

**Integridade com o resto do app**

- **FR-029**: Troca de conta em voo, semáforo, faixa de cor do `/color`,
  statusbar e Esteira MUST seguir funcionando com a aba no chat, inclusive
  depois de a conversa da aba mudar (FR-033).
- **FR-030**: O app MUST garantir que a sessão grave a conversa em disco
  (ambiente herdado limpo) e MUST passar o modo de permissão explicitamente;
  se a conversa não estiver sendo recebida, o chat MUST avisar (FR-004).
- **FR-031**: O chat MUST NOT ler, gravar nem exibir credenciais.
- **FR-032**: Peças reaproveitadas do T3 Code MUST levar a atribuição exigida
  pela licença MIT.

### Itens a verificar antes da parte dependente (vão ao research do plano)

1. Gancho do CLI para "vou pedir permissão": decide allow/deny, grava
   "permitir sempre", cobre a saída do modo plano? (FR-022, FR-023).
   Plano B: aviso de permissão (provado no spike, só sinaliza) + faixa.
2. Teto do tempo de espera de hook (FR-021, FR-025).
3. Fonte da lista de skills/comandos: disco × lista oficial anunciada pelo
   CLI sem gastar cota; reconciliação (FR-014).
4. Imagem: caminho de arquivo colado vira imagem anexada no CLI, ou segue
   como caminho para a ferramenta de leitura (plano B garantido)? (FR-015).
5. Colar texto iniciado por `!` ou outros prefixos dispara modo especial no
   terminal do Claude? (FR-018).

**Resultado (07/10)**: os cinco itens foram verificados ao vivo no CLI 2.1.293
e todos têm caminho principal, sem plano B. Detalhes em `research.md`, R1–R5.

### Key Entities

- **Sessão de chat**: a aba `claude` com sua PTY oculta e o estado do
  processo (vivo ou encerrado, FR-034), o arquivo da conversa ativa (muda com
  `/clear` e `/resume`, FR-033), o modo de permissão, a vista atual
  (chat/terminal), o subagente aberto no painel lateral (se houver), o
  rascunho e a preferência de Modo Foco.
- **Linha da conversa**: unidade que a tela exibe — mensagem do dono,
  resposta, pensamento, ação, grupo de ações, ação ao vivo, aviso de sistema,
  selo de skill, subagente, conteúdo não reconhecido.
- **Rodada**: uma mensagem do dono e tudo até a resposta final; unidade do
  Modo Foco.
- **Pendência**: pergunta, permissão ou plano aguardando o dono; tem origem
  (principal ou subagente), estado (aberta, respondida, caiu no terminal) e
  ordem de chegada (o painel mostra uma por vez, FR-035).
- **Envio**: mensagem do dono com anexos e estado (enviando, na fila — do
  CLI, FR-019 —, entrou, não foi).
- **Subagente**: tipo, modelo, descrição, chamada de origem, estado e sua
  própria conversa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma sessão real é usada de ponta a ponta **só pelo chat**, sem
  abrir o terminal: conversa, skill por `/`, arquivo por `@`, imagem colada,
  pergunta com opções, permissão permitida e negada, plano aprovado,
  subagente acompanhado ao vivo.
- **SC-002**: Com Modo Foco ligado, **100%** das perguntas e permissões de uma
  bateria roteirizada aparecem no painel (as simultâneas pelo contador "mais N
  esperando") ou na faixa — zero pendências invisíveis.
- **SC-003**: **100%** das mensagens de uma bateria de envios (incluindo
  multilinha, `/skill`, `@arquivo`, colagem grande e auto-start da Esteira)
  terminam em "entrou" ou "não foi"; zero "enviando…" eternos; zero envios
  duplicados; zero comandos trocados por autocomplete.
- **SC-004**: Troca de conta em voo, semáforo, `/color` e Esteira seguem
  funcionando com a aba no chat — os smokes existentes passam sem regressão.
- **SC-005**: Uma sessão com milhares de linhas abre mostrando o fim em até
  2 s e rola sem engasgo perceptível e sem pular a posição de leitura.
- **SC-006**: Alternar chat ⇄ terminal 10 vezes seguidas preserva a sessão e o
  rascunho em todas.
- **SC-007**: Ao fim de uma semana de uso diário, o dono declara que não
  precisou abrir a vista do terminal para conversar, só para telas
  interativas do CLI.
- **SC-008**: Uma linha nova da conversa (resposta, ação ou aviso) aparece no
  chat em até **1 s** depois de o Claude registrá-la.

## Assumptions

- O CLI segue gravando a conversa em disco no formato atual (inclusive os
  arquivos e fichas de subagentes) e expondo hooks com o comportamento
  provado no spike de 07/10 (CLI 2.1.293); mudanças de formato são tratadas
  pelo FR-012 e pela camada adaptadora.
- O texto do Claude chega por bloco, não por token — limite aceito da
  abordagem A.
- O modo de permissão de cada sessão vem do launcher, como hoje; o global do
  dono (aprovar tudo) faz muitas sessões não pedirem permissão nenhuma.
- O limite de "colagem grande" e o tempo limite de confirmação de envio são
  definidos no plano com valores razoáveis.
- O visual segue o design-system do Donel; UI em pt-BR.
- Uso por um único operador (o dono), em Windows.

## Out of Scope

- Leitor de arquivos, links de arquivo clicáveis, HTML e widgets de skill
  (frente 4 — spec 013 / B4); aqui só um aviso com link para o que foi gerado.
- Painel do GitHub do projeto (frente 5 — B3).
- Trocar modelo, esforço ou modo de permissão por botão na caixa.
- Texto token a token; transporte via Agent SDK (possível no futuro pela
  camada adaptadora do D3).
- Busca dentro da conversa.
- Árvore completa de subagentes aninhados.
- Fila própria do chat, editável, que segura a mensagem até o fim da rodada
  (a fila é a do CLI, FR-019).
