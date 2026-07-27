# Tasks 003 — Modo Dev

**Referências:** `spec.md` (CA-1..CA-26, invariantes 1–6, `[MD-0x]`, `[C1]`–`[C6]`)
e `plan.md` (arquitetura, modelo de dados, tabela CA-4, caminho do CA-3, riscos,
estratégia de teste) deste diretório.

**30 tasks — `T301`–`T330`**, contíguas na ordem de dependência, **agrupadas
pelas duas fatias do C5** (cada fatia fecha com seu próprio PR):

- **Fatia 1 — condução e mapa** (CA-1 a CA-10, CA-15 a CA-23): Batch A
  (T301–T309, invisível) → Batch B (T310–T323, o que ele vê).
- **Fatia 2 — espelho** (CA-11 a CA-14): Batch C (T324–T326, invisível) →
  Batch D (T327–T330, o que ele vê).

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros/injetáveis (é onde a feature se decide — `plan.md`
§Estratégia de teste); UI valida por smoke roteirizado, isolado do `%APPDATA%`
real, com fixture de `.esteira/` e board mockado — **nunca** abrindo sessão
`claude` real ou lendo o board de verdade só para popular um teste.

## Regras duras que atravessam TODAS as tasks (não repetir por task, mas valem)

1. **Nenhum comando é enviado com `\r`.** Toda chamada a `window.donel.pty.
   input`/`ptyManager.input` desta feature passa só o texto do comando — o
   Enter é sempre gesto humano (invariante 2, CA-3, CA-13, CA-16).
2. **Zero código novo em `preflight.py` e `gate_concluir.py`** (invariante 3)
   — nenhuma task desta lista os toca, nem indiretamente. Se uma task parecer
   precisar disso, ela está mal desenhada — revisar antes de codar.
3. **O app não escreve no board nem no vault** (invariante 5, CA-14, CA-19) —
   nenhuma task cria um canal IPC de escrita para TaskDex ou Obsidian.
4. **Não recriar componente do design system** (CA-25, achado 12) — qualquer
   peça visual que não exista nas 16 peças atuais precisa de nome + aprovação
   explícita antes de virar código; nenhuma task assume isso implicitamente.
5. **Tasks de UI são de alcance, não de forma** (CA-24/CA-26) — nenhuma task
   abaixo especifica cor, ícone ou layout; isso é insumo da sessão de design
   em paralelo (`design/brief-modo-dev-v2.md`).

---

## Fatia 1 — Batch A: núcleo puro e IPC (invisível ao usuário)

> Nada nesta fase muda a tela. Fecha com `npm run typecheck` + `npm test`
> verdes. **Não empacotar.**

- **T301 — Modelo de estado do Modo Dev (TDD, módulo puro novo)** — `src/shared/devMode.ts`
  Tipos `DevModeDiscovery`, `ArchivedPhaseSession`, `DevModeState` (ver
  `plan.md` §Modelo de dados) + funções puras `openDiscovery`,
  `focusDiscovery`, `closeDiscovery`, `archivePhaseSession`,
  `linkDiscoveryRepo`. **CA-21, CA-22.**
  **Teste primeiro:** abrir discovery adiciona entrada e não mexe em foco de
  outro; focar muda só o foco (um único discovery em foco, CA-21); arquivar
  sessão grava `sessionId` + `profileSlug` + `archivedAt`; retomar uma etapa
  arquivada num perfil diferente do ativo é detectável (não falha, só sinaliza
  divergência de perfil — CA-22); `closeDiscovery` de id inexistente é no-op.

- **T302 — Tabela de defaults por fase (TDD)** [P] com T301 — `src/shared/devModeDefaults.ts`
  `PhaseDefaultsTable`, `DEFAULT_PHASE_DEFAULTS` (a tabela do C6) e
  `resolveCommandText(entry, cardId)` — substituição pura de `{card_id}`.
  **CA-4.**
  **Teste primeiro:** as 5 fases existem na tabela default; `implementar`
  contém a palavra-chave `ultracode` no `commandTemplate`; `concluir` tem
  `opensOwnSession: false` e todas as outras `true`; `resolveCommandText`
  substitui o placeholder sem deixar `{card_id}` literal no resultado.

