# Formato do arquivo `esteira.grafo` — o molde — 012 Esteira 4.0

**Status:** 🟢 **DECIDIDA** — o molde foi **aprovado pelo dono em 11/08**, no
Gate 1 da rodada de execução: as seis decisões `[G-1]`…`[G-6]` (seção 8) valem
como requisito. Validador, schema e escritor implementam contra esta spec a
partir da Onda 2.
**Item:** `wi-esteira4-formato-grafo` · plano `pln-esteira4-catalogo-e-grafo` ·
discovery `dsc-15a7e7f5-fbb`.
**Fonte de alcance:** `catalogo.md` (🟢) — o grafo canônico (§1) e a taxonomia de
nó `[F-4]` (§2) valem como requisito e esta spec não os redecide; `motor.md` (🟢)
§1–§4 — o que o motor lê do grafo; `layout-esteira.md` (🟢) — onde o arquivo
mora. Onde esta spec divergir de qualquer uma, **vencem elas** e a divergência é
defeito daqui.
**Evidência de nascimento:** o export real da mesa,
`.esteira/plano/pln-esteira4-catalogo-e-grafo/grafo-mesa.json` (12 nós, 12
arestas, `version: 1`) — o molde nasce do que já existe, não de um formato
imaginado.

> **Legenda de proveniência:** `[D]` decisão do dono no Discovery de 07/08 ·
> `[F-4]` taxonomia de nó, resolvida pela fase Design do catálogo · `[P-1]`
> roteamento `needsDesign` no nó do card, ratificado em 08/08 · `[E]` evidência
> medida em disco/código, com caminho · `[G-n]` decisão **desta** spec, proposta
> ao gate — vira requisito quando o dono aprovar.

---

## Problema

