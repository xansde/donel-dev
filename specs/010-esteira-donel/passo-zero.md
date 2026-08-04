# Passo zero — contrato, store e teste de contrato

**Status:** 🟡 para revisão (2026-08-03). É o passo 1 da cadência `[D-15]` da
[spec 010](./spec.md): *schema do contrato e formato do store, escritos e
revisados. Sem UI.*

**O que este passo entrega:** o schema do `result.json`, o formato do store
local e o mecanismo que amarra os dois lados. **Nada é ligado ao app** — não há
ingestão, watcher, reducer, derivação nem tela. Os módulos escritos aqui são
puros e testados; ninguém os importa ainda, de propósito.

**Arquivos:**

| Arquivo | Papel |
|---|---|
| `src/shared/esteira/contract/v1/esteira-result.schema.json` | **o contrato** — arquivo canônico, referenciado pelos dois lados |
| `src/shared/esteira/contract/v1/examples/*.json` | golden corpus — 6 documentos que os dois lados usam como fixture |
| `src/shared/esteira/contract/resultContract.ts` | lado app: tipos + parser + `CONSUMED_PATHS` |
| `src/shared/esteira/store/storeFormat.ts` | formato do store: cabeçalho, envelope de evento, forma do snapshot |
| `tests/esteiraContractCoverage.test.ts` | **o teste de contrato** (lado app) |
| `tests/esteiraResultContract.test.ts` | comportamento do parser |
| `tests/esteiraStoreFormat.test.ts` | comportamento do formato do store |

---

## 1. O contrato app ↔ skills `[D-10]`

### A troca de modelo: fatos declarados, não campos inferidos

O bug de 03/08 não foi um campo com nome errado. Foi o app **deduzir** que
"houve plano" da presença de `outputs.plan_cards[]` — um campo opcional que a
skill 2.1.0 nunca gravou. Ausência virou "não aconteceu", e "não aconteceu"
virou uma inverdade na tela.

O contrato v1 elimina a dedução. O `result.json` não descreve *campos de
saída*; ele declara uma lista de **fatos** tipados. A skill diz o que
aconteceu; o app registra. O que a skill não declara, não aconteceu — e quando
ela deveria ter declarado e não declarou, isso é **erro de ingestão com
caminho**, não silêncio.

### Envelope

```jsonc
{
  "contract_version": "1.0.0",   // semver DO CONTRATO, não da skill
  "kind": "esteira.result",      // discriminante: rejeita JSON alheio na pasta
  "run":   { "run_id", "phase", "status", "started_at", "finished_at", "failure" },
  "actor": { "tool", "tool_version", "executor", "model", "effort", "cli_session_id" },
  "subject": { "discovery_id", "plan_id", "work_item_id" },
  "workspace": { "target_repo", "repo_path", "worktree_path", "branch" } | null,
  "facts": [ … ]
}
```

Quatro escolhas que valem explicação:

- **`run.phase` é string livre**, não enum. `[P-4]` deixou os nomes das fases
  por ciclo de vida em aberto; um enum aqui fecharia essa decisão por acidente.
  O padrão (`^[a-z][a-z0-9-]*$`) é a única amarra.
- **`run.run_id` é a chave de idempotência da ingestão.** Reprocessar o mesmo
  arquivo não duplica fato no store.
- **`workspace` pode ser `null`** — discovery investiga um problema, não um
  repositório. Quando existe, `target_repo` é **obrigatório**: é o alvo `[D-6]`,
  nunca inferido do projeto em foco (a evidência 2).
- **`status != "success"` exige `failure`**, e `success` proíbe `failure`. Um
  desfecho ruim precisa ser legível; "falhou, não sei por quê" é o mesmo vício
  de "não sei" travestido de fato.

### Os dez fatos

| Fato | Para quê |
|---|---|
| `discovery.recorded` | a raiz: título, problema, tracker opcional `[D-1]`, alvo e escopo |
| `plan.recorded` | um discovery produz N planos |
| `work_item.recorded` | **substitui `plan_cards[]`/`fases[]`**: o item é declarado, não deduzido |
| `relation.recorded` | `originated` ("originou"), `flows_into` ("desagua em"), `ships_with` ("entra junto") `[D-5][D-7]` |
| `artifact.recorded` | o **ponteiro** do artefato: repo âncora ou disco `[D-8]` |
| `verification.recorded` | como o ciclo termina: PR, check, review, ou conclusão registrada `[D-4]` |
| `phase.completed` | desfecho da fase: `done` / `abandoned` / `inconclusive` |
| `lock.acquired` / `lock.released` | a trava como fato, com dono, hora e sessão `[D-11]` |
| `note.recorded` | texto humano amarrado a uma entidade |

