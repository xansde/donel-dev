# 03 · Dados: quanto do que chega ao dono no Oráculo precisa dele

> Levantamento com dados reais, 09/11/2026. Nada mudou no app. Feito para a tarefa "Oráculo volta a ser mesa de tiragem: objetivo e visual" (t-f235dd32).
> Escopo: o que **chega ou chegou** à caixa "Esperando você" (e às cartas) pelo critério que está hoje no código, aplicado a todo o histórico do Oráculo.

## Resumo em 10 linhas

1. Pelo critério do código, **296 das 466 tarefas** (64%) chegaram ou chegariam à mesa do dono, em 215 entregas que viraram carta.
2. Só **44 (14,9%) são decisões que só o dono toma e que destravam algo (A)**. Dessas, 9 são cartas de Slack que falam por ele.
3. **131 (44,3%) são decisões que o Revisor ou o Líder poderiam tomar (B).** O próprio dono disse isso nas cartas: "Faça você. PAra de delegar pra mim safado" (t-54d85cbd), "Faz vocÊ uai" (t-e470c49f), "Dalton que se vire pra fazer" (t-b9232976), "uma ova, se vira e nunca mais me ofenda fazendo um pedido desse" (t-6066c6aa).
4. **88 (29,7%) são órfãs, duplicadas ou canceladas (D)**: 73 órfãs que hoje estão na caixa. De 37 órfãs do BizOps, 31 já têm carta própria posterior para a mesma pessoa (ex.: t-801d8bf7 → t-315032f8).
5. **30 (10,1%) são informação, histórico ou estado de envio (C)**, e **3 (1%) pedem acesso ou ação física do dono (E)**.
6. **A caixa de hoje tem 115 itens e só 1 é A** (t-d35cbf67). Os outros: 75 órfãs, 17 "conferir envio" de cartas de Slack que nunca saem da caixa, 8 cartas aceitas e nunca enviadas, 5 falhas de bot, 4 entregas de risco baixo paradas e 5 aceites que o Revisor poderia dar. **[corrigido pelo crítico]** A soma (75+17+8+5+4+5+1 = 115) não fecha com o `esperandoDono: 9` citado no §2b, que soma decidir-entrega e amostra. Por esse número seriam 75+17+8+5+4+9 = 118, e as 3 amostras do dia não aparecem em nenhuma parcela. Refiz a conta com `tarefa_listar` às 16:12 UTC: 75 órfãs, 17 sem confirmação, 8 cartas paradas, 4 entregas paradas, 12 decidir-entrega e 3 amostras, total 119 mais as falhas de bot, que não contei. As parcelas grandes (75, 17, 8, 4) se confirmam. A divisão das restantes entre A e B não foi reconciliada.
7. O dono escolheu a opção **recomendada em 123 de 137 cartas** (90%) que tinham recomendação e opção gravada. Das 190 decisões dele, só 45 (24%) foram sobre itens A.
8. As A esperaram pouco depois de entregues (mediana 0,75 h). O atraso real está **antes**: o pedido de acesso que mais trava hoje (chave do AI Hub, t-80da20a7) nem vira carta. Fica no andamento "precisa-do-dono", que vai ao Líder.
9. O dono rejeitou 12 tarefas (13 rejeições). Duas foram só com o rótulo "Ajustar"/"Ajustar antes", **sem dizer o quê**; só três trazem texto dele, e o resto são rótulos de opção. Em 25 comentários ele mostra o que faltou na carta: não via o texto da mensagem, não podia combinar opções, não podia apontar onde mudar e recebia o que não era dele.
10. Quatro mensagens que o dono aprovou para Slack em 06/11 (Marta, Julia, Horst, Márcio) **nunca saíram** (`cartaSlack.enviada=false` em 09/11), e a mesa não diz isso de forma clara.

## 1. De onde vieram os dados

| Fonte | O que deu | Observação |
|---|---|---|
| `mcp__donel__tarefa_listar {"todos":true,"situacao":"todas"}` (09/11 ~16h) | 466 tarefas, com estado, risco, `entrega.paraODono` da última entrega, `decisao`, `orfa`, `cartaSlack`, `esperandoDono` | Saída com 964 mil caracteres, lida inteira por script (json) |
| `~/bin/rotinas/ledger_resumo.py --dias 3650` | Quadro (`projectPath`) e **todos os eventos** de 470 tarefas, com textos mascarados e cortados em 600 caracteres | É o caminho autorizado: o `ledger.json` fica atrás de um hook ("Trava de segredos"), que barrou meu `ls ~/.donel/oraculo/`. As 466 da listagem estão todas nele, e as 4 a mais são mais novas. |
| `mcp__donel__tarefa_ver` | Provas completas de 21 tarefas (as cartas do `03-cartas-reais.json` e amostras) | Não abri as 164 que têm `paraODono` uma a uma: a listagem já traz o `paraODono` inteiro da última entrega. Os textos do dono vêm dos eventos. |

Scripts e dados intermediários estão em `~/seazone/_scratch/oraculo-ruido/` (`merge.py`, `flags.py`, `classify.py`, `table.py`, `classified.json`), fora do repositório.

## 2. O critério que hoje põe algo na frente do dono

São três critérios diferentes, um para cada lugar:

**a) Desktop, caixa "Esperando você" do Oráculo no centro.** `src/renderer/src/OracleCenter.tsx:70-72` chama `ownerInbox()`. A regra está em `src/shared/ledger/inbox.ts:106-128` e tem 7 tipos:

| Tipo | Regra (inbox.ts) | Bloqueia? (`BLOCKS`, :68-76) | Vira carta? (`CARD_KINDS`, :86) |
|---|---|---|---|
| `decidir-entrega` | entregue + risco alto + não é carta de Slack (:112) | sim | sim |
| `aprovar-carta` | entregue + carta de Slack (:111) | sim | sim |
| `entrega-parada` | entregue + risco baixo + 24 h sem decisão (:113, `STALE_DELIVERY_MS` :79) | sim | sim |
| `para-repassar` | não fechada e lugar dono fechou/saiu/não começou (:126-127, `ownerGoneIn` :42-55) | sim | não (linha na caixa) |
| `carta-parada` | carta de Slack aceita, sem envio há 30 min (:118) | sim | não |
| `conferir-envio` | envio sem resposta do Slack, falha, ou falha do bot do agente (:119-124) | não | não |
| `amostra-revisor` | aceita pelo Revisor, entre as 3 primeiras do dia na 1ª semana (`inDailySample`, `contract.ts:1219-1231`, `SAMPLE_PER_DAY=3` :215) | não | sim |

O tipo `conferir-envio` para envio **sem confirmação** não tem saída. `slackSendState` devolve `sem-confirmacao` para sempre (`contract.ts:876-889`), e não há evento que o tire da caixa. Por isso 17 cartas de Slack já usadas estão na caixa hoje.

**b) Celular (PWA).** `src/main/celular/ledger-port.ts:175` usa `ownerQueue`, que filtra por `waitsForOwner` (`contract.ts:1234-1236`): só **entregue + risco alto** ou **amostra do dia**. O celular não mostra órfã, entrega parada nem o estado de envio do Slack (carta parada e conferir envio), então o desktop e o celular dão contas diferentes. **[corrigido pelo crítico]** O texto dizia que o celular "não mostra Slack". Mostra a carta de Slack a aprovar: ela nasce `entregue` e `risco: 'alto'` (`createSlackLetter`, `contract.ts:966-967`) e por isso passa em `waitsForOwner` (`contract.ts:1234-1236`). A `faixa` da listagem diz `esperandoDono: 9`, e a caixa do desktop tem 115.

**c) Avisos (push).** `src/main/celular/webpush.ts:187` percorre `ownerInbox` inteiro.

**O que não entra em nenhum dos três:** o andamento `precisa-do-dono` ou `travada` (`tarefa_andamento`). Pela instrução do MCP, ele "chega na hora ao Líder do quadro", não ao dono. Em 09/11 havia 9 desses eventos (seção 6).

História do critério: o ledger com prova entrou em `40254f8a` (2026-11-05), e a caixa de 7 tipos em `62391847` e `93e844b5` (2026-11-07). Para medir, apliquei o critério de hoje a todo o histórico.

### Como apliquei ao histórico (regra do script, `flags.py`)

- Cada **evento `entregue`** conta como uma chegada. Entrega de Slack vira `aprovar-carta`. Risco alto vira `decidir-entrega`. Risco baixo vira `entrega-parada` só se a decisão seguinte veio 24 h ou mais depois, ou se ainda está entregue há 24 h. A espera vai da entrega até a próxima aceita/rejeitada (ou até 09/11 16h UTC, se segue aberta).
- O registro automático de envio por bot ("⟦enviado pelo bot do agente⟧ o Slack confirmou") **não** conta. Os 5 com "o envio falhou" contam como `conferir-envio`.
- `para-repassar` usa o campo `orfa` de hoje (75). Não há histórico de órfãs passadas.
- `amostra-revisor` são as tarefas com evento `conferida` (12) mais as 3 em amostra hoje (`esperandoDono` em tarefa aceita: t-d1f072fd, t-2e9e7e3d, t-58a3a6bc).
- Também entram 5 tarefas que o dono decidiu fora da caixa (fechamento em lote, seção 5).

## 3. Como classifiquei (A–E)

