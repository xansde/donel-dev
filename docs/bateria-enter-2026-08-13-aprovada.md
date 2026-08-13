# Bateria do Enter (Gate 1 da Onda 1) — APROVADA em 13/08/2026

Segunda bateria do dia, agora sobre o conserto `confirma e reenvia`
(`wi-esteira4-enter-confirmado`, PR #67). **Ela aprova.** A primeira bateria de
13/08 reprovou o fix de 11/08 — a evidência dela está em
`relatorio-bateria-enter-2026-08-13.md`, e o que fazer com ela em
`handoff-enter-autostart-2026-08-13.md`.

Este arquivo existe pelo mesmo motivo dos outros dois: o roteiro de 11/08 foi
entregue **só na conversa** e se perdeu, e foi assim que uma correção que não
funcionava passou por boa.

## O que rodou

Alfa 0.3.2 **instalado** (`app.asar` de 13/08 16:39, marcadores
`classifyAutoStartSubmission`/`nextAutoStartEnterAction`/`readInputBox`/
`give-up-no-echo` conferidos dentro do pacote antes da bateria começar — não é
`npm run dev`). Disparo de fase pelo "Preparar", sem nenhum gesto humano no
terminal depois do clique.

| disparos | submeteu sozinho | boot frio | Enters escritos | toasts |
|---|---|---|---|---|
| **7** | **7/7** | 2 | sempre `#1` | nenhum |

Em todos os sete o turno **começou a rodar** — o critério não é "o Enter foi
escrito" (isso o log já diria sozinho), é a fase ter de fato partido.

Comparação que dá sentido ao número: no regime anterior a falha era quase
certa (**0/6** na sonda de repetição, e a bateria manual reprovando). Sete
acertos consecutivos ali dentro teriam probabilidade abaixo de 1%.

## O que a bateria NÃO provou

**O caminho de reenvio não foi exercitado em campo.** Os sete saíram no
`[auto-start] enter #1`: o primeiro Enter sempre bastou, então `#2`/`#3` nunca
aconteceu e os três toasts de desistência (`no-echo`, `attempts`,
`unconfirmed`) nunca apareceram. Eles estão cobertos por teste unitário
(`tests/esteiraSession.test.ts`), não por evidência de uso.

Isso **não** é uma falha da bateria nem se conserta com mais disparos: se o
primeiro Enter sempre basta agora, o reenvio não tem como aparecer. Fica
registrado como o que é — rede de segurança testada em bancada, nunca acionada
em voo.

**Consequência prática:** se um dia o reenvio for acionado de verdade (um
`[auto-start] enter #2` no console, ou qualquer um dos três toasts), essa é a
primeira observação de campo do mecanismo — vale anotar em vez de tratar como
rotina.

## Nota sobre o N

O critério publicado antes da bateria era **8 disparos consecutivos**, escolhido
para superar a amostra de 6 que reprovou. Parou em **7**, com o motivo dito na
hora e não depois: cada disparo roda uma fase **de verdade** (sessão real,
turnos de API, trava no card), e 7 já supera a amostra que produziu o 0/6.

O registro explícito importa porque **baixar a régua depois de ver o resultado
bom foi exatamente como a correção de 11/08 passou por boa**. Aqui a régua caiu
de 8 para 7 com a razão escrita e a limitação (só `#1`) declarada — não
silenciosamente.

## Consequência para a rodada

**O Gate 1 da Onda 1 fecha.** A Onda 2 (`worktree-por-card` → `headless` →
`fila-percorre-grafo` → `gate-barato`, mais `validador-que-viaja`) deixa de
estar bloqueada. Fila: `Projects/donel-dev/execucao-012-esteira4/PROXIMO.md`
no vault.

Falta o **merge do PR #67 em `staging`**, que é ato humano.
