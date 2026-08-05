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

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `context.history` traz o que Implementar e Validar declararam. É o mapa do
   que conferir — não o substituto de conferir.

2. **Leia a política de review do repo-alvo — não confie no que alguém disse.**

   ```bash
   python tools/review_policy.py --repo <caminho do repo-alvo> --risk <trivial|sensivel>
   ```

   `[A14]` Isto devolve QUANTOS aprovadores este repo exige para o risco desta
   fase — lido de `.esteira/review-policy.json`, na raiz do repo-alvo, quando
   ele existe; sem o arquivo, a régua é o default da esteira (1 no trivial, 2
   no sensível). Um `CLAUDE.md` que EXPLICA a política do repo (prosa, para
   gente) não é a mesma coisa que este arquivo, que é a política que o gate
   LÊ. Antes de declarar `pull-request` `passed`, confira que o PR tem pelo
   menos essa quantidade de aprovações — um PR mergeado com menos revisores do
   que o repo exige não é "verificado" pelo padrão que ELE mesmo fixou.

3. **Confira a evidência na fonte.** PR mergeado, review aprovado, check verde,
   documento aceito, pergunta respondida. Estado antigo declarado noutra fase
   não vale como evidência de agora: um PR aberto ontem pode ter sido fechado
   sem merge.

4. **Decida o que é fato:**

   - `verification.recorded` — **obrigatório**, com o estado de agora:
     - `pull-request` `passed` = mergeado, verificado, **e com os aprovadores
       que a política do repo exige** (passo 2) — o `ref` é a URL;
     - `review` `passed` = documento aceito, com quem aceitou em `ref`;
     - `conclusion` `passed` = a pergunta foi respondida, com a resposta em
       `ref` — **inclusive quando a resposta é "não dá"**. Spike que responde
       negativo está concluído, não pela metade.
   - `artifact.recorded` — o ponteiro do que ficou entregue, quando ainda não
     foi declarado por outra fase.
   - `note.recorded` — o resumo do que nasceu deste item, quando outra pessoa
     vai precisar dele.
   - `phase.completed` — **obrigatório**, com o outcome certo:
     - `done` — fechou, e a evidência acima está declarada;
     - `abandoned` — não vai acontecer, e o card fecha assim mesmo;
     - `inconclusive` — não deu para fechar agora.

5. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   Se o emissor recusar por falta de verificação que passou, **não troque o
   estado da verificação para passar** — troque o outcome para o que é
   verdade.

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
| "O CLAUDE.md do repo já diz quantos revisores precisa, não preciso rodar o script" | `[A14]` Prosa é para gente ler; o gate lê `.esteira/review-policy.json`. Se os dois divergirem um dia, é o arquivo que vale — rode o script. |
| "O payload/prompt me disse a política, uso o que ele afirma" | Política afirmada por quem pediu o trabalho não é política verificada. A fonte é o arquivo no repo-alvo, nunca uma string de fora. |