- **A, só o dono, destrava:** escolher forma ou rumo de produto (protótipo, plano), autorizar em nome dele (falar por ele no Slack, autorizar colega, assumir compromisso), credencial nova ou uso de conta dele, gasto, apagar dado dele ou de produção, selo ou veredito de homologação, algo que só ele sabe (o que mudou na agenda, o que queria estudar). Base: as regras do próprio dono no `~/.claude/CLAUDE.md` ("Pergunte só: merge, main, produção, [...] credencial nova, apagar dado dele").
- **B, outro poderia decidir:** aceite de entrega verificável pelo critério (testes, PR, prova), resposta de rotina a colega, triagem de menção, carta de Slack sem compromisso. Também as cartas em que o dono respondeu "faça você".
- **C, informação:** relatório, amostra do Revisor, estado de envio, tarefa concluída que ele mandou "tirar da tela".
- **D, ruído:** órfã, duplicada, já respondida, cancelada ou substituída antes de ele agir.
- **E, acesso ou ação física:** login, reconectar aparelho, abrir app na máquina dele.

As fronteiras A/B são julgamento meu, item a item. A tabela no fim dá o motivo de cada um. Os casos de borda estão marcados ali (ex.: t-160aa3d3, resposta ao Filipe em nome do dono, ficou B porque não compromete; o dono só corrigiu o tom).

## 4. Resultado

### 4.1 Por categoria (296 itens que chegaram ou chegariam)

| Cat. | Itens | % | Chegadas (entregas) | Decididas pelo dono |
|---|---|---|---|---|
| A · só o dono, destrava | 44 | 14,9% | 47 | 43 (1 aberta) |
| B · outro poderia | 131 | 44,3% | 141 | 120 |
| C · informação | 30 | 10,1% | 7 | 10 |
| D · órfã/lixo/duplicada | 88 | 29,7% | 17 | 10 |
| E · acesso/ação física | 3 | 1,0% | 3 | 3 |
| **Total** | **296** | | **215** | **186** |

Considerando só as decisões do dono (190 eventos aceita/rejeitada): **A 45 (24%) · B 122 (64%) · C 10 · D 10 · E 3**.

Por dia: 05/11 tem 19 decisões (1 A); 06/11, 94 (20 A); 07/11, 43 (16 A); 08/11, 11 (4 A); 09/11, 23 (4 A). O pico de 06/11 vem da triagem do Slack pendente: 37 decisões em cartas `decidir-entrega` do BizOps (quase todas "Respondo à X?"), em sequência entre 15:47 e 16:50 UTC.

### 4.2 Por quadro

| Quadro | Itens | A | B | C | D | E |
|---|---|---|---|---|---|---|
| BizOps | 142 | 13 (9%) | 71 (50%) | 8 (6%) | 48 (34%) | 2 (1%) |
| Donel Dev | 98 | 16 (16%) | 22 (22%) | 20 (20%) | 40 (41%) | 0 |
| Homologação | 45 | 15 (33%) | 28 (62%) | 2 (4%) | 0 | 0 |
| (sem quadro, cartas de Slack) | 5 | 0 | 5 | 0 | 0 | 0 |
| Seazone Studio | 4 | 0 | 3 | 0 | 0 | 1 |
| _work | 2 | 0 | 2 | 0 | 0 | 0 |

Leitura: o **BizOps** é o que mais gera ruído em números absolutos (órfãs de pedidos de Slack e respostas de rotina). A **Homologação** é a de maior proporção de A (selo, decisões em lote, apagar em produção), mas ainda traz 28 aceites técnicos que o Revisor poderia fazer (ex.: t-c74e5352 "limite de tentativas na API", t-5d3ae1f1 "Avaliador pelo estado final"). No **Donel Dev**, 41% são órfãs.

### 4.3 Por porta de entrada × categoria

| Porta (inbox.ts) | A | B | C | D | E |
|---|---|---|---|---|---|
| decidir-entrega (risco alto) | 33 | 82 | 3 | 7 | 3 |
| aprovar-carta (Slack) | 9 | 28 | 0 | 8 | 0 |
| entrega-parada (baixo, 24 h) | 2 | 19 | 4 | 0 | 0 |
| para-repassar (órfã) | 0 | 2 | 0 | 73 | 0 |
| amostra-revisor | 0 | 2 | 13 | 0 | 0 |
| conferir-envio / carta-parada | 4* | 21* | 5 | 0 | 0 |

\* São as mesmas cartas de Slack, contadas de novo no estado de envio.

**Risco alto não separa A de B:** das 128 tarefas que chegaram por `decidir-entrega`, só 33 são A. O risco mede o perigo da mudança, não quem precisa decidir.

### 4.4 Exemplos reais por categoria

- **A:** "Protótipos: Mindscape de cadeiras e tela de cadeiras" (t-32b82559) · "Jornada: aplicar o que o cofre travou e carta do selo" (t-0dbcc00d) · "Ler o Slack pelo Theo para ter 1 min das 8h às 20h" (t-632788d1) · "Apagar a tabela antiga de demandas no Supabase" (t-4bd4bc80) · "Quem decide os problemas graves da vistoria" (t-db38a77c) · "Ligar as duas chaves da rotina de contas" (t-d35cbf67, aberta) · "Mensagem no Slack para canal da homologação do Hub Suprimen…" (t-efc96bcc).
- **B:** "Rayanne: login da Governança quebrado" (t-0c283dc0; dono: "O objetivo aqui é entender o que ela precisa e resolver por conta") · "Validar projeto Supabase da Lojinha (staging)" (t-e470c49f; "Faz vocÊ uai") · "Aprovação humana do conserto da Organização" (t-6066c6aa; "Usa o --admin") · "Contagem de órfãs igual para quem perguntar" (t-04099af0) · "Factory de homologação sem depender do Oráculo" (t-79987d6f, aberta) · 15 "Mensagem no Slack para #retiro-ai (thread do seu status)", canal que o dono depois declarou "carta branca" (t-6561384e: "nah, ta autorizado mandar mensagem lá a vontade. Lá é carta branca").
- **C:** "Slack pendente: as 11 cartas que faltaram" (t-b67bff29) · "Revisão dos problemas de 06 a 08/11" (t-5db5f14c) · "Teste e2e do ledger: escrever a data de hoje." (t-a54a0ecc, amostra) · 5 "Slack pelo bot: …" com "o envio falhou: fetch failed" · 8 tarefas fechadas em lote com "Tira as tarefas concluídas dessa tela de progresso também." (05/11).
- **D:** "Lucas Araújo, DM, 05/11/2026 15:58 — https://…" (t-920b9214, órfã, já virou t-80534358) · "Nathan: sistema jurídico já homologado?" (t-1905134e; dono: "Já respondido. Apareceu repetido") · "Alysson: conta de serviço no TaskDex" (t-babf5235; "Já respondido. Card continua aqui") · 7 cartas de #retiro-ai canceladas como substituídas · "Papel de fábrica editado: receber as melhorias?" (t-d611f0f8, substituída 8 min depois).
- **E:** "Dois fluxos seus do Slack falhando" (t-f2bf880b) · "Automação do bom dia no WhatsApp parou" (t-6b9a9605) · "Reenvio do uso de IA do Studio antes de a semana fechar" (t-3401231c).

## 5. Tempos e reações do dono

### 5.1 Quanto as A esperaram (entrega até a decisão do dono)

| Cat. | n | mediana | média | máx. | ≥ 12 h |
|---|---|---|---|---|---|
| A | 44 | 0,75 h | 3,8 h | 72,4 h | 4 |
| B | 129 | 1,0 h | 6,7 h | 51,6 h | 22 |
| C | 7 | 24,5 h | 22,9 h | 72,1 h | 4 |

**[corrigido pelo crítico: faltava]** A t-fd44bd79 mostra o problema mais grave do critério. É uma pergunta que só o dono responde ("Você disse que o planejamento mudou, mas não achei o quê"), com prazo "até segunda cedo, a conversa das 10h com a Raiza" (09/11 é segunda). Foi **reentregue com risco baixo** em 09/11 02:21 UTC (`tarefa_ver`). Pela regra de `entrega-parada` (`inbox.ts:113`, 24 h), ela só entra na caixa do desktop em 10/11 02:21 UTC (09/11 23:21 em Brasília), **depois do prazo**, e nunca entra no celular, que só mostra risco alto. Conferi às 16:12 UTC: ela não está na caixa.

As 4 A que passaram de 12 h foram t-fd44bd79 1:1s (72,4 h, ainda aberta), t-ce521745 chaves para cadastrar contas (26,7 h; chegou como risco **baixo**, por `entrega-parada`), t-32b82559 protótipos de cadeiras (13,7 h) e t-d35cbf67 token amplo (12,1 h, aberta).

A espera depois da entrega é curta porque o dono decide rápido o que vê. O atraso que trava está **antes da carta**:
- **Chave do AI Hub bloqueada desde 07/11**, sem nenhum selo saindo. Está como andamento `precisa-do-dono` desde 09/11 03:18 na t-80da20a7. Não é carta e não está no "Esperando você".
- **Carta que não aparecia.** O critério da t-315032f8 registra: "Refeita em 06/11 a partir da carta de 05/11 (t-801d8bf7), que ficou aberta num lugar já fechado e não aparecia para ele." A pergunta da Marta é de 05/11 15:32, e a decisão saiu em 06/11 15:49.
- **Aceita, mas não enviada.** Oito cartas de Slack foram aceitas pelo dono e nunca enviadas (`cartaSlack.enviada=false`). Sete são de 06/11 18:58 (t-dab38f1d, t-c57d087b, t-665e90f9, t-1ddd84bf, t-ca7a7cab, t-bb8d7caa, t-8d1d9fe5) e uma de 07/11 23:40 (t-1865eb03). Quatro são A (a Marta pode desligar o app, a Julia recebe o prazo "até segunda", o Horst pode ligar as funções, fecha com o Márcio). Não verifiquei se saíram por outro caminho.

### 5.2 Rejeições do dono (13 eventos em 12 tarefas)

