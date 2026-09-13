# Spec — 014 Modo Dev sobre a Esteira Seazone

> Origem: pedido do dono em 13/09/2026 — "adaptar o Modo Dev para funcionar
> 100% com essa esteira e nenhuma outra". Desenho aprovado por ele no mesmo dia.
> Referência estudada: plugin `esteira` de `seazone-tech/seazone-skills`
> (autor Bruno "Bill" Benetti), `origin/main` em `0a98ed2` (11/09), versão
> 1.15.1, `esteira/FRAMEWORK.md` v0.6 — mais a `/mate`, ainda não mergeada
> (`origin/feat/esteira/mate`, `3309237`, bump 1.16.0).

## Problema

O Modo Dev é hoje um motor próprio de esteira: catálogo de fases fixo
(`src/shared/devMode.ts`, `devModeDefaults.ts`), troca de arquivos com skills
empacotadas (`run-input.json` → `result.json`, `skills/esteira-donel-3.0.0`),
travas e trilha num registro de eventos no `userData`
(`src/main/esteira-store.ts`). É uma **segunda fonte de verdade** do estado da
esteira — cerca de 17 mil linhas de código e 12,7 mil de teste.

A Esteira Seazone funciona ao contrário: **não tem estado fora do repo-alvo**.
Tudo o que importa vive em `docs/` e no `BACKLOG.md`, mais `git worktree list`
e os PRs. As regras dela proíbem store paralelo ("o estado vive nos artefatos";
em conflito, a skill dona vence). Os dois modelos não convivem: adaptar o motor
atual manteria duas verdades. A decisão é trocar.

## Decisão central (aprovada 13/09)

1. **Uma esteira só.** O Modo Dev passa a servir exclusivamente à Esteira
   Seazone. O catálogo de fases, o contrato run-input/result, as skills `-3` e
   o plano da Esteira 4.0 (spec 012) saem.
2. **O Donel é leitor e abridor de sessões.** Ele lê o estado nos artefatos do
   repo e abre abas de terminal com a skill certa, no diretório certo. Não
   decide, não executa etapa, não grava estado de esteira.
3. **O papel é o da `/mate`, com tela.** Mesma triagem, mesmas fontes, mesmas
   proibições — o que a `/mate` faz no chat, o Donel mostra e oferece em gesto.

## O que o Donel lê — fontes e vocabulário

Toda leitura é do **clone principal** do projeto (nunca de um worktree: o
`BACKLOG.md` do worktree pode estar defasado). Detecção: `git rev-parse
--git-common-dir` ≠ `--git-dir` → é worktree; o clone é o pai do common-dir.

| Fonte | Path | Status lido |
|---|---|---|
| Spec de produto | `docs/produto/<demanda>.spec.md` | frontmatter `em-discovery \| aprovado` |
| Plano de ação | `docs/planos/<demanda>.pda.md` | plano: `rascunho \| aprovado \| em-execucao \| concluido`; item: `pendente \| em-andamento \| concluido \| descartado`, tipo `pesquisa \| prototipo \| refinamento \| tarefa`; **bloqueio é derivado** de `Bloqueado por` |
| Pesquisa | `docs/pesquisas/<tema>.md` | existência |
| Protótipo | `docs/prototipos/<demanda>/decisao.md` | `pendente-de-escolha \| decidido` |
| Refinamento | `docs/refinamentos/<tema>.md` | `em-sabatina \| fechado` |
| Versões | `docs/versoes/<demanda>.md` | `rascunho \| aprovado \| validado-com-cliente` |
| Design | `docs/design/<demanda>.md` | `rascunho \| aguardando-champion \| aprovado` |
| ADRs e glossário | `docs/adr/`, `docs/glossario.md` | existência (docs vivos do repo) |
| Backlog | `BACKLOG.md` (raiz) | fatia: `pendente \| em-andamento \| implementada \| aguardando-merge \| concluida`; `Depende de`, `Conflita com`, branch, worktree, link do PR; linha `Modo: demanda — integradora <branch>` na seção |
| Evidências da revisão | `docs/revisoes/<branch-slug>/` | existência |
| Worktrees | `git worktree list --porcelain` | path + branch |
| PRs | `gh pr list` / `gh pr view` | aberto, checks, reviews, mergeado |

Regras de derivação (copiadas das skills donas, não reinventadas):

- **Fronteira do backlog** = fatia `pendente` com todas as `Depende de` em
  `implementada` ou além **e** nenhum `Conflita com` em `em-andamento`.
  `Conflita com` contra `implementada` não bloqueia. Backlog com campo `Onda`
  (formato 1.14.0) → barreira de onda; sem `Onda` nem `Conflita com` → serial.
