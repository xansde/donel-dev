# Discovery — Modo Dev na Esteira v3

**Data:** 2026-07-29 · **Conduzido com:** `grilling` (uma pergunta por vez)
**Estado:** ✅ **FECHADO** pelo Alexandre em 29/07 ("agora sim fechamos"). Nenhum código
foi tocado. **17 decisões**, 8 incômodos do app base, 2 perguntas em aberto (as duas de
forma pura, endereçadas à leva de design).
**Gerou:** `specs/009-modo-dev-v3/spec.md` — 31 critérios de aceite.

> **Por que existe:** a Esteira v3 (`skills-dev-ai-ops-szi/specs/006-esteira-v3/`)
> trocou o modelo de domínio que o Modo Dev espelha, e o Alexandre quis aproveitar a
> ocasião para recolher o que já o incomodava nos testes do app. Este arquivo guarda o
> que ficou decidido, para a spec não reabrir discussão fechada.

---

## Os incômodos que originaram a conversa

1. **O app não é intuitivo graficamente.** O mapa do design oferecido "parece ter sido
   ignorado completamente".
2. **Tela suja, com informação que não comunica muito.**

O confronto com o handoff (`design/modo-dev-handoff/project/Modo Dev.dc.html`) deu razão
à reclamação, e com número:

| O design especifica | O app construiu |
|---|---|
| Mapa no painel **esquerdo, 480px**; cards de marco de **392px** | Mapa na **terceira coluna à direita** (`grid-column: 3`), estreita |
| Detalhe do nó em **painel próprio, 316px, à direita** | Detalhe **dentro** do mapa, na mesma coluna estreita |
| **Carrossel**: um card em foco, vizinhos a **34%** de opacidade, parcialmente cobertos, setas `‹ ›` + contador | **Pilha vertical** com todos os cards, vizinhos a **70%** (`DiscoveryMap.module.css:25`) |
| — | Etiquetas extra no card: `coluna: X`, `PR sem aprovação · <URL inteira>`, `conferir: [Mx]…` |

O `ArmedPrompt` (o gesto central) o app cumpriu.

**Causa raiz:** não foi desprezo pelo design — foi **compressão**. Um mapa de 480px e um
painel de 316px foram enfiados numa coluna só, e o carrossel foi abrandado à mão.

---

## Decisões tomadas

### Forma e autoridade

**D1. Forma vem do design, sem abrandar.** Divergência de forma (densidade, opacidade,
hierarquia visual, onde a peça mora) → vence o design. Divergência de alcance ou
comportamento → continua vencendo a spec, como o `CLAUDE.md` manda. O 70% de opacidade
saiu de um pedido do próprio Alexandre e foi **retirado por ele**: "confia no design
sempre".

**D2. A geometria do mockup é a lei** — mapa à esquerda em 480px, cards de 392px,
detalhe do nó em painel separado de 316px à direita.

**D3. O mapa continua painel lateral.** Não vira superfície principal; o terminal não é
rebaixado.

### Geometria do mapa

**D4. Uma regra, dois eixos.** A esteira inteira é um **carrossel vertical**; cada nível
é um **carrossel horizontal**. Mesmas regras de opacidade e de recorte parcial nos dois.
Onde você está é o centro da cruz.

**D5. Os níveis são quatro:** Discovery · Plano · Implementação · Validação.
Backlog **não** é nível (é a porta de entrada, antes de focar em algo). Validação com
Cliente e Conclusão **não** são níveis.

**D6. O carrossel horizontal é condicional — só nasce quando há irmão.** As
implementações rodam em **uma sessão única que orquestra subagentes**; o nível de
Implementação é **um card**, e só vira carrossel se o plano propõe **mais de um PR**.
Mesma regra para Validação.

**D7. Implementar e Validar são níveis distintos**, nunca irmãos no mesmo carrossel: na
v3 são o mesmo PR em dois momentos (antes e depois do merge), não duas coisas paralelas.

**D8. A trilha dentro do card mostra as etapas que já tiveram sessão + a próxima.**
Nada além. Clicar na próxima é como se segue; clicar numa passada retoma a sessão
arquivada para consulta.

**D9. Nível ausente não pode brigar com a lógica linear.** A garantia é **não haver
template de tamanho fixo**: ordem canônica em lista, filtrada pelo que existe, navegação
andando pela lista filtrada — nunca indexação por nome de etapa. Hoje o código faz o
oposto (`phases` é `Record<EsteiraPhase, …>` sempre cheio; `phaseIndex()` devolve `-1`
para coluna desconhecida), e é esse o defeito a não repetir.

### Fontes

**D10. Uma pergunta, uma fonte:**

| Fonte | Responde |
|---|---|
| **TaskDex** | o que eu posso disparar agora — o card e sua coluna |
| **GitHub** | o que existe pra fazer — spec-issue, sub-issues, PR, etiquetas |
| **Disco** (`~/.claude/esteira-state/`) | o que a esteira já rodou — os manifestos |

