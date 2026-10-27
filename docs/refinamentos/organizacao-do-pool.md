---
tema: organizacao-do-pool
plano: docs/planos/pool-contas.pda.md
item: 02 — Regras da organização do pool
data: 2026-10-27
taskdex: []  # URLs dos cards do TaskDex (registro de uso)
status: fechado  # em-sabatina | fechado
participantes: [Alexandre, Claude]  # quem respondeu pela demanda
---

# Refinamento — Organização do pool de contas

## Demanda

Regras de grupo, prioridade, ordem e "uso disponível" do pool de contas do mod local, para operar dezenas de contas — item 02 do [PDA pool-contas](../planos/pool-contas.pda.md). Fatos de partida nas Notas do plano (auto-switch, sanitize, carga).

## Regras de negócio fechadas

<!-- Uma regra por bullet, na linguagem do glossário. Regra = comportamento decidido
     pelo humano nesta sabatina. -->

- Uma conta pertence a um grupo só por vez.
- Grupo é **priorizado** ou não; não há ordem entre grupos. A troca automática circula entre as contas de **todos** os
  grupos priorizados até eles esgotarem por completo; só então migra para os grupos não priorizados.
- Dentro de cada grupo, a lista mostra primeiro a conta com mais folga.
- **Folga** é a quantidade estimada de tokens que a conta ainda pode gastar, calculada a partir do % usado na janela de
  5h e na semanal. Estimativa não exata é aceita. (Contas do dono: todas Max 20x.)
- Grupos são recolhíveis.
- A troca manual continua livre para qualquer conta de qualquer grupo, e a troca automática continua podendo ser ligada
  ou desligada, como hoje.
- Não há reordenação manual de contas: a ordem é sempre a padrão (mais folga primeiro, dentro do grupo).
- Estando numa conta não priorizada, a troca automática só volta para um grupo priorizado quando a conta atual esgotar.
- A estimativa de tokens da folga é **aprendida do uso do próprio dono**: o app registra amostras (consumo × % de 5h e
  da semana) e calibra a partir delas. Não confiar em número publicado na internet — os limites mudaram recentemente.
- Sem nenhum grupo priorizado, a troca automática olha todas as contas, como hoje.
- "Sem grupo" conta como grupo não priorizado.
- Apagar um grupo manda as contas dele para "Sem grupo"; nenhuma conta é apagada.
- Conta esgotada aparece no fim do grupo, esmaecida, e continua clicável.
- Cabeçalho do grupo: nome, marca de priorizado, quantas contas têm folga e a folga somada; há busca pelo rótulo da conta.
- Criar, renomear e apagar grupo, e mover conta entre grupos, ficam na tela de contas (arrastar ou menu da conta).
- A troca automática escolhe sempre a conta de **mais folga** entre as elegíveis (a do topo da lista) — substitui o
  sorteio de duas de hoje.
- Ordem dos grupos na tela: priorizados primeiro, depois os demais, alfabética dentro de cada parte; "Sem grupo" sempre
  por último.
- A calibração da estimativa de tokens é **por conta**.

## Unknowns decididos

<!-- Decisões que o agente de código assumiria sozinho. Registre a suposição que
     seria feita E a decisão do humano — o delta é o valor. -->

- Assumiria: grupos em ordem de prioridade (cascata) → Decidido: prioridade é marca, não ordem; os priorizados formam um
  conjunto só.
- Assumiria: folga em % (100 − carga geral) → Decidido: folga em tokens estimados, calibrada pelo uso real.
- Assumiria: tabela de limites por plano tirada de estimativa pública → Decidido: não confiar na internet; calibrar.
- Assumiria: reordenação manual como alternativa → Decidido: só a ordem padrão.
- Assumiria: calibração por plano, compartilhada entre contas → Decidido: por conta.
- Assumiria: enquanto a calibração não tem amostras suficientes, a tela mostra o % como hoje → Decidido: aceito no
  fechamento (27/10).

## ADRs gerados

<!-- Só as decisões que passaram no critério triplo (difícil de reverter +
     surpreendente + trade-off real). -->

- [NNN — <título>](../adr/NNN-<slug>.md)

## Termos do glossário

<!-- Termos adicionados/atualizados em docs/glossario.md nesta sabatina. -->

- Carga (novo)
- Folga (novo) — substitui "créditos"
- Grupo priorizado (novo)

## Ficou aberto

- Fórmula da estimativa de tokens (quais tokens contam, quantas amostras bastam, como tratar a troca de modelo) →
  `/arquitetura`, porque é desenho técnico, não regra.
- Se as amostras de calibração viajam entre os dois PCs → item 04 do plano (sincronização).
