# Relatório de melhoria — sessão de 04/08/2026 (fase Plano da etapa 2 + revisão A9)

Sessão disparada pelo Modo Dev (`run-c439024b-76d`, plano
`pln-demolicao-perfis-migracao`): rodou a fase Plano da etapa 2 da 011
(demolição dos perfis + migração assistida) via subagente opus/high, gravou o
result no outbox e, na sequência, aplicou a decisão do dono sobre o achado A9
(o botão de reiniciar morre junto da cópia). Sucede
`relatorio-melhoria-sessao-2026-08-04-fase-plano.md` — a numeração de achados
continua de lá (P11+), com três reincidências marcadas.

## O que a sessão produziu

- Plano da etapa 2 commitado (`a295530`): `plan-etapa-2.md`,
  `tasks-etapa-2.md` (T1201–T1232), `research-etapa-2.md`,
  `data-model-etapa-2.md`, `contracts/migration-etapa-2.md`, clarifications
  C23–C34 na spec e 4 lições em `tasks/lessons.md` — sem tocar em nenhum
  artefato da etapa 1. Analyze com 10 achados (3 HIGH), todos resolvidos na
  própria fase.
- Result do run no outbox (`outbox/run-c439024b-76d.json`):
  `phase.completed: done` + `lock.released`.
- Decisão da revisão aplicada e commitada (`f2b1b3a`): C31 vira "o fluxo de
  reinício morre inteiro" (botão, diálogo, estado, cópia e os 2 smokes de
  restart); contagem de suítes mortas corrigida de 7 para 9 em C34, T1226 e
  T1232; `restart-session*` removido da lista de suítes "ajustadas" da T1227
  (estava nas duas listas — contradição que só apareceu ao aplicar a decisão).

## Falhas de processo do agente (e correções)

### 1. Não li os relatórios de melhoria do próprio dia antes de gravar o result
O repo já carregava o relatório da sessão anterior dizendo, em P7, que os
results de Plano saem sem `work_item.recorded` e que "etapas 2 e 3 estão nesse
estado agora" — e eu gravei o result da etapa 2 exatamente nesse estado,
repetindo o defeito com o aviso commitado a três commits de distância. A
consulta de lições (Passo 5.5) foi feita para o CONTEÚDO do plano
(lessons.md, mapa, CLAUDE.md), mas não cobriu `docs/relatorio-*.md`, que é
onde vivem os achados de PROCESSO da esteira. **Correção adotada:** em run de
fase, os relatórios de melhoria anteriores do mesmo fluxo entram na lista de
fontes consultadas antes de gravar qualquer result.

### 2. Improvisei a forma do result de Plano a partir de um exemplo de Discovery
Não existia nenhum result de fase Plano no outbox para copiar (ver P12) e o
contrato não documenta o conjunto de fatos esperado por fase. Espelhei a forma
dos results de Discovery (`phase.completed` + `lock.released`) — que a
ingestão aceita, mas que deixa de fora o work item (P7). Funcionou por sorte
de o mínimo ser suficiente; a forma correta continua sem fonte canônica.

## Achados de produto (para a 010 e adjacências)

### P11 — Dispatcher paralelizou duas fases Plano sobre o mesmo arquivo
Os runs das etapas 2 e 3 rodaram simultâneos e ambos fazem append de
clarifications em `spec.md`. A etapa 3 commitou C13–C22 (`ceafd0d`) enquanto
o subagente da etapa 2 escrevia as dele — a colisão de numeração só não virou
conflito porque o analyze da etapa 2 a detectou (A16) e renumerou para
C23–C34. O princípio da própria 010 ("rodar duas fases em paralelo recria o
desencontro de contrato") foi violado pelo dispatch: os planos são
independentes em escopo, mas compartilham a spec como artefato de escrita.
**Recomendação:** ou o dispatch serializa runs que declaram o mesmo
`target_repo`+branch, ou o contrato de Plano reserva faixas de numeração por
plano antes do disparo.

### P12 — Result de Plano da etapa 1 nunca chegou ao outbox
`run-391279ba-5fe` (Plano da etapa 1) tem manifesto em `.esteira/` e commit
`6d3ba15`, mas nenhum arquivo no outbox — a sessão daquela fase terminou sem
o passo final. Consequências: o lock daquele run pode seguir vivo no store, e
foi essa ausência que me obrigou a improvisar a forma do result (falha 2).
**Recomendação:** o watcher (ou o próprio app) reconciliar manifesto em
`.esteira/plano/handoffs/` sem result correspondente no outbox — é detectável
mecanicamente e hoje só um humano nota.

### P7 (reincidência, 2º caso) — result de Plano sem work item
O result da etapa 2 saiu sem `work_item.recorded`, igual aos três do dia
anterior — agora com o agravante da falha 1 (o aviso já estava commitado).
O Implementar da etapa 2 vai travar do mesmo jeito que o da etapa 1 travou.
**Ação pendente concreta:** declarar os work items das etapas 2 e 3 (o da
etapa 1 foi corrigido a mão na sessão anterior) — e a recomendação original
do P7 (contrato exigir, ou skill instruir) sobe mais um degrau de prioridade.

### P5 (reincidência, 3º caso) — skill 2.1.0 do plugin para input 3.0
De novo: o disparo invocou `esteira-plano` 2.1.0 (fluxo TaskDex) para um
`run-input` do contrato esteira-donel 3.0. A sessão descartou os passos
TaskDex e seguiu o contrato do input — terceiro caso em três runs; o
improviso já é o caminho normal, o que é a definição de dívida de processo.

### P13 — O limiar entre `success` e `needs_attention` premiou o caminho certo
Nota positiva com aresta: o subagente resolveu A9 de forma conservadora,
reportou `success` e NOMEOU o item como "remoção de comportamento de entrega
anterior, para o olho do dono" — e a revisão humana de fato mudou a decisão
(o botão morreu). O mecanismo funcionou, mas por disciplina de prompt, não
por contrato: nada obriga um achado desse tipo a aparecer no result. **
Recomendação:** o contrato de Plano ganhar um campo estruturado de "itens
para revisão humana" (o A9 viajou dentro de `summary`, texto corrido), para
o app poder exibi-los como checklist da revisão da fase.

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P7 work item ausente (2º caso, com aviso prévio) | baixo | Implementar das etapas 2 e 3 trava de novo |
| 2 | P11 dispatch paralelo sobre a mesma spec | baixo | próximo par de runs simultâneos conflita de verdade |
| 3 | P12 manifesto sem result no outbox | baixo | lock órfão + toda fase seguinte improvisa a forma |
| 4 | P5 roteamento da skill (3º caso) | baixo | o improviso virou o fluxo oficial não escrito |
| 5 | P13 itens de revisão fora do contrato | médio | o próximo A9 passa despercebido dentro de um summary |