O `esteira.grafo` já tem dois produtores e três consumidores declarados — e
nenhum molde. A mesa exportou um (`grafo-mesa.json` `[E]`); a fase Plano vai
escrever um **por plano** (`catalogo.md` §3.2: `artifact.recorded` do
`esteira.grafo` é entregável dela); o motor lê dele a dependência entre cards, o
`needsDesign` e a sequência de merge (`motor.md:312` — "o motor só lê; o molde é
do plano irmão"); a tela deriva a linha Design dele; o validador portátil vai
conferi-lo. Cinco leitores/escritores contra zero norma: cada um inventaria um
formato, e o desencontro entre eles seria o mesmo defeito que a cópia dupla do
contrato produziu na 010 (D-3).

Esta spec é o molde. Ela fixa o envelope, os campos do nó, a semântica da
aresta, o lugar das coordenadas e a regra de evolução do `version` — e para.
Schema mecânico, validador e escritor são das issues irmãs (seção 7).

---

## 1. O envelope — um formato, dois usos `[G-1]`

```json
{
  "kind": "esteira.grafo",
  "version": 1,
  "nodes": [ … ],
  "edges": [ … ]
}
```

O **mesmo** formato serve aos dois grafos que o motor distingue (`motor.md` §1)
— e o segundo **não ganha formato próprio** (requisito do item, nota do
discovery):

| Uso | Nó é | Quem escreve | Quantos existem | Onde mora |
|---|---|---|---|---|
| **fluxo** | parada do processo (`gate`/`fase`/`artefato`/`nota`) | a mesa, ao desenhar o processo | 1 por desenho de processo (o canônico nasceu de um `[E]`) | onde a mesa exportar; o canônico em si vive **no código**, fixo (`catalogo.md` §1) |
| **execução** | **card** (work item) | a fase **Plano**, dono único (`layout-esteira.md:137`) | 1 por plano | `.esteira/ciclos/<discovery_id>/planos/<plan_id>/grafo.json` |

O uso **não é campo do envelope** `[G-1]`: ele é derivável dos nós (um grafo com
qualquer nó `card` é de execução; sem nenhum, é de fluxo), e um campo `use`
duplicaria o que os nós já dizem — a mesma razão pela qual o caminho no
`.esteira/` não carrega informação que o arquivo não carregue
(`layout-esteira.md`). Misturar `card` com os kinds de fluxo no mesmo arquivo é
**inválido** (seção 7, regra V-4).

## 2. O nó — campos e os cinco kinds

Campos do nó, na forma que a mesa já produz `[E]` mais o que os usos exigem:

| Campo | Obrigatório | Forma | Semântica |
|---|---|---|---|
| `id` | sim | string única no arquivo | no uso execução é **exatamente** o `work_item_id` do contrato (`subject.work_item_id` do `result.json`) `[G-2]` — o grafo não cria um segundo namespace de id |
| `kind` | sim | enum: `gate` · `fase` · `artefato` · `nota` · `card` | os quatro primeiros são a taxonomia `[F-4]` do catálogo (§2), com o critério de lá; `card` é o quinto, exclusivo do uso execução `[G-1]` |
| `title` | sim | string não vazia | o nome humano; no card, o título do work item |
| `handoff` | não | string ou `null` | o que entra na parada (uso fluxo); sem semântica no card |
| `note` | não | string ou `null` | contexto para o mapa; nunca insumo de execução |
| `needsDesign` | só em `card` | boolean | `[P-1]` — o roteamento, escrito pelo Plano, lido pelo motor e pela tela. **Obrigatório em todo nó `card`**: ausente não é `false`, é arquivo inválido — roteamento por omissão é o silêncio que a régua da `design.md` §5 existe para impedir |
| `mergeOrder` | só em `card` | inteiro ≥ 1 ou **ausente** | posição na **sequência de merge declarada pelo Plano** (`motor.md` §4). Ausente = item que não mergeia (spike, item documental) — não segura a suíte (`motor.md:180`). Valores únicos entre si, sem exigência de serem contíguos |
| `x`, `y` | não | número | apresentação, nunca contrato — seção 5 |

**Regra que o molde herda e não redecide:** só nó `fase` gera `run-input.json`;
gate gera espera, artefato gera fato, nota não gera nada (`motor.md:60-63`). O
nó `card` também **não gera run por ser nó**: quem decide o que roda é o
**cursor** do card no grafo canônico, derivado do log (`motor.md` §1) — o grafo
de execução só diz *quando* um card pode andar, nunca *o que* ele roda.

## 3. A aresta — uma direção, duas leituras `[G-3]`

```json
{ "from": "n-plano", "to": "n-impl" }
```

| Campo | Obrigatório | Forma |
|---|---|---|
| `from`, `to` | sim | `id` de nó existente no mesmo arquivo |
| `label` | não | string — a condição escrita na seta (uso fluxo: "tem decisão de estrutura", "rodada < 3") |

A direção é **uma só, temporal**: `from` vem antes, `to` vem depois — é como a
mesa já exporta `[E]` e como o canônico se lê. O que muda entre os usos é a
consequência:

- **fluxo:** caminho. `from → to` = depois desta parada vem aquela. **Ciclo é
  legal** — o laço `fix ↔ validar staging` do canônico é um ciclo de verdade
  (`catalogo.md` §1), com teto imposto pelo motor, não pelo grafo.
- **execução:** dependência. `from → to` = `to` **depende de** `from`: o card
  `to` nasce `Bloqueado` e só vira `Pronto` quando `from` tem
  `phase.completed(concluir, done)` no log (`motor.md:103,115`). **Ciclo é
  inválido** (regra V-5): dependência circular é deadlock declarado — a fila
  inteira esperaria para sempre, e o validador recusa o arquivo antes de o motor
  ter a chance de travar.

`label` em aresta de execução não tem semântica e o motor a ignora — mas não
invalida o arquivo (é tolerância de leitor, seção 6).

## 4. Exemplo normativo — um plano de brinquedo

O arquivo que a fase Plano escreveria para um plano de três itens, um deles
spike. É também o insumo do "plano de brinquedo" com que o Gate 2 da rodada de
execução prova a fila (`execucao.md` §4, Onda 2):

```json
{
  "kind": "esteira.grafo",
  "version": 1,
  "nodes": [
    { "id": "wi-atlas-schema", "kind": "card", "title": "Schema da tabela de contas",
      "needsDesign": true, "mergeOrder": 1 },
    { "id": "wi-atlas-api", "kind": "card", "title": "Endpoint de saldo",
      "needsDesign": false, "mergeOrder": 2 },
    { "id": "wi-atlas-spike-auth", "kind": "card", "title": "Spike: viabilidade do SSO",
      "needsDesign": false }
  ],
  "edges": [
    { "from": "wi-atlas-schema", "to": "wi-atlas-api" }
  ]
}
```

O que o motor deriva daí, sem nenhum campo além destes: `wi-atlas-schema` e
`wi-atlas-spike-auth` nascem `Pronto` (sem dependência); `wi-atlas-api` nasce
`Bloqueado` até o schema concluir; o schema passa pelo nó Design do canônico
(`needsDesign: true`), os outros vão direto a Implementar; o merge respeita
schema → api, e o spike não entra na fila de merge nem segura a suíte.

## 5. Coordenadas são apresentação, não contrato `[G-4]`

`x`/`y` vieram da mesa `[E]` e ficam no arquivo — mas como **metadado de
apresentação**, fora do contrato de execução:

- **leitor de execução** (motor, validador, tela de fila): ignora — nenhuma
  decisão pode depender de coordenada;
- **escritor**: **preserva no round-trip** — reescrever o arquivo sem os `x`/`y`
  que lá estavam destrói o layout da mesa de quem o desenhou. Escritor que nunca
  os teve (a fase Plano escrevendo um grafo de execução novo) não é obrigado a
  inventá-los;
- a tela que renderiza o grafo pode usá-los e pode recalculá-los — sem promessa
  de estabilidade.

É a mesma linha que o layout traçou para caminho × conteúdo: o arquivo é a
fonte; a coordenada é conforto de leitura, não fato.

## 6. `version` — como evolui `[G-5]`

`version` é inteiro, começa em `1` — **e o `1` é o formato desta spec**: o
export da mesa `[E]` é um subconjunto válido dele (não tem `card`,
`needsDesign`, `mergeOrder` nem `label`, todos opcionais ou de kind novo), então
nenhum arquivo existente quebra e não há migração.

- **Não bumpa:** acrescentar campo opcional novo, kind novo, ou tolerância nova
  de leitor. Leitor v1 diante de campo que não conhece **ignora o campo e
  preserva no round-trip** (tolerant reader — a mesma postura dos `x`/`y`).
- **Bumpa (`version: 2`):** tornar obrigatório o que era opcional, mudar
  semântica de campo existente, remover campo. É mudança que quebra leitor — e
  mudança de contrato se faz inteira, nunca metade (`design.md` §4.2).
- **Leitor diante de `version` maior que a que conhece: recusa com erro
  nomeado**, nunca "tenta mesmo assim" — adivinhar formato futuro é como nasce
  leitura silenciosamente errada.

## 7. Validação mecânica — as regras, e onde entram

As regras que um validador confere sem julgamento. **Nenhuma é implementada por
este item** — elas entram pelo validador portátil (`wi-esteira4-validador-que-viaja`)
e pelo `esteira:check`, e o schema JSON do grafo entra no pacote
`docs/esteira-dev/contract/` ao lado do contrato de result `[G-6]` — mesma casa,
mesma regra de fonte única.

| # | Regra | Vale para |
|---|---|---|
| V-1 | `kind: "esteira.grafo"`, `version` inteiro ≥ 1, `nodes`/`edges` arrays | todo arquivo |
| V-2 | `id` único; `from`/`to` resolvem para nó do arquivo | todo arquivo |
| V-3 | `kind` do nó no enum da seção 2 | todo arquivo |
| V-4 | `card` não convive com kind de fluxo no mesmo arquivo | todo arquivo |
| V-5 | sem ciclo quando há nó `card` (DAG de dependência) | execução |
| V-6 | todo `card` tem `needsDesign` booleano | execução |
| V-7 | `mergeOrder`, quando presente, inteiro ≥ 1 e único no arquivo | execução |
| V-8 | no uso execução, `id` de card existe como work item no store/ciclo | execução — regra **cruzada**, do validador que enxerga o ciclo, não do schema |

## 8. Fecho de gate — aprovado em 11/08

O gate desta spec (Gate 1 da rodada, `execucao.md` §4) era **uma aprovação de
molde**, e o dono a deu em 11/08 — as seis decisões abaixo valem como requisito:

| # | Decisão proposta |
|---|---|
| `[G-1]` | um formato só para fluxo e execução; o uso é derivado dos nós (`card` presente = execução), **sem campo `use`**; misturar os dois usos num arquivo é inválido |
| `[G-2]` | no uso execução, `id` do nó **é** o `work_item_id` do contrato — nenhum namespace novo |
| `[G-3]` | aresta com direção temporal única; ciclo legal no fluxo, **ilegal** na execução; `label` opcional e sem semântica de execução |
| `[G-4]` | `x`/`y` são apresentação: leitor ignora, escritor preserva no round-trip |
| `[G-5]` | `version` fica em **1** (o export da mesa é subconjunto válido); bump só em mudança que quebra leitor; leitor recusa version desconhecida |
| `[G-6]` | o schema JSON do grafo, quando nascer, mora em `docs/esteira-dev/contract/` ao lado do contrato de result — fonte única, nunca cópia no app |

---

## 9. Como esta spec se verifica

- **Agora (este item):** revisão do dono — o molde é o objeto do gate. O que ele
  precisa ver: o envelope (§1), a tabela de campos (§2), a semântica dupla da
  aresta (§3), o exemplo (§4) e as seis decisões (§8).
- **Depois (nas issues):** as regras V-1…V-7 viram schema + validador com teste
  dos dois lados, no padrão de `tests/esteiraContractCoverage.test.ts`; a V-8 é
  regra cruzada do validador portátil. O grafo de brinquedo da seção 4 é o
  fixture natural do primeiro teste da fila (Gate 2 da rodada).
- **O que não dá para pinar**, e por isso é gate de gente: se este molde é o
  contrato que o dono quer entre a mesa, o Plano e o motor.
