# Batches para resolução — spec 010, do vertical em diante

Escrito em 2026-08-03, ao fim da fase 1. Cada batch é uma unidade que cabe numa
sessão e **termina com um roteiro da skill [`tutorial-e2e`](../../.claude/skills/tutorial-e2e/SKILL.md)**
— não com teste verde. O gate desta spec é a tela, porque foi na tela que
todos os erros dela apareceram.

## Como lançar

Um batch por sessão. O prompt está no fim de cada bloco; ele já traz o que ler
antes de tocar em código.

**Regra que vale para todos:**

1. Ler [`spec.md`](./spec.md) e o [handoff da fase 1](./handoff-vertical-pequeno.md) antes de começar.
2. TDD no que é comportamento (reducer, contrato, derivação).
3. **Escrever o roteiro e2e do batch e OLHAR cada print** — a etapa 4 da skill.
   Print que mostra a tela mentindo é achado, não ruído: conserta o app.
4. Registrar as iterações; ao fim, nomear os erros que se repetiram.
5. Commit em branch própria. PR é ato humano.

## Prompt de lançamento (sessão limpa, ultracode)

Copie o bloco abaixo numa sessão nova, na raiz do repo. Ele é autossuficiente:
manda ler o que importa antes de tocar em código.

```text
ultracode

Repo: donel-dev. Branch de partida: feat/010-fase1-vertical-pequeno (a fase 1 da
spec 010 está entregue; o resto está quebrado em batches).

Leia nesta ordem, antes de qualquer código:
1. specs/010-esteira-donel/batches.md — os sete batches: escopo, e2e, dependências
2. specs/010-esteira-donel/spec.md — as 16 decisões fechadas
3. specs/010-esteira-donel/handoff-vertical-pequeno.md — o que já existe e o que não reescrever
4. .claude/skills/tutorial-e2e/SKILL.md — o gate de todo batch

Execute em DUAS ONDAS, na mesma sessão, sem me esperar:
- Onda 1, em paralelo: B1, B2, B3, B4, B5, B7
- Onda 2, quando a onda 1 fechar: B6 (o mapa sobre o store — precisa do que
  B1, B2, B3 e B5 entregaram)

Regras duras:
- Cada batch em branch própria, a partir de feat/010-fase1-vertical-pequeno.
- Se usar worktree, crie FORA do repo. Worktree em .claude/worktrees faz o glob do
  Playwright pegar as cópias e a suíte roda multiplicada.
- TDD no que é comportamento. npm test e npm run typecheck verdes antes de fechar.
- Todo batch termina com o roteiro e2e da skill tutorial-e2e — e com a etapa de
  OLHAR cada print, um por um. Print que mostra a tela mentindo é achado: conserta
  o app, não o roteiro.
- Os roteiros abrem janela do Electron. SERIALIZE essa etapa: uma captura por vez,
  nunca seis janelas ao mesmo tempo na minha máquina.
- B2 e B3 tocam EsteiraScreen.tsx. Quem terminar depois rebaseia.
- Nunca abrir PR. Nunca tocar main. Nunca rodar npm run test:smoke.

Me entregue no fim:
- uma linha por batch: o que entrou, o que ficou de fora e por quê, a branch
- o caminho dos relatórios HTML gerados (.e2e-visual/<roteiro>/relatorio.html)
- os erros que se repetiram ENTRE batches — se o mesmo defeito apareceu em dois,
  a correção certa é estrutural, e quero saber qual
- o que cada batch descobriu que muda a spec ou os batches seguintes
- do B6: o inventário de paridade com cada linha resolvida, e o que virou perda
  consciente — quero conferir a lista, não descobrir a ausência depois
```

**Custo:** seis batches em paralelo, cada um com implementação, testes e uma
captura e2e. Se quiser começar menor, lance B1+B2+B3 — são os que fecham o
vertical e destravam o B6 — e deixe B4, B5 e B7 para a leva seguinte.

## Estado ao escrever isto

Feito na fase 1: store append-only, reducer com derivação de etapa, ingestão
com erro visível, contrato de ida e volta com teste espelho, disparo com trava
local, tela como projeção, e o fork `esteira-donel-3.0.0` com discovery e plano.

`npm test` 1447 verdes. O que falta está abaixo.

## Dependências

```
B1 ─┬─> B6  (o mapa sobre o store)
B2 ─┤
B3 ─┤
B5 ─┘
B4 (independente)
B7 (independente; B1 ajuda, não bloqueia)
```

