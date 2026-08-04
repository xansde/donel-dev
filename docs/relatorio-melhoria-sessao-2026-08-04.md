# Relatório de melhoria — sessão de 04/08/2026 (discovery Contas & Provedores)

Sessão: discovery `dsc-dfeead0d-bf9` ("Contas compartilhadas"), do disparo pelo
Modo Dev do alfa até a spec 011 commitada. Este relatório separa **falhas de
processo do agente** (com a correção adotada) de **achados de produto** que a
sessão expôs no próprio Donel/010 — cada um com recomendação.

## O que a sessão produziu

- Discovery completo: entrevista + mapa wayfinder (7/7 tickets) em
  `.scratch/contas-e-provedores/`, com 2 researches de código verificado
  (claude-switcher e T3 Code) e 5 decisões fechadas com o dono.
- `specs/011-contas-e-provedores/spec.md` (184 linhas) na branch
  `esteira/contas-e-provedores`.
- 3 planos registrados no store da esteira; store saneado após incidentes
  (abaixo).

## Falhas de processo do agente (e correções)

### 1. Discovery raso na primeira passada
Convergi para "pronto" com ~4 perguntas, sem varrer o território. O dono
precisou cobrar ("é a etapa de encontrar TODOS os problemas"). A passada
completa (inventário do repo + leitura do código das referências) mudou
decisões estruturais — ex.: o T3 Code não era o que o resumo inicial supôs.
**Correção adotada:** discovery só declara `done` com mapa cartografado e
frontier zerada. **Recomendação:** a skill de discovery deveria exigir um
artefato de mapa (ou justificativa explícita de trivialidade) antes de aceitar
`phase.completed: done`.

### 2. Referência aceita sem leitura (T3 Code)
Citei o T3 como "registry de chaves de API" baseado em suposição; o repo real
mostrou outra coisa (harness de CLIs, driver+adapter). Só caiu porque o dono
perguntou "tentou entender o repositório?".
**Regra reafirmada:** referência externa que molda decisão se lê no código
antes de entrar em resumo/fato — nunca do nome.

### 3. Pergunta enterrada em relatório (3×)
A pergunta de branch/commit foi repetida três vezes no fim de mensagens
longas e ignorada — o dono já havia pedido "uma pergunta por vez" inúmeras
vezes. **Correção:** memória reforçada (vale sempre, não só no celular);
pergunta órfã volta sozinha na mensagem seguinte, sem relatório por cima.

### 4. Re-emissão sem prever o efeito no ingest
Re-emiti o mesmo `result.json` 3 vezes (gerações do discovery) assumindo
idempotência por `run_id`. O ingest do app reprocessa arquivo alterado e
**acumula** fatos: 2 planos obsoletos ficaram no store ao lado dos 3 finais.
**Correção na sessão:** limpeza cirúrgica com backup + resultado formal para o
run duplicado. **Regra adotada:** emitir **uma vez por run**; se o conteúdo
precisa mudar, a mudança é assunto para a fase seguinte — ou para um contrato
de correção que hoje não existe (ver achado P1).

### 5. `done` declarado antes do critério do dono
O primeiro `phase.completed: done` saiu com 5 decisões estruturais ainda
abertas — exatamente o "declarar mais do que aconteceu" que a esteira 3.0
combate. **Correção:** o desfecho fiel teria sido concluir só após a frontier
zerar (foi o que a versão final fez).

## Achados de produto (para a 010 e adjacências)

### P1 — Ingest acumula gerações de fatos do mesmo run (sem tombstone)
Reprocessar um `result.json` alterado soma `plan.created` novos sem remover os
antigos; o contrato não tem `plan.removed`/correção. Qualquer engano vira
permanente (foi preciso cirurgia manual no `events.jsonl`).
**Recomendação:** ou o ingest rejeita reprocessamento de run já ingerido
(fecha a porta), ou o contrato ganha noção de geração/supersede por run
(reprocessou → fatos da geração anterior daquele run são substituídos).

### P2 — Reabrir o app + retomar sessão redisparou fase concluída
Ao reabrir o alfa e dar `/resume`, o app criou um run novo
(`run-c486d633-af4`) e **adquiriu lock** numa fase que já tinha
`phase.completed: done` — trava fantasma esperando resultado que nunca viria.
**Recomendação:** o dispatch deve recusar (ou pedir confirmação para)
redisparo de fase com `done` registrado; e `/resume` de sessão não deveria
gerar dispatch novo.

### P3 — Snapshot regravado da memória ressuscita estado corrigido em disco
Com o app aberto, o snapshot é derivado do estado em memória: após a limpeza
do `events.jsonl`, o app regravou o snapshot com os planos obsoletos de volta.
Foi preciso segunda rodada (fechar app + apagar snapshot).
**Recomendação:** no boot, validar snapshot contra o arquivo de eventos
(através de `through_seq`/contagem) e descartá-lo em divergência — o snapshot
já é documentado como descartável; falta o descarte automático.

### P4 — Dois canais abertos compartilhando o mesmo store
Donel Dev (beta) e Donel Dev Alfa rodando juntos sobre o mesmo `userData`
tocaram o mesmo diretório da esteira durante a manutenção. Risco conhecido da
decisão de canais coexistentes (B10), agora com caso concreto em cima de dado
de estado, não só config.
**Recomendação:** reforça o B10 (isolamento de userData por canal) ou, no
mínimo, lock de arquivo no store da esteira entre processos.

### P5 — Roteamento de skill: o disparo apontou a skill 2.1.0 para input 3.0
O run-input veio no contrato da esteira-donel 3.0.0, mas o comando invocado
foi a skill genérica do plugin (2.1.0, TaskDex) — a sessão precisou descobrir
sozinha o fork `skills/esteira-donel-3.0.0/`. Funcionou por sorte de leitura.
**Recomendação:** o dispatch do app deve nomear a skill do fork diretamente
no comando pré-digitado.

### P6 — `/speckit.specify` prometido, não instalado
O handoff do mapa aponta `/speckit.specify`, mas o comando não existe na
máquina; a spec saiu à mão no estilo da casa (resultado ok, promessa quebrada).
**Recomendação:** ou instalar o spec-kit, ou o playbook/mapa referenciar
"spec no padrão do repo" em vez de um comando inexistente.

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P2 redisparo de fase done | baixo | trava fantasma recorrente a cada reabertura |
| 2 | P1 gerações de fatos | médio | store poluído exige cirurgia manual (de novo) |
| 3 | P3 snapshot vs. disco | baixo | correção externa nunca "pega" |
| 4 | P5 roteamento da skill | baixo | cada fase nova depende de improviso |
| 5 | P4 canais no mesmo store | médio (é o B10) | corrupção silenciosa de estado |
| 6 | P6 speckit ausente | trivial | promessa quebrada em handoff |