Consequência: a elegibilidade sai do disco e passa a vir da **coluna**. Com isso o app
não precisa ler label nenhuma para saber o que pode rodar — e o veto de duplo-disparo
continua onde já está, no `preflight.py` da própria skill.

### Gestos

**D11. "＋ Nova sessão" não pertence ao Modo Dev.**

**D12. Nenhum disparo na barra superior** — "lá fica muito apertado e sujo". A
progressão de fases vive no mapa; a fileira de botões de fase da faixa central sai.

### Estado de fase × estado de sessão

**D14. Ícone só na aba; farol no mapa.** A aba ganha ícone colorido (pode piscar) no
lugar do farol; o mapa mantém o `StateDot` redondo, porque lá ele convive com o
`PhaseStateGlyph` e a distinção entre os dois eixos precisa sobreviver.

**D15. A legenda dos dois eixos sai do rodapé do mapa.** Decisão do Alexandre: os ícones
das abas devem comunicar sozinhos, sem chave de leitura. Não enfraquece a
acessibilidade — o que protege o requisito é a **dupla codificação** (glifo **e** cor,
com sólido reservado a falhou/travada), e ela permanece; a legenda era só a chave, não a
codificação. Consequência aceita: os glifos passam a ter de se explicar sozinhos, o que
já era a intenção do design.

### Migração de dados

**D16. Migração parcial das sessões arquivadas, com perda assumida no resto.**
`archivedPhaseSessions` é chaveado por `cardId:marcoId:fase` no `config.json`. As entradas
de `discovery` e `plano` migram limpo (`marcoId` → `cardId` do plano). As de `implementar`
e `validar` **são descartadas**: o registro antigo não tem `fase_num`, e assumir `fase 1`
faria o mapa oferecer retomar a sessão errada num nó errado. O slot fica vazio — a mesma
degradação honesta que o app já usa ("sem registro", nunca valor fabricado).

### Reiniciar a sessão atual (B8)

**D17. Retoma na conta SELECIONADA, copiando o transcript para o perfil dela.** O `.jsonl`
da sessão mora dentro do `CLAUDE_CONFIG_DIR` do perfil em que ela rodou
(`~/.claude-profiles/<slug>/…`), então `claude -r <id>` numa conta que não é a dona não
acha a sessão e começa uma nova, calada. O botão portanto **copia** o transcript para o
perfil da conta selecionada e dá `resume` lá. Motivo da escolha: resolve o caso real de a
cota da conta original ter estourado.

**Consequência que a spec tem de tratar:** a partir da cópia, o mesmo `session-id` existe
em **duas** contas, e as duas divergem (a original congela no ponto da cópia). O
`session-id` deixa de ser único entre perfis — a tela de sessões anteriores e o mapa
precisam saber de qual conta cada entrada é, ou vão mostrar a mesma sessão duas vezes sem
dizer qual é qual.

### Escopo da entrega

**D13. Tudo junto nesta entrega** — a adaptação à v3 **e** os seis incômodos do app base
(B1–B6). Motivo dado: uma **leva de design** vem em breve, e separar as duas coisas faria
o desenho ser pedido duas vezes. O risco de PR grande demais para receber review de
verdade foi levantado e o Alexandre o assumiu explicitamente: *"eu garanto me empenhar no
PR"*. A leva de design cobre também o eixo vertical do carrossel, que o handoff de 27/07
não desenhou.

---

## Incômodos do app base (parte não-dev)

Levantados na mesma entrevista. **D13** (abaixo) manda tratá-los aqui, nesta entrega,
junto da adaptação à v3 — não em spec separada.

| # | Incômodo | Natureza | Achado |
|---|---|---|---|
| **B1** | O `%` de contexto sumiu; a barra inferior pode conter tudo, desde que atualize constantemente | **ponta solta**, não regressão | O cálculo está vivo e testado (`shared/contextWindow.ts`, spec `006`). Ele morava na toolbar `SessionDetails`, **removida dos dois modos a pedido do dono** (`App.tsx:1878`), e nunca foi rehospedado. A `StatusBar` hoje recebe só conta, modelo/esforço e contagem (`App.tsx:2004`) |
| **B2** | Não há como lançar um projeto do zero | lacuna de feature | É a **US-15 "novo projeto decente"**, já em `backlog.md` na fila P1 desde o 001 |
| **B3** | A janela do terminal embedado tem uma pequena moldura cortada | bug visual | a investigar |
| **B4** | Organizar a ordem das abas | feature | — |
| **B5** | Definir uma cor por aba | feature | — |
| **B6** | Em vez de farol de status na aba, um ícone da mesma cor, podendo piscar | feature + colisão de design | resolvido por D14/D15 |
| **B7** | Botão de engrenagem na tela de sessões anteriores, para configurar por projeto o **ID do board TaskDex** e o **repo do GitHub** que ele aponta | feature — **e não é app base** | É exatamente a UI que falta para a **D10**: hoje o board vem de `~/.claude/esteira-config/donel-board-credential.json` (`workspaceId`/`teamId`) e o slug do GitHub de `repos.json → repos.<nome>.github`, os dois **editados à mão, fora do app**. B7 traz os dois para a tela, por projeto |
| **B8** | Botão para reiniciar a sessão atual dando `/resume` nela, com a conta selecionada | feature | O maquinário existe (`buildClaudeArgs({continuation:{type:'resume'}})`, já usado pela retomada do mapa). A pedra é a **conta** — ver A3 |

