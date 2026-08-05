---
name: esteira-discovery
description: Use quando o Donel Dev disparar a fase Discovery de um card — o app deixou um `run-input.json` no inbox e espera o `result.json` de volta. Entrevista o problema AO VIVO, na sessão, até virar decisões; nunca deixa o app deduzir, e nunca devolve um plano pronto para carimbar sem ter perguntado nada.
---

# Fase Discovery — esteira-donel 3.0.0

Você recebe um `run-input.json` e devolve um `result.json`. Os dois são
contratos com schema, verificados dos dois lados. Nada de `ctx.md`, nada de
JSON escrito à mão.

## Iron Law

**O que você não declarar, não aconteceu — e o app vai dizer exatamente isso.**

A versão 2.1.0 desta esteira não gravava `plan_cards[]`, e o app traduziu a
ausência em "fase não realizada" numa tela que o dono do trabalho leu como
mentira. O contrato v1 existe para que isso seja impossível: você declara
fatos, o app registra fatos. Não há inferência de nenhum lado.

**E o que você declarar como decisão de alguém tem que ter sido decisão de
alguém — o grilling roda NA SESSÃO, com o dono respondendo ao vivo. Nunca um
worker que interroga sozinho e volta com plano pronto para carimbar.**

Discovery existe para produzir entendimento compartilhado, não para produzir um
documento. Se esta fase roda sem ninguém para responder às perguntas, ela não
tem como cumprir o que existe para fazer — e fingir que cumpriu (inventando
respostas, ou pulando direto para um plano "razoável") é a mesma inverdade de
03/08, só que na etapa de conversa em vez da etapa de execução. O contrato
já tranca a saída fácil por baixo (`[A18]`): `outcome: done` exige
`gate.confirmed` ou `decision.recorded`, e os dois campos pedem
`confirmed_by` — **nunca o nome da própria skill**. Sem um humano respondendo
de verdade, você não tem quem preencher esse campo, e o emissor recusa. Não
invente o nome para contornar.

## Passos

0. **Preflight mecânico.** Antes de tocar no `run-input.json`, rode:

   ```bash
   ls docs/relatorio-*.md 2>/dev/null
   ```

   Se algum arquivo aparecer, **leia antes de começar**: são relatórios de
   melhoria de sessões anteriores desta esteira, e costumam nomear o erro que
   você está prestes a repetir. Ausência de arquivo = nada a ler, siga.

1. **Leia a ida.** O caminho do `run-input.json` vem no disparo.

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   Ele traz: o discovery (título, problema, tracker, repo alvo, escopo), o
   histórico das fases que já rodaram — **inclusive as que falharam, com o
   código do erro** — e as notas. Leia o histórico antes de começar: repetir
   uma tentativa que já falhou é o desperdício mais caro da esteira. Se uma
   rodada anterior terminou `inconclusive` com notas apontando perguntas em
   aberto, **essas perguntas são o ponto de partida desta sessão** — não
   comece a entrevista do zero.

2. **Entreviste até doer — ao vivo, uma pergunta por vez.** Use a disciplina
   de `grilling`: uma pergunta por vez, atrás do problema real, não da solução
   que já veio pronta. Isto não é um passo opcional nem delegável: é a espinha
   da fase.

   - Se você está numa sessão com o dono presente e respondendo: entreviste de
     verdade, uma pergunta por mensagem, até o problema (e o plano, se houver
     um) resistir a estresse.
   - Se você foi disparado sem ninguém para responder ao vivo (execução em
     background, worker autônomo): **não invente respostas**. Pare cedo,
     registre as perguntas que precisam de humano em `note.recorded`, e feche
     com `phase.completed { outcome: "inconclusive" }`. Um discovery que volta
     com perguntas é trabalho útil; um discovery que volta com um plano
     carimbado por ninguém é a evidência 1 de novo, com roupa nova.

   Discovery que aceita o enunciado do card sem estressá-lo produz plano que
   não sobrevive ao primeiro contato com o código.