- **T303 — Leitura dos artefatos de fase no disco (TDD)** (sequencial após T301/T302 — usa os tipos) — `src/main/esteira-reader.ts`
  `readPhaseArtifacts`, `readDiscoveryFanout`, I/O injetável (mesmo padrão de
  `ConfigIoDeps`, nunca lança). **CA-8, CA-10 (parte da leitura), C4.**
  **Teste primeiro:** `ctx.md` presente + `result.json` ausente → `ctxExists:
  true`, `result: null`, `resultUnreadable: false`; `result.json` com JSON
  corrompido → `resultUnreadable: true`, nunca lança; `fanout_cards` ausente
  (fase que não é discovery) → `[]`; `result.json` bem formado devolve os
  campos `outputs.artifact_paths`/`e2e_path`/`documents` tal como estão, sem
  transformação.

- **T304 — Derivação dos 5 estados de fase (TDD, pure)** [P] com T303 — `src/shared/phaseState.ts`
  `derivePhaseStatus({ ctxExists, result, resultUnreadable, sessionAlive })` —
  as 5 linhas da tabela do CA-15. **CA-15.**
  **Teste primeiro:** sem `ctx.md` → `not-started`; sessão viva → `running`
  independente do resto; `result.status === 'success'` → `done`; `result`
  presente com `status` ≠ `success` → `failed`; `ctx.md` presente + `result`
  ausente + sessão não viva → `stuck`; `resultUnreadable: true` some estado
  próprio (nunca `done`/`failed` por adivinhação) — marcador discreto, não um
  6º estado inventado.

- **T305 — Montagem da árvore do discovery (TDD)** (sequencial após T303/T304) — `src/main/discovery-tree.ts`
  `buildDiscoveryTree` (marcos × fases, `allMarcosComplete` do CA-23) +
  `resolveArtifactPool` (lista fixa de candidatos do CA-10). **CA-7, CA-9
  (liga `archivedPhaseSessions` ao nó), CA-10, CA-23, C4.**
  **Teste primeiro:** árvore com 3 marcos monta 3 ramos × 5 fases cada;
  `allMarcosComplete` só é `true` quando TODA fase `concluir` de TODO marco tem
  `status: success`; discovery antigo sem `session-id` arquivado (C4) monta
  igual, com os cliques degradando para "abre artefato" (verificado no smoke,
  T322); `resolveArtifactPool` nunca lista um path fora da constante fixa.

- **T306 — `devMode` no ConfigStore (TDD na parte pura)** (sequencial após T301/T302) — `src/main/config-store.ts`, `src/shared/config.ts`
  Chave nova tocando os **quatro pontos** do padrão do arquivo (`AppConfig`,
  `defaultAppConfig`, `sanitizeAppConfig` entrada a entrada, `toAppConfigDto`+
  `AppConfigDto`) — mesma armadilha real já paga pela T704/007.
  `CONFIG_SCHEMA_VERSION` **não sobe**. **CA-21.**
  **Teste primeiro:** round-trip em disco (tmpdir, nunca `%APPDATA%` real);
  `config.json` legado sem a chave `devMode` carrega com os defaults e não
  perde `sessionRegistry`/`favorites`/demais chaves; discovery malformado
  (sem `repoPath`) é descartado isolado, preservando os demais; `phaseDefaults`
  malformado cai no `DEFAULT_PHASE_DEFAULTS` inteiro (não mistura fase boa com
  fase quebrada, evita tabela inconsistente).

