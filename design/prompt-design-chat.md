# Prompt pronto — design do Chat (spec 014)

> **Como usar:** copie **tudo abaixo da linha divisória** e cole de uma vez em
> `claude.ai/design`. Não precisa abrir outro arquivo: é o design system (Parte 1)
> concatenado com o brief do chat.
>
> **Proveniência:**
> - Parte 1: design system do `prompt-design-modo-dev-v3.md`, com as 8 extensões
>   aprovadas em `design/modo-dev-verificacao.md` e `design/modo-dev-v3-verificacao.md`.
> - Partes 2–4: `specs/014-chat/spec.md` (6 histórias, 35 FRs, 5 clarificações de
>   07/10) e as decisões do `specs/014-chat/plan.md`.
>
> Se qualquer um mudar, **regere este arquivo**.
>
> **Anexe também:** `design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html`. É o
> desenho aprovado da janela (abas v3, barra de status). O chat mora **dentro da área
> da aba**, onde hoje fica o terminal.
>
> **Depois:** salve o resultado em `design/chat-handoff/`. A conferência contra a spec
> vai para `design/chat-verificacao.md` (gate da Fase 0).

---

Você vai desenhar uma **tela nova** dentro de um app desktop que você já desenhou numa
sessão anterior (anexo). Absorva o design system, depois o contexto, depois as telas
pedidas.

# Parte 1 — Design system (linguagem visual obrigatória)

## Identidade

Donel Dev é um "cockpit de operador", não um app de consumo. A sensação-alvo é "sala de
controle calma": interface densa, escura, tipografia mono para dados técnicos (paths,
nomes de sessão, comandos), cor usada quase exclusivamente para comunicar **estado**.
Nada pisca sem motivo — o que pisca, importa de verdade.

## Paleta (dark, tema único)

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs |
| `border` | `#28303B` | hairlines de 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels |
| `accent` | `#4C9CF0` | seleção, links, foco |
| `state-working` | `#4C9CF0` | sessão trabalhando (pulso sutil) |
| `state-waiting` | `#E8B44C` | sessão aguardando resposta |
| `state-permission` | `#F0684C` | sessão com permissão pendente (pulso forte) |
| `state-done` | `#5E6873` | sessão encerrada |
| `state-error` | `#B678F0` | falhou |
| `zone-ok` | `#3DCE8F` | dentro do limite / sucesso |
| `zone-warn` | `#E8B44C` | atenção |
| `zone-over` | `#F0684C` | passou do limite |
| `donel-accent` | `#E8B44C` | marca do Donel |

## Tipografia e densidade

- UI: Inter (ou system-ui) — 13px base, 11px metadados, títulos 15px/peso 600.
- Dados técnicos (paths, nomes de sessão, comandos, código): **JetBrains Mono**, 12.5px.
- Linha em listas: 30–32px · radius 6px · ícones outline 16px estilo Lucide ·
  espaçamento base 8px · padding de painel 12px.

## Componentes existentes — não recriar nenhum

Peças originais:

- **dot de estado** (semáforo de sessão, 8px redondo, 4 estados);
- **medidor smart zone**;
- **badge de conta**;
- **chip de fase**;
- **botão** (4 variantes) e **split button**;
- **input de texto** (uma linha);
- **dropdown com descrição por opção**;
- **switch**;
- **controle segmentado**;
- **aba de terminal**;
- **label editável**;
- **card post-it**;
- **modal**;
- **toast**;
- **barra de status**.

Extensões **aprovadas e já construídas** — trate como parte do sistema:
`PhaseStateGlyph`, `AnnotationTag` (etiqueta curta com tom `muted`/`ok`/`warn`/`error`/
`lock`/`accent`), `WorktreeCard`, `ArmedPrompt` (comando escrito e **não enviado**, com a
tecla Enter explícita), `LevelCarousel`, `HomologationClock`, `TerminalTab · variante v3`
(ícone de estado no lugar do farol, faixa de cor do operador, alça de arraste) e
`PhaseChip · variante documentação`.

**O que o sistema ainda não tem** e esta tela vai precisar: área de texto de várias
linhas que cresce, menu/lista de autocomplete, faixa de aviso, painel lateral, linhas de
conversa. Para cada peça que faltar, **proponha uma extensão nomeada**: nome, o que
resolve e por que nenhuma peça atual serve. **Extensão silenciosa não passa.**

**Cores:** use só os tokens. Se o destaque de código pedir cores próprias, proponha uma
**paleta de código** derivada dos tokens, como extensão nomeada.

