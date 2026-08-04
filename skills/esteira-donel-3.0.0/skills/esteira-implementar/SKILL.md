---
name: esteira-implementar
description: Use quando o Donel Dev disparar a fase Implementar de um item — o app deixou um `run-input.json` com o item em `subject.work_item_id` e espera de volta o que foi construído E o que pode ser conferido. Escreve código e teste na branch do item; nunca abre PR.
---

# Fase Implementar — esteira-donel 3.0.0

Você recebe **um item** já decidido e o constrói. O item é a unidade: uma
issue, uma spec, um ADR, um spike. O tipo dele decide como ele termina — e é
por isso que "implementar" não quer dizer a mesma coisa nos três ciclos.

| Ciclo do item `[D-4]` | Tipos | O que implementar significa aqui |
|---|---|---|
| Entrega de código | `issue`, `spec` | código e **teste** na branch do item |
| Artefato revisado | `process-map`, `adr` | o documento escrito, pronto para revisão |
| Pergunta respondida | `prototype`, `spike`, `eval` | a investigação feita e a **resposta**, inclusive negativa |

## Iron Law

**Toda fase Implementar termina declarando algo que outra pessoa consegue
conferir — e "não deu certo" conta.**

O contrato cobra `verification.recorded` de todo run bem-sucedido desta fase.
Não é burocracia: sem ela, "implementei" é afirmação sem lastro, e um item que
ninguém consegue verificar é indistinguível de um item que ninguém tocou. Foi
essa indistinção — ausência lida como negação — que produziu a tela mentirosa
de 03/08.

## Passos

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `context.work_item` diz **o quê**: tipo, título, repo alvo e estado.
   `workspace` diz **onde**: o repo alvo veio explícito do disparo `[D-6]` —
   nunca abra a sessão noutro checkout porque "é obviamente esse". O
   `context.history` traz as fases anteriores, inclusive as que falharam, com o
   código do erro: repetir uma tentativa já reprovada é o desperdício mais caro
   da esteira.

2. **Construa, com teste antes quando for código de produção.** A disciplina de
   TDD do repo alvo vale aqui: teste que falha → implementação mínima →
   refatora. Escrever a verificação é implementar; **rodar** a verificação como
   gate é a fase seguinte.

3. **Se o item não couber**, não force. Item que precisa de três sessões era
   dois itens: declare o que foi feito, use `phase.completed` com
   `inconclusive` e uma nota dizendo onde parou. Meia entrega declarada é
   informação; meia entrega escondida é retrabalho.

4. **Decida o que é fato:**

   - `verification.recorded` — **obrigatório**. O que dá para conferir:
     - `check` — a verificação que você escreveu e rodou (`state: passed` se
       ficou verde, `failed` se você está entregando com ela vermelha e sabe
       disso);
     - `review` — o documento pronto para alguém revisar (`state: pending`);
     - `conclusion` — a resposta do spike/eval, inclusive "não dá"
       (`state: passed` = a pergunta foi respondida; o texto vai em `ref`).
     - `pull-request` **não** é desta fase: aqui não se abre PR.
   - `artifact.recorded` — o ponteiro do que ficou fora do código: a spec, o
     documento, o relatório. `location: "repo"` exige `repo`; `location:
     "disk"` proíbe. Ponteiro que não resolve não é ponteiro `[D-8]`.
   - `note.recorded` — o que um humano precisa ler depois e não cabe em campo.
   - `phase.completed` — **obrigatório**, com o outcome certo: `done` quando
     entregou, `abandoned` quando o item morreu aqui, `inconclusive` quando
     terminou sem fechar. As três são respostas.

5. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   O emissor recusa o que o app recusaria: fase sem os fatos que ela promete,
   id fora do padrão, artefato com ponteiro que não resolve. Se ele reclamar,
   **conserte o fato — não contorne a ferramenta**.

6. **Se a fase falhou**, emita mesmo assim:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status failed --failure-code <código> --failure-message "<o que houve>"
   ```

   Run que falhou **não** é cobrado pela tabela de fatos: o que se cobra é
   promessa cumprida. O que ele precisa é do motivo — "falhou, não sei por quê"
   é o mesmo "não sei" travestido de fato.

## O que esta fase NÃO faz

- **Não abre PR, não faz merge, não move card em board.** Nunca foi da skill.
- Não conclui o item: quem declara o ciclo encerrado é a fase Concluir, e só
  com a verificação que passou.
- Não cria item novo — isso é da fase Plano (ou de uma invocação explícita da
  skill de criação, `[D-16]`).
- Não decide macro etapa: ela é **derivada** pelo app a partir dos seus fatos
  `[D-13]`.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "O código está lá, o app que veja" | O app não olha repo. O que você não declara, não aconteceu — e a tela vai dizer exatamente isso. |
| "Não tem o que verificar nesse item" | Então tem uma resposta: declare `conclusion`. Item sem nada conferível é item que ninguém sabe se foi feito. |
| "Deixa eu já abrir o PR, é o mesmo gesto" | Não é. PR é ato humano, e a fase que o registra é Concluir. |
| "O teste ficou vermelho, declaro `passed` e arrumo depois" | Aí a tela mente por escrito, e com a sua assinatura. `failed` é um estado; mentira não é. |
| "O repo é óbvio, uso o que está aberto" | Foi esse palpite que abriu uma fase no repo errado (evidência 2 da spec). O alvo vem do `workspace`. |
