---
tema: visao-visual-multi-sessao-postit
plano:
item:
data: 2026-10-23
taskdex: []  # sem card — esta execução não conta na adoção
fontes-consultadas: [repos-locais, github]
---

# Pesquisa — Visão visual e de relance de várias sessões/esteiras, com post-its

## Pergunta

Já existe, no próprio Donel Dev ou na Seazone, algo que dê ao dono uma visão visual e de relance de várias sessões de agentes de código e várias esteiras ao mesmo tempo (o que cada uma está fazendo, quais estão paradas, o que cada uma fez) com anotações tipo post-it ao lado do trabalho? (Anti-duplicação do discovery do Mindscape, `docs/produto/mindscape.spec.md`.)

## Resposta (gist)

**Parcialmente.** O Donel Dev já tem peças que cobrem cada pedaço isolado: semáforo de estado por sessão na sidebar (lista, não vista espacial), um grafo de nós da esteira (um recorte do store por vez, d3-force + SVG, na main) e um componente de post-it (`PostItCard`, "Carta do Tomo do Donel") que existe só no design system. Nada junta os três: não há vista espacial/canvas de várias sessões com anotação livre ao lado, e o Tomo (quadro de post-its) está especificado e desenhado mas **não implementado** no app. Na Seazone (org `seazone-tech`) não achei equivalente.

## O Tomo do Donel

- **O que é:** o nome temático do quadro de post-its do Donel Dev. É a "área de post-its" (US-10) tematizada com o personagem Jobu Donel (US-16): capturar um post-it = "entregar uma carta" ao Donel; o quadro = "Tomo do Donel", grid de "cartas"; mais as "cartas do dia" (2-3 post-its antigos reapresentados no Setup do dia) e a "captura relâmpago" (mini-janela de uma linha, Ctrl+Alt+N). Ações por carta: manter no tomo, virar prompt ("enviar para sessão..."), copiar, arquivar.
- **Status:** **especificado e desenhado; NÃO implementado no app.** Existe só o componente visual `PostItCard` no pacote de design system. Nenhuma ocorrência de `PostItCard`, `post-it`, `globalShortcut` ou captura relâmpago em `src/` na main, nem em `origin/staging`, `origin/014-chat`, `origin/015-jobu-pet`, `origin/feat/009-lote-07-mapa`, `origin/feature/014-modo-dev-esteira-seazone`, `origin/feature/016-jobu-faxina`. A spec 015 (Jobu pet) o deixa explicitamente fora de escopo ("o Tomo/post-its seguem na US-16").
- **Reaproveitável como o post-it do Mindscape?** **Em parte.** `PostItCard` é um cartão estático (220px fixos, texto + data + projeto opcional + ações enviar/copiar/arquivar, fundo `--postit-bg: #3a3526`), pensado para grid, não para ficar ao lado de um nó/sessão num canvas (sem posição, sem vínculo a sessão/esteira, sem edição inline). Reaproveitam-se o token visual, o vocabulário de ações e o conceito "post-it vira prompt para uma sessão"; posição e vínculo com o trabalho seriam construção nova. Atenção a uma regra de design já fechada: a voz/tematização do Donel "nunca sobre o trabalho" (`design/design-system.md` §10, `specs/001-mvp/ui-spec.md` §16); a spec 015 emendou só o pet, não o Tomo. Post-it do Mindscape ao lado do trabalho colide com essa regra e exige decisão do dono (ver Lacunas).

## Achados

- **Tomo = quadro de post-its tematizado, com 3 telas (A Tomo, B cartas do dia, C captura relâmpago)** — **fonte:** `design/design-handoff.md:702-745` (Brief 13); `specs/001-mvp/ui-spec.md:270-288` (§9, "o quadro é o Tomo do Donel") e `ui-spec.md:425-440` (§16, onde vive / onde nunca entra).
- **`PostItCard` existe só no design system ("Carta do Tomo do Donel"); nenhum import em `src/`** — **fonte:** `design-system/src/components/PostItCard/PostItCard.tsx:19-22`; `design-system/README.md:62`; `design-system/src/tokens.css:47` (`--postit-bg`); `git grep PostItCard -- src` vazio.
- **Semáforo de estado por sessão na sidebar já existe (relance, mas em lista, sem anotação livre)** — **fonte:** `src/renderer/src/ProjectSidebar.tsx:112` (`<StateDot state={session.state} />`); requisito original em `design/design-handoff.md:120-128` e `:172-185` (Brief 2, "de relance, quais sessões precisam de atenção AGORA", ordenação "quem precisa de mim primeiro").
- **Mapa de nós da esteira (grafo estilo Obsidian, d3-force + SVG, navegável, cor por estado) já está na main; é projeção de UM `StoreSnapshot` (discovery/plano/itens), não canvas de várias sessões de agente, e não tem post-its** — **fonte:** `src/renderer/src/DevMode/NodeGraphOverlay.tsx:14-35`; `src/renderer/src/DevMode/nodeGraphView.ts:1-20`; escolha do motor em `specs/012-esteira-4/mapa-grafos-escolha.md` (ratificada 12/08/2026). A anotação existente é `AnnotationTag` (etiquetas de sistema do espelho do board: trava, escalado, PR), não nota livre do dono — `design-system/src/components/AnnotationTag/AnnotationTag.tsx`.
- **Mindscape não existe em nenhum lugar versionado; o spec e o protótipo são arquivos não rastreados desta própria demanda** — **fonte:** `git grep -i mindscape` vazio em HEAD e em `origin/{main,staging,014-chat,015-jobu-pet}`; só `docs/produto/mindscape.spec.md` e `docs/prototipos/mindscape/` (não rastreados, 23/10/2026).

