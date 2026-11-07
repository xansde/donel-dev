# Ledger (Oráculo Harrow): diagnóstico com prova (07/11/2026)

Pedido do dono (07/11): "o ledger está uma bosta. Quero ele em padrão top de linha". Esta é a pesquisa de diagnóstico,
uma das quatro da tarefa t-921337a4.

**Fontes.** Código de `origin/staging` em `1a5f829`, PR #260 (`feature/oraculo-espelho`, aberto) e um `tarefa_listar`
com `todos:true, situacao:todas` tirado em 07/11 às ~13h, com **270 tarefas** do app que roda no PC. Esse app é mais
antigo que o staging, porque a faixa dele ainda não tem o contador `esperandoEnvio` do PR #277. O
`ronda-self-healing-2026-11-07.md` do Curador não está nesta máquina. As dores dele aparecem nas próprias tarefas que ele
registrou (t-81e27aac, t-01d34053, t-2006c0ba, t-1b68a555), e eu as li. **[S]** marca o que é suposição; o resto foi lido.

## Resumo

O ledger tem regras boas: não há entrega sem prova, quem entrega não aceita e o risco alto fica só com o dono. O que
falha é o modelo por baixo, em três pontos:

1. **A tarefa pertence a uma sessão, que é efêmera.** Quando a sessão fecha, a tarefa fica órfã.
2. **O dono vê uma fila só**, a dos itens entregues de risco alto. Tudo o que não cabe nela some da vista dele.
3. **Os fatos novos foram enfiados em campos velhos**, para não subir o schema por causa do Alfa 0.4.0. Com isso,
   "cancelada" quer dizer três coisas e "aceita" às vezes quer dizer "falhou".

Recomendação: refazer o modelo antes de polir a tela. A dona da tarefa passa a ser uma pessoa ou um papel, com a
sessão como executora. Também entram um pedido-pai com subtarefas e estados próprios para envio e cancelamento. O
congelamento do v4 sai por decisão explícita.

## Modelo atual

- **Arquivo:** `<userData>/ledger.json`, que só o main grava (`ledger-store.ts:162`, temp e depois rename). O arquivo
  é compartilhado por alfa, beta e stable. Cada gravação faz ler, aplicar e escrever, **sem trava entre processos**.
  Com duas instâncias abertas, a última gravação vence. **[S]** Isso não foi medido.
- **Tarefa** (`contract.ts:153`): pedido literal, critério, prazo, `ownerPlaceId` (o id do lugar), risco, estado,
  eventos e `slack?`. Não há campo para o autor humano do pedido, para tarefa-pai nem para chave de idempotência.
- **Estados** (`contract.ts:42`): aberta → em-execucao → entregue → aceita ou rejeitada, e rejeitada volta a
  em-execucao. Por cima disso, os fatos novos viajam como **marcas no texto** `⟦…⟧` (`contract.ts:264-271`):
  - cancelar grava `rejeitada` com a marca `⟦cancelada⟧`;
  - transferir grava um evento `criada`;
  - o registro de envio pelo bot nasce `aceita` sem decisão (`:812`);
  - a carta de Slack nasce `entregue` (`:739`).
