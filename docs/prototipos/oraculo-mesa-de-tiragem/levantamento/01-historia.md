# 01 — O Oráculo quando era mesa de tiragem, e o que o descaracterizou

> Levantamento, sem mudança no app. Base: worktree `oraculo-mesa` em `56c7ca22` (origin/staging, 09/11/2026),
> mais `origin/proto/cartas` e as branches remotas citadas.
> **Horas**: commits na hora de Brasília (-03, como o git grava); mensagens dos transcripts estão em UTC no
> arquivo e aqui aparecem convertidas para Brasília. Uma mensagem repassada pelo Líder só prova que a frase
> foi dita **até** aquela hora.
> **Fontes de transcript**: só os da VPS (`~/.claude/projects/-home-alexandrelentz-seazone-Donel-Dev/` e
> `-home-alexandrelentz-seazone/`), lidos com grep, só mensagens de usuário; a sessão 4b6eef22 foi ignorada.
> Os transcripts do PC do dono não estão nesta máquina.

---

## Resumo

1. A mesa nasceu no **celular** em 05/11 08:07 (`483b1180`): um baralho vertical com **uma entrega por tela**.
   Cada carta tinha naipe, índice romano ("I · IV"), o pedido e a prova. **Arrastar para a direita aceitava e
   para a esquerda rejeitava.** Sem nada pendente, a tela dizia "O baralho está vazio".
2. O nome **Oráculo Harrow** veio do dono às 11:52 do mesmo dia (`2fa31b30`): "para casar com a dinâmica do PF2e".
3. A **forma A** foi escolhida pelo dono no mesmo dia (`origin/proto/cartas`, `321c6736`): **a frente decide e o
   verso explica**. No desktop ficavam a mão de cartas à esquerda e a carta grande ao centro, a "mesa"
   (`.A-mesa` no `final.html`). Foi implementada entre 14:38 e 15:13 (`c2cc18c1`…`3f21c5a6`).
4. O auge foi em 06/11 11:30 (`8260d565`): o centro da janela passou a ser o Oráculo, e **as cartas eram a própria
   tela**, sem botão de fechar.
5. A virada aconteceu em 07/11 16:18–17:07 (`62391847`, `f54ee4db` e o merge `93e844b5`, que entrou na staging
   pelos PRs #304 e #306 às 20:45 e 20:48). O centro virou uma **caixa de 7 tipos mais uma tabela de 11 colunas**
   (12 desde 09/11), com filtros, busca e painel de linha do tempo. **A carta só abre por clique numa linha.**
   **[corrigido pelo crítico]** O dono ratificou a direção em t-63186140 ("Tudo como recomendado", 07/11 19:17).
   O print que viu na frente, porém, era a tela do PR #304, com "Abrir as cartas" e sem a caixa de 7 tipos; a
   caixa aparecia só como número no verso. Ver a linha de 07/11 ~15:17 na seção 3.
6. Em cima disso vieram: o andamento das sessões gravado no Oráculo (08/11, `055fcc2f`), a coluna Sessão (09/11,
   `322d7c74`/`0747ecac`) e cartas que não são decisão. Exemplos: o pedágio do Slack (`c1516b38`), o alarme do
   vigia (`f3d2ba5b`), a proposta de hill climbing (`e2d0bab2`) e as órfãs.
7. A régua de "quando sobe ao dono" existiu por escrito desde 05/11 14:16 (`contrato.html` §4) e está até hoje
   **só no texto da ferramenta** `tarefa_criar` (`src/shared/ledger/tools.ts:114-115`). O código aplica apenas o
   critério de risco.

---

## 1. Como era a mesa

### 1.1 O baralho do celular (05/11 08:07, `483b1180`)

Mensagem do commit: "Feed vertical, uma entrega por tela, como carta de tarô com naipe pelo tipo; arrastar à
direita aceita, à esquerda rejeita com motivo; botões equivalentes. Decisão pelo celular grava com autor
'dono', uma vez só." O celular rodava sobre um adaptador de demonstração (`src/main/celular/ledger-port.ts`
em `483b1180`) e passou a ler o ledger real 12 minutos depois (`bfa0940a`, 08:19, filho direto de `483b1180`).
**[corrigido pelo crítico]** O texto anterior dizia que "o ledger real ainda não existia". Não é bem assim:
`40254f8a` (ledger V1, 08:06) é ancestral de `483b1180` (`git merge-base --is-ancestor`). O `483b1180` foi
rebaseado (autor 08:07, commit 08:14), e a frase "Ledger V1 ainda não existe" da mensagem é anterior ao rebase.

