# Relatório de melhoria — sessão de 04/08/2026 (fase Plano da etapa 3 + liberação do gate da 010)

Sessão disparada pelo Modo Dev (`run-46e7a3e6-4ac`, plano
`pln-registry-providers-classe-a`): rodou a fase Plano da etapa 3 da 011
(registry de providers classe A) via subagente opus/high, gravou o result no
outbox, verificou a colisão de clarifications com o run irmão da etapa 2 e,
na sequência, registrou a confirmação humana do gate da 010 nos gates
T1201/T1301. Sucede `relatorio-melhoria-sessao-2026-08-04-plano-etapa-2.md` —
a numeração de achados continua de lá (P14+), com três reincidências marcadas.

## O que a sessão produziu

- Plano da etapa 3 commitado (`ceafd0d`): subpasta própria
  `registry-classe-a/` com `plan.md`, `tasks.md` (T1301–T1326), `research.md`,
  `data-model.md` e `contracts/provider-registry.md`; clarifications C13–C22
  na spec; lições em `tasks/lessons.md` — sem tocar em nenhum artefato da
  etapa 1. Analyze com 8 achados (3 HIGH), todos resolvidos na própria fase
  (destaque: spike-gate T1302 valida a premissa OpenRouter × Messages API
  antes de qualquer UI).
- Result do run no outbox (`outbox/run-46e7a3e6-4ac.json`):
  `phase.completed: done` + `lock.released` + alerta operacional do run irmão.
- Verificação pós-corrida da colisão de clarifications: a etapa 2 leu as
  C13–C22 já commitadas e continuou em C23–C34 — sequência C1–C34 íntegra,
  nada a reconciliar.
- Confirmação humana do gate da 010 registrada (`9a250d7`): notas datadas nos
  gates T1201 e T1301 dizendo que a condição "batches da 010 fechados em
  staging" está satisfeita (7/7 integrados, verificado por `merge-base`),
  sem marcar as caixas — a condição "etapa 1 mergeada" segue pendente.
  Memória do projeto atualizada com o mesmo recorte (liberação de gate ≠
  promoção).

## Falhas de processo do agente (e correções)

### 1. Repeti o P7 com o aviso commitado DUAS sessões atrás
Gravei o result da etapa 3 sem `work_item.recorded`, espelhando a forma do
result da etapa 1 — exatamente o que o relatório da fase Plano (P7) previu
("etapas 2 e 3 estão nesse estado agora") e o que o relatório da etapa 2
(falha 1) já tinha confessado repetir. Terceiro result de Plano no mesmo
estado, segundo com aviso prévio em `docs/`. A correção adotada pela sessão
da etapa 2 ("relatórios de melhoria anteriores entram nas fontes consultadas
antes de gravar result") não chegou a esta sessão porque vive num relatório
que eu não li — o mesmo loop. **Correção adotada (agora com gatilho
mecânico):** antes de gravar qualquer result no outbox, `ls docs/relatorio-*`
e ler os do mesmo fluxo é passo obrigatório do cockpit, no mesmo nível do
preflight — não uma lição a lembrar, um comando a rodar.

### 2. Alerta virou parágrafo, não decisão — o dono teve que cobrar a pergunta
O alerta da colisão com o run irmão saiu no report final como aviso ("vale
conferir"), sem transformar em decisão acionável. O dono precisou perguntar
"nenhuma pergunta pra mim?" para a sessão formular o que já sabia: alguém
precisa conferir a numeração quando o run irmão terminar. Reincidência de
espírito da memória `feedback_uma_pergunta_por_vez` (decisão enterrada em
relatório). **Correção adotada:** todo alerta operacional que implica uma
ação futura fecha com a pergunta de quem faz — no fim da mensagem, destacada.

### Nota positiva — gates compostos tratados como compostos
O "sim" do dono liberava só a metade "010" dos gates T1201/T1301 (a metade
"etapa 1 mergeada" não existe ainda). A sessão não marcou as caixas: registrou
a confirmação parcial, datada, por condição — e apontou na memória que isso
não autoriza promoção. É o comportamento certo, mas está sustentado só em
disciplina de sessão (ver P14).

## Achados de produto (para a 010 e adjacências)

### P14 — Confirmação de gate não tem representação no store
A liberação do gate da 010 — um fato de processo com dono, data e alcance
("vale para a 011, não é promoção") — só existe como blockquote em dois
`tasks.md` e uma nota de memória de sessão. O store da 010, cujo princípio é
"fato com dono, hora e sessão", não tem tipo de evento para isso; a fase
Implementar vai reler a confirmação de um markdown, não do registro. Pior: o
gate é composto e a confirmação chegou pela metade — nada no modelo expressa
"condição (a) satisfeita, (b) pendente". **Recomendação:** tipo de fato
`gate.confirmed` (ou similar) com `subject`, `condition` e `confirmed_by`,
emitível de qualquer sessão-cockpit — os gates das specs viram consultas ao
store em vez de blockquotes.

### P11 (reincidência, lado B) — o paralelismo só não conflitou por vigilância dupla
Esta sessão foi o outro lado do P11: commitou C13–C22 enquanto a etapa 2
escrevia. Não houve conflito porque (1) o subagente desta fase notou os
untracked do irmão e alertou no summary, e (2) o analyze da etapa 2 detectou
e renumerou. Duas salvaguardas, ambas por disciplina de prompt, nenhuma por
contrato — o dispatch continua sem serializar runs de mesmo
`target_repo`+branch. A recomendação do P11 segue de pé, agora com o caso
completo documentado dos dois lados.

### P7 (reincidência, 3º caso) — result de Plano sem work item
O result da etapa 3 saiu sem `work_item.recorded` (ver falha 1). **Ação
pendente concreta (herdada e ampliada):** declarar os work items das etapas
2 E 3 antes de qualquer disparo de Implementar delas — e a recomendação
original (contrato exigir, ou skill instruir) já custou três casos.

### P5 (reincidência, 4º caso) — skill 2.1.0 do plugin para input 3.0
De novo: `esteira-plano` 2.1.0 (fluxo TaskDex) invocada para um `run-input`
do contrato esteira-donel 3.0. A sessão descartou os passos TaskDex e seguiu
o input — quarto caso em quatro runs. O improviso é o fluxo oficial não
escrito; cada sessão nova o redescobre por conta.

### P15 — O gate "batches fecharam em staging" não era consultável, era uma pergunta
Para responder "a 010 está fechada?", a sessão rodou `merge-base` na mão
sobre 7 branches — informação que o app tem (as fases da fila da 010 estão
`✅` no vault e no store do alfa) mas não expõe como resposta. O dono
perguntou "o que raios é a 010 e o que significa ela ser finalizada" DEPOIS
de dois planos inteiros citarem o gate como bloqueante — sinal de que o gate
viajou como texto de task, nunca como estado visível. **Recomendação:** gate
citado em task/spec deveria apontar para algo verificável no app (a fila da
010, o próprio store) em vez de exigir arqueologia git de quem revisa.

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P7 work items das etapas 2 e 3 (3º caso) | baixo | Implementar trava de novo, agora previsto três vezes |
| 2 | P14 confirmação de gate fora do store | baixo | Implementar relê o gate de um blockquote; meia-confirmação vira confirmação inteira |
| 3 | P11 dispatch paralelo (caso completo) | baixo | próximo par simultâneo não terá as duas vigilâncias de sorte |
| 4 | P5 roteamento da skill (4º caso) | baixo | cada sessão re-improvisa o contrato 3.0 |
| 5 | P15 gate como texto, não como estado | médio | revisor decide gate por arqueologia git |
