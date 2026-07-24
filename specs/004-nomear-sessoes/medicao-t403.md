# Medição do T403 — custo de achar o `custom-title` na listagem real

**Data:** 2026-07-24 · **Máquina:** a do Alexandre · **Dados:** os transcripts
reais em `~/.claude/projects/` (26 projetos, **317** arquivos `.jsonl`).
A task exigia número, não "parece rápido": *"MEÇA o custo na listagem real e
registre o número. Se passar de ~300 ms, troque para varredura sempre + cache
por mtime+size."*

## O problema medido

O indexer lê só a cauda do `.jsonl`. Se o `custom-title` estiver fora dessa
janela, o nome some da sidebar — quebrando CA-1 justamente nas sessões antigas,
que são o caso de uso. O fallback é varrer o arquivo inteiro; o custo disso é o
que está medido aqui.

### Onde o `custom-title` realmente vive (107 transcripts que têm um)

Distância do **último** `custom-title` até o **fim** do arquivo:

| Janela de cauda | Cobertura |
|---|---|
| 8 KB (a original, do T012) | **44%** |
| 32 KB | 99% |
| **64 KB (escolhida)** | **99%** |
| 256 KB | 100% |

Mediana 10 KB · p90 29 KB · máximo 0,2 MB. Só **1** dos 107 tinha o último
título nos primeiros 8 KB — ou seja, a intuição de "o `custom-title` abre o
transcript" (comentário antigo do módulo) **não se sustenta nos dados**: o CLI
grava o registro no ponto do `/rename`, e o arquivo continua crescendo depois.

### Custo da listagem por projeto (soma do tail + fallback de varredura)

Os 5 projetos mais pesados, antes e depois de subir a janela para 64 KB:

| Projeto | Arquivos | Tamanho | Cauda 8 KB | Cauda 64 KB | 2ª listagem (cache) |
|---|---|---|---|---|---|
| bizops-ai-native | 59 | 116 MB | 654 ms | **220 ms** | 1,0 ms |
| dalton | 29 | 141 MB | 653 ms | **137 ms** | 1,2 ms |
| spotometro | 9 | 72 MB | 649 ms | **684 ms** | 0,2 ms |
| spotsys | 30 | 72 MB | 491 ms | **184 ms** | 0,5 ms |
| **donel-dev** (o caso de uso) | 55 | 1,6 MB | 27 ms | **18 ms** | 0,8 ms |

## Decisões tomadas com base nisto

1. **Janela de cauda 8 KB → 64 KB.** Cobre 99% dos títulos reais numa leitura
   única de 64 KB, contra 44% antes. É o que derruba a maioria das varreduras
   completas. `lastActivityAt` não muda de comportamento (a janela maior é
   superconjunto da menor, e a regra continua "última linha válida").
2. **Fallback de varredura completa mantido** (não trocado por "varredura
   sempre"): a cauda, quando traz título, traz *por definição* o último do
   arquivo; quando não traz, só a varredura responde. A alternativa sugerida na
   task ("varredura sempre") seria **estritamente pior** a frio — pagaria a
   leitura integral também nos 99% que a cauda já resolve.
3. **Cache por `filePath` + (`mtimeMs`, `size`)** — o gatilho de >300 ms
   disparou, então ele entrou. Segunda listagem em diante cai para **≈1 ms**
   (654 ms → 1,0 ms). Chave forte: append muda `size`; um append que mantivesse
   o tamanho muda o `mtime`. Cache em memória do `main`, limpo inteiro ao passar
   de 4000 entradas.

## O que ficou acima de 300 ms, e por quê (honestidade sobre o gate)

**`spotometro`: 684 ms a frio.** São 9 transcripts somando 72 MB e **apenas 1**
com `custom-title`. Provar que um arquivo **não tem** título exige lê-lo
inteiro — não há atalho correto. Nenhuma das duas opções oferecidas pela task
resolve esse caso (a "varredura sempre" o deixaria igual ou pior); só um limite
de janela resolveria, e isso trocaria correção por velocidade — inaceitável pela
ordem de trade-off do projeto (Correção > Simplicidade > Legibilidade >
Performance).

Mitigação real: o custo é **uma vez por arquivo por execução do app** (cache), e
o projeto que o Alexandre de fato usa no Donel — `donel-dev` — lista em **18 ms**.
Um cache persistido em disco (que sobreviveria ao restart) foi considerado e
**não** implementado: é escopo não pedido. Anotado no `backlog.md`.

## Como reproduzir

Os scripts de medição são one-off (não viraram teste; não são código de
produção). O passo a passo: para cada `.jsonl` de `~/.claude/projects/*/`,
`stat` + `readSessionTailInfo(path, size, mtimeMs)` com `performance.now()` em
volta, três rodadas seguidas por projeto para separar frio de cache.