---

# Parte 2 — O que é e por que existe

Cada aba de sessão do Claude no Donel Dev mostra hoje o **terminal cru** do Claude Code,
e ele é ruim de usar:

- **Ler:** texto corrido, código sem cor, nada para copiar com um clique.
- **Escrever:** colar, várias linhas e anexar imagem são difíceis.
- **Perguntas e permissões:** aparecem desenhadas em texto e se perdem no meio do
  trabalho.
- **Subagentes:** ficam invisíveis.

O **chat passa a ser a vista padrão dessas abas**. Por trás, o mesmo Claude continua
rodando, e o terminal fica **a um clique** (botão no cabeçalho da aba + atalho
`Ctrl+\``). Abas que não são do Claude continuam terminal.

**Vocabulário da tela:**

| Termo | O que é |
|---|---|
| **rodada** | uma mensagem do dono e tudo o que o Claude fez até a resposta final |
| **ação** | uma coisa que o Claude fez: leu um arquivo, editou, rodou um comando, buscou |
| **Modo Foco** | por rodada, mostra só a mensagem do dono e a resposta final; o resto recolhe em "trabalhou — N ações, M notas". **Ligado por padrão** |
| **pendência** | pergunta com opções, pedido de permissão ou plano esperando o dono |
| **subagente** | outro Claude que o Claude lança para uma tarefa paralela |

# Parte 3 — As telas pedidas

Desenhe **10 telas**, todas na área da aba, com a janela inteira à volta (sidebar de
projetos, abas, barra de status), conforme o anexo.

### Tela 1 — Conversa com Modo Foco ligado (o padrão)

- **Rodada 1, completa:**
  - mensagem do dono;
  - bloco recolhido "trabalhou — 9 ações, 2 notas", com o selo **"tem pergunta
    aqui"** (uma nota intermediária terminava em pergunta);
  - resposta final em markdown: título, parágrafo, **tabela**, **bloco de código**
    colorido com **copiar**, lista e um link;
  - botão para **copiar a resposta inteira** como markdown.
- **Rodada 2, em andamento:**
  - mensagem do dono;
  - no pé da conversa, **"trabalhando — Rodou `npm test`"** com o botão **Parar**.
- Na rolagem: a pílula **"novas mensagens ↓"** quando o dono rolou para cima.

### Tela 2 — Mesma rodada com Modo Foco desligado

- **Cada ação** é uma linha curta em português, com ícone por tipo:
  - "Leu `src/simulador/parcelas.ts`";
  - "Editou `parcelas.ts` +12 −3";
  - "Rodou `npm test`";
  - "Buscou 'toFixed' em 6 arquivos".
- **Ações seguidas** viram um grupo recolhido: "9 ações — leu 4, editou 2, rodou 3".
- **Uma ação falhou** dentro do grupo, e o erro aparece **sem expandir**.
- **Expandidas**, mostre duas: uma **edição** com diff colorido e um **comando** com a
  saída cortada + "ver tudo".
- **Também aparecem:** a linha recolhida **"pensou"** e o selo **"usou a skill `tdd`"**
  (recolhido; nunca o texto da skill).

### Tela 3 — Pendência: pergunta com opções

- **Painel acima da caixa de escrever**, que **não some até a resposta**.
- **Duas perguntas empilhadas** com **um único botão Responder**:
  - **A primeira**: opções em **cartões** (rótulo + descrição), uma marcada
    "(Recomendado)" e uma com **prévia**.
  - **A segunda**: **seleção múltipla**.
  - **Nas duas**: o campo **"Outra"** para resposta livre.
- **No canto**: o contador **"mais 2 esperando"**.

### Tela 4 — Pendência: permissão

- **Variante "comando"**:
  - texto: "O Claude quer rodar `npm install decimal.js`", com a explicação em
    português;
  - botões **Permitir**, **Permitir sempre neste projeto** e **Negar**;
  - o Negar abre um campo de **motivo opcional**.
- **Variante "edição"**: "O Claude quer editar `src/simulador/parcelas.ts`" com o
  **diff**.
- **Variante "de subagente"**: o painel diz **"pedido do subagente Mapear usos de
  arredondamento"**.

### Tela 5 — Pendência: plano

- O Claude propõe um plano: **cartão em markdown** (recolhível quando longo) com
  **Aprovar e seguir** e **Pedir ajuste**.
- **Segundo estado**: depois de "Pedir ajuste", a caixa de escrever vira o campo do
  ajuste.

### Tela 6 — Caixa de escrever