- **Fronteira do plano** = item `pendente`, desbloqueado e não claimado.
- **Formato fora do template** → mostrar como está e sinalizar; nunca
  "consertar" nem adivinhar.

## Triagem — a tela

Por projeto, quatro seções **sempre presentes, mesmo vazias** (contrato da
`/mate`):

- **Precisa de você** — plano em `rascunho`, protótipo `pendente-de-escolha`,
  refinamento `em-sabatina`, design `rascunho`/`aguardando-champion`, gate
  condicional do fatiamento, fatia `implementada` com PR esperando teste do
  autor ou peer test, `em-andamento` sem sessão viva (claim possivelmente órfão).
- **Aterrissou** — o que mudou desde a última vez que o dono olhou.
- **Em andamento** — fatias e itens `em-andamento` (com worktree e sessão, se
  houver), PR com CI rodando.
- **Próximos** — o que está livre agora: fronteira do plano, fronteira do
  backlog, fatia `implementada` sem PR, PR sem simplificação.

Cada frente aparece pelo título, com id entre parênteses, e oferece **um gesto**:
abrir a sessão da etapa.

## Abrir sessões

| Etapa | Skill | Quem dirige | Onde abre | Foco |
|---|---|---|---|---|
| Discovery | `discovery-produto` | humano | clone principal | sim |
| Plano de ação | `pda` | humano | clone principal | sim |
| Pesquisa | `pesquisa <plano> item NN` | agente | clone principal | não |
| Protótipo | `prototipo <plano> item NN` | humano | clone principal | sim |
| Refinamento | `refinamento <plano> item NN` ou avulso | humano | clone principal | sim |
| Versões / explicação visual | `versionamento`, `como-vai-ficar` | humano | clone principal | sim |
| Arquitetura | `arquitetura <plano>` | humano | clone principal | sim |
| Repo novo | `novo-repo` | agente | clone principal | não |
| Fatiamento | `fatiamento <design>` | agente (gate condicional) | clone principal | não |
| Implementação | `implementacao <fatia>` · `fix <fatia>` · `demanda <slug>` | agente | worktree da fatia se existir; senão clone principal | não |
| Revisão | `revisao` | agente (teste do autor no fim) | worktree da fatia | não |
| Simplificação | `simplificacao` | agente | worktree da fatia | não |
| Coordenação | `mate` | humano | clone principal | sim |

- O comando é o slash-command do plugin (namespace a confirmar na instalação —
  ver `[P-6]`), digitado e **enviado** com a confirmação de submissão que já
  existe (`src/shared/cliInputBox.ts`). O clique do dono é o ok.
- A aba nasce nomeada pela frente: `<skill> <alvo>`.
- Worktree da fatia: o path registrado no `BACKLOG.md`; senão o de
  `git worktree list` para a branch. O Donel **não cria** worktree — quem cria é
  a `/implementacao`.

## Regras duras

- **Nunca escrever** em `docs/`, `BACKLOG.md`, branches, worktrees ou PRs. Claim,
  flip de status e worktree são das skills.
- **Nunca store de estado da esteira** fora do repo. O `userData` guarda só
  preferência de tela (projeto em foco, seção recolhida, "visto em").
- **Leitura que falha ≠ ausência.** `gh` sem acesso, arquivo ilegível ou formato
  desconhecido aparece como "não consegui ler" com o motivo — nunca como "sem
  PR" ou "vazio". (A lição da trilha sintética da #35.)
- **Nunca abrir sessão sem gesto do dono**, e nunca mergear, aprovar gate ou
  responder pergunta de worker.
- **Estado de aba não é evidência.** Aba "parada" orienta; a verdade é o
  artefato.

## Entregas

Fatiado pelo custo de validação: cada entrega custa uma rodada manual do dono.

### Entrega 1 — Modo Dev novo

Leitor + triagem + abrir sessões, **substituindo a tela atual** do Modo Dev.
Parser do `BACKLOG.md` e do `.pda.md` e as regras de fronteira são puros, com
teste (vitest) sobre fixtures tiradas dos templates da esteira; tela e PTY por
smoke roteirizado.

Critérios de aceite:

- **CA-1** Num repo com `docs/planos/x.pda.md` e `BACKLOG.md`, a triagem mostra
  as quatro seções, com as frentes nas seções certas pelas regras acima.
- **CA-2** A fronteira do backlog bate com a regra da `/implementacao` nos
  casos: dependência não entregue, conflito em andamento, conflito contra
  `implementada`, formato `Onda`, formato serial.
- **CA-3** Com `gh` sem acesso ao repo, a seção de PRs diz "não consegui ler" e
  o motivo; nenhuma frente vira "sem PR".
- **CA-4** "Abrir" numa fatia `implementada` abre aba no worktree da fatia com
  `revisao` enviado e confirmado; numa etapa humana, a aba ganha foco.
