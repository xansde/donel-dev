---
name: esteira-discovery
description: Use quando o Donel Dev disparar a fase Discovery de um card — o app deixou um `run-input.json` no inbox e espera o `result.json` de volta. Entrevista o problema até virar decisões, e DECLARA o que aconteceu; nunca deixa o app deduzir.
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

## Passos

1. **Leia a ida.** O caminho do `run-input.json` vem no disparo.

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   Ele traz: o discovery (título, problema, tracker, repo alvo, escopo), o
   histórico das fases que já rodaram — **inclusive as que falharam, com o
   código do erro** — e as notas. Leia o histórico antes de começar: repetir
   uma tentativa que já falhou é o desperdício mais caro da esteira.

2. **Entreviste até doer.** Use a disciplina de `grilling`: uma pergunta por
   vez, atrás do problema real, não da solução que já veio pronta. Discovery
   que aceita o enunciado do card sem estressá-lo produz plano que não sobrevive
   ao primeiro contato com o código.

3. **Decida o que é fato.** Ao fim, o que você tem para declarar:

   - `discovery.recorded` — **sempre**. Título, problema, tracker (se houver),
     repo alvo e escopo. É a raiz do card.
   - `plan.recorded` — um por plano proposto. **Zero planos é um desfecho
     legítimo**: se a resposta foi "não vale a pena mexer nisso", não invente
     um plano para preencher espaço. O app mostra "sem plano registrado", que é
     a verdade.
   - `relation.recorded` — `originated` do discovery para cada plano.
   - `note.recorded` — o que um humano precisa ler depois e não cabe em campo:
     hipóteses descartadas, o que ficou em aberto.
   - `phase.completed` — **obrigatório**. `done` quando terminou,
     `abandoned` quando o card morreu aqui, `inconclusive` quando faltou base
     para decidir. As três são respostas; nenhuma delas é vergonha.

4. **Emita.** Monte `facts.json` (uma lista) e chame:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   O emissor recusa o que o app recusaria: id fora do padrão, item `issue` sem
   repo alvo, fase concluída sem os fatos que ela promete. Se ele reclamar,
   **conserte o fato — não contorne a ferramenta**.

5. **Se a fase falhou**, emita mesmo assim:

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

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "Não achei plano nenhum, melhor não gravar nada" | Zero fato = o app não sabe se você rodou. Declare `phase.completed` com o desfecho. |
| "Vou escrever o JSON direto, é mais rápido" | É assim que um campo passa a existir de um lado só. Use o emissor. |
| "A falha foi boba, deixa quieto" | Falha não declarada volta como retrabalho, e a tela fica mentindo até lá. |
| "Invento um plano para o card não ficar vazio" | Card vazio é informação. Plano inventado é dívida. |
