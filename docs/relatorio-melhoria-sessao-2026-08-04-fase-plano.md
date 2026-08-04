# Relatório de melhoria — sessão de 04/08/2026 (fase Plano duplicada + destrave do Implementar)

Sessão curta: começou como um disparo de fase Plano vindo do Modo Dev
(`run-24fcaa1b-c26`, plano `pln-motor-contas-mods`) e terminou como
diagnóstico de por que o dono não conseguia abrir as tasks da etapa 1 para
implementar. Sucede o relatório `relatorio-melhoria-sessao-2026-08-04.md`
(discovery) — numeração de achados de produto continua de lá (P7+), e duas
reincidências de achados anteriores estão marcadas.

## O que a sessão produziu

- Resultado formal do run duplicado de Plano (`outbox/run-24fcaa1b-c26.json`):
  `lock.released` + `phase.completed: done` declarando a duplicação, sem
  re-executar nada.
- Diagnóstico e correção do bloqueio real: o complemento
  `run-20260804-wi-etapa1.json` (que declara o work item
  `wi-011-etapa1-motor-mods`) tinha sido **rejeitado pela ingestão** por
  faltar o fato `phase.completed`. Corrigido o arquivo; o watcher do outbox
  re-ingeriu sozinho e `work_item.created` + `relation.added` entraram no
  store (seq 72–73). O Implementar da etapa 1 ficou destravado.

## Falhas de processo do agente (e correções)

### 1. Fechei o run duplicado sem perguntar por que ele existia
Tratei o `run-24fcaa1b-c26` como duplicata (corretamente) e encerrei o turno
— mas o fato de o app ter oferecido "plano" de novo para um plano `done` era
o SINTOMA do problema real (work item rejeitado na ingestão → sem item, a UI
não tinha o que oferecer para implementar). O diagnóstico só começou quando o
dono voltou dizendo "estou tentando abrir as tasks". **Correção adotada:**
run duplicado não é só coisa a arquivar — é anomalia a explicar. Antes de
encerrar, verificar no store por que o dispatch ofereceu aquela fase.

### 2. Falso negativo por bug no próprio filtro de verificação
Ao conferir se o work item tinha entrado no store, um filtro Python com
precedência errada (`and`/`or`) devolveu vazio e quase virou a conclusão
"não ingeriu". A releitura do `resultToEvents` mostrou que o tipo de evento
era outro (`work_item.created`, não `work_item.recorded`) e a segunda
verificação confirmou a ingestão. **Regra reafirmada:** resultado vazio de
uma verificação improvisada não é evidência — conferir o instrumento antes
de afirmar a ausência.

## Achados de produto (para a 010 e adjacências)

### P2 (reincidência) — redisparo de fase já concluída
Segundo caso concreto no mesmo dia: o dispatch adquiriu lock e abriu run de
Plano para um plano com `phase.completed: done` registrado desde 15:34. A
recomendação do relatório anterior segue de pé e sobe de prioridade — agora
custou uma sessão inteira de cockpit para fechar um run que não deveria ter
nascido.

### P7 — Fase Plano não exige (nem sugere) declarar work item
`REQUIRED_FACTS_BY_PHASE` não tem entrada para `plano`; os três results de
Plano do dia saíram válidos sem nenhum `work_item.recorded`. Sem item, a
fase Implementar não tem sobre o que rodar (D-16) — e o dono só descobre na
hora em que tenta implementar. Etapas 2 e 3 estão nesse estado agora.
**Recomendação:** ou o contrato passa a exigir `work_item.recorded` em run
`success` de Plano com outcome `done`, ou a skill da fase ganha instrução
explícita de declará-lo (com o vínculo `relation.recorded` plano→item).

### P8 — Não existe result de "complemento": corrigir exige simular uma fase
O contrato obriga todo result `success` a ter `phase.completed`. Um arquivo
que só quer ACRESCENTAR fatos a um run já concluído (o caso do work item
esquecido) é rejeitado inteiro — e a correção adotada foi redeclarar
`phase.completed: done` de uma fase que já estava concluída, gerando um
segundo evento de conclusão no log. Funciona, mas é gambiarra semântica.
**Recomendação:** um `kind` (ou flag) de complemento/correção no contrato,
que aceite fatos avulsos ancorados num run anterior sem redeclarar fase —
casa com o P1 do relatório anterior (gerações/supersede).

### P9 — Rejeição de ingestão é tudo-ou-nada e o erro não aponta o custo
Um único issue (`missing_required_fact`) descartou o arquivo inteiro,
inclusive os fatos válidos — e o `ingest.failed` ancorado no card dizia o
motivo técnico, não a consequência ("sem este arquivo não há work item; o
Implementar não abre"). O dono viveu isso como "não consigo abrir as tasks",
sem trilha do porquê. A regra "o app não afirma o que não leu" está certa;
o que falta é o erro dizer o que deixou de existir por causa dele.
**Recomendação:** no card, listar junto do erro os fatos declarados no
arquivo rejeitado (tipo + id), para o humano ver o que ficou de fora.

### P10 — `ingest.failed` nunca é limpo após o mesmo arquivo ingerir bem
`ingestErrors` no reducer só acumula; não há evento de resolução. O erro do
complemento corrigido vai continuar aparecendo para sempre, mesmo com os
fatos já no store — e sobreviverá a reboots, porque o replay do log o
reconstrói. **Recomendação:** ingestão bem-sucedida de um `resultPath`
presente em `ingestErrors` emite um evento de resolução (ex.:
`ingest.recovered`) que o reducer usa para remover o erro do snapshot.

### P5 (reincidência) — disparo apontou a skill 2.1.0 para input 3.0
De novo: o comando pré-digitado invocou a skill genérica do plugin
(`esteira-plano` 2.1.0, fluxo TaskDex) para um `run-input` do contrato
esteira-donel 3.0. A sessão ignorou o fluxo TaskDex e seguiu o contrato do
input — funcionou, mas segue dependendo de improviso do agente.

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P2 redisparo de fase done (2º caso) | baixo | uma sessão de cockpit desperdiçada por reabertura |
| 2 | P7 Plano sem work item obrigatório | baixo | Implementar trava de novo nas etapas 2 e 3 |
| 3 | P10 ingest.failed eterno | baixo | erros resolvidos acumulam até virarem ruído ignorado |
| 4 | P9 erro sem consequência visível | médio | humano vê o sintoma, nunca a causa |
| 5 | P8 result de complemento | médio | toda correção futura repete a gambiarra |
| 6 | P5 roteamento da skill (2º caso) | baixo | cada fase depende de improviso |