**Onda 1, em paralelo:** B1, B2, B3, B4, B5, B7 — tocam arquivos diferentes.
**Onda 2, sozinho:** B6, que reapõe o mapa sobre o store e precisa do que a
onda 1 entregou. As duas ondas cabem na mesma sessão: a segunda começa quando
a primeira fecha, sem esperar ninguém.

Conflito previsível se rodarem juntos: `EsteiraScreen.tsx` é tocado por B2 e
B3. Se forem paralelos, quem chegar segundo rebaseia — ou rodam em sequência.

---

## B1 — "Preparar" abre a sessão de verdade

**Objetivo:** o disparo deixa de parar no arquivo e passa a abrir a aba de
terminal com a sessão do Claude, apontada para o `run-input.json`.

**Por quê:** hoje o app prepara a fase, trava o card e para. A tela precisou
dizer, com todas as letras, que "abrir a sessão ainda é um passo manual" — o
que é honesto, mas é metade do gesto. Enquanto isso, o card fica "preparado" e
alguém tem que copiar um comando à mão.

**Escopo — entra:**
- O "Preparar" cria a aba de terminal (mesmo caminho do `pty:create` que o Modo
  Dev já usa) com o cwd do repo alvo e o comando da skill 3.0 pré-digitado.
- **O Enter continua sendo gesto humano** — invariante do repo (`openPhaseSession.ts`,
  invariante 2/CA-3). Nunca mandar `\r`.
- A sessão registra o `cliSessionId` assim que ele existe, e o card passa de
  "preparada" para "em andamento" **com verdade** (o `claimed` do snapshot).
- Encerrar a aba sem concluir não pode deixar o card preso: cair para
  "preparada" de novo ou liberar, com a frase certa.

**Não entra:** rodar a skill sozinha até o fim, arquivamento automático, worktree.

**Arquivos prováveis:** `src/renderer/src/App.tsx` (o gesto), `src/renderer/src/Esteira/`,
`src/main/esteira-dispatch.ts` / `esteira-service.ts` (o `cliSessionId` de volta ao store),
`src/shared/esteira/ipc.ts`.

**Roteiro e2e:** `disparo-abre-sessao`
1. Criar um card com repo alvo.
2. Preparar a fase — **a aba abre** e o comando aparece escrito, sem Enter.
3. O card diz "em andamento", não "preparada".
4. Fechar a aba sem concluir — o card volta a um estado com saída, e diz qual.

**Pronto quando:** o roteiro roda, os prints mostram as três frases certas
(preparada → em andamento → o que acontece ao fechar), `npm test` verde e o
invariante do Enter continua provado.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B1) e execute-o. Antes de codar, leia spec.md, o handoff da fase 1 e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## B2 — Disparo coerente com o modelo

**Objetivo:** só oferecer disparo que faz sentido, e permitir disparar fase de
um **item**, não só do discovery.

**Por quê:** achado do primeiro uso real — dá para disparar a fase "Plano" num
card que não tem plano nenhum. O `run-input.json` sai com `plan_id: null`, e a
fase Plano existe para detalhar um plano. A tela oferece um caminho que o
modelo não comporta.

**Escopo — entra:**
- O seletor de fase olha o estado do card: fase que exige plano fica
  desabilitada enquanto não houver plano, **com a razão escrita** (o padrão que
  o "Preparar" já usa).
- Escolher **o assunto** do disparo: o discovery, um plano, ou um item. É o que
  destrava as fases de item (implementar, validar).
- D-6 cobrado na tela: item `issue` sem repo alvo não dispara, e a tela diz por
  quê antes de o clique falhar.

**Não entra:** as fases novas na skill (isso é B7).

**Arquivos prováveis:** `src/renderer/src/Esteira/EsteiraScreen.tsx`, `esteiraView.ts`,
`src/shared/esteira/ipc.ts`.

**Roteiro e2e:** `disparo-por-assunto`
1. Card sem plano: a fase "Plano" aparece desabilitada, com a razão.
2. Depois que a skill declara um plano, ela habilita.
3. Disparar a fase de um **item** — o `run-input.json` sai com `work_item_id`.
4. Item `issue` sem repo: a tela recusa e explica, sem deixar clicar no escuro.

