# Medição C1 — RAM do Modo Dev

**Data:** 2026-07-27 · **Task:** T323 (Batch B, Fatia 1) · **Máquina:** Windows 11,
a mesma do Alexandre · **Executável:** build de produção (`out/main`, `out/renderer`)

> Nenhum número aqui é estimado. Todos saem de
> `tests/smoke/dev-mode-measurement.spec.ts`, que continua no repo como **cerca de
> regressão** — rodar `npm run test:smoke` re-mede a cada execução.

## O que foi medido

Delta de memória entre **"Uso geral"** (app aberto, Modo Dev desligado, nenhuma sessão)
e **"Modo Dev ligado"** com um discovery de **3 marcos** desenhado por completo (Zona 1
com a porta de entrada, Zona 2 com as 5 fases do marco em foco, Zona 3 com o mapa
inteiro + legenda).

**Fonte do número:** `app.getAppMetrics()` — o **working set real** de TODOS os
processos do Electron (browser + renderer + GPU + utility), medido pelo SO. Não é
`performance.memory` (heap JS do renderer), que ignoraria justamente o custo de
compositor/DOM que uma tela nova traz.

**Método:** mediana de 5 amostras espaçadas de 400 ms em cada estado — o working set
oscila com GC, e uma amostra só seria ruído, não medida. Nenhuma sessão `claude` é
aberta: processos do CLI são externos ao Electron e não entram (nem devem) neste número.

## Números medidos (9 execuções do smoke)

| Amostra | Uso geral | Modo Dev (3 marcos) | Delta |
|---|---|---|---|
| pior caso | 365,1 MB | 405,9 MB | **+40,7 MB** |
| melhor caso | 339,0 MB | 371,3 MB | +32,3 MB |
| faixa | 339,0 – 381,5 MB | 371,3 – 414,9 MB | **+28,2 – +40,7 MB** |

**Alvo da spec (C1): +50 MB — cumprido**, com pior caso medido de **+40,7 MB**.

## Cerca de regressão commitada

| Cerca | Valor | Racional |
|---|---|---|
| `RAM_DELTA_FENCE_MB` | **50 MB** | ~2× o pior caso medido (40,7 × 2 = 81 MB) ficaria **acima do alvo do produto** — cerca maior que o alvo não protege nada. Vale a mais apertada das duas: o próprio alvo do C1. |

## O que observar daqui pra frente — margem curta, dito na cara

- A folga é de **~19%** (40,7 MB medidos contra 50 MB de alvo). Este é o número mais
  apertado das duas medições do C2/C1: qualquer peça nova de UI no Modo Dev
  (carrossel com muitos marcos montados de uma vez, painel de detalhes por nó
  mantendo estado, overlay do board na Fatia 2) come essa margem rápido.
- O app **já nasce alto** (339–381 MB em "Uso geral"), acima do budget de 400 MB
  discutido no `feedback-e2e.md`. O Modo Dev não criou esse problema, mas encosta
  nele: ligado, o total medido chegou a **414,9 MB**.
- A Fatia 2 (espelho do board) vai somar estado novo em memória (os 4 fatos por nó) e
  **deve re-rodar esta medição** antes de fechar. Se estourar, o caminho barato é
  montar só o marco em foco e os vizinhos imediatos, em vez do carrossel inteiro.
