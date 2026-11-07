# donel-dev — contexto do projeto

IDE própria do Alexandre: Electron + xterm.js + node-pty embedando o `claude` CLI (abas de terminal, launcher, sessões, contas, Mindscape, chat). UI em pt-BR. Histórico deste arquivo (datas de decisão, narrativa, status cumprido): `docs/historico/claude-md-historico.md`.

## Repositório e canais

- **Remoto**: `https://github.com/xansde/donel-dev` (privado, conta pessoal `xansde`; `xansde-seazone` é colaborador com escrita).
- **Branch = canal** (escada de maturidade):
  - `feature/*` → trabalho em andamento; integra em `staging` por PR.
  - `staging` → canal **alfa**: a novidade cai aqui primeiro e é olhada aqui.
  - `main` → canal **beta**: sobe quando o Alexandre validou o alfa e confia.
  - `xansde/donel` (repo público) → canal **stable**: só release fechado e versionado (seção abaixo).
- **Regra dura**: push/PR/merge em `main` e publicação no repo público só com instrução literal do Alexandre. "Comita", "deploya", "atualiza staging" não autorizam tocar em `main` nem no público.
- **PR e merge**: abrir PR contra `staging` é livre para o Claude, inclusive pela fase Implementar da Esteira. **O Claude mergeia** os PRs contra `staging` assim que `npm run verify` estiver verde, sem esperar o dono ("mergeie você. Não fica me esperando para mergear nada"); a bateria manual no alfa é validação depois do merge. Sempre `gh pr merge --merge`, nunca `--admin`.
- **Conflito com `staging` é do Dev, nunca do Revisor**: o Dev mescla a base, resolve e roda `npm run verify` de novo; PR com conflito volta ao Dev, e o Revisor só aprova e mergeia PR limpo.
- **Canais instalados lado a lado**: `npm run dist:alfa` / `dist:beta` / `dist` empacotam com identidade própria de instalador ("Donel Dev Alfa"/"Donel Dev Beta"/"Donel Dev"); builde cada um do checkout do seu canal (alfa←`staging`, beta←`main`, stable←público). O `userData` é **compartilhado de propósito** (`app.setName('donel-dev')` igual nos três: mesmos dados, o dono escolhe qual versão abrir). Riscos aceitos: (1) um canal antigo aberto pode sanitizar/derrubar chave de config que só o canal novo conhece (item de produto "sanitize com passthrough"); (2) `setAppUserModelId` é um só, notificações e taskbar tratam os três como o mesmo app. Isolamento completo (userData por canal) é o **B10** do `specs/backlog.md`, opcional.

## Alfa e novidades da versão

- **Todo PR mergeado em `staging` que muda algo visível acrescenta um item em `src/renderer/src/patchnotes/notes.ts`**, no dia do merge (cria o dia se não existir). Texto de usuário: o que muda para ele, sem arquivo, PR ou jargão. É o que alimenta a janela "O que mudou" na primeira abertura de cada versão.
- O instalador do alfa sai **só quando o dono pede**, ou uma vez ao fim de uma leva de trabalho: `scripts/build-alfa-diario.ps1` à mão (cheque a RAM livre antes). A tarefa agendada "Donel Dev Alfa diario" fica desativada ("Eu vou falar quando eu quiser"). O script builda `origin/staging` na worktree `.claude/worktrees/alfa-diario` e deixa `Donel Dev Alfa-Setup-AAAA-MM-DD-HHMM.exe` em `%USERPROFILE%\Donel Dev Alfa - diario\` (guarda os 8 últimos); falha deixa `FALHOU.txt` e o `build.log` lá. O app mostra "Versão nova · Atualizar" (B33) quando o instalador aparece.

## Repo público (canal stable)

- **Remoto**: `https://github.com/xansde/donel` (público, MIT). Cópia de trabalho local: `../donel-dev-publico`. Não há histórico compartilhado entre os dois.
- **Papéis**: este repo é o de trabalho (specs, docs de processo, histórico); o público é o estável, só o app, para quem quiser clonar e buildar.
- **Nunca vão para o público**: `specs/`, `docs/`, `scripts/`, `design/`, `.claude/`. O público tem `README.md`, `LICENSE` e `CLAUDE.md` próprios, editados à mão; o sync não os sobrescreve. Exceções nomeadas pelo dono, que entram no espelho porque testes espelhados as exercitam (teste que só passa no repo de trabalho não vale como gate): `skills/`, `docs/esteira-dev/`, `scripts/esteira-check.mjs`, `scripts/esteira-custo-fase.mjs` e `.esteira/review-policy.json`. Teste que confronta `specs/` ou `.esteira/` fica fora do espelho (`$excluirArquivos` do script). Os scripts de publicação seguem fora.
- **Promover**: `powershell -File scripts/sincronizar-publico.ps1` espelha as pastas do app + configs de build e imprime o `git status` do lado público. Ele não commita nem faz push: revisar, rodar `npm test` lá e commitar à mão. `package.json` diverge de propósito (license/repository/author + scripts `publicar*`); o script avisa quando versão ou dependência mudou, para levar à mão.
- **Vocabulário interno fica fora**: fixture/story usa nome genérico (`atlas`, `beacon`, `vega`) nos dois repos, para as árvores continuarem idênticas. Ainda expostos e assumidos: `Esteira`/`EsteiraPhase`, `TaskDex` e `seazone` como nome de pasta-raiz default.

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

