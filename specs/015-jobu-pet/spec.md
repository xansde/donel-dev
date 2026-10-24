# Feature Specification: Jobu Donel, o assistente na área de trabalho

**Feature Branch**: `015-jobu-pet`
**Created**: 2026-10-21
**Status**: Implementada em 21/10/2026 (branch `015-jobu-pet`); falta a bateria do dono no alfa (`quickstart.md`)
**Input**: Descrição aprovada pelo dono no `/brainstorm` de 21/10/2026 (vault
`Projects/donel-dev/jobu-donel/brainstorm.md`, decisões D1–D10). Arte de
partida: a folha canônica `design/referencia/donel-buddy-sprites-v2.png`
(12 poses, decisão de 23/07).

## Contexto

O dono roda várias sessões do Claude em paralelo no Donel Dev e passa boa
parte do tempo em outros apps. Hoje quem o chama de volta são os avisos do
Windows: somem em segundos, não dizem quem **continua** esperando e se
acumulam sem ordem. Com quatro contas em rodízio, a troca automática de conta
também acontece sem que ele perceba.

Esta entrega põe o **Jobu Donel** — o corvo taumaturgo que já é a identidade
do app (`design/design-system.md` §10, `specs/001-mvp/ui-spec.md` §16) — como
um pequeno pet sempre por cima das janelas, num canto da tela. O rosto dele
diz de relance se alguém espera pelo dono; um balão avisa no momento em que
algo acontece; um clique leva até a sessão.

Neste documento, **sessão** é uma aba de sessão do Claude aberta no Donel
(abas de terminal comum não contam) e **esperando você** é o mesmo critério
que hoje marca a aba e dispara o aviso do Windows: a sessão terminou o turno
ou está travada numa pergunta, permissão ou plano.

## Decisões fechadas pelo dono (restrições, não sugestões)