- **Quem pode o quê:**
  - assumir e entregar: só o lugar dono (`:501`, `:512`);
  - decidir: o dono, ou o Revisor quando o risco é baixo (`cannotDecide`, `:432-438`);
  - transferir: dono, lugar dono ou Líder (`:581`);
  - cancelar: dono, lugar dono ou Líder. **O Curador não pode** (`:593`; t-1b68a555: "A ferramenta recusou o
    cancelamento para o Curador");
  - Líder, Curador e Pesquisa não podem ser donos da tarefa que registram (`:366`, `:459`).
- **O que o dono vê:**
  - Oráculo (`OracleCenter.tsx`) e celular (`ledger-port.ts:172`) mostram **só** a `ownerQueue`, ou seja,
    `waitsForOwner`: entregue com risco alto, mais a amostra diária do Revisor (`contract.ts:983`);
  - não há histórico, busca, lista do que saiu para o Slack nem caixa de "minhas decisões abertas";
  - o Supabase (PR #260) segue aberto: foi rejeitado por conflito e o lugar dono fechou (t-50930a1d, órfã).

## As dores, com causa e frequência

Os números vêm do snapshot de 270 tarefas.

| Dor | Causa no código | Frequência |
|---|---|---|
| **Órfãs** | A dona é a sessão (`contract.ts:166`). `ownerGone` (`ledger-store.ts:296`) só **detecta**. A passagem automática (`passOnTasks`) só roda quando um lugar fecha e **pula cartas** (`ledger-store.ts:336`). A faxina noturna espera 24 h (`faxina.ts`, `ORPHAN_AGE_MS`). | **36 órfãs agora (13%)**, sendo 35 com o lugar fechado. Em 06/11 eram **102** (critério da t-1b68a555). **5 das órfãs são justamente as tarefas de conserto do Oráculo** que o Curador registrou com ele mesmo como dono provisório (t-81e27aac, t-01d34053, t-2006c0ba, t-cce40c2f, t-df3e4d08). |
| **"Cadê as mensagens do Slack?"** | O "Esperando você" conta só entregue com risco alto (`contract.ts:983`). Ficam de fora: decisões registradas como `aberta`, cartas aceitas e não enviadas, envios pelo bot (nascem `aceita`, `:812`) e entregas de risco baixo à espera de um Revisor. | A faixa mostra `esperandoDono: 0` enquanto há **53 abertas de risco alto**, **7 cartas aceitas e nunca enviadas** (t-dab38f1d, t-c57d087b, t-665e90f9, t-1ddd84bf, t-ca7a7cab, t-bb8d7caa, t-8d1d9fe5) e **8 entregues de risco baixo sem decisão**. |
| **Cartas presas** | Só a sessão autora envia. Carta não se transfere (`contract.ts:575`) nem passa adiante (`ledger-store.ts:336`). Se a sessão fecha, ninguém envia. | 7 de 30 cartas aceitas (23%). |
| **Envio que "saiu" sem saber se chegou** | Resposta sem sinal claro vira `sem-confirmacao` e a carta conta como gasta (`ledger-store.ts:833`). Não fica guardado o link da mensagem. | **17 de 23 envios (74%)** estão "sem confirmação". Só 6 foram confirmados. |
| **Falha marcada como aceita** | O registro do bot nasce `aceita` qualquer que seja o resultado (`contract.ts:812`). | 5 de 22 registros do bot dizem "o envio falhou: fetch failed" e estão aceitos e fechados. |
| **Duplicatas** | Não há idempotência em `criar` nem em `carta-slack` (`:453`, `:724`). O reenvio após "sem confirmação" exige carta nova. Não existe tarefa-pai, então um pedido vira N tarefas com o mesmo texto. | Cartas: o status do Retiro saiu em 3 versões, e o item 6 do WhatsApp em 2, as duas enviadas (t-fe70c392 e t-9d620a93, "Reenvio… falhou na rede"). Tarefas: o mesmo pedido literal aparece **5×, 5×, 4× e 3×**. 75 tarefas (28%) **não têm título**. |
| **"Péssima prova. De nada vale"** | `validProof` (`contract.ts:944`) checa só a forma: texto não vazio ou link http. Nada liga a prova ao critério, ao aparelho ou ao sintoma relatado. O Revisor aceita risco baixo sozinho (`:436-437`). | 23 tarefas aceitas têm **só texto** como prova. **13%** das aceitas foram validadas sem o dono. A t-efeb0ca3 e a t-4604624e foram aceitas por Revisores e rejeitadas pelo dono horas depois. A t-3b8b9422 foi entregue duas vezes dizendo "Faltam…". |
| **"Quem pediu: Dev"** | O espelho põe em `quem_pediu` o **autor do evento `criada`**, isto é, a sessão que chamou `tarefa_criar`, e não quem disse a frase (PR #260, `mirror.ts:145`). O nome do lugar só existe enquanto o card da sessão está no quadro (`index.ts:3083`). Sem ele, sobra o papel (`labels.ts:36-41`). | Atinge todas as linhas cujo criador é uma sessão já fechada, o que é a maioria **[S]**. O modelo não tem campo para a pessoa que pediu (dono, Bill, Marta…). |
| **"Cancelada" que na verdade foi feita** | Cancelar é o único jeito de fechar sem aceite. A faxina fecha trabalho concluído como `cancelada` com o texto "concluída: PR #n" (`faxina.ts:5-6`, `:71`). As decisões aparecem como "por: lider" mesmo quando foi o Curador quem decidiu. | **12 das 28 canceladas foram concluídas ou enviadas**, por exemplo "Enviada: … o registro de envio não foi gravado". Outras 7 foram substituídas. |
| **Congelamento do v4** | O `LEDGER_SCHEMA_VERSION` ficou em 4 para o Alfa 0.4.0 continuar gravando (`contract.ts:27-40`). Daí vêm as marcas no texto e a carta com arquivo que um app v4 apaga (`:113-119`). | É estrutural: todo fato novo desde 06/11 entra pela gambiarra. |

## O que falta para ficar top de linha

Estas são lacunas que o diagnóstico mostra; a referência externa fica com as outras pesquisas.

1. Dona da tarefa é uma pessoa ou um papel durável. A sessão é só quem executa e pode ser trocada sem transferência
   manual.
2. Campo `pedidoPor`, com a pessoa e o canal de origem, separado de `registradaPor`.
3. Tarefa-pai com subtarefas, para que um pedido não vire N cópias sem título. Título obrigatório.
4. Chave de idempotência em criar, carta e envio, para que reenviar não duplique.
5. Estados de verdade: `cancelada`, `concluida-sem-aceite`, `enviando`, `enviada(link)` e `falhou`, em vez de
   marcas no texto. Para isso, subir o schema e aposentar o v4 de propósito.
6. Envio com recibo: guardar o link e o `ts` da mensagem. "Sem confirmação" vira estado pendente com verificação
   posterior, e não "gasta".
7. Carta aceita pode ser enviada pelo app ou por qualquer lugar com Slack, e não só pela sessão autora.
8. A visão do dono cobre tudo o que espera por ele: decisões abertas, cartas para enviar, entregas paradas,
   histórico e busca. O mesmo vale para o celular e o Supabase.
9. Prova ligada ao critério: cada item do "pronto quando" vira um checklist que a entrega marca com evidência, e o
   Revisor rejeita prova que não reproduz a frase do dono.
10. Gravação segura entre processos: trava de arquivo ou um único dono do arquivo entre os canais. Nenhum canal
    antigo pode apagar campo novo.