- **Credenciais**: o app nunca lê, grava ou exibe credenciais; login acontece só dentro do terminal, pelo fluxo oficial do CLI. **Exceção nomeada e confinada**: o motor de contas (`src/main/accounts/`, inclusive `migration/`) é a única parte do app que lê/grava credencial — mod local (cofre `safeStorage` + endpoint OAuth da Anthropic no switch, refresh só de fallback) e `claude-state.ts` (única escrita de `~/.claude/.credentials.json`/`oauthAccount`, ordem invariante: captura do par rotacionado → escreve `.credentials.json` → apaga `oauthAccount`). O par migrado de um perfil vai direto para o cofre, nunca por variável de retorno exposta.
  - `CredentialPair` nunca sai de `src/main/accounts/`: não cruza o preload, não entra em log nem em mensagem de erro. O core e a UI (inclusive `AccountsPanel.tsx`/`MigrationWizard.tsx`) não tocam segredo: o formulário de conectar é write-only, nenhum canal de leitura devolve o que foi digitado.
  - **Lugares remotos (VPS)**: o mesmo perímetro grava o par da conta escolhida no `~/.claude` remoto por `ssh`, em `src/main/accounts/remote-claude-state.ts`. O par só viaja pelo stdin do ssh (nunca argv, log ou erro); a escrita é compare-and-swap; uma conta nunca fica ativa em dois lugares (refresh token de uso único) ([ADR 0005](docs/adr/0005-contas-em-lugares-remotos.md)).
  - **Navegador interno não é exceção**: login no painel é o dono digitando; o Chromium guarda os cookies da partição `persist:donel-browser` e o código do app não os lê nem grava (`docs/design/navegador-interno.md`).
  - **Não generalizar a exceção**: nenhum outro módulo ganha licença de tocar credencial por causa dela.
- **Testes enxutos** ("o mais próximo de zero, focando no que realmente é importante"): teste só entra para guardar o que quebraria **sem o dono perceber usando o app** — credencial (`src/main/accounts/`), argv de lançamento, dado persistido que um canal pode apagar (config, `mindscape.json`, registro de sessões), apagar/matar coisa (faxina, worktree, kill guard), guard de navegação e mensagem do chat que some ou duplica. Tela, layout, texto, fluxo de UI e "renderiza" não ganham teste (se quebrar, o dono vê no alfa). Nada de teste por ID de spec, nem dois testes da mesma coisa.
  - Verificação padrão: `npm run verify` (typecheck + `npm test` + `electron-vite build`; o build pega o que typecheck e testes deixam passar, como CSS quebrado).
  - `npm run test:smoke` (abre o app uma vez, CLI falso) só quando mexer em main/preload/PTY ou em dependência nativa. Nunca rode smokes em lote nem crie smoke novo sem o dono pedir: abrir instâncias do app atrapalha o trabalho dele.
- **Ferramentas da Seazone**: o Donel Dev pode aceitá-las para facilitar a vida do dono, mas **nunca fixo à Seazone** — toda integração é adaptador opcional, desligado por padrão, com URL e nomes vindos da config, nada hardcoded no core nem default que vaze para o repo público. O pool Seazone segue isso: só entra quando `accounts.seazone` está na config, e as contas dele aparecem no fim da lista, ao lado das locais (`src/main/accounts/mods/local-with-pool-mod.ts`).