Prints que tirei renderizando o código do próprio commit com os dados de demonstração dele (os prints não
existiam no repo):

- `prints-antigos/pwa-483b1180-claro-carta1.png`: a carta em repouso.
- `prints-antigos/pwa-483b1180-escuro-arrastando.png`: a carta sendo arrastada para a direita, com o carimbo "ACEITA".

O que aparecia (código em `483b1180`):

| Peça | Como era | Fonte |
|---|---|---|
| Superfície | `<main id="baralho">`, rolagem vertical que **encaixa uma carta por tela** (`scroll-snap-type: y mandatory`, `scroll-snap-stop: always`) | `pwa/index.html`, `pwa/app.css:146-154` |
| Topo | glifo de estrela + "Ledger" + "N esperando você" + atualizar | `pwa/index.html` |
| Moldura | carta com moldura dupla e quatro cantos ornamentados | `pwa/app.js:268-314` |
| Naipe | glifo + nome no topo da carta. São 6 naipes: **Martelos** (construção, o padrão), **Escudos** (correção), **Chaves** (segurança/acesso), **Livros** (pesquisa/docs), **Estrelas** (revisão), **Coroas** (decisão) | `src/shared/celular.ts:65-93`, `pwa/app.js:11-23` |
| Índice | "I · IV" = carta 1 de 4 da tiragem | `pwa/app.js:290-292` |
| Faixa | "Esperando você", ou "Amostra do dia · aceita por Revisor" | `pwa/app.js:293` |
| Corpo | título; **O pedido** (a frase literal, em citação); **Pronto quando**; **Prova(s)** | `pwa/app.js:295-310` |
| Pé | "Entregue por Dev (atlas) · há 1 h" | `pwa/app.js:312` |
| Gesto | arrastar inclina a carta e acende um carimbo; passou de 28% da largura, a carta "voa" para o lado. Direita = **Aceita**; esquerda = **Rejeita** e abre a folha "Por que rejeitar?", que dá para ditar | `pwa/app.js:7-8, 346-409` (`ligarGesto` em `:366`); `pwa/index.html` (folha) |
| Botões | "Rejeitar" e "Aceitar" embaixo, equivalentes ao gesto | `pwa/app.js:324-340` |
| Vazio | o verso da carta desenhado + **"O baralho está vazio"** + "Nenhuma entrega esperando você agora." | `pwa/app.js:175-182` |

O naipe "pelo tipo" nunca teve tipo de onde sair. Com o ledger real, o naipe passou a vir **do papel de quem
entregou**: "O contrato ainda não tem tipo de trabalho: o naipe sai do papel de quem entregou (decidido pelo
Dev)" (`ledger-port.ts:51` em `bfa0940a`). Hoje é igual (`src/shared/ledger/labels.ts:45-53`). Por isso a
Coroa (decisão) só aparece quando quem entrega é o Líder.

### 1.2 O nome (05/11 11:52, `2fa31b30`)

O dono, literal, repassado às 11:49 (transcript d747ea8b): "O Ledger se chamará Oráculo Harrow, para casar com a
dinâmica do PF2e". O commit trocou só o texto visível (faixa, Jobu, Preferências, PWA); o módulo continuou
`ledger`. O glossário (`docs/glossario.md:65-71`) define o Oráculo Harrow como "o registro das tarefas entre
lugares, com prova". Ou seja: **no nascimento, Oráculo e ledger eram o mesmo sistema com dois nomes**. A
separação aparece só em 08/11 (ver 3, linha de 08/11 22:25). O repo não descreve o baralho Harrow; só diz que
"casa com a dinâmica de PF2e".

### 1.3 A forma A: frente decide, verso explica (05/11 14:16–14:32, `origin/proto/cartas`)

- `d71f11f9` (14:16): 4 formas sobre as mesmas 3 cartas reais. Prints em
  `prints-antigos/A-carta-harrow.png`, `B-conversa-jobu.png`, `C-visual-grande.png` e `D-escolha-caminho.png`.
- A pergunta do protótipo (`docs/prototipos/carta-oraculo/decisao.md:12-15`): "Que forma de carta faz o dono
  entender, **em 5 segundos e sem abrir link**, o que decide, a recomendação, o efeito de cada opção, um visual e
  o risco (celular e desktop)?"
