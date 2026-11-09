# 02 — O que o Oráculo mostra hoje

> Levantamento, sem mudança de código. Base: `origin/staging` em **56c7ca22** (merge do PR #382, 09/11/2026
> 12:34), que é o estado desta worktree. Todo `arquivo:linha` abaixo é desse commit.
> Pergunta do dono que guia o recorte: *"As cartas não mostram tudo que precisam mostrar, não são modulares
> para responder tudo que aparece"* e *"Deve ser onde ficam as decisões que PRECISAM REALMENTE DE MIM"*.
> Limites respeitados: Oráculo e ledger não são ligados um ao outro aqui; andamento e histórico entram só
> para dizer **onde** aparecem hoje, sem virar objetivo.

## 0. Como foi feito

- Li o código de cada superfície (lista na seção 1) e o histórico com `git log` (hashes e datas citados).
- **Registro real:** li em modo leitura o `ledger.json` do Oráculo desta VPS (`~/.donel/oraculo/ledger.json`,
  09/11 ~12:39, 462 tarefas). Os números estão na seção 7, e os casos reais aparecem como "evidência".
- **Prints sem abrir o app** (em `prints-hoje/`):
  - **Celular (PWA):** os arquivos da PWA da worktree foram servidos por um servidor local de demonstração
    que responde `/api/fila` com o **mesmo adaptador do app** (`createLedgerMobilePort`) sobre o registro
    real, sem gravar nada; o Chromium headless (Playwright) fotografou em 390×844 e 1280×860. São as 7 cartas
    que esperavam o dono naquele momento.
  - **Desktop (`OracleCenter`):** o componente React foi montado fora do Electron (esbuild + Chromium
    headless) com um `window.donel` falso, só de leitura, e um **registro de demonstração** criado pelas
    operações do próprio contrato (`applyLedgerOp`). Os prints com imagem usam figuras de demonstração no
    lugar dos prints reais. Tentei usar o registro real também no desktop; uma trava de segredos do
    ambiente bloqueou a leitura do arquivo por aquele comando, e eu não contornei.
  - Scripts em `~/seazone/_scratch/oraculo-prints/` (fora do repo).

## 1. Mapa das superfícies

| Superfície | Onde mora | Para que existe hoje | Quando aparece |
|---|---|---|---|
| **Oráculo no centro** (desktop) | `src/renderer/src/OracleCenter.tsx` | caixa "Esperando você" + tabela de todas as tarefas + cartas por cima | centro da janela em "Uso geral", ligado por padrão (`src/shared/layoutPrefs.ts:17`; `App.tsx:2973-2974`, `:3399`); seletor Oráculo/Terminais e Ctrl+Shift+O (`App.tsx:3314-3321`, `:2809`) |
| **Caixa "Esperando você"** | `src/renderer/src/Mindscape/OwnerInbox.tsx` + regra pura `src/shared/ledger/inbox.ts` | tudo o que espera o dono, em 7 tipos | no topo do Oráculo; também sobre o quadro, aberta pela faixa do Mindscape |
| **Cartas** | `src/renderer/src/Mindscape/LedgerCards.tsx` | onde o dono decide | sobrepostas ao Oráculo ou ao quadro |
| **Tabela** | `src/renderer/src/LedgerTable.tsx` + `src/shared/ledger/table.ts` | registro legível de todas as tarefas | abaixo da caixa, no Oráculo do centro |
| **Faixa do Mindscape** | `src/renderer/src/Mindscape/LedgerStrip.tsx` | números do quadro + botão "N esperando você" | topo do quadro (Mindscape), se o quadro tem tarefa |
| **Painel do Jobu** "Progresso · seus pedidos" | `src/renderer/src/pet/JobuProgress.tsx` + `src/shared/pet/progress.ts` | andamento dos pedidos do dono por frente, e a ordem de prioridade | no balão do Líder (botão "Progresso", `pet/LiderTalk.tsx:221`, `:261`) |
| **PWA do celular** | `src/main/celular/pwa/*` + `src/main/celular/ledger-port.ts` | baralho de cartas, "Pedir" ao Líder, "Seus pedidos", avisos | celular pareado, pela Tailscale |
| **Carta de Slack** | `src/shared/ledger/contract.ts:926-983` | o dono confere uma mensagem antes de sair em nome dele | como carta normal (tipo "Aprovar carta") |
| **Hill climbing** | `src/main/hill-climb-store.ts`, `src/renderer/src/HillClimb/HillClimbBar.tsx` | proposta vira carta; o fim de rodada é uma "carta de decisão" **fora** do Oráculo | Oráculo (proposta) e barra esquerda do modo "hill" (fim de rodada) |
| **Vigia de travas** | `src/main/vigia/vigia-service.ts` | trava na VPS vira carta de risco alto | como carta normal |

## 2. Superfície por superfície

### 2.1 Oráculo no centro (desktop) — `OracleCenter.tsx`

Commits: 8260d565 (06/11, "o Oráculo no lugar da conversa do Líder"), 62391847 (07/11, caixa), f54ee4db
(07/11, tabela), 322d7c74 (09/11, coluna Sessão).