**Pronto quando:** o roteiro roda e os prints mostram as quatro situações; o
`run-input.json` do passo 3 passa no `parseRunInput`.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B2) e execute-o. Antes de codar, leia spec.md, o handoff da fase 1 e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## B3 — Os gestos que o store já suporta e a tela não oferece

**Objetivo:** dar interface aos eventos que o reducer já entende e ninguém
consegue disparar.

**Por quê:** `stage.overridden`, `stage.override.cleared`, `work_item.updated`,
`work_item.discarded` e `note.added` existem, têm teste e não têm gesto. São
justamente os que fazem o card acompanhar o trabalho real.

**Escopo — entra:**
- **Override de etapa** (D-13): sempre marcado como ajuste, com a derivada ao
  lado — a tela já sabe desenhar isso, falta o gesto de gravar e de limpar.
- **Estado do item**: abrir, começar, concluir, abandonar — é o que move a
  macro etapa e exercita o retrocesso.
- **Descartar item nascido pela skill** (D-16): num gesto, sem bloqueio; o
  evento fica no log, a entidade sai do snapshot.
- **Nota** amarrada ao card ou ao item.

**Não entra:** criação de item pelo app — D-16 é explícito: criação passa
sempre pela skill.

**Arquivos prováveis:** `EsteiraScreen.tsx`, `esteiraView.ts`, `esteira-service.ts`,
`src/shared/esteira/ipc.ts`.

**Roteiro e2e:** `gestos-do-card`
1. Mudar um item para "em curso" — a etapa do card vira Execução sozinha.
2. Concluir todos os itens — a etapa vira Concluído.
3. Reabrir um item concluído — **a etapa retrocede** para Execução.
4. Forçar a etapa à mão — a tela mostra o ajuste E a calculada ao lado.
5. Descartar um item criado pela skill.

**Pronto quando:** o roteiro roda e o print do passo 4 prova que a derivada
continua visível — override que esconde o cálculo é override que engana.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B3) e execute-o. Antes de codar, leia spec.md, o handoff da fase 1 e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## B4 — Seed: plantar um discovery em andamento

**Objetivo:** o caminho explícito de `[D-2]` para começar com trabalho que já
existe, sem edição manual às cegas.

**Por quê:** o store nasce limpo de propósito — nada de importação de legado.
Mas o Alexandre tem trabalho em curso hoje, e sem o seed a única saída é
escrever JSON na mão dentro do `events.jsonl`, que é exatamente o que o formato
foi desenhado para evitar.

**Escopo — entra:**
- `source: { kind: 'seed' }` já existe no envelope e no parser — falta quem
  produz.
- Um gesto no app: descrever o discovery, os planos e os itens que já existem,
  e em que ponto eles estão. Nasce marcado como semeado.
- A tela distingue o que foi semeado do que veio de fato declarado por skill —
  semear é afirmação humana, não fato observado, e o card não pode confundir
  os dois.

**Não entra:** ler o modelo antigo (`~/.claude/esteira-state`) — importação
continua fora de escopo.

**Arquivos prováveis:** `src/shared/esteira/store/`, `esteira-service.ts`,
`EsteiraScreen.tsx`.

**Roteiro e2e:** `seed-discovery`
1. Semear um discovery com um plano e dois itens, um deles em curso.
2. O card aparece na etapa Execução, derivada dos fatos semeados.
3. A tela mostra que aquilo foi semeado, não declarado por uma skill.
4. Disparar uma fase em cima do card semeado funciona igual.

**Pronto quando:** o roteiro roda; o `events.jsonl` mostra `source.kind: "seed"`
nos eventos do passo 1.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B4) e execute-o. Antes de codar, leia spec.md, o handoff da fase 1 e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## B5 — Espelho no tracker (adapter opcional)

**Objetivo:** ligar a `mirrorQueue` a um adapter de board, sem que ele possa
travar o trabalho local.

**Por quê:** `[D-11]`/`[D-12]` — o tracker virou opcional e o espelho é
cortesia: etiqueta, comentário de conclusão e movimentação por macro etapa.
`MirrorQueueEntry` já existe no snapshot e a tela já sabe mostrar "espelho
pendente"; falta quem enfileira e quem tenta.

**Escopo — entra:**
- Adapter com interface pequena (`aplicarEtiqueta`, `comentar`, `moverColuna`),
  com o mapeamento **etapa → coluna** vindo de configuração, não de código.
