---
name: esteira-plano-3
description: "Use quando o Donel Dev disparar a fase Plano de um card — o app deixou um `run-input.json` com o discovery e o plano em `subject.plan_id`, e espera de volta os ITENS declarados. Entrevista as escolhas AO VIVO, na sessão, antes de fechar; cada item nasce com tipo e alvo explícitos, e item de código sem repo não entra."
---

# Fase Plano — esteira-donel 3.0.0

Você recebe o discovery já decidido e devolve os **itens de trabalho** que o
plano gera. Um item é uma unidade que alguém vai tocar: uma issue, uma spec, um
ADR, um spike.

## Iron Law

**Todo item tem tipo e alvo declarados. Item de código sem repo alvo não é
emitido.**

Não existe "cai no projeto em foco". Uma fase já abriu no repo errado por causa
dessa inferência (evidência 2 da spec 010), e o custo foi trabalho jogado fora
num checkout que não era o do card.

**E um plano concluído sem nenhum item declarado não é plano — é a evidência 1
pelo avesso.** `outcome: "done"` nesta fase exige `work_item.recorded`: a fase
diz que terminou bem e não deixa nada para a seguinte tomar seria exatamente o
bug que a spec 010 existe para fechar, só que na ponta de saída em vez da
ponta de leitura.

**Assim como Discovery, o grilling roda NA SESSÃO — nunca um worker que quebra
o plano em itens sozinho e volta pedindo só um carimbo.** Quebrar em itens é
decisão (o que cabe numa sessão, o que depende do quê, o que entra junto), não
mecânica. Se você foi disparado sem o dono para responder, pare com as
perguntas registradas em vez de decidir por conta própria — `[A18]` já tranca
a saída fácil por baixo: `outcome: "done"` também exige `gate.confirmed` ou
`decision.recorded`, com `confirmed_by` de uma pessoa de verdade, nunca da
própria skill.

## Antes dos passos — onde moram as ferramentas

As `tools/` do fork ficam **dois níveis acima** desta `SKILL.md`, e a sessão da
fase abre no **repo alvo** — nunca dentro do fork. Caminho relativo (`python
tools/…`) não resolve nada daqui: resolva a raiz uma vez, pela própria
instalação.

```powershell
Split-Path (Split-Path @((Get-Item "$env:USERPROFILE\.claude\skills\esteira-plano-3").Target)[0])
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

   `subject.plan_id` diz **qual** plano você está detalhando — o plano já
   existe (foi declarado no discovery). Você não o redeclara. Se um run
   anterior desta fase ficou `inconclusive` com perguntas nas notas, comece
   por elas.

2. **Quebre em itens que cabem numa sessão — ao vivo, com o dono.** Item que
   precisa de três sessões é dois itens. Isto é entrevista, não preenchimento
   de formulário: "esse item cabe numa sessão?", "esses dois entram juntos ou
   um pode esperar?", "o repo é mesmo esse?" são perguntas que valem estresse
   antes de virar fato. Sem o dono para responder ao vivo, feche
   `inconclusive` com as perguntas escritas em vez de decidir sozinho e pedir
   carimbo depois.

   Cada item recebe:

   - `item_type` — `issue`, `spec`, `process-map`, `adr`, `prototype`, `spike`
     ou `eval`. O tipo decide **como o item termina**: `issue`/`spec` terminam
     por entrega de código; `adr`/`process-map`, por revisão; `spike`/`prototype`
     /`eval`, por **resposta** — inclusive resposta negativa.
   - `target_repo` — obrigatório para `issue`. Um só. Sem ele, não emita.
   - `scope_repos` — os outros repos que o item toca, quando toca.

3. **Declare as relações que importam:**

   - `flows_into` — "A desagua em B": B depende do que A produziu.
   - `ships_with` — "A entra junto com B": os dois sobem ou nenhum sobe.

   Relação não declarada é relação que ninguém vai lembrar na hora de subir.

4. **Aponte os artefatos** com `artifact.recorded`: a spec que você escreveu, o
   documento no vault. `location: "repo"` exige `repo`; `location: "disk"` não
   aceita `repo`. Ponteiro que não resolve não é ponteiro.

5. **Decida o que é fato.** A tabela é a mesma promessa do schema
   (`x-required-facts`), nomeada por esta fase:

   | Fato | Quando é obrigatório |
   |---|---|
   | `work_item.recorded` | quando `outcome: "done"` — plano concluído sem item é a evidência 1 pelo avesso |
   | `phase.completed` | **sempre**, em todo run `status: success` |
   | `gate.confirmed` **ou** `decision.recorded` | quando `outcome: "done"` (A18) |

   **A forma é o corpus, não a memória.** Veja
   `src/shared/esteira/contract/v1/examples/plano-com-itens.json` antes de
   montar `facts.json`: ele mostra os três itens, as duas relações
   (`flows_into` e `ships_with`), um `artifact.recorded` de spec e um
   `decision.recorded` com `rationale` — a forma exata que o emissor espera.

6. **Emita**, sempre com `phase.completed`:

   ```bash
   python <raiz>/tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

7. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 6>
   ```

   Só considere a fase concluída com exit 0. Reclamou, conserte os fatos e
   emita de novo.

## O que esta fase NÃO faz

- Não implementa nada, não cria branch, não abre PR.
- Não inventa item para "encher" o plano — plano de um item é plano.
- Não decide macro etapa: o app deriva do grafo.
- Não termina `done` sem uma pessoa de verdade tendo respondido — ver Iron Law.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "O repo é óbvio, dá para deixar em branco" | Óbvio para você, hoje. O emissor recusa, e é para recusar mesmo. |
| "Depois eu ligo as relações" | Depois é na hora de subir, quando o custo de descobrir a dependência é um rollback. |
| "Esse item é grande, mas dá" | Item que não cabe numa sessão vira handoff no meio, e o contexto se perde na virada. |
| "Não tem item nenhum que valha a pena, mas preciso fechar `done`" | Então o desfecho é `abandoned`, não `done` sem `work_item.recorded` — o emissor recusa mesmo assim. |
| "Já sei como eu quebraria isso, nem preciso perguntar" | É exatamente essa certeza sem estresse que produziu plano que não sobreviveu ao primeiro contato com o código antes. |