- A forma A (`decisao.md:28`): "baralho de verdade; a frente decide, o verso explica". Em `final.html:452`:
  "**Carta de baralho de verdade.** A frente decide: pergunta, ilustração (o visual), a recomendação na faixa
  dourada, as opções com o efeito embaixo e o selo de risco. Toque em 'Virar' e o verso explica: por quê, cada
  caminho com o seu risco, quem fez, o seu pedido e os detalhes técnicos recolhidos. No desktop, a mão de cartas
  fica à esquerda."
- A "mesa" é literal no protótipo: `final.html:206` (`.A-mesa`, superfície com perspectiva para virar a carta),
  `:242` ("desktop: mão de cartas à esquerda, carta grande ao centro") e `:555-560` (`mesa` = a carta;
  `A-palco` = mão + mesa).
- Escolha do dono (`decisao.md:39-41`): "A ideia é ser a forma A. Mas não existe suporte para eu ver os
  protótipos nas próprias cartas nem como escrever lá. É esse tipo de coisa que falta."
- `321c6736` (14:32) gravou a spec `docs/specs/cartas-forma-a.md`. A frente (`:24-27`) tem naipe e "I · III",
  título humano, a pergunta, o visual (print, vídeo, **protótipo HTML embutido** ou quadro de checagens), a faixa
  "Recomendo X: porquê", as opções com o efeito embaixo, "✎ Escrever para <quem fez>", o selo de risco e
  "↻ Virar". O verso (`:28-31`) tem o que aconteceu, o porquê, cada caminho com o risco, quem fez e, recolhidos,
  o pedido e os detalhes técnicos. Regra: "Nada de código fora de 'Detalhes técnicos'".
- Fora do escopo da spec (`:264-266`): "O gesto de arrastar a carta (fica como está na PWA)".

### 1.4 A mesa construída (05/11 14:38–15:13)

| Hora | Hash | O que entrou |
|---|---|---|
| 14:38 | `c2cc18c1` | bloco `paraODono` no `tarefa_entregar`, filtro de código, régua na descrição da ferramenta (fatia 1) |
| 14:45 | `f102eb20` | carta A no celular. "**dois toques numa opção decidem**"; entrega sem o bloco segue na carta antiga |
| 14:50 | `9fd149f4` | desktop: "esperando você" deixa de abrir a lista sob a faixa e "abre a mesa sobre o quadro, com a mão de cartas à esquerda e a carta grande ao centro" |
| 14:56 | `8bdee5ed` | protótipo HTML rodando dentro da carta |
| 15:05 | `e52d1ddd` | escrever na carta |
| 15:07 | `72737c35` | aviso no celular (Web Push) quando uma carta espera o dono |
| 15:13 | `3f21c5a6` | "a mesa das cartas abre sobre a área do quadro, não sobre a janela inteira" (decisão do Líder único) |

As decisões do Líder sobre a mesa, repassadas às 15:11 (transcript 4701e228) e anotadas em `BACKLOG.md:150-155`:
"1. dois toques: mantém; 2. arrastar não escolhe o recomendado, porque decidir pede gesto explícito; […] 4. a
mesa cobre só o quadro, como no protótipo".

Efeito no gesto: hoje o arrasto só existe na carta antiga (sem `paraODono`). `ligarGesto` é chamado apenas em
`src/main/celular/pwa/app.js:925`, e a carta A (`app.js:486-600`) decide por dois toques. **O arrasto saiu da
carta principal em 05/11 14:45.** **[corrigido pelo crítico]** O texto anterior dizia que esse gesto "dava o nome de
'tiragem' à experiência". Não há fonte para isso: "tiragem" aparece pela primeira vez nos transcripts da VPS em
09/11 15:43 UTC (sessão 837dacd3), e nunca no git (`git log --all -i --grep=tiragem` e `git grep` nas branches
remotas sem resultado). A ligação entre o gesto e a "tiragem" é interpretação, não dado.

No dia seguinte, `cfd05266` (06/11 10:01) fez a prova virar o palco da carta no celular: "a prova ocupa a
largura e ~63% da altura; embaixo, a opção recomendada a um toque".

### 1.5 O auge: as cartas como tela (06/11 11:30, `8260d565`)

Dono: "Estou com telas redundantes" (citado em `src/renderer/src/OracleCenter.tsx:1`). O centro do "Uso geral"
passou a mostrar o Oráculo no lugar da conversa do Líder. Em `8260d565`, `OracleCenter.tsx` renderiza
`<LedgerCards queue={queue} />` sem `onClose`, e o próprio componente explica: "Absent = the cards ARE the
screen (the Oráculo in the center of the main window): no 'Fechar', no Esc" (`LedgerCards.tsx:529` em
`8260d565`; hoje na linha 570). Vazio: "Nada esperando você", os três números e "Fale com o Líder pelo Jobu".
Novidade da versão `notes/2026-11-06-0003-…`: "o centro mostra o Oráculo Harrow com as cartas que esperam você,
de todos os quadros".

