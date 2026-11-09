# 05 — Crítica dos levantamentos 01 a 04

> Conferência feita em 09/11/2026, por volta das 13h em Brasília. Nada mudou no app. Fontes:
> `git show`, `git log` e `git merge-base` na worktree `oraculo-mesa` (staging `56c7ca22`) e em `origin/proto/cartas`;
> `tarefa_ver` (t-63186140, t-fd44bd79, t-d35cbf67, t-32b82559, t-c8a843dd, t-986d4613);
> `tarefa_listar {todos:true, situacao:'todas'}` e `{situacao:'orfas'}` às 16:12 UTC, com 473 tarefas e a faixa
> `orfas: 75, esperandoDono: 15, esperandoEnvio: 8`; `~/bin/rotinas/ledger_resumo.py --dias 3650`, para os eventos;
> transcripts da VPS (`482b1d27`, `e63b8303`, `35a0ccfe`, `be1cf028`, `837dacd3`). Scripts e cópias em
> `~/seazone/_scratch/critica-oraculo/`, fora do repo.
> Todas as correções foram feitas direto nos arquivos e marcadas com **[corrigido pelo crítico]**.

## Veredito curto

As bases se sustentam: as datas dos commits, a forma A, a virada de 07/11 e o molde da carta. As contagens
principais também batem com a fonte: 190 decisões, 13 rejeições em 12 tarefas, 25 comentários, a recomendada
escolhida em 123 de 137 cartas, 75 órfãs, 17 envios sem confirmação, 8 cartas aceitas e não enviadas, 0 decisões
pela opção "Outra" e 15 entregas de risco alto sem bloco.

Achei **4 erros de fato**, **1 conta que não fecha**, **3 exageros** e **4 fatos que faltavam**. O mais importante
muda a história da virada: o dono **ratificou** a direção da tabela numa carta, mas aprovou o **print de outra
tela**.

## As 10 afirmações conferidas

| # | Afirmação (doc) | Resultado | Fonte da conferência |
|---|---|---|---|
| 1 | A mesa nasceu no celular em 05/11 08:07: uma carta por tela, naipe, arrastar para aceitar ou rejeitar, "O baralho está vazio" (01 §1.1) | **Confere.** Corrigi um detalhe: o texto dizia que "o ledger real ainda não existia", mas `40254f8a` (ledger V1, 08:06) é ancestral de `483b1180`, que foi rebaseado (autor 08:07, commit 08:14) | `git show 483b1180` (mensagem, `app.css` com `scroll-snap`, `app.js:8` com `LIMIAR = 0.28`, `:180`, `:366`); `celular.ts` com os 6 naipes; `git merge-base --is-ancestor 40254f8a 483b1180` |
| 2 | O naipe sai do papel de quem entregou, e o "tipo de trabalho" nunca existiu (01) | **Confere** | `git show bfa0940a:src/main/celular/ledger-port.ts`, linha 51 |
| 3 | A forma A ("a frente decide, o verso explica") foi escolhida pelo dono, com a mesa literal no `final.html` (01 §1.3) | **Confere** | `origin/proto/cartas`: `decisao.md` (Escolha, com a fala do dono); `final.html:206, 242, 452, 555-560`; `cartas-forma-a.md:8-40, 264-266` |
| 4 | "Mesa de tiragem" não aparece antes de 09/11 (01 §2) | **Confere.** A primeira ocorrência nos transcripts da VPS é de 09/11 15:43 UTC (sessão `837dacd3`); no git não há nenhuma. **Exagero corrigido:** o 01 dizia que o arrasto "dava o nome de 'tiragem'" à experiência, e isso não tem fonte | busca recursiva por `tiragem` nos jsonl; `git log --all -i --grep=tiragem` |
| 5 | A virada de 07/11: caixa de 7 tipos, só 4 abrem carta, tabela de 12 colunas, e o "Abrir as cartas" sumiu no merge (01 §3) | **Confere** | `inbox.ts:65, 86`; `LedgerTable.tsx:222-233`; `git show f54ee4db:…/OracleCenter.tsx` (linha 77 tem o botão) e `93e844b5` sem ele; PRs #304 e #306 mesclados às 23:45 e 23:48 UTC (`gh pr view`) |
| 6 | "A tela B não foi escolhida explicitamente pelo dono; a única fonte é o Líder" (01 resumo 7 e §5) | **Errado e corrigido.** O dono aceitou **"Tudo como recomendado"** em t-63186140 às 22:17 UTC de 07/11 (19:17 em Brasília), antes do merge. A frente dessa carta, porém, mostrava o **print da tela do PR #304**: "◆ 3 esperando você · Abrir as cartas" e a tabela. A caixa de 7 tipos aparecia só como número na prova de texto do verso ("34 itens… contra 3 da fila antiga") e no risco da opção ("A caixa começa cheia: 22 envios do Slack sem confirmação"). Na mesma fala de 482b1d27, o dono diz que "já havia respondido pro líder", no chat do PC, que não está nesta máquina | `tarefa_ver t-63186140`; `ledger_resumo.py`; transcript 482b1d27, 07/11 18:17:59 UTC |
| 7 | O celular não mostra carta de Slack (03 §2b) | **Errado e corrigido.** A carta de Slack nasce `entregue` e de risco `alto` (`contract.ts:966-967`), então passa em `waitsForOwner` (`contract.ts:1234-1236`) e aparece no celular. O celular não mostra só o estado de envio (carta parada e conferir envio) | código em staging |
| 8 | A caixa de hoje tem 115 itens: 75 órfãs, 17 conferir envio, 8 cartas aceitas não enviadas, 5 falhas de bot, 4 entregas paradas, 5 B e 1 A (03 resumo 6) | **Parcial.** As parcelas grandes conferem (75, 17, 8 e 4). A soma não fecha com o `esperandoDono: 9` citado no próprio 03: daria 118, e as 3 amostras não aparecem em parcela nenhuma. Às 16:12 UTC recalculei 119 sem contar as falhas de bot (12 decidir-entrega e 3 amostras). Anotei no arquivo sem trocar o número | recálculo da regra de `inbox.ts` sobre `tarefa_listar` + eventos `enviada` |
| 9 | O dono escolheu a recomendada em 123 de 137 cartas; tomou 190 decisões, das quais 13 rejeições em 12 tarefas; escreveu 25 comentários; nenhuma decisão pela opção "Outra" (03 e 02) | **Confere em tudo** | `todas.json` (decisao.opcao × opção recomendada); `ledger_resumo.py` |
| 10 | "11 vezes 'faça você'", a resposta que o dono mais escreveu (02 §3, 04 §2 e resumo 6) | **Exagero corrigido.** São 10 textos de devolução em 9 cartas. "Faz sem o OK do Fernando. Só dale" (t-c6964cbb) é uma **decisão**, e o Líder registrou "Decidida pelo dono por escrito na própria carta". "Faz vocÊ uai" foi gravado 2 vezes no mesmo minuto. A conclusão continua de pé: devolver a decisão é a resposta escrita mais comum | `ledger_resumo.py` (t-c6964cbb, t-e470c49f, t-25f4b31e) |

