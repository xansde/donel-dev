# Design Handoff — Donel Dev (briefs para ferramenta de geração de design)

Cada brief abaixo é uma unidade de colagem independente: copie o **Brief 0 —
Design system** junto de QUALQUER outro brief (Brief 1 a Brief 11) e cole os
dois juntos na ferramenta de geração de design (Claude Design, Stitch etc.).
Nunca cole um brief de vista sozinho, sem o Brief 0 — ele carrega os tokens,
a tipografia e os componentes recorrentes que todas as telas usam.

---

## Brief 0 — Design system (cole sempre junto com qualquer outro brief)

Antes de gerar qualquer tela, absorva este design system — ele define a
linguagem visual completa do produto e deve ser aplicado em toda tela gerada.

### Identidade

Donel Dev é um "cockpit de operador", não um app de consumo. A sensação-alvo
é "sala de controle calma": interface densa, escura, tipografia mono para
dados técnicos (paths, nomes de sessão, terminal), cor usada quase
exclusivamente para comunicar **estado** (semáforo de sessão, smart zone de
tokens, quota de conta). Nada pisca sem motivo — o que pisca, importa de
verdade.

### Paleta de cores (dark, tema único nesta fase)

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs |
| `border` | `#28303B` | hairlines de 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels |
| `accent` | `#4C9CF0` | seleção, links, foco |
| `state-working` | `#4C9CF0` | semáforo: sessão trabalhando (pulso sutil) |
| `state-waiting` | `#E8B44C` | semáforo: aguardando resposta |
| `state-permission` | `#F0684C` | semáforo: permissão pendente (pulso forte) |
| `state-done` | `#5E6873` | semáforo: sessão encerrada |
| `zone-ok` | `#3DCE8F` | smart zone: dentro do limite |
| `zone-warn` | `#E8B44C` | smart zone: atenção |
| `zone-over` | `#F0684C` | smart zone: hora de handoff |

O terminal embutido usa tema próprio, casado com `bg-app` (paleta ANSI de
alto contraste, cursor na cor `accent`).

### Tipografia

- UI geral: Inter (ou system-ui) — 13px base, 11px para metadados, títulos
  em 15px/peso 600.
- Dados/técnico (paths de arquivo, nomes de sessão, terminal): **JetBrains
  Mono**, 12.5px.

### Densidade e grid

- Altura de linha em listas: 30–32px.
- Radius de cantos: 6px.
- Ícones: outline, 16px, estilo Lucide.
- Espaçamento base: 8px (múltiplos de 8 para paddings/margins).
- Padding interno de painéis: 12px.

### Componentes recorrentes (usar em qualquer tela que precisar deles)

**Dot de estado (semáforo de sessão)** — círculo de 8px preenchido na cor do
estado:
- Trabalhando: `state-working` (#4C9CF0), pulso de opacidade lento (ciclo de
  2s).
