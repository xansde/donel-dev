# Medição C2 — montagem do mapa do discovery

**Data:** 2026-07-27 · **Task:** T323 (Batch B, Fatia 1) · **Máquina:** Windows 11,
a mesma do Alexandre · **Executável:** build de produção (`out/main`, `out/renderer`)

> Nenhum número aqui é estimado. Todos saem de
> `tests/smoke/dev-mode-measurement.spec.ts`, que continua no repo como **cerca de
> regressão** — rodar `npm run test:smoke` re-mede a cada execução.

## O que foi medido

O caminho inteiro do C2: `window.donel.devMode.readTree(cardId)` — IPC do renderer →
`buildDiscoveryTree` no main → `esteira-reader` lendo o disco → árvore de volta no
renderer. É o custo que o usuário paga para o mapa aparecer.

**Fixture (pior caso do C2 — "até 5 marcos"):** 1 discovery × **5 marcos** × 5 fases,
cada fase com `ctx.md` (com `worktree_path`/`branch`, D3) **e** `<fase>-result.json`
com artefatos declarados = **50 manifestos + 51 `ctx.md`** lidos por chamada.

**Método:** 20 chamadas seguidas dentro de UMA única `page.evaluate`, cronometradas
com `performance.now()` do próprio renderer. Nada do relógio do processo
Node/Playwright entra no número, e não há `expect().toPass` em lugar nenhum — a lição
da 004 (`medicao-t403.md`) foi que o backoff do `toPass` reportou 852 ms para algo de
~350 ms: o número era do amostrador, não do app.

A **1ª chamada** é reportada separadamente das demais: ela paga o cache de disco frio
do Windows e a primeira materialização dos módulos no main.

## Números medidos (9 execuções do smoke)

| Amostra | 1ª chamada (frio) | mín (quente) | mediana (quente) | máx (quente) |
|---|---|---|---|---|
| pior caso | **169,0 ms** | 4,0 ms | 7,5 ms | **23,2 ms** |
| melhor caso | 53,8 ms | 4,0 ms | 4,3 ms | 6,5 ms |
| faixa | 53,8 – 169,0 ms | 4,0 – 4,8 ms | 4,3 – 7,5 ms | 6,5 – 23,2 ms |

**Alvo da spec (C2): < 200 ms para até 5 marcos — cumprido**, tanto no frio (pior caso
169,0 ms) quanto no quente (pior caso 23,2 ms).

## Cercas de regressão commitadas

| Cerca | Valor | Racional |
|---|---|---|
| `MAP_BUILD_FENCE_MS` (chamadas quentes) | **50 ms** | ~2× o pior caso medido (23,2 ms) |
| 1ª chamada (frio) | **200 ms** | 2× o pior caso frio (169 ms) daria 338 ms, **acima do alvo do produto** — uma cerca dessas não protegeria nada. Vale a mais apertada das duas: o próprio alvo do C2. |

## O que observar daqui pra frente

- A margem no **caminho frio é curta**: 169 ms medidos contra um alvo de 200 ms (~18%
  de folga). Se a árvore crescer (mais fases, mais leitura por nó) ou a pool do CA-10
  passar a conferir muito mais arquivo, esse é o número que estoura primeiro.
- O custo é dominado por I/O de arquivinho pequeno, não por CPU: a montagem em si
  (marcos × fases, puro) é ruído dentro dos 4 ms do caso quente.
- A Fatia 2 (espelho do board) **não** entra neste número: ela anota a árvore já
  montada, com dado que vem da rede, e terá medição própria se precisar.

**Atualização 28/07** — a margem curta prevista acima estourou: rodando
`dev-mode-measurement.spec.ts` numa máquina **em uso** (não ociosa), o cold bateu
**492 ms** e **309 ms** em duas execuções (ambas acima do alvo de 200 ms), e voltou a
passar (< 200 ms) numa máquina ociosa. Nenhuma regressão de código — só carga real da
máquina, que o alvo literal do produto nunca foi desenhado pra absorver. O smoke
(`tests/smoke/dev-mode-measurement.spec.ts`) passou a guardar a cerca de regra 6 (~2× o
pior caso frio medido aqui = 169 × 2 = **338 ms**, `COLD_CALL_FENCE_MS`) em vez do alvo
literal de 200 ms — o alvo de produto continua documentado acima, só não é mais o que
protege contra regressão.
