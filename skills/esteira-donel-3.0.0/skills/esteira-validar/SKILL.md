---
name: esteira-validar
description: Use quando o Donel Dev disparar a fase Validar de um item — o app deixou um `run-input.json` com o item em `subject.work_item_id` e espera de volta o que foi examinado e em que estado ficou. Roda a verificação sobre o que a fase Implementar deixou; nunca aprova nem mergeia.
---

# Fase Validar — esteira-donel 3.0.0

Você recebe um item já construído e **roda a verificação sobre ele**: review do
diff, suíte, lint, tipos — o que o repo alvo tiver. Depois declara o que
examinou e com que resultado.

## Iron Law

**Você declara o que VIU rodar. Nada de estado herdado da fase anterior.**

`verification.recorded` é obrigatório aqui porque, em `[D-4]`, *rodar* a
verificação é justamente o que valida. Repetir o `check: passed` que a fase
Implementar declarou, sem ter rodado nada, é fabricar evidência — e evidência
fabricada é pior que evidência ausente: ela sobrevive à revisão humana.

## Passos

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `context.history` mostra o que a fase Implementar declarou. Leia como
   **hipótese a conferir**, não como verdade recebida.

2. **Rode a verificação de verdade.** Suíte, tipos, lint, review do diff. Se
   alguma coisa não rodou (ambiente quebrado, dependência ausente), isso é um
   run `failed` com o código do erro — nunca um `passed` "porque provavelmente
   passaria".

3. **Classifique o risco** da mudança e registre-o onde o repo alvo espera. O
   risco não é fato do contrato: ele entra como `note.recorded` ou no relatório
   apontado por `artifact.recorded`.

4. **Decida o que é fato:**

   - `verification.recorded` — **obrigatório**, um por coisa examinada:
     - `check` — a suíte/lint/tipos, com o estado em que ficou;
     - `review` — o code review, `passed` quando não sobrou bloqueio,
       `failed` quando sobrou;
     - `pull-request` — quando já existe PR aberto (por gesto humano), com
       `state: pending` enquanto ninguém o aprovou. O `ref` é a URL.
   - `artifact.recorded` — o relatório do review. Costuma ser `location:
     "disk"` (não versionar relatório efêmero paga mais).
   - `note.recorded` — o que o revisor humano precisa saber antes de olhar.
   - `phase.completed` — **obrigatório**. `done` quando a validação terminou
     (mesmo com achado: o achado está declarado), `abandoned` quando o item foi
     descartado aqui, `inconclusive` quando não deu para concluir a validação.

5. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   Achado bloqueante **não** vira run `failed`: a fase rodou e cumpriu o
   trabalho dela. O que reprova é a `verification.recorded` com `state:
   failed` — e é isso que o card mostra.

## O que esta fase NÃO faz

- **Não aprova PR, não faz merge, não move card.** A aprovação é humana e mora
  no repositório; aqui ela só é **registrada** quando já existe.
- Não abre PR — nem esta fase nem nenhuma outra.
- Não conserta o que achou. Achado vira item novo ou volta para Implementar; a
  fase que valida não é a que corrige, senão ninguém valida a correção.
- Não decide macro etapa: o app deriva do grafo `[D-13]`.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "A fase anterior disse que passou" | Ela declarou o que ela viu. Se você não rodou, você não viu — e declarar assim mesmo é fabricar evidência. |
| "Só um teste falhou, dá para declarar `passed`" | O estado é `failed`. Um achado declarado é barato; um achado escondido custa em produção. |
| "Achei problema, então o run falhou" | Não. O run cumpriu o trabalho: quem reprova é a verificação, não a fase. Confundir os dois apaga a diferença entre "não rodou" e "rodou e reprovou". |
| "Já que estou aqui, eu conserto" | Aí ninguém valida a correção. Achado vira item, não emenda silenciosa. |
| "Aproveito e aprovo o PR" | Aprovação é ato humano, sempre — e é o que a fase Concluir vai ler. |
