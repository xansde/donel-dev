# Relatório de melhoria — sessão de 04/08/2026 (fase Concluir da etapa 1 da 011)

Sessão disparada pelo Modo Dev (`run-f533cfa4-14d`, work item
`wi-011-etapa1-motor-mods`): rodou o gate mecânico de Done da etapa 1 da 011.
O gate recusou na primeira rodada (risco sensível + default de 2 revisores),
o dono fixou a política de review do repo-alvo (mantenedor único, 1 revisor),
o gate aprovou na segunda, e a sessão ainda consertou o card que ficou
"terminou sem conclusão" no app — conserto que expôs um erro da própria
sessão. Sucede `relatorio-melhoria-sessao-2026-08-04-validacao-etapa-1.md`;
a numeração de achados continua da série (P24+).

## O que a sessão produziu

- Gate `gate_concluir.py` rodado duas vezes: exit 1
  (`risco_sensivel_revisor_insuficiente`, 1 revisor de 2) e, após a decisão
  do dono, exit 0 com `policy: politica-repo-alvo` / 1 revisor.
- Política de review do repo registrada de forma durável no `CLAUDE.md`
  (commit `d094b5c`): mantenedor único, 1 revisor para qualquer risco, com
  gatilho de revisão se o repo ganhar segundo mantenedor. O caminho é o que o
  contrato da fase prevê — política do repo-alvo prevalece sobre o
  `default-risco-esteira` — em vez de inventar segundo revisor ou burlar o
  payload.
- `approval_rule` do `validar-result.json` atualizado
  (`politica-repo-alvo`/1/`xansde`), com a aprovação perguntada ao dono antes
  (uma pergunta, destacada — não inferida).
- Outbox com a trilha completa: `run-f533cfa4-14d.json` (recusa,
  `inconclusive`, restaurado à forma válida) + run complementar
  `run-f533cfa4-14d-b.json` (`done`, com as três `verification.recorded`
  `passed` que o contrato exige para Done em Concluir). Ambos validados
  contra o schema do contrato.
- Esclarecimento do modelo de canais para o dono: o Done da esteira mede a
  entrada na `staging` (alfa) — PR #45 —, não na `main` (beta), que segue 18
  commits atrás por decisão dele.

## Falhas de processo do agente (e correções)

### 1. Sobrescrevi o result do outbox — contra a idempotência que o contrato documenta
Quando o gate aprovou na segunda rodada, regravei o MESMO
`run-f533cfa4-14d.json` com o desfecho novo. O contrato diz na cara do campo:
`run_id` é "chave de idempotência da ingestão" — o app já tinha ingerido a
recusa e nunca regravaria o mesmo run. O card ficou "terminou sem conclusão"
até o dono aparecer com o print. O modelo mental certo (desfecho revisto =
run novo, último `phase.completed` vence) estava a um `Read` de distância em
`esteira-ingest.ts`. **Correção adotada:** result de outbox é imutável depois
de gravado; desfecho revisto sai como run complementar (`-b`), como acabou
sendo feito.

### 2. Escrevi um documento fora do contrato sem validar — e só descobri ao consertar o erro 1
A versão sobrescrita usava `verification.recorded.state: "confirmed"` — valor
que não existe no enum (`pending|passed|failed`). Escrevi contra o exemplo da
memória, não contra o schema, e não validei antes de gravar. Se o watcher
tivesse relido o arquivo, viraria `ingest.failed` visível no card — trocando
um estado errado por outro. **Correção adotada:** todo result passa pelo
schema antes de ir ao outbox (nesta sessão: `jsonschema` via python contra
`esteira-result.schema.json`; ver P27 para o caminho definitivo).

### 3. O report de conclusão não disse ONDE a entrega vive — o dono teve que perguntar
O report final da conclusão disse "PR #45 merged" sem dizer a base
(`staging`). Para quem lê, "concluído" + "merged" soa como "está na main" — e
foi exatamente a pergunta seguinte do dono ("uai, então não está na main?").
O dado que desfazia a confusão (base do PR + modelo de canais do próprio
CLAUDE.md) estava disponível desde a primeira rodada. **Correção adotada:**
report de Concluir sempre nomeia a branch-base do PR e o canal (alfa/beta)
em que a entrega passa a existir.