| Tarefa | Texto do dono | Nota |
|---|---|---|
| t-678f3cb3 Cadeiras: protótipo final | "Ajustar" (+ comentário "Não tá como eu havia esperado") | não diz o quê |
| t-49934e83 Sessões gravam no ledger | "Ajustar antes" | só o rótulo, sem texto |
| t-63186140 Ledger v5: decisões do dono | "Parar e repensar" | depois aceitou "Tudo como recomendado" |
| t-d358abce Suíte de defeitos plantados | "Pedir os brinquedos antes" | rótulo/texto curto |
| t-3b8b9422 Theo lê e envia arquivos | "Devolver para terminar" (2×) | |
| t-fd44bd79 1:1s da semana | "o planejamento mudou" | o time não achou o quê (ver 03-cartas-reais.json) |
| t-efeb0ca3 Escrever na carta não sai | "Péssima prova. De nada vale. O problema é que o botão de escrever a opção mantém a carta no oráculo, mesmo após apertar em \"Enviar\"." | |
| t-4604624e Cartas grandes no celular | "Quero ver no Pc. Não tá bom de conferir no celular ainda" | |
| t-556daef7, t-037fc748, t-ab75adfe, t-3d2528e5 (Slack) | "Não enviar" | nas duas primeiras, antes: "Não vejo nenhuma mensagem no cartao" / "Não consigo ler mensagem alguma nesse cartão...." |

São **2 só com o rótulo "Ajustar"/"Ajustar antes"**: t-49934e83 sem nenhum texto e t-678f3cb3 só com um comentário vago. Apenas **3 têm texto próprio** (t-fd44bd79, t-efeb0ca3, t-4604624e). As demais são rótulos de opção. Em 14 das 137 decisões com opção gravada, o dono não escolheu a recomendada: "Não enviar" 4×, "Não precisa responder" 3×, "OpenRig + contas pelo OpenRig", "Ligar no proxy do Bill", "Desligar a automação", "Não é comigo", "Tirar de vez", "Ajustar antes" e "Não, só pela tela".

### 5.3 O que o dono escreveu nas cartas (25 comentários) e o que isso diz da carta

| Frase literal (tarefa) | O que faltou |
|---|---|
| "Não dá pra ver mensagem alguma nesse cartão." (t-dab38f1d) · "Não vejo nenhuma mensagem no cartao" (t-556daef7) · "Não consigo ler mensagem alguma nesse cartão...." (t-037fc748) | **O texto a aprovar não aparecia.** Em `paraODono.resumo` vai só o destino e o motivo (ex.: t-efc96bcc). |
| "Faça você. PAra de delegar pra mim safado" (t-54d85cbd) · "Faz vocÊ uai" ×2 (t-e470c49f) · "Faz vc esse ajuste e depois explica pra ela" (t-3de1ce47) · "Dalton que se vire pra fazer. Ele tem a VPS dele justamente pra isso" (t-b9232976) · "uma ova, se vira e nunca mais me ofenda fazendo um pedido desse. Usa o --admin" e "Que trava? Tira essa trava. Se ela é minha, de arrancar fora" (t-6066c6aa) · "Faz sem o OK do Fernando. Só dale" (t-c6964cbb) · "Você mesmo vai organizar um lugar para executar. Essa task não vai ser delegada" (t-ece4a28c) · "Solicita o acesso no suporte plataforma. Se as pessoas não respondem, faça você mesmo" e "Já falei, só puxa os acessos com o suporte plataforma e para de depender de pessoas" (t-25f4b31e) · "Faça com a conta do businessoperations no Slack. Por lá vc consegue ajustar" (t-8dfdd191) · "O objetivo aqui é entender o que ela precisa e resolver por conta. Pode botar um pod trabalhando no pedido dela" (t-0c283dc0) · "Sem rascunho. Primeiro faça a ação de validar. Depois mande a mensagem." (t-80534358) | **Não era carta para ele (B).** É o maior grupo de reações. |
| "Já respondido. Apareceu repetido" (t-1905134e) · "Já respondido. Card continua aqui" (t-babf5235) | **Carta duplicada ou já resolvida (D)**, e a carta não sabia disso. |
| "Acho que conta de serviço no taskdex nem existe. Confere antes de qualquer coisaa" (t-babf5235) · "SIA? Por que SIA?" (t-108852bf) | **A carta trouxe uma premissa sem prova** e não explicava o porquê. |
| "Similar ao recomendado, mas não fala para revogar senha[…] Para de ser chato com isso" (t-160aa3d3) | Queria **editar o texto da recomendação**, e não escolher entre opções. |
| "Conta google: Utilizará um grupo de e-mail. […] Guardião da suíte oculta? WTF […] cuidado para não burocratizar mutio o trabalho das pessoas. […] É o propósito <3" (t-356b8b45) | **Várias perguntas abertas numa carta**, respondidas num bloco de texto; uma pergunta ele não entendeu. |
| "Não tá como eu havia esperado" (t-678f3cb3) · a escolha real "Prefiro a facilidade de leitura da A3, com o layout da A1" (pedido de t-678f3cb3) | **Não dava para combinar opções nem apontar onde mudar no protótipo.** |
| "A ideia é ser a forma A. Mas não existe suporte para eu ver os protótipos nas próprias cartas nem como escrever lá." (t-6c504ed8, decisão registrada pelo Líder em 05/11) | **Protótipo e resposta escrita dentro da carta.** |

Pedidos do dono **sobre o Oráculo** gravados como tarefa (não como comentário) que dizem o mesmo: "Tem esses \"Esperando você\" aqui no chat que, quando eu abro, não estão de fato me esperando." (t-45e87762). "Tem muita carta referente a envio de mensagem de slack, mas todos vem com uma proposta rascunhada e fala que vai rascunhar mais coisa e enviar pra mim. Absurdo" (t-4aba83a3). "Ta tão mixuruquinha as cartas. Mal da pra ver." (t-4604624e). "Não quero que cartas travem nada também. Essas cartas estão terríveis e mal implementadas. Só está atrapalhando" (t-292de31a, 09/11). "um caralho que vai chegar pelo oráculo" (t-2e9e7e3d, 09/11).

## 6. O que precisa do dono e não chega à mesa

Eventos `comentada` com `⟦andamento⟧ estado: precisa-do-dono` ou `travada`, que não entram em `ownerInbox`:

| Tarefa | Quando | O que pedia |
|---|---|---|
| t-80da20a7 Religar o fluxo na VPS (Homologação) | 09/11 03:18 | "Chave do AI Hub do avaliador bloqueada (401) desde 07/11 […] Chave nova só o dono cria." |
| t-d35cbf67 Ligar as duas chaves (BizOps) | 09/11 02:54 | token amplo na VPS; login barrado. Neste caso há também uma carta (A, aberta). |
| t-2e9e7e3d Destravar o Mr. Coffee (BizOps) | 09/11 15:07 | "Precisa rodar como admin (UAC do dono)." |
| t-212bdba2 Trocar o par do SIA (BizOps) | 09/11 15:33 | sessão no PC com Bitwarden. Pede outra sessão, não o dono. |
| t-1293c818, t-c8047872 (2×), t-2a7a2784, t-f235dd32 | 09/11 12:54–15:43 | "precisa do dono: há uma permissão aberta na tela dela" (sinal automático de prompt de permissão) |

Hoje, portanto, os pedidos de acesso (E) ficam fora da mesa: só 3 E chegaram como carta em todo o histórico, e o mais bloqueante do dia está fora.

## 7. O que os números dizem para a mesa de tiragem

Fatos, sem proposta de código:
- Um filtro "**só A**" deixaria a mesa com **44 itens em 5 dias** (cerca de 9 por dia). O critério de hoje tem **296**, e a caixa de agora tem **115**, dos quais 1 é A.
- Os três maiores ruídos têm causa nomeada no código: órfãs entram por `para-repassar` (`inbox.ts:126-127`); o envio "sem confirmação" nunca sai (`inbox.ts:119` + `contract.ts:886`); e o risco alto é tratado como "precisa do dono" (`inbox.ts:112`).
- Os tipos de decisão A que apareceram de verdade, e que a carta precisa suportar, estão no `03-cartas-reais.json`, com uma carta real de cada: escolher entre protótipos; aprovar protótipo final apontando onde ajustar; tabela de N decisões com "aceitar tudo / mudar uma"; lote heterogêneo; escolher uma pessoa; responder um questionário; comparar caminhos com custo; manter ou podar com números; texto exato a aprovar; autorizar outra pessoa junto com o texto que sai; ação destrutiva; regra de comportamento do sistema; resposta livre a um fato que só ele sabe; conferir conteúdo; e pedido de acesso, que hoje não vira carta.
- **Limite do dono respeitado:** este levantamento não propõe ligar Oráculo e ledger, nem trata andamento como objetivo do Oráculo. A seção 6 só mede o que precisa do dono e se perde no caminho.

## 8. Limites deste levantamento

- **Órfãs:** só as de hoje (75). Quantas foram órfãs no passado e saíram não está no dado.
- **Amostra do Revisor:** contei 12 `conferida` e as 3 de hoje. Amostras que saíram sem `conferida` não aparecem. Não li `doc.startedAt`, que fica atrás da trava de segredos.
- **Categorias:** A/B/C/D/E são julgamento meu, item a item, com o motivo na tabela. Outra pessoa pode mover casos de borda entre A e B (respostas a colegas, aceites de selo).
- **Textos:** os do dono vêm de `ledger_resumo.py`, que corta em 600 caracteres e mascara "senha/token". Nenhum dos 25 comentários passa desse limite (o maior tem 474 caracteres, t-356b8b45).
- **Tela atual:** não verifiquei se ela já mostra o texto da carta de Slack. As queixas são de 06/11.
- **Envio por outro caminho:** não verifiquei se as 8 cartas aceitas e não enviadas saíram de outro jeito.

## 9. Tabela completa de classificação

