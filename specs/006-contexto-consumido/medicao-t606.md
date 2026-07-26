# Medição T606 — a cauda de 64 KB alcança a última `usage`?

**Quando:** 2026-07-26 · **Onde:** `~/.claude/projects` desta máquina —
**319 transcripts, 590 MB** (313 com pelo menos uma `usage`; 6 sem nenhuma).
**Por que existe:** o `tasks.md` da 006 (24/07) manda "se 8 KB não trouxerem
`usage`, re-ler com 64 KB". Essa regra ficou **obsoleta**: a 004 subiu
`TAIL_READ_BYTES` de 8 KB para **64 KB** por medição própria
(`../004-nomear-sessoes/medicao-t403.md`), então a cauda **já é** de 64 KB e a
pergunta virou outra — *ainda cabe uma janela maior?*

## Forma real do dado (conferida no disco, não na spec)

A `usage` fica em **`message.usage`**, não no topo da linha — o fragmento
`"usage":{…}` citado na spec é um recorte. Campos usados: `input_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens` (a mesma `usage` traz
um array `iterations[]` com os mesmos nomes repetidos por iteração; a soma lê
só o nível de cima, então não há dupla contagem).

**`isSidechain: true` com `usage`: 0 ocorrências em 319 transcripts.** Turnos de
subagente não caem no `.jsonl` da sessão nesta versão do CLI. O filtro existe no
código como seguro (o contexto de um subagente não é o da sessão), não como
correção de um problema observado.

## A) Distância do EOF até a última `usage` — o que a cauda precisa alcançar

| | p50 | p90 | p99 | p100 |
|---|---|---|---|---|
| bytes do fim | 3,4 KB | 6,4 KB | 23,7 KB | 80,8 KB |

Cobertura: **8 KB → 93,9% · 64 KB → 99,7% · 256 KB → 100%**.

## B) Maior vão entre duas `usage` consecutivas — o pior momento da sessão

| | p50 | p90 | p99 | p100 |
|---|---|---|---|---|
| vão máximo | 32,2 KB | 265,6 KB | 1.963,3 KB | 6.549,3 KB |

Cobertura: 8 KB → 41,2% · **64 KB → 64,9%** · 256 KB → 89,1% · 1 MB → 97,4%.

## Decisão: uma leitura de 64 KB, **sem** re-leitura maior

1. **Para o que o watcher faz, a estatística que manda é a (A)** — 99,7% dentro
   de 64 KB. É a distância entre a última escrita e a última `usage` num momento
   qualquer; é o caso da leitura de abertura (sessão retomada já mostra o `%`).
2. **A estatística (B) é assustadora e inofensiva.** Um vão de 2 MB acontece
   quando UMA linha gigante (`tool_result` de leitura de arquivo grande) entra
   entre dois turnos. Nesse instante a cauda de 64 KB não acha `usage` — e o
   efeito visível é **nenhum**, porque a leitura vazia **não apaga o valor
   conhecido** (regra decidida abaixo): o `%` fica no número do turno anterior
   até a próxima mensagem `assistant`, que chega segundos depois e escreve
   `usage` nova no fim do arquivo. Nada a mostrar foi perdido: o app só sabe do
   contexto pela `usage`, e entre duas `usage` não existe número novo.
3. **O preço de cobrir (B) não se paga.** Cobrir o p99 exigiria ler ~2 MB a cada
   rajada de escrita de uma sessão viva — 30× o custo atual, para uma informação
   que fica obsoleta em segundos. Uma re-leitura de 256 KB (4× o custo) ainda
   deixaria 11% dos piores momentos de fora: pagaria caro por um conserto
   parcial de um problema invisível.
4. **Jamais o arquivo inteiro.** O watcher não tem o fallback de varredura
   completa do indexer, de propósito (o registro recém-escrito está no fim; uma
   varredura de 15 MB por rajada custaria caro para não achar nada novo).

Custo residual assumido: **0,3% dos casos (1 transcript dos 313, a 80,8 KB do
fim)** mostrariam `—` na abertura até o próximo turno. Aceito e documentado.

## Regra "leitura vazia não apaga o valor conhecido" — vale para os tokens

O handoff da 004 deixou a decisão explícita para esta sessão. **Decidido: sim,
vale igual ao `customTitle`.** Uma cauda sem `usage` é **lacuna de leitura**
(arquivo travado no meio de uma escrita do CLI, linha gigante empurrando a
`usage` para fora da janela, cauda ilegível) — não é "o contexto voltou a zero".
Sem essa regra, o `%` piscaria para `—` no meio de um turno longo, exatamente
quando o número mais importa. Coberto por teste explícito em
`tests/transcriptWatcher.test.ts` ("não apaga os tokens já conhecidos").

Diferença em relação ao título, que também vale registrar: o `%` **cai** de
verdade depois de um `/compact` — e cai porque a `usage` nova traz um número
menor, não porque a leitura falhou. As duas situações são distinguíveis no
código exatamente por isso: só a ausência de leitura é tratada como lacuna.

## Como reproduzir

Script one-off (exploratório, não versionado — padrão do repo para medição):
varre `~/.claude/projects/*/*.jsonl` por streaming, marca o offset de byte de
cada linha `assistant` cuja `message.usage` tem pelo menos um dos três campos,
e reporta (A) `size − offset_da_última` e (B) o maior vão entre offsets
consecutivos (incluindo o vão final até o EOF).
