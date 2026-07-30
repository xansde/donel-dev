# Spec — 009 Modo Dev na Esteira v3

**Status:** 🟡 **RASCUNHO** (2026-07-29) — nasce do Discovery desta mesma data
(`discovery.md`, 17 decisões fechadas com o Alexandre por entrevista `grilling`).
**Nenhuma linha de código.** Próximo passo: leva de design (forma) e `plan.md` +
`tasks.md`, depois o gate de execução.
**Origem:** a Esteira v3 (`skills-dev-ai-ops-szi/specs/006-esteira-v3/`) trocou o modelo
de domínio que o Modo Dev espelha, **e** o Alexandre aproveitou para descarregar oito
incômodos acumulados no uso do app. A **D13** manda tratar as duas coisas nesta entrega.
**Relação com a 003:** a `003-modo-dev` fica como registro fiel do que foi construído.
Esta spec a **sucede**; onde as duas discordam, vence esta.

> **Legenda de proveniência:** `[D-n]` decisão fechada no Discovery de 29/07 — é
> **requisito**, não inventar além disto · `[V3]` imposto pelo contrato
> `006-esteira-v3/contracts/handoff-v3.md` (fonte externa, não negociável aqui) ·
> `[T]` achado técnico no código, com `path:linha`, medido em 29/07 · `[B-n]` incômodo
> do app base levantado no Discovery · `[?]` aberto, endereçado à leva de design.

---

## Problema

1. **[V3][T]** **Hoje o app não mostraria absolutamente nada de um card v3.** Não é
   degradação parcial: são duas quebras na raiz, cada uma suficiente para zerar a tela.
   (a) A raiz do handoff saiu de `<repo>/.esteira/` para
   `~/.claude/esteira-state/<repo_slug>/<card_id>/`, o `handoffs/` perdeu o subdiretório
   `<card_id>`, e Implementar/Validar arquivam sob `handoffs/fase-<n>/` — o app procura os
   três no formato antigo (`esteira-reader.ts:107-111`, `esteira-result-watcher.ts:73`).
   (b) `outputs.fanout_cards[].marco_id` morreu e virou `outputs.plan_cards[]` com
   `{card_id, track, shadow}` — sem o campo, `readDiscoveryFanout` devolve `[]` e a árvore
   nasce vazia (`esteira-reader.ts:160-172`).

2. **[V3][T]** **O modelo do app está um nível curto.** A v3 introduziu a **fase do
   plano** (`fase_num`) como unidade de PR, sequencial, cada uma com sua **garantia**. A
   árvore do app tem dois níveis (discovery → marco → 5 etapas) e não tem onde pôr o
   `--fase=n` que as skills já leem.

3. **[V3][T]** **Duas fases da v3 são inexprimíveis:** `EsteiraPhase` é
   `discovery|plano|implementar|validar|concluir` (`devMode.ts:14`) — sem `documentar` e
   sem `cliente`, o track documental (`Discovery → Documentar → Concluído`) não existe no
   app. E `concluir` não grava `result.json` na v3, então `allMarcosComplete`, que exige
   `phases.concluir.status === 'done'` (`discovery-tree.ts:82`), nunca fica verdadeiro.

4. **[V3][T]** **O espelho passa a mentir em três frentes.**
   (a) `NEXT_PHASE.implementar = 'validar'` (`boardAnnotation.ts:20-24`) assume que
   Implementar move o card; na v3 **não move** — o card fica lá até o PR mergear. Todo
   card com implementar concluído acende "divergência disco × board" sem haver divergência
   (o card orquestrador de lote tem o mesmo problema: ele fica onde está, de propósito).
   (b) O prefixo `[Mx]` no título morreu, então `titleMarcoId`/`marcoIdMismatch`
   (`boardAnnotation.ts:57-61`) é código morto que gera a etiqueta "conferir: [Mx]…" a
   esmo. (c) O app exibe **aprovação de PR** (`taskdex-board-client.ts:240-256`,
   `DiscoveryMap.tsx:93-98`); a v3 matou `approval_rule` — o que vale agora é
   `homologado`, `revertido-ciclo`, mergeado e promovido, e são **N PRs**, um por fase.

