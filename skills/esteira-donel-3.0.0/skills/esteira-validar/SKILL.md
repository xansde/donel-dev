---
name: esteira-validar-3
description: "Use quando o Donel Dev disparar a fase Validar de um item — o app deixou um `run-input.json` com o item em `subject.work_item_id` e espera de volta o que foi examinado, o que ficou registrado para o futuro, e em que estado os dois ficaram. Fase COMPOSTA (E5): roda a verificação sobre o que Implementar deixou E documenta com o que a verificação acabou de ensinar, na mesma sessão. Nunca aprova, nunca mergeia, nunca marca sozinha um roteiro e2e como visto."
---

# Fase Validar (+ Documentar) — esteira-donel 3.0.0

Você recebe um item já construído e faz duas coisas na mesma sessão:

1. **Roda a verificação sobre ele** — review do diff, suíte, lint, tipos, e o
   roteiro e2e de verdade quando o risco pedir.
2. **Registra o que sobreviver ao item** — o que Validar acabou de aprender é
   exatamente o material mais fresco que existe para escrever a decisão, o
   mapa do processo ou a lição, se algo aqui transcender o item.

## Por que uma fase só (E5)

O catálogo tinha `validar` e `documentar` como duas linhas separadas. A regra
que justifica fase própria é **gate humano · olho novo · orçamento de
contexto** — e nenhuma das três separa estas duas: não há aprovação humana
entre elas, quem documenta é o mesmo olho que acabou de rodar a verificação (um
olho novo aqui seria desperdício, não ganho), e o contexto de uma cabe
folgado na sessão da outra. `Documentar` escreve **com** o que `Validar`
construiu — não depois, não com contexto reconstruído. O suporte do contrato a
múltiplos `phase.completed` por run (A22) é o que torna isso possível sem
mudar `run.phase`: esta fase continua se chamando `validar` na ida, e fecha
**duas** fases nos fatos que devolve.

## Iron Law

**Você declara o que VIU rodar. Nada de estado herdado da fase anterior.**

`verification.recorded` é obrigatório aqui porque, em `[D-4]`, *rodar* a
verificação é justamente o que valida. Repetir o `check: passed` que a fase
Implementar declarou, sem ter rodado nada, é fabricar evidência — e evidência
fabricada é pior que evidência ausente: ela sobrevive à revisão humana.

**E um roteiro e2e RODADO não é a mesma coisa que um roteiro e2e ESCRITO.** O
gate antigo conferia a EXISTÊNCIA do arquivo `.spec.ts` na branch — "escrito" e
"rodado" viraram a mesma coisa, e uma fase fechou verde sem ninguém ter
validado. Aqui você DIRIGE o app de verdade, fotografa, gera o relatório — e o
estado do roteiro só sai de `pending` com o veredito **colhido do dono**,
nunca inferido por você sozinha. Ver "3. O roteiro e2e" abaixo.

## Antes dos passos — onde moram as ferramentas

As `tools/` do fork ficam **dois níveis acima** desta `SKILL.md`, e a sessão da
fase abre no **repo alvo** — nunca dentro do fork. Caminho relativo (`python
tools/…`) não resolve nada daqui: resolva a raiz uma vez, pela própria
instalação.

```powershell
Split-Path (Split-Path @((Get-Item "$env:USERPROFILE\.claude\skills\esteira-validar-3").Target)[0])
```

Use o caminho devolvido **por extenso** em todo comando `tools/` daqui para
baixo — é por isso que os exemplos escrevem `<raiz>/tools/…` em vez de uma
variável: variável de shell não sobrevive de um comando para o outro.

Comando sem saída = esta skill não foi instalada por junction (`README.md`,
seção "Instalar"). Pergunte onde está o fork; não adivinhe — a Iron Law desta
fase vale para o seu próprio caminho também.

## Passos

0. **Preflight mecânico.**

   ```bash
   ls docs/relatorio-*.md 2>/dev/null
   ```

   Arquivo encontrado = leia antes de agir; costuma nomear o erro que você
   está prestes a repetir. Nada encontrado, siga.