- **T307 — IPC `devMode:*`** (sequencial após T305/T306) — `src/shared/devMode.ts` (canais), `src/main/index.ts`, `src/preload/index.ts`
  Canais: `get`, `openDiscovery`, `focusDiscovery`, `closeDiscovery`,
  `archivePhaseSession`, `getDefaults`, `setDefaults`, `readTree(cardId)` —
  todos devolvendo `AppConfigDto` ou `DiscoveryTree` (padrão dos `config:set*`/
  `sessions:*`). O `main` valida payload (cardId/repoPath vazios = no-op).
  **Nenhum canal de escrita para TaskDex ou vault** (invariante 5, CA-19) —
  checklist explícito desta task. **CA-21, CA-4, CA-19.**
  **Teste primeiro:** typecheck ponta a ponta (main→preload→shared); unit da
  validação de payload; grep de auditoria confirma que nenhum canal novo
  chama `mcp__taskdex` de escrita nem grava arquivo fora de `%APPDATA%`.

- **T308 — Watcher de arquivamento por manifesto (TDD)** (sequencial após T303) — `src/main/esteira-result-watcher.ts`
  Mesmo padrão de `transcript-watcher.ts` (`fs.watch` do **diretório**
  `handoffs/<card_id>/`, nunca do arquivo, com retry limitado): quando
  `<fase>-result.json` aparece com `status: "success"`, emite evento
  `{ cardId, marcoId, fase, manifestPath }`. **Gatilho é o manifesto em
  disco, nunca "o processo terminou".** **CA-6.**
  **Teste primeiro:** manifesto aparecendo com `status: success` dispara o
  evento; `status` ≠ `success` NÃO dispara (etapa que falhou fica aberta,
  conforme CA-6); diretório inexistente no boot do watch faz retry limitado,
  nunca lança; dois manifestos da mesma fase (reprocessamento) não duplicam
  evento.

- **T309 — Cliente mínimo de leitura do board (porta de entrada)** [P] com T308 — `src/main/taskdex-board-client.ts` (+ tipos em `src/shared/devMode.ts`)
  **Escopo estritamente Fatia 1**: uma função,
  `listEntryColumnCards(boardConfig)`, restrita às colunas Backlog/Discovery/
  Plano de UM board configurado (CA-1) — nenhuma outra tool de leitura entra
  aqui (o conjunto fechado do CA-11 é Fatia 2, T324). **CA-1, CA-2.**
  **Teste primeiro:** resposta mockada com cards de 4 colunas → só as 3
  permitidas voltam; card sem coluna reconhecida é ignorado (nunca lança);
  `boardConfig` ausente → lista vazia (porta de entrada desligada, não erro).

- **Gate do Batch A:** `npm run typecheck` + `npm test` completos verdes.
  Commitar (commit em branch de feature é default). **Nada visível mudou.**

## Fatia 1 — Batch B: o que ele vê

- **T310 — Modo Dev: toggle e layout (CA-20)** (sequencial após T307) — `src/renderer/src/App.tsx`
  Liga/desliga reorganiza o layout da janela; a tela de hoje (tabs/sidebar
  atuais) **não é desmontada**, só ocultada — mesmo princípio de visibilidade
  via CSS já usado nas abas de terminal (T007, "todas as abas ficam
  montadas"). **CA-20, CA-24 (o alcance do toggle é comportamental; a forma
  do layout é da sessão de design).**
  **DoD:** smoke — ligar/desligar preserva as abas abertas e seu estado (PTY
  não é recriado); typecheck limpo.

- **T311 — Zona 1: porta de entrada (lista de candidatos)** (sequencial após T309/T310) — `src/renderer/src/DevMode/DevModeEntry.tsx` (novo)
  Lista os cards de `listEntryColumnCards` (T309); card com discovery já aberto
  (via `devMode:get`) aparece marcado, selecioná-lo foca aquele discovery
  (`devMode:focusDiscovery`); selecionar card de **Plano** resolve o
  `cardId` do discovery **pai** (o card de entrada, não o de marco) antes de
  focar; criar novo dispara o fluxo do CA-3 (T312) com a skill
  `/esteira-discovery`. **CA-1, CA-2, CA-24/25 (composição só com peças do
  design system).**
  **DoD:** smoke — card vinculado aparece marcado; selecionar card de Plano
  abre o discovery pai, não um discovery novo; card fora das 3 colunas nunca
  aparece.