5. **[D-1][D-2][T]** **O app não é intuitivo graficamente, e a tela é suja.** A causa não
   foi desprezo pelo design: foi **compressão**. O handoff especifica mapa no painel
   **esquerdo de 480px** com cards de **392px** (linhas 58 e 100 do mockup) e detalhe do nó
   em **painel próprio de 316px à direita** (linha 249); o app enfiou os dois numa coluna
   estreita à direita (`grid-column: 3`). E o **carrossel** — um card em foco, vizinhos a
   **34%** de opacidade, parcialmente cobertos, setas `‹ ›` + contador — virou **pilha
   vertical com todos os cards**, vizinhos a 70% (`DiscoveryMap.module.css:25`).

6. **[D-12][T]** **A mesma ação existe em dois lugares.** Os botões de fase estão na faixa
   central (`App.tsx:1800`) **e** cada nó de fase do `WorktreeCard` no mapa dispara por
   conta própria. A trava aparece nos dois; a divergência aparece como anotação no nó **e**
   repetida no bloco de detalhe abaixo.

7. **[B-1][T]** **O `%` de contexto perdeu a casa.** O cálculo está vivo e testado
   (`shared/contextWindow.ts`, spec `006-contexto-consumido`), mas era exibido na toolbar
   `SessionDetails`, **removida dos dois modos a pedido do dono** (`App.tsx:1878`) e nunca
   rehospedada. A `StatusBar` recebe hoje só conta, modelo/esforço e contagem de sessões
   (`App.tsx:2004`).

8. **[B-7][T]** **Os dois endereços de que o app precisa são editados à mão, fora dele.**
   O board vem de `~/.claude/esteira-config/donel-board-credential.json`
   (`workspaceId`/`teamId`) e o slug do GitHub de `repos.json → repos.<nome>.github`. Sem
   os dois, o app **não tem como** saber em qual board olhar nem em qual repositório
   procurar as sub-issues.

9. **[B-8][T]** **Não há como reiniciar a sessão atual retomando-a.** O maquinário de
   `resume` existe (`buildClaudeArgs({continuation:{type:'resume'}})`, já usado pela
   retomada do mapa), mas não há gesto que o aplique à aba em foco.

10. **[B-2..B-6]** Faltas menores, todas de uso diário: não há como lançar um projeto do
    zero (é a **US-15** do `backlog.md`, fila P1 desde o 001); a moldura do terminal
    embedado aparece cortada; não se ordena nem se colore aba; e o farol de status na aba
    é menos legível do que um ícone seria.

### Achados técnicos que moldam a solução (medidos, não re-investigar)

11. **[T]** **O app já spawna CLI e parseia `--json`** — `quota-headroom.ts:245`
    (`quota-axi`) e `claude-executable.ts` (`where.exe`). Ler GitHub por `gh` é ligar o que
    já existe, não construir superfície de rede nova.
12. **[T]** **Nenhuma tool de leitura do TaskDex expõe as labels do card** (medido contra
    o servidor em 28/07; o payload real nem traz a chave — `taskdex-board-client.ts:258-286`).
    Portanto `lockedPhase` e `attentionLabels` já chegam vazios hoje, e
    `esteira:orquestrador` também chegaria.
13. **[T]** **A allowlist de tools é o próprio tipo** (`BoardReadTool`, união de literais,
    `taskdex-board-client.ts:151`): chamar tool fora da união falha em `npm run typecheck`,
    nunca em produção. É o padrão a repetir para o `gh`.