Não há print do app real nessa fase (nem em nenhuma outra). A imagem mais próxima é a coluna desktop de
`prints-antigos/A-carta-harrow.png`.

---

## 2. O que "mesa de tiragem" significava

**A expressão "mesa de tiragem" não aparece antes de 09/11.** Procurei em `git log --all -i --grep`, em
`git grep` de docs/specs/BACKLOG/CLAUDE.md e nas mensagens de usuário dos transcripts da VPS. "Tarô" e "naipe"
também não aparecem em nenhuma frase do dono achada aqui: o primeiro registro é a mensagem do commit
`483b1180`. O vocabulário de mesa que existia antes, com fonte:

| Palavra | Onde |
|---|---|
| baralho | `<main id="baralho">`, "O baralho está vazio" (`483b1180`); "Carta de baralho de verdade" (`final.html:452`); "baralho de verdade" (`decisao.md:28`) |
| carta de tarô, naipe | `483b1180` (commit); 6 naipes em `src/shared/celular.ts:65-93` |
| mesa | `.A-mesa` (`final.html:206, 555`); Líder: "a mesa cobre só o quadro" (4701e228, 05/11 15:11); `3f21c5a6`: "a mesa das cartas abre sobre a área do quadro" |
| mão de cartas | spec forma A `:37`; `9fd149f4`; novidade `2026-11-05-0025` |
| pilha | relay do bug do dono (281c3bd6, 07/11 16:16): "a carta continua na pilha de 'Decisão sua'"; `c20bcf23`: "tira a carta da pilha" |
| frente / verso | "a frente decide, o verso explica" (`decisao.md:28`, spec `:24-31`) |

O que a mesa era, juntando as fontes (cada traço com a sua):

1. **Uma carta por vez, à frente**: "uma entrega por tela" (`483b1180`), com rolagem que trava em cada carta
   (`app.css:146-154`). No desktop, uma carta grande ao centro e o resto na mão (`9fd149f4`).
2. **A tiragem tem tamanho**: "I · IV" diz quantas cartas há na mesa (`app.js:290`); o objetivo é esvaziá-la
   ("O baralho está vazio", `app.js:180`).
3. **Cada carta é uma decisão do dono**: "decidir o que você não conseguir decidir sozinho" (dono, spec `:11-13`);
   "Que forma de carta faz o dono entender em 5 segundos e sem abrir link…" (`decisao.md:12-15`).
4. **A frente decide, o verso explica**: pergunta, visual, recomendação e opções na frente; o porquê, os riscos,
   o pedido e o técnico no verso, recolhidos (spec `:24-31`).
5. **Decidir é um gesto e a carta sai**: arrastar para um lado ou para o outro (`483b1180`), depois dois toques
   (`f102eb20`). Decidida, "A decided card leaves the queue: the next one comes up; nothing left closes the table" (comentário em `LedgerCards.tsx:588`). O dono cobrou isso
   em 07/11: "Eu escrevo minha própria opção e não some o cartão" (281c3bd6).
6. **O naipe diz o tipo de carta** (`483b1180`), na prática o papel de quem entregou (`bfa0940a`).
7. **Linguagem de gente, sem código**: "Esse negócio de código das tarefas não me explica nada. Sou um humano,
   coopera comigo, por favor." e "Link de github não me explica nada." (dono, spec `:11-17`).

As palavras do dono sobre o que a carta devia ser (05/11, spec `cartas-forma-a.md:11-17`):
"Acho que pouca coisa está chegando lá pra mim, heinn. Mas elas não estão otimizadas para eu entender. Gostaria
de ver protótipos por lá, entender problemas, decidir oque você não conseguir decidir sozinho. Link de github não
me explica nada. E o pedido sempre fica ignorado no topo da página."

---

## 3. Linha do tempo: o que afastou o Oráculo da mesa

Legenda da última coluna: **afasta** = tira o Oráculo de "uma decisão por vez"; **aproxima** = reforça a mesa;
**neutro** = só registro ou ferramenta de agente, sem efeito direto na tela.