- **T312 — Zona 2: abrir fase + pré-digitar (o gesto central)** (sequencial após T302/T305/T310) — `src/renderer/src/DevMode/openPhaseSession.ts` (novo, núcleo puro + wiring), `src/renderer/src/App.tsx`
  Núcleo puro testável: decide `create` (fase normal) vs. resolver o `ptyId`
  em foco (fase `concluir`, ver T313) vs. `resume` (CA-9, ver T318) a partir
  de `PhaseDefault.opensOwnSession` + o estado da fase. Wiring: cria/foca PTY,
  **espera o semáforo (`semaphore.onUpdate`) entrar em `'waiting'` pela
  primeira vez**, então chama `window.donel.pty.input(ptyId, resolveCommandText
  (defaults, cardId))` **sem `\r`**. **CA-3, CA-4 (usa o texto exato da
  tabela, incl. `ultracode` em `implementar`), invariante 2.**
  **Teste primeiro (núcleo puro):** dado `opensOwnSession: true` → decide
  `create`; dado `false` → decide "usar aba em foco"; o texto passado a
  `pty.input` é exatamente `resolveCommandText(...)`, nunca com sufixo `\r`/
  `\n` concatenado (assert de string, não de comportamento do PTY).
  **DoD smoke:** cria sessão com `--model`/`--effort` corretos da tabela;
  texto exato aparece no buffer do PTY sem ter sido "enviado" (nenhuma nova
  linha de output do CLI processando o comando) até o Enter humano do teste.