3. **Decida o que é fato.** Ao fim, o que você tem para declarar — a tabela
   abaixo é a mesma promessa que o schema cobra (`x-required-facts`), só que
   nomeada por esta fase:

   | Fato | Quando é obrigatório |
   |---|---|
   | `discovery.recorded` | **sempre** — é o assunto do run, cobrado em qualquer desfecho |
   | `phase.completed` | **sempre**, em todo run `status: success` |
   | `gate.confirmed` **ou** `decision.recorded` | quando `outcome: "done"` — a fase de conversa fecha com o que uma pessoa disse (A18) |

   E o resto do que pode aparecer:

   - `plan.recorded` — um por plano proposto. **Zero planos é um desfecho
     legítimo**: se a resposta foi "não vale a pena mexer nisso", não invente
     um plano para preencher espaço. O app mostra "sem plano registrado", que é
     a verdade.
   - `relation.recorded` — `originated` do discovery para cada plano.
   - `note.recorded` — o que um humano precisa ler depois e não cabe em campo:
     hipóteses descartadas, o que ficou em aberto, as perguntas que uma rodada
     `inconclusive` deixa para a próxima.

   `phase.completed` leva `done` quando terminou (com decisão humana
   declarada), `abandoned` quando o card morreu aqui, `inconclusive` quando
   faltou base **ou faltou gente** para decidir. As três são respostas;
   nenhuma delas é vergonha.

   **A forma de cada fato é o corpus, não a memória.** Antes de montar
   `facts.json` à mão, olhe um exemplo de verdade em
   `src/shared/esteira/contract/v1/examples/` — `discovery-com-tracker.json`
   tem `gate.confirmed` em dois formatos e mostra um `relation.recorded`
   completo; `discovery-sem-repo-nem-tracker.json` mostra o discovery mínimo,
   sem repo nem tracker. Copiar a forma de um exemplo real é mais seguro que
   reconstruir os campos de memória — é exatamente o desencontro que gerou a
   spec 010.

4. **Emita.** Monte `facts.json` (uma lista) e chame:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   O emissor recusa o que o app recusaria: id fora do padrão, item `issue` sem
   repo alvo, fase concluída sem os fatos que ela promete. Se ele reclamar,
   **conserte o fato — não contorne a ferramenta**.

5. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 4>
   ```

   O emissor python já validou contra o schema; este comando roda a MESMA
   verificação pelo lado do app (o parser real que vai ler este arquivo). Só
   considere a fase concluída com saída (exit code) 0. Se ele reclamar,
   conserte os fatos e emita de novo — a mesma disciplina do passo 4, agora
   conferida pelos dois lados do contrato que a spec 010 existe para manter
   amarrados.

6. **Se a fase falhou**, emita mesmo assim:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status failed --failure-code <código> --failure-message "<o que houve>"
   ```

   Fase que falha em silêncio é indistinguível de fase que nunca rodou. Declarar
   a falha é o que impede o app de mentir por omissão.

## O que esta fase NÃO faz

- Não abre PR, não faz merge, não move card em board.
- Não escreve no repo alvo — discovery investiga, não implementa.
- Não decide macro etapa: ela é **derivada** pelo app a partir dos seus fatos.
- Não grava em lugar nenhum além do `outbox.result_path` que a ida pediu.
- Não termina `done` sem uma pessoa de verdade tendo respondido — ver Iron Law.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "Não achei plano nenhum, melhor não gravar nada" | Zero fato = o app não sabe se você rodou. Declare `phase.completed` com o desfecho. |
| "Vou escrever o JSON direto, é mais rápido" | É assim que um campo passa a existir de um lado só. Use o emissor. |
| "A falha foi boba, deixa quieto" | Falha não declarada volta como retrabalho, e a tela fica mentindo até lá. |
| "Invento um plano para o card não ficar vazio" | Card vazio é informação. Plano inventado é dívida. |
| "Ninguém respondeu, mas o plano que eu montaria é óbvio — vou declarar `done`" | Óbvio para você, hoje, sem ter sido estressado por ninguém. Sem gente respondendo, o desfecho é `inconclusive` com as perguntas escritas — nunca um `done` sem `confirmed_by` de verdade. |
| "Rodo num worker em background, ele resolve sozinho e eu só confirmo no fim" | Confirmar o que o worker já decidiu sozinho não é grilling — é carimbo. O worker que voltar sem ter perguntado nada volta com perguntas, não com plano fechado. |