### 4. P5 (reincidência, 5º caso) — skill 2.1.0 do plugin para run-input 3.0
De novo: `esteira-concluir` 2.1.0 (fluxo TaskDex — `get_task_details`,
`move_task_column`, `create_comment`) invocada para um `run-input` do
contrato esteira-donel 3.0. A sessão descartou os passos TaskDex e improvisou
os equivalentes (PR via `gh`, registro via outbox) — improviso correto, e
pelo quinto run consecutivo, não escrito em lugar nenhum. A cada fase o
mesmo tradutor mental é reconstruído do zero.

### Nota positiva — a recusa do gate foi reportada como recusa
Diante do "manda assim mesmo", a sessão não registrou revisor fantasma nem
editou o payload para passar: reportou o exit 1, nomeou o caminho legítimo
(política do repo-alvo, prevista no contrato), registrou a política de forma
durável e commitada, e só então rodou o gate de novo. O gate mecânico cumpriu
o papel — inclusive o de forçar a decisão de política a virar registro.

## Achados de produto (para a 010 e adjacências)

### P24 — Desfecho revisto não tem representação de primeira classe no contrato
O vínculo entre a recusa (`run-f533cfa4-14d`) e a revisão
(`run-f533cfa4-14d-b`) existe só como prosa nos dois summaries e como
convenção de sufixo no `run_id`. O reducer resolve o estado (último
`phase.completed` vence), mas nada no modelo diz "este run revisa aquele" —
quem auditar o outbox precisa ler os textos para entender que são o mesmo
episódio. **Recomendação:** campo opcional `revises_run_id` no bloco `run`
(ou fato `phase.reopened`), para a revisão ser dado consultável, não
narrativa.

### P25 — Política de review do repo-alvo não tem forma estruturada
O gate aceita `policy` como string do payload e confia que a sessão diz a
verdade; a política real agora vive em prosa no `CLAUDE.md`. Nada liga os
dois: uma sessão futura pode alegar `politica-repo-alvo` com N revisores sem
que exista política nenhuma. **Recomendação:** política de review como
arquivo estruturado no repo-alvo (ex.: `.esteira/review-policy.json` com
`required_reviewers` por risco), que a skill de Concluir LÊ em vez de
receber por payload — o `CLAUDE.md` fica como explicação, não como fonte.

### P26 — O card "concluído" não mostra o canal da entrega
A confusão do dono (falha 3) tem metade da causa no produto: o work item
Done não expõe em que branch/canal a entrega vive. Num repo com escada
alfa→beta→stable, "concluído" sem canal induz exatamente a leitura errada
que aconteceu. **Recomendação:** a `verification.recorded` de
`pull-request` carregar a base do PR (ou o fato `phase.completed` de
Concluir carregar `channel`), e o card exibir "entregue em staging (alfa)".

### P27 — Validar um result contra o contrato exige improviso
O repo tem o parser canônico (`parseEsteiraResultText`) mas não há forma
barata de rodá-lo sobre um arquivo: o `npx tsx` ad-hoc estourou 2 minutos de
timeout nesta sessão, e a validação acabou feita com `jsonschema` do python —
que cobre o schema, mas não as regras cruzadas do parser (ex.: Done exige
verificação `passed`). Quem escreve result de fora do app (toda skill da
esteira) valida por sorte. **Recomendação:** script
`npm run esteira:check -- <arquivo>` que roda o parser real e imprime os
issues — vira o passo mecânico da correção da falha 2.

## Prioridade sugerida

| # | Achado | Custo | Risco se ficar |
|---|---|---|---|
| 1 | P27 CLI de validação de result | baixo | próximo result inválido vira `ingest.failed` ou estado errado no card |
| 2 | P25 política de review estruturada | baixo | gate de risco sensível decidível por string de payload |
| 3 | P26 canal da entrega no card | baixo | "concluído" continua sendo lido como "está na main" |
| 4 | P24 `revises_run_id` no contrato | médio | auditoria de desfecho revisto depende de ler prosa |
| 5 | P5 roteamento da skill (5º caso) | baixo | cada fase re-improvisa o contrato 3.0 |