- **Várias linhas**: Shift+Enter quebra; a caixa cresce até ~10 linhas e depois rola.
- **Menu `/` aberto** listando skills e comandos com **nome e descrição**, filtrando
  pelo que foi digitado. Variante: **menu `@`** com arquivos do projeto.
- **Anexos**:
  - **miniatura** de imagem colada, removível;
  - ficha **"texto colado — 500 linhas"**, que abre para conferir.
- **Selo** "vai rodar como comando de shell" quando a mensagem começa com `!`.
- **Estados de envio** nas mensagens do dono: **"enviando…"**, **"entrou"**, **"não
  foi · tentar de novo"** e **"na fila"** (enviada com o Claude trabalhando).
- **Aviso** "Há texto não enviado no terminal: «refatora o cálculo de…»" com **Descartar
  e enviar** e **Abrir terminal**.

### Tela 7 — Subagentes

- **Na mensagem que os lançou**, uma **linha viva por subagente**: descrição, tipo,
  modelo e estado. Três exemplos:
  - **"rodando há 1 min 12 s"**, com a última ação;
  - **"terminou em 2 min 03 s"**;
  - **"rodando em segundo plano"**.
- **Faixa no topo da aba**: "3 subagentes rodando", que leva a cada um.
- **Painel lateral à direita**, aberto, com a conversa de um subagente **no mesmo
  formato**, ao vivo.
  - A conversa principal continua **visível e utilizável** ao lado.
  - Fecha com × ou Esc.
- **Subagente lançado por outro subagente**: primeiro nível visível, com um **"ver"**
  que abre o seguinte no mesmo painel.
- Desenhe esta tela em **1440×900** e em **1280×760** (janela típica do dono).

### Tela 8 — Faixas, barras e avisos

- **"O terminal precisa de você"**: o Claude abriu uma tela que só funciona lá (ex.:
  "Escolher modelo"). Botão **Abrir terminal**.
- **"Não estou recebendo a conversa"**: o chat avisa em vez de ficar em branco. Botão
  **Abrir terminal**.
- **Sessão encerrada**:
  - a conversa **continua visível para ler e copiar**;
  - **no lugar da caixa**, a barra "Sessão encerrada (código 0)" com **Retomar** e
    **Fechar aba**.
- **Avisos discretos no ponto da conversa onde ocorreram**:
  - "Conversa compactada — 180 mil → 12 mil tokens";
  - "Conta trocada para Conta 3";
  - "Limite da conta atingido";
  - "Gerou `relatorio-parcelas.html` — abrir";
  - "Conteúdo não reconhecido — ver bruto".

### Tela 9 — Começo e carregamento

- **Sessão nova**:
  - conversa vazia e caixa focada;
  - dicas curtas: `/` skills e comandos, `@` arquivos, colar imagem;
  - variante **"iniciando o Claude…"**, em que a caixa já aceita escrever e a mensagem
    fica "na fila" até ele ficar pronto.
- **Conversa nova depois de limpar**: no topo, "Conversa nova — a anterior está em
  Sessões anteriores".
- **Sessão antiga retomada**:
  - aparecem as mensagens mais recentes;
  - no topo, "carregando mensagens anteriores…" enquanto o dono rola para cima.

### Tela 10 — A aba

- **No cabeçalho da aba**, a alternância **Chat | Terminal**, com a dica do atalho.
- **Aba com pendência aberta** mostra **"esperando você"** (estado de permissão, pode
  piscar).
- Inclua a vista **Terminal** da mesma aba, só como referência do outro lado da
  alternância.

---

# Parte 4 — O que já está decidido (não reabrir)

- O chat é a vista padrão. O terminal fica a um clique, e alternar **não perde nada**:
  nem a conversa, nem o rascunho.
- **Modo Foco ligado por padrão**, lembrado entre usos.
- **Uma pendência por vez**, na ordem de chegada, com o contador "mais N esperando".
- **A pendência fica até ser respondida.** Com o app em segundo plano, sai uma
  notificação do sistema e a aba mostra "esperando você".
- **A conversa do subagente abre em painel lateral à direita**, com a principal ao lado.
- **Sessão encerrada**: a conversa segue legível, e a barra toma o lugar da caixa.
- **Depois de limpar a conversa**, o chat mostra só a conversa nova, com o aviso no topo.
- **"Na fila"**: a mensagem enviada com o Claude trabalhando aparece "na fila" até ele
  ler, e depois de enviada não se edita.