- **D1 — O Jobu vira o assistente do dono.** Emenda a regra de 22/07 ("o
  Donel vive nos momentos de memória e rito, não sobre o trabalho"): ele ganha
  o posto de assistente na área de trabalho. Dentro do app, onde ele vive e
  onde nunca entra não mudam nesta entrega — isso é da spec do layout místico.
- **D2 — Escopo dos avisos:** só as sessões do Donel e a troca de conta.
  - *Emenda (23/10/2026, decisão do dono, `specs/016-jobu-faxina/`):* o Jobu também
    avisa o **resultado da faxina** que o próprio dono pede pelo menu ("Fazer faxina").
    É resposta a um pedido, não aviso espontâneo: aparece mesmo com o Jobu silenciado.
- **D3 — Impaciência:** toda sessão esperando você conta — inclusive a que só
  terminou o turno — até você abrir a aba dela. Se ela voltar a esperar, conta
  de novo.
- **D4 — Presença:** sempre por cima, num canto, pequeno, arrastável, lembra a
  posição; o vazio em volta não bloqueia clique; visível mesmo com o Donel na
  frente.
- **D5 — Mora no próprio Donel:** aparece e some com o app (sem o Donel aberto
  não há sessão a vigiar), atrás de um interruptor nas Preferências.
- **D6 — Balão com o fato seco:** nome da aba e o evento, nunca conteúdo da
  sessão. A persona fica no rosto e nos gestos; fala em personagem fica fora.
- **D7 — Um canal de aviso por vez:** com o Jobu visível, ele substitui os
  avisos do Windows desses eventos; escondido ou desligado, eles voltam.
- **D8 — Posição padrão:** canto inferior direito, sentado na borda da barra
  de tarefas, com o busto espiando por cima dela.
- **D9 — Protótipo antes de código:** HTML navegável local com a folha real,
  uma área de trabalho falsa e controles que simulam os eventos, aprovado pelo
  dono antes de qualquer código de tela.
- **D10 — Escalada:** esperando há mais de 10 minutos, ele fica muito
  impaciente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Saber de relance se alguém espera por mim (Priority: P1)

Trabalhando em outro app, o dono olha o canto da tela e o rosto do Jobu diz o
estado das sessões: dormindo (nenhuma aberta), lendo (alguma trabalhando),
sereno (tudo parado e já visto), impaciente (alguém esperando) ou muito
impaciente (esperando há mais de 10 minutos). Um selo mostra quantas esperam.

**Why this priority**: É o núcleo do pedido — o rosto impaciente quando há
chat pendente — e funciona sozinho, sem balão nem clique.

**Independent Test**: Com duas sessões abertas e o Donel minimizado, fazer
uma terminar o turno: o Jobu fica impaciente com o selo em 1; abrir a aba
dela: ele volta ao estado das sessões e o selo some.

**Acceptance Scenarios**:

1. **Given** nenhuma sessão aberta, **When** o dono olha o Jobu, **Then** ele
   está dormindo.
2. **Given** uma sessão trabalhando e nenhuma esperando, **When** o dono olha,
   **Then** ele está lendo o grimório.
3. **Given** sessões abertas, nenhuma trabalhando e todas já vistas, **When**
   o dono olha, **Then** ele está sereno, com o incenso.
4. **Given** uma sessão terminou o turno fora da vista do dono, **When** o
   dono olha, **Then** ele está impaciente e o selo mostra 1.
5. **Given** a sessão mais antiga esperando passou de 10 minutos, **When** o
   dono olha, **Then** ele está muito impaciente.
6. **Given** o dono abre a aba da última sessão esperando, **When** a aba fica
   ativa com o Donel em foco, **Then** o selo some e o Jobu ri por um instante
   antes de voltar ao estado das sessões.
7. **Given** uma sessão termina o turno com a aba dela ativa e o Donel em
   foco, **When** isso acontece, **Then** ela já nasce vista: nada de selo nem
   de impaciência.

---

### User Story 2 — Ser avisado na hora (Priority: P1)

Quando uma sessão termina o turno, trava numa pergunta, permissão ou plano,
ou encerra sozinha, o Jobu reage com uma pose de momento e um balão curto com
o nome da aba e o que aconteceu. Enquanto ele estiver visível, o Windows não
avisa a mesma coisa de novo.

**Why this priority**: Sem o aviso no momento, o dono só descobre a espera
quando olha o canto — e o pedido é que ele "atualize quando preciso".

**Independent Test**: Com o Donel minimizado, provocar cada evento (terminou,
pergunta, permissão, plano, encerrou) e conferir o balão, a pose e a ausência
de aviso do Windows; esconder o Jobu e conferir que o aviso do Windows volta.

**Acceptance Scenarios**:

1. **Given** uma sessão "spotsys" trabalhando, **When** ela termina o turno,
   **Then** o Jobu acena (chamando) e mostra `spotsys · terminou`.
2. **Given** uma sessão trabalhando, **When** ela para numa permissão, numa
   pergunta ou num plano, **Then** ele fica surpreso e mostra `<aba> · quer
   permissão`, `<aba> · tem uma pergunta` ou `<aba> · plano para aprovar`.
3. **Given** uma sessão com a aba aberta, **When** ela encerra sem o dono
   fechar a aba, **Then** ele fica triste e mostra `<aba> · encerrou`.
4. **Given** três sessões terminam o turno no mesmo segundo, **When** os
   avisos chegam, **Then** aparece um balão só: `3 sessões terminaram`.
5. **Given** o Jobu visível, **When** qualquer desses eventos acontece,
   **Then** o Windows não mostra aviso para ele.
6. **Given** o Jobu escondido ou desligado, **When** o evento acontece,
   **Then** o aviso do Windows aparece como hoje.

---

### User Story 3 — Ir até a sessão com um clique (Priority: P1)

O dono clica no Jobu (ou no balão) e cai na sessão que espera por ele; se
houver várias, escolhe numa lista curta, a mais antiga no topo.

**Why this priority**: Fecha o ciclo do assistente — avisar sem levar até lá
devolve o dono à caça de abas.

**Independent Test**: Com uma sessão esperando, clicar no Jobu e conferir o
Donel na frente com a aba dela ativa; com três esperando, clicar e escolher a
segunda da lista.

**Acceptance Scenarios**:

1. **Given** exatamente uma sessão esperando e o Donel minimizado, **When** o
   dono clica no Jobu, **Then** o Donel volta à frente com a aba dela ativa.
2. **Given** três sessões esperando, **When** o dono clica no Jobu, **Then**
   abre ao lado dele uma lista com nome da aba e há quanto tempo cada uma
   espera, a mais antiga no topo; clicar num item leva à aba dele.
3. **Given** nenhuma sessão esperando, **When** o dono clica no Jobu, **Then**
   o Donel volta à frente sem trocar de aba.
4. **Given** um balão de uma sessão na tela, **When** o dono clica no balão,
   **Then** cai na aba dessa sessão (no balão que juntou várias, abre a
   lista).
5. **Given** a lista aberta, **When** o dono clica fora dela ou aperta Esc,
   **Then** ela fecha sem fazer nada.

---

### User Story 4 — Saber quando a conta muda (Priority: P2)

Quando a conta em uso troca — pelo painel ou pela troca automática — o Jobu
olha o espelho e mostra a conta nova no balão.

**Why this priority**: Pedido explícito do dono, mas a troca é rara e o Donel
já mostra a conta na barra de status; o valor está em não ser pego de surpresa.

**Independent Test**: Trocar de conta pelo painel e provocar uma troca
automática; nas duas, conferir o espelho e o balão com o rótulo novo.

**Acceptance Scenarios**:

1. **Given** a conta "Interno 2" em uso, **When** o dono troca para "Interno
   3" pelo painel, **Then** o Jobu olha o espelho e mostra `Conta → Interno 3`.
2. **Given** a troca automática ligada, **When** ela troca de conta, **Then**
   acontece o mesmo aviso.

---

### User Story 5 — Conviver com ele (Priority: P2)

O Jobu nasce sentado na borda da barra de tarefas, pode ir para onde o dono
quiser, cala quando pedido, sai do caminho em tela cheia e nunca rouba um
clique que não é dele.

**Why this priority**: Um pet que atrapalha é desligado no primeiro dia — o
critério de sucesso da semana depende disto.

**Independent Test**: Arrastar o Jobu para o outro monitor, reiniciar o
Donel e conferir a posição; clicar no vazio ao lado dele e conferir que o
clique chegou à janela de baixo; abrir um vídeo em tela cheia e conferir que
ele some; silenciar e provocar um evento.

**Acceptance Scenarios**:

1. **Given** o Jobu ligado pela primeira vez, **When** ele aparece, **Then**
   está no canto inferior direito da tela principal, sentado na borda da barra
   de tarefas, com o busto por cima dela.
2. **Given** o dono arrasta o Jobu para outro ponto ou monitor, **When** o
   Donel reabre, **Then** ele volta ao mesmo lugar; fora da borda da barra, a
   base da arte esmaece em vez de mostrar um corte reto.
3. **Given** a posição lembrada ficou fora da área visível, **When** o Donel
   abre, **Then** ele volta à posição padrão.
4. **Given** o dono clica no espaço transparente ao lado do desenho, **When**
   há uma janela embaixo, **Then** o clique chega a ela.
5. **Given** um app em tela cheia na frente, **When** ele ocupa a tela,
   **Then** o Jobu some, e volta quando a tela cheia acaba.
6. **Given** o menu do botão direito, **When** o dono escolhe Silenciar por 1
   hora, **Then** nenhum balão nem aviso do Windows aparece nesse tempo, o
   rosto e o selo seguem mudando, e o menu passa a oferecer Retomar avisos.
7. **Given** o menu, **When** o dono escolhe Esconder, **Then** o Jobu some, o
   interruptor das Preferências fica desligado e os avisos do Windows voltam.
8. **Given** o menu, **When** o dono escolhe Voltar ao canto, **Then** ele
   volta à posição padrão.
9. **Given** o interruptor desligado, **When** o dono o liga nas
   Preferências, **Then** o Jobu aparece na posição lembrada (ou na padrão)
   já com o estado atual das sessões.
10. **Given** o Jobu visível, **When** o dono fecha o Donel, **Then** o Jobu
    sai junto.
11. **Given** o menu do botão direito, **When** o dono escolhe Tamanho →
    Grande, **Then** o Jobu cresce para cima a partir da base, continua no
    mesmo lugar e clicável, e o tamanho é lembrado ao reabrir o Donel.
12. **Given** o ponteiro sobre o Jobu, **When** o dono gira a roda do mouse
    com Ctrl apertado, **Then** ele cresce ou encolhe aos poucos, dentro de um
    mínimo e um máximo.
13. **Given** o Jobu na tela, **When** o dono tira um print da tela inteira ou
    compartilha a tela numa chamada, **Then** o Jobu não aparece na imagem —
    no lugar dele está o que fica atrás.
14. **Given** o menu do botão direito, **When** o dono escolhe "Liberar print
    por 1 minuto", **Then** um print tirado logo depois mostra o Jobu; passado
    1 minuto (ou depois de "Bloquear print agora"), ele volta a ficar de fora.

---

### User Story 6 — Ele parece vivo (Priority: P3)

Em repouso o Jobu balança de leve; ao avisar, dá um pulinho; quando a arte
nova chegar, pisca. Nada que chame a atenção sem motivo.

**Why this priority**: É o que o faz pet e não ícone, mas nenhuma das outras
histórias depende disto.

**Independent Test**: Observar o Jobu parado por um minuto e durante um aviso;
com a arte de piscar presente, conferir a piscada em repouso.

**Acceptance Scenarios**:

1. **Given** o Jobu em repouso, **When** o tempo passa, **Then** ele balança
   de leve, e dormindo quase não se mexe.
2. **Given** um evento com balão, **When** o balão surge, **Then** ele dá um
   pulinho uma vez.
3. **Given** as poses de piscar no repo, **When** ele está em repouso,
   **Then** pisca de tempos em tempos.
4. **Given** 20 minutos seguidos no estado sereno, **When** o tempo vence,
   **Then** ele aparece comendo o waffle por alguns segundos, uma vez por
   período parado.

### Edge Cases

- **Aba fechada pelo dono enquanto esperava**: sai da contagem, sem balão de
  "encerrou".
- **Sessão vista volta a esperar** (novo turno terminado): conta de novo, com
  balão novo.
- **Evento novo durante um balão**: o balão novo substitui o atual; o rosto,
  o selo e a lista continuam cobrindo o que o balão anterior dizia.
- **Fim do silêncio**: balões perdidos no período não são repetidos; o selo e a
  lista mostram quem ainda espera.
- **Mais de 9 sessões esperando**: o selo mostra `9+`; a lista mostra todas.
- **Nome de aba longo**: cortado com reticências no balão e na lista.
- **Escala de exibição ou resolução muda com o Jobu na tela**: ele mantém a
  proporção e continua dentro da área visível.
- **Barra de tarefas fora de baixo ou oculta**: a posição padrão é o canto
  inferior direito da área útil, com a base esmaecida.
- **Donel minimizado**: o Jobu continua na tela — é o caso principal.
- **Compartilhamento de tela e print**: o Jobu inteiro fica de fora da
  captura (FR-034); se o dono liberou o print (FR-035), o balão continua sem
  conteúdo de sessão, só nome da aba e evento (FR-018).
- **Arte nova ainda ausente**: valem as poses provisórias (FR-027).

## Requirements *(mandatory)*

### Functional Requirements

**Presença**

- **FR-001**: O app MUST oferecer o Jobu como janela própria, sempre por cima
  das outras, fora da barra de tarefas, que existe enquanto o Donel estiver
  aberto e fecha junto com ele.
- **FR-002**: O Jobu MUST poder ser ligado e desligado por um interruptor nas
  Preferências.
- **FR-003**: A posição padrão MUST ser o canto inferior direito da área útil
  da tela principal, sentado na borda da barra de tarefas quando ela estiver
  embaixo, com o corte inferior da arte escondido por ela.
- **FR-004**: O dono MUST poder arrastar o Jobu para qualquer ponto de qualquer
  monitor; a posição MUST ser lembrada entre aberturas do app; fora da borda
  da barra de tarefas, a base da arte MUST esmaecer.
- **FR-005**: Posição lembrada fora da área visível MUST voltar à posição
  padrão.
- **FR-006**: Só o desenho do Jobu, o balão e a lista MUST receber clique; o
  espaço transparente em volta MUST deixar o clique passar à janela de baixo.
- **FR-007**: O Jobu MUST sumir enquanto um app estiver em tela cheia e voltar
  quando ela acabar.
- **FR-008**: O Jobu MUST nascer com cerca de 140 px de altura em escala 100%
  (tamanho Médio, ajustável pelo FR-033) e acompanhar a escala de exibição do
  Windows.

**Estado e rosto**

- **FR-009**: Uma sessão esperando MUST contar até o dono abrir a aba dela
  (aba ativa com o Donel em foco); se voltar a esperar, MUST contar de novo.
  Sessão que passa a esperar com a aba ativa e o Donel em foco MUST nascer
  vista.
- **FR-010**: O rosto MUST seguir esta ordem de prioridade: pose de evento
  (durante o balão) > muito impaciente (a mais antiga esperando há mais de 10
  min) > impaciente (alguma esperando) > lendo (alguma trabalhando) > sereno
  (sessões abertas, todas paradas e vistas) > dormindo (nenhuma sessão).
- **FR-011**: Um selo MUST mostrar o número de sessões esperando; MUST sumir
  em zero e mostrar `9+` acima de 9.
- **FR-012**: Quando a última sessão esperando for vista, o Jobu MUST rir por
  um instante e voltar ao estado das sessões.
- **FR-013**: Depois de 20 minutos seguidos no estado sereno, o Jobu MUST
  comer o waffle por alguns segundos, uma vez por período parado.

**Avisos**

- **FR-014**: MUST gerar balão: sessão terminou o turno; sessão travou numa
  pergunta, permissão ou plano; sessão encerrou com a aba aberta sem o dono
  fechá-la; conta em uso mudou, pelo painel ou pela troca automática.
- **FR-015**: Os textos MUST ser `<aba> · terminou`, `<aba> · tem uma
  pergunta`, `<aba> · quer permissão`, `<aba> · plano para aprovar`, `<aba> ·
  encerrou` e `Conta → <rótulo da conta>`.
- **FR-016**: Durante o balão, a pose MUST ser a do evento: chamando
  (terminou), surpreso (travou), triste (encerrou), espelho (conta).
- **FR-017**: MUST haver um balão por vez, por cerca de 6 s; evento novo MUST
  substituir o atual; eventos de sessão que chegam no mesmo segundo MUST virar
  um balão só (`N sessões terminaram`, ou `N sessões esperando você` quando os
  tipos se misturam).
- **FR-018**: O balão MUST NOT conter comando, pergunta, trecho da conversa nem
  caminho de arquivo — só o nome da aba e o evento, ou o rótulo da conta.
- **FR-019**: Sessão que nasce vista (FR-009) MUST NOT gerar balão.
- **FR-020**: Com o Jobu ligado e visível, os avisos do Windows desses eventos
  MUST NOT aparecer, inclusive durante o silêncio; com ele escondido ou
  desligado, MUST voltar a aparecer como hoje, conforme a preferência de
  notificações existente.
- **FR-021**: A preferência de notificações existente MUST continuar
  governando só os avisos do Windows; o balão do Jobu MUST ter controle próprio
  (Silenciar).

**Ir até a sessão**

- **FR-022**: Clique no Jobu com uma sessão esperando MUST trazer o Donel à
  frente (restaurando se minimizado) com a aba dela ativa.
- **FR-023**: Com mais de uma esperando, o clique MUST abrir ao lado dele uma
  lista com nome da aba e tempo de espera, a mais antiga no topo; clique num
  item MUST ter o efeito do FR-022; clique fora ou Esc MUST fechar a lista.
- **FR-024**: Sem nenhuma esperando, o clique MUST trazer o Donel à frente sem
  trocar de aba.
- **FR-025**: Clique no balão MUST levar à aba da sessão do aviso; no balão que
  juntou várias, MUST abrir a lista; no balão de conta, MUST trazer o Donel à
  frente.

**Menu**

- **FR-026**: O botão direito MUST oferecer: Silenciar por 1 hora (vira
  Retomar avisos enquanto valer), Esconder e Voltar ao canto.
- **FR-027**: Silenciar MUST calar balões e avisos do Windows desses eventos
  pelo período, mantendo rosto e selo; Esconder MUST desligar o interruptor das
  Preferências; Voltar ao canto MUST restaurar a posição padrão.
- **FR-033**: O dono MUST poder redimensionar o Jobu pelo menu (Tamanho:
  Pequeno, Médio, Grande, Muito grande) e por Ctrl + roda do mouse sobre ele,
  entre um mínimo e um máximo; o Jobu MUST crescer e encolher ancorado na base,
  sem sair do lugar; o tamanho MUST ser lembrado entre aberturas do app; o
  desenho MUST continuar clicável em qualquer tamanho (pedido do dono,
  21/10).
- **FR-034**: O Jobu — desenho, balão, selo e lista — MUST ficar fora de
  capturas e compartilhamentos de tela (print, recorte, gravação, Teams, Meet,
  Zoom), continuando visível para o dono; na captura aparece o que está atrás
  dele (pedido do dono, 21/10).
- **FR-035**: O menu do botão direito MUST oferecer "Liberar print por 1
  minuto": a proteção do FR-034 sai por 60 s e volta sozinha; enquanto vale, o
  item MUST virar "Bloquear print agora", que a devolve na hora (pedido do
  dono, 21/10).

**Arte e vida**

- **FR-028**: A arte MUST vir da folha canônica v2, sem o fundo cinza, mais as
  poses novas quando existirem: impaciente, muito impaciente, chamando e
  piscando (neutro e impaciente de olhos fechados).
- **FR-029**: Enquanto uma pose nova não existir, MUST valer a provisória:
  impaciente → desconfiado; muito impaciente → bravo; chamando → falando;
  piscar → não pisca. A chegada da arte MUST NOT mudar comportamento.
- **FR-030**: As micro-animações MUST ser discretas: balanço leve em repouso,
  quase parado dormindo, um pulinho ao surgir o balão, piscar quando houver
  arte; nenhuma animação contínua chamativa.
- **FR-031**: Cores fora da arte MUST vir do design system, com o dourado de
  vela como acento; MUST NOT usar roxo.

**Identidade**

- **FR-032**: A entrega MUST registrar a emenda D1 nas seções de identidade do
  personagem (`design/design-system.md` §10 e `specs/001-mvp/ui-spec.md` §16).

### Key Entities

- **Sessão vigiada**: uma aba de sessão do Claude no Donel; nome da aba,
  situação (trabalhando, esperando — terminou ou travada, com o tipo —,
  parada, encerrada), desde quando espera e se já foi vista desde então.
- **Aviso**: um evento que gera balão; tipo (terminou, pergunta, permissão,
  plano, encerrou, conta), aba ou rótulo de conta, momento.
- **Estado do Jobu**: pose atual, número do selo, balão em exibição (texto,
  pose de evento, alvo do clique, fim), silêncio até quando, visível ou
  escondido.
- **Posição**: monitor e ponto escolhidos pelo dono, ou "padrão".
- **Tamanho**: altura do desenho escolhida pelo dono (Médio por padrão).
- **Pose**: um quadro da arte com nome (as 12 da folha v2 e as 4 novas), com a
  tabela de provisórias do FR-029.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o Donel minimizado, em **100%** dos casos de uma bateria
  roteirizada (terminou, pergunta, permissão, plano, encerrou), o rosto e o
  balão refletem o evento em até **2 s**.
- **SC-002**: Do Jobu à aba da sessão esperando: **1 clique** com uma sessão e
  **2** com várias, em **100%** da bateria.
- **SC-003**: **100%** das trocas de conta da bateria, pelo painel e
  automáticas, aparecem com o rótulo da conta nova.
- **SC-004**: **Zero** avisos duplicados: com o Jobu visível, nenhum aviso do
  Windows para os eventos da bateria; com ele escondido, todos voltam.
- **SC-005**: **Zero** cliques interceptados fora do desenho, do balão e da
  lista, e **zero** aparições sobre app em tela cheia na bateria.
- **SC-006**: **Nenhum** balão da bateria contém trecho de conversa, comando
  ou caminho de arquivo.
- **SC-007**: Ao fim de uma semana de uso diário no alfa, o dono não desligou
  nem escondeu o Jobu por incômodo (registro no diário de uso).
- **SC-008**: Em **100%** dos prints de tela inteira e dos compartilhamentos
  de tela da bateria, o Jobu não aparece; com "Liberar print por 1 minuto", ele
  aparece nesse minuto e some de novo ao fim dele.

## Assumptions

- O app já sabe o estado de cada aba de sessão — o mesmo que hoje marca
  "esperando você" e dispara o aviso do Windows — e já recebe o evento de troca
  de conta; o Jobu só consome esses sinais.
- A arte nova é gerada pelo dono no estilo da folha v2: busto, capuz com
  debrum dourado, pena branca no peito, mesmo enquadramento e escala; PNG com
  fundo transparente (ou fundo verde chapado `#00FF00`), um quadro por
  arquivo, todos do mesmo tamanho e com o personagem na mesma posição. Até lá
  valem as provisórias.
- Windows 11, um operador (o dono), um ou mais monitores. A exclusão de
  captura do FR-034 depende do Windows 10 2004 ou mais novo.
- Os 10 minutos da escalada, os ~6 s do balão, o 1 s de agrupamento e os 20
  minutos do waffle são valores iniciais, ajustáveis no plano.
- O interruptor vem desligado enquanto a entrega estiver só no alfa.
- O visual segue o design system do Donel; textos em pt-BR.

## Out of Scope

- Responder pergunta, permissão ou plano pelo Jobu — ele leva à aba; quem
  responde é o Donel.
- Avisos de fora do Donel (PR, CI, reunião, Slack) e de cota (sem conta com
  folga, renovação de janela).
- Som próprio.
- Fala em personagem e conversa com o Jobu (o Tomo/post-its seguem na US-16).
- Pet de corpo inteiro andando pela tela.
- O layout místico do app — spec própria, a seguinte.
- Funcionar com o Donel fechado.
