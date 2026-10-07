# Review — `wi-esteira4-design-spec` (spec do miolo da fase Design)

**Run:** `run-2d32fad7-1e3` · fase `validar` (composta com `documentar`, E5) ·
2026-08-11 · modelo `claude-opus-5`, esforço `high`.
**Objeto:** commit `bc7f09c` — `specs/012-esteira-4/design.md`, 420 linhas, um
arquivo, **zero linha de código**.
**Risco classificado:** `trivial` — item documental, sem superfície de UI e sem
código executável. O gate e2e (`[A16]`) não liga, e isso coincide com o teste
negativo da própria seção 5 da spec ("item documental" vai direto para
Implementar).

---

## 1. O que foi rodado (não herdado)

| Verificação | Comando | Resultado |
|---|---|---|
| Suíte | `npm test` | **2158 testes passam, 0 falham**; 4 arquivos de teste falham no *collect* — causa de ambiente, item 3 abaixo |
| Tipos | `npm run typecheck` | falha com 8 erros, **todos** derivados da mesma causa de ambiente do item 3 |
| Lint | `npm run lint` | **script não existe** neste repo (`npm error Missing script: "lint"`) — declarado como não rodado, não como verde |
| Review do diff | leitura integral + conferência das referências `[E]` | 2 achados, seções 2.1 e 2.2 |

Nada aqui foi lido do que a fase Implementar declarou: os números acima são
desta sessão.

## 2. Achados

### 2.1 `[F-1]` — a aresta nova aponta para um estado que não existe no motor

**Onde:** `design.md` §6, diagrama `stateDiagram-v2` (linhas 313-322) e o
parágrafo "Reprovado `[P-D]`" (linhas 327-332).

A spec declara acrescentar ao `motor.md` a aresta **`Esperando → Planejado`**
("o item volta à fase Plano"). Mas `Planejado` **não é um estado da máquina do
motor**. Os estados canônicos são oito — `Bloqueado`, `Pronto`, `Rodando`,
`Esperando`, `Falhou`, `TetoEstourado`, `Concluído`, `Abandonado`
(`specs/012-esteira-4/motor.md` §2, tabela de transições; o oitavo foi
justamente nomeado no PR #54, "o oitavo estado tem nome — Abandonado"). Uma
busca por `Planejado` no `motor.md` não devolve nada.

O mesmo diagrama mistura ainda um **nome de fase** (`Implementar`) na posição de
estado, e usa `Planejado --> [*]: item abandonado` onde o motor tem
`Esperando → Abandonado`.

**Por que importa, e não é purismo de vocabulário:** esta spec é o *normativo*
que as issues vão consumir, e ela mesma nomeia essa aresta como sua contribuição
ao `motor.md` ("é a spec do motor que a absorve quando for atualizada"). Quem for
absorvê-la não encontra o nó de destino — a aresta é inaplicável como escrita, e
a decisão `[P-D]` (reprovação volta ao Plano) fica sem tradução na máquina de
estados. A intenção é clara e provavelmente correta; o que falta é dizê-la no
vocabulário do motor (recuar o cursor ao nó do Plano no grafo, com o card
voltando a `Pronto`) em vez de inventar um estado.

**Não consertado aqui, por construção** — a fase que valida não é a que corrige.

### 2.2 `[F-2]` — citação `[E]` com linha errada, repetida duas vezes

`design.md` §3 (linha 133) e §7 (linhas 349-350) citam
`.esteira/validar/wi-esteira4-catalogo-fases/review-2026-08-08.md:88-89` como a
evidência do precedente "a Validar não re-revisa artefatos de Design". O trecho
real ("O mockup e o diagrama da fase Design não foram re-revisados…") começa na
**linha 89** e segue na 90; as linhas 88-89 são o fim do bullet anterior.

Achado menor em si, mas registrado porque o **critério de terminado do Passo 2**
da própria spec (linhas 92-93) exige "caminho de arquivo (e linha, quando é ponto
específico)" — a spec fica ligeiramente aquém da régua que ela institui.

### 2.3 `[F-3]` — ambiente: `design-system/` deletado na árvore de trabalho

**Não atribuível a este item** (que não toca código), mas é a causa única das
falhas da suíte e do typecheck acima, e precisa ser resolvido antes de qualquer
item de código nesta árvore.

- 100 arquivos de `design-system/` aparecem como ` D` no `git status`, **não
  commitados**; a pasta não existe no disco, mas existe em `HEAD`.