Prints: `prints-hoje/desktop-oraculo-centro.png`, `desktop-oraculo-estreito.png`.

De cima para baixo:
1. **Caixa "Esperando você"** quando há itens (`OracleCenter.tsx:82-85`), com no máximo 45% da altura e
   rolagem interna (`OracleCenter.module.css:47-51`). Sem itens, vira uma linha: "Nada esperando você ·
   N abertas · N em execução · N entregues sem aceite" (`OracleCenter.tsx:87-92`). **Esses contadores são
   andamento**, não decisão.
2. Aviso "Gravado por uma versão mais nova do Donel: aqui é só leitura" (`:94`).
3. **Tabela de todas as tarefas** (`:95-96`) ou o vazio "Nenhuma tarefa ainda / Fale com o Líder pelo Jobu"
   (`:98-101`).
4. **Cartas** por cima de tudo, ao abrir um item (`:104-106`).
5. Em tela estreita (até 760 px) vira uma coluna só e o Oráculo inteiro rola (`OracleCenter.module.css:77-91`).

O Oráculo no centro **não tem** busca por decisão, agrupamento por quadro na caixa (só diz o quadro em cada
item, `OwnerInbox.tsx:120`), nem histórico do que o dono já decidiu como lista própria. O histórico existe só
como coluna "Decisão" e linha do tempo da tabela.

### 2.2 Caixa "Esperando você" — `OwnerInbox.tsx` + `inbox.ts`

Commit 62391847 (07/11). Print: `desktop-oraculo-centro.png` (parte de cima).

- **Cabeçalho:** contador grande "Esperando você N", título "Tudo o que depende de você, em um lugar" e a
  frase "Primeiro o que trava alguém, depois o prazo, depois a idade. A mais antiga espera há X"
  (`OwnerInbox.tsx:191-199`). Sobre o quadro, ganha "Fechar (Esc)" (`:200-204`).
- **Grupos por tipo**, cada um com glifo, rótulo e contagem (`:206-219`). Os 7 tipos vêm de `inbox.ts:65`
  e as regras de `inbox.ts:106-128`:

| Tipo (rótulo na tela) | Quando entra (inbox.ts) | Trava alguém? (`:68-76`) | Botão | Abre a carta? (`:86`) |
|---|---|---|---|---|
| Decidir entrega ◆ | entregue, risco alto, sem carta de Slack (`:112`) | sim | Decidir | sim |
| Aprovar carta ✉ | carta de Slack entregue (`:111`) | sim | Ver a carta | sim |
| Entrega parada ◇ | entregue, risco baixo, 24 h sem decisão (`:113`, `:79`) | sim | Decidir | sim |
| Amostra do Revisor ✓ | aceite do Revisor na 1ª semana, até 3/dia (`:125`) | não | Conferir | sim |
| Para repassar → | lugar dono fechou/saiu/não começou (`:126-127`) | sim | Ver detalhes | **não**: abre o pedido + dica "Peça ao Líder, pelo Jobu" (`OwnerInbox.tsx:35-40`) |
| Carta parada ✉ | carta aceita e não enviada há 30 min (`inbox.ts:118`, `:81`) | sim | Ver a carta | **não**: mostra o texto + dica (`OwnerInbox.tsx:41-46`) |
| Conferir envio ⚠ | envio sem resposta em 10 min ou recusado (`inbox.ts:119-124`) | não | Ver o envio | **não**: "Confira no Slack" (`OwnerInbox.tsx:47`) |

- **Cada item:** título (até 90 caracteres, `OwnerInbox.tsx:60-63`), selo "risco alto", linha de
  metadados "quadro · para #canal · quem · há X" (`:119-124`), o motivo para os tipos sem carta (`:132`).
- **Ordem:** trava alguém, depois prazo, depois idade (`inbox.ts:141`).
- **A caixa nunca grava** (`OwnerInbox.tsx:4-5`). Três dos sete tipos não têm resposta na tela: o dono
  só lê e é mandado ao Jobu ou ao Slack.

### 2.3 As cartas — `LedgerCards.tsx`

Commits: 9fd149f4 (05/11, cartas forma A no desktop), 8bdee5ed (05/11, protótipo dentro da carta), e52d1ddd
(05/11, escrever na carta), 1707ea6d (06/11), c20bcf23 (07/11, "escrever a própria opção decide").
Origem do desenho: branch `origin/proto/cartas`, 321c6736 (05/11), `docs/prototipos/carta-oraculo/decisao.md`
(forma A escolhida; "protótipo sobe ao dono **só quando há 2 jeitos bons**"). A spec citada no código,
`docs/specs/cartas-forma-a.md`, **não está em staging**: só existe naquela branch.

Prints: `desktop-carta-decidir-entrega.png`, `desktop-carta-aprovar-carta.png`,
`desktop-carta-slack-verso.png`, `desktop-carta-slack-verso-detalhes.png`,
`desktop-carta-antes-depois-como-comparacao.png`, `desktop-carta-entrega-parada.png`.