- **T313 — Zona 2: exceção da fase `concluir`** (sequencial após T312) — mesmos arquivos de T312
  Quando a fase é `concluir`, resolve o `ptyId` da aba **em foco no momento do
  clique** e pré-digita nela — **nunca** cria PTY nova (única exceção ao "uma
  sessão por etapa", C6). Sem aba em foco (nenhuma aberta): mostra aviso e não
  faz nada (nunca cria uma sessão "vazia" só pra ter onde digitar).
  **CA-4 (consequência do C6).**
  **DoD:** smoke — clicar `concluir` com uma aba `claude` em foco pré-digita
  nela; sem aba nenhuma aberta, nenhuma sessão nova é criada e um aviso
  aparece.

- **T314 — Zona 2: slot de aviso de trava (estrutura, sem dado ainda)** [P] com T313 — `src/renderer/src/DevMode/PhaseButton.tsx` (novo)
  Botão da próxima fase **sempre clicável** (nunca desabilitado por trava —
  invariante 4/CA-5), com um slot de aviso que fica vazio nesta fatia (ver
  `plan.md` §"Nota — CA-5"; o dado chega na Fatia 2 via T327). **CA-5.**
  **DoD:** smoke — botão permanece clicável mesmo com estado simulado de
  trava; nenhum aviso aparece ainda (comportamento esperado, não bug).

- **T315 — Zona 2: arquivamento de sessão concluída** (sequencial após T308/T312) — `src/renderer/src/App.tsx`
  Assina o evento do watcher (T308); ao chegar `{cardId, marcoId, fase}` com
  sucesso, localiza a aba cujo `claudeSessionId` corresponde à sessão daquela
  etapa, **fecha a aba** e chama `devMode:archivePhaseSession` (grava
  `sessionId` + perfil ativo no momento — reuso do `profile` já devolvido por
  `pty.create`, ver achado FIX "perfil de nascimento"). Etapa que falhou
  **não** arquiva — fica aberta (CA-6). Nenhum `.jsonl` é apagado.
  **CA-6.**
  **DoD:** smoke — manifesto de sucesso fecha a aba certa e persiste o
  `session-id`; manifesto de falha mantém a aba aberta; transcript nunca é
  tocado (só lido).

- **T316 — Zona 3: árvore do mapa lateral** (sequencial após T305/T310) — `src/renderer/src/DevMode/DiscoveryMap.tsx` (novo)
  Desenha o discovery em foco por completo via `devMode:readTree` — um ramo
  por marco `[Mx]`, nó = fase da Esteira, marco em foco destacado. **Não**
  repete o presente da zona de terminal (não duplica o que a Zona 2 já
  mostra). **CA-7, CA-24/25.**
  **DoD:** smoke — árvore de discovery com 3 marcos monta 3 ramos × 5 nós;
  marco em foco tem marcação distinta; nenhuma chamada a git/varredura de
  disco fora de `devMode:readTree`.

- **T317 — Zona 3: expandir nó (skills, artefatos, recibos)** (sequencial após T316) — mesmos arquivos de T316
  Expandir um nó mostra: a skill fixa daquela fase (tabela do CA-4/plan.md,
  **não** um dado novo do manifesto — ver `plan.md`), os artefatos declarados
  (`artifact_paths`/`e2e_path`/`documents[]` + `ctx.md` + o próprio
  `result.json`, **nunca** `git diff`/varredura), e os recibos de
  conhecimento (`registrations`/`outputs.knowledge` do manifesto — indicador
  discreto quando ausente, **sem** cobrar nada quando não há vault
  configurado). **CA-8, CA-10, CA-17, CA-18, CA-19.**
  **DoD:** smoke — nó expandido lista exatamente os artefatos do
  `result.json` de fixture (nenhum a mais, nenhum a menos); etapa sem
  `registrations.vault` mostra indicador discreto, não erro nem "incompleto";
  nenhuma chamada de escrita é feita a partir da expansão (asswinatura só de
  leitura, CA-19).

- **T318 — Zona 3: retomar fase concluída / degradação de discovery antigo** (sequencial após T317) — `src/renderer/src/DevMode/DiscoveryMap.tsx`, `openPhaseSession.ts`
  Clicar numa fase **concluída** com `archivedSession` presente retoma via
  `continuation.resume` (CA-9). Discovery antigo (C4) sem `session-id`
  arquivado: o clique **abre o artefato** (`result.json`/`ctx.md`, não uma
  sessão) — degradação esperada, não erro. **CA-9, C4.**
  **DoD:** smoke — fixture com `archivedSession` retoma a sessão certa (argv
  com `-r <sessionId>`); fixture "antiga" sem `archivedSession` abre o
  artefato em vez de tentar retomar.

- **T319 — Estados de fase na UI + retomada por estado (CA-15/CA-16)** (sequencial após T304/T314/T316) — `src/renderer/src/DevMode/PhaseButton.tsx`, `src/renderer/src/DevMode/openPhaseSession.ts`
  Os 5 estados do CA-15 ficam **inconfundíveis** — requisito literal: "falha
  tem de ser a coisa mais clara da tela" (a REPRESENTAÇÃO visual é da sessão
  de design; esta task garante que o **dado certo chega** à peça certa).
  Clicar fase **falhou** pré-digita a mesma skill; clicar fase **travada**
  pré-digita `/esteira-liberar {card_id}` e, só depois do semáforo voltar a
  `'waiting'`, pré-digita o comando da fase — **dois Enters humanos
  distintos, nunca um só para os dois comandos**. **CA-15, CA-16, invariante
  2.**
  **Teste primeiro (núcleo puro em `openPhaseSession.ts`):** sequência
  `travada` → `['/esteira-liberar {card_id}', commandTemplate]`, cada item só
  liberado após o sinal de `'waiting'` do anterior; sequência `falhou` →
  `[commandTemplate]` (um só passo).
  **DoD smoke:** clicar travada digita o comando de liberar primeiro; só
  depois do "Enter" simulado do teste e do semáforo voltar a `waiting`, o
  segundo comando aparece pré-digitado — nunca os dois ao mesmo tempo.

- **T320 — Perfil de conta por etapa arquivada (CA-22 na UI)** [P] com T319 — `src/renderer/src/DevMode/PhaseButton.tsx` ou `SessionDetails.tsx`
  Ao retomar uma etapa arquivada (T318) cujo `profileSlug` difere do perfil
  ATIVO agora, mostra aviso inline "essa etapa rodou na conta X" — **nunca
  falha em silêncio, nunca bloqueia** (distribuir etapas entre contas é uso
  pretendido, CA-22/C3). **CA-22.**
  **DoD:** smoke — retomar etapa arquivada em perfil B com perfil A ativo
  mostra o aviso e retoma normalmente; mesmo perfil não mostra aviso.