**Regras que o schema não expressa e o parser cobra** (cada uma tem teste):

- `work_item` do tipo `issue` **exige** `target_repo` — sem repo, não dispara.
- `artifact` com `location: "repo"` exige `repo`; com `location: "disk"`,
  proíbe. Ponteiro que não resolve não é ponteiro.
- Todo run `success` declara ao menos um `phase.completed`.
- Todo run `success` de fase `discovery` declara ao menos um
  `discovery.recorded`.
- **Campo desconhecido é erro** — no envelope e dentro de cada fato. É por aqui
  que "campo que só um lado conhece" aparece no instante da ingestão.

### Evolução e versionamento

- **Major** = quebra. O app compara o major de `contract_version` com o seu;
  diferente ⇒ recusa com `unsupported_major` e erro visível no card. Nunca
  adivinha.
- **Minor** = campo opcional novo ou fato novo. O app de major igual aceita.
- Como campo desconhecido é erro, um minor novo **exige** atualizar os dois
  lados — que é o ponto. A folga fica no `contract_version`, não no silêncio.
- A 3.0 escreve **só** no formato novo `[D-3]`. Gravar nos dois "por
  compatibilidade" é o que produziu o desencontro atual.

### O caso do card F3, no formato novo

O exemplo `discovery-sem-repo-nem-tracker.json` é literalmente a evidência 1:
discovery concluído, nenhum plano. No modelo antigo isso era indistinguível de
"nunca rodou". Aqui é `phase.completed` com `outcome: "done"` e nenhum
`plan.recorded` — um estado legítimo, que o snapshot marca com o sinal
`completed-without-plan` (seção 2).

---

## 2. O formato do store `[D-9]`

### Layout

```
<userData>/esteira/
  events.jsonl     append-only. Linha 1 = cabeçalho. Demais = um evento por linha.
  snapshot.json    derivado e descartável — apagar força reconstrução.
```

`userData` é **compartilhado entre os três canais**, como já é hoje (28/07).
Arquivo **próprio**, fora do `config.json` e portanto fora do sanitizador de
config — é isso que fecha o risco aceito naquela decisão: canal antigo não
reescreve por cima do que não entende.

### Cabeçalho e compatibilidade

```json
{"kind":"esteira.store.header","schema_version":"1.0.0","created_at":"…","created_by_channel":"alfa"}
```

O cabeçalho existe para responder **uma** pergunta: posso escrever aqui?

| Situação | Decisão |
|---|---|
| mesmo major | `read-write` |
| arquivo com major **à frente** | `read-only` — lê o que consegue, **não escreve** |
| arquivo com major **atrás** | `needs-migration` — lê; escrita só após migração explícita (append de novo cabeçalho, nunca reescrita) |
| cabeçalho ausente/ilegível | `unreadable` — não escreve |

Linha de evento corrompida é **pulada**, não fatal. Evento de tipo
desconhecido é **lido e preservado** — o envelope é legível por um canal que
não conhece o payload. Nunca se apaga histórico.

**Sem SQLite**, de propósito: dependência nativa esbarraria na ABI do Electron
a cada atualização, o mesmo custo que o node-pty já impõe.

### Envelope de evento

```jsonc
{
  "seq": 42,                       // monotônico, ordem de gravação (≠ "at")
  "event_id": "evt-…",
  "at": "2026-08-03T12:00:01.000Z",
  "type": "work_item.created",
  "source": { "kind": "ingest", "run_id": "run-1", "result_path": "…" },
  "dedupe_key": "run-1:work_item.recorded:wi-02",
  "payload": { … }
}
```

- **`source`** tem três formas: `app` (gesto na interface), `ingest` (veio de um
  `result.json`, carregando o `run_id`) e `seed` — o caminho explícito de
  `[D-2]` para plantar discoveries em andamento sem edição manual às cegas.
- **`dedupe_key`** é a chave natural do fato. Dois eventos com a mesma chave são
  o mesmo fato; o segundo é descartado na leitura. É o que permite reingerir um
  `result.json` sem medo.

### Entidades do snapshot

`discoveries`, `plans`, `workItems`, `sessions`, `relations`, `artifacts`,
`locks`, `ingestErrors`, `mirrorQueue` — todas em `storeFormat.ts`. Pontos que
respondem diretamente à spec:

