# Issue tracker deste repo: Local Markdown

Convenção usada pela skill `/wayfinder` (e por qualquer skill que diga "publish to
the issue tracker" / "fetch the relevant ticket") neste repositório.

Escolhido em 2026-07-26 por decisão do Alexandre. Origem: o doc
`issue-tracker-local.md` do `setup-matt-pocock-skills`
(github.com/mattpocock/skills) — copiado à mão porque essa skill de setup **não é
instalada aqui**: ela assume tracker Git nativo e conflitaria com o TaskDex,
tracker oficial do squad.

> **Por que local-markdown e não TaskDex:** o Donel Dev é ferramenta pessoal do
> Alexandre, não card de squad — não tem `.taskdex.json` e o vínculo nunca foi
> feito. Mapa e tickets versionados junto com as specs sobrevivem a `/clear` e
> ficam no mesmo lugar que o resto do escopo.

## Convenções

- Um esforço por diretório: `.scratch/<effort-slug>/`
- Especificação, quando houver: `.scratch/<effort-slug>/spec.md`
- Tickets: um arquivo por ticket em `.scratch/<effort-slug>/issues/<NN>-<slug>.md`,
  numerados desde `01` — nunca um arquivo único combinado
- Estado de triagem numa linha `Status:` no topo do arquivo
- Comentários e histórico de conversa vão no fim do arquivo, sob `## Comments`

## Operações de wayfinding (usadas pelo `/wayfinder`)

O **mapa** é um arquivo com um arquivo **filho** por ticket.

- **Mapa**: `.scratch/<effort>/map.md` — corpo com Destination / Notes /
  Decisions-so-far / Not yet specified / Out of scope.
- **Ticket filho**: `.scratch/<effort>/issues/NN-<slug>.md`, numerado desde `01`,
  com a pergunta no corpo. Linha `Type:` registra o tipo
  (`research`/`prototype`/`grilling`/`task`); linha `Status:` registra
  `claimed`/`resolved`.
- **Bloqueio**: linha `Blocked by: NN, NN` no topo. Um ticket está desbloqueado
  quando todo arquivo que ele lista está `resolved`.
- **Frontier**: varrer `.scratch/<effort>/issues/` por arquivos abertos,
  desbloqueados e não reivindicados; o menor número vence.
- **Claim**: pôr `Status: claimed` e salvar ANTES de qualquer trabalho.
- **Resolve**: acrescentar a resposta sob `## Answer`, pôr `Status: resolved` e
  então acrescentar o ponteiro (gist + link) em Decisions-so-far do `map.md`.

## Nota local: `.scratch/` é versionado

Diferente do costume (a pasta costuma ser descartável), aqui `.scratch/` **entra
no git**. O mapa é o artefato canônico de um planejamento multi-sessão — perdê-lo
numa limpeza de árvore anularia o método.

## Dependências do `/wayfinder` neste ambiente

| Skill citada | Situação aqui |
|---|---|
| `/grilling`, `/domain-modeling` | ✅ instaladas (plugin `esteira`) |
| `/research` | ❌ não instalada — ticket `research` roda como subagente comum |
| `/prototype` | ❌ não instalada — ticket `prototype` roda à mão |
| `/to-spec`, `/to-tickets` | ❌ recusadas por decisão (o `speckit` faz esse papel) |
| `/setup-matt-pocock-skills` | ❌ recusada — este arquivo a substitui |

Handoff ao fim do mapa: **`/speckit.specify`** em `specs/003-modo-dev/`, não
`to-spec`.
