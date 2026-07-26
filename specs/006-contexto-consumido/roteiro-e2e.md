# Roteiro E2E manual — 006 contexto consumido (para o Alexandre)

**O que a feature faz:** na toolbar da aba `claude` (ao lado de Modelo/Esforço)
aparece `contexto NN%` — quanto da **smart zone de 300k** o contexto da sessão já
ocupa. `zona = min(300.000, janela do modelo)`, então em fable/opus/sonnet o
denominador é 300k e em **haiku** é 200k (a janela real vence). O `%` **não tem
teto**: passar de 300k mostra 127%, e acima de 100% o número fica na cor de
alerta.

**O que a automação já provou** (não precisa reconferir): a aritmética e a tabela
de janelas (32 testes puros), a leitura da `usage` na cauda do transcript (28
testes com `fs` real) e o indicador na tela reagindo a turno novo, a estouro da
zona e à queda pós-`/compact` (smoke `session-context.spec.ts`).

**O que só uma sessão real responde** — é este roteiro. Os passos 1, 4 e 5 exigem
turno de modelo de verdade; em 24–25/07 a cota semanal estava esgotada, então
eles ficaram sem validação humana.

> ## ✅ EXECUTADO E APROVADO — 2026-07-26
>
> O Alexandre instalou o build, reiniciou o app e rodou este roteiro numa sessão
> real de trabalho: *"acho que funcionou! Tudo funcionando bem!"*. **Nenhum dos
> sintomas da seção "o que reportar" apareceu** — em especial, `%` **não** ficou
> preso com a conversa andando, que era o gatilho para implementar a mitigação da
> dívida `specs/backlog.md` §B15 (`fs.watch` coalescendo evento no Windows). A
> §B15 segue como dívida NÃO implementada, agora com uma evidência de uso real
> contra ela.
>
> O roteiro fica no repo como regressão manual: reexecutar quando o watcher, a
> leitura de cauda ou a tabela de janelas por modelo mudarem.

## Passos

1. **O número aparece e sobe.** Abra uma sessão `claude` num projeto e mande um
   prompt qualquer. Depois da resposta, a toolbar deve sair de `contexto —` para
   um `%`. Mande outro prompt: o número **sobe**.
   - ✅ esperado: valor plausível (uma sessão que acabou de começar com bastante
     contexto de sistema costuma nascer entre 5% e 20% da zona).
   - ❌ suspeito: continuar em `—` depois de uma resposta completa.

2. **Tooltip diz o que o número significa (CA-7).** Passe o mouse sobre ele.
   - ✅ esperado: `134.602 / 300.000 tokens da smart zone · janela opus 1.000.000`
     — a zona como denominador **e** a janela real do modelo ao lado.
   - O rótulo é literalmente `contexto`, para não confundir com o `%` de **cota**
     (rate-limit) que o app já mostra em outro lugar.

3. **Troca de modelo recalcula (CA-6).** Com a sessão ociosa (semáforo em
   "Aguardando resposta"), troque **opus → haiku** na toolbar.
   - ✅ esperado: o `%` **salta para cima** (mesmo contexto, janela menor: 45% em
     opus vira 67% em haiku). Voltar para opus devolve o valor anterior.
   - Nota: os controles ficam desabilitados até o primeiro turno da sessão — é
     comportamento antigo (T011), não desta feature.

4. **`/compact` faz o número CAIR.** Rode `/compact` na sessão.
   - ✅ esperado: o `%` cai de forma visível no turno seguinte. É a prova de que o
     número é o contexto **agora**, não o acumulado da sessão.

5. **Passar da smart zone (o cenário que você pediu).** Numa sessão longa de
   trabalho normal, deixe o contexto passar de 300k.
   - ✅ esperado: o número passa de 100% (ex.: `contexto 127%`) e fica **na cor de
     alerta**, sem travar em 100% — 305k e 700k têm de ser distinguíveis.
   - Este passo não cabe num teste dedicado: valide-o ao longo de um dia de
     trabalho, não numa sessão criada só para isso.

6. **Aba de terminal livre.** Abra uma aba shell.
   - ✅ esperado: nenhuma toolbar de sessão, portanto nenhum indicador de contexto.

7. **Aba recém-nascida.** Abra uma sessão e **não** digite nada.
   - ✅ esperado: `contexto —`. Nunca `0%` — zero seria uma afirmação falsa sobre
     um contexto que ninguém mediu ainda.

8. **Cada aba com o seu número.** Com duas ou três sessões abertas em estágios
   diferentes, troque de aba.
   - ✅ esperado: cada aba mostra o próprio `%`, inclusive as que ficaram em
     background (o observador cobre todas as abas vivas, não só a em foco).

## O que reportar se algo estranhar

- **`%` parado enquanto a conversa avança:** anote quanto tempo ficou preso e o
  tamanho do projeto. É o cenário da dívida `specs/backlog.md` §B15 (`fs.watch`
  pode perder um evento no Windows); a mitigação já está desenhada (uma
  re-leitura de segurança a cada poucos segundos) e só entra se acontecer de
  verdade com você.
- **`—` numa sessão retomada antiga:** esperado em ~0,3% dos transcritos, onde a
  última `usage` fica além dos 64 KB de cauda lidos (medido em 313 transcripts —
  `medicao-t606.md`). O número aparece no primeiro turno novo.
- **Número que parece baixo demais:** confira o tooltip. O denominador é a zona de
  300k, não a janela de 1M — foi a decisão de 24/07 justamente para o número ser
  útil.