- Fila com reenvio; falha **nunca** bloqueia o gesto local.
- O card mostra "espelho pendente" e o que falhou.
- Testar com adapter **fake**: sem rede, sem token. Falha de contrato não pode
  ser confundida com falha de rede — a razão declarada de a fase 2 excluir o
  board.

**Não entra:** publicar item como card no tracker (é gesto explícito, fase
posterior).

**Arquivos prováveis:** `src/main/esteira-*.ts`, `src/shared/esteira/`,
possivelmente `taskdex-board-client.ts` como referência de adapter real.

**Roteiro e2e:** `espelho-pendente`
1. Com adapter fake falhando, concluir uma fase — o trabalho local acontece.
2. O card mostra "espelho pendente" com o motivo.
3. Adapter volta a funcionar: a fila drena e o sinal some.

**Pronto quando:** o roteiro roda com adapter fake e nenhuma chamada de rede
sai; o passo 1 prova que o local não travou.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B5) e execute-o. Antes de codar, leia spec.md, o handoff da fase 1 e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## B6 — O mapa passa a ler o store `[P-5]`

> **Mudança de rumo (04/08).** Este batch se chamava "aposentar o mapa antigo".
> Estava errado, e a pergunta do Alexandre — *"por que aposentar? ele é bonito e
> fácil de navegar"* — é o que corrigiu. O mapa não sai por ser ruim: ele sai
> **de fome**. Lê `~/.claude/esteira-state/` (`ctx.md`, `<fase>-result.json`), e
> a skill 3.0 para de escrever ali `[D-3]`. Sem fonte, ele fica vazio.
>
> Jogar a FORMA fora junto com a fonte seria desperdício: o carrossel de dois
> eixos, os chips de fase e o painel de detalhe são o design v3, aprovado por
> handoff. A tela que a fase 1 construiu (lista + detalhe) é **andaime de
> vertical** — existia para provar a espinha com o mínimo de UI, não para
> suceder um design que passou por revisão.

**O que é "o mapa":** a tela do Modo Dev de hoje (`DiscoveryMap.tsx`) — à
esquerda os **níveis** (discovery → marcos → cards) navegáveis na horizontal, e
por card a **trilha** das fases em chips; à direita o painel de detalhe da
etapa.

> Não confundir com o "vertical / horizontal pequeno" da spec: aquilo é a
> **cadência de entrega** `[D-15]`, não uma tela.

**Objetivo:** o mapa continua sendo a tela do Modo Dev, agora alimentado pelo
`StoreSnapshot`. `discovery-tree.ts` e `esteira-reader.ts` saem; o carrossel
fica.

### O que não é só trocar o encanamento

A forma sobrevive; **o que os nós significam muda**, porque a hierarquia é
outra:

| O mapa desenha hoje | O modelo novo diz |
|---|---|
| discovery → **cards de plano** → fases numeradas (`fase_num` = unidade de PR) | discovery → **planos** → **itens**, e o item é a unidade |
| 7 fases fixas por card | nomes de fase em aberto `[P-4]`; o que varia é o **ciclo de vida** do tipo `[D-4]` |
| tudo termina em PR | `adr`/`process-map` terminam por revisão; `spike`/`prototype`/`eval` terminam por **resposta**, inclusive negativa |
| estado lido do disco, fase a fase | macro etapa **derivada** do grafo `[D-13]`, com override sempre marcado |

Mesma linguagem visual, nós remodelados. Um `spike` que respondeu "não dá"
precisa parecer **concluído** — não uma trilha de PR pela metade.

**Escopo — entra:**
- Adaptador `StoreSnapshot → o que o carrossel consome`, no lugar de
  `discovery-tree.ts`. Módulo puro, com teste.