## Issue tracker e filas

- Este repo usa **local-markdown**: mapa e tickets em `.scratch/<effort>/`, versionados. Convenção em `.claude/issue-tracker.md` — leia antes de rodar `/wayfinder` ou qualquer skill que fale em "issue tracker". Não é TaskDex: sem `.taskdex.json`.
- **Gatilhos de fila** — pedidos "implementar melhorias Modo Dev", "rodar a próxima fase da 010", "executar a próxima onda da 012", "rodar a próxima fase das contas" e "rodar a próxima fase do chat" (e as variantes): leia `docs/gatilhos-de-fila.md` antes de agir; cada um abre uma fila `PROXIMO.md` no vault, com ordem e fonte de verdade próprias.

## Gotchas

- node-pty precisa casar com a ABI do Electron — prebuilds/@electron/rebuild; pin de versões testadas.
- Transcripts JSONL nunca são lidos inteiros — streaming + stat.
- Junction em Node: `fs.symlinkSync(target, path, 'junction')` — não pede admin.
- **`/logout` do CLI revoga o refresh token no servidor.** Nunca use para cadastrar ou trocar conta: a cópia de credencial feita antes dele morre. Cadastro é por login isolado (`CLAUDE_CONFIG_DIR` numa pasta própria) — `specs/011-contas-e-provedores/research-etapa-3-cli.md`.
- **Depois de uma troca, o `/status` do CLI mostra "Claude API account"** até refazer o fetch do perfil (minutos). Para saber a conta em uso numa sessão, use o `/usage`. O `userEmail` que o harness carimba no contexto da sessão também é lido no início e não acompanha a troca.
- O mod local captura a lista de contas no construtor do motor: toda mudança de `mod` ou de `localAccounts` passa por `AccountEngineHost.apply` (`applyAccountsEngineConfig` no `index.ts`), que reconstrói o motor — nunca `updateConfig` direto para mudar a lista.
- **Login isolado:** o app encerra a aba de login depois de colher a credencial; nada é digitado nela pelo app. Smoke desse fluxo usa `DONEL_CLAUDE_EXECUTABLE_FIXTURE` (claude falso): um `claude.cmd` no PATH não basta, porque o resolvedor prefere qualquer `claude.exe` e abriria o CLI real.
- **O access token do CLI vence em ~8h** (`expiresAt` do `.credentials.json`). A carga da conta **ativa** é lida com o par vivo do `~/.claude` (o par dela no cofre envelhece assim que o CLI renova), e a leitura de carga renova o par vencido de conta **parada**. Nunca renovar a ativa pelo cofre: o refresh token dela lá já foi consumido pelo CLI, e a recusa marcaria "Reconectar" à toa.

## Domínio (mantido pelo /refinamento)

- Vocabulário canônico: `docs/glossario.md` — use estes termos em código e conversa.
- Decisões de domínio e arquitetura: `docs/adr/` — consulte antes de propor mudança.
- Mindscape: quadro próprio em React + `roughjs`, não Excalidraw; o renderer é dono do estado e só `src/main/mindscape-store.ts` grava `<userData>/mindscape.json` ([ADR 0004](docs/adr/0004-base-do-quadro-mindscape.md), [design](docs/design/mindscape.md)).
- **Alcance / hierarquia entre sessões** (dono, 04/11): dirigir outra sessão com poder de matar (hoje `sessao_fechar`) só com hierarquia — no quadro, abaixo pelas setas (direta ou em cadeia); entre quadros, só o Líder de um quadro com `reach: 'all'` (botão "Alcance" no Mindscape; ausente = só o próprio). A regra mora **só** em `src/shared/mindscape/reach.ts`; quem precisar de alcance reusa, não recria. O Líder único (aba marcada pelo Jobu, [ADR 0007](docs/adr/0007-lider-unico.md)) é um ramo dela: fica acima do topo de todo quadro, sem a marca "Alcance".
- `mindscape.json`: campo novo no documento **sobe o `schemaVersion`**. O `parseMindscapeDoc` descarta o que não conhece e o `userData` é compartilhado entre canais, então um canal mais antigo gravaria por cima e apagaria o campo; com a versão maior ele fica read-only ([design do desenho](docs/design/mindscape-desenho.md)).

## Vault

Documentação viva em `Claude Seazone/Projects/donel-dev/` (context.md, todo.md). Atualizar ao concluir marcos.
