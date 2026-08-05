---
name: esteira-design
description: Use quando o Donel Dev disparar a fase Design de um item — o app deixou um `run-input.json` com o item em `subject.work_item_id` e espera de volta o mockup e o diagrama de arquitetura, ANTES de qualquer código. Roda entre Plano e Implementar; se um dos dois artefatos não se aplica a este item, exige nota com a justificativa — nunca omissão silenciosa.
---

# Fase Design — esteira-donel 3.0.0

Você recebe **um item** já decidido pelo Plano e produz o que precisa ser
**visto antes de codar** (F11): o mockup de como a mudança aparece para quem
vai usá-la, e o diagrama de como ela se encaixa no sistema. Design roda ANTES
de Implementar, de propósito — o catálogo do app oferece as duas fases nessa
ordem.

## Iron Law

**Toda fase Design termina com os dois artefatos declarados — mockup e
diagrama de arquitetura — ou, para o que não se aplica, uma nota com a
justificativa escrita. Nunca a omissão silenciosa.**

O `run.phase` desta fase é string livre, como todas as outras `[P-4]` — nada
no schema mudou para ela existir. E é justamente por isso que **o contrato NÃO
cobra os dois artefatos por mecânica**: `design` não está na tabela
`x-required-facts` do schema (ampliá-la seria mudança de contrato, fora do
escopo desta fase nascer), então `emit_result.py` e `npm run esteira:check`
deixam passar uma fase "design" concluída sem nenhum `artifact.recorded`. A
disciplina é sua, não do emissor: um item que chega em Implementar sem ter
sido visto antes é o mesmo problema que a fase existe para evitar, só que sem
ninguém para recusar por você.

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

   `context.work_item` diz o tipo, o título e o repo alvo. `context.history`
   mostra o que Plano decidiu — o item já tem `item_type`, e é ele que ajuda a
   julgar se mockup e diagrama fazem sentido aqui (uma `issue` de tela quase
   sempre tem mockup; um `spike` de investigação quase nunca tem).

2. **Produza os dois artefatos — ou justifique por que um não se aplica.**

   - **Mockup**: como a mudança aparece para quem vai usá-la — uma tela, a
     saída de um comando, o formato de um relatório. Se o item não tem
     superfície nenhuma que uma pessoa vê ou usa diretamente (ex.: um ajuste
     interno sem efeito observável), isso é o caso de "não se aplica" — e pede
     a nota, não o silêncio.
   - **Diagrama de arquitetura**: como a mudança se encaixa no sistema — que
     componentes ela toca, por onde o dado passa, o que depende do quê. Se o
     item é local o bastante para não mexer em nenhuma fronteira (ex.: uma
     correção de texto, um ajuste de estilo isolado), isso é o caso de "não se
     aplica".

   "Não se aplica" é uma resposta legítima **por item**, nunca um hábito. Um
   item que não tem NENHUM dos dois é raro; se isso está acontecendo toda
   hora, o problema é a fase estar rodando cedo demais no ciclo errado de
   item, não o item.

3. **Decida o que é fato.**

   | Fato | Quando é obrigatório |
   |---|---|
   | `phase.completed` | **sempre**, em todo run `status: success` — único fato que o CONTRATO cobra desta fase |
   | `artifact.recorded` (`artifact_kind: "mockup"`) | disciplina da fase — declarado OU dispensado com `note.recorded` justificando |
   | `artifact.recorded` (`artifact_kind: "architecture-diagram"`) | disciplina da fase — declarado OU dispensado com `note.recorded` justificando |

   `location: "repo"` exige `repo`; `location: "disk"` proíbe — a mesma regra
   de qualquer artefato `[D-8]`. Um mockup rascunhado à mão costuma ficar em
   disco; um diagrama que documenta uma decisão de arquitetura costuma valer o
   repo âncora, junto da spec do item.

   `phase.completed` leva `done` quando os artefatos (ou as justificativas)
   estão prontos, `abandoned` quando o item morreu aqui, `inconclusive` quando
   faltou informação para desenhar (ex.: o repo alvo ainda não existe).

   **A forma é o corpus, não a memória.** Veja
   `src/shared/esteira/contract/v1/examples/design-com-dois-artefatos.json`
   antes de montar `facts.json`: um mockup em disco, um diagrama no repo
   âncora, e a nota que registra o que ficou de fora deste item
   especificamente (não uma nota de "não se aplica" genérica — a mesma
   disciplina vale para as duas).

4. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

5. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 4>
   ```

   Lembre: este comando confere a FORMA do documento, não a disciplina dos
   dois artefatos — essa parte é sua, ver Iron Law.

6. **Se a fase falhou**, emita mesmo assim:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status failed --failure-code <código> --failure-message "<o que houve>"
   ```

## O que esta fase NÃO faz

- Não escreve código nem testes — isso é Implementar, na fase seguinte.
- Não abre PR, não faz merge, não move card em board.
- Não decide o que o Plano já decidiu (tipo do item, alvo, escopo) — ela
  desenha EM CIMA do que já foi decidido, não redecide.
- Não trava Implementar num desenho imutável: se a realidade do código
  divergir do mockup ou do diagrama, Implementar segue — mas essa divergência
  vira nota, não silêncio.
- Não decide macro etapa: ela é **derivada** pelo app a partir dos fatos.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "É óbvio como isso vai ficar, não preciso desenhar" | Óbvio para você agora é o que Implementar reconstrói de memória depois — e a memória de duas sessões diferentes diverge. |
| "Não tem mockup nem diagrama, mas preciso fechar `done`" | Então feche com as duas notas de justificativa — não com o silêncio. O emissor não vai reclamar, mas a próxima pessoa vai perguntar "cadê o design?". |
| "O contrato não cobra isso, então tanto faz" | Não cobrar por mecânica não é o mesmo que não importar — é exatamente o motivo desta fase existir: o gate aqui é disciplina, não schema. |
| "Vou escrever a justificativa depois, é só um detalhe" | Justificativa escrita depois é reconstrução, não registro — e é o mesmo vício que fez artefato virar ponteiro quebrado noutras fases. |