- **CA-5** Editar o `BACKLOG.md` por fora atualiza a triagem sem reiniciar o app.
- **CA-6** Nenhum arquivo do repo-alvo é escrito pelo app (conferido por
  `git status` limpo depois de uma rodada de uso sem sessões).

### Entrega 2 — Demolição

Remove o motor antigo e o que só existia por ele: `src/shared/esteira/**`,
`src/main/esteira-*.ts`, telas `Esteira/` e `DevMode/` que não sobreviverem à
Entrega 1, `skills/esteira-donel-3.0.0/`, `scripts/esteira-check.mjs`,
`scripts/esteira-custo-fase.mjs`, `.esteira/review-policy.json`, os
`tests/esteira*` correspondentes, e as chaves de config órfãs (com passthrough
para não quebrar os canais que ainda as tenham).

Critérios de aceite:

- **CA-7** `npm test` e `typecheck` verdes; nenhum import restante de
  `shared/esteira`.
- **CA-8** Config antiga (com `devMode.discoveries` etc.) abre sem erro e sem
  perder as outras chaves.
- **CA-9** `CLAUDE.md` do projeto sem os gatilhos da 010 e da 012 e sem a
  exceção do espelho público para os scripts da esteira; `sincronizar-publico.ps1`
  coerente com isso.

## Fica (genérico, reaproveitado)

PTY, abas, sessões, semáforo, `transcript-watcher`, `session-indexer`,
`github-reader.ts` (leitura via `gh`), auto-start com confirmação
(`cliInputBox`), raízes de projeto (`project-scanner.ts`), conceito de
âncora/escopo de repo.

## Impactos em specs e decisões anteriores

- **012 (Esteira 4.0)**: cancelada. Ondas 2–5 não rodam. As decisões de 07 e
  09/08 deixam de valer para o Modo Dev — em especial: o PR sai da `/revisao`
  (não da Implementar), o `/no-mistakes` fica fora (a esteira o exclui por
  complexidade) e os artefatos moram em `docs/`, não em `.esteira/`.
- **010 (Esteira do Donel)** e **009 (Modo Dev v3)**: supersedidas no que toca
  fases, contrato e trava. A trava visível e liberável da D-V3 fica coberta pelo
  claim no `BACKLOG.md` e pela regra "leitura que falha ≠ ausência".
- **013 (Donel leitor)**: a D4 (sidecar de anotação em `.esteira/validar/`)
  perde a casa; o resto do plano (navegador de diretório, MD/Mermaid/HTML/PDF)
  continua válido e casa bem com `docs/`. Revisar a D4 antes de começar a 013.
- **Plugins instalados**: o `esteira@skills-dev-ai-ops-szi` sai (nome de plugin
  igual ao da Esteira Seazone; "nenhuma outra").

## Fora de escopo

- Escrever qualquer artefato da esteira pelo app.
- Mudar as skills do Bill. Divergência encontrada vira conversa com ele, não
  fork.
- Leitor de MD/HTML dentro do app (é a 013).
- Tracker externo (TaskDex) — a esteira usa só o `BACKLOG.md`.

## Pendências `[P-n]` — propostas, a fechar com o dono

- **`[P-1]` Superfície para a `/mate` rodar dentro do Donel.** Para a `/mate`
  (numa aba) abrir abas sozinha, o Donel precisaria de uma CLI/porta local, e a
  skill teria que reconhecê-la como multiplexador (hoje ela procura herdr/orca).
  **Recomendação:** fora da Entrega 1 — o gesto do dono já cobre o "abrir com
  ok"; revisitar quando a `/mate` for mergeada, conversando com o Bill.
- **`[P-2]` "Aterrissou" precisa de memória.** **Recomendação:** guardar só
  "visto em" por projeto no `userData` (preferência de tela, descartável); perder
  isso marca tudo como novo, nunca esconde nada.
- **`[P-3]` Forma da tela.** Não há handoff de design. **Recomendação:** passar
  por protótipo (3 variações) antes de implementar a Entrega 1 — a forma vem do
  design, não da spec.
- **`[P-4]` Um projeto ou vários.** **Recomendação:** triagem do projeto em
  foco, com contador de "precisa de você" por projeto na sidebar.
- **`[P-5]` O próprio donel-dev na esteira.** Este repo usa `specs/` e
  `.esteira/`. **Recomendação:** decidir depois da Entrega 2; até lá, esta spec
  segue a convenção atual do repo.
- **`[P-6]` Instalação.** O marketplace `seazone-skills` local não atualiza
  desde 14/07 porque o `gh` ativo (`xansde`) não enxerga a org. Resolver o acesso,
  instalar o plugin e **confirmar o nome exato dos slash-commands** antes de
  fixar a tabela de "Abrir sessões" em código.
