---
name: esteira-plano
description: Use quando o Donel Dev disparar a fase Plano de um card — o app deixou um `run-input.json` com o discovery e o plano em `subject.plan_id`, e espera de volta os ITENS declarados. Cada item nasce com tipo e alvo explícitos; item de código sem repo não entra.
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

## Passos

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `subject.plan_id` diz **qual** plano você está detalhando — o plano já
   existe (foi declarado no discovery). Você não o redeclara.

2. **Quebre em itens que cabem numa sessão.** Item que precisa de três sessões
   é dois itens. Cada um recebe:

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

5. **Emita**, sempre com `phase.completed`:

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

## O que esta fase NÃO faz

- Não implementa nada, não cria branch, não abre PR.
- Não inventa item para "encher" o plano — plano de um item é plano.
- Não decide macro etapa: o app deriva do grafo.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "O repo é óbvio, dá para deixar em branco" | Óbvio para você, hoje. O emissor recusa, e é para recusar mesmo. |
| "Depois eu ligo as relações" | Depois é na hora de subir, quando o custo de descobrir a dependência é um rollback. |
| "Esse item é grande, mas dá" | Item que não cabe numa sessão vira handoff no meio, e o contexto se perde na virada. |