- **Repo alvo × escopo** `[D-6]`: `targetRepo: string | null` (um) e
  `scopeRepos: string[]` (0..N), em `WorkItemSnapshot` e `DiscoverySnapshot`.
- **Relações** `[D-5]`: lista própria (`RelationSnapshot`), não campo aninhado —
  o grafo é grafo, e "camadas são layout, não estrutura".
- **Artefatos** `[D-8]`: `ArtifactPointer` com `location: 'repo' | 'disk'`. O
  store guarda o ponteiro, esteja o artefato onde estiver.
- **Erros de ingestão** `[D-10]`: `IngestErrorSnapshot` é entidade de primeira
  classe, com os `issues` do parser. O card mostra o erro; não existe o caminho
  "não consegui ler ⇒ não realizada".
- **Espelho** `[D-12]`: `MirrorQueueEntry` — falha vai para fila, o card mostra
  "espelho pendente", o trabalho local nunca trava.

### A trava — e a divergência D-V3, resolvida

A verificação da v2 dizia, com razão: *a trava é etiqueta do board, nunca
arquivo `.lock`*. A spec 010 `[D-11]` move a trava para local. As duas coisas
convivem assim:

> A trava é um **fato no log de eventos** (`lock.acquired` / `lock.released`),
> com dono, hora e sessão. **Não** é um arquivo `.lock` solto — o modo de falha
> que D-V3 combatia (arquivo órfão, invisível, sem dono) continua proibido. A
> etiqueta no board vira **espelho opcional** (`mirroredLabel`), nunca a fonte.

A exigência que se preserva da decisão original é que a trava **não seja
invisível**: ela aparece no card e libera num gesto — que agora é um evento
`lock.released`, não um `/esteira-liberar` mexendo em etiqueta remota.

### Macro etapas derivadas `[D-13]`

`derivedStage` é **sempre calculada**, nunca digitada. A tabela da spec, como
regra de derivação sobre o grafo:

| Situação no grafo | `derivedStage` | Sinal |
|---|---|---|
| nenhum `phase.completed` de discovery, ou discovery em curso | `discovery` | — |
| discovery concluído, zero `plan` | `discovery` | `completed-without-plan` |
| ≥1 `plan`, nenhum item iniciado | `planned` | — |
| ≥1 item em curso | `execution` | — |
| todos os itens `done` ou `abandoned` | `done` | — |
| item reaberto depois de concluído | `execution` | — (a etapa **retrocede**) |

`stageOverride` é opcional, **sempre marcado como tal**, e `derivedStage`
continua visível ao lado — o ajuste manual nunca engana quem lê.

> **A função de derivação não está implementada.** A tabela é o contrato; o
> reducer que a executa é do vertical pequeno (`[D-15]` passo 2), junto com o
> watcher e a ingestão. Passo zero define a forma, não a máquina.

---

## 3. O teste de contrato dos dois lados

O que impede um campo de existir de um lado só **não é revisão de código**: é
um teste que confronta os dois lados contra o mesmo arquivo. Três amarras.

### Lado app — `tests/esteiraContractCoverage.test.ts` (rodando)

| Amarra | O que reprova |
|---|---|
| **schema × parser** | campo declarado no schema que o app não lê; campo que o app lê e o schema não declara |
| **schema × corpus** | campo declarado que **nenhum** exemplo preenche com valor não-nulo |
| **corpus × parser** | exemplo do corpus recusado pelo parser; tipo de fato sem exemplo |

O app publica o que promete ler em `CONSUMED_PATHS` — uma lista literal, não
uma leitura do código feita por alguém de boa vontade. O teste extrai os
caminhos declarados percorrendo o JSON Schema e compara os conjuntos.

**Verificado por mutação** (03/08): removi `facts[plan.recorded].summary` de
`CONSUMED_PATHS` → reprovou com o caminho exato; acrescentei um
`facts[plan.recorded].fanout_cards` inexistente → reprovou também. As duas
direções pegam.

### Lado skill — `esteira-donel-3.0.0` (a construir com o fork)

Espelho simétrico, sobre **a mesma cópia** do schema e do corpus:

| Amarra | O que reprova |
|---|---|
| **schema × emissor** | campo que a skill grava e o schema não declara; campo obrigatório do schema que a skill não grava |
| **corpus × emissor** | documento produzido pela skill que não valida contra o schema |
| **`x-required-facts`** | fase concluída sem gravar os fatos que ela promete (ex.: `discovery` sem `discovery.recorded`) |