- `node_modules/@donel-dev/design-system` é um symlink para essa pasta ausente.
- Efeito: 4 arquivos de teste falham no *collect* (`smartZone`,
  `carouselGeometry`, `homologationClock`, `phaseChip`) e o `typecheck` acusa
  6× `TS2307` + 2× `TS7006` (estes últimos são consequência — `SegmentedControl`
  perdeu os tipos).
- Restaurar é gesto do dono (a árvore é dele); não foi tocada aqui.

### 2.4 `[F-4]` — o PR aberto na branch não contém o item

PR **#54** (`https://github.com/xansde/donel-dev/pull/54`, base `staging`, aberto)
tem 2 commits e **nenhum dos 6 commits locais** desta branch — inclusive o
`bc7f09c` deste item. `git rev-list origin/feature/esteira4-a1-a2...HEAD` = `0 6`.
Quem abrir o PR #54 para revisar o `design.md` não o encontra lá. Push é gesto
que esta fase não faz.

## 3. O que passou na conferência

Todas as demais afirmações `[E]` da spec resolvem na fonte:

- `artifact_kind` é `string` livre no schema (linha 203) — logo a emenda `[P-A]`
  de fato **não** exige mudança de contrato, como a §3 afirma. ✔
- Os 13 fatos do contrato v1 em `$defs/fact`, linhas 117-133. ✔ (contados: 13)
- `design` **não** está em `x-required-facts` — `by-phase-when-done` (linhas
  430-436) lista `plano`, `implementar`, `validar`, `documentar`, `concluir`. A
  premissa de `[P-E]` está correta. ✔ *(a spec cita "linhas 424-436"; o bloco
  `x-required-facts` abre em 421 — imprecisão sem consequência)*
- Contrato lido "da MESMA cópia" pelos dois lados — descrição do schema, linha 5. ✔
- `motor.md:108` é de fato a transição `Rodando → Esperando` no gate. ✔
- `conversa.md:203-204` é de fato quem escreve o roteamento (`decision.recorded`). ✔
- `catalogo.md` §3.3 (linha 182) e §4 (linha 261) existem e dizem o que a spec cita. ✔
- Os dois artefatos da fase Design existem no caminho declarado
  (`.esteira/ciclos/dsc-15a7e7f5-fbb/itens/wi-esteira4-design-spec/design/`:
  `diagrama-arquitetura.md`, `mapa-design-spec.html`). ✔
- Nenhum run com `"fase": "design"` em `.esteira/ciclos/.../runs/` — a afirmação
  "quatro rodadas manuais, nenhuma com run formal" se sustenta. ✔
- `docs/relatorio-melhoria-sessao-2026-08-04.md` falha 2 = "Referência aceita sem
  leitura". ✔ (citação exata)
- Os 8 work items da tabela de roteamento (§5) existem em `.esteira/`. ✔
- O que a Implementar declarou não ter tocado, de fato não tocou: o diff é
  **um arquivo só**, `specs/012-esteira-4/design.md`; nem
  `esteira-result.schema.json` nem `catalogo.md` foram alterados. ✔

O status 🟡 da spec é honesto: as duas perguntas de alcance (`[P-E]`, `[P-F]`)
estão enunciadas com o trade-off dos dois lados e uma recomendação, sem inventar
a resposta.

## 4. Lado Documentar — desfecho

`abandoned`. Nada aprendido aqui transcende o item: `[F-1]` e `[F-2]` são
correções deste documento (viram item, não ADR), `[F-3]` é estado transitório da
árvore de trabalho e `[F-4]` é um push que falta. A regra de conflito, a régua de
roteamento e a forma do 14º fato já vivem no lugar certo — a própria spec. Um ADR
aqui seria documento escrito por obrigação de processo.

## 5. O que sobra para o dono

1. Ler o `design.md` — este é o objeto do gate, e a §9 diz isso.
2. Fechar `[P-E]` (Design entra em `x-required-facts`?) e `[P-F]` (emenda
   in-place ou adendo datado?) — enquanto não fecharem, nenhuma linha de código.
3. Decidir o destino de `[F-1]`: item novo para corrigir a §6, ou correção junto
   com a emenda que `[P-F]` autorizar.
4. Restaurar `design-system/` na árvore (`[F-3]`).
5. Dar push da branch para o PR #54 refletir o item (`[F-4]`).
