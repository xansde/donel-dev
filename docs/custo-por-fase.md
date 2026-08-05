# Custo médio por fase da Esteira

> Gerado por `npm run esteira:custo` em 2026-08-05T06:27:00.471Z. Cruza o store
> local da Esteira (`session.started`/`session.claimed` → `cliSessionId`)
> com os transcripts do CLI (`~/.claude/projects/<slug>/*.jsonl`, campo
> `usage` por mensagem). Leitura estritamente read-only — nunca escreve no
> store nem em transcript — e sem nenhum nome de pessoa: só contagem, tokens
> e minutos de sessões de trabalho.

## Amostra desta máquina

18 sessão(ões) assumida(s) (`session.claimed`) encontrada(s) no store; 17 tiveram transcript localizado e entraram na conta; 1 ficaram de fora (transcript não encontrado).

## Tabela 1 — custo por fase (output + cache write, por sessão)

| Fase | Sessões | Chamadas (total) | Tokens-custo — média | mediana | mín | máx | Duração média (min) | Duração mín–máx (min) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| discovery | 2 | 226 | 941.321 | 941.321 | 266.256 | 1.616.385 | 65,2 | 0,3–130,1 |
| plano | 5 | 329 | 553.561 | 505.127 | 0 | 1.024.023 | 37,1 | 1,8–62,8 |
| implementar | 4 | 339 | 691.782 | 690.557 | 277.491 | 1.108.522 | 79,7 | 5,5–136,0 |
| validar | 2 | 562 | 2.301.425 | 2.301.425 | 1.082.568 | 3.520.282 | 149,1 | 130,1–168,2 |
| documentar | 2 | 169 | 529.246 | 529.246 | 497.878 | 560.613 | 43,3 | 12,9–73,7 |
| concluir | 2 | 107 | 358.655 | 358.655 | 258.414 | 458.895 | 34,3 | 4,5–64,1 |

## Tabela 2 — o que pesa mais: gerar resposta ou reconstruir contexto

| Fase | Output — média/sessão | Cache write — média/sessão | Cache write ÷ Output |
| --- | ---: | ---: | ---: |
| discovery | 113.219 | 828.102 | 7,31x |
| plano | 60.243 | 493.318 | 8,19x |
| implementar | 81.497 | 610.285 | 7,49x |
| validar | 255.023 | 2.046.403 | 8,02x |
| documentar | 86.571 | 442.675 | 5,11x |
| concluir | 45.659 | 312.996 | 6,86x |

## Leitura

Nesta amostra, 6 fase(s) tinham sessão assumida com transcript localizado (17 de 18 sessões assumidas no store). A métrica que decide é output tokens + cache write — nunca o total processado: 96,6% do input de uma sessão típica é cache READ (contexto já existente, reaproveitado a uma fração do preço); somar isso mediria o quanto a sessão LEU, não o quanto ela CUSTOU. Para comparar escala, o baseline medido manualmente na etapa 3 (05/08) foi: cockpit 197 turnos (output 160.017, cache write 897.792, cache read 29.946.079); workers Implementar (sonnet) 396.565 tk / 204 chamadas / ~57 min, Validar (opus) 138.540 tk / 37 chamadas / ~7 min, Documentar (sonnet) 155.280 tk / 22 chamadas / ~4,4 min (etapa 3, 05/08).

Nesta amostra, "plano" é a fase com maior razão cache-write/output (8,19x) — cada sessão dessa fase gasta proporcionalmente mais reconstruindo contexto do que efetivamente respondendo. É a candidata mais forte a fundir com a fase vizinha: menos sessões novas abertas para aquele trabalho significa menos vezes pagando essa reconstrução. Fases com razão baixa (mais perto de 1x) já amortizam esse custo dentro da própria sessão e ganham menos com a fusão — o oposto, reconstruir contexto, é o que de fato pesa, não reusá-lo.
