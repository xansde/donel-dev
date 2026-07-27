# Spec — 003 Modo Dev

**Status:** ✅ **CLARIFICADA** (2026-07-27) — nasce do mapa Wayfinder
"Modo Dev do Donel Dev", **cumprido** com 8 tickets resolvidos (MD-01 a MD-08,
26–27/07); os seis `[C]` foram fechados por ele no `/clarify` do mesmo dia (seção
"Decisões do `/clarify`"). **Nenhuma linha de código.** Próximo passo: `plan.md` +
`tasks.md`, depois o gate de execução.
**Prioridade:** era a próxima entrega desde a decisão de 23/07, com a numeração
`003` já reservada para ela na decisão de 24/07 (ver `backlog.md`, topo).
**Origem:** US-13 do backlog. As decisões vêm todas do mapa Wayfinder no vault
Claude Seazone (`Projects/donel-dev/wayfinder-modo-dev/`), não desta sessão.

> **Legenda de proveniência:** `[MD-0x]` decisão fechada no ticket x do mapa
> Wayfinder — é **requisito**, não inventar além disto · `[T]` achado técnico no
> código, com `path:linha`, medido em 26–27/07 · `[C]` decisão em aberto para o
> `/clarify`.

## Problema

1. **[MD-01]** O trabalho dele numa frente grande atravessa 5 fases da Esteira,
   cada uma disparada por um comando diferente, com pré-requisitos diferentes.
   Hoje **ele precisa lembrar o que digitar** e em que ordem — o app não conduz.
2. **[MD-03]** A Esteira já grava em disco tudo que aconteceu
   (`.esteira/<fase>/<card_id>-ctx.md` e
   `.esteira/<fase>/handoffs/<card_id>/<fase>-result.json`), mas **nenhuma
   superfície mostra onde a frente inteira está**. Para saber, ele abre arquivos.
3. **[MD-01]** Cada fase roda numa sessão de terminal própria — por custo de
   contexto, cada etapa começa com a janela limpa. Consequência: N marcos × 5
   fases = dezenas de sessões, e **a barra de abas de hoje não sustenta isso**.
4. **[MD-03]** Quatro fatos que a Esteira usa **não existem em disco** — coluna
   real do card, trava `esteira:em-andamento:<fase>`, PR vinculado e aprovação
   humana. De dentro do app eles são invisíveis, e é justamente o que faz uma
   fase ser recusada lá na frente.
5. **[MD-08]** Com memória limpa a cada etapa, **só atravessa a fronteira o que
   ficou escrito** — e hoje o canal de conhecimento da Esteira está desligado na
   máquina dele (`~/.claude/esteira-config/` só tem `repos.json`).

### Achados técnicos que moldam a solução (medidos, não re-investigar)

6. **[T]** O app **não tem nenhuma superfície de automação externa**: sem parsing
   de `process.argv` no boot, sem `setAsDefaultProtocolClient`/`open-url`, sem
   `requestSingleInstanceLock`, sem servidor local. `config.json` é lido no boot
   (`readAppConfig` em `src/main/index.ts:673`; `getAppConfigPath` em
   `src/main/index.ts:357` só resolve o caminho — citação corrigida em 27/07 durante
   o `plan.md`) e **não** guarda sessões pendentes; abas vivas não sobrevivem a
   restart. Abrir sessão é exclusivamente ato de UI.
7. **[T]** **Não existe campo de prompt inicial** em nenhum caminho:
   `PtyCreateOptions` (`src/shared/index.ts:67-87`), `LauncherLaunchOptions`
   (`src/renderer/src/Launcher.tsx:52-60`), `buildClaudeArgs`
   (`src/shared/commandBuilder.ts:43-78`).
8. **[T]** **Mas o encanamento para pré-digitar já existe**: `PTY_CHANNELS.input`
   (`src/preload/index.ts:44-46`, handler em `src/main/index.ts:326-328`). Hoje só
   o xterm o chama (digitação humana). Pré-digitar é **ligar o que já existe**, não
   construir superfície nova.
9. **[T]** Precedente de desenho conservador a respeitar: na 004 o app **nunca
   envia `/rename` ao PTY** — mantém metadado próprio em `config.json.sessionNames`
   e lê o `custom-title` que o CLI grava. O app evita digitar no terminal em nome
   do humano; esta spec abre **uma** exceção deliberada e limitada (CA-3).