- **T321 — Encerramento automático do discovery (CA-23)** (sequencial após T305) — `src/renderer/src/App.tsx`, `src/shared/devMode.ts`
  Quando `discoveryTree.allMarcosComplete` vira `true`, o discovery some da
  lista de "abertos" (CA-21) sem passo manual — fato verificável (gate de
  `esteira-concluir` de cada marco), não opinião do app. **CA-23.**
  **DoD:** smoke — fixture com todos os marcos `concluir: success` faz o
  discovery desaparecer da lista de abertos no próximo `devMode:get`; um
  marco pendente mantém o discovery na lista.

- **T322 — Smoke completo da Fatia 1** [P] com T321 (escrito junto, roda depois) — `tests/smoke/dev-mode-conducao-mapa.spec.ts` (novo)
  Isolado de `%APPDATA%` real e do board real — fixture de `.esteira/` +
  board mockado (T309). Cobre, ponta a ponta: abrir discovery pela porta de
  entrada (T311), pré-digitar sem `\r` (T312, o teste mais importante da
  feature), exceção `concluir` (T313), arquivamento por manifesto (T315),
  árvore completa + expansão de nó (T316/T317), retomada certa por estado
  (T318/T319), aviso de perfil (T320), encerramento automático (T321), toggle
  preservando a tela de hoje (T310).
  **DoD:** suíte nova verde, tempo total dentro do orçamento dos smokes
  existentes (referência: `favorite-sessions.spec.ts` ~6 s).

- **T323 — Medição C1/C2 (gate final da Fatia 1)** — `specs/003-modo-dev/medicao-ram.md`, `specs/003-modo-dev/medicao-mapa.md` (novos)
  Medir e **registrar o número**, nunca estimar: (a) delta de RAM entre modo
  Uso geral e Modo Dev ligado com discovery de ~3 marcos (alvo `+50 MB`); (b)
  tempo de montagem da árvore para até 5 marcos (alvo `< 200 ms`), com
  polling apertado (lição da 004/007: `expect().toPass` do Playwright mediu
  852 ms para algo de ~350 ms). Ambos viram cerca de regressão em ~2× o pior
  caso medido, como 006/007/008 fizeram. Suíte completa (`typecheck`+`test`+
  `test:smoke`+`test:smoke:dev`) rodada e vermelhos herdados declarados;
  `npm run build`+`npm run dist`. **C1, C2.**
  **DoD:** os dois `medicao-*.md` com o número medido e a cerca de regressão
  correspondente já commitada como teste; **PR da Fatia 1 pronto para
  revisão** (Fatia 2 não é pré-requisito).

---

## Fatia 2 — Batch C: espelho — cliente e leitura (invisível)

> Só começa depois da Fatia 1 ter PR aberto (não precisa estar mergeada,
> mas não reabre o C5 rodando em paralelo sem depender do resultado dela).

- **T324 — Cliente de leitura do TaskDex, lista fechada de tools (CA-11)** (sequencial após T309) — `src/main/taskdex-board-client.ts` (estende T309)
  Credencial de serviço **dedicada** (fora do repo, mesmo padrão de
  `~/.claude/esteira-config/` — nunca em log nem versionada), restrita a uma
  **lista fechada** de tools de leitura (as mesmas exigidas por CA-12: coluna
  real do card, labels de atenção/trava, PR vinculado + aprovação).
  **Nenhuma tool de escrita entra no código** — garantia estrutural (a lista
  de tools permitidas é uma constante, não uma allowlist em runtime que
  alguém possa esquecer de checar). **CA-11.**
  **Teste primeiro:** chamada com uma tool fora da lista fechada lança em
  **tempo de compilação/lint** (tipo restrito), não em runtime; resposta
  mockada mapeia coluna/labels/PR corretamente; token nunca aparece em log
  (assert em captura de console/stdout do teste).

