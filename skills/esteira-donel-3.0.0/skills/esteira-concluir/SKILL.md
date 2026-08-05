---
name: esteira-concluir
description: Use quando o Donel Dev disparar a fase Concluir de um item — o app deixou um `run-input.json` e espera de volta a EVIDÊNCIA que fecha o ciclo. É gate, não carimbo: sem verificação que passou, o emissor recusa declarar concluído.
---

# Fase Concluir — esteira-donel 3.0.0

Você fecha o ciclo de vida do item — e o ciclo depende do tipo `[D-4]`:

| Ciclo | Tipos | Termina quando |
|---|---|---|
| Entrega de código | `issue`, `spec` | PR mergeado **e verificado** |
| Artefato revisado | `process-map`, `adr` | documento publicado **e aceito** |
| Pergunta respondida | `prototype`, `spike`, `eval` | conclusão registrada — "não deu certo" é desfecho válido |

## Iron Law

**`done` exige uma `verification.recorded` com `state: passed`. Sem ela, o
emissor recusa — e recusar é o certo.**

Esta é a única fase em que o app passa a dizer "Concluído" na tela. Uma
conclusão sem evidência transforma a tela num carimbo: exatamente a inverdade
de 03/08, só que na direção contrária — em vez de negar o que aconteceu, ela
afirmaria o que ninguém leu. Se a entrega não passou, o desfecho honesto
existe: `abandoned` ou `inconclusive`, que **não** exigem nada.

## Passos

0. **Preflight mecânico.**

   ```bash
   ls docs/relatorio-*.md 2>/dev/null
   ```

   Arquivo encontrado = leia antes de agir; costuma nomear o erro que você
   está prestes a repetir. Nada encontrado, siga.

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `context.history` traz o que Implementar e Validar (que agora também fecha
   Documentar, `[E5]`) declararam. É o mapa do que conferir — não o substituto
   de conferir.

2. **Confira a evidência na fonte.** PR mergeado, review aprovado, check verde,
   documento aceito, pergunta respondida. Estado antigo declarado noutra fase
   não vale como evidência de agora: um PR aberto ontem pode ter sido fechado
   sem merge.

3. **Decida o que é fato.** A tabela é a mesma promessa do schema
   (`x-required-facts`), nomeada por esta fase:

   | Fato | Quando é obrigatório |
   |---|---|
   | `verification.recorded` | quando `outcome: "done"` — e precisa ter pelo menos uma com `state: "passed"` (o dente de D-4) |
   | `phase.completed` | **sempre**, em todo run `status: success` |

   O que `verification.recorded` pode ser, com o estado de agora:
   - `pull-request` `passed` = mergeado e verificado (o `ref` é a URL);
   - `review` `passed` = documento aceito, com quem aceitou em `ref`;
   - `conclusion` `passed` = a pergunta foi respondida, com a resposta em
     `ref` — **inclusive quando a resposta é "não dá"**. Spike que responde
     negativo está concluído, não pela metade.

   E o resto:
   - `artifact.recorded` — o ponteiro do que ficou entregue, quando ainda não
     foi declarado por outra fase.
   - `note.recorded` — o resumo do que nasceu deste item, quando outra pessoa
     vai precisar dele.

   `phase.completed` leva o outcome certo: `done` — fechou, e a evidência
   acima está declarada; `abandoned` — não vai acontecer, e o card fecha assim
   mesmo; `inconclusive` — não deu para fechar agora.

   **A forma é o corpus, não a memória.** Veja
   `src/shared/esteira/contract/v1/examples/concluir-entrega-verificada.json`
   (PR mergeado, `channel` declarado — `[A15]`) e
   `concluir-desfecho-revisto.json` (uma revisão de desfecho, `[A13]`) antes de
   montar `facts.json`.

4. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   Se o emissor recusar por falta de verificação que passou, **não troque o
   estado da verificação para passar** — troque o outcome para o que é
   verdade.

5. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 4>
   ```

   Só considere a fase concluída com exit 0. Reclamou, conserte os fatos e
   emita de novo.

## O que esta fase NÃO faz

- **Não faz merge, não aprova PR, não move card em board.** Merge e aprovação
  são humanos; a movimentação no tracker é espelho do app `[D-12]`, e espelho
  nunca é a fonte.
- Não conclui o **card** — ela conclui o item. A macro etapa do card é
  derivada: ela vira Concluído quando todos os itens estiverem fechados ou
  abandonados `[D-13]`.
- Não fecha o que não é dela: item irmão continua aberto, e é assim mesmo.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "O PR está aberto e vai mergear, declaro `done`" | Vai ≠ foi. `pending` é o estado; `done` sem merge é a tela mentindo com a sua assinatura. |
| "A fase Validar já disse que passou" | Ela declarou o estado daquele momento. Concluir confere agora — foi para isso que ela existe. |
| "O emissor recusou; mudo o `state` para `passed`" | Isso é fraudar o gate que você mesmo pediu. Mude o **outcome**, não a evidência. |
| "O spike deu negativo, então não concluo" | Resposta negativa é resposta. `conclusion` + `passed` com o "não dá" escrito no `ref`, e `outcome: done`. |
| "Aproveito e movo o card no board" | Movimentação de board é espelho, e é do app. Skill que mexe no tracker recria a trava órfã que a spec extinguiu. |