10. **[T]** O app já impõe o `--session-id` no spawn
    (`src/main/session-correlation.ts:24-34`), então sabe de antemão qual `.jsonl`
    pertence a qual etapa — base do arquivamento (CA-6) e da retomada (CA-9).
11. **[T]** O `transcript-watcher.ts` já observa a cauda do `.jsonl` de toda aba
    `claude` viva, mas extrai **apenas** `customTitle` e `contextTokens` —
    reconhecer skill no transcript seria parsing novo.
12. **[T]** O design system tem **15 exportações / 16 peças** (`StateDot`,
    `SmartZoneMeter`, `AccountBadge`, `PhaseChip`, `Button`/`SplitButton`,
    `TextInput`, `Select`, `Toggle`, `SegmentedControl`, `TerminalTab`,
    `EditableLabel`, `PostItCard`, `Modal`, `Toast`, `StatusBar`) e a regra do
    projeto é **nunca recriar componente**.
13. **[T]** O repo `donel-dev` **não tem `.taskdex.json`**. Combinado com o MD-01
    (só se abre discovery a partir de um card do board), isso significa que
    **o Modo Dev não serve para desenvolver o próprio Donel Dev na v1** — custo
    assumido, não bug.

## Modelo de domínio

**[MD-01]** A unidade de trabalho do Modo Dev é o **discovery** — uma instância da
Esteira, a frente grande a investigar antes de agir. Hierarquia de três níveis:

```
discovery   = frente a investigar  = 1 card de entrada do board (papel orquestrador) + epic
  └── marco = fatia vertical       = 1 card de Plano = 1 branch = 1 PR ≈ "feature"
        └── fase da Esteira        = discovery · plano · implementar · validar · concluir
              └── tasks (tasks.md do spec-kit)
```

- Identidade ancorada no `card_id` de entrada e, em lote, no `epic_id`; o mapa
  `card_id → marco_id` vem de `outputs.fanout_cards` do `discovery-result.json`.
- **Vários discoveries abertos, um único em foco.**
- **[MD-01]** Vocabulário é o da Esteira, só ele. O preset de nomes ao estilo
  HumanLayer (QRSPI) que constava do design antigo está **descartado**.
- **[MD-05]** Duas fases não seguem "uma sessão por card": **Implementar** roda numa
  **única sessão por plano**, que orquestra subagentes de execução; **Validar** é
  **modular** — testa subconjuntos dos cards de um plano por vez, e qual subconjunto
  é definido na etapa de Plano.

## User stories

- **US-A — conduzir em vez de lembrar:** como usuário, vejo qual é a próxima fase da
  frente em que estou e a disparo dali, sem lembrar o comando nem o `card_id`.
- **US-B — ver a frente inteira:** vejo, num mapa, todos os marcos do discovery e em
  que fase cada um está, com o marco em foco destacado.
- **US-C — não perder o passado:** volto a uma fase já concluída para consultar o que
  foi feito, sem manter dezenas de abas abertas.
- **US-D — enxergar o board de dentro do app:** vejo a coluna real, a trava, as
  etiquetas de atenção e o estado de PR/aprovação sem sair para o TaskDex.
- **US-E — perceber falha na hora:** distingo à primeira vista uma fase que falhou de
  uma que travou e de uma que está rodando.
- **US-F — achar o conhecimento:** de cada fase, alcanço os artefatos que ela produziu
  e onde o conhecimento dela foi registrado.
- **US-G — não perder a tela de hoje:** ligo e desligo o modo na mesma janela; a tela
  atual continua existindo, intacta.

## Critérios de aceite

### Zona 1 — Porta de entrada (abrir / trocar discovery)

- **CA-1 (lista de candidatos) [MD-05]:** o app lista cards de um **board único**
  (configurado uma vez), restrita às colunas **Backlog, Discovery e Plano**. Cards de
  outras colunas — inclusive concluídos — **não aparecem**.
- **CA-2 (vinculado é foco, não criação) [MD-05]:** card que já tem discovery aberto
  aparece **marcado**, e selecioná-lo **traz aquele discovery ao foco**. Selecionar um
  card de **Plano** abre o **discovery pai** dele. Criar discovery novo dispara
  `/esteira-discovery <card_id>` pela regra do CA-3.

### Zona 2 — Condução (o gesto central)

