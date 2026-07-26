# Discovery — 007 Favoritos com sessões recentes na sidebar

**Data:** 2026-07-25 · **Formato:** entrevista aberta, sem roteiro fechado
(lição de 22/07: entrevistar o uso real antes de escrever spec).
**Origem:** ele abriu com *"Quero começar a planejar uma maneira de manter as
sessões ativas. Se eu fixei elas, eu quero que se mantenham na parte de
'sessões', agrupado pelo projeto que atuam"*.

## O que já estava registrado antes de perguntar qualquer coisa

Três coisas do repo cruzavam com o pedido — checadas ANTES da entrevista, para
não redescobrir o que já estava decidido:

1. **O pin de hoje é volátil e não faz o que o nome sugere.** `TabState.pinned`
   (`App.tsx:89`) vive só em memória, sem persistência nenhuma. E ele não mantém
   a sessão no topo: em `sessionOrdering.ts` o pin é **desempate DENTRO do mesmo
   estado de semáforo** — uma fixada em "trabalhando" fica abaixo de qualquer
   sessão em "permissão pendente".
2. **A decisão de 23/07** ("restaurar no boot as sessões com atividade no dia
   anterior", em *Decidido, aguardando spec*) pressupõe reabrir sessões.
3. **O B5** já tinha as palavras dele de 23/07 sobre o agrupamento, com três
   clarifys em aberto: recentes × fixadas × ambas, limite de sub-itens, e o que
   acontece ao desfavoritar.

## O que ele disse (verbatim)

- *"São as sessões de uso contínuo."* — é isso que ele fixa.
- *"Acho que se tiverem os projetos favoritados em um lugar separado mostrando
  as últimas 5 sessões daquele projeto já me resolve. Quando uma sessão estiver
  fixada, ela aparece ALÉM das 5 últimas sessões."*
- *"Deixar essa área de projetos favoritados colapsável por projeto parece
  perfeito."*
- *"Não quero manter as sessões ativas, apenas acessar as últimas sessões de
  trabalho de maneira rápida."*
- Sobre o custo de leitura no boot: *"Mantenha registro durante o trabalho. Na
  próxima execução do app, já tem salvo as últimas sessões/fixadas sem ter que
  carregar sessões claude."*

## Decisões fechadas nesta conversa

| # | Decisão | Consequência |
|---|---|---|
| D1 | **Não** reabrir/manter sessões vivas — só acesso rápido | Mata a parte caríssima (subir N sessões no boot, RAM e cota) |
| D2 | 5 mais recentes por projeto **+ fixadas ALÉM das 5** | Fixada não ocupa vaga; resolve o clarify "recentes × fixadas × ambas" do B5 com **ambas** |
| D3 | Grupo **colapsável por projeto** | Resolve o clarify de layout do B5 |
| D4 | Sessões do grupo **saem** da lista geral de "Sessões" (dedupe) | Como o B5 pedia |
| D5 | Clique: se a sessão já tem aba aberta, **foca a aba**; senão, retoma | Evita abrir a mesma sessão duas vezes |
| D6 | Escopo do grupo: **só projetos favoritados** | Favoritar passa a significar "quero as sessões dele à mão" |
| D7 | A decisão de 23/07 (restaurar no boot) está **CANCELADA** — esta feature resolve o problema dela | Removida de *Decidido, aguardando spec* para ninguém implementar por engano |
| D8 | Cabeçalho do projeto colapsado **acende** com o pior estado do semáforo de dentro | Resolve o conflito com FR-010/CA-6 (ver abaixo) |
| D9 | **Registro próprio do app**, mantido durante o trabalho, é a fonte da lista no boot | Sem varredura de `~/.claude` ao abrir o app |

## Os dois conflitos que apareceram, e como foram resolvidos

**1. Dedupe × sinal de permissão pendente (FR-010/CA-6).** A lista geral de
"Sessões" é ordenada pelo semáforo, com permissão pendente no topo — foi por
isso que o semáforo existe. Tirar as sessões dos projetos favoritados dessa
lista podia esconder, dentro de um grupo colapsado, exatamente a sessão que está
esperando resposta dele. **Resolvido (D8):** o cabeçalho do projeto mostra o
pior estado das sessões vivas dele, então o grupo colapsado ainda "grita".

**2. Custo de montar a lista.** Medido na 004
(`specs/004-nomear-sessoes/medicao-t403.md`): `indexProjectSessions` custa
**18 ms** no donel-dev e **684 ms a frio** no spotometro (9 transcripts, 72 MB).
Com 5 favoritos pesados, a sidebar levaria ~2 s para pintar no boot, e o cache
por `mtime+size` só ajuda a partir da segunda leitura (morre no restart).
**Resolvido (D9):** inverter a fonte — o app mantém o próprio registro de
sessões recentes/fixadas por projeto enquanto ele trabalha; o boot lê esse
registro (bytes, instantâneo) e **não** varre transcript nenhum.

## Herança da 004 que esta feature reaproveita

- `sessionNames` no `ConfigStore` + `resolveSessionName` → o rótulo de cada linha
  já sai resolvido (nome do `/rename`, nome dado na UI, ou preview).
- `SessionSummaryDto.customTitle` + o cache de cauda do indexer → a leitura sob
  demanda (quando o registro ainda não tem nada) sai barata.
- `transcript-watcher.ts` já observa toda aba `claude` viva → é o gancho natural
  para manter o registro atualizado sem polling.
