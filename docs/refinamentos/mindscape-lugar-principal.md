---
demanda: mindscape-lugar-principal
plano: docs/planos/mindscape-lugar-principal.pda.md
data: 2026-10-31
taskdex: []  # ferramenta pessoal, sem card
autor: Claude por delegação de Alexandre Lentz
status: aprovado
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-31
---

# Refinamento — Mindscape como lugar principal (fatia de 31/10)

## O que existe hoje

Medido no `mindscape.json` do dono e no código em 31/10:

- **Regra 11 da V1:** sessão sem aba aberta não é desenhada. A posição do cartão fica guardada;
  o post-it escrito pela sessão fica solto. Por isso o quadro do Donel Dev mostrava 1 sessão e
  8 post-its: são 10 cartões de sessão guardados e só 1 aba aberta.
- Somando os 8 quadros, ~44 post-its escritos por sessões já fechadas (BizOps 12, Homologação 11,
  Donel Dev 8, teamzone 6...). Nada sai sozinho.
- Metade dos nomes é só o nome do projeto ("Donel Dev", "BizOps"): o nome que a aba tinha.
- **Favorita** já existe: a sessão **fixada** do grupo Favoritos da barra lateral (007),
  `sessionRegistry[id].pinned`, sem teto (C4). O registro só guarda sessões de projetos
  favoritados (5 recentes + todas as fixadas).
- Retomar já existe: `-r <id>` numa aba nova (`handleFocusOrResumeFavoriteSession` foca a aba se
  ela já estiver aberta).

## Regras de negócio fechadas

1. **Toda sessão do quadro aparece.** Aberta (com aba) = cartão vivo, como hoje. Fechada =
   cartão **adormecido**. Revoga a regra 11 da V1 para cartões de sessão (o post-it da sessão
   continua sendo desenhado como era).
2. **Data de uma sessão fechada** = a mais recente entre o post-it que ela escreveu
   (`writtenAt`) e a última atividade no registro da 007 (`lastActivityAt`). Sem nenhuma das
   duas, a data é desconhecida.
3. **Antigas ficam recolhidas.** Fechada há mais de 7 dias, ou sem data, é **antiga**: o cartão
   e o post-it dela não são desenhados. A barra mostra "N antigas"; clicar mostra ou recolhe
   (estado de tela, não salvo). Sessão aberta nunca é antiga.
4. **Cartão adormecido:** mesmo selo "SESSÃO" e nome; glifo `☾`; linha de estado "Fechada ·
   31/10 13:06" (ou só "Fechada"); apagado. Nome: o da aba (`sessionNames`), senão o que o
   post-it guardou, senão o rótulo do registro, senão "Sessão".
5. **Retomar:** duplo clique (ou Enter) no adormecido retoma com `-r <id>` numa aba nova do
   projeto do quadro e volta ao Uso geral com ela em foco. Se já houver aba com a sessão, só
   foca (nunca abre a mesma sessão duas vezes). O cartão continua no mesmo lugar e acorda.
6. **Favorita fixa:** sessão `pinned` no registro ganha `★` no cartão (vivo ou adormecido),
   nunca é antiga e o Organizar não a move nem move o post-it dela. Favoritar continua na barra
   lateral nesta fatia; o teto continua não existindo.
7. **Organizar** (botão na barra do quadro): arruma num gesto só, que o Ctrl+Z desfaz. Move os
   cartões de sessão desenhados que não são favoritos, cada um com o seu post-it logo abaixo.
   Colunas, da esquerda para a direita:
   - **Precisa de você:** `permission`, `error`, ou turno terminado que o dono ainda não viu
     (o destaque da V1);
   - **Trabalhando:** `working`;
   - **Em espera:** o resto das abertas;
   - **Fechadas:** adormecidas, da mais recente para a mais antiga.
   Coluna vazia não ocupa espaço. O grupo começa no canto de cima à esquerda do que ele move.
   Post-its do dono, desenhos, prints e ligações não se mexem (as ligações acompanham os
   cartões).
8. **Arquivar continua igual** para o post-it da sessão e o do dono. O cartão de sessão não se
   arquiva nesta fatia.
9. **Diário de gestos (exemplos para a Laya):** o app grava, só na máquina, um evento por linha
   em `<userData>/aprendizado/gestos-AAAA-MM.jsonl` (um arquivo por mês, nunca apagado pelo app).
   Nada sai da máquina. Sem tela nesta fatia.
10. **Eventos gravados:**
    - `turno-terminou`: sessão, texto do post-it escrito (até 4.000 caracteres) e hora;
    - `pedido-enviado`: sessão, hora e o tamanho do pedido (o texto do pedido não);
    - `sessao-aberta`: sessão, hora e por onde (`aba`, `mindscape`, `retomar`);
    - `mindscape`: ação (`organizar`, `arquivar`, `mostrar-antigas`), projeto e o cartão quando
      houver.
11. **O diário nunca atrapalha:** falha de escrita é engolida e registrada no log; o main é o
    único escritor; o renderer só manda eventos validados.
12. **UI em pt-BR, sem a palavra "Claude"** em rótulo de recurso do app (memória `llm-agnostico`).

## Unknowns decididos

- 7 dias para "antiga": mesma janela que a faxina usa para scratchpads; ajusta-se fácil.
- Colunas sem cabeçalho desenhado: o cartão já mostra o estado; cabeçalho seria cartão novo no
  modelo (sobe o `schemaVersion`) sem ganho proporcional.
- Diário sem chave de liga/desliga nesta fatia: os dados são do dono e ficam no `userData` dele,
  como o `mindscape.json`. Chave entra quando houver tela (evita chave de config que um canal
  antigo derrubaria).

## Fatia de hoje

- **F1 — Sessões adormecidas e retomar** (regras 1–6).
- **F2 — Organizar** (regra 7).
- **F3 — Diário de gestos** (regras 9–11).

## Depois

- Nome pelo primeiro pedido da conversa quando o nome é só o do projeto.
- Favoritar e desfavoritar direto no quadro; favorita de projeto não favoritado.
- Barra lateral recolhida por padrão quando o Mindscape cobrir favoritas e recentes.
- Agente do Mindscape com motor escolhido pelo dono (B34 Parte 2), wiki (B31), rótulos e treino
  da Laya (B35).
- Achados da pesquisa do Slack que viram item próprio ([pesquisa](../pesquisas/slack-bill-eua-2026-10.md)).