- **CA-3 (pré-digita e para) [MD-04]:** acionar a próxima fase abre a sessão daquela
  etapa e **escreve o comando no PTY sem enviá-lo** (`donel.pty.input` sem `\r`, via
  o canal do achado 8). **O disparo é sempre o Enter do humano.** Nenhum caminho do
  app envia `\r` em nome dele.
- **CA-4 (defaults por fase) [MD-04][C6]:** o app aplica automaticamente, de uma
  **tabela própria em config editável** (**não** parseada dos `SKILL.md`), três coisas
  por fase: **modelo**, **esforço** e o **texto exato do comando a pré-digitar** — que
  não é só a invocação da skill (a fase `implementar` leva a palavra-chave de
  orquestração multi-agente, ver C6). Fugir do default é abrir pelo launcher de hoje.
- **CA-5 (trava avisa, nunca bloqueia) [MD-07]:** o botão da próxima fase **continua
  sempre clicável**. Havendo trava registrada para a fase-alvo, o app exibe **aviso
  visível** com desde quando. **Invariante:** a UI avisa; o `preflight.py` é o único
  gate real — nenhuma proteção do produto depende da UI (o espelho pode estar
  segundos atrasado).
- **CA-6 (sessão concluída é arquivada) [MD-04]:** quando o `<fase>-result.json`
  daquela etapa aparece com `status: "success"`, o app **fecha a aba** e **registra o
  `session-id`** no estado próprio dele. O gatilho é o **manifesto em disco**, não
  "o processo terminou". Etapa que falhou **não** arquiva sozinha: fica aberta.
  Nenhum transcript é apagado — o `.jsonl` é do CLI.

### Zona 3 — Mapa lateral

- **CA-7 (a árvore inteira) [MD-01]:** o mapa desenha o discovery em foco por
  completo — topo = discovery, um ramo por marco `[Mx]`, **nó = fase da Esteira** —
  com o **marco em foco destacado**. Não repete o presente da zona de terminal.
- **CA-8 (o que o nó abre) [MD-01][MD-08]:** expandir uma fase mostra as **skills
  internas** que ela rodou, os **artefatos** que ela **declarou** e os **recibos de
  conhecimento**. Artefato é só o que o `<fase>-result.json` aponta
  (`artifact_paths`, `e2e_path`, `documents[]`) mais `ctx.md` e o próprio
  `result.json` — **nunca** varredura de disco ou `git diff` adivinhando.
- **CA-9 (voltar à etapa) [MD-01][MD-04]:** clicar numa fase concluída **retoma a
  sessão dela** a partir do `session-id` arquivado, para consulta.
- **CA-10 (pool consultável) [MD-08]:** os artefatos alcançáveis pelo mapa incluem, na
  primeira versão: `<fase>-result.json`, `<card_id>-ctx.md`, `specs/<slug>/`
  (`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`),
  `specs/<slug>/e2e.md`, `lessons.md`, `docs/processos/**`, entregáveis `.html`
  commitados e o transcript da sessão. **Lista aberta**, incrementável sem mudar a
  estrutura.

### Zona 4 — Espelho do board

- **CA-11 (leitura direta, read-only estrutural) [MD-05]:** o app consulta o MCP do
  TaskDex **diretamente**, com token dedicado, restrito a uma **lista fechada de
  tools de leitura** fixada nesta spec. **Nenhuma tool de escrita entra no código** —
  a garantia é estrutural, não disciplinar.
- **CA-12 (o espelho anota a árvore) [MD-05]:** o espelho **não tem tela própria**.
  Ele sobrepõe a cada nó os quatro fatos que o disco não sabe: **coluna real**,
  **trava ativa**, **etiquetas de atenção** (`esteira:escalado`,
  `esteira:precisa-atencao`) e **PR + aprovação** (o que falta para o gate de
  concluir). **Não** exibe comentários, descrição, checklist, nem cards fora do
  discovery em foco.
- **CA-13 (divergência: mostrar + conciliar) [MD-05]:** quando o disco e o board
  discordam, o nó mostra **os dois fatos** e um **marcador de divergência**, e oferece
  **abrir uma sessão de conciliação** com um prompt já preparado descrevendo os pontos
  divergentes — pré-digitado, pela mesma regra do CA-3. O app **nunca corrige o board
  sozinho**. Divergência **esperada pelo processo não alarma**: a fase Validar, por
  invariante da Esteira, nunca move o card de coluna.