| Data e hora | Hash / fonte | Mudança | Efeito na tela | |
|---|---|---|---|---|
| 05/11 08:06 | `40254f8a` | Ledger V1 (item 19 do `docs/planos/mindscape-openrig.pda.md:353-389`): "faixa de números, sem painel à parte" | Faixa sob as abas do Mindscape com **abertas · em execução · entregues sem aceite · esperando você · % validadas sem você**. No desktop, "esperando você" abria uma **lista** sob a faixa. **Os contadores nasceram antes da mesa** e existem até hoje (`LedgerStrip.tsx:72-85`) | afasta (de origem) |
| 05/11 08:07 | `483b1180` | baralho no celular | a mesa | aproxima |
| 05/11 11:09 | `b39b7d3f` | painel "Progresso" no balão do Jobu, calculado do ledger | andamento por frente, **fora** do Oráculo, mas do mesmo registro | neutro |
| 05/11 14:38–15:13 | `c2cc18c1`…`3f21c5a6` | forma A, protótipo na carta, escrever, push | a mesa completa, mas sem o arrasto na carta A | aproxima |
| 05/11 15:00 | `c1516b38` | "mensagem ao Slack só sai com carta aceita pelo dono" | cada mensagem ao Slack vira uma carta para aprovar texto: **carta como pedágio**, não como decisão. Dono, repassado em 06/11 19:34 (e63b8303): "o Theo West está MUITO dependente das cartas. Ele não pode. O envio de cartas era para eu validar as mensagens, agora ele me tornou gargalo" | afasta |
| 05/11 23:13 e 06/11 06:30 | `e2d0bab2`, `61b64286` | hill climbing: a proposta nasce como "carta de risco alto no Oráculo", e o fim de rodada vira "carta de decisão" | entra outro tipo de carta, de outra máquina de estados | neutro |
| 06/11 10:22 | `ab501f77` | botão "Pedir" no topo do Oráculo (celular e desktop) e "Seus pedidos" (na fila / entregue / virou tarefa) | a mesa ganha uma entrada de pedidos e uma lista de acompanhamento | afasta |
| 06/11 11:30 | `8260d565` | Oráculo no centro, as cartas como tela | auge da mesa (1.5) | aproxima |
| 06/11 13:27 | `b3cc8378` | carta de Slack num toque; schemaVersion 5 | segundo formato de carta (para quem, texto exato, Enviar / Não enviar) | neutro |
| 06/11 13:37 | `5dbfc729` | espelho das tarefas no Supabase pessoal | **a primeira tabela**, fora do app, de onde vem a linhagem da tabela | afasta (origem) |
| 06/11 19:12–21:19 | `041e3011`, `c8c01e98`, `7800ab08`, `cfd1436b`, `e64b5480`, `319cd399` | transferir, cancelar, **órfãs**, "só as vivas", passagem automática, faxina noturna; protótipo `docs/prototipos/carta-sem-dono.html` ("N tarefas sem dono", esperando o dono) | vocabulário de gestão de fila (vivas/órfãs/fechadas) nos números do `tarefa_listar`; a órfã é proposta como carta | afasta (vocabulário) |
| 07/11 09:38 | `591df447` | número "esperando envio" na faixa do `tarefa_listar` | mais um contador | neutro |
| 07/11 ~09:56 | 8e7f4964 (relay) | dono: "ABri o ledger (A tabela supabase) e não curti muito não. Tem o 'Quem pediu' como Dev, que não é NADA esclarecedor" | — | gatilho |
| 07/11 10:25 | `3f77e6ba` | tabela legível do espelho (quem pediu, lugares pelo nome) | tabela no Supabase | neutro |
| 07/11 ~10:22–10:37 | 7721f27a (relay), `a3e09f91` | dono: "Primeiro de tudo, o ledger está uma bosta. Quero ele em padrão top de linha, manda as pesquisas todas." → PDA Ledger v5 (`docs/planos/ledger-v5.md`) com 3 telas: A caixa primeiro, B tabela, C pedidos seus. Recomendação "**B com a caixa da A no topo**" (`:361`, D5 `:456-460`) | proposta. Nenhuma das 3 variantes é baralho; o pedido do dono era sobre o **registro** ("o ledger") e "quem pediu", e a resposta trocou a **tela** do Oráculo | afasta (decisão) |
| 07/11 ~15:17 | 482b1d27 (relay) | dono: "liga o ledger caralho. Apertei pra parar e repensar por conta que já havia respondido pro líder e queria limpar a minha tela." O Líder conclui: "Seguimos com as recomendações da carta: […] a tela B com a caixa no topo e a tabela da nuvem ligada" | **[corrigido pelo crítico]** Na mesma frase o dono diz que "já havia respondido pro líder", e essa resposta, dada no chat do PC, não está na VPS. Depois veio uma **ratificação na carta**: em t-63186140 o dono aceitou **"Tudo como recomendado"** em 07/11 às 19:17 (22:17 UTC; `tarefa_ver t-63186140` e `ledger_resumo.py`), antes do merge dos PRs. Porém o visual da frente era **um print da tela do `f54ee4db`** (PR #304): "◆ 3 esperando você · Abrir as cartas" e a tabela (`git show f54ee4db:src/renderer/src/OracleCenter.tsx`, linhas 70-77). A "tela B com a caixa no topo" estava só na prova de texto do verso. A caixa de 7 tipos aparecia apenas como número nesse texto ("34 itens… contra 3 da fila antiga") e no risco da opção ("A caixa começa cheia: 22 envios do Slack sem confirmação"). Ou seja: **o dono aprovou o print de uma tela que não foi a que entrou**, porque o botão "Abrir as cartas" desse print saiu no `93e844b5` | afasta |
| 07/11 16:18 → 17:07 (staging 20:45 e 20:48, PRs #304 e #306) | `62391847`, `f54ee4db`, merge `93e844b5` | caixa "Esperando você" e tabela legível no centro | **A virada.** No topo, a caixa com 7 tipos (`inbox.ts:65`): decidir entrega, aprovar carta, entrega parada, para repassar, carta parada, conferir envio, amostra do Revisor; só 4 deles abrem carta (`CARD_KINDS`, `inbox.ts:86`). Embaixo, a tabela de todas as tarefas: Código, Título, Estado, Com quem está, Quem pediu, Quem faz agora, Quem criou, Risco, Prazo, Última entrega, Decisão (`LedgerTable.tsx:222-233`); filtros Esperando você / Sem executor / Cartas / Tudo (`table.ts:32-37`); busca; painel com papéis, provas e **Linha do tempo** (`LedgerTable.tsx:153-165`). As cartas abrem **só por clique** ("Abrir a carta para decidir", `LedgerTable.tsx:105-106`). O botão "Abrir as cartas" de `f54ee4db` (`OracleCenter.tsx:77` naquele commit) **sumiu no merge** `93e844b5`. Novidades: "O Oráculo virou uma tabela de quem é cada coisa" e "O Oráculo mostra tudo o que espera por você" | **afasta** |
| 07/11 17:17 e 20:13 | `ffef8b26`, `8579ea8b` | frentes; Progresso do Jobu por frente, só com os pedidos do dono. Dono (4ff9327e, 16:17): "Não consigo saber quais demandas que eu solicitei você está tocando ou não. […] Essas coisas deveriam ser compiladas por frentes. O Ledger deveria levar isso em consideração" | andamento continua no Jobu, não no Oráculo | neutro |
| 07/11 18:13 | `c20bcf23` | "escrever a própria opção decide e tira a carta da pilha" | corrige a mesa | aproxima |
| 07/11 19:18 e 08/11 11:04 | `b75b6034`, `de84947a` | fechamento legível e cores próprias de estado **na tabela** | polimento da tabela | afasta |
| 08/11 10:37 | `003195f8` | aviso no celular "para cada item novo da caixa", e não só das cartas | o celular avisa de coisas que não são decisão | afasta |
| 08/11 11:12 | `055fcc2f` | "andamento das sessões no Oráculo em vez de aviso ao Líder": o fim de turno grava `⟦andamento⟧` como evento `comentada` na tarefa; `tarefa_andamento` e `tarefa_novidades` | o **andamento entra no Oráculo**: a linha do tempo mostra "Andamento de X" (`table.ts`, diff de `055fcc2f`), e a carta precisa filtrar esses eventos para não parecerem fala do dono (`LedgerCards.tsx`, diff de `055fcc2f`). **[corrigido pelo crítico: faltava o efeito medido]** No registro há 188 eventos `⟦andamento⟧` em 47 tarefas (`ledger_resumo.py`, 09/11). Exemplo: t-d35cbf67, a única carta A aberta da caixa, recebeu depois da entrega (09/11 03:56 UTC) 5 andamentos "turno-encerrado", entre 04:02 e 07:07 UTC, e os 5 tratam de outra coisa (`mencoes-escuta` fora do ar, `swapMaximoPct`) | **afasta** |
| 08/11 11:28 | `c640d1b2` | faixa da factory no quadro da homologação: "de risco alto esperando você" abre as cartas só com elas | mais uma porta para a mesa, com outro número | neutro |
| 08/11 12:03 | `0a023f2a` | tarefa que o Líder reparte pode ser de risco baixo; transferir refaz o risco. Novidade: "Menos cartas que não precisavam de você" | menos cartas | aproxima |
| 08/11 20:43 | `f3d2ba5b` | vigia: trava na VPS "abre UMA carta de risco alto de um lugar de serviço", com push de urgência máxima | **carta como alarme** (VPS fora, cofre trancado, sessão em laço) | afasta |
| 08/11 22:25 | `338340aa` (branch `origin/docs/pda-ledger-fila`, `docs/planos/ledger-bom.md:43-46`) | "**Sem acoplar ao Oráculo.** Hoje o 'Oráculo' é ao mesmo tempo o registro, o serviço e as telas. O ledger novo é um módulo próprio (`src/shared/livro/`) […] Oráculo, Jobu, celular, espelho e Mindscape passam a ser leitores" | primeira separação escrita entre ledger e Oráculo | — |
| 09/11 06:56–07:23 | `52f88854`, `322d7c74`, `0747ecac` | coluna **Sessão** na tabela e no painel. Dono, repassado às 07:07 (be1cf028): "uma coluna indicando um identificador da tarefa" | mais uma coluna (12) | afasta |
| 09/11 07:06–08:08 | `2f759029`, `2e81b70c`, `ba42cbef` | o dono prioriza em "Seus pedidos" (Jobu) e o Líder do quadro lê a próxima por essa ordem | fila de trabalho no registro, fora da tela do Oráculo | neutro |
| 09/11 09:26 | `3eee7e2b` | `tarefa_lote`: dar destino às órfãs num gesto do Líder | faxina de fila | neutro |
| 09/11 12:09 | `6efde239` | "carta deixa de travar envio ao Slack". Dono, repassado às 11:58 (35a0ccfe): "Não quero que cartas travem nada também. Essas cartas estão terríveis e mal implementadas. Só está atrapalhando" | a carta de Slack vira opcional | aproxima |

Onde cada tela está hoje (`56c7ca22`):

- **Desktop, centro** (`OracleCenter.tsx:79-107`): caixa (ou "Nada esperando você · N abertas · N em execução
  · N entregues sem aceite") + tabela + cartas por cima só quando se clica numa linha. A carta abre sobre a tabela.
- **Mindscape**: a faixa de números (`LedgerStrip.tsx:65-85`), que abre a caixa.
- **Celular**: continua um baralho, uma carta por tela, com o botão "Pedir" e o sino no topo
  (`src/main/celular/pwa/index.html:26-41`). A fila dele é `ownerQueue` (`src/main/celular/ledger-port.ts:175`),
  e não a caixa: **celular e desktop hoje mostram conjuntos diferentes** do que espera o dono. O aviso do
  celular, ao contrário, já vem da caixa (`src/main/celular/webpush.ts:187`).

---

## 4. A régua de "quando sobe ao dono" que já existiu

| Quando | Fonte | Regra |
|---|---|---|
| 04/11 (decisão do dono) | `docs/planos/mindscape-openrig.pda.md:366-373` (D1, D2) | "um lugar com papel Revisor […] aceita entregas de **baixo risco** desde a V1. Na primeira semana, o dono recebe uma **amostra diária** dos aceites; o resto aparece como 'esperando você'". |
| 05/11 08:06 | `40254f8a`; `src/shared/ledger/contract.ts:214-215, 592` | só pelo risco: risco alto "só o dono decide (fica em 'esperando você')"; amostra de até 3 aceites do Revisor por dia na 1ª semana (`SAMPLE_PER_DAY = 3`, `SAMPLE_WEEK_MS`). |
| 05/11 09:27 | `2021ac50` | "Risco baixo só vale quando quem cria não é o dono do trabalho nem foi aberto por ele; senão a tarefa nasce em risco alto e espera o dono." |
| 05/11 14:16 | `origin/proto/cartas:docs/prototipos/carta-oraculo/contrato.html` §4 (linhas 95-117) | **Sobe** (vira carta "Decisão sua"): difícil de desfazer (`main`, repo público, apagar, credencial, conta, dinheiro); toca outra pessoa ou algo de fora ("o Bill, a Marta, Slack, um cliente, a Seazone"); gasta o que é seu (limite de conta, VPS, a sua hora); muda a forma do que você vê **e há 2 jeitos bons** ("sobe com protótipo, nunca com descrição"); contradiz o que você disse ou fica fora do pedido; risco alto pelo contrato. **Não sobe**: só uma opção defensável; escolha técnica reversível dentro do pedido; resposta já existe em CLAUDE.md, ADR, memória ou decisão anterior; bug com teste; risco baixo aceito pelo Revisor. **Teste**: "se o agente não consegue escrever a pergunta numa frase, com 2 opções reais e uma recomendação, a decisão ainda não está pronta para você: ele volta e pensa mais." |
| 05/11 14:32 | `decisao.md:49-51` (decisões "que o Líder fechou com as recomendações desta etapa, até o dono dizer o contrário") | "protótipo sobe ao dono **só quando há 2 jeitos bons**"; decisão com **opções com nome**; quadro de checagens quando não há tela. |
| 05/11 14:38 | `c2cc18c1`; hoje em `src/shared/ledger/tools.ts:114-115` | a régua do contrato vira texto da descrição de `tarefa_criar`, **sem os exemplos de pessoas** e sem o item "risco alto pelo contrato". Guarda em código (spec C2; `contract.ts:21`): entrega de risco alto **recusada sem `paraODono`** completo (pergunta, 2 a 4 opções com efeito, exatamente 1 recomendada, porquê, risco, visual quando há print). |
| 07/11 10:37 (proposta) | `docs/planos/ledger-v5.md` §1.8 e V7/D3 | "esperando você" passa a ser **10 tipos** (decidir entrega, responder, aprovar plano, aprovar carta, conferir envio, carta parada, travou, atrasado, amostra, integridade); o Revisor só aceita sozinho com prova verificada e checklist completo. **Implementado em parte**: 7 tipos em `src/shared/ledger/inbox.ts:65`. |
| 08/11 12:03 | `0a023f2a` | tarefa que o Líder reparte para um lugar abaixo dele pode ser de risco baixo; transferir para fora da cadeia de quem criou recalcula o risco. |

O que essa história mostra sobre a régua:

- A régua de 05/11 é **texto para o agente**, não regra do app. O código só vê `risk` e a forma do bloco; nada
  confere "2 opções reais", "toca outra pessoa" nem "há 2 jeitos bons".
- Os sinais do dono depois dela vão todos no mesmo sentido, o de **subir menos**: "me tornou gargalo" (06/11,
  e63b8303, sobre o Slack); "pra que esse atraso? Fica brincando de me tornar o gargalo?" (repassado em 09/11
  06:42, be1cf028, numa tarefa em que o Líder notou "Sem carta: o dono já escolheu"); "Essas cartas estão
  terríveis e mal implementadas" (09/11, 35a0ccfe).
- A caixa de 07/11 fez o contrário do "subir menos": juntou ao que sobe ao dono coisas que não são decisão dele,
  como conferir envio, carta parada, tarefa para repassar e entrega parada de risco baixo
  (`inbox.ts:65-76`; novidade `2026-11-07-0020`).

---

## 5. O que não achei

- Nenhuma frase do dono com "mesa de tiragem", "tarô", "naipe" ou "baralho" antes de 09/11 nos transcripts da
  VPS. O tarô e o naipe aparecem primeiro na mensagem do commit `483b1180`. Quem pediu a metáfora de tarô,
  não achei. Os transcripts do PC não estão nesta máquina.
- Print do app real do Oráculo no desktop, em qualquer fase (mesa no centro de 06/11 ou tabela de 07/11).
  Só há os protótipos (`prints-antigos/A–D`, `docs/planos/ledger-v5/variante-*.png`). Os dois prints do celular
  de `483b1180` fui eu que renderizei a partir do código do commit, com os dados de demonstração dele.
- Escolha explícita do dono entre as variantes A/B/C do Ledger v5. **[corrigido pelo crítico]** Não é a única
  fonte: há o aceite "Tudo como recomendado" em t-63186140 (07/11 19:17), cuja frente mostrava o print da tabela do
  PR #304, e o "já havia respondido pro líder", dito no chat do PC, que não está nesta máquina. Não há escolha
  nomeada entre A, B e C, nem uma imagem da caixa de 7 tipos que o dono tenha visto antes de ela entrar.
- Descrição do baralho Harrow do PF2e: o repo não tem; o glossário só diz que o nome "casa com a dinâmica de PF2e".
- O tipo de trabalho que daria o naipe: nunca existiu no contrato (`bfa0940a`, `ledger-port.ts:51`).
