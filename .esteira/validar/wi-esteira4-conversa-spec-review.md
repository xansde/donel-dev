# Review — wi-esteira4-conversa-spec (fase Validar, run manual)

**Data:** 2026-08-10 · **Branch:** `feature/wi-esteira4-conversa-spec` ·
**Diff:** `aec5a4e` (+1205, −1) — `specs/012-esteira-4/conversa.md` (424, novo),
`specs/012-esteira-4/catalogo.md` (§3.2 corrigida, +9/−1), e os três artefatos de
processo não versionados até aqui (design ×2 e ctx do plano) ·
**Disparo:** manual (sem `run-input.json` do app; não há `result.json` a validar
pelo `esteira:check`).

## Risco

**Trivial.** Docs-only: nenhuma linha de runtime, nenhum comportamento novo. O único
arquivo pré-existente tocado é `catalogo.md`, e a mudança é uma frase de texto
normativo cuja emenda o dono já ratificou em 09/08. Gate e2e não se aplica.

## O que foi verificado, e como

| Verificação | Resultado | Evidência |
|---|---|---|
| `npm test` (vitest) | ✅ passou | 2170 testes, 119 arquivos, 18.9s |
| `npm run typecheck` | ✅ passou | tsc exit 0, sem output |
| Review do documento | 🟡 sem bloqueio, **1 achado** | abaixo |

## Review do documento

Conferido item a item contra as fontes que a própria spec declara:

1. **Herança da §3.1 do catálogo** (seção 2: assunto cru, repo opcional, 1× por
   assunto, reabrir é run novo) — idêntica ao `catalogo.md:151-158`. Sem redecisão. ✅
2. **Correção da §3.2 (`[Q-2]`)** — aplicada: `catalogo.md:161` agora diz "**um
   assunto fechado** — um só, e inteiro", com a nota da emenda de 09/08 no lugar e
   ponteiro para `conversa.md` seção 6. As duas fontes normativas param de discordar.
   O que a emenda não afrouxa (dois assuntos num run continua proibido) está escrito
   nos dois lados. ✅
3. **Fatos do contrato v1** — os sete citados (`discovery.recorded`, `plan.recorded`,
   `work_item.recorded`, `decision.recorded`, `artifact.recorded`, `note.recorded`,
   `phase.completed`) existem todos em
   `src/shared/esteira/contract/v1/esteira-result.schema.json:119-283`. A spec afirma
   que o contrato não muda, e é verdade. ✅
4. **`inconclusive`** (seção 2.2: "se o orçamento acabou antes") — coerente com
   `motor.md:112-120`, que define o `inconclusive` e a regra do segundo seguido. ✅
5. **`[P-1]`, `[D-6]`, `[D-11]`** citados como fechados — conferem no catálogo
   (`:326`, `:162`, `:185`). A spec os referencia sem re-registrar. ✅
6. **As cinco skills de referência** (seção 8) — as cinco existem em
   `C:/Users/xansd/seazone/spotsys/.claude/skills/` (`wayfinder`, `prototype`,
   `research`, `grill-with-docs`, `to-spec`) e **nenhuma** está no `donel-dev`
   (`.claude/skills/` tem só `tutorial-e2e`; `.claude/commands/` só `speckit.*`).
   A afirmação `[EV]` da linha 324 é verdadeira, e `[Q-1]` (inspiração, sem instalar
   nem copiar) é consistente com o disco. ✅
7. **Divergência com o Design em `[Q-4]`** — real e declarada corretamente: o
   diagrama diz, em `diagrama-arquitetura.md:108-109`, "o gate não fecha enquanto
   houver material despachado sem volta". A spec resolve a favor dela por ser
   **comportamento**, não forma — aplicação correta da regra de conflito do repo, e
   a divergência virou nota, não silêncio. ✅
8. **Forma `[F]`** — o mockup pina o que a spec normatiza: "conversa — síncrona,
   bloqueante" × "buscando — assíncrono, não bloqueia", "material de decisão — nunca
   como decisão tomada", `palpite → note.recorded`, `assuntos → plan.recorded`,
   "despachado · sem volta". Nada na spec contradiz a tela. ✅
9. **Fronteira com as irmãs** (seção 10) — "conversa à esquerda do `esteira.grafo`,
   fila à direita" bate com `motor.md` (consome o que estes gates escreveram) e com
   o catálogo, que remete o formato do `esteira.grafo` ao item irmão. Sem
   sobreposição de escopo entre as três specs. ✅

## Achado — não bloqueante

**A-1 · `artifact.recorded` some do "Devolve" da Discovery no catálogo.**
`conversa.md:123` lista `artifact.recorded` ×N entre o que a Discovery devolve (o
material assíncrono da seção 7 e o mapa da seção 3). O catálogo §3.1 (`:155`) **não**
lista esse fato no "Devolve" — e é a única das seis fases sem ele (`:162`, `:182`,
`:200`, `:220`, `:245` têm todas). O catálogo §3.1 já diz, no "Faz", que a Discovery
produz protótipo/spike/ADR/research; o "Devolve" só não acompanhou.

É exatamente a classe de problema que `[Q-2]` acabou de corrigir uma linha abaixo:
duas fontes normativas descrevendo o mesmo "Devolve" de forma diferente, e o catálogo
sendo o que se lê primeiro. Não bloqueia — nenhuma regra depende disso hoje, e a
seção 11 da conversa não pina o campo — mas a próxima sessão que escrever a skill
`esteira-discovery-4` a partir do catálogo vai omitir o fato do mapa.

**Correção proposta:** uma frase no `catalogo.md:155`, no mesmo gesto do `[Q-2]`.
Fica para decisão do dono — a Validar reporta, não emenda spec.

## Veredito

**Aprovado para revisão do dono.** Documento coerente com as duas specs irmãs, com o
design, com o contrato em disco e com as skills em disco; as quatro `[Q-n]` estão
ratificadas e escritas como requisito, e a única divergência com o Design está
declarada e justificada. Um achado de consistência (A-1), não bloqueante.

**Gate humano pendente:** este documento é o objeto do gate (seção 11) — o que o
dono precisa ler é a régua da §1.1, a fronteira decisões × palpite da §6.2 e as
quatro respostas da §9.