- **CA-14 (o board segue dono dos fatos) [MD-07]:** o app **não persiste** nenhum dos
  quatro fatos. `marco_id` é lido do **disco** (`outputs.fanout_cards`) com o prefixo
  `[Mx]` do título só como conferência. A proibição de `complete_epic` **permanece
  regra textual da skill** — o app não assume conclusão de lote.

### Estados de fase

- **CA-15 (cinco estados, falha inconfundível) [MD-04][MD-06]:** cada nó exibe um de
  cinco estados semânticos, todos inferíveis de **disco + processo próprio**, sem
  depender do board:

  | Estado | Como é reconhecido |
  |---|---|
  | não iniciada | sem `ctx.md` da fase |
  | em execução | sessão da etapa viva |
  | concluída | `result.json` com `status: "success"` |
  | **falhou** | `result.json` com `status` ≠ `success` |
  | **travada** | `ctx.md` presente, `result.json` ausente e sessão não mais viva |

  **Requisito literal:** identificar falha tem de ser **a coisa mais clara da tela**.
- **CA-16 (retomada certa por estado) [MD-04]:** clicar numa fase **falhou**
  pré-digita a **mesma skill**; clicar numa fase **travada** pré-digita
  `/esteira-liberar <card_id>` primeiro e a fase em seguida — **cada comando com seu
  próprio Enter**.

### Conhecimento

- **CA-17 (handoff é o manifesto) [MD-08]:** o `<fase>-result.json` continua o
  **único handoff obrigatório** entre etapas. Esta feature **não cria artefato novo de
  travessia**: o transcript arquivado é a memória bruta, o manifesto é a destilada.
- **CA-18 (registro é opcional, e o silêncio também) [MD-08]:** o registro de
  conhecimento **não bloqueia nada**. Etapa sem registro **não** fica "incompleta" —
  ganha indicador discreto. **Sem vault configurado, o app não mostra nem cobra
  nada:** silêncio, não insistência.
- **CA-19 (quem escreve é a skill) [MD-08]:** o app **nunca** escreve conhecimento —
  nem vault, nem board, nem `lessons.md`. Ele **exibe recibos** lidos de
  `registrations`/`outputs` do manifesto.

### Modo e estado do app

- **CA-20 (switch na mesma janela) [MD-01]:** ligar o modo reorganiza o layout da
  janela; desligar volta à tela de hoje, que **não é aposentada** nesta versão.
- **CA-21 (o app só persiste o que o disco não sabe) [MD-01][MD-04]:** o estado
  próprio do app se limita a: discoveries abertos, qual está em foco, o vínculo
  discovery ↔ repo ↔ card, os `session-id` das etapas arquivadas (com o **perfil de
  conta** em que cada uma rodou) e a tabela de defaults do CA-4. Todo o resto é
  **leitura** (disco ou board). Um fato, um dono.
- **CA-22 (estado global ao app, não por perfil) [C3]:** existe **um único** conjunto
  de discoveries/foco/vínculos, compartilhado por todos os perfis de conta — o
  discovery é do trabalho, não da conta, e etapas de um mesmo marco podem
  deliberadamente rodar em contas diferentes (por cota). Cada etapa registra **em que
  perfil rodou**; retomar uma etapa de outro perfil **avisa qual conta** em vez de
  falhar em silêncio.
- **CA-23 (encerramento) [MD-01]:** o discovery **encerra sozinho** quando todos os
  marcos chegam a Done — fato verificável pelo gate de `esteira-concluir`, não
  opinião. Sem passo manual de arquivar nesta versão.

### Fronteira com o design

- **CA-24 (a spec fixa alcance, não forma) [MD-06]:** esta spec fixa **quais zonas
  existem, o que cada uma entrega e como se comporta**. Ficam **inteiramente para a
  sessão de design**: representação do mapa (trilha/grafo/lista/colunas), disposição e
  dimensões das zonas, hierarquia visual, densidade, representação visual dos cinco
  estados e microinterações.
- **CA-25 (vocabulário de componentes) [MD-06]:** a UI compõe com as peças do design
  system (achado 12) e **não recria componente**. Alcance não componível exige
  **extensão nomeada e aprovada** — nunca silenciosa. Colisão já conhecida a resolver
  no design: `StateDot` é semáforo de **sessão**; os estados do CA-15 são de **fase**,
  um eixo diferente, e ambos coexistem na tela.
