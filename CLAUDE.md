# donel-dev — contexto do projeto

IDE própria do Alexandre: Electron + xterm.js + node-pty embedando o `claude`
CLI, com sidebar de projetos, abas de terminal, launcher (modelo/esforço/
permissões), sessões anteriores (retomar/fork) e perfis de conta compartilhada
via `CLAUDE_CONFIG_DIR`.

## Repositório e canais (modelo alfa/beta/stable — redefinido em 2026-07-28)

- **Remoto**: `https://github.com/xansde/donel-dev` (privado, conta pessoal
  `xansde`; `xansde-seazone` é colaborador com permissão de escrita).
- **Modelo de branch = modelo de canal** (escada de maturidade, do mais cru ao
  fechado):
  - `feature/*` → trabalho em andamento; integra em `staging` por PR.
  - `staging` → canal **alfa**: a novidade cai aqui primeiro e é olhada aqui.
  - `main` → canal **beta**: sobe quando o Alexandre validou o alfa e confia.
  - `xansde/donel` (repo público) → canal **stable**: só release fechado e
    versionado — ver a seção abaixo.
- Versão anterior deste modelo (24/07, pré-repo público) chamava `main` de
  stable; o público assumiu esse papel e o `main` privado desceu para beta.
- **Regra dura (inalterada)**: push/PR/merge em `main` e publicação no repo
  público só com instrução literal do Alexandre. "Comita", "deploya",
  "atualiza staging" NÃO autorizam tocar em `main` nem no público.