Duas escolhas de desenho para o fork:

1. **A skill não escreve JSON à mão.** O `result.json` sai de um emissor
   (`tools/emit_result.py`), com uma lista explícita de campos emitidos — o
   espelho de `CONSUMED_PATHS`. Prompt redigindo JSON livre é como campos
   divergem sem ninguém notar.
2. **`x-required-facts` mora no próprio schema** (já está lá), então a
   obrigatoriedade é dado compartilhado, não regra duplicada nos dois testes.

### Como o arquivo chega aos dois lados

O donel-dev é o **dono** do contrato. O fork guarda uma **cópia verificada**:

- `scripts/sincronizar-contrato.ps1` (a escrever, no vertical) copia
  `esteira-result.schema.json` + `examples/` para o fork e grava um
  `esteira-result.schema.sha256`.
- O teste do fork reprova se o hash da cópia divergir do arquivo de hash —
  cópia editada à mão no lado da skill é falha de teste, não descoberta em
  produção.
- Divergência de **versão** (não de conteúdo) aparece na ingestão:
  `unsupported_major` com erro visível no card.

### Onde isso roda

- App: `npm test` (já roda — 56 testes novos).
- Fork: suíte própria, disparada no mesmo commit que altera o schema.
- **O contrato só muda pelos dois lados juntos.** Alterar o schema sem
  atualizar `CONSUMED_PATHS` e o corpus quebra `npm test` na hora.

---

## O que este passo deliberadamente NÃO faz

- Não ingere nada: sem watcher, sem leitura de disco, sem IPC.
- Não implementa o reducer nem a derivação de etapa — só a tabela.
- Não escreve o store: `storeFormat.ts` lê cabeçalho e envelope, não grava.
- Não toca `discovery-tree.ts`, `esteira-reader.ts` nem o mapa atual (`[P-5]`).
- Não cria o fork `esteira-donel-3.0.0` — o lado skill está **desenhado**, não
  construído.

## Pendências — marteladas em 03/08

| | Decisão |
|---|---|
| **P-1** | Numeração e nome **mantidos**: `specs/010-esteira-donel/`. |
| **P-2** | Backup do store por **export manual** para o vault (um gesto no app), fora de sync em tempo real. Append-only dentro do OneDrive gera conflito, e conflito num log append-only é histórico corrompido. |
| **P-3** | A 2.x sai de `~/.claude/skills/` **quando o Donel Dev rodar um card real de ponta a ponta** no modelo novo. Até lá, convivência. |
| **P-4** | Nomes das fases por ciclo ficam para o **horizontal pequeno**, com uso real na mão. É por isso que `run.phase` é string livre no contrato, não enum. |
| **P-5** | `discovery-tree.ts`, `esteira-reader.ts` e o mapa atual saem **ao fim do vertical pequeno**, quando o novo provar a espinha. Até lá: congelados, sem trabalho novo em cima (#41, #42, #35). |
| **P-6** | **Sessão por item+fase, com handoff por contexto dentro da fase.** Mudar de fase abre sessão nova, sempre. Dentro da mesma fase, quem decide abrir outra é o orçamento de contexto: alvo de nunca passar de ~400k tokens. Trabalho extra que cabe (protótipo barato, ou algo delegável a subagente sem sujar o contexto) fica onde está; rodada pesada — um mapeamento de processos, por exemplo — vira **handoff**. |

### O que P-6 muda no formato

A proposta original da spec (uma sessão por item+fase) vale, com um acréscimo:
uma fase pode ter **N sessões encadeadas**, quando o contexto estoura.

- `SessionSnapshot.phase` é **uma** fase — trocar de fase abre sessão nova.
- `SessionSnapshot.continuesSessionId` + `handoffReason` — a sessão nova aponta
  para a anterior **da mesma fase**. A história da fase é a cadeia; nenhum
  pedaço fica órfão.
- Evento `session.handed-off` no store.
- **O contrato não muda.** Um run continua sendo uma execução de fase, e
  `actor.cli_session_id` já amarra vários `result.json` à mesma sessão. Quando
  a fase termina por falta de contexto, isso é `status: "aborted"` com
  `failure.code` explícito, ou `phase.completed` com `outcome: "inconclusive"` —
  ambos já cabem no v1.
- Ligação com a spec 006 (contexto consumido): o app já mede o consumo; é o que
  torna "sugerir handoff antes de estourar" implementável no vertical.