1. **Leia a ida.**

   ```bash
   python <raiz>/tools/read_input.py --input <run-input.json>
   ```

   `context.history` mostra o que Implementar (e Design, se rodou) declararam.
   Leia como **hipótese a conferir**, não como verdade recebida. Procure por
   `artifact.recorded` apontando um roteiro em
   `.claude/skills/tutorial-e2e/roteiros/*.spec.ts` — é ele que você vai
   rodar no passo 3, se o risco pedir.

2. **Rode a verificação de verdade.** Suíte, tipos, lint, review do diff. Se
   alguma coisa não rodou (ambiente quebrado, dependência ausente), isso é um
   run `failed` com o código do erro — nunca um `passed` "porque provavelmente
   passaria".

   **Classifique o risco** da mudança (trivial ou sensível) e registre-o no
   `phase.completed` de `validar` — é este campo, não um relatório à parte,
   que liga o gate do roteiro e2e no passo seguinte.

3. **O roteiro e2e — rode de verdade, uma bateria por vez.** Se o risco
   classificado é `sensivel` (isto liga o gate no contrato: `[A16]`):

   a. Se `context.history`/as notas não apontam nenhum roteiro para este item,
      isso é uma lacuna — registre em `note.recorded` e, se couber na sessão,
      escreva um roteiro curto seguindo a skill `tutorial-e2e`
      (`referencias/roteiro.md`) antes de continuar. Não pule o gate inventando
      que não havia nada para rodar.

   b. Para CADA roteiro relevante ao item, na raiz do repo alvo
      (`workspace.repo_path`/`worktree_path`):

      ```bash
      npx playwright test -c .claude/skills/tutorial-e2e/lib/playwright.config.ts <nome-do-roteiro>.spec.ts
      node .claude/skills/tutorial-e2e/lib/relatorio.mjs <nome-do-roteiro>
      ```

      (Convenção deste repo — donel-dev. Se `target_repo` for outro e tiver
      tooling equivalente, use o dele; o que não muda é rodar de verdade e
      colher veredito humano, não a ferramenta exata.)

   c. **Olhe os prints você mesma primeiro** — a mesma Iron Law da skill
      `tutorial-e2e`: um relatório que ninguém olhou não prova nada. Isto pega
      o óbvio antes de gastar o tempo do dono.

   d. **Depois, uma bateria por vez, peça o veredito do dono.** Mostre o
      relatório (ou aponte o caminho do HTML), faça UMA pergunta, espere a
      resposta, só então grave o estado e passe para o roteiro seguinte — se
      houver mais de um. Nunca junte várias baterias numa pergunta só: quem
      responde precisa poder discordar de uma sem travar as outras.

   e. O estado do `verification.recorded` de `verification_kind: "e2e-manual"`
      só vira `passed` ou `failed` com esse veredito **colhido**. Sem
      resposta ainda, ele fica `pending` — e isso é legítimo (A19: esperar por
      gente não é falha). O que não pode é você registrar aprovação humana
      (`gate.confirmed`, ou uma `review` que passou) enquanto o e2e ainda está
      `pending` — o emissor recusa, e é para recusar mesmo.

4. **Decida se o que você aprendeu transcende o item (o lado Documentar).** Só
   vira ADR o que alguém precisaria saber em três meses e não descobriria lendo
   o código. Documento escrito por obrigação de processo não é lido por
   ninguém e ainda envelhece — se não há o que registrar além do que já está
   no código e no PR, `phase.completed` de `documentar` com `abandoned` e uma
   nota dizendo por quê é um desfecho honesto. Isto é o desfecho **normal**
   para a maioria dos itens pequenos; não force um ADR para preencher espaço.

5. **Quando houver o que registrar, escolha o lugar `[D-8]`:**
   - documentação de família (`spec`, `process-map`, `adr`) vai para o **repo
     âncora** — no Spotsys, tudo em `spotsys`, mesmo afetando `api-spotsys`;
   - quando não faz sentido versionar, o artefato fica no disco — e o store
     guarda o ponteiro do mesmo jeito.
   - o relatório de review em si (o que a verificação encontrou) costuma ficar
     em disco — não versionar relatório efêmero paga mais.

