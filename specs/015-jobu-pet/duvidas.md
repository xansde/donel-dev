# Dúvidas acumuladas — 015 (pet do Jobu Donel)

Mandato do dono (21/10): "vai tocando, confio em vc. Quero ver o resultado
final. Acumula as dúvidas." Cada dúvida abaixo já tem uma **decisão
provisória** aplicada no código — nada ficou parado esperando resposta. Se a
resposta for outra, a mudança é pequena e está indicada.

| # | Dúvida | Decisão provisória (aplicada) | Se a resposta for outra |
|---|---|---|---|
| Q1 | A arte do Jobu (PNGs em `src/renderer/src/pet/assets/poses/`) vai para o repo **público** na promoção ao stable? O personagem é do seu RPG e o público é MIT. | Fica em `src/` (alfa e beta usam). A promoção ao stable não acontece sem a sua resposta. | Tirar a pasta do espelho no `scripts/sincronizar-publico.ps1` e o público ganha uma silhueta genérica. |
| Q2 | Durante **tela cheia** o Jobu some (FR-007). Os avisos do Windows voltam nesse intervalo? | Não voltam: com o Jobu ligado, os avisos do Windows desses eventos ficam calados mesmo com ele sumido pela tela cheia — para não pipocar numa apresentação. "Escondido", no FR-020, é só o gesto Esconder. | Uma condição a mais na regra de supressão. |
| Q3 | **Silenciar por 1 hora** sobrevive a reiniciar o Donel? | Não: o silêncio vale para a execução atual do app; reabrir o Donel retoma os avisos. | Gravar o fim do silêncio na config. |