14. **[T]** **O indexador de sessões é ciente de perfil por desenho** —
    `resolveProjectSessionsDir(projectPath, claudeHome)` recebe o `claudeHome`
    (`session-indexer.ts:99`), e `defaultClaudeHome()` é só o default. Perfis vivem em
    `~/.claude-profiles/<slug>` (`profile-manager.ts:57`), cada um com seu
    `CLAUDE_CONFIG_DIR` — logo **o transcript de uma sessão mora dentro do perfil em que
    ela rodou**.
15. **[T]** O app já impõe `--session-id` no spawn (`session-correlation.ts`), então sabe
    de antemão qual `.jsonl` pertence a qual etapa.
16. **[T]** **`marco`/`fanout` aparece 357 vezes em 27 arquivos**, incluindo
    `variant="marco"` do `WorktreeCard` no design system e a chave persistida
    `cardId:marcoId:fase` de `archivedPhaseSessions` no `config.json`.

---

## Modelo de domínio

O vocabulário é o do contrato da v3 (§A), sem sinônimos locais.

| Termo | No app | Cardinalidade |
|---|---|---|
| **card** | uma task do TaskDex; atravessa as colunas. `card_id` é a única identidade em artefato | 1 card : 1 plano |
| **card de plano** | o que o app chamava de **marco**. Nasce do `plan_cards[]` do Discovery | 1 discovery : N cards de plano |
| **lote** | epic do TaskDex agregando os planos de um mesmo Discovery; `lote_id` = `epicId`. O card de entrada fica como capa, rotulado `esteira:orquestrador` | 1 lote : N ≥ 2 cards de plano |
| **fase do plano** | fatia sequencial, **a unidade de PR** (`fase_num`) | 1 fase : 1 PR : 1 garantia |
| **garantia** | a prova de que a fase está correta: `roteiro_e2e`, `teste_api`, `testes_herdados` ou `infra` | 1 : 1 fase |
| **etapa** | o que o app chamava de **fase da esteira**: `discovery`, `plano`, `implementar`, `validar`, `documentar`, `cliente` | — |

**Morto:** *marco*, *`marco_id`*, o prefixo `[M<n>]` no título, `fanout_cards`,
`e2e_path`, `checklist_items`, aprovação de PR como fato exibido.

---

## Critérios de aceite

### Fontes — uma pergunta, uma fonte `[D-10]`

**CA-1.** **TaskDex responde "o que posso disparar agora"**, pela **coluna** do card:
`Discovery→discovery`, `Plano→plano`, `Implementar→implementar`, `Validar→validar`,
`Documentar→documentar`. Backlog e Concluído não disparam nada. O app **não lê label para
decidir elegibilidade** (não há fonte, achado 12) e **não duplica** o veto de
duplo-disparo: ele continua no `preflight.py` da própria skill.

**CA-2.** A porta de entrada deixa de ser restrita a três colunas
(`taskdex-board-client.ts:16-22`) e passa a listar as colunas do board v3 — um card em
Implementar é justamente o que pode rodar a fase seguinte.

**CA-3.** **GitHub responde "o que existe pra fazer"**: spec-issue, sub-issues nativas, PR
da fase e as etiquetas `homologado` / `revertido-ciclo`. Leitura por **`gh` CLI via
spawn**, com a lista de comandos expressa como **união de literais** no tipo (achado 13).
**Nenhuma escrita**, em nenhuma circunstância. Nenhuma credencial nova: o `gh` da máquina
já está autenticado.

**CA-4.** **Disco responde "o que já rodou"**, na raiz nova
`~/.claude/esteira-state/<repo_slug>/<card_id>/<fase>/`, com `handoffs/<fase>-result.json`
e — só para Implementar e Validar — `handoffs/fase-<n>/<fase>-result.json`.

**CA-5.** O app acha a spec-issue por `outputs.spec_issue` do `plano-result.json`. Logo
**CA-4 é pré-requisito de CA-3**: sem a raiz nova, não há porta de entrada para o GitHub.