**A mesa:** à esquerda a "mão" com uma mini-carta por item, rotulada "Decisão sua", "Entrega para conferir"
ou "Amostra do dia" (`LedgerCards.tsx:615-626`), e "Fechar (Esc)" (`:627-631`); no meio, uma carta grande de
**470 px de largura fixa** (`LedgerCards.module.css:100`). O naipe (Martelos, Escudos…) é o papel de quem
entregou (`LedgerCards.tsx:596`). Decidir passa à próxima carta (`:604-610`).

**Carta A (com o bloco "para o dono")**, `CardA`, `:332-476`:
- Frente: naipe e índice romano "II · IV" (`:384-390`); título e **a pergunta** (`:391-394`); **um** visual
  (`:396`); "Recomendo X: porquê" (`:397-401`); **2 a 4 botões de opção** com rótulo, "recomendo" e efeito
  (`:402-416`); "✎ Escrever para <quem fez>" (`:418`); rodapé com selo de risco e "↻ Virar" (`:420-428`).
- Escolher é **dois cliques**: o primeiro marca ("Clique de novo para decidir"), o segundo decide (`:363-376`, `:413`).
- Verso: "O que aconteceu", "Por que eu recomendo…", "Cada caminho" (efeito e risco de cada opção),
  "Risco", "A conversa", "Quem fez" e, recolhidos, "O que você pediu, nas suas palavras" e "Detalhes
  técnicos" (critério, nota, **provas**, ids) (`:442-469`, `Folded` `:295-330`).
- Escrever (`WriteBox`, `:74-149`): área de texto de até 2000 caracteres (`:114`). Dá para **"Decidir assim"**
  (fecha a carta com o texto como opção "Outra", `:95-104`, `:132-134`) ou **"Só perguntar (a carta fica)"**
  (manda à sessão sem fechar, `:82-93`, `:135-137`). O que foi mandado aparece embaixo com recibo (`:141-146`).

**Carta antiga** (sem bloco "para o dono", ou amostra do Revisor), `OldCard`, `:479-560`: uma face só com
pedido, "Pronto quando", nota, provas e "Entregue por" (`:506-530`). Respostas: **Aceitar** / **Rejeitar…**
com campo "Motivo" de uma linha; na amostra, **Conferi** / **Rejeitar…** (`:532-551`).

**Como cada prova aparece:**
- Print: imagem na frente, clica para ampliar (`ProofImage`, `:182-203`).
- Protótipo `.html`: roda **dentro da carta** num iframe isolado, sem rede e sem acesso ao app, com "⤢ Tela
  cheia" (`Prototype`, `:210-220`).
- Vídeo: player com controles (`:228`).
- Texto (saída de comando): **só no verso**, dentro de "Detalhes técnicos", recolhido em "Saída (N
  caracteres)" (`ProofDetail`, `:278-284`).
- Link: botão com a URL, só no verso (`:286-291`).

### 2.4 Tabela — `LedgerTable.tsx` + `table.ts`

Commits f54ee4db (07/11), de84947a (08/11), 322d7c74 e 0747ecac (09/11). Print: `desktop-oraculo-centro.png`
(parte de baixo), `desktop-tabela-detalhe.png`.

- **Filtros com contagem:** Esperando você · Sem executor · Cartas · Tudo (`table.ts:32-37`; regras
  `:121-133`; "Cartas" = cartas de Slack, `:128-129`). Abre em "Tudo" (`LedgerTable.tsx:191`).
- **Busca** "por frase, pessoa, lugar, código…" (`LedgerTable.tsx:208-215`).
- **12 colunas:** Código, Título (✉ nas cartas de Slack), Estado, Com quem está, Quem pediu, Quem faz agora,
  Sessão, Quem criou, Risco, Prazo (com "vencido"), Última entrega, Decisão (`:220-234`, `:253-288`).
- **Painel lateral** ao clicar numa linha: código, estado, risco, quadro, título, "Abrir a carta para
  decidir" (só nos tipos com carta, `:104-108`), a frase de quem pediu, papéis (pediu, registrou, faz agora,
  sessão, com quem está, quem decide, prazo), "Pronto quando", decisão e motivo, provas e **linha do tempo**
  (`:92-166`).
- A tabela **só lê**; decidir sempre abre a carta (`LedgerTable.tsx:1-5`).
- Isto é **registro e andamento** de todas as tarefas: no print de demonstração, 3 das 10 linhas são
  decisão do dono.

### 2.5 Faixa do Mindscape — `LedgerStrip.tsx`

Commits 2fa31b30, 9fd149f4, 3f21c5a6 (05/11), 62391847 (07/11).

Uma linha no topo do quadro (`LedgerStrip.tsx:69-87`): "Oráculo Harrow · N abertas · N em execução · N
entregues sem aceite · **[N esperando você · a mais antiga há X]** · N% validadas sem você". Só o botão do
meio é decisão: ele abre a caixa daquele quadro por cima do quadro (`:75-84`, `:88`). Some se o quadro não
tem tarefa (`:65`). Os outros quatro números são andamento e auditoria.

### 2.6 Painel do Jobu — "Progresso · seus pedidos"

