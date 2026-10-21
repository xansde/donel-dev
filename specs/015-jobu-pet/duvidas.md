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
| Q4 | **Redimensionar** (pedido de 21/10): quais tamanhos e por qual gesto? | Menu do botão direito → Tamanho (Pequeno 100 · Médio 140 · Grande 200 · Muito grande 260 px) e Ctrl + roda do mouse sobre ele, de 10 em 10, entre 80 e 320 px. Cresce para cima a partir da base, sem sair do lugar, e o tamanho fica lembrado. | Trocar os presets ou os limites é uma tabela; arrastar por uma alça no canto seria gesto novo. |
| Q5 | **Ocultar e mostrar de volta**: basta Esconder (menu) + o interruptor das Preferências para religar, ou quer um atalho rápido no próprio Donel (ícone na barra de status ou tecla) para mostrar/esconder? | Só menu + Preferências — nada novo na tela principal, que você prefere enxuta. | Um ícone do corvo na barra de status alternando mostrar/esconder. |
| Q6 | **"Clicável posteriormente"**: o clique hoje leva à sessão (uma), à lista (várias) ou ao Donel (nenhuma). Você pensa em outras ações no clique para depois (ex.: conversar com ele, abrir o Tomo)? | O clique ficou num ponto de entrada único (`pet:click`), fácil de estender; nada além do especificado foi feito. | — |