- **T325 — Anotação dos 4 fatos no nó (pure mapping)** (sequencial após T324/T305) — `src/shared/boardAnnotation.ts` (novo)
  `annotateTree(tree: DiscoveryTree, boardFacts): AnnotatedDiscoveryTree` —
  sobrepõe coluna real, trava ativa, etiquetas de atenção
  (`esteira:escalado`/`esteira:precisa-atencao`) e PR+aprovação a cada nó,
  **sem persistir nada** (CA-14: `marco_id` continua vindo do disco/
  `fanout_cards`, o `[Mx]` do board é só conferência). **CA-12, CA-14.**
  **Teste primeiro:** fato do board sobrepõe sem alterar `PhaseNode` original
  (imutabilidade); `[Mx]` do título do card divergindo do `marco_id` de disco
  gera um marcador de conferência, **nunca** substitui o `marco_id` de disco;
  card fora do discovery em foco nunca entra na anotação (CA-12: "nunca
  cards fora do discovery em foco").

- **T326 — Detecção de divergência disco×board** (sequencial após T325) — `src/shared/boardAnnotation.ts` (extensão)
  Quando disco e board discordam (ex.: fase mostra `done` no disco mas o
  card ainda está na coluna anterior), marca o nó com os **dois fatos** +
  marcador de divergência. Divergência **esperada** pelo processo (Validar
  nunca move coluna, por invariante da Esteira) **não** vira marcador de
  alarme — é filtrada explicitamente, não silenciada por acidente. **CA-13
  (parte de detecção — a sessão de conciliação é T328).**
  **Teste primeiro:** fase `done` + card em coluna anterior a "Validar" (não a
  fase seguinte esperada) → marca divergência; fase `validar` `done` + card
  ainda na coluna de antes de Validar → **não** marca (é o caso esperado,
  citado explicitamente na spec).

- **Gate do Batch C:** `npm run typecheck` + `npm test` verdes. Nada visível.

## Fatia 2 — Batch D: UI do espelho

- **T327 — Overlay dos 4 fatos no mapa** (sequencial após T325/T316) — `src/renderer/src/DevMode/DiscoveryMap.tsx`
  Liga `annotateTree` (T325) ao componente de T316/T317: cada nó passa a
  mostrar coluna real, trava ativa (fecha o slot vazio do T314 — a Fatia 2 só
  entrega o DADO, o slot já existe), etiquetas de atenção, PR+aprovação. O
  espelho **não tem tela própria** — é só anotação em cima da árvore que já
  existe. **CA-12, CA-24/25.**
  **DoD:** smoke — nó com trava ativa (fixture de board) acende o slot do
  T314; nó sem trava permanece vazio; comentário/descrição/checklist do card
  **nunca** aparecem (fora do escopo do CA-12).

- **T328 — Marcador de divergência + sessão de conciliação** (sequencial após T326/T312) — `src/renderer/src/DevMode/DiscoveryMap.tsx`, `openPhaseSession.ts`
  Nó com divergência (T326) mostra os dois fatos + marcador; oferece abrir
  sessão de conciliação com um prompt **pré-digitado** descrevendo os pontos
  divergentes — mesma regra do CA-3 (T312: espera `'waiting'`, nunca envia
  `\r`). **O app nunca corrige o board sozinho** (CA-13, invariante 5).
  **CA-13.**
  **DoD:** smoke — clicar "conciliar" pré-digita um texto que cita os dois
  fatos divergentes, sem `\r`; nenhuma chamada de escrita ao TaskDex acontece
  nesse fluxo (assert de rede/log).

- **T329 — Smoke completo da Fatia 2** [P] com T328 — `tests/smoke/dev-mode-espelho.spec.ts` (novo)
  Isolado de board real (mock do cliente T324). Cobre: overlay dos 4 fatos
  (T327), divergência não-alarmante filtrada (T326), sessão de conciliação
  pré-digitada (T328), ausência total de escrita no board em qualquer
  caminho exercitado.
  **DoD:** suíte nova verde.

- **T330 — Gate final da Fatia 2** — suíte completa + dist + roteiro E2E
  Suíte completa (`typecheck`+`test`+`test:smoke`+`test:smoke:dev`) com
  vermelhos herdados declarados; `npm run build`+`npm run dist`; roteiro E2E
  cobrindo o que só ele valida: abrir o espelho com token de serviço real (ou
  sandbox dedicado), ver os 4 fatos aparecerem, forçar uma divergência real e
  abrir a sessão de conciliação, confirmar que nada foi escrito no board
  depois do teste.
  **DoD:** `medicao-*.md` da Fatia 1 seguem valendo (nenhuma regressão de RAM/
  tempo introduzida pela Fatia 2 — medir de novo se o overlay for pesado);
  **PR da Fatia 2 pronto para revisão**.

---

## Tabela de cobertura — CA → task

| CA | Task(s) |
|---|---|
| CA-1 | T309, T311 |
| CA-2 | T309, T311 |
| CA-3 | T312, T322 |
| CA-4 | T302, T312, T313 |
| CA-5 | T314, T327 (dado real) |
| CA-6 | T308, T315 |
| CA-7 | T305, T316 |
| CA-8 | T303, T317 |
| CA-9 | T305, T318 |
| CA-10 | T303, T305, T317 |
| CA-11 | T324 |
| CA-12 | T325, T327 |
| CA-13 | T326, T328 |
| CA-14 | T325 |
| CA-15 | T304, T319 |
| CA-16 | T319 |
| CA-17 | T303, T317 |
| CA-18 | T317 |
| CA-19 | T307, T317 |
| CA-20 | T310 |
| CA-21 | T301, T306, T307 |
| CA-22 | T301, T320 |
| CA-23 | T305, T321 |
| CA-24 | T310, T311, T314, T316, T317, T327 (alcance, não forma — todas as tasks de UI) |
| CA-25 | T310, T311, T314, T316, T317, T327 (peças do design system, nenhuma recriada) |
| CA-26 | T323, T330 (gates fecham sem esperar a sessão de design) |

**Nenhum CA órfão** — CA-1 a CA-26 aparecem todos em pelo menos uma task.

## Ordem e dependências (resumo)

- **Fatia 1 → Fatia 2**, PRs separados (C5). Dentro da Fatia 1: Batch A →
  Batch B. Dentro do Batch A: T301/T302 em paralelo → T303/T304 (paralelo
  entre si, dependem de T301/T302) → T305 → T306 (paralelo com T301/T302,
  mas precisa deles para compilar) → T307 (depende de T305+T306) → T308
  (depende de T303) → T309 (paralelo com T308).
- Dentro do Batch B: T310 (depende de T307) → T311 (depende de T309/T310) →
  T312 (depende de T302/T305/T310) → T313 (depende de T312) → T314 (paralelo
  com T313) → T315 (depende de T308/T312) → T316 (depende de T305/T310) →
  T317 (depende de T316) → T318 (depende de T317) → T319 (depende de
  T304/T314/T316) → T320 (paralelo com T319) → T321 (depende de T305) → T322
  (depende de tudo acima, escreve-se junto de T321) → T323 fecha.
- Dentro da Fatia 2: T324 (depende de T309) → T325 (depende de T324/T305) →
  T326 (depende de T325) → gate Batch C → T327 (depende de T325/T316) → T328
  (depende de T326/T312) → T329 (junto de T328) → T330 fecha.

## Fora destas tasks (não implementar por conta própria)

- Escrita do app no board (mover coluna, vincular PR) — nunca, em nenhuma
  task (invariante 5).
- Migrar a ownership dos fatos de esteira para o app (achado MD-07) — fora
  desta entrega.
- Aposentar a tela atual do Donel Dev.
- Visão de portfólio (Mission Control).
- Suporte a trabalho sem card do board, incluindo o próprio `donel-dev`.
- Qualquer alteração em `preflight.py`/`gate_concluir.py`.
- Parsing novo de transcript além de `customTitle`/`contextTokens`
  (`transcript-watcher.ts` já existente).
- Forma visual (cor/ícone/layout/densidade/microinteração) — é insumo da
  sessão de design em paralelo, nunca destas tasks.