Commits ffef8b26, 8579ea8b (07/11), 2f759029 e 2e81b70c (09/11).

- Abre pelo botão "Progresso" no balão do Líder (`pet/LiderTalk.tsx:221`, `:261`).
- Cabeçalho "Progresso · seus pedidos" e "atualizado às HH:MM" (`JobuProgress.tsx:272-275`); resumo com 4
  contagens: esperando você, travados, tocando, parados (`:280-287`).
- Uma linha por **frente**, com chevron para recolher, %, barra em segmentos por pedido e chips de contagem
  (`:181-236`); dentro, um pedido por linha com estado, quem tem e prazo (`:161-179`).
- **Setas ▲▼** em cada pedido e em cada frente: dão a **ordem de prioridade**, gravada no registro
  (`:148-159`, `:256-268`; regra em `src/shared/ledger/prioridade.ts:1-5`). É o único lugar do app onde o
  dono ordena coisas.
- "N concluídas hoje" recolhido (`:304-321`) e um parágrafo explicando as regras (`:322`).
- "Esperando você" aqui = entregue de risco alto (`src/shared/pet/progress.ts:142`). **O pedido não é
  clicável**: não abre a carta nem o Oráculo. O painel é andamento, com uma resposta embutida (a ordem).

### 2.7 PWA do celular — `src/main/celular/pwa/`

Commits: ab501f77 e 664001fc (06/11, Pedir), cfd05266, 39740273, 1707ea6d (06/11), c20bcf23 (07/11).

Prints: `pwa-celular-carta-01.png` a `-07.png`, `pwa-celular-carta-01-verso.png`, `pwa-celular-escrever.png`,
`pwa-celular-pedir.png`, `pwa-tela-larga-carta-01.png`.

- **Topo:** glifo, "Oráculo Harrow" + "N esperando você", botões **Pedir**, **Avisar neste celular** (sino) e
  **Atualizar** (`index.html:22-40`; contagem `app.js:209-210`). No celular de 390 px o título aparece
  cortado ("Oráculo …", print `pwa-celular-carta-01.png`).
- **Baralho:** uma carta por tela, rolagem vertical que encaixa (`app.js:1-3`); vazio = "O baralho está
  vazio" (`:213-221`).
- **Fila do celular = `ownerQueue`** (`ledger-port.ts:175`; `contract.ts:1273-1277`): só **entregas de risco
  alto** e **amostra do Revisor** (`contract.ts:1234-1236`), da mais antiga para a mais nova. Não entram
  Entrega parada, Para repassar, Carta parada e Conferir envio.
- **Carta A** (`montarCartaA`, `app.js:485-647`): mesma frente e verso do desktop. Com print, vídeo ou
  protótipo, a prova ocupa a carta ("palco") e a decisão vai para uma gaveta embaixo, aberta por "N caminhos
  ▴", com atalho "Recomendo X" (`:503-571`). Escolher é **dois toques** (`:826-836`). Escrever igual ao
  desktop: "Decidir assim" / "Só perguntar" (`:649-824`, texto em `:660`, `:669`).
- **Carta antiga** (`montarSlot`, `:838-929`): pedido, "Pronto quando", nota, provas, "Entregue por", e os
  botões **Rejeitar** / **Aceitar** (ou **Confirmo** na amostra). Só aqui existe o **arrastar**: para a direita
  aceita, para a esquerda pede o motivo (`:925`, `:951-990`; limiar 28% da largura, `:8`). A folha "Por que
  rejeitar?" aceita até 2000 caracteres (`index.html:69-79`). Print `pwa-celular-carta-04.png`.
- **Pedir** (`pedir.js`, `index.html:44-67`): folha "Pedir ao Líder" com texto de até 4000 caracteres, botão
  Gravar (voz transcrita no PC) e "Enviar ao Líder". Abaixo, **"Seus pedidos"**: cada pedido com texto,
  estado ("Na fila: o Líder está fechado", "Entregue ao Líder", "Virou tarefa"), hora e, se virou tarefa,
  « título » · estado (`pedir.js:131-150`). É registro e andamento.
- **Avisos (push):** saem para **todos os 7 tipos** da caixa (`webpush.ts:149-157`, `:187`); os tipos de
  carta abrem `/#carta=<id>` (`:160-169`).

### 2.8 Cartas de Slack

