# Medição — CA-7 (boot instantâneo, sem varredura)

**Task:** T712 · **Data:** 2026-07-26 · **Ambiente:** máquina do agente, build de
produção (`npm run build`), Electron 43.2.0, `out/main/index.js`.

## O que foi medido

CA-7 exige: *"ao abrir o app, o grupo é montado a partir de um registro
próprio... sem ler nenhum `.jsonl`. Alvo: sidebar pintada em **< 100 ms**,
medido — não 'parece rápido'."*

Métrica: tempo entre o evento `domcontentloaded` do renderer e o instante em
que a seção "Favoritos" tem as **30 linhas** montadas no DOM (5 projetos
favoritados × (5 sessões recentes + 1 fixada) — o "registro cheio" da spec).

## Metodologia (por que não é o erro da 004)

A lição registrada em `specs/004-nomear-sessoes/medicao-t403.md` foi: o
`expect().toPass()` do Playwright usa backoff exponencial (intervalos que
dobram), e **o próprio backoff** apareceu como parte do número medido —852 ms
para algo que levava ~350 ms de verdade.

Correção aplicada aqui, em duas camadas:

1. **Nenhum `expect().toPass()`.** Um loop `for (;;)` próprio, sem sleep
   artificial entre iterações — cada iteração já é o próprio round-trip da
   chamada seguinte.
2. **Contagem e cronometragem na MESMA chamada de `evaluate`.** A primeira
   versão deste teste separava "detectar que pintou" (via
   `locator.count()`, round-trip do protocolo do Playwright) de "medir quanto
   levou" (uma segunda chamada de `evaluate` depois de sair do loop) — e essa
   separação por si só inflava o número (**167,40 ms** na primeira medição,
   caindo para a faixa abaixo assim que os dois viraram uma única chamada).
   A versão final faz as duas coisas dentro do MESMO `page.evaluate`: conta os
   `<button aria-pressed>` da seção "Favoritos" (30 esperados) e, se bater,
   devolve `performance.now() - navigationEntry.domContentLoadedEventEnd` —
   tudo calculado com o relógio do **processo renderer**, nunca o do
   Node/Playwright, e sem round-trip entre detecção e medição.

Config populado **direto no disco** (`config.json` escrito por
`writeFileSync` antes do `electron.launch`) — a medição é do BOOT com o
registro já cheio, não de uma sequência de chamadas IPC feitas depois do app
já estar de pé. Os 5 projetos favoritados são reais (descobertos via
`window.donel.projects.list()` numa run de descoberta descartada em seguida),
nunca paths inventados.

Script: `tests/smoke/ca7-measurement.spec.ts`.

## Resultado

6 execuções consecutivas, mesma máquina, mesmo build:

| # | ms medidos |
|---|---|
| 1 | 167,40 (metodologia com round-trip extra entre contagem e medição — descartada) |
| 2 | 136,10 |
| 3 | 103,20 |
| 4 | 148,90 |
| 5 | 124,20 |
| 6 | 132,50 |

**Faixa (metodologia final, execuções 2–6): 103,20–148,90 ms — média ~129 ms.**

**O alvo de < 100 ms NÃO foi atingido.** Nenhuma das 5 execuções com a
metodologia final ficou abaixo de 100 ms; a mais próxima (103,20 ms) ainda
excede.

## Diagnóstico (uma execução instrumentada, não uma correção)

`performance.getEntriesByType('navigation')[0]` numa execução:

```
domContentLoadedEventEnd: 158,3 ms (desde o início da navegação)
loadEventEnd:             158,6 ms
responseEnd:               15,1 ms
paint completo (30 linhas): 300,8 ms (desde o início da navegação)
```

Leitura: o próprio evento `domcontentloaded` já dispara **158 ms** depois do
início da navegação (script da bundle de produção, ~776 KB, sem
`defer`/`async` — a execução síncrona do módulo bloqueia o fim do parse do
HTML). CA-7 mede a partir DAÍ, então o número reportado (~103–149 ms) é
inteiramente o que acontece DEPOIS do `domcontentloaded`: as duas chamadas
IPC assíncronas do boot (`window.donel.config.get()` e
`window.donel.projects.list()`, cada uma num `useEffect` própria em
`App.tsx`), a re-renderização do React com os dados chegados, e o paint do
browser.

**Isto não foi introduzido pela 007** — é o custo de boot do app que já
existia (as duas chamadas IPC, o parse da bundle) e que nunca tinha sido
medido com este rigor antes. A 007 é a primeira feature a colocar um número
duro (< 100 ms) sobre exatamente esse caminho.

## O que NÃO foi feito (fora do escopo de T712)

T712 pede **medir e registrar o número**, não otimizar até bater o alvo.
Nenhuma tentativa de otimização foi feita — mudar o boot (juntar as duas
chamadas IPC num canal só, lazy-load da bundle, remover trabalho síncrono
antes do `domcontentloaded`) é escopo de uma task própria, fora do tasks.md
desta feature.

## Decisão pendente (dele)

O alvo de CA-7 (< 100 ms) não é atingido pela implementação atual — faixa
real medida: **~103–149 ms**. Duas saídas possíveis, nenhuma delas tomada
aqui:

1. **Aceitar o desvio** — 103–149 ms ainda é "instantâneo" percebido por um
   humano (limiar clássico de percepção é ~100–200 ms); o número absoluto da
   spec pode ter sido uma estimativa sem medição prévia (o CA-7 cita a
   medição da 004 sobre um caso DIFERENTE — 684 ms de varredura de disco —
   como o problema que esta feature resolve, não uma medição do PRÓPRIO
   caminho do boot).
2. **Investir em otimização** — juntar `config:get` + `projects:list` num
   único IPC (`boot:get`), ou adiar a montagem das linhas fora da viewport
   inicial, ou revisitar por que o script da bundle bloqueia 158 ms antes do
   `domcontentloaded`.

Marcado como `needs_attention` no manifesto desta implementação.