- **PR e merge (redefinido pelo dono em 2026-08-09)**: **abrir PR contra
  `staging` é livre para o Claude**, sem pedir confirmação — inclusive quando
  quem abre é a fase Implementar da Esteira. A regra anterior ("PR é sempre
  ato humano") **caiu**, aqui e no baseline do squad.
- **Merge em `staging` (redefinido pelo dono em 2026-10-08)**: **o Claude
  mergeia** os PRs contra `staging` assim que a verificação automática
  (vitest, typecheck, build, smokes da camada pertinente) estiver verde, sem
  esperar o dono ("mergeie você. Não fica me esperando para mergear nada").
  A bateria manual no alfa passa a ser validação **depois** do merge, não
  pré-requisito. Sempre `gh pr merge --merge`, nunca `--admin`. `main` e o
  repo público seguem no bloqueio total do bullet acima.
- **Canais instalados coexistindo (decisão de 2026-07-28)**: `npm run
  dist:alfa` / `dist:beta` / `dist` empacotam com identidade própria de
  INSTALADOR (`appId`/`productName`/atalho "Donel Dev Alfa"/"Donel Dev
  Beta"/"Donel Dev"), então os três instalam lado a lado sem se sobrescrever.
  Buildar cada um do checkout do seu canal (alfa←`staging`, beta←`main`,
  stable←público). O `userData` segue COMPARTILHADO de propósito
  (`app.setName('donel-dev')` é igual nos três — pedido dele: mesmos dados,
  escolhe qual versão abrir). Riscos aceitos e conhecidos: (1) canal antigo
  aberto pode sanitizar/derrubar chave de config que só o canal novo conhece
  (item de produto "sanitize com passthrough"); (2) `setAppUserModelId` é um
  só — notificações e agrupamento de taskbar tratam os três como o mesmo app.
  O isolamento COMPLETO (userData por canal) continua sendo o **B10** do
  `specs/backlog.md`, agora opcional.

## Repo público (canal stable) — aberto em 2026-07-27

- **Remoto**: `https://github.com/xansde/donel` (**público**, MIT). Cópia de
  trabalho local: `../donel-dev-publico`.
- **Papéis**: este repo é o de **trabalho** (specs, docs de processo, histórico
  completo); o público é o **estável** — só o app, para quem quiser clonar e
  buildar na própria máquina. Não há histórico compartilhado entre os dois.
- **Nunca vão para o público**: `specs/`, `docs/`, `scripts/`, `design/`,
  `.claude/`. O público tem `README.md`, `LICENSE` e `CLAUDE.md` **próprios**,
  editados à mão — o sync não os sobrescreve. **Exceção nomeada (decisão do
  dono, 11/08, precedente de `skills/` em 03/08)**: `scripts/esteira-check.mjs`,
  `scripts/esteira-custo-fase.mjs` e `.esteira/review-policy.json` entram no
  espelho — testes espelhados os exercitam, e teste que só passa no repo de
  trabalho não vale como gate. Os scripts de publicação seguem fora. Na
  promoção de 07/10 entrou também `docs/esteira-dev/` (só o pacote do
  contrato, nova casa dele desde a 012); e `tests/esteiraLayoutCanalV2.test.ts`
  ficou fora do espelho, porque confronta `specs/` e `.esteira/`.
- **Promover**: `powershell -File scripts/sincronizar-publico.ps1` espelha
  `src/ tests/ patches/ design-system/` + configs de build e imprime o `git
  status` do lado público. Ele **não** commita nem faz push — revisar, rodar
  `npm test` lá e commitar à mão. `package.json` diverge de propósito
  (license/repository/author + scripts `publicar*`): o script avisa quando
  versão ou dependência mudou, para levar a mão.
- **Vocabulário interno fica fora**: nomes de projeto real em fixture/story
  foram trocados por genéricos (`atlas`, `beacon`, `vega`) **nos dois repos**,
  justamente para as árvores continuarem idênticas. Ao criar fixture nova, usar
  nome genérico. Ainda expostos e assumidos: `Esteira`/`EsteiraPhase` e
  `TaskDex` (intenção de design real, não placeholder) e `seazone` como nome de
  pasta-raiz default.

## Política de review do repo (fixada pelo dono em 2026-08-04)

Repo pessoal de mantenedor único (`xansde`): a política de review do
repositório-alvo é **1 revisor** para qualquer classificação de risco,
inclusive `sensivel` — o próprio dono, após validação manual (e2e quando a
fase Validar apontar). Esta política **substitui** o default por risco da
esteira (`default-risco-esteira`, que pediria 2 revisores no sensível), como
o contrato de Concluir prevê para repos com política própria. Se o repo um
dia ganhar um segundo mantenedor, revisar esta seção antes de concluir card
sensível.

## Regras do projeto

- **Fonte de verdade do escopo**: `specs/001-mvp/` (spec → plan → tasks).
  Não implementar nada fora das tasks sem atualizar a spec primeiro.
- **Gate ativo**: o Alexandre aprovou apenas spec/plan (2026-07-22). Implementar
  código do MVP exige novo OK explícito dele.
- **T001 (spike de perfis) é bloqueante**: nenhuma UI de perfis antes do spike
  validar `CLAUDE_CONFIG_DIR` — resultado vai em
  `specs/001-mvp/spike-t001-resultado.md`.
- **Credenciais**: o app NUNCA lê, grava ou exibe credenciais. Login acontece
  exclusivamente dentro do terminal, pelo fluxo oficial do CLI. **Exceção
  nomeada e confinada (011-contas-e-provedores, etapa 1, 2026-08-04)**: o
  motor de contas (`src/main/accounts/`) é a única parte do app que lê/grava
  credencial — mod local (cofre `safeStorage` + endpoint OAuth da Anthropic
  no switch, com refresh só de fallback) e `claude-state.ts` (única escrita
  de `~/.claude/.credentials.json`/`oauthAccount`, ordem invariante: captura
  do par rotacionado → escreve `.credentials.json` → apaga `oauthAccount`).
  `CredentialPair` nunca sai de `src/main/accounts/`: não cruza o preload,
  não entra em log nem em mensagem de erro. O core do app e a UI (inclusive
  `AccountsPanel.tsx`/`MigrationWizard.tsx`) seguem sem tocar segredo — o
  formulário de conectar é write-only, nenhum canal de leitura devolve o que
  foi digitado. **Não generalizar esta exceção**: nenhum outro módulo ganha
  licença de tocar credencial por causa dela. A emenda **não foi ampliada**
  na etapa 2 (011, demolição de perfis + migração assistida, 2026-08-04):
  `src/main/accounts/migration/` já mora dentro de `src/main/accounts/`, é o
  mesmo perímetro — o par migrado do `.credentials.json` de um perfil vai
  direto pro cofre, nunca passa por variável de retorno exposta.
- **TDD com escopo**: CommandBuilder, SessionIndexer e os módulos de
  `src/main/accounts/` (motor, mods, migração) são puros com vitest; PTY/UI
  validam por smoke roteirizado (T014).
- UI em pt-BR; código, comentários e identificadores em inglês.

## Issue tracker (para skills que precisam de um)

Este repo usa **local-markdown**: mapa e tickets em `.scratch/<effort>/`,
versionados. A convenção completa está em `.claude/issue-tracker.md` — ler antes
de rodar `/wayfinder` ou qualquer skill que fale em "issue tracker". Não é
TaskDex: o Donel Dev é ferramenta pessoal, sem `.taskdex.json`.

**Mapa ativo — "Modo Dev do Donel Dev".** Mora no vault Claude Seazone, em
`Projects/donel-dev/wayfinder-modo-dev/` (não em `.scratch/`, apesar da
convenção acima — divergência conhecida, resolver movendo se incomodar).
Pedido "**wayfinder no próximo MD**" = abrir `PROXIMO.md` daquela pasta e pegar
o primeiro `⬜`; a ordem **não é numérica**. Prompts prontos em `sessoes.md`.
**O mapa está CUMPRIDO desde 27/07** (MD-01..MD-08 resolvidos) — ele virou a
entrega `specs/003-modo-dev/`. Só voltar ao mapa se a spec parecer contraditória.

## Gatilho — "implementar melhorias Modo Dev"

Pedido "**implementar melhorias Modo Dev**" (ou "implementar o próximo lote do
Modo Dev") = abrir a fila
`Claude Seazone/Projects/donel-dev/implementar-009-modo-dev-v3/PROXIMO.md` no
vault e pegar o **primeiro lote `⬜`**. Aqui a ordem **é** sequencial. Prompt
pronto (e a variante de retomada) em `prompt.md`, na mesma pasta.

Fonte de verdade do escopo: `specs/009-modo-dev-v3/spec.md` (31 CA). Forma da UI:
`design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html` **lido junto de**
`design/modo-dev-v3-verificacao.md`, que nomeia **7 divergências (D-V1..D-V7)** —
ler ANTES de implementar. Regra de conflito: **forma** → vence o design, sem
abrandar; **alcance ou comportamento** → vence a spec. Um lote por sessão; o PR
para `staging` pode ser aberto pelo Claude (ver "PR e merge" abaixo).

> **Fila anterior (003), cumprida:** `implementar-modo-dev/PROXIMO.md` zerou em
> 28/07 (PRs #2 e #3). A forma da v2 (`design/modo-dev-handoff/` +
> `design/modo-dev-verificacao.md`, divergências D1–D5) fica como registro do que
> foi construído — a v3 a sucede. A divergência mais séria de lá **reincidiu** na
> leva nova e continua valendo **enquanto o modelo atual existir**: a trava é
> **etiqueta do board**, nunca arquivo `.lock` (D-V3). **A spec 010 supersede
> isto**: com o tracker virando opcional, a trava passa a ser **local** (fato com
> dono, hora e sessão, visível e liberável num gesto), com espelho opcional em
> etiqueta. O que a D-V3 proibia — trava invisível e órfã — continua proibido.

## Gatilho — "rodar a próxima fase da 010"

Pedido "**rodar a próxima fase da 010**" (ou "próxima fase da Esteira do Donel")
= abrir a fila `Claude Seazone/Projects/donel-dev/esteira-010/PROXIMO.md` no
vault e pegar a **primeira fase `⬜`**. A ordem **é** estritamente sequencial:
cada fase depende do contrato que a anterior fixou, e rodar duas em paralelo
recria o desencontro de contrato que originou a spec. Prompts prontos, um por
fase, em `prompts.md` na mesma pasta.

Fonte de verdade do escopo: `specs/010-esteira-donel/spec.md` (16 decisões
fechadas por `grilling` em 03/08 — são requisito — e 6 pendências propostas).
Cada fase termina com **revisão do Alexandre** antes da seguinte começar.

**Congelado enquanto a 010 não avança:** issues #41 e #42 (polir apresentação de
um mapa que será substituído) e #35 (a trilha sintética **será revertida** — ela
pinta "não realizada" o que é "não consegui ler").

## Gatilho — "executar a próxima onda da 012"

Pedido "**executar a próxima onda da 012**" (ou "próxima onda da Esteira 4.0")
= abrir `specs/012-esteira-4/execucao.md` — o plano completo da rodada (grafo,
trilhas por arquivo, gates, regras, riscos) — e pegar a primeira onda `⬜` da
fila `Claude Seazone/Projects/donel-dev/execucao-012-esteira4/PROXIMO.md`.
Prompts prontos (execução, retomada e fechamento no alfa) em `prompt.md`, na
mesma pasta.

**Escopo:** os **14 itens `open`** do discovery «Definicao esteira dev»
(`dsc-15a7e7f5-fbb`). **Fora do escopo por decisão do dono (11/08):** os planos
`forma-e-leitura` e `donel-leitor` — começam **depois** desta rodada fechar.

**Dentro de uma onda as frentes são PARALELAS** (uma worktree por frente);
**entre ondas a ordem é estritamente sequencial** — cada gate existe porque a
onda seguinte assume o que ele provou. Bloco `ships_with` é **uma entrega**,
construída sequencialmente na mesma branch: dois workers na mesma árvore foi o
incidente dos commits entrelaçados de 04/08. A rodada **termina no alfa**
(Onda 5) — liberado sem pedir permissão, ao contrário de `main` e do repo
público, que seguem no bloqueio total.

## Gatilho — "rodar a próxima fase das contas"

Pedido "**rodar a próxima fase das contas**" (ou "próxima fase do pool de
contas") = abrir `specs/011-contas-e-provedores/plan-etapa-3.md` — o plano da
etapa 3 (estado medido, os furos F1–F6, fases, riscos) — e pegar a primeira
fase `⬜` da fila
`Claude Seazone/Projects/donel-dev/contas-4-pool-proprio/PROXIMO.md`. Prompts
prontos, um por fase (+ retomada), em `prompt.md`, na mesma pasta.

**Escopo:** 4 contas próprias no alfa, trocando entre elas **durante** sessões
vivas. **Pool/mod Seazone fora por decisão do dono (13/09)** — sai da UI na
Fase 1; remover o código espera instrução dele.

A ordem é **estritamente sequencial**. A **Fase 0 era o gate** da promessa
central da 011 — "trocar de conta sem reiniciar sessão" — e **passou com CLI
real em 13/09** (`e2e.md` §3): a sessão viva adota a conta nova na mensagem
seguinte, e o MCP segue respondendo. Por isso as fases 1 e 2 seguem como
escritas, com o F6 dentro da Fase 1.

## Gatilho — "rodar a próxima fase do chat"

Pedido "**rodar a próxima fase do chat**" (ou "próxima fase da 014") = abrir a
fila `Claude Seazone/Projects/donel-dev/execucao-014-chat/PROXIMO.md` no vault
e pegar a primeira fase `⬜` que não seja do dono e cujo gate de entrada esteja
cumprido. Prompts prontos (execução e retomada) em `prompt.md`, na mesma pasta.

Fonte de verdade: `specs/014-chat/plan.md` + `specs/014-chat/tasks.md`
(T001–T102). A **Fase 0 é o protótipo de forma no Claude Design** (do dono;
`design/prompt-design-chat.md`) e corre em paralelo com a **Fase 1**, que não
tem tela. Da Fase 2 em diante: sequencial, só com `design/chat-verificacao.md`
aprovado, e tudo atrás de `chat.enabled` até a virada (Fase 7).

## Gotchas conhecidos (do planejamento)

- node-pty precisa casar com a ABI do Electron — prebuilds/@electron/rebuild;
  pin de versões testadas.
- (histórico — o mecanismo morreu na 011, etapa 2) `~/.claude-profiles`
  ficava no home local, nunca no OneDrive (junctions). O app hoje só toca
  `~/.claude`; o histórico dos perfis, se algum dia migrado, fica arquivado
  em `~/.claude-profiles.old` (nunca deletado pelo app).
- Transcripts JSONL nunca são lidos inteiros — streaming + stat.
- Junction em Node: `fs.symlinkSync(target, path, 'junction')` — não pede admin.
- **`/logout` do CLI revoga o refresh token no servidor** (lido no binário
  2.1.270). Nunca usar para cadastrar ou trocar conta: a cópia de credencial
  feita antes dele morre. Cadastro é por login isolado (`CLAUDE_CONFIG_DIR`
  numa pasta própria) — `specs/011-contas-e-provedores/research-etapa-3-cli.md`.
- **Depois de uma troca, o `/status` do CLI mostra "Claude API account"** até
  refazer o fetch do perfil (minutos). Para saber a conta em uso numa sessão,
  use o `/usage`. O mesmo vale para o `userEmail` que o harness carimba no
  contexto da sessão: é lido no início e não acompanha a troca.
- **F6 — corrigido na Fase 1 (13/09):** o mod local captura a lista de contas
  no construtor do motor. Por isso toda mudança de `mod` ou de `localAccounts`
  passa por `AccountEngineHost.apply` (`applyAccountsEngineConfig` no
  `index.ts`), que reconstrói o motor — nunca `updateConfig` direto para mudar
  a lista.
- **Login isolado:** o app encerra a aba de login depois de colher a
  credencial; nada é digitado nela pelo app. Smoke desse fluxo usa
  `DONEL_CLAUDE_EXECUTABLE_FIXTURE` (claude falso): um `claude.cmd` no PATH não
  basta, porque o resolvedor prefere qualquer `claude.exe` e abriria o CLI real.
- **O access token do CLI vence em ~8h** (`expiresAt` do `.credentials.json`).
  Por isso, desde a Fase 2 (13/09), a carga da conta **ativa** é lida com o par
  vivo do `~/.claude` (o par dela no cofre envelhece assim que o CLI renova), e
  a leitura de carga renova o par vencido de conta **parada** (emenda da D4,
  decisão do dono). Nunca renovar a ativa pelo cofre: o refresh token dela lá já
  foi consumido pelo CLI, e a recusa marcaria "Reconectar" à toa.

## Vault

Documentação viva em `Claude Seazone/Projects/donel-dev/` (context.md, todo.md).
Atualizar ao concluir marcos.

## Active Technologies
- TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2 + Electron 43.2, node-pty 1.1.0 (patch), @xterm/xterm 6.0.0; novas: react-markdown 10, remark-gfm 4, shiki 4 (núcleo + Oniguruma WASM) (014-chat)
- transcripts JSONL do CLI (só leitura) + `config.json` do app (`chat.enabled`, `chat.focusMode`) + `userData/hook-settings/<ptyId>.json` + `userData/chat-attachments/` + `userData/chat-diagnostics.log` (014-chat)

## Recent Changes
- 014-chat: Added TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2 + Electron 43.2, node-pty 1.1.0 (patch), @xterm/xterm 6.0.0; novas: react-markdown 10, remark-gfm 4, shiki 4 (núcleo + Oniguruma WASM)