Também relevante (não é duplicata): as specs 014 (chat no lugar do terminal) e 015 (Jobu pet que avisa quem espera o dono; `specs/015-jobu-pet/spec.md` no `origin/015-jobu-pet`, Contexto e D1-D8) tocam "várias sessões em paralelo", mas como aviso/chat por sessão, sem vista espacial nem anotações. A 013 (`specs/013-donel-leitor/plano.md`) é navegador de arquivos/widgets, não visão de sessões. A 009 (`specs/009-modo-dev-v3/spec.md`, CA-7..CA-12) é mapa-carrossel de UM card/worktree em painel lateral de 480px, não multi-sessão.

## Lacunas

- **Decisão, não fato (candidato a `refinamento`):** o post-it do Mindscape fica "ao lado do trabalho", mas a regra fechada do Donel é "a voz/tematização do Tomo nunca sobre o trabalho". Reaproveitar o Tomo exige o dono decidir se o post-it do Mindscape é o Tomo (com a persona) ou um post-it neutro, sem a voz do Donel.
- **Não verificado:** se o vault Obsidian (`Projects/donel-dev/`) tem decisão posterior sobre o Tomo. Não consultado; fora das fontes pedidas.
- **Maestri** (inspiração citada no spec) não foi pesquisado: é produto de terceiro, fora da pergunta (existe algo na Seazone/Donel?). Se o discovery quiser comparar, é item externo à parte.
- **KB Seazone (`seazone-kb`):** o MCP `kb` estava sem autenticação nesta sessão (só `authenticate`/`complete_authentication` disponíveis) e não há humano para autenticar. Usei o repo `seazone-tech/seazone-kb` via `gh api` só para ler um doc que a busca de código apontou (`wiki/tech/esteira-lights-out.md`, irrelevante); a KB não foi varrida.
- **`gh search code` esgotou a cota (10/min):** os termos "claude-code" e "tengu OR donel" não rodaram na org. O repo `seazone-tech/esteira` (sem descrição) não foi aberto; `backstage-agents` foi visto pelo README.
- **Nekt:** NÃO consultada. A pergunta é sobre ferramenta/produto interno, não dado de negócio; Nekt é lakehouse de métricas.

## Trilha de busca

- **Repo Donel Dev (local)** — `git grep -w Tomo` (repo todo) → 9 arquivos, todos de design/spec/design-system (nenhum em `src/`). `git log --all --oneline | grep -i tomo` → vazio; `git log --all -i --grep=tomo` → 1 commit (`8a252fd`, persona do Donel, só docs). `git grep -i -E "postit|post-it|mindscape|globalShortcut|captura relâmpago|quick-capture" -- src tests` → vazio.
- **Branches remotas** — `git grep -i -E "PostItCard|post-?it|globalShortcut" <branch> -- src` em staging, 014-chat, 015-jobu-pet, feat/009-lote-07-mapa, feature/014-modo-dev-esteira-seazone, feature/016-jobu-faxina → vazio em todas. `git ls-tree` das specs 014/015 e leitura do spec 015 (D1-D10, Out of Scope).
- **Specs 009/012/013** — termos "visão geral, vista geral, de relance, multi-sessão, canvas, dashboard, todas as sessões" → só os achados acima (009 = mapa de um card; 012 = grafo de um snapshot; 013 = leitor de arquivos). Nenhuma visão de várias sessões/esteiras com anotações.
- **GitHub `seazone-tech` (repos)** — `gh search repos` com "canvas agentes", "mindscape", "sessões claude", "esteira visual", "agent dashboard", "claude code sessions" → vazio; "donel", "agent", "esteira", "dashboard" → repos de agentes de negócio (Olimpo), esteiras de homologação/lançamentos e dashboards de KPI; nenhum é visão de sessões de agentes de código.
- **GitHub `seazone-tech` (código)** — `gh search code`: "mindscape" vazio; "agent sessions dashboard", "orquestrador agentes", "sessions kanban agentes" vazios; "React Flow"/"xyflow" → portal-lan-amentos, process-flow-nexus, governanca-nekt (apps de negócio, não visão de agentes); "post-it"/"postit" → consultoria-regional, seazone-skills, vistoria-consultoria-forms e `seazone-os/docs/como-vai-ficar/contexto-da-conversa.html` (post-it como ilustração de documento, não feature); "esteira" → seazone-kb `wiki/tech/esteira-lights-out.md`, gestao-contas, category-reviewer (esteiras de negócio/revisão, sem visão visual); "multi-agent" → spotmatch-mvp, sia-core (matching/atendimento). `backstage-agents` = orquestração de agentes via Claude Agent SDK, backend sem UI visual.
- **KB MCP** — não autenticado (ver Lacunas). **Nekt** — não consultada (ver Lacunas).