- Aguardando resposta: `state-waiting` (#E8B44C), fixo, sem pulso.
- Permissão pendente: `state-permission` (#F0684C), pulso rápido (ciclo de
  1s) + halo/glow ao redor do dot.
- Encerrada: `state-done` (#5E6873), fixo, sem brilho.
Sempre que houver espaço, acompanhe o dot de um label textual do estado
(acessibilidade — não depender só da cor).

**Medidor smart zone** — barra horizontal fina de 4px de altura, com
preenchimento proporcional a tokens-usados/400k. Cor do preenchimento pela
faixa: 0–70% = `zone-ok` (#3DCE8F); 70–100% = `zone-warn` (#E8B44C); acima
de 100% = `zone-over` (#F0684C). Rótulo numérico ao lado no formato
"312k/400k". Tooltip ao hover com números exatos, ex.: "312k / 400k ·
handoff sugerido".

**Badge de conta** — formato pílula, texto "Tecnologia Claude {n}" + % de
headroom colorido: verde (>40%), âmbar (15–40%), vermelho (<15%), cinza com
"—" quando não há leitura disponível.

**Chip de fase** (usado no modo Dev) — retângulo pequeno com o nome da fase
da Esteira (Discovery, Plano, Implementar, Validar, Concluir), cada fase com
uma cor fixa e distinta entre si (defina uma paleta harmônica com o restante
do sistema — interpretação, o ui-spec não fixa os hex das 5 fases).

---

## Brief 1 — Shell principal, modo "Uso geral" (P0)

*(cole junto com o Brief 0)*

**Contexto:** é a tela onde o usuário passa o dia inteiro trabalhando. É um
app desktop que gerencia múltiplas sessões de terminal Claude Code em
paralelo, organizadas por projeto, com um painel de lançamento de novas
sessões e os detalhes da sessão selecionada.

**Layout e anatomia** (desktop 1440×900):

1. **Titlebar** (topo, altura ~48px — interpretação): à esquerda, logo ("◆")
   + nome "Donel Dev" + um switch/segmented control de modo com duas opções
   "Uso geral" / "Dev" (item ativo destacado). À direita, nesta ordem: badge
   de conta ativa no formato pílula "Tecnologia Claude {n} · {%} ▾" (abre
   dropdown ao clicar) e um botão split "＋ Nova sessão" — corpo do botão
   abre direto com a última configuração de sessão Claude usada; seta
   lateral abre um menu com 2 opções: "Sessão Claude" (abre o Launcher,
   Brief 3) e "Terminal" (abre aba de terminal comum, sem passar por
   configuração).
2. **Sidebar esquerda**, 240px de largura fixa, fundo `bg-panel`, dividida em
   duas seções empilhadas verticalmente:
   - **PROJETOS**: árvore rasa (2 níveis) agrupada por diretório-raiz (ex.:
     "seazone/", "pessoal/"), com favoritos marcados com ★ sempre no topo da
     lista. Cada linha de projeto é só o nome, sem dot de estado. Favorito
     cujo diretório foi removido do disco aparece esmaecido, com uma ação
     inline "remover".
   - **SESSÕES**: lista de todas as sessões abertas no momento, cada linha =
     dot de estado + nome da sessão + projeto abreviado + modelo usado.
     Ordenação obrigatória "quem precisa de mim primeiro" — o estado do
     semáforo sempre vence: permissão pendente > falha/quota esgotada >
     aguardando resposta > trabalhando > encerrada. Sessões fixadas (pin)
     mostram um ícone de pin e ficam acima das demais, mas só desempatam
     DENTRO do mesmo estado — nunca sobrepõem o ranking por estado. (P1 —
     não incluir no corte do P0): anel fino ao redor do dot quando a sessão
     passa de 70% de uso da smart zone.
3. **Centro** (área principal, flexível): barra de abas no topo (uma aba por
   sessão aberta — dot de estado + nome + modelo; abas de terminal comum não
   têm dot de semáforo, mostram um ícone de shell no lugar; quando não
   couberem todas, scroll horizontal) e, abaixo, o terminal (emulador tipo
   xterm) da aba ativa ocupando o restante do espaço vertical, com prompt de
   input na base ("> _").
4. **Painel direito**, 260px de largura, colapsável: quando nenhuma sessão
   está selecionada, mostra o Launcher (Brief 3 completo). Quando uma sessão
   está selecionada, mostra os detalhes dela (smart zone e subagentes —
   telas P1, Briefs 6 e 7).
5. **Statusbar** (rodapé, altura ~28px — interpretação): conta ativa,
   modelo/esforço da aba em foco, contagem total de sessões abertas, e um
   mini medidor smart zone (barra de 4px) da aba em foco (P1 — não incluir
   no corte do P0).

**Estados da vista:**
- Primeira execução (nenhum projeto configurado): empty state central com
  texto explicativo e botão "Escolher pastas de projetos".
- `claude` CLI não encontrado no sistema: banner de erro no topo do centro,
  tom vermelho-coral (`state-permission`), texto indicando o caminho
  esperado do executável.
- Sem sessões abertas (mas com projetos configurados): centro mostra
  atalhos em cards: "Nova sessão", "Retomar recente", "Rotinas".
- Fechar aba com sessão ativa: modal de confirmação centralizado — título
  "Fechar sessão?", texto curto avisando que o processo será encerrado,
  botão "Fechar sessão" (cor de perigo/vermelho) e botão "Cancelar".
- Processo `claude` termina sozinho: estado "sessão encerrada" desenhado no
  CORPO do terminal (mensagem central + botões "Reabrir" e "Fechar aba"),
  visualmente distinto do dot cinza da lista de sessões.

**Dados de exemplo (usar exatamente estes):**
- Projetos na sidebar sob "seazone/": bizops-ai-native (favorito ★),
  spotsys, dalton, donel-dev, ai-rats.
- Sessões abertas de exemplo: "spec do donel" (trabalhando, azul), "radar
  spotsys" (aguardando, âmbar), "fix build_real.py" (encerrada, cinza).
- Badge de conta no titlebar e na statusbar: "Tecnologia Claude 3 · 62%".
- Statusbar completa: "Tecnologia Claude 3 · fable/high · 6 sessões ·
  [mini smart zone]".

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 2 — Lista de sessões e semáforo de estado (P0 — o coração do produto)

*(cole junto com o Brief 0)*

**Contexto:** este é o componente mais importante do produto — permite ao
usuário, de relance, saber quais das suas sessões de trabalho em paralelo
(múltiplos terminais Claude Code rodando simultaneamente) precisam de
atenção AGORA. Aparece na sidebar do shell principal e pode também existir
como painel dedicado maior.

**Layout e anatomia** de cada linha da lista (altura 30–32px cada):
`[dot de estado] nome da sessão · projeto · modelo · tempo desde a última
atividade` — dot de estado à esquerda (8px), nome da sessão em texto
primário, projeto e modelo em texto muted (11px), tempo relativo à direita
ou logo após o modelo.

**Tabela de estados** — reproduza exatamente este comportamento visual:

| Estado | Dot | Comportamento |
|---|---|---|
| Trabalhando | azul (`state-working` #4C9CF0), pulso lento de opacidade (2s) | nada exige atenção; fica na posição normal do ranking |
| Aguardando resposta | âmbar (`state-waiting` #E8B44C), fixo, sem pulso | a linha SOBE no ranking; mostra contador de tempo tipo "há 4min" |
| Permissão pendente | vermelho-coral (`state-permission` #F0684C), pulso rápido (1s) + halo ao redor | vai para o TOPO ABSOLUTO da lista, acima de tudo; entre 2+ pendências simultâneas, a mais antiga fica acima, cada uma com contador de tempo visível; opcionalmente exibe um toast/notificação |
| Falha/quota esgotada | roxo (`state-error` #B678F0), fixo | sessão morreu por erro ou quota esgotada, distinta de "encerrada"; ação inline "trocar de conta e retomar" |
| Encerrada | cinza (`state-done` #5E6873), fixo | mostra ações inline na própria linha: "reabrir" · "fechar" |

Ordenação da lista inteira, sempre: o estado do semáforo vence (permissão
pendente > falha/quota > aguardando resposta > trabalhando > encerrada); pin
só desempata dentro do mesmo estado.

**Interações:**
- Clique na linha: foca a aba correspondente no terminal central.
- Hover na linha: mostra um preview flutuante do último output da sessão (3
  linhas de texto, fonte mono, fundo `bg-raised`).
- Quando o uso de tokens da sessão passa de 70% do limite (smart zone),
  desenhe um anel fino colorido ao redor do dot de estado (cor pela faixa da
  smart zone).
- Atalhos de teclado: `Ctrl+1`..`Ctrl+9` focam a sessão na posição N da
  lista; `Ctrl+Tab` foca a próxima sessão que precisa de atenção (permissão
  > aguardando).
- (P1) Sessão rodando sob perfil com headroom < 15%: badge da conta em
  vermelho na própria linha.

**Dados de exemplo** (lista renderizada na ordem do ranking, ilustrando os
estados):
1. "revisão PR 214" — permissão pendente (vermelho, pulso rápido + halo),
   projeto ai-rats, modelo sonnet — deve aparecer no topo absoluto.
2. "radar spotsys" — aguardando resposta (âmbar), projeto spotsys, modelo
   sonnet, "há 4min".
3. "spec do donel" — trabalhando (azul, pulso), projeto donel-dev, modelo
   fable.
4. "setup do dia" — trabalhando (azul), projeto donel-dev, modelo fable.
5. "fix build_real.py" — encerrada (cinza), projeto bizops-ai-native,
   modelo sonnet, com ações inline "reabrir · fechar".

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 3 — Launcher (painel de lançamento de sessão) (P0)

*(cole junto com o Brief 0)*

**Contexto:** painel usado para configurar e iniciar uma nova sessão de
trabalho (um novo terminal Claude Code). Aparece por padrão no painel
direito do shell principal quando nenhuma sessão está selecionada, e um
subconjunto dos seus campos reaparece dentro dos detalhes de uma sessão já
viva.

**Layout e anatomia** — painel vertical, 260px de largura, dentro de
`bg-panel`, campos empilhados de cima para baixo com espaçamento de 8px:
1. Label "LANÇAR SESSÃO" (11px, muted, uppercase) no topo.
2. Campo "Modelo": segmented control com 4 opções: fable, opus, sonnet,
   haiku. Uma opção sempre selecionada (destaque com `bg-raised` e borda
   `accent`).
3. Campo "Esforço": segmented control com 5 opções: low, med, high, xhigh,
   max.
4. Campo "Permissões": select/dropdown com 6 opções: manual, acceptEdits,
   auto, plan, dontAsk, bypassPermissions — cada opção do dropdown mostra uma
   descrição curta ao lado ou abaixo do nome quando o dropdown está aberto.
5. Campo "Nome": input de texto livre, placeholder indicando que é
   opcional.
6. Campo "Projeto-alvo": mostra o projeto herdado da seleção atual na
   sidebar, mas é editável (permite trocar).
7. Botão primário "▶ Iniciar" no final, largura total do painel.

O painel inteiro é colapsável (ícone de collapse no canto).

**Estados:**
- Validação: nome vazio é um estado válido — o launcher inicia a sessão
  normalmente sem enviar flag de nome.
- Defaults dos campos Modelo/Esforço/Permissões persistem entre usos (última
  escolha do usuário vira o default seguinte).

**Interações — variante "em sessão viva"** (documentada aqui por ser o
mesmo componente, embora não seja a tela principal):
- Os mesmos segmented controls de Modelo e Esforço aparecem nos detalhes de
  uma sessão já em execução.
- Ao trocar o valor: o app injeta o comando `/model` na sessão em
  andamento; um tooltip explica "aplica na sessão em andamento".
- Quando a troca não é possível no meio da sessão: o tooltip explica o
  motivo e oferece um botão/ação "reiniciar com essa config".

**Dados de exemplo para preencher a tela:**
- Projeto-alvo: bizops-ai-native.
- Modelo selecionado: fable.
- Esforço selecionado: high.
- Permissões selecionada: acceptEdits.
- Nome: campo vazio com placeholder "opcional".

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 4 — Sessões anteriores (P0)

*(cole junto com o Brief 0)*

**Contexto:** lista o histórico de sessões já encerradas de um projeto
específico, permitindo retomar o trabalho de onde parou ou abrir uma
variação (fork) a partir de um ponto anterior. Abre quando o usuário
seleciona um projeto na sidebar do shell principal.

**Layout e anatomia:**
- Campo de busca simples por nome no topo da lista (busca full-text
  completa é P1, não incluir aqui — só filtro por nome/título visível).
- Lista de sessões anteriores do projeto selecionado, uma linha por sessão:
  `nome ou preview do início da sessão · data relativa · tamanho · modelo
  usado`.
- Cada linha tem duas ações: "Retomar" (botão primário, reabre a sessão
  exatamente de onde parou) e "Fork" (botão secundário, tooltip "nova
  sessão a partir desta").
- O preview de cada sessão nunca mostra payload de controle interno (só o
  conteúdo real da conversa/terminal).

**Estados:**
- Empty state (projeto sem sessões anteriores): texto "Nenhuma sessão
  anterior neste projeto — comece uma nova" centralizado, com botão para
  abrir o Launcher.

**Dados de exemplo** (projeto selecionado: donel-dev):
1. "spec do donel" · há 2 horas · 340KB · modelo fable — ações Retomar /
   Fork.
2. "setup do dia" · ontem · 85KB · modelo sonnet — ações Retomar / Fork.
3. "(ilegível)" · há 3 dias · 12KB · transcript corrompido/truncado, entra
   na lista sem derrubar o índice — ações Retomar / Fork.

**Dados de exemplo** (projeto selecionado: spotsys):
1. "radar spotsys" · há 4min · 120KB · modelo sonnet — ações Retomar /
   Fork.

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 5 — Perfis e quota: dropdown de contas + painel de gestão (P0 dropdown / P1 painel)

*(cole junto com o Brief 0)*

**Contexto:** o produto opera com 15 contas Claude diferentes ("Tecnologia
Claude 1" a "Tecnologia Claude 15") para distribuir quota de uso. Este
brief cobre duas variantes do mesmo assunto: o dropdown rápido de troca de
conta (usado o tempo todo, no titlebar) e o painel completo de gestão de
todas as contas (usado ocasionalmente). Gere as duas telas.

### Parte A — Dropdown de contas (P0)

Abre ao clicar no badge de conta ativa no titlebar do shell principal.

**Layout:** menu suspenso ancorado no badge, lista vertical das 15 contas
"Tecnologia Claude 1" até "Tecnologia Claude 15". Cada linha = badge de
conta (pílula com nome + % de headroom colorido) + um check (✓) marcando
qual é a conta ativa no momento. No rodapé do dropdown, dois itens fixos
separados por um hairline: "Gerenciar contas…" (abre o painel da Parte B) e
"Abrir claude-monitor ↗" (link externo para claude-monitor.seazone.dev).

**Estados/interações:**
- Ao trocar de conta: um aviso sutil (texto pequeno, muted) explica que a
  troca afeta apenas sessões NOVAS — sessões já abertas continuam na conta
  anterior. Mostrar esse aviso na primeira troca.
- Conta sem leitura de headroom disponível: badge cinza com "—" no lugar do
  percentual.

### Parte B — Painel de gestão de contas (P1)

Tela dedicada, aberta a partir de "Gerenciar contas…".

**Layout:** grade (grid) das 15 contas, um card por conta, cada card
mostrando: nome da conta, headroom atual (%), janela de reset da quota,
horário da última leitura. Dados vêm do claude-monitor.seazone.dev (via
embed ou API). Cada card tem uma ação: "abrir sessão com esta conta"
(atalho que leva ao Launcher com essa conta pré-selecionada).

**Estados:**
- Conta sem login feito: badge "login pendente" no card. Deixe claro que o
  login em si SEMPRE acontece dentro do terminal da sessão — o app nunca
  manuseia credenciais diretamente.
- Conta com junction quebrada (profile doctor, FR-005): card exibe um aviso
  + botão "Recriar links".

**Dados de exemplo** (usar para os cards/linhas; repita o padrão para
completar as 15 contas com variações plausíveis):
- Tecnologia Claude 1 · 38% (âmbar)
- Tecnologia Claude 2 · 91% (verde)
- Tecnologia Claude 3 · 62% (verde) — marcada como ativa no dropdown
- Tecnologia Claude 4 · 12% (vermelho)
- Tecnologia Claude 5 · — (cinza, sem leitura / login pendente)

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 6 — Medidor smart zone (componente transversal) (P1)

*(cole junto com o Brief 0)*

**Contexto:** componente visual que mostra o quanto do limite de contexto
(tokens) de uma sessão já foi consumido, para sinalizar quando é hora de
fazer handoff para uma sessão nova. Não é uma tela isolada — aparece
embutido em três lugares diferentes do produto. Gere as três variantes lado
a lado (ou em três seções) na mesma composição.

**Especificação do componente:**
- Barra horizontal fina, 4px de altura, com preenchimento proporcional ao
  total de 400 mil tokens.
- Cor do preenchimento por faixa: 0–70% do limite = `zone-ok` (#3DCE8F,
  verde); 70–100% = `zone-warn` (#E8B44C, âmbar); acima de 100% =
  `zone-over` (#F0684C, vermelho-coral).
- Rótulo numérico junto da barra no formato "312k/400k".
- Tooltip ao hover com números exatos, ex.: "312k / 400k · handoff
  sugerido".
- Quando a faixa é `zone-over`, exibe também uma ação sugerida em
  texto/botão: "Handoff → nova sessão" — ao clicar, abre o Launcher já
  pré-preenchido com o mesmo projeto e nome no formato "<nome da sessão
  original> (cont.)".

**Onde o componente aparece** (gere as 3 variantes):
1. Nos detalhes de uma sessão selecionada (painel direito do shell) —
   versão maior, com o rótulo numérico completo e o tooltip visível.
2. Na statusbar do shell principal — versão mini, só a barra + rótulo
   compacto, referente à aba em foco.
3. Como um anel fino ao redor do dot de estado (semáforo) na lista de
   sessões, aparecendo apenas quando a sessão passa de 70% de uso — cor do
   anel segue a mesma regra de faixa.

**Dados de exemplo** (gere as três faixas para mostrar todos os casos):
- Sessão "spec do donel": 180k/400k → `zone-ok` (verde).
- Sessão "radar spotsys": 312k/400k → `zone-warn` (âmbar), com tooltip
  "312k / 400k · handoff sugerido".
- Sessão "fix build_real.py": 410k/400k → `zone-over` (vermelho), mostrando
  o botão "Handoff → nova sessão".

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 7 — Subagentes (P1)

*(cole junto com o Brief 0)*

**Contexto:** dentro dos detalhes de uma sessão (painel direito do shell
principal), mostra quais subagentes/tasks aquela sessão disparou durante o
trabalho (ex.: buscas, subtarefas delegadas). Os dados vêm do transcript
JSONL da própria sessão.

**Layout e anatomia:**
- Seção colapsada por padrão dentro do painel de detalhes da sessão, com um
  cabeçalho tipo acordeão mostrando um contador resumido, ex.: "3
  subagentes · 1 rodando".
- Ao expandir, lista uma linha por subagente: `nome/label do subagente ·
  estado (rodando / concluído / erro) · duração`.
- Estado "rodando": indicador ativo na cor `state-working` (#4C9CF0 —
  interpretação, o ui-spec não define cor específica para este indicador).
  Estado "erro": `state-permission` (#F0684C). Estado "concluído":
  `state-done` (#5E6873) — (interpretação).

**Dados de exemplo** (subagentes da sessão "spec do donel"):
1. "pesquisa referências CodeLayer" · concluído · 4min32s
2. "gera wireframe ASCII" · concluído · 1min10s
3. "valida tokens de design" · rodando · 0min45s (em andamento)

Cabeçalho colapsado mostrando: "3 subagentes · 1 rodando".

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 8 — Post-its: captura rápida + quadro (P1)

*(cole junto com o Brief 0)*

**Contexto:** sistema de anotações rápidas para o usuário não perder um
pensamento no meio do trabalho, sem sair do fluxo. Tem duas partes: uma
mini-janela de captura instantânea (atalho global) e um quadro/vista
dedicada para revisar tudo depois. Gere as duas telas.

### Parte A — Mini-janela de captura

**Layout:** janela flutuante pequena, compacta, contendo APENAS um campo de
texto de UMA linha (sem título, sem chrome visual pesado — deve parecer
"anota e some"). Fundo na cor de post-it dessaturado (`#3A3526`) com texto
claro (`text-primary`), cantos arredondados (radius 6px).

**Interações:**
- Atalho global proposto: `Ctrl+Alt+N` abre a mini-janela.
- Enter: salva o conteúdo digitado e fecha a janela.
- Esc: cancela e fecha sem salvar.
- A janela nunca deve roubar o foco do sistema por mais de um instante —
  desenhe como algo que aparece, captura o texto rapidamente, e desaparece.
- Nota de implementação: `globalShortcut.register()` do Electron retorna
  `false` silenciosamente se o atalho já estiver tomado por outro app —
  checar o retorno, avisar o usuário e oferecer reconfigurar em vez de
  falhar em silêncio.

### Parte B — Quadro de post-its

**Layout:** vista dedicada (acessível por um ícone na titlebar do shell,
com um contador de post-its não arquivados ao lado do ícone). Corpo
principal em grid de cards de post-it — cada card no mesmo estilo visual da
mini-janela (fundo `#3A3526`, texto claro), mostrando: texto da anotação,
data, e projeto de origem (quando houver — campo opcional).

Ordenação: mais recente primeiro.

Ações por card: "arquivar", "transformar em prompt" (tooltip/label "enviar
para sessão…"), "copiar".

**Estados:**
- Persistência é local (config do app) nesta fase; não mostrar sincronização
  externa.
- Integração com o Inbox do vault Obsidian existe como ação explícita
  "arquivar no vault" (P2 — pode aparecer como opção adicional no menu do
  card, mas é feature de prioridade mais baixa).

**Dados de exemplo** (grid do quadro):
1. "lembrar de revisar PR 214 amanhã" · hoje, 14:32 · projeto ai-rats
2. "ideia: badge de conta podia ter atalho de teclado" · hoje, 10:05 ·
   projeto donel-dev
3. "perguntar sobre smart zone em modo Dev" · ontem, 17:50 · sem projeto

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 9 — Todo do projeto (P1)

*(cole junto com o Brief 0)*

**Contexto:** aba dentro do painel direito do shell principal, disponível
quando um projeto está selecionado na sidebar. Mostra a lista de tarefas do
projeto vinda do vault Obsidian (arquivo `todo.md`) e, quando o repositório
tem integração configurada, também os cards do TaskDex.

**Layout e anatomia:**
- Cabeçalho da aba/painel indica claramente a fonte dos dados sendo
  exibida: "todo.md" ou "TaskDex" (texto pequeno, muted, ex.: "Fonte:
  todo.md do vault").
- Corpo: renderiza os itens do `todo.md` como uma lista de checkboxes
  (checkbox + texto do item), respeitando eventual estrutura de seções do
  markdown original (títulos de seção como subgrupos da lista).
- Quando há integração TaskDex ativa para o projeto, mostrar também uma
  seção/lista de cards TaskDex (card compacto: título + status), abaixo ou
  ao lado da lista do `todo.md` — com o cabeçalho indicando a fonte
  "TaskDex".

**Interações e estados:**
- A tela é read-only na primeira versão, EXCETO marcar/desmarcar um
  checkbox de item do `todo.md` — essa ação escreve de volta via REST local
  do Obsidian (mesmo mecanismo do MCP `obsidian`), NUNCA escrita direta no
  arquivo sob OneDrive. Se o REST estiver indisponível, o painel cai para
  read-only com aviso.
- Cards do TaskDex não são editáveis nesta tela (somente leitura).

**Dados de exemplo** (projeto selecionado: bizops-ai-native, fonte
todo.md):
- [ ] Revisar wireframe do modo Dev
- [x] Escrever ui-spec.md
- [ ] Gerar design-handoff.md com os briefs
- [ ] Validar briefs com o Alexandre

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 10 — Modo Dev (P2 — referência visual: tela de Tasks do CodeLayer/HumanLayer)

*(cole junto com o Brief 0)*

**Contexto:** modo alternativo do app, ativado pelo switch "Uso geral | Dev"
no titlebar. Em vez de organizar o trabalho por projeto e sessões soltas,
organiza por TASK — cada task é um card de um board do TaskDex vinculado, e
o trabalho nela avança por 5 fases fixas de um processo chamado "Esteira"
(Discovery, Plano, Implementar, Validar, Concluir). Cada fase roda em uma
sessão fresca própria.

**Layout e anatomia** (mantém titlebar e proporções gerais do shell, mas o
conteúdo interno muda):

- **Sidebar esquerda (TASKS):** lista de tasks (cards vindos do board
  TaskDex vinculado ao repositório). Cada linha mostra o id/título da task
  e um chip de fase indicando em qual das 5 fases da Esteira ela está
  agora. No topo ou fim da lista, botão "+ Nova task". Uma task pode estar
  selecionada/expandida (indicado com um marcador, ex. "▣").
- **Centro:** cabeçalho da task selecionada com id + título (ex.: "SZI-142
  · Ajuste parcelas CUB"), seguido por um stepper horizontal das 5 fases da
  Esteira (Discovery, Plano, Implementar, Validar, Concluir), cada fase com
  estado visual próprio: concluída (✓), em andamento (●), ou ainda não
  iniciada (vazio/outline). Abaixo do stepper, uma tabela/lista das sessões
  associadas àquela task, uma linha por sessão: `dot de estado (semáforo) ·
  nome da sessão · chip de fase da Esteira à qual pertence · tempo desde a
  última atividade`. Um botão contextual por fase, "Iniciar fase →", dispara
  a skill correspondente (`/esteira-*`) SEMPRE numa sessão nova — nunca
  reaproveita uma sessão existente — com o medidor smart zone visível nessa
  nova sessão.
- **Painel direito (ARTEFATOS):** lista dos arquivos/artefatos produzidos
  pela task (specs, diffs), cada linha com o nome do arquivo e um contador
  de alterações (número) ao lado.

**Configuração** (mencionar como nota, não precisa desenhar uma tela
separada): existe um preset alternativo de nomes de fase, ao estilo
HumanLayer (Questions, Research, Design, Structure, Plan, Implement),
selecionável em configuração — ele só troca os rótulos e a quantidade de
chips no stepper, não a estrutura da tela.

**Importante** (regra de produto a refletir na composição, não é só
detalhe visual): os gates/aprovações do processo continuam sendo decisão
dos donos de sempre (skills/humano) — o app apenas mostra e organiza o
processo, nunca aprova nada sozinho. Não desenhe nenhum botão de "aprovar"
automático substituindo decisão humana.

**Dados de exemplo:**
- Tasks na sidebar: "SZI-142 · Ajuste parcelas CUB" (selecionada, fase
  Implementar), "SZI-155 · Webhook medalhas" (fase Plano), "SZI-160 ·
  Radar de PRs" (fase Discovery).
- Stepper da task selecionada (SZI-142): Discovery ✓, Plano ✓, Implementar
  ● (em andamento), Validar (vazio), Concluir (vazio).
- Sessões da task SZI-142: "implementa parcelas" — trabalhando (azul) ·
  chip Implementar · atualizado há 2min. "revisão do plano" — aguardando
  resposta (âmbar) · chip Plano · atualizado há 15min. "discovery
  entrevista" — encerrada (cinza) · chip Discovery · atualizado há 2h.
- Artefatos no painel direito: spec.md (2 alterações), plan.md (5
  alterações), tasks.md (sem alterações novas), diff.patch (1 alteração).

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 11 — Rotinas (P1)

*(cole junto com o Brief 0)*

**Contexto:** automação de sequências de trabalho repetidas. A primeira
rotina, criada por padrão no app, é o "Setup do dia" — uma sessão que já
nasce executando uma sequência de skills predefinida. Este brief cobre o
botão de disparo rápido e a tela de configuração de rotinas.

### Parte A — Disparo rápido

**Layout:** botão "☀ Setup do dia" visível na titlebar do shell principal e
também no empty state (quando não há sessões abertas). Ao clicar, abre uma
sessão nova diretamente no projeto configurado para essa rotina, já
executando a sequência de skills definida — sem passar pelo Launcher
manualmente.

### Parte B — Tela de configuração de rotinas

**Layout:** lista de rotinas cadastradas; ao editar uma rotina (ex.:
"Setup do dia"), mostra:
- Lista ORDENÁVEL de passos, cada passo representando uma skill ou um
  prompt (drag-to-reorder ou setas para cima/baixo).
- Campo de projeto-alvo da rotina.
- Campos de modelo e esforço (mesmos segmented controls do Launcher).
- Ao salvar/executar, a rotina funciona como um Launcher pré-preenchido com
  um prompt inicial composto a partir da sequência de passos.

**Dados de exemplo:**
- Rotina "☀ Setup do dia": projeto-alvo bizops-ai-native, modelo fable,
  esforço high. Passos: 1) "revisar Slack e Pipedrive", 2) "conferir
  heartbeat da semana", 3) "abrir board Mission Control".
- Segunda rotina de exemplo (opcional, para mostrar a lista com mais de um
  item): "Fechamento do dia" — projeto-alvo donel-dev, modelo sonnet,
  esforço med.

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 12 — Novo projeto: formulário dinâmico (P1)

**Contexto:** o usuário cria um projeto novo pelo botão "＋ Novo projeto" no
rodapé da seção PROJETOS da sidebar. O formulário coleta as respostas e o
scaffolding real roda numa sessão de terminal depois — a tela é só o
formulário e o resumo.

**Layout:** modal centrado (~480px de largura) sobre o app escurecido, um
passo visível por vez com progressão fluida (não wizard de página inteira).
Campos, na ordem, com os seguintes comportamentos dinâmicos:

1. Tipo: segmented "Pessoal | Profissional" (obrigatório, primeiro passo).
2. Nome do projeto: input de texto; ao lado, o slug kebab-case gerado
   automaticamente em fonte mono (ex.: "Radar de PRs" → `radar-de-prs`),
   editável.
3. Tema: input opcional, placeholder "ex.: automação de heartbeats".
4. Tem todo?: toggle simples com descrição "cria todo.md no vault".
5. Repositório: segmented "Nenhum | Criar novo | Vincular existente"; se
   "Vincular existente", aparece campo de path/URL; se o Tipo for
   "Profissional", aparece também a opção de vínculo TaskDex (toggle).
6. Passo final: resumo do que será criado (diretório, vault, pointer,
   TaskDex quando aplicável) em lista compacta + botão primário "Criar
   projeto" e secundário "Cancelar".

**Estados:** validação de nome duplicado (mensagem "Esse projeto já existe em
~/seazone" sob o campo); erro do scaffolding não aparece aqui (a sessão de
terminal fica aberta para diagnóstico). Rodapé do passo final traz uma linha
discreta de personagem (caption, cor muted): "Caminho novo — o nômade
aprova."

**Dados de exemplo:** nome "Radar de PRs", tipo Profissional, tema "revisão
de PRs do Spotsys", todo ativado, repositório "Criar novo" com TaskDex
ativado.

**Gerar em:** desktop 1440×900, tema dark.

---

## Brief 13 — Donel, o buddy: identidade + Tomo de post-its (P1 visual, tema transversal)

**Contexto:** o app se chama Donel Dev por causa do Jobu Donel — personagem
de RPG do dono: um tengu (homem-corvo) taumaturgo, cartomante esotérico,
nômade, colecionador de bugigangas, que via padrões onde ninguém via. Ele é
o guardião da memória do app: a área de post-its é uma conversa com ele.
Personalidade: bobo e entusiasmado, ironia rara e leve, adora analogias
improváveis que fazem sentido.

**Mascote (gerar como parte deste brief):** corvo estilizado em silhueta
preta que se funde com o fundo escuro; UMA pena branca no peito é a marca —
único highlight. Acessórios opcionais por contexto: um tomo (livro) e um
espelho pequeno. Acento esotérico em dourado de vela #E8B44C (velas,
cartas). Nada de roxo. Estático ou micro-gesto (piscar, inclinar a cabeça);
nunca animação chamativa. Derivar também o ícone do app: cabeça do corvo ou
a pena branca sozinha.

**Tela A — Tomo do Donel (quadro de post-its tematizado):** vista dedicada;
header com o mascote pequeno + título "Tomo do Donel" + frase de voz
("Você voltou! Vamos ver o que as cartas guardaram."). Grid de post-its como
CARTAS: cartões amarelo-dessaturado (#3A3526 de fundo, texto claro), canto
com data e projeto de origem. Ações por carta: manter no tomo · virar
prompt ("enviar para sessão…") · arquivar. Empty state: mascote + "Tomo
vazio. Até augúrio precisa de matéria-prima."

**Tela B — Cartas do dia:** cartão destacado no início do dia (dentro do
fluxo "Setup do dia"): o Donel apresenta 2–3 post-its antigos como uma
leitura de cartas — "Rito da manhã: acendi as velas e separei 3 cartas de
ontem que pedem tua atenção." Cada carta com as 3 ações acima.

**Tela C — Captura relâmpago:** mini-janela flutuante de UMA linha
(Ctrl+Alt+N), sem mascote (velocidade acima de charme); após Enter, toast
discreto de confirmação com voz: "Guardado no tomo."

**Regras duras (respeitar no design):** a voz do Donel aparece SÓ em
post-its/Tomo, cartas do dia, empty states e no fecho do formulário de novo
projeto. NUNCA sobre o terminal, em permissões, erros ou fluxos críticos —
esses seguem o tom neutro do Brief 0. Frases de 1 linha, em elementos
secundários, nunca em modal bloqueante.

**Dados de exemplo (cartas):** "testar o modo lote da esteira num card
real" (ontem, bizops-ai-native) · "post-it: ideia de rotina de fechamento do
dia" (seg, donel-dev) · "perguntar ao César sobre roadmap do TaskDex" (ter,
sem projeto).

**Gerar em:** desktop 1440×900, tema dark.