Colunas: **via** é a porta de entrada (DE = decidir-entrega, SLK = aprovar-carta, PAR = entrega-parada, ORF = para-repassar, AM = amostra-revisor, CE = conferir-envio, CP = carta-parada, FORA = decidida pelo dono fora da caixa). **Espera** é a maior espera de uma entrega até a decisão, em horas; fica vazia quando não houve entrega.

| id | cat | quadro | estado | via | espera (h) | título | por quê |
|---|---|---|---|---|---|---|---|
| t-315032f8 | A | BizOps | aceita | DE | 2.5 | Marta: desligar o Stop de Crescimento antigo | autoriza colega a desligar app |
| t-47521d13 | A | BizOps | aceita | DE | 0.9 | Credencial própria do Oráculo para o serviço de menções | credencial nova |
| t-4f1a89a2 | A | BizOps | aceita | DE | 2.4 | David: aprovação automática no Stop | autoriza aprovação automática |
| t-632788d1 | A | BizOps | aceita | DE | 0.4 | Ler o Slack pelo Theo para ter 1 min das 8h às 20h | credencial nova ou gasto mensal |
| t-665e90f9 | A | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para #processo-homologação, thread do Git… | fecha acordo em nome dele |
| t-7ef67b2f | A | BizOps | aceita | DE | 2.5 | Horst: ligar as funções novas do TaskDex | autoriza colega a ligar funções |
| t-8d1d9fe5 | A | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para Gabriel Horst (DM) | autoriza colega em nome dele |
| t-bb8d7caa | A | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para #homologação-spotometro, thread da J… | promete prazo em nome dele |
| t-c4ca1a8f | A | BizOps | aceita | DE | 2.4 | Karina: Gestão CFO durante o recesso | compromete o time no recesso da Karina |
| t-c94293d9 | A | BizOps | aceita | DE | 0.6 | Carta ao dono: manter ou podar a fábrica de casos | manter ou podar (custo x meta) |
| t-ca7a7cab | A | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para Marta (DM) | autoriza desligamento em nome dele |
| t-d35cbf67 | A | BizOps | entregue | DE | 12.1 | Ligar as duas chaves da rotina de contas | token amplo dele na VPS |
| t-fd44bd79 | A | BizOps | entregue | PAR | 72.4 | 1:1s da semana 09–13/11: logs dos JTs e painel | só ele sabe o que mudou na agenda |
| t-2a4da5a9 | A | Donel Dev | aceita | DE | 3.5 | Cartões de estudo do sistema | só ele sabe o que queria estudar |
| t-32b82559 | A | Donel Dev | aceita | DE | 13.7 | Protótipos: Mindscape de cadeiras e tela de cadeiras | escolha entre 6 protótipos |
| t-45e413c9 | A | Donel Dev | aceita | DE | 1.2 | Responder decisões pelo Jobu, em seu nome? | decidir pelo Jobu em nome dele |
| t-463b08ed | A | Donel Dev | aceita | DE | 0.2 | Protótipo da carta das tarefas sem dono | forma de carta nova (protótipo) |
| t-49934e83 | A | Donel Dev | rejeitada | DE | 1.2 | Sessões gravam no ledger em vez de avisar o Líder | como o sistema avisa; rejeitou "Ajustar antes" |
| t-4bd4bc80 | A | Donel Dev | aceita | DE | 0.1 | Apagar a tabela antiga de demandas no Supabase | apagar dado dele (regra global) |
| t-617aa2d6 | A | Donel Dev | aceita | DE | 0.0 | Conta OpenAI do dono no gateway (Codex) | uso da conta OpenAI pessoal dele |
| t-63186140 | A | Donel Dev | aceita | DE | 2.6 | Ledger v5: decisões do dono | decisões de produto do Ledger v5 |
| t-678f3cb3 | A | Donel Dev | cancelada | DE | 1.0 | Cadeiras: protótipo final com a escolha do dono | protótipo final; rejeitou "Ajustar" |
| t-6c504ed8 | A | Donel Dev | aceita | DE | 0.3 | Acho que pouca coisa está chegando lá pra mim, heinn. Mas elas não est | forma das cartas (escolheu forma A no chat) |
| t-9c8d319a | A | Donel Dev | aceita | DE | 0.9 | Plano do Mindscape de homologação V1 | rumo do plano V1 |
| t-b3deea38 | A | Donel Dev | aceita | DE | 0.1 | Proxy nas VPS: vale usar, e como | pedir chave de API a outro time |
| t-ce521745 | A | Donel Dev | aceita | PAR | 26.7 | Cron + workflow que puxa contas novas sozinho | liberar duas chaves (credencial) |
| t-d37471a5 | A | Donel Dev | aceita | DE | 0.6 | Seus pedidos alinhado ao ledger, priorizando ali | escolha entre 3 telas |
| t-efbc8d92 | A | Donel Dev | aceita | DE | 0.1 | Faixa marrom: o fim de semana pronto para começar | rumo do fim de semana e contas |
| t-f85cb488 | A | Donel Dev | aceita | DE | 0.0 | Item 6: agente no WhatsApp do dono | agente falando no WhatsApp dele |
| t-04d510ab | A | Homologação | aceita | DE | 0.1 | Homologação torando: decisões do dono em lote | 6 decisões em lote, mescla em produção |
| t-0dbcc00d | A | Homologação | aceita | DE | 0.2 | Jornada: aplicar o que o cofre travou e carta do selo | selo provisório com 10 decisões |
| t-2b51f9df | A | Homologação | aceita | DE | 0.7 | Dois rigs de homologação: pesquisa e hillclimbing | desenho da factory |
| t-2e971e4a | A | Homologação | aceita | SLK | 0.8 | Mensagem no Slack para #homologacao-jornada-implantacao (ca… | anuncia selo em nome dele |
| t-356b8b45 | A | Homologação | aceita | DE | 1.6 | Acessos próprios da factory de homologação | mapa de acessos próprios; respondeu em texto |
| t-4020ea20 | A | Homologação | aceita | SLK | 0.0 | Mensagem no Slack para #homologacao-super-v2 (Envio de Rese… | avisa mescla na master de outro time |
| t-40b23043 | A | Homologação | aceita | DE | 0.2 | Triagem: 4 cards esperam decisão do dono | destino de 4 cards (mapa de hubs) |
| t-a678e4df | A | Homologação | aceita | SLK | 0.0 | Mensagem no Slack para canal da homologação do Auditor RM | veredito de homologação em nome dele |
| t-b2eb91ec | A | Homologação | aceita | SLK | 0.2 | Mensagem no Slack para canal de homologação do Multas Rever… | veredito de homologação em nome dele |
| t-bcce10a2 | A | Homologação | aceita | DE | 0.4 | Jornada: 8 funções publicadas fora do repositório | apagar funções em produção |
| t-d358abce | A | Homologação | aceita | DE | 0.3 | Suíte de defeitos plantados v1 | método do teste; rejeitou "Pedir os brinquedos antes" |
| t-db38a77c | A | Homologação | aceita | DE | 1.7 | Quem decide os problemas graves da vistoria | quem decide (pessoa) |
| t-dc4a7364 | A | Homologação | aceita | DE | 0.0 | Dalton mantém os registros do TaskDex em dia | mexer em cards da empresa e na Triagem |
| t-e660e62e | A | Homologação | aceita | DE | 0.4 | Jornada: proteção nas 9 tabelas de backup | dado de produção (apagar cópias?) |
| t-efc96bcc | A | Homologação | aceita | SLK | 0.0 | Mensagem no Slack para canal da homologação do Hub Suprimen… | exposição de dado pessoal em nome dele |
| t-03ca17dc | B | (sem quadro) | aceita | SLK+CE | 0.0 | Mensagem no Slack para Tauan Migliato (DM) | carta de Slack de rotina |
| t-20bcb399 | B | (sem quadro) | aceita | SLK+CE | 0.2 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-2505af57 | B | (sem quadro) | aceita | SLK+CE | 0.0 | Mensagem no Slack para Sua DM (você mesmo) | carta de Slack de rotina |
| t-752ed4ca | B | (sem quadro) | aceita | SLK+CE | 0.3 | Mensagem no Slack para Mario Lopes (DM) | carta de Slack de rotina |
| t-c19912b4 | B | (sem quadro) | aceita | SLK+CE | 0.0 | Mensagem no Slack para Tauan Migliato (DM) | carta de Slack de rotina |
| t-037fc748 | B | BizOps | rejeitada | SLK | 0.9 | Mensagem no Slack para Gabriel Rosset (DM) | carta de Slack de rotina |
| t-0c283dc0 | B | BizOps | aceita | DE | 2.5 | Rayanne: login da Governança quebrado | dono: "resolver por conta" |
| t-0e85e514 | B | BizOps | entregue | DE | 0.2 | Mesclar na staging o MCP do Theo sem carta | aceite de entrega verificável pelo critério |
| t-108852bf | B | BizOps | aceita | DE | 0.7 | Atualizar o Claude Code nas outras máquinas | dono: "SIA? Por que SIA?" |
| t-13a8b7f9 | B | BizOps | aceita | DE | 0.7 | Tirar a permissão auto dos papéis no PC | aceite de entrega verificável pelo critério |
| t-160aa3d3 | B | BizOps | aceita | DE | 3.5 | Filipe: três homologações e senha no canal | aceite de entrega verificável pelo critério |
| t-172d2e79 | B | BizOps | aceita | DE | 3.2 | Jaqueline: Agências Parceiras | aceite de entrega verificável pelo critério |
| t-1731edb7 | B | BizOps | aceita | DE | 3.1 | Marta: e-mails do time de homologação | aceite de entrega verificável pelo critério |
| t-1ddd84bf | B | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para #arquitetura-champions, thread do Ma… | carta de Slack de rotina |
| t-20133af9 | B | BizOps | aceita | DE | 3.1 | Victória: convite do Lovable | aceite de entrega verificável pelo critério |
| t-24a446d2 | B | BizOps | aceita | SLK+CE | 0.1 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-2589ea13 | B | BizOps | aceita | DE | 3.1 | Lívia: acesso ao banco do erros-onboarding | aceite de entrega verificável pelo critério |
| t-25f4b31e | B | BizOps | aceita | DE | 3.3 | Agente de homologação: acessos de nove apps | dono: "para de depender de pessoas" |
| t-2dbbae0d | B | BizOps | aceita | DE | 3.1 | Alan: Marketplace sem o status do fluxo | aceite de entrega verificável pelo critério |
| t-350baf66 | B | BizOps | aceita | SLK+CE | 0.1 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-3ae0a4d0 | B | BizOps | aceita | DE | 3.1 | Maria Luiza: Geoseazone para o EKS | aceite de entrega verificável pelo critério |
| t-3b8b9422 | B | BizOps | aceita | DE | 1.0 | Theo lê e envia arquivos no Slack (na VPS) | aceite de entrega verificável pelo critério |
| t-3d2528e5 | B | BizOps | rejeitada | SLK | 0.9 | Arquivo no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-3de1ce47 | B | BizOps | aceita | DE | 4.2 | Jaqueline: onde registrar a exposição de dados | dono: "Faz vc esse ajuste" |
| t-45578117 | B | BizOps | entregue | DE | 0.2 | Íris: cases-parceiros no Coolify já está em homologação | aceite de entrega verificável pelo critério |
| t-475bd1f5 | B | BizOps | aceita | PAR | 30.3 | Faixa preta: organização do PC | risco baixo parada 24 h |
| t-4e0c32a8 | B | BizOps | aceita | SLK+CE | 0.1 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-513fac79 | B | BizOps | aceita | DE | 6.3 | Estabilizar o proxy de saída do PC | aceite de entrega verificável pelo critério |
| t-54d85cbd | B | BizOps | cancelada | DE | 16.7 | Chamado crítico: chave do AI Hub na homologação | dono: "Faça você. PAra de delegar" |
| t-55177192 | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-556daef7 | B | BizOps | rejeitada | SLK | 1.0 | Mensagem no Slack para #homologacao-seazone-parcerias-onboa… | carta de Slack de rotina |
| t-5fe5054b | B | BizOps | aceita | SLK+CE | 0.6 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-6112258f | B | BizOps | aceita | DE | 3.1 | Karina: nota do PDF da call de feedback | aceite de entrega verificável pelo critério |
| t-6d58a65c | B | BizOps | aceita | DE | 3.1 | Márcio: saída do acesso admin temporário | aceite de entrega verificável pelo critério |
| t-707128ef | B | BizOps | aceita | DE | 2.4 | Bill e Lucas: gatilho das medalhas exposto | aceite de entrega verificável pelo critério |
| t-7092873f | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (mensagem nova para a Cla… | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-7753dcd0 | B | BizOps | aceita | DE | 2.5 | Julia: saldo errado no Spotômetro | aceite de entrega verificável pelo critério |
| t-80534358 | B | BizOps | aceita | DE | 2.5 | Lucas: validar a correção de segurança do TeamZone | dono: "Primeiro faça a ação de validar" |
| t-8119864a | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-84f13bfd | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (mensagem nova para a Cla… | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-856378c5 | B | BizOps | aceita | DE | 0.0 | Claudia reconhece os itens do retiro com prova | aceite de entrega verificável pelo critério |
| t-87dceed3 | B | BizOps | aceita | DE | 3.1 | Cristiane: tabelas do TeamZone na Nekt | aceite de entrega verificável pelo critério |
| t-883b69ad | B | BizOps | aceita | DE | 3.1 | Jaqueline: card repetido do Hub de Campanhas | aceite de entrega verificável pelo critério |
| t-886b8e9d | B | BizOps | aceita | DE | 2.5 | Miguel e Mario: GitHub App dos selos | aceite de entrega verificável pelo critério |
| t-8dfdd191 | B | BizOps | aceita | DE | 3.2 | Luana: automações do canal sem dono | dono: "Faça com a conta do businessoperations" |
| t-919cf7c9 | B | BizOps | aceita | DE | 3.1 | Letícia: app de check-in das assembleias | aceite de entrega verificável pelo critério |
| t-91da4746 | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-93fa3779 | B | BizOps | aceita | PAR | 30.6 | Plano para faixa preta no uso de IA | risco baixo parada 24 h |
| t-971db1f6 | B | BizOps | aceita | DE | 2.4 | Renato: conector da Nekt | aceite de entrega verificável pelo critério |
| t-986d4613 | B | BizOps | aceita | DE | 2.0 | Validação da correção de segurança do TeamZone | aceite de entrega verificável pelo critério |
| t-9d620a93 | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-a2b30095 | B | BizOps | aceita | DE | 0.7 | Conferir as skills declaradas nos papéis do Donel | aceite de entrega verificável pelo critério |
| t-ab75adfe | B | BizOps | rejeitada | SLK | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-b1c5a2fd | B | BizOps | aceita | DE | 0.3 | Marcar na lista da Ray os apps que já andaram | aceite de entrega verificável pelo critério |
| t-b318617e | B | BizOps | aceita | DE | 2.4 | Alfred: dois PRs seus esperando ajuste | aceite de entrega verificável pelo critério |
| t-b87a8eff | B | BizOps | aceita | DE | 0.1 | #retiro-ai: tutorial do proxy e pendências | aceite de entrega verificável pelo critério |
| t-b9232976 | B | BizOps | aceita | DE | 0.9 | Decidir correção de falhas de acesso no app de vistoria | dono: "Dalton que se vire" |
| t-bbbd4970 | B | BizOps | aceita | DE | 0.1 | Ver por que o Iris ainda cobra a homologação da Melina | aceite de entrega verificável pelo critério |
| t-c286ebdd | B | BizOps | aceita | DE | 3.1 | Roberto e Julia: trilha de valor das ofertas | aceite de entrega verificável pelo critério |
| t-c42f9aa2 | B | BizOps | aceita | DE | 0.3 | Avisar a Marta quando o David trocar o endereço do app | aceite de entrega verificável pelo critério |
| t-c57d087b | B | BizOps | aceita | SLK+CP | 3.0 | Mensagem no Slack para Bill (DM) | carta de Slack de rotina |
| t-c8a843dd | B | BizOps | aceita | SLK | 0.1 | Mensagem no Slack para #plataforma-gestao-de-acessos | carta de Slack de rotina |
| t-ceca481b | B | BizOps | aceita | DE | 2.4 | Fernando: reenvio da coleta de uso de IA | aceite de entrega verificável pelo critério |
| t-d0f50e0f | B | BizOps | aceita | DE | 3.1 | Daisi: Onboarding SZI com a conta dela | aceite de entrega verificável pelo critério |
| t-d34b6325 | B | BizOps | aceita | PAR | 50.6 | Theo instrui o #jovens-ias com o retiro | risco baixo parada 24 h |
| t-dab38f1d | B | BizOps | aceita | SLK+CP | 2.1 | Mensagem no Slack para Lucas Araújo (DM) | carta de Slack de rotina |
| t-dc665daf | B | BizOps | aceita | DE | 3.1 | Belle: agente de preços mínimos | aceite de entrega verificável pelo critério |
| t-dcdeb9dc | B | BizOps | aceita | DE | 2.4 | Lukas: painel de prospecção ameaçado | aceite de entrega verificável pelo critério |
| t-e3e8698a | B | BizOps | aceita | DE | 0.8 | Gatilho de swap dispara com swap parado | aceite de entrega verificável pelo critério |
| t-e470c49f | B | BizOps | aceita | DE | 1.2 | Validar projeto Supabase da Lojinha (staging) | dono: "Faz vocÊ uai" |
| t-e963cf85 | B | BizOps | aceita | SLK+CE | 0.2 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-ece4a28c | B | BizOps | aceita | DE | 3.3 | Cesar: demanda da Julia para um jovem talento | dono: "Você mesmo vai organizar" |
| t-f2fbfca0 | B | BizOps | aceita | SLK | 0.7 | Mensagem no Slack para #homologacao-jornada-implantacao (fi… | carta de Slack de rotina |
| t-f8af7b62 | B | BizOps | entregue | DE | 0.4 | Theo para de falar de OpenRig com os JTs | aceite de entrega verificável pelo critério |
| t-fcbf90d3 | B | BizOps | aceita | DE | 2.5 | Rosset: chave de produção na DM e acesso no teste | aceite de entrega verificável pelo critério |
| t-fe70c392 | B | BizOps | aceita | SLK+CE | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | carta de Slack de rotina (#retiro-ai, depois "carta branca") |
| t-04099af0 | B | Donel Dev | aceita | DE | 0.6 | Contagem de órfãs igual para quem perguntar | aceite de entrega verificável pelo critério |
| t-0b9efa0c | B | Donel Dev | aceita | DE | 0.1 | Escopo de MCPs nos seus papéis | aceite de entrega verificável pelo critério |
| t-121da54c | B | Donel Dev | aceita | DE | 0.1 | VPS usando o proxy do PC | aceite de entrega verificável pelo critério |
| t-141b6624 | B | Donel Dev | entregue | PAR | 26.1 | Cron + workflow: novidades do OpenRig no Donel | risco baixo parada 24 h |
| t-1b68a555 | B | Donel Dev | aceita | PAR | 50.5 | Oráculo potente: faxina das órfãs e causa | risco baixo parada 24 h |
| t-2d545dcd | B | Donel Dev | aceita | DE | 0.8 | Os líderes de cada mindscape deve ser apenas uma sessão única que se c | aceite de entrega verificável pelo critério |
| t-4604624e | B | Donel Dev | rejeitada | ORF |  | Cartas do Oráculo grandes e legíveis no celular | pedido de UI; dono rejeitou "Quero ver no Pc" |
| t-52b31719 | B | Donel Dev | aceita | DE | 0.6 | Líder único pode receber mensagem e tarefa | aceite de entrega verificável pelo critério |
| t-547be518 | B | Donel Dev | aceita | PAR | 36.4 | "É a peça mais frágil do sistema." (Líder, como-trabalhar-05-11.html § | risco baixo parada 24 h |
| t-56abde57 | B | Donel Dev | aceita | PAR | 32.1 | Jobu visível em qualquer monitor | risco baixo parada 24 h |
| t-5b9ce21e | B | Donel Dev | aceita | PAR | 27.3 | Líder único rodando na VPS | risco baixo parada 24 h |
| t-620b43fa | B | Donel Dev | aceita | DE | 0.6 | Nova tarefa encerra a que ela substitui | aceite de entrega verificável pelo critério |
| t-62864af6 | B | Donel Dev | aceita | PAR | 51.6 | Revisar os consertos do bypass e da carta | risco baixo parada 24 h |
| t-b3e7e992 | B | Donel Dev | aceita | DE | 0.0 | Proxy do PC ligando sozinho | aceite de entrega verificável pelo critério |
| t-bf73f0fc | B | Donel Dev | aceita | DE | 1.6 | "Mas as sessões que vc abrir terão os MCPs, certo?Isso é parte do prob | aceite de entrega verificável pelo critério |
| t-c66dffd2 | B | Donel Dev | aceita | PAR | 31.9 | Navegador do Donel em tela cheia | risco baixo parada 24 h |
| t-d7a974d0 | B | Donel Dev | aceita | DE | 0.4 | E se o oráculo rodar dentro do VPS? Sei que é pedir demais para as 15h | aceite de entrega verificável pelo critério |
| t-dda3571f | B | Donel Dev | aceita | DE | 1.3 | Mindscape mostra gargalos e o que fechar | aceite de entrega verificável pelo critério |
| t-e753b554 | B | Donel Dev | aceita | DE | 0.5 | Lugar que fecha passa as tarefas adiante | aceite de entrega verificável pelo critério |
| t-efeb0ca3 | B | Donel Dev | rejeitada | ORF |  | Escrever na carta não sai do Oráculo | conserto; dono rejeitou "Péssima prova" |
| t-fc8bec0b | B | Donel Dev | entregue | PAR | 24.6 | Contas no gateway e no Donel do PC, sem parar | risco baixo parada 24 h |
| t-fef57962 | B | Donel Dev | aceita | PAR | 31.6 | Mindscape de homologação: números da factory | risco baixo parada 24 h |
| t-0dc26a9e | B | Homologação | aceita | DE | 1.0 | Registro por achado e replay de etapa | aceite de entrega verificável pelo critério |
| t-1b6c1a95 | B | Homologação | aceita | DE | 0.9 | Preciso rodar esse processo na nossa nova VPs que o Bill nos concedeu  | aceite de entrega verificável pelo critério |
| t-1c1f0555 | B | Homologação | entregue | DE | 12.0 | Revisar PRs 122 e 152 da esteira | aceite de entrega verificável pelo critério |
| t-2e2e6413 | B | Homologação | aceita | DE | 0.0 | Preciso rodar esse processo na nossa nova VPs que o Bill nos concedeu  | aceite de entrega verificável pelo critério |
| t-40e6ef85 | B | Homologação | aceita | DE | 0.4 | Jornada: registro de migrations alinhado | aceite de entrega verificável pelo critério |
| t-42394704 | B | Homologação | aceita | AM+PAR | 46.0 | Preciso rodar esse processo na nossa nova VPs que o Bill nos concedeu  | risco baixo parada 24 h |
| t-48b56f6a | B | Homologação | aceita | PAR | 37.1 | Rodada com PR abre o Conferente sozinha | risco baixo parada 24 h |
| t-4ef9feb7 | B | Homologação | aceita | DE | 0.4 | Preciso rodar esse processo na nossa nova VPs que o Bill nos concedeu  | aceite de entrega verificável pelo critério |
| t-5b784b83 | B | Homologação | aceita | DE | 0.4 | Tradutor de RLS para z3 lendo o catálogo | aceite de entrega verificável pelo critério |
| t-5d3ae1f1 | B | Homologação | aceita | DE | 0.9 | Avaliador pelo estado final, motor do selo | aceite de entrega verificável pelo critério |
| t-743abc4a | B | Homologação | aceita | PAR | 31.8 | Dalton em todos os canais de homologação | risco baixo parada 24 h |
| t-77219324 | B | Homologação | aceita | DE | 0.1 | E mais, como está a homologação? As 15h40 vou sair e gostaria que esti | aceite de entrega verificável pelo critério |
| t-78764bc7 | B | Homologação | aceita | DE | 0.6 | Laço das rodadas resiliente a falhas do modelo | aceite de entrega verificável pelo critério |
| t-79987d6f | B | Homologação | entregue | DE | 13.7 | Factory de homologação sem depender do Oráculo | aceite de entrega verificável pelo critério |
| t-82418895 | B | Homologação | aceita | DE | 0.0 | Preciso rodar esse processo na nossa nova VPs que o Bill nos concedeu  | aceite de entrega verificável pelo critério |
| t-847a1f09 | B | Homologação | aceita | DE | 0.2 | Preciso de um terceiro Rig. Ele será sobre melhoria do processo de hom | aceite de entrega verificável pelo critério |
| t-88ce3317 | B | Homologação | aceita | AM+PAR | 43.7 | Você consegue migrar as permissões pra lá? | risco baixo parada 24 h |
| t-8ba24d7d | B | Homologação | aceita | DE | 1.0 | Camada de métricas da factory de homologação | aceite de entrega verificável pelo critério |
| t-bbab64eb | B | Homologação | aceita | DE | 0.0 | AI Rats Hub: dois PRs de correção para a staging | aceite de entrega verificável pelo critério |
| t-c74e5352 | B | Homologação | aceita | DE | 0.3 | Jornada: limite de tentativas na API | aceite de entrega verificável pelo critério |
| t-d58acb9e | B | Homologação | aceita | DE | 1.1 | Vigia diário de atualizações do OpenRig | aceite de entrega verificável pelo critério |
| t-df6e7745 | B | Homologação | aceita | DE | 0.2 | Preciso de um terceiro Rig. Ele será sobre melhoria do processo de hom | aceite de entrega verificável pelo critério |
| t-e203b2b8 | B | Homologação | aceita | DE | 0.4 | Jornada: scripts de banco com escrita e sem volta | aceite de entrega verificável pelo critério |
| t-e871bfe1 | B | Homologação | aceita | DE | 0.2 | E quero que todos os aprendizados do PC estejam corretamente integrado | aceite de entrega verificável pelo critério |
| t-e99f576f | B | Homologação | aceita | PAR | 26.5 | HTML do roadmap de homologação atualizado | risco baixo parada 24 h |
| t-f7a5ca73 | B | Homologação | aceita | DE | 0.2 | Preciso de um terceiro Rig. Ele será sobre melhoria do processo de hom | aceite de entrega verificável pelo critério |
| t-f8ebc7a3 | B | Homologação | aceita | PAR | 32.1 | Adiciona uma task de aprender como compartilhar pelo passbolt (Cofre) | risco baixo parada 24 h |
| t-ff77a04c | B | Homologação | aceita | SLK | 0.2 | Mensagem no Slack para canal de homologação do Reservas Cor… | carta de Slack de rotina |
| t-1865eb03 | B | Seazone Studio | aceita | SLK+CP | 0.1 | Mensagem no Slack para grupo com Tauan, Fernando e Bill (th… | carta de Slack de rotina |
| t-6066c6aa | B | Seazone Studio | aceita | DE | 1.1 | Aprovação humana do conserto da Organização | dono: "uma ova, se vira... Usa o --admin" |
| t-c6964cbb | B | Seazone Studio | cancelada | DE | 0.3 | Organização vazia na máquina do Studio | dono: "Faz sem o OK do Fernando" **[corrigido pelo crítico: caso de borda]** É decisão do dono ("Decidida pelo dono por escrito na própria carta", evento do Líder em 07/11 19:27 UTC), não devolução. Pela regra A deste doc ("autorizar colega"), pode ser A. |
| t-00426f63 | B | _work | aceita | DE | 0.5 | Instruções do Claude arrumadas | aceite de entrega verificável pelo critério |
| t-b5016a85 | B | _work | aceita | PAR | 49.9 | Wiki do Obsidian como memória perene | risco baixo parada 24 h |
| t-28cf35b5 | C | BizOps | aceita | CE |  | Slack pelo bot: C0CCQ9C5ZD1 | estado de envio do bot |
| t-2e9e7e3d | C | BizOps | aceita | AM |  | Destravar o Mr. Coffee no privado do dono | amostra do que o Revisor aceitou |
| t-537c93b3 | C | BizOps | aceita | CE |  | Slack pelo bot: C0CCQ9C5ZD1 | estado de envio do bot |
| t-b67bff29 | C | BizOps | aceita | PAR | 72.1 | Slack pendente: as 11 cartas que faltaram | relatório de varredura |
| t-cdc232fe | C | BizOps | aceita | CE |  | Slack pelo bot: D0CFB605B5M | estado de envio do bot |
| t-d1f072fd | C | BizOps | aceita | AM |  | Freio para rajada de aberturas de sessão na VPS | amostra do que o Revisor aceitou |
| t-d6a1c8b0 | C | BizOps | aceita | CE |  | Slack pelo bot: D0CFB605B5M | estado de envio do bot |
| t-d6f12fbb | C | BizOps | aceita | CE |  | Slack pelo bot: D0CFB605B5M | estado de envio do bot |
| t-29e1327b | C | Donel Dev | aceita | FORA |  | Preciso poder aumentar essa janela de texto do jobu para visualizar me | fechada em lote: "Tira as tarefas concluídas" |
| t-2b04875f | C | Donel Dev | aceita | FORA |  | O Ledger se chamará Oráculo Harrow, para casar com a dinâmica do PF2e | fechada em lote: "Tira as tarefas concluídas" |
| t-3fd85c94 | C | Donel Dev | aceita | FORA |  | "Portão de merge com build (electron-vite build no typecheck+test) e r | fechada em lote: "Tira as tarefas concluídas" |
| t-45e87762 | C | Donel Dev | aceita | DE | 0.0 | Tem esses "Esperando você" aqui no chat que, quando eu abro, não estão | fechada em lote: "Tira as tarefas concluídas" |
| t-58a3a6bc | C | Donel Dev | aceita | AM |  | Carta deixa de travar envio ao Slack | amostra do que o Revisor aceitou |
| t-5db5f14c | C | Donel Dev | entregue | PAR | 24.5 | Revisão dos problemas de 06 a 08/11 | relatório de revisão |
| t-727e64cf | C | Donel Dev | aceita | FORA |  | Gostaria que o Jobu desse um progresso sempre que alguma atividade é f | fechada em lote: "Tira as tarefas concluídas" |
| t-88df88f4 | C | Donel Dev | aceita | DE | 0.0 | "Isso deve estar explicado lá também, hein" (dono, 05/11, depois de pa | fechada em lote: "Tira as tarefas concluídas" |
| t-8fed1d77 | C | Donel Dev | aceita | AM |  | Enviar mudo na carta de Slack | amostra do que o Revisor aceitou |
| t-995ea187 | C | Donel Dev | aceita | DE | 0.0 | Quero compartilhar o estado atual do donel dev com pessoas. Pode levar | fechada em lote: "Tira as tarefas concluídas" |
| t-a1b4b4c6 | C | Donel Dev | entregue | PAR | 26.2 | Quais sessões das VPS fechar | relatório de sessões |
| t-a1ea2798 | C | Donel Dev | aceita | AM |  | Oráculo aceita carta de serviço sem sessão | amostra do que o Revisor aceitou |
| t-a54a0ecc | C | Donel Dev | aceita | AM |  | Teste e2e do ledger: escrever a data de hoje. | amostra do que o Revisor aceitou |
| t-af2e8930 | C | Donel Dev | aceita | AM |  | Carta aceita e não enviada não conta como órfã | amostra do que o Revisor aceitou |
| t-b4258f64 | C | Donel Dev | aceita | AM |  | Fim do conflito no arquivo de novidades | amostra do que o Revisor aceitou |
| t-b7dc937b | C | Donel Dev | aceita | AM |  | Pedir ao Líder pelo Oráculo, por texto ou áudio | amostra do que o Revisor aceitou |
| t-bed74759 | C | Donel Dev | aceita | FORA |  | Quero conseguir ver a saúde das VPS também, junto da saúde do computad | fechada em lote: "Tira as tarefas concluídas" |
| t-ca412551 | C | Donel Dev | aceita | PAR | 37.5 | Ronda de self-healing do que deu errado em 06/11 | relatório de ronda |
| t-d7d1b3bd | C | Donel Dev | aceita | AM |  | Corrija as ressalvas que o Revisor deixou nos PRs mergeados hoje (#213 | amostra do que o Revisor aceitou |
| t-f969b463 | C | Donel Dev | aceita | AM |  | Aviso "terminou" chega inteiro ao Líder | amostra do que o Revisor aceitou |
| t-0f375e74 | C | Homologação | aceita | AM |  | Preciso de um terceiro Rig. Ele será sobre melhoria do processo de hom | amostra do que o Revisor aceitou |
| t-86ed1aad | C | Homologação | aceita | AM |  | Factory 03: Despachante de acessos | amostra do que o Revisor aceitou |
| t-016e6889 | D | BizOps | cancelada | SLK | 0.1 | Mensagem no Slack para #retiro-ai (thread do seu status) | cancelada/substituída |
| t-0db11419 | D | BizOps | aberta | ORF |  | Julia Dieguez Servagio, #homologação-spotometro, 05/11/2026 14:01 — ht | órfã: lugar dono fechou |
| t-1905134e | D | BizOps | aceita | DE | 3.2 | Nathan: sistema jurídico já homologado? | dono: "Já respondido. Apareceu repetido" |
| t-194e75a2 | D | BizOps | aberta | ORF |  | Miguel Lewandowski e Mario Lopes de Andrade, #processo-homologação e # | órfã: lugar dono fechou |
| t-19925304 | D | BizOps | cancelada | SLK | 0.1 | Mensagem no Slack para #retiro-ai (mensagem nova para a Cla… | cancelada/substituída |
| t-19bf2882 | D | BizOps | aberta | ORF |  | Márcio: fechar o modelo de acesso admin temporário | órfã: lugar dono fechou |
| t-1e6df705 | D | BizOps | aberta | ORF |  | Luana: não consegue editar as automações do canal | órfã: lugar dono fechou |
| t-20c7b711 | D | BizOps | aberta | ORF |  | BizOps AI (agente da homologação), lembretes em 9 canais de homologaçã | órfã: lugar dono fechou |
| t-298d13b6 | D | BizOps | cancelada | SLK | 0.4 | Mensagem no Slack para #retiro-ai (thread do seu status) | cancelada/substituída |
| t-31465a77 | D | BizOps | aberta | ORF |  | Fernando Silva Pereira, grupo DM (Alexandre, Tauan, Fernando, Bill), 0 | órfã: lugar dono fechou |
| t-35bec5e9 | D | BizOps | aberta | ORF |  | Daisi: Onboarding SZI usa a conta pessoal dela | órfã: lugar dono fechou |
| t-36d64740 | D | BizOps | aberta | ORF |  | Slackbot, DM, 05/11/2026 17:15 a 18:28 — https://seazone-fund.slack.co | órfã: lugar dono fechou |
| t-3e1c4d82 | D | BizOps | aberta | ORF |  | David Soares, #homologacao-stop-crescimento, 30/10/2026 14:51 — https: | órfã: lugar dono fechou |
| t-50b0b5f3 | D | BizOps | aberta | ORF |  | Gabriel Camlofski Horst, DM, 05/11/2026 16:37 — https://seazone-fund.s | órfã: lugar dono fechou |
| t-5f510453 | D | BizOps | aberta | ORF |  | Jaqueline Souza Santana, #homologacao-dashboard-atendimento, 30/10/202 | órfã: lugar dono fechou |
| t-5f5843c2 | D | BizOps | cancelada | SLK | 0.0 | Mensagem no Slack para #retiro-ai (thread do seu status) | cancelada/substituída |
| t-6f7cb70a | D | BizOps | cancelada | SLK | 0.1 | Mensagem no Slack para #retiro-ai (thread do seu status) | cancelada/substituída |
| t-72d0aa51 | D | BizOps | cancelada | SLK | 0.1 | Mensagem no Slack para #retiro-ai (fio da lista do Fernando) | cancelada/substituída |
| t-801d8bf7 | D | BizOps | aberta | ORF |  | Marta Bezerra de Sousa, DM, 05/11/2026 10:41 e 15:32 — https://seazone | órfã: lugar dono fechou |
| t-80ecd6cd | D | BizOps | aberta | ORF |  | Jaqueline: card repetido do Hub de Campanhas | órfã: lugar dono fechou |
| t-920b9214 | D | BizOps | aberta | ORF |  | Lucas Araújo, DM, 05/11/2026 15:58 — https://seazone-fund.slack.com/ar | órfã: lugar dono fechou |
| t-9331f68d | D | BizOps | cancelada | DE | 0.7 | Pôr o Dalton na lista de bots do Donel | cancelada/substituída |
| t-9925c517 | D | BizOps | aberta | ORF |  | Cesar Carvalho, DM, 05/11/2026 16:00 — https://seazone-fund.slack.com/ | órfã: lugar dono fechou |
| t-9a2c4898 | D | BizOps | aberta | ORF |  | Maria Luiza: e a ida do Geoseazone para o EKS? | órfã: lugar dono fechou |
| t-9c209c5d | D | BizOps | aberta | ORF |  | Belle: agente de preços mínimos e suporte de RM | órfã: lugar dono fechou |
| t-a3103a74 | D | BizOps | aberta | ORF |  | Karina Villanes, #homologação-teamzone, 28/10/2026 16:47 — https://sea | órfã: lugar dono fechou |
| t-a3bcebf2 | D | BizOps | aberta | ORF |  | Cristiane: tabelas do TeamZone na Nekt | órfã: lugar dono fechou |
| t-a47fed48 | D | BizOps | aberta | ORF |  | Jaqueline Souza Santana, #homologacao-parceirosreservas e #homologacao | órfã: lugar dono fechou |
| t-ab46c136 | D | BizOps | aberta | ORF |  | Renato Lousan, DM, 05/11/2026 11:33 e 11:35 — https://seazone-fund.sla | órfã: lugar dono fechou |
| t-ad477635 | D | BizOps | aberta | ORF |  | Lívia Cunha de Assis, #homologacao-erros-onboarding, 29/10/2026 15:04  | órfã: lugar dono fechou |
| t-ae149b9c | D | BizOps | aberta | ORF |  | Atualizar o gateway de contas Claude do PC | órfã: lugar dono fechou |
| t-ae84e14d | D | BizOps | aberta | ORF |  | Alysson Gabriel Ferreira Pessoa, DM, 29/10/2026 18:51 — https://seazon | órfã: lugar dono fechou |
| t-b30ae961 | D | BizOps | aberta | ORF |  | Faxina do PC sem acesso a partir da VPS | órfã: lugar dono fechou |
| t-b62bd484 | D | BizOps | cancelada | DE | 0.7 | Configurar o token do SIA e atualizar o plugin geral | cancelada/substituída |
| t-b6935460 | D | BizOps | aberta | ORF |  | Karina Villanes, #homologacao-gestao-cfo, 03/11/2026 18:57 — https://s | órfã: lugar dono fechou |
| t-babf5235 | D | BizOps | aceita | DE | 3.3 | Alysson: conta de serviço no TaskDex | dono: "Já respondido. Card continua aqui" |
| t-bb5b5864 | D | BizOps | aberta | ORF |  | Letícia: app de check-in das assembleias | órfã: lugar dono fechou |
| t-bec0b950 | D | BizOps | aberta | ORF |  | Rayanne Oliveira, DM, 05/11/2026 10:22 e 13:30 — https://seazone-fund. | órfã: lugar dono fechou |
| t-c3eecece | D | BizOps | aberta | ORF |  | Nathan: sistema jurídico já homologado? | órfã: lugar dono fechou |
| t-cae3eca0 | D | BizOps | aberta | ORF |  | Marta: e-mails para a tag do time de homologação | órfã: lugar dono fechou |
| t-d37d303a | D | BizOps | cancelada | SLK | 0.2 | Mensagem no Slack para #retiro-ai (thread do seu status) | cancelada/substituída |
| t-d5c83f7d | D | BizOps | aberta | ORF |  | Lukas Henrique Stumpf Acioli, DM, 27/10/2026 15:39 — https://seazone-f | órfã: lugar dono fechou |
| t-dbb7e805 | D | BizOps | aberta | ORF |  | Caroline Silva Seixas Leite, DM, 05/11/2026 21:01 — https://seazone-fu | órfã: lugar dono fechou |
| t-dd97b581 | D | BizOps | aberta | ORF |  | Alan Pontizelli, #temp-sync-sienge-szi, 27/10/2026 16:06 — https://sea | órfã: lugar dono fechou |
| t-ea006807 | D | BizOps | aberta | ORF |  | Victória Magri: convite do Lovable enviado | órfã: lugar dono fechou |
| t-f5775932 | D | BizOps | aberta | ORF |  | Bruno Bill Benetti e Lucas Araújo, DMs, 05/11/2026 — https://seazone-f | órfã: lugar dono fechou |
| t-f9880ae1 | D | BizOps | aberta | ORF |  | Filipe Padoveze, #homologacao-seazone-parcerias-onboarding, #homologac | órfã: lugar dono fechou |
| t-f9fc6319 | D | BizOps | aberta | ORF |  | Roberto Campos, grupo DM do caso da cota 105 (Julia, Roberto Amaral, A | órfã: lugar dono fechou |
| t-01d34053 | D | Donel Dev | aberta | ORF |  | Mensagem ao Slack que não saiu nunca fica fechada | órfã: lugar dono fechou |
| t-050fec8a | D | Donel Dev | aberta | ORF |  | "Higiene do PC: faxina de worktrees mergeadas e um teto de sessões viv | órfã: lugar dono fechou |
| t-11da4263 | D | Donel Dev | em-execucao | ORF |  | Acesso às VPS sem depender do login do dono | órfã: lugar dono fechou |
| t-148f5581 | D | Donel Dev | em-execucao | ORF |  | Contas com crédito no seletor do Donel do PC | órfã: lugar dono fechou |
| t-1ad8443d | D | Donel Dev | aberta | ORF |  | Wiki do Líder em dia com as passagens de hoje | órfã: lugar dono fechou |
| t-2006c0ba | D | Donel Dev | aberta | ORF |  | Prova reproduz o que o dono relatou | órfã: lugar dono fechou |
| t-2367a54e | D | Donel Dev | em-execucao | ORF |  | Login barrado no navegador integrado | órfã: lugar dono fechou |
| t-29efba60 | D | Donel Dev | em-execucao | ORF |  | Pedido em áudio no Oráculo (PC) | órfã: lugar dono fechou |
| t-2c18d666 | D | Donel Dev | em-execucao | ORF |  | Faxina noturna do Oráculo e aviso de órfã | órfã: lugar dono fechou |
| t-36e07d34 | D | Donel Dev | aberta | ORF |  | "Rotinas saem da sombra depois de 7 dias de log: 'sessão parada' passa | órfã: lugar dono fechou |
| t-3ebcfa78 | D | Donel Dev | em-execucao | ORF |  | Orquestradora na VPS, PC só com o app | órfã: lugar dono fechou |
| t-44655ecc | D | Donel Dev | aberta | ORF |  | "adiciona no teu backlog a ideia de conseguir trazer e esconder sessõe | órfã: lugar dono fechou |
| t-4aba83a3 | D | Donel Dev | rejeitada | ORF |  | Slack num toque só: sem carta de decisão duplicada | órfã: lugar dono fechou |
| t-50930a1d | D | Donel Dev | rejeitada | ORF |  | Oráculo espelhado no Supabase pessoal | órfã: lugar dono fechou |
| t-58b67066 | D | Donel Dev | aberta | ORF |  | Sinal do Líder (05/11): as sessões abertas na VPS dividem a mesma past | órfã: lugar dono fechou |
| t-5a95bc76 | D | Donel Dev | aberta | ORF |  | Prints da carta e do aviso do vigia no alfa | órfã: lugar dono fechou |
| t-6561384e | D | Donel Dev | aberta | ORF |  | Carta branca por canal no Slack | órfã: lugar dono fechou |
| t-6ec2247c | D | Donel Dev | cancelada | DE | 0.1 | Sessão viva não perde a ligação ao religar | cancelada/substituída |
| t-74bc7bc4 | D | Donel Dev | aberta | ORF |  | RAM do PC sempre abaixo de 50% | órfã: lugar dono fechou |
| t-81e27aac | D | Donel Dev | aberta | ORF |  | Pendência do dono aparece no Esperando você | órfã: lugar dono fechou |
| t-82905d01 | D | Donel Dev | aberta | ORF |  | "falta falta um ctrl+f no mindscape hein" (contexto: o dono procurava  | órfã: lugar dono fechou |
| t-881254f8 | D | Donel Dev | aberta | ORF |  | "Porcaria hein, vou te ligar como este computador. To muito capado." ( | órfã: lugar dono fechou |
| t-9645051f | D | Donel Dev | aberta | ORF |  | "Alçadas escritas + hook de main (vem do /insights, seção 5): um arqui | órfã: lugar dono fechou |
| t-a6f04981 | D | Donel Dev | aberta | ORF |  | Histórico de cartas e retomar decisão | órfã: lugar dono fechou |
| t-ad76b1b8 | D | Donel Dev | aberta | ORF |  | "Ressalva (não bloqueia), mask.ts: senha dentro de URL passa. DATABASE | órfã: lugar dono fechou |
| t-af678813 | D | Donel Dev | aberta | ORF |  | Jobu sumiu e caixa perde o foco ao digitar | órfã: lugar dono fechou |
| t-b4d7c029 | D | Donel Dev | aberta | ORF |  | Acesso livre do Líder às contas do dono | órfã: lugar dono fechou |
| t-c415c1e0 | D | Donel Dev | em-execucao | ORF |  | "prioridade aqui é a parte de vc ter liberdade de infinitas sessões, l | órfã: lugar dono fechou |
| t-cce40c2f | D | Donel Dev | aberta | ORF |  | Alfa novo com o Oráculo que se limpa sozinho | órfã: lugar dono fechou |
| t-d3256680 | D | Donel Dev | em-execucao | ORF |  | Cadeiras: esquema da A3 no canvas da A1 | órfã: lugar dono fechou |
| t-d611f0f8 | D | Donel Dev | cancelada | DE | 0.1 | Papel de fábrica editado: receber as melhorias? | cancelada/substituída |
| t-d872c026 | D | Donel Dev | aberta | ORF |  | "Quando o dono edita o papel Líder, a edição entra como 'complemento'… | órfã: lugar dono fechou |
| t-d92b334e | D | Donel Dev | aberta | ORF |  | Memória do app no PC | órfã: lugar dono fechou |
| t-da68a31e | D | Donel Dev | aberta | ORF |  | "Sugestão: o decideRefusal recusar também o Revisor aberto por quem cr | órfã: lugar dono fechou |
| t-deb733dd | D | Donel Dev | em-execucao | ORF |  | Trava: nada sem tarefa no Oráculo | órfã: lugar dono fechou |
| t-df3e4d08 | D | Donel Dev | aberta | ORF |  | Fim do conflito diário nas notas da versão | órfã: lugar dono fechou |
| t-f9459aec | D | Donel Dev | cancelada | SLK | 0.0 | Mensagem no Slack para Fernando Silva Pereira (DM) | cancelada/substituída |
| t-f9bfca55 | D | Donel Dev | cancelada | DE | 0.1 | Lugar retomado pede um olhar seu? | cancelada/substituída |
| t-fb11c6cd | D | Donel Dev | em-execucao | ORF |  | "Sessão durável. Atualizar o alfa reabre o time onde parou (registro + | órfã: lugar dono fechou |
| t-ffbf8e7d | D | Donel Dev | aberta | ORF |  | Vigia de travas com o PC desligado | órfã: lugar dono fechou |
| t-6b9a9605 | E | BizOps | aceita | DE | 3.1 | Automação do bom dia no WhatsApp parou | reconectar WhatsApp no aparelho dele |
| t-f2bf880b | E | BizOps | aceita | DE | 2.4 | Dois fluxos seus do Slack falhando | fluxos do Slack na conta dele |
| t-3401231c | E | Seazone Studio | aceita | DE | 0.1 | Reenvio do uso de IA do Studio antes de a semana fechar | abrir o Studio na máquina dele |