Também conferi as cartas do `03-cartas-reais.json`: t-d35cbf67, t-fd44bd79, t-32b82559, t-986d4613 e t-c8a843dd
existem como descritas, com a mesma pergunta, as mesmas opções, a mesma recomendada e o mesmo visual. O título no
JSON é o `paraODono.titulo`, não o título da tarefa, e é isso que a carta mostra. Duas anotações:
- **t-fd44bd79:** o JSON dizia "ABERTA", mas o estado é `entregue`. Ver o fato que faltava nº 2, abaixo.
- **t-32b82559 (04 §3.1, e o resumo dizia que "as variantes não aparecem lado a lado"):** é **exagero**. A prova
  1 da frente é um png-índice com as 6 variantes lado a lado e as recomendadas marcadas. Faltou outra coisa: as 6
  páginas navegáveis ficaram numa pasta do PC, o único html anexado era o índice, e nenhuma variante estava ligada
  a uma opção.

## O que faltava (acrescentei nos arquivos)

1. **O print aprovado não é a tela que entrou** (01). Está no item 6 acima. É a peça que mais explica a frase "se
   descaracterizou": o dono aprovou uma tela com "N esperando você · Abrir as cartas" sobre a tabela, e entrou uma
   caixa de 7 tipos em que a carta só abre pelo clique numa linha.
2. **Uma carta A está fora da mesa agora mesmo** (03 §5.1, 04 §6). t-fd44bd79 é uma pergunta que só o dono
   responde ("o que mudou?"), com prazo "segunda, 10h" (09/11 é segunda). Foi reentregue com **risco baixo** em
   09/11 02:21 UTC. Pela regra de `entrega-parada` (`inbox.ts:113`), só entra na caixa 24 h depois, já fora do
   prazo, e nunca entra no celular. Às 16:12 UTC não estava na caixa. Então o risco erra para os dois lados: 82 B
   chegaram como risco alto (03 §4.3), e esta A ficou de fora (a t-ce521745 também chegou por risco baixo).
3. **O andamento suja a carta** (01, linha do `055fcc2f`). O registro tem 188 eventos `⟦andamento⟧` em 47
   tarefas. Na t-d35cbf67, a única A aberta na caixa, os 5 andamentos gravados depois da entrega (04:02 a 07:07 UTC)
   falam de outros assuntos (`mencoes-escuta`, `swapMaximoPct`). Isto só descreve o problema e não propõe pôr
   andamento no Oráculo.
4. **O app em execução ainda exige a carta de Slack** (02 §2.8). As instruções do MCP `donel` que esta sessão
   recebeu em 09/11 dizem "SEMPRE antes uma carta_slack (…) sem ela o envio é bloqueado". Esse texto saiu do código
   em `6efde239` (09/11 12:09), segundo `git log --all -S`. Enquanto o app não for atualizado, as sessões continuam
   abrindo carta de Slack, que é a maior fonte de ruído B.

## Conciliações

- **170 × 179 blocos (02 × 04).** O `tarefa_listar` traz só o `paraODono` da última entrega, e o 02 contou por
  entrega. Às 16:12 UTC eram 171 tarefas com bloco: 55 checagens, 49 prova, 1 antes-depois e 66 sem visual; opções
  112/56/3. Isso confere com o 04. Não provei as 179 porque não abri o `ledger.json`.
- **462 × 466 × 472/473 tarefas.** São horas diferentes do mesmo registro, e não há erro.
- **t-c6964cbb** está classificada como B no 03, mas é um caso de borda A: é uma autorização sobre um colega.
  Anotei e mantive a contagem.

## O que não verifiquei

- A classificação A–E item a item do 03 (296 linhas). Conferi só a consistência interna: 44+131+30+88+3 = 296, sem
  id repetido, e as linhas da tabela por porta de entrada somam o que dizem.
- A mediana de espera das A (0,75 h) e os números por quadro.
- Os prints de `prints-antigos/` e `prints-hoje/`: existem, mas não os comparei com o código.
- A afirmação do 02 §6 de que um push de "Entrega parada" não acha a carta no celular. Ela vem só da leitura do
  código, e eu não reli `app.js:1093-1103`.
- O que o dono respondeu ao Líder no chat do PC sobre o Ledger v5 ("já havia respondido pro líder").