- Os nós do modelo novo: planos, itens com tipo e ciclo, macro etapa derivada,
  sinais do card — inclusive **"não consegui ler"**, que o mapa antigo pintava
  como "não realizada" (a issue **#35**, revertida aqui na origem).
- O que o inventário apontar como presente no mapa e ausente na tela nova —
  `verifications` (o PR da fase) é o caso já achado.
- A tela da fase 1 sai de cena, ou fica como painel de depuração do store
  (decidir no batch — andaime não precisa virar dívida).

**Etapa 0 — inventário de paridade, nos dois sentidos.** O que o mapa faz e a
tela nova não faz, **e** o que a tela nova ganhou e o mapa não tem. Cada linha
recebe destino: coberta, coberta por outro batch, ou **perda consciente com a
razão escrita**.

| Item | Situação |
|---|---|
| Trilha das fases por card (chips) | **volta** — é a forma aprovada |
| Navegação por níveis (carrossel) | **volta**, com planos/itens no lugar de cards de plano |
| Detalhe da etapa: artefatos, recibos | o store tem os artefatos; nenhuma tela mostra — cobrir |
| PR da fase | `verifications` está no snapshot e ninguém mostra — cobrir |
| Fatos do board (etiquetas, coluna) | vem do **B5** |
| Relógio de homologação | candidato a **perda consciente** — nasceu de outra necessidade |
| Erro de ingestão visível | ganho da tela nova — **preservar** |
| Trava com dono, hora e saída num gesto | ganho da tela nova — **preservar** |

Nada é removido antes de a linha ter destino.

**Não entra:** redesenhar a forma. Divergência entre o design v3 e o modelo novo
se resolve pela regra do repo: **forma → vence o design; alcance ou
comportamento → vence a spec.**

**Pré-requisito:** B1, B2, B3 e B5 — metade dos nós depende do que eles
entregam. É dependência **técnica**, e é a única: o batch roda até o fim sem
esperar ninguém acordar. A validação é local, pelo inventário + e2e; o que
continua humano é só o **merge**, como em qualquer PR.

**Roteiro e2e:** `mapa-sobre-o-store`
1. Modo Dev abre no mapa, com os cards vindos do store.
2. Um passo por linha do inventário marcada como "volta" ou "cobrir".
3. Um `spike` que respondeu "não dá" aparece **concluído**, não pela metade.
4. Um `result.json` fora do contrato: o card mostra "não consegui ler" — a #35
   revertida, provada na tela.
5. O ciclo do B1 continua funcionando por inteiro.

**Pronto quando:** o roteiro roda, `grep` limpo por `discovery-tree`/
`esteira-reader`, `npm test` verde, e o inventário publicado no PR com cada
linha resolvida.

## B7 — As fases restantes da skill 3.0

**Objetivo:** completar o fork `esteira-donel-3.0.0` com implementar, validar,
documentar e concluir.

**Por quê:** hoje o fork tem discovery e plano — as duas que o vertical
exercita. Um card só roda de ponta a ponta quando as outras existirem, e é isso
que libera a saída da 2.x (`[P-3]`).

**Escopo — entra:**
- Uma `SKILL.md` por fase, no mesmo padrão das duas existentes: Iron Law,
  passos, o que a fase **não** faz, racionalizações a combater.
- Os fatos que cada fase declara, cobrados pelo emissor: `verification.recorded`
  (PR, check, review, conclusão — `[D-4]`), `artifact.recorded`, `phase.completed`
  com o outcome certo.
- `x-required-facts` no schema ganha as fases novas — e o teste espelho passa a
  cobrá-las dos dois lados.

**Não entra:** abrir PR, fazer merge, mover card — nunca foram da skill.

**Arquivos prováveis:** `skills/esteira-donel-3.0.0/`, `src/shared/esteira/contract/v1/esteira-result.schema.json`,
`tests/esteiraSkillMirrorContract.test.ts`.

**Roteiro e2e:** `ciclo-completo-de-item`
1. Card com plano e um item `issue`.
2. Rodar implementar (emissor real) — o item vira "em curso".
3. Rodar validar — `verification.recorded` com o PR aparece no card.
4. Concluir — a etapa do card vira Concluído.

**Pronto quando:** o roteiro roda com os emissores reais das quatro fases e o
teste espelho cobra `x-required-facts` de cada uma.

> **Prompt:** `Leia specs/010-esteira-donel/batches.md (batch B7) e execute-o. Antes de codar, leia spec.md, passo-zero.md (§3, o teste dos dois lados) e .claude/skills/tutorial-e2e/SKILL.md. Termine com o roteiro e2e do batch e olhe cada print.`

---

## O que nenhum batch faz

- **Abrir PR ou fazer merge.** Ato humano, sempre.
- **Tocar `main`.** A branch de integração é `staging`.
- **Rodar `npm run test:smoke`** sem pedir — abre janelas Electron na máquina
  dele. O `npm run tutorial` também abre; nesse caso é o objetivo, e está
  combinado.
- **Importar o legado.** `[D-2]` — o store nasce limpo.