- **CA-26 (a spec não espera o design) [MD-06]:** `plan.md` e `tasks.md` fecham sem o
  design; as tasks de UI são escritas em termos de **alcance**, não de forma. O design
  roda **em paralelo** e entra como insumo de execução, sem reabrir esta spec. Brief
  pronto: `design/brief-modo-dev-v2.md` + o Brief 0 de `design/design-handoff.md`.

## Invariantes (não negociáveis, valem para toda a implementação)

1. **O app orquestra o CLI por fora e nunca reimplementa o agente.**
2. **Nenhum comando é enviado sem o Enter do humano** (CA-3, CA-13, CA-16).
3. **Zero código novo nas skills da Esteira** — `preflight.py` e `gate_concluir.py`
   continuam como estão; nada nesta spec depende de mudá-los.
4. **Nenhum botão de aprovação automática.** Gates e aprovações seguem das skills e
   do humano.
5. **O app não escreve no board nem no vault.**
6. **Núcleo agnóstico de sistemas externos [MD-08]:** board e vault são integrações
   plugáveis, não fundação. Na v1 o board é a porta de entrada (MD-01, não reaberto),
   mas a arquitetura não pode assumi-lo como imprescindível ao núcleo.

## Fora de escopo

- **Escrita do app no board** (mover coluna, vincular PR) — v1 é espelho
  somente-leitura.
- **Migrar a ownership dos fatos de esteira para o app** [MD-07] — esforço futuro,
  com mapa próprio se acontecer.
- **Aposentar a tela atual** do Donel Dev — v1 é modo alternável.
- **Visão de portfólio** de todos os cards ativos — é território do Mission Control.
- **Trabalho sem card do board**, incluindo o próprio `donel-dev` (achado 13) — segue
  na tela de hoje.
- **Resolver a aparência** — é a sessão de design (CA-24).
- **Requisito de operação offline** [MD-05] — descartado por decisão explícita dele
  ("sem rede eu nem trabalho"). O produto pode assumir rede disponível.
- **Reconhecer skill parseando o transcript** além do que o achado 11 já extrai — as
  skills internas do CA-8 saem do manifesto, não de parsing novo.

## Decisões do `/clarify` (2026-07-27) — todas fechadas por ele

- **[C5 ✔] Duas fatias.**
  - **Fatia 1 — condução e mapa:** zonas 1–3 e os estados de fase (CA-1 a CA-10,
    CA-15 a CA-23), alimentadas por **disco + processo próprio**. A leitura do board
    entra **já nesta fatia, só para a porta de entrada** (CA-1/CA-2) — sem ela não há
    como abrir discovery.
  - **Fatia 2 — espelho:** CA-11 a CA-14 (anotações nos nós, divergência, sessão de
    conciliação).
  - Razão: a fatia 2 é a única que precisa de credencial dedicada e de superfície de
    rede nova, e é a única cujo valor depende de o board estar em dia. Fatiar entrega
    o gesto mais valioso mais cedo e mantém dois PRs revisáveis.
- **[C3 ✔] Estado global ao app, não por perfil.** Um único conjunto de
  discoveries/foco/vínculos (CA-22). Palavras dele: *"global do app. Se eu precisar,
  cada terminal vai ser em uma conta"* — ou seja, distribuir etapas entre contas é
  **uso pretendido** (gestão de cota), não anomalia. Cada etapa registra o perfil em
  que rodou.
- **[C4 ✔] `.esteira/` antigos: sem migração, sem varredura.**
  - O mapa desenha **só o discovery em foco** e busca apenas os caminhos dos cards
    dele. Card antigo de outra frente não existe para o Modo Dev (coerente com CA-8).
  - **Discovery antigo é abrível** e se monta inteiro, com as fases concluídas — o
    passado não é caso especial, é o caso normal com estado "concluída".
  - **Nenhum backfill ou conversão de formato.** Manifesto ilegível → o nó mostra o
    que der para ler mais um marcador discreto, nunca crash nem tela vazia.
  - **Degradação aceita:** etapas antigas não têm `session-id` registrado (o app não
    existia), então clicar nelas **abre o artefato, não a sessão**.