---

## Perguntas em aberto

As duas que restam são de **forma**, e as duas vão para a leva de design (D13) — não para
a spec decidir em texto.

**A1. Onde mora o relógio de 24h da homologação** (`prazo_homologacao.deadline`) — o fato
mais acionável da v3, sem desenho e sem lugar na tela de hoje.

**A2. A lista final de etiquetas do card de plano.** Duas das atuais morrem na v3
(aprovação de PR, conferência `[Mx]`) e a URL inteira do PR como etiqueta é ruído.

### Fechadas durante a entrevista

- **O carrossel vertical não tem desenho** — resolvido pela **leva de design** (D13): ela
  desenha o eixo vertical, que o handoff de 27/07 não cobria.
- **Spec nova ou emenda na 003** — **nova**, `009-modo-dev-v3`. A 003 fica como registro
  fiel do que foi construído. (Numeração: `004` estava ocupada por `004-nomear-sessoes`.)
- **O ícone de sessão colide com os dois eixos do design?** — resolvido por **D14/D15**:
  ícone só na aba, farol no mapa, legenda fora.
- **As sessões arquivadas podem ser perdidas?** — resolvido por **D16**.

---

## Mapa de impacto do código (levantado antes da entrevista)

Ordem sugerida: **P1 e P2 primeiro** (sem elas a tela fica vazia), depois o nível de fase
do plano, depois o espelho.

| # | O que quebra | Onde |
|---|---|---|
| **P1** | Raiz do handoff saiu de `<repo>/.esteira/` para `~/.claude/esteira-state/<repo_slug>/<card_id>/`; `handoffs/` perdeu o subdir `<card_id>`; Implementar/Validar arquivam sob `handoffs/fase-<n>/` | `esteira-reader.ts:107-111`, `esteira-result-watcher.ts:73` |
| **P2** | `outputs.fanout_cards[].marco_id` morreu → `outputs.plan_cards[]` com `{card_id, track, shadow}` | `esteira-reader.ts:160-172` |
| **P3** | `marco` → **card de plano**: 357 ocorrências em 27 arquivos, incl. `variant="marco"` do `WorktreeCard` e a chave persistida de `archivedPhaseSessions` (ver A4) | vários |
| **P4** | Falta o nível **fase do plano** (`fase_num`), unidade de PR — resolvido pelas D5/D6/D7 | `discovery-tree.ts`, UI |
| **P5** | `EsteiraPhase` não tem `documentar` nem `cliente`; o track documental é inexprimível. `concluir` não grava `result.json` na v3, então `allMarcosComplete` nunca fica verdadeiro | `devMode.ts:14`, `discovery-tree.ts:82` |
| **P6** | Falso positivo de divergência: `NEXT_PHASE.implementar = 'validar'` assume que Implementar move o card; na v3 **não move** | `boardAnnotation.ts:20-24` |
| **P7** | `[Mx]` no título morreu → `titleMarcoId`/`marcoIdMismatch` é código morto que gera ruído | `boardAnnotation.ts:57-61` |
| **P8** | O app mostra aprovação de PR; a v3 matou `approval_rule`. O que vale é `homologado`, `revertido-ciclo`, mergeado, promovido — e são **N PRs**, um por fase | `taskdex-board-client.ts:240-256`, `DiscoveryMap.tsx:93-98` |
| **P9** | Nenhuma tool de leitura do TaskDex expõe labels → trava e `esteira:orquestrador` chegam nulos. **Deixa de bloquear** pela D10 | `taskdex-board-client.ts:258-286` |
| **P10** | Porta de entrada restrita a 3 colunas contradiz a D10 — card em Implementar/Validar é justamente o que pode executar | `taskdex-board-client.ts:16-22` |
| **P11** | `commandTemplate` sem fase; faltam `documentar` e `validar-cliente`; defaults divergem do §G do contrato (validar é sonnet/**low**) | `devModeDefaults.ts` |
| **P12** | `e2e_path` morreu; `artifact_paths.e2e` → `artifact_paths.garantia` | `esteira-reader.ts:46-47`, `discovery-tree.ts:93-121` |
| **P13** | O app não lê GitHub. Rota recomendada: **`gh` CLI por spawn**, leitura pura, allowlist como união de literais (mesmo padrão do `BoardReadTool`) — zero credencial nova, e há precedente em `quota-headroom.ts:245` | novo módulo |
| **P14** | Fatos novos sem lugar: relógio de 24h (A2), `round_count`/`escalated`, `plano_completo`, `shadow_requerido`, `aviso_custo`, `ordem_entre_planos` | UI |

**Dependência:** o app entra no GitHub pelo `outputs.spec_issue` do `plano-result.json`
— que vive no disco. Então **P1 é pré-requisito do P13**, não um item paralelo.
