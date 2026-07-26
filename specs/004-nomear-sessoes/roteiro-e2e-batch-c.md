# Roteiro E2E — Batch C da 004 (reflexo ao vivo do `/rename`)

> ✅ **VALIDADO por ele em 2026-07-25: "funcionou perfeitamente".** O teste real
> foi o mais direto possível — ele rodou `/rename` **duas vezes na própria
> sessão em que estava trabalhando dentro do Donel Dev** ("testes donel dev" →
> "nome de teste") e viu a aba acompanhar ao vivo. Dogfood de verdade: a feature
> foi validada pelo app sendo usado para construir o app.

**Para:** Alexandre · **Gerado em:** 2026-07-25 · **Instalador:**
`release/Donel Dev-Setup-0.1.0.exe` (reempacotado com o Batch C).
**O que este batch entrega:** o CA-4 — rodar `/rename` no meio de uma sessão
viva e a aba trocar sozinha, sem reabrir nada. Com isso a 004 fecha inteira
(T401–T413).

**Já verificado automaticamente** (não precisa repetir): o registro escrito no
transcript de uma sessão **real e viva** reflete na aba em **341–372 ms** em
quatro execuções (alvo < 1 s), a sidebar acompanha, e a entrada do nome antigo
da UI é descartada do storage — `tests/smoke/session-rename-live.spec.ts`, que
descobre o `sessionId` da sessão viva pelo próprio rename e escreve no `.jsonl`
exatamente o registro que o `/rename` escreve, **sem consumir turno de API**.

Este roteiro cobre o que aquele teste não cobre: o `/rename` digitado por você
de verdade, com várias abas, ao vivo.

> ⚠️ **Precisa de cota.** Digitar `/rename` no CLI exige uma sessão que responde;
> a cota semanal do perfil estava esgotada em 24/07 ("You've hit your weekly
> limit · resets 1am"). Se ainda estiver, este roteiro não roda — espere a
> janela virar.

## Passo 1 — O CA-4 puro

1. Abra uma sessão `claude` num projeto.
2. Na aba, confira o nome atual (nome do projeto).
3. No terminal, digite `/rename investigação do watcher` e confirme.
4. ✅ **A aba troca sozinha, em menos de 1 s** — sem reabrir a sessão, sem
   reiniciar o app. A linha da sidebar troca junto.

## Passo 2 — Com 6 abas abertas (o que o plano marcou como risco)

1. Abra 6 abas `claude` (projetos diferentes, ou o mesmo).
2. Rode `/rename` numa aba que **não está em foco**.
3. ✅ O nome daquela aba muda mesmo em background — o watcher cobre todas as
   abas vivas, não só a em foco. Foi decisão explícita: senão dava "troquei de
   aba e o nome não seguiu".
4. ✅ O app não fica pesado nem trava com 6 watchers abertos.

## Passo 3 — Precedência ao vivo (C2), agora sem restart

1. Renomeie a aba pela UI (duplo-clique) para `nome da UI`.
2. Em seguida, no terminal da MESMA sessão, rode `/rename nome do CLI`.
3. ✅ Em menos de 1 s a aba passa a mostrar `nome do CLI` — o `/rename` veio
   depois, então ele vence, **e agora sem precisar reiniciar o app** (era o que
   faltava no Batch B, o que você reportou no Passo 6 daquele roteiro).
4. Renomeie de novo pela UI: o nome da UI volta a valer, porque nada novo veio
   do CLI depois dele.

## Passo 4 — Não vazar processo nem handle

1. Abra e feche 6 abas `claude` em sequência.
2. ✅ O app continua responsivo; nenhum `claude.exe` fica pendurado depois de
   fechar as abas (`tasklist | findstr claude` no PowerShell, se quiser conferir).

## Passo 5 — Aba de terminal livre não regrediu

1. Abra um terminal livre (`＋ Nova sessão` → Terminal).
2. ✅ Renomeia normalmente (duplo-clique), e nada tenta observar transcript —
   ela não tem sessão do Claude. O nome morre com a aba, por decisão sua (C4).

## O que reportar

Interessa especialmente:

- alguma aba em que o nome **não** trocou ao vivo (e se ela estava em foco);
- latência que você sinta como "demorou" (o medido é ~350 ms; se parecer mais
  de 1 s, quero saber);
- app pesando com muitas abas abertas.

## Estado da suíte quando este pacote foi gerado

- `npm run typecheck` ✅ · `npm test` ✅ **394 testes** (15 novos do watcher)
- `npm run test:smoke` (completo, 9,2 min): **22 passaram, 4 falharam** — os
  **mesmos 4 de antes**, nenhum novo:
  - `previous-sessions.spec.ts` ×2 → dívida herdada da T013 (§B11);
  - `model-injection.spec.ts` e `terminal.spec.ts:281` → **cota semanal
    esgotada**; os dois exigem turno real do modelo. O do semáforo sozinho
    consumiu **4,4 min dos 9,2** esperando resposta que não vem (ver §B13).
  - os 5 smokes desta feature (`session-rename` ×4 + `session-rename-live`) ✅.