- **[C6 ✔] Tabela inicial de defaults** (editável — muda sem tocar em código):

  | Fase | Modelo | Esforço | Observação |
  |---|---|---|---|
  | discovery | **fable** | high | entrevista e modelagem de domínio |
  | plano | opus | high | erro aqui se propaga por toda a implementação |
  | implementar | **opus + ultracode** | high | escolha dele: orquestração de múltiplos subagentes, uma task por subagente |
  | validar | sonnet | high | code-review e verify pedem rigor, não modelagem |
  | concluir | haiku | low | gate determinístico: roda um script e move um card |

  **Consequência que virou requisito (CA-4):** como `implementar` roda com
  **ultracode**, o comando pré-digitado **não é só a invocação da skill** — leva a
  palavra-chave que liga a orquestração. A tabela é, portanto, *fase → modelo,
  esforço **e texto exato do comando***.
  **Nota de cota:** `fable` é o modelo escasso dele; a tabela ser editável é o que
  permite trocar num dia apertado sem mexer em código.
  **Exceção da fase `concluir`:** a skill `esteira-concluir` se declara "gate
  determinístico e trivial (roda um script + um move de coluna)" que **roda inline na
  sessão-cockpit, sem spawn** — então ela **não abre sessão própria por marco**; roda
  na sessão em foco. É a única exceção ao "uma sessão por etapa" do MD-01.
- **[C1 + C2 ✔] Número só entra medido — cerca de regressão, não meta.** Repete o
  padrão da 007 (alvo estimado → medição real → cerca em ~2× o pior caso).
  - **RAM:** a 003 **não herda** a dívida dos 400 MB (o app já roda em 417–451 MB por
    razões pré-existentes). O requisito é **delta**: ligar o Modo Dev com um discovery
    de ~3 marcos não deve custar mais de **+50 MB** sobre o modo Uso geral, e o
    arquivamento de abas (CA-6) deve empurrar isso para baixo. **Melhorar o consumo
    geral de memória do app é trabalho futuro** (decisão dele), não desta entrega.
  - **Montagem do mapa:** alvo de **< 200 ms** para a árvore de um discovery com até
    5 marcos, partindo dos manifestos em disco; vira cerca de regressão em ~2× o pior
    caso medido.
  - **Regra geral:** nenhum número entra sem medição própria — cada um ganha seu
    `medicao-*.md`, como 006/007/008 fizeram.

## Riscos e o que pode dar errado

| Risco | Onde mora |
|---|---|
| Alguém "melhorar" o CA-3 enviando o `\r` para poupar um clique | Invariante 2 — uma fase disparada por engano custa uma sessão de cota |
| A UI virar proteção de fato e a trava real ser esquecida | CA-5 — a UI avisa, o `preflight.py` decide |
| Arquivar a aba (CA-6) antes do manifesto existir e parecer perda de trabalho | Gatilho é o `result.json`, nunca o fim do processo |
| Varredura de disco entrar "só para completar" a lista de artefatos | CA-8 — declarado pela fase, nunca adivinhado |
| O espelho alarmar divergência normal e virar ruído que se ignora | CA-13 — Validar nunca move coluna |
| Token do board acabar no repo ou em log | CA-11 — credencial de serviço, fora do repo |
| Recriar componente do design system por conveniência | CA-25 — extensão é nomeada e aprovada |
| A árvore custar RAM num app que já estoura o budget | C1/C2 — medir, não estimar |
| Modo Dev nascer inútil para desenvolver o próprio Donel Dev | Achado 13 — custo assumido no MD-01, não descoberta tardia |

## Notas de realidade

- O mapa Wayfinder já resolveu as decisões difíceis; esta spec é a **tradução** delas
  em critérios verificáveis. Se um `[MD-0x]` parecer errado, o caminho é reabrir o
  ticket no vault, não decidir diferente aqui.
- A parte mais barata da feature é o gesto mais valioso: **pré-digitar** é ligar um
  canal que já existe (achado 8). O custo real está no mapa lateral e no espelho.
- Nada nesta spec exige mudança na Esteira. Se alguma task de implementação começar a
  pedir isso, é sinal de que a spec foi mal lida — não de que a Esteira precisa mudar.
- O `design/brief-modo-dev-v2.md` já reflete tudo isto; o Brief 10 antigo do
  `design-handoff.md` está marcado como superado (organizava por *task* e trazia o
  preset QRSPI descartado).