6. **Decida o que é fato.** A tabela é a mesma promessa do schema
   (`x-required-facts`), nomeada pelas DUAS fases que este run fecha:

   | Fato | Quando é obrigatório |
   |---|---|
   | `verification.recorded` | **sempre pelo menos um**, quando `outcome: "done"` de `validar` — um por coisa examinada (suíte, review, e2e-manual, PR já aberto) |
   | `artifact.recorded` | quando `outcome: "done"` de `documentar` — o ponteiro do que foi registrado |
   | `phase.completed` (subject do item, `phase: "validar"`) | **sempre**, em todo run `status: success` — é a fase que este run se declara ser (`run.phase`) |
   | `phase.completed` (subject do item, `phase: "documentar"`) | **sempre que `validar` fechar bem** — a fase composta responde pelas duas, mesmo quando o desfecho de `documentar` é `abandoned` |

   E o resto:
   - `artifact.recorded` do relatório de review — `location: "disk"` na
     maioria das vezes.
   - `note.recorded` — o que o revisor humano precisa saber antes de olhar; a
     lacuna do passo 3a, se houve; o que ficou fora do documento de propósito.

   **A forma é o corpus, não a memória.** Veja
   `docs/esteira-dev/contract/v1/examples/validar-com-pr.json` (o
   `e2e-manual` ainda `pending`, com o roteiro apontado em `ref`, e a
   checklist do que sobra para o dono) e
   `docs/esteira-dev/contract/v1/examples/documentar-adr.json` (o
   `artifact.recorded` de um ADR, com a nota de por que foi para o repo
   âncora) antes de montar `facts.json`. Nenhum dos dois exemplos ainda mostra
   os DOIS `phase.completed` juntos num run só — monte essa parte seguindo o
   padrão de `implementar-que-fecha-o-ciclo.json`, que fecha múltiplas fases
   no mesmo result (A22).

7. **Emita.**

   ```bash
   python <raiz>/tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   Achado bloqueante **não** vira run `failed`: a fase rodou e cumpriu o
   trabalho dela. O que reprova é a `verification.recorded` com `state:
   failed` — e é isso que o card mostra.

8. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 7>
   ```

   Só considere a fase concluída com exit 0. Reclamou, conserte os fatos e
   emita de novo.

## O que esta fase NÃO faz

- **Não aprova PR, não faz merge, não move card.** A aprovação é humana e mora
  no repositório; aqui ela só é **registrada** quando já existe.
- Não abre PR — nem esta fase nem nenhuma outra.
- Não conserta o que achou. Achado vira item novo ou volta para Implementar; a
  fase que valida não é a que corrige, senão ninguém valida a correção.
- Não marca sozinha um roteiro e2e como visto — ver Iron Law.
- Não publica documentação em lugar nenhum fora do que o ponteiro declara:
  Slack, board ou quem quer que seja é gesto humano.
- Não decide macro etapa: o app deriva do grafo `[D-13]`.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "A fase anterior disse que passou" | Ela declarou o que ela viu. Se você não rodou, você não viu — e declarar assim mesmo é fabricar evidência. |
| "Só um teste falhou, dá para declarar `passed`" | O estado é `failed`. Um achado declarado é barato; um achado escondido custa em produção. |
| "Achei problema, então o run falhou" | Não. O run cumpriu o trabalho: quem reprova é a verificação, não a fase. |
| "Já que estou aqui, eu conserto" | Aí ninguém valida a correção. Achado vira item, não emenda silenciosa. |
| "Aproveito e aprovo o PR" | Aprovação é ato humano, sempre — e é o que a fase Concluir vai ler. |
| "Rodei o roteiro, os prints parecem bons, já marco `passed`" | Você olhou; o dono não. O estado só sai de `pending` com o veredito COLHIDO — não inferido de "parece bom". |
| "São três roteiros, pergunto os três de uma vez pra ser mais rápido" | Aí uma resposta ruim trava as outras duas sem necessidade. Uma bateria, uma resposta, a próxima. |
| "Está no PR/no chat, já está documentado" | PR e chat não são endereço estável. Sem ponteiro declarado, ninguém acha em três meses. |
| "Documento tudo, por garantia" | Documento que ninguém lê envelhece e passa a mentir. Registre o que transcende o item; o resto é ruído com data de validade. |
| "Não sobrou nada para documentar, deixo a fase em branco" | `abandoned` com a razão escrita é o desfecho honesto — mas o `phase.completed` de `documentar` ainda precisa existir. |