Commits 0859f2e7, 3fd466d4, 0e8a74c5 (06/11), cbaaea00 (07/11), 6efde239 (09/11: "carta deixa de travar
envio ao Slack"; a ferramenta passou a ser **opcional**, `tools.ts:377`).

- **[corrigido pelo crítico: faltava]** Staging não exige mais a carta, mas o app em execução ainda exige. As
  instruções do servidor MCP `donel` que as sessões recebem em 09/11 ainda dizem "SEMPRE antes uma carta_slack
  (…) sem ela o envio é bloqueado". Esse texto saiu do código em `6efde239` (09/11 12:09), segundo
  `git log --all -S "sem ela o envio é bloqueado"`. Enquanto o app não for atualizado, as sessões seguem gerando
  carta de Slack.
- Nasce entregue e de risco alto (`createSlackLetter`, `contract.ts:952-983`). A carta é **escrita pelo app**, sempre igual
  (`slackForOwner`, `contract.ts:926-945`): pergunta "Posso mandar esta mensagem no Slack em seu nome?",
  resumo "Para <destino>. Motivo: …", opções fixas **Enviar** (recomendada) e **Não enviar**.
- **O texto exato da mensagem vai como prova de texto** (`contract.ts:975`). Na carta, essa prova aparece
  só no verso → "Detalhes técnicos" → "Saída (N caracteres)" (`LedgerCards.tsx:278-284`, `:303-322`), e no
  celular também só dentro de "Detalhes técnicos" (`app.js:625-630`). **A frente não mostra a mensagem que
  vai ser aprovada.** Print: `desktop-carta-aprovar-carta.png` (frente sem o texto) e
  `desktop-carta-slack-verso-detalhes.png`.
- Só nos tipos sem carta da caixa (Carta parada, Conferir envio) a mensagem aparece inteira, em `Details`
  (`OwnerInbox.tsx:80-91`).

### 2.9 Hill climbing

- `hillclimb_propor` cria uma tarefa de risco alto e a entrega com uma carta fixa: "Rodar esta missão de
  hill climbing?", opções **Rodar** / **Não rodar**, alvo e critérios **só como prova de texto** (no verso)
  (`hill-climb-store.ts:219-262`, `:318-345`). Commit 61b64286 (06/11).
- O **fim de cada rodada** (a "Carta de decisão · rodada N": direções com a pior nota, a recomendada, a
  melhor versão, a curva da menor nota por round, versões intermediárias e os gestos **Parar e aceitar**,
  **Mais uma rodada**, **Redirecionar · dar uma referência** com texto livre) **não está no Oráculo**: mora
  na barra esquerda do modo "hill" (`HillClimbBar.tsx:395-507`; montada em `App.tsx:3622`, com
  `hillOn = appMode === 'hill'`, `App.tsx:542`). A missão "pausada" não gera item na caixa (a palavra
  `pausada` não aparece em nenhuma superfície do Oráculo; procurei com grep).

### 2.10 Vigia de travas

Commits f3d2ba5b, 5bc1e0fd (08/11).

A cada 5 min, trava vista em 2 rodadas seguidas vira tarefa de risco alto do lugar `servico:vigia`, entregue
com carta própria (`vigia-service.ts:102-133`, `:162-199`): "Trava: VPS fora do ar. Já resolveu?", opções
**Já resolvi** / **Deixar assim**; a trava que passou vira "Já vi" / "Quero entender". Aparece como
"Decidir entrega" comum: **não há marca de urgência** na caixa, nem ordem própria além de "trava alguém"
(`inbox.ts:68-76`, `:141`). No registro real há **0** cartas do vigia.

### 2.11 "Precisa do dono" no andamento não chega ao dono

`tarefa_andamento` aceita o estado `precisa-do-dono` (`andamento.ts:20`), mas o aviso vai **ao Líder do
quadro**, não ao Oráculo do dono (`ledger-store.ts:432-449`; descrição da ferramenta, `tools.ts:344`). A caixa
"Esperando você" não lê andamento (`inbox.ts` não importa `andamento`). Ou seja: uma sessão que precisa do
dono e não tem uma entrega para fazer não tem como virar carta.

## 3. Decisão do dono, andamento, histórico ou registro

| Elemento | Classe |
|---|---|
| Caixa: Decidir entrega, Aprovar carta, Entrega parada | **decisão do dono** (com carta) |
| Caixa: Amostra do Revisor | conferência (auditoria do Revisor) |
| Caixa: Para repassar, Carta parada, Conferir envio | pendência operacional **sem resposta na tela** (o dono lê e manda o Líder ou confere o Slack) |
| Cartas (frente) | **decisão do dono** |
| Cartas (verso): conversa, quem fez, pedido, detalhes, ids | histórico e registro |
| Linha "Nada esperando você · abertas · em execução · entregues" | andamento |
| Tabela (12 colunas, 4 filtros, busca, linha do tempo) | registro e histórico; só o filtro "Esperando você" é decisão |
| Faixa do Mindscape | andamento e auditoria; só o botão "esperando você" leva à decisão |
| Painel do Jobu | andamento; a única resposta é a **ordem de prioridade** (▲▼) |
| PWA: baralho | decisão (fila menor que a do desktop) |
| PWA: Pedir | entrada de pedido ao Líder (não é decisão) |
| PWA: Seus pedidos | registro e andamento |
| Hill climbing: proposta | decisão (no Oráculo) |
| Hill climbing: fim de rodada | **decisão fora do Oráculo** |
| Vigia | aviso que pede um "já resolvi" |

Evidência de que o filtro "o que sobe ao dono" não é "precisa realmente de mim": a regra é **risco alto**
(`inbox.ts:112`; `contract.ts:1234-1236`), e uma tarefa pedida como baixo vira alto por regra estrutural
quando quem cria é o dono do trabalho ou foi aberto por ele (`ledger-store.ts:484-490`, aplicado em
`:669`, `:677`, `:683`). Das 25 vezes que o dono escreveu numa carta, pelo menos 11 foram para devolver a
decisão a quem pediu: "Faz vc esse ajuste" (t-3de1ce47), "Você mesmo vai organizar" (t-ece4a28c), "faça você
mesmo" (t-25f4b31e, 2×), "Faça com a conta do businessoperations" (t-8dfdd191), "Faz sem o OK do Fernando"
(t-c6964cbb), "Faz vocÊ uai" (t-e470c49f, 2×), "Dalton que se vire" (t-b9232976), "Faça você. PAra de delegar
pra mim" (t-54d85cbd), "uma ova, se vira" (t-6066c6aa). E duas apontam repetição: "Já respondido. Apareceu
repetido" (t-1905134e), "Já respondido. Card continua aqui" (t-babf5235).
**[corrigido pelo crítico]** A conta certa é **10 textos em 9 cartas**, não 11. Motivos: "Faz sem o OK do Fernando.
Só dale" (t-c6964cbb) é **uma decisão** do dono, e o Líder registrou "Decidida pelo dono por escrito na própria
carta". "Faz vocÊ uai" (t-e470c49f) foi gravado 2 vezes no mesmo minuto, 07/11 22:18 UTC (`ledger_resumo.py`). O 2º
texto de t-25f4b31e é "Já falei, só puxa os acessos com o suporte plataforma e para de depender de pessoas", e não
"faça você mesmo".

## 4. O molde da carta hoje (`paraODono`)

Tipos em `contract.ts:62-97`; esquema da ferramenta em `tools.ts:142-223`; regras em `forOwnerRefusal`,
`contract.ts:1140-1175`.

| Campo | Obrigatório | Limite | Fonte |
|---|---|---|---|
| `titulo` | não | 60 | `contract.ts:205`, `:1150` |
| `pergunta` | sim | 160, uma frase | `:207` |
| `resumo` | sim | 280 | `:207` |
| `opcoes` | sim | **2 a 4**; rótulo 40, efeito 200, risco 160; `fecha` = `aceita` ou `rejeitada`; **exatamente 1 recomendada**; nomes diferentes; "Outra" é reservado | `:62-72`, `:207`, `:210-211`, `:1142-1143`, `:1166-1169` |
| `porque` | sim | 200 | `:207` |
| `risco` | sim | 200 | `:207` |
| `visual` | sim se há arquivo entre as provas | **um** dos três: `prova` (1 arquivo), `antes-depois` (2 arquivos diferentes), `checagens` (1 a 10, nome 40, frase 200) | `:81-84`, `:212`, `:1155-1173` |
| provas | sim, 1 a 5 | arquivo (png, jpg, gif, webp, mp4, webm, mov até 50 MB; html autocontido até 2 MB), texto (até 20 mil), link | `:195-228` |

Todo texto que o dono lê é **recusado se tiver código**: crases, link, id de tarefa ou lugar, branch, PR,
hash, caminho (`contract.ts:1105-1137`).

**Jeitos de responder que existem:**
1. Uma opção nomeada, com dois cliques ou toques (`LedgerCards.tsx:363-376`; `app.js:826-836`); fecha a
   tarefa como aceita ou rejeitada.
2. Opção com texto junto (`LedgerCards.tsx:372-373`).
3. "Decidir assim": texto livre como opção "Outra"; fecha **aceita**, ou **rejeitada** se for carta de Slack
   (`contract.ts:1082-1091`).
4. "Só perguntar": texto livre que vai à sessão e mantém a carta (op `comentar`, `contract.ts:537`;
   `LedgerCards.tsx:82-93`).
5. Carta antiga: Aceitar / Rejeitar com motivo; no celular, também **arrastar** (`app.js:951-990`).
6. Amostra: Conferi/Confirmo / Rejeitar.
7. Fora da carta: ▲▼ de prioridade (Jobu) e os 3 gestos do hill climbing (barra do modo "hill").

## 5. O que uma carta NÃO consegue mostrar ou responder hoje

Cada item com a causa no código e, quando existe, um caso real.

**Mostrar**

1. **O texto que está sendo aprovado.** Na carta de Slack, a mensagem exata é uma prova de texto
   (`contract.ts:975`), e prova de texto só aparece no verso, recolhida (`LedgerCards.tsx:278-284`, `:303-322`;
   `app.js:625-630`). A frente diz "Posso mandar esta mensagem…" sem a mensagem. *Caso real:* "Não dá pra ver
   mensagem alguma nesse cartão." (t-dab38f1d, 06/11 16:46), "Não vejo nenhuma mensagem no cartao"
   (t-556daef7, 16:47), "Não consigo ler mensagem alguma nesse cartão...." (t-037fc748, 16:49). As duas
   últimas acabaram **rejeitadas** com "Não enviar"; a primeira só foi aceita depois que a sessão reentregou
   com um `.html` só para mostrar o texto (16:48). O código atual continua igual.
2. **Mais de um protótipo, ou dois lado a lado como opções.** O visual é um só (`contract.ts:81-84`); o
   único par é `antes-depois`, com os rótulos **fixos** "Antes" e "Depois" (`LedgerCards.tsx:259`, `:263`;
   `app.js:459`). Comparar A com B obriga a chamar uma variante de "antes". Print:
   `desktop-carta-antes-depois-como-comparacao.png`. O resto das provas fica no verso. *Caso real:* t-678f3cb3
   "Cadeiras: protótipo final" tinha 4 prints e 1 protótipo e a frente mostrava só a prova 1; o pedido
   combinava "A3 com o layout da A1" e "B1"; o dono respondeu "Não tá como eu havia esperado" e escolheu
   "Ajustar". No registro, 9 entregas com bloco têm mais de um arquivo, e nenhuma tem dois `.html`.
3. **Ligar uma opção ao seu visual.** A opção tem só rótulo, efeito e risco (`contract.ts:62-72`); não aponta
   para uma prova. Não dá para tocar na opção B e ver a tela B.
4. **Texto a aprovar editável.** Não existe campo de texto pré-preenchido; o dono só aceita como está ou
   descreve a mudança em texto livre (`WriteBox`, `LedgerCards.tsx:112-122`), e a carta de Slack rejeitada
   pede uma carta nova (`tools.ts:377`).
5. **Saída de comando, lista ou tabela na frente.** Prova de texto e link só no verso
   (`LedgerCards.tsx:276-292`). `checagens` é a única lista, e só mostra a frase do item que **falhou**
   (`:248`). *Uso real:* 64 das 179 cartas usaram `checagens`, muitas vezes como lista de fatos, não de
   testes (ex.: t-356b8b45, 7 itens "Conta Google", "Robô do Slack"…).
6. **Mais de uma pergunta na mesma carta.** Um bloco = uma `pergunta` (`contract.ts:87-97`). *Caso real:*
   t-356b8b45 (07/11): o dono respondeu 7 pontos de uma vez em texto corrido ("Conta google: … O robô slack
   será o próprio Dalton … Utilizará as contas da VPS …").
7. **Contexto acima de 280 caracteres na frente.** `resumo` 280, `porque` 200, `pergunta` 160
   (`contract.ts:207`). *Uso real:* 19 resumos chegaram a 95% do limite.
8. **Vídeo** é suportado no desktop (`LedgerCards.tsx:228`) e no celular (`app.js:406-421`), mas o registro
   real tem **0** provas de vídeo (só png, jpeg, html, texto e link).
9. **Link ou nome técnico quando ele é a decisão** (um PR, um canal, um caminho): todo texto do dono é
   recusado com código (`contract.ts:1105-1137`); o link só existe como prova no verso.
10. **Carta de tamanho variável.** A carta grande tem 470 px fixos no desktop (`LedgerCards.module.css:100`),
    inclusive para um protótipo; existe só a "Tela cheia" do protótipo (`LedgerCards.tsx:215-217`).

**Responder**

11. **Escolha múltipla** (marcar vários): a opção é uma só e fecha a tarefa (`LedgerCards.tsx:363-376`;
    `contract.ts:70`).
12. **Resposta que não fecha a tarefa**: toda opção fecha como `aceita` ou `rejeitada` (`contract.ts:70`). "Só
    perguntar" mantém a carta, mas é texto livre (`LedgerCards.tsx:82-93`). Não existe "adiar", "mais tarde",
    "não sou eu quem decide", "faça você" como resposta de primeira classe; a devolução de decisão (seção 3)
    hoje sai como texto livre.
13. **Resposta livre estruturada** (vários campos, um por pergunta): só existe uma área de texto de até 2000
    caracteres (`LedgerCards.tsx:114`; `contract.ts:209`).
14. **Número, data, valor**: não há tipo de campo; prazo, orçamento, quantidade viram texto.
15. **Ordem de prioridade dentro da carta**: ordenar só existe no painel do Jobu, e só para pedidos do dono
    (`JobuProgress.tsx:148-159`; `prioridade.ts:1-5`).
16. **Uma decisão sem recomendação, ou com uma opção só**: exige 2 a 4 opções e exatamente 1 recomendada
    (`contract.ts:1142-1143`, `:1167`). Uma pergunta aberta ("qual nome?", "quem chamo?") não tem molde.
17. **Responder várias cartas de uma vez** (aceitar em lote, "todas as amostras ok"): não há gesto; é uma por
    uma (`LedgerCards.tsx:604-610`). O lote existe só para as sessões (`tarefa_lote`, `tools.ts:274-277`).
18. **Arrastar na carta A**: o gesto só existe na carta antiga do celular (`app.js:925`); a carta A não tem
    gesto, e o desktop nunca teve.
19. **Gestos de missão** (mais uma rodada, redirecionar com referência) não são molde de carta: vivem só na
    barra do hill climbing (`HillClimbBar.tsx:476-500`).
20. **Responder pendências sem carta**: Para repassar, Carta parada e Conferir envio não têm botão de
    resposta; a dica manda ao Jobu (`OwnerInbox.tsx:35-47`).

## 6. Diferenças entre desktop e celular

| Ponto | Desktop | Celular |
|---|---|---|
| O que espera o dono | caixa com 7 tipos (`ownerInbox`) | só risco alto + amostra (`ownerQueue`, `ledger-port.ts:175`) |
| Ordem | trava alguém → prazo → idade (`inbox.ts:141`) | mais antiga primeiro (`contract.ts:1276`) |
| Avisos | — | push dos 7 tipos (`webpush.ts:187`), inclusive dos que **não aparecem** na fila do celular; "Entrega parada" abre `/#carta=<id>` (`webpush.ts:167`), mas essa carta não está no baralho e `abrirCartaDoAviso` não acha o alvo (`app.js:1093-1103`) |
| Prova grande | frente com o visual; carta de 470 px | "palco" ocupa a carta e a decisão vai para a gaveta (`app.js:503-571`) |
| Arrastar | não | só carta antiga |
| Tabela, faixa, painel do Jobu | sim | não |
| Pedir ao Líder + Seus pedidos | não (fala-se pelo Jobu) | sim |

## 7. Números do registro real (`~/.donel/oraculo/ledger.json`, 09/11 ~12:39)

- 462 tarefas: 260 aceitas, 83 abertas, 78 rejeitadas, 22 em execução, 19 entregues (4 de risco alto).
- **[corrigido pelo crítico: conciliação]** O 04 conta 170 (agora 171) porque o `tarefa_listar` traz só o bloco
  da **última** entrega de cada tarefa. Aqui a contagem é por entrega. Pela listagem de 09/11 16:12 UTC: visual 55
  checagens, 49 prova, 1 antes-depois e 66 sem visual; opções 112/56/3; o dono escolheu a recomendada em 123 de 137.
- 179 entregas com bloco "para o dono" (06/11 02:04 a 09/11 15:37 UTC). Visual: 64 `checagens`, 56 `prova`
  (47 delas um protótipo `.html`), 1 `antes-depois`, 58 sem visual.
- Número de opções: 2 opções em 109, 3 em 66, 4 em 4.
- Provas: 457 texto, 242 link, 61 png, 6 jpeg, 58 html, **0 vídeo**.
- Decisões do dono: 150 por opção nomeada, 40 sem opção (carta antiga ou amostra), **0 pela opção "Outra"**
  ("Decidir assim" entrou em c20bcf23, 07/11).
- 25 textos do dono escritos em cartas (lista na seção 3 e em 5.1, 5.2 e 5.6).
- 45 cartas de Slack (1 com arquivo); 25 registros de bot próprio; 1 proposta de hill climbing; 0 cartas do vigia.
- Fila do celular naquele momento: 7 cartas (4 de risco alto: 2 com `checagens`, 2 sem visual; 3 amostras).

## 8. Prints (`prints-hoje/`)

| Arquivo | O que mostra | Dados |
|---|---|---|
| `pwa-celular-carta-01.png` … `-07.png` | as 7 cartas da fila do celular, uma por tela | reais |
| `pwa-celular-carta-01-verso.png` | verso da carta A | reais |
| `pwa-celular-escrever.png` | "✎ Escrever" aberto | reais |
| `pwa-celular-pedir.png` | folha "Pedir ao Líder" + "Seus pedidos" (vazia: o servidor de demonstração não lê os pedidos) | parcial |
| `pwa-tela-larga-carta-01.png` | a PWA em 1280 px | reais |
| `desktop-oraculo-centro.png` | Oráculo no centro: caixa + tabela | demonstração |
| `desktop-tabela-detalhe.png` | painel lateral da tabela | demonstração |
| `desktop-carta-decidir-entrega.png` | carta A com `checagens` | demonstração |
| `desktop-carta-aprovar-carta.png` | carta de Slack: a frente **sem** a mensagem | demonstração |
| `desktop-carta-slack-verso.png`, `-verso-detalhes.png` | onde a mensagem fica (verso, recolhida) | demonstração |
| `desktop-carta-antes-depois-como-comparacao.png` | duas variantes rotuladas "Antes/Depois" | demonstração |
| `desktop-carta-entrega-parada.png` | carta antiga (Aceitar / Rejeitar…) | demonstração |
| `desktop-oraculo-estreito.png` | Oráculo em 700 px | demonstração |

## 9. O que não achei ou não verifiquei

- **Não abri o app Electron** (proibido). Os prints do desktop são o componente montado fora do Electron, com
  dados de demonstração e CSS do design system da pasta principal (`node_modules/@donel-dev/design-system`),
  que pode diferir um pouco do da worktree. A faixa do Mindscape, o painel do Jobu e a barra do hill climbing
  **não têm print**.
- Não verifiquei no aparelho como o push abre um item que não está no baralho; a conclusão da seção 6 vem
  só da leitura do código.
- Não achei em staging a spec `docs/specs/cartas-forma-a.md` citada no código (`LedgerCards.tsx:1`): ela só
  existe em `origin/proto/cartas`.
- Não contei quantas tarefas viraram risco alto pela regra estrutural (`lowAsked`), porque a marca fica no
  texto do evento de criação e não li esse formato.
- O registro lido é o do Oráculo desta VPS; não comparei com o do PC.
