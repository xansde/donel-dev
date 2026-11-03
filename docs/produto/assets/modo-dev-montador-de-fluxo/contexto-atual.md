# Contexto atual — Modo Dev como montador de fluxo (fatos do repo, 2026-10-24)

Só fatos com fonte. O que não tem fonte está em "Lacunas" no fim.

## 1. O que o Modo Dev é hoje

- Um dos três modos do casco: `appMode: 'geral' | 'dev' | 'mindscape'` (`src/renderer/src/App.tsx:444`); `devModeOn = appMode === 'dev'` (`App.tsx:445`).
- Origem: conduz o trabalho de um card pelas fases da Esteira lendo o que ela grava em disco (`specs/003-modo-dev/spec.md`; `handoffs/modo-dev-estado-atual.md` §1).
- Fases modeladas: `discovery | plano | implementar | validar | documentar | cliente | concluir` (`src/shared/devMode.ts:19`).
- Cada fase tem uma tabela de defaults (modelo, esforço, comando pré-digitado), editável em runtime: ex. `/esteira-discovery {card_id}` (fable/high), `/esteira-implementar {card_id} ultracode` (opus/high) (`src/shared/devModeDefaults.ts:1-39`). O comando é pré-digitado e o dono dá o Enter; o autostart do Enter é um item da 012 ainda não feito (`specs/012-esteira-4/execucao.md`, trilha E `autostart-enter`; `specs/backlog.md` B28).
- Estado próprio do app: discoveries abertos, um em foco, vínculo discovery-repo, `session-id` arquivados por etapa concluída com a conta em que rodaram (`src/shared/devMode.ts:30-60`).
- Entrada: porta de entrada lê cards do board TaskDex por coluna (`specs/009-modo-dev-v3/spec.md` CA-1/CA-2; `docs/board-do-modo-dev.md`). Na 010, sessão nova só nasce de card em Discovery ou de discovery local (`specs/010-esteira-donel/spec.md`, "Entrada e sessões" D-14).
- Três superfícies coexistem hoje dentro do modo Dev, todas existem no código:
  1. Mapa antigo `DiscoveryMap` + `PhaseDetailsPanel` (`src/renderer/src/DevMode/`).
  2. "Esteira nova" (spec 010), atrás de um botão (`App.tsx:2344-2360`, `esteiraOpen`; tela em `src/renderer/src/Esteira/EsteiraScreen.tsx`); o comentário do código diz que convivem até o vertical fechar.
  3. Mapa de nós em tela cheia (`src/renderer/src/DevMode/NodeGraphOverlay.tsx`, d3-force + SVG; 012 `wi-esteira4-mapa-grafos`, commit `14ad6fb`, PR #63).
- Trava: na 009 era etiqueta do board (`CLAUDE.md` do repo, gatilho "implementar melhorias Modo Dev"); a 010 (D-11) a tornou local, com dono, hora e sessão, liberável num gesto (`specs/010-esteira-donel/spec.md`, "Tracker: adapter opcional"). Implementada em `src/main/esteira-dispatch.ts:1-40`, que cita também trava por recurso de escrita (repo+caminho físico) e recusa de 2ª sessão viva no mesmo item+fase.
- Implementado vs só especificado (009): o spec marca como implementados só CA-22 e CA-29 (`specs/009-modo-dev-v3/spec.md:8-12`), mas o texto não foi atualizado depois; o git mostra "leva noturna 009 (lotes 1-9)" e fixes mergeados (`handoffs/modo-dev-estado-atual.md` §1). Estado exato dos 31 CA: não conferido item a item.
- Engrenagem de configuração por projeto (CA-23) e lançar projeto do zero (CA-30): constam no spec 009; não verifiquei se foram implementados.

## 2. Esteira do Donel / orquestração hoje

Sequência de fases e sessão por fase: EXISTE (implementado).
- Fases em sequência, cada uma com comando próprio (`devModeDefaults.ts`). Mudar de fase abre sessão nova sempre; dentro da fase, orçamento de contexto (~400k) decide abrir outra, encadeada por `continuesSessionId` (`specs/010-esteira-donel/spec.md` pendência P-6; `src/main/esteira-dispatch.ts:5-9`).
- Skill por fase: EXISTE, fixa (uma skill `/esteira-<fase>` por fase). O dono só edita a tabela de defaults (`devModeDefaults.ts:1-4`); não há montagem de skills por sessão.
- Tipos de WorkItem (010 D-4): `issue`, `spec`, `process-map`, `adr`, `prototype`, `spike`, `eval`, em 3 ciclos de vida (entrega de código, artefato revisado, pergunta respondida) (`specs/010-esteira-donel/spec.md`, "Tipos e ciclos de vida"). Grafo com relações "originou" e "desagua em"; ampulheta é convenção, desvio só sinaliza (idem, "Grafo"). Macro etapa é derivada do grafo (D-13).
- Store próprio (eventos JSONL + snapshot) em `userData`, com ingestão dos `result.json` das skills (`specs/010-esteira-donel/spec.md`, "Store" e "Contrato app-skills"; `src/main/esteira-store.ts`, `esteira-ingest.ts`, `esteira-result-watcher.ts`).
- A tela da esteira já exibe decisões humanas pendentes e checklist de revisão (`humanDecisionLines`, `reviewChecklist` importados em `EsteiraScreen.tsx`).

Fan-out, fan-in, orquestrador, agente que resume: SÓ ESPECIFICADO, NÃO IMPLEMENTADO.
- 012 `motor.md`: scheduler (card sem dependência pendente no `esteira.grafo` é "pronto"), cursor por card, teto de paralelismo, worktree por card, sessão headless por fase 0% humana, fila de merge serial, suíte 1x por plano, laço fix<->validar com teto de 3 rodadas e "a fila para e chama o dono" (`specs/012-esteira-4/motor.md` §1, §3, §4, §5; `catalogo.md:67-75,203-208`).
- Execução da 012: em 11/08, "Nenhum dos 14 itens tem uma linha de código" (`specs/012-esteira-4/execucao.md` §1). Depois só o mapa de nós foi entregue (`14ad6fb`). Grep em `src/` por `esteira.grafo`, scheduler e fila de merge não achou o motor; `src/main/esteira/` não existe.
- Agente geral que acompanha todas as sessões e sintetiza só o que exige o dono: NÃO encontrei spec nem código com esse papel. Mais próximos: o "chama o dono" do motor (acima); o post-it escrito pela sessão no Mindscape (última resposta do assistente, sem modelo; `docs/glossario.md`); o buddy/Donel (US-16, `specs/backlog.md` B1), só especificado.
- Alternativa registrada como spike, não decisão: `herdr` como runtime das sessões, com `agent wait --until blocked`, sessões que sobrevivem ao app e worktree por API (`specs/backlog.md` B28).

## 3. Mindscape

Implementado (V1 mergeada: PR #114, commit `765a05a`; fatias 01-05 em `BACKLOG.md:29-170`).
- Terceiro modo do casco; um quadro por projeto (chave = `projectPath`), abas de projeto no topo (`src/shared/mindscape/model.ts:38-47`; `docs/versoes/mindscape.md`, V1).
- Elementos do quadro (`model.ts:17-36`): `session` (post-it de sessão; guarda só `sessionId` e posição, estado e nome vêm vivos das abas, `model.ts:5-7`), `session-note` (escrito pela sessão no fim do turno, até 4000 chars, `model.ts:57`), `owner` (post-it do dono: texto, cor `none|accent|donel-accent`), `MindscapeLink` (`from`, `to`, `arrow`).
- Interação: arrastar, pan, ligar dois post-its quaisquer com seta ou sem, arquivar, destaque normal/destacada/apagadinha, duplo clique leva ao terminal da sessão (`docs/versoes/mindscape.md`, "O que entra"; `docs/design/mindscape.md:145`). Persistência em `<userData>/mindscape.json` (`src/main/mindscape-store.ts`).
- Base técnica: quadro próprio em React + roughjs, não Excalidraw (`docs/adr/0004-base-do-quadro-mindscape.md`).
- NÃO existe no modelo: bloco/grupo/região, vínculo com card/WorkItem/discovery da Esteira, tipo de cartão além de sessão, nota da sessão e post-it do dono. Grep por `esteira|workItem|discovery` em `src/shared/mindscape` e `src/renderer/src/Mindscape` não retornou nada. As ligações não têm significado atribuído (`docs/produto/mindscape.spec.md`, "Pendências").
- Só plano: "Mindscape por sequência de esteira", histórico de post-its por turno, rabisco, prints, minimapa e zoom -> V2; captura relâmpago, cartas do dia, a sessão ler os post-its -> V3 (`docs/versoes/mindscape.md`, "O que fica de fora"). Em sabatina (arquivo untracked): ligar pelo teclado, rabisco, zoom; rabisco sem vínculo nem grupo com post-its, e "um agente geral do projeto ler ou desenhar rabiscos" ficou "talvez no futuro" (`docs/refinamentos/mindscape-ligar-rabisco-zoom.md`, "Regras" e "Ficou aberto").
- O spec do Mindscape registra que o Modo Dev "conduz uma esteira por vez", "não escala" com mais esteiras, e que mexer nele ficou fora de escopo ("deixa ele ali quietinho") (`docs/produto/mindscape.spec.md`, "Dor real" item 4 e "Fora de escopo"). O Tomo do Donel (post-its como cartas) foi decidido morar no Mindscape (idem, "O que já existe").

## 4. Iniciativa / tipo de trabalho / molde

- "Iniciativa": nenhuma ocorrência em `src/`, `docs/glossario.md`, `specs/backlog.md`, `BACKLOG.md`, `CLAUDE.md` (grep).
- "Bugfix/hotfix": só em `src/shared/trustDialog.ts` (assunto não relacionado). "Homologação": `github-reader.ts`, `githubFacts.ts`, `mapLevels.ts` referem a etiqueta `homologado` de PR da Esteira v3 (spec 009 CA-20), não um tipo de trabalho.
- "Molde/template de fluxo": nenhum no app (`molde` só em `src/preload/subscribeChannel.ts`, sem relação). Mais próximos: a tabela de defaults por fase (`devModeDefaults.ts`), um molde fixo de sequência única, e o `esteira.grafo` da 012 (grafo de cards por plano, escrito pelo Plano e não montado pelo dono; `specs/012-esteira-4/motor.md` §1; ainda sem implementação).
- Os tipos de WorkItem da 010 são tipos de artefato/ciclo, não Desenvolvimento/Bugfix/Homologação. "Bug direto é issue sem spec" aparece como desvio tolerado da ampulheta (`specs/010-esteira-donel/spec.md`, "Grafo").
- "Fanout" no código: só `fanout_cards` do contrato antigo, aposentado pela v3 (`specs/009-modo-dev-v3/spec.md` CA-17); ocorrências restantes são comentários (`storeFormat.ts:707`, `esteiraView.ts:1616`).

## 5. Backlog pendente que toca o tema

- 012 Esteira 4.0, 14 itens: motor, fila que percorre o grafo, worktree por card, headless, gate barato, fila de merge, laço com teto 3, suíte de fim de plano, autostart do Enter, pacote portátil (`specs/012-esteira-4/execucao.md` §2-3). Fora da rodada por decisão do dono: planos `forma-e-leitura` e `donel-leitor` (idem, "Escopo").
- 013 Donel Leitor: o app não abre artefato `.html`/`.md` declarado, "ponteiro morto" (`execucao.md`, achado de 13/08; plano desagregado em 10 itens, commit `79e95a1`).
- 014 Chat: fila de pendências e hooks, parcialmente no repo (`CLAUDE.md`, gatilho do chat; commits `45040e7`, `4463f51`). É o mais próximo de "dúvidas do agente para o dono", mas por sessão e não consolidado entre sessões. Não li o spec 014 a fundo.
- `specs/backlog.md`: B1 Buddy/Donel (US-16), B2 visão de artefatos por sessão/processo/projeto, B3 acompanhamento de PRs, B27 estado da sessão via título OSC, B28 `herdr` como runtime.
- Mindscape V2/V3 e a sabatina de ligar/rabisco/zoom (seção 3).
- 010: #41, #42 e #35 congelados; [P-5] remoção do mapa atual ao fim do vertical pequeno (`CLAUDE.md`, gatilho 010; `specs/010-esteira-donel/spec.md`, pendências).

## 6. Reclamações e limitações registradas do Modo Dev

- "Não é intuitivo graficamente" e "tela suja"; o mapa de 480px e o carrossel do design foram comprimidos numa coluna estreita (`specs/009-modo-dev-v3/discovery.md`, "Os incômodos"; `specs/009-modo-dev-v3/spec.md`, Problema 5).
- Mesma ação em dois lugares: botões de fase na faixa e no nó do mapa (spec 009, Problema 6).
- "Foi pensado para uma esteira só. Com mais e mais esteiras ele não escala, e o mapa de nós que o Alexandre queria não chegou" (`docs/produto/mindscape.spec.md`, "Dor real" item 4).
- O estado vivia em 3 lugares e o app "afirma uma inverdade" quando não consegue ler; trava remota ficou órfã (`specs/010-esteira-donel/spec.md`, "Problema", evidências 1 e 3).
- O app abriu fase no repo errado por "palpite" (010, evidência 2); hoje exige alvo explícito (`esteira-dispatch.ts:1-12`).
- A UI da 012 já foi reprovada uma vez (mapa React Flow, F25), substituída por d3-force (`NodeGraphOverlay.tsx:12-17`).
- Dogfooding 04-06/08 e relatórios de melhoria de sessão existem em `docs/relatorio-melhoria-sessao-2026-08-0*.md`; não li.
- `.scratch/` só tem `contas-e-provedores`; `tasks/lessons.md` quase não menciona o Modo Dev.

## Lacunas (o repo não responde)

- O que o dono entende por "desenho de fluxograma das sessões": não há spec de editor de fluxo; o `esteira.grafo` da 012 é gerado pelo Plano, não desenhado pelo dono.
- Como um "bloco de iniciativa" se relaciona com os WorkItems e ciclos já existentes no store da 010.
- Qual skill roda em Desenvolvimento, Bugfix e Homologação: as `/esteira-*` estão fixas no app; as skills `homologacao:*` existem no ambiente do dono mas não aparecem no app.
- Se o fluxo deve usar sessões headless (012) ou sessões de terminal visíveis.
- Estado real da implementação da 009 e da 010 (vertical pequeno/horizontal) frente ao que as specs descrevem.