- **O texto chega em blocos**, não letra a letra: sem animação de digitação.
- Toda a interface em **português**.

# Parte 5 — Decisões que são suas (são forma)

- **A. Dono × Claude.** Como diferenciar a mensagem do dono da resposta do Claude sem
  virar app de mensagens de consumo. O Donel é cockpit.
- **B. Linha de ação e grupo.** Ícone por tipo, onde ficam os números (+12 −3) e como o
  erro aparece no grupo recolhido.
- **C. Painel de pendência.** Altura máxima, como um diff longo cabe e como cartões e
  prévia convivem.
- **D. Liga/desliga do Modo Foco.** Onde ele mora.
- **E. Estados de envio.** Onde e como "enviando…", "entrou", "não foi" e "na fila"
  aparecem.
- **F. Painel lateral.** A largura e o comportamento em janela estreita.

# Regras de produto que a composição precisa refletir

- **O chat só pergunta quando o Claude perguntaria.** Nunca inventa pendência, e nenhuma
  pendência fica sem sinal visível.
- **O dono decide.** Nenhum botão de "aprovar tudo automaticamente" além do que o próprio
  dono escolhe ("Permitir sempre neste projeto").
- **Nada fica pendurado.** Toda mensagem termina em "entrou" ou "não foi", nunca
  "enviando…" para sempre.
- **Copiar é de primeira classe:** código por bloco, resposta inteira, tabela.
- **O terminal está sempre a um clique**, e quando só ele resolve, a tela diz isso.
- **Credencial nunca aparece** na tela.

# Entrega esperada

1. As 10 telas em **HTML**, 1440×900, tema dark. A Tela 7 também em 1280×760.
2. Um **mapa de componentes**: cada elemento anotado com a peça do design system que o
   realiza.
3. A **lista de extensões propostas**: cada uma nomeada e justificada (inclusive a paleta
   de código, se houver).

# Dados de exemplo

- **Projeto:** `atlas` · branch `fix/parcelas-taxa-zero` · aba "atlas · parcelamento" ·
  conta "Conta 2" · modelo "Opus 5.5 · alto" · contexto 212k/400k.
- **Rodada 1** — dono: *"O simulador está arredondando errado as parcelas quando a taxa é
  zero. Corrige e roda os testes."*
  - **Ações**, em ordem:
    1. Leu `src/simulador/parcelas.ts`
    2. Buscou 'toFixed' em 6 arquivos
    3. Usou a skill `tdd`
    4. Editou `src/simulador/parcelas.test.ts` +18 −0
    5. Rodou `npm test` — **falhou: 1 de 42**
    6. Editou `src/simulador/parcelas.ts` +12 −3
    7. Rodou `npm test` — 42 passaram
    8. Leu `README.md`
    9. Rodou `npm run lint`
  - **Notas:** *"Achei também um caso com taxa negativa — trato agora ou deixo para
    depois?"* (a que leva o selo) e *"Vou cobrir primeiro com teste."*
  - **Resposta final:** título "Corrigido: arredondamento com taxa zero" e tabela
    *Parcela · Antes · Depois* (1 · R$ 333,33 · R$ 333,33 / 2 · R$ 333,33 · R$ 333,33 /
    3 · R$ 333,33 · R$ 333,34). Depois, um bloco TypeScript com a correção, a lista
    "Próximos passos" e o link "Documentação do Intl.NumberFormat".
- **Rodada 2** — dono: *"Troca o cálculo para usar decimal.js e me mostra o plano antes."*
- **Pergunta** (Tela 3):
  - **1.** "Qual regra de arredondamento usar?"
    - "Ajustar a última parcela (Recomendado)" — "A diferença de centavos vai para a
      última parcela." (com prévia em tabela)
    - "Distribuir os centavos" — "Espalha a diferença pelas primeiras parcelas."
    - "Truncar e compensar na primeira" — "Corta as casas e soma a diferença na
      primeira."
  - **2.** "Onde aplicar?" (múltipla): Simulador · Relatório de repasse · API pública.
- **Plano** (Tela 5) — "Trocar float por decimal.js no simulador", em 5 passos.
- **Subagentes** (Tela 7):
  - "Mapear usos de arredondamento" — Explore · sonnet · rodando há 1 min 12 s ·
    última ação "Buscou 'Math.round' em 14 arquivos".
  - "Revisar casos de borda dos testes" — general-purpose · haiku · terminou em 2 min
    03 s.
  - "Medir desempenho do simulador" — rodando em segundo plano.
- **Sessão encerrada:** código 0.