**CA-6.** Ausência de fonte **degrada por omissão**, nunca por erro na tela nem por valor
fabricado — a regra que o app já aplica (`C4`) vale para as três fontes.

### Geometria do mapa `[D-1..D-9]`

**CA-7.** A geometria do handoff é cumprida: mapa no painel **esquerdo de 480px**, cards
de **392px**, e o detalhe do nó em **painel próprio de 316px à direita**. O mapa **não**
carrega o detalhe dentro de si.

**CA-8.** O mapa continua painel lateral — não vira superfície principal, e o terminal não
é rebaixado.

**CA-9.** **Uma regra, dois eixos.** A esteira é um **carrossel vertical**; cada nível é um
**carrossel horizontal**. Mesmas regras nos dois: um card em foco, vizinhos a **34%** de
opacidade e parcialmente cobertos, setas `‹ ›` e contador. Onde o usuário está é o centro
da cruz.

**CA-10.** Os níveis do eixo vertical são **quatro**: Discovery · Plano · Implementação ·
Validação. Backlog não é nível (é a porta de entrada); Validação com Cliente e Conclusão
**não** são níveis.

**CA-11.** O carrossel horizontal é **condicional — só nasce quando há irmão**. As
implementações rodam em **uma sessão única que orquestra subagentes**, então o nível de
Implementação é **um card**, e só vira carrossel se o plano propõe **mais de um PR**. Mesma
regra para Validação. Nenhum ornamento de carrossel para um único item.

**CA-12.** Implementar e Validar são **níveis distintos**, nunca irmãos no mesmo carrossel:
na v3 são o mesmo PR em dois momentos (antes e depois do merge).

**CA-13.** A trilha dentro do card mostra **as etapas que já tiveram sessão + a próxima**,
e nada além. Clicar na próxima é como se segue; clicar numa passada retoma a sessão
arquivada para consulta.

**CA-14.** **Nenhum template de tamanho fixo.** A navegação anda por uma **lista** em ordem
canônica, filtrada pelo que existe — nunca por indexação por nome de etapa. Nível ausente
não deixa buraco: deixa uma lista mais curta. (Hoje o código faz o oposto: `phases` é um
`Record` sempre cheio e `phaseIndex()` devolve `-1` para coluna desconhecida.)

**CA-15.** **Nenhum disparo na faixa superior** — a fileira de botões de fase do centro
sai, e a progressão vive só no mapa. `＋ Nova sessão` não pertence ao Modo Dev.

**CA-16.** Cada fato aparece **num lugar só**: acaba a duplicação de trava, divergência e
estado entre nó do mapa, botão da faixa e bloco de detalhe.

### Vocabulário e vazios da v3

**CA-17.** `marco` → **card de plano** em todo o código, incluindo `variant="marco"` do
`WorktreeCard`. `fanout_cards` → `plan_cards` (com `track` e `shadow`). `e2e_path` /
`artifact_paths.e2e` → `garantia` / `artifact_paths.garantia`.

**CA-18.** `EsteiraPhase` ganha `documentar` e `cliente`, e o **track documental**
(`Discovery → Documentar → Concluído`) passa a ser representável.

**CA-19.** A detecção de divergência para de acusar o que a v3 tornou normal: Implementar
não move o card, e o card orquestrador de lote fica onde está. A conferência `[Mx]` sai
inteira.

**CA-20.** O PR deixa de ser exibido por **aprovação** e passa a ser exibido por
**`homologado` / `revertido-ciclo` / mergeado / promovido**, com **N PRs por card**, um por
fase.

**CA-21.** A conclusão de um plano deixa de depender de um `concluir-result.json` que a v3
não grava.

### App base `[B-1..B-8]`

**CA-22.** O **`%` de contexto volta**, na `StatusBar`, atualizando ao vivo. A barra pode
concentrar tudo, desde que atualize constantemente.

**CA-23.** A tela de sessões anteriores ganha **engrenagem de configuração por projeto**,
com o **ID do board TaskDex** e o **repo do GitHub** que aquele projeto aponta — os dois
hoje editados à mão fora do app (problema 8). É a UI que faltava para CA-1 e CA-3.

**CA-24.** Existe **botão de reiniciar a sessão atual** dando `resume` nela. Ele retoma na
**conta selecionada**, copiando o transcript para o perfil dela — porque o `.jsonl` mora
dentro do `CLAUDE_CONFIG_DIR` do perfil em que a sessão rodou (achado 14), e `resume` numa
conta que não é a dona começaria uma sessão nova, calada.

**CA-25.** Consequência obrigatória de CA-24: o `session-id` **deixa de ser único entre
perfis**, e as duas cópias divergem a partir do momento da cópia (a original congela). A
tela de sessões anteriores e o mapa **dizem de qual conta** cada entrada é — nunca mostram
a mesma sessão duas vezes sem distinguir.

**CA-26.** As abas podem ser **reordenadas**.

**CA-27.** Cada aba pode receber uma **cor**.

**CA-28.** A aba mostra **ícone** de estado de sessão (pode piscar) no lugar do farol; o
**farol permanece no mapa**, onde convive com o glifo de fase e a distinção entre os dois
eixos precisa sobreviver. A **legenda dos dois eixos sai** do rodapé do mapa — a
acessibilidade continua protegida pela **dupla codificação** (glifo **e** cor, sólido
reservado a falhou/travada), que era o requisito de verdade; a legenda era só a chave.

**CA-29.** A moldura cortada do terminal embedado é corrigida.

**CA-30.** É possível **lançar um projeto do zero** pelo app (US-15 do `backlog.md`).

**CA-31.** Migração de `archivedPhaseSessions`: entradas de `discovery` e `plano` migram
(`marcoId` → `cardId` do plano); entradas de `implementar` e `validar` são **descartadas**,
porque o registro antigo não tem `fase_num` e assumir `fase 1` faria o mapa oferecer
retomar a sessão errada. O slot fica vazio — "sem registro", nunca valor fabricado.

---

## Fora de escopo

- **Abrir PR, fazer merge, mover card para Concluído sem o gate** — invariante da Esteira,
  não muda aqui.
- **Qualquer escrita** em TaskDex, GitHub ou vault. O app é leitor.
- **A esteira de deploy** (os sete workflows da v3) — vive nos repos-alvo, não no app.
- **Cobertura de teste da cadeia da esteira** — é do pacote de skills, não deste app.
- **Isolamento de `userData` por canal** (B10 do `backlog.md`) — segue opcional.

## Perguntas em aberto — endereçadas à leva de design

**[?] A1.** Onde mora o **relógio de 24h** da homologação (`prazo_homologacao.deadline`) —
o fato mais acionável da v3, sem desenho e sem lugar na tela de hoje.

**[?] A2.** A **lista final de etiquetas** do card de plano. Duas das atuais morrem
(aprovação de PR, conferência `[Mx]`) e a URL inteira do PR como etiqueta é ruído.

> **Nota de sequência.** A leva de design recebe um pedido bem maior do que o de 27/07:
> eixo vertical novo, quatro níveis, relógio de 24h, etiquetas do card, ícone de aba, cor
> por aba, engrenagem de configuração. Esta spec sai **antes** do desenho de propósito —
> para a leva receber alcance fechado em vez de descobrir escopo desenhando.

## Ordem de ataque sugerida

1. **CA-4** (raiz nova do handoff) e **CA-17** parcial — sem elas a tela fica vazia, e são
   as mudanças mais mecânicas.
2. **CA-3 / CA-5** (GitHub por `gh`) — depende de CA-4.
3. **CA-1 / CA-2** (elegibilidade pela coluna) e **CA-23** (a engrenagem que a alimenta).
4. **Leva de design** → então **CA-7..CA-16** (geometria).
5. **CA-18..CA-21** (vazios e mentiras do espelho) e o resto do app base.
