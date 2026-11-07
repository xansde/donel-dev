# Histórico do CLAUDE.md

Trechos que saíram do `CLAUDE.md` na reescrita enxuta de 2026-11-06: datas de redefinição, narrativa de decisão, status cumprido e o que o código já não tem. A regra vigente de cada assunto está no `CLAUDE.md`; aqui fica o porquê. Texto copiado como estava.

## Canais e merge: como a regra chegou aqui

## Repositório e canais (modelo alfa/beta/stable — redefinido em 2026-07-28)
- Versão anterior deste modelo (24/07, pré-repo público) chamava `main` de
  stable; o público assumiu esse papel e o `main` privado desceu para beta.
- **PR e merge (redefinido pelo dono em 2026-08-09)**: **abrir PR contra
  `staging` é livre para o Claude**, sem pedir confirmação — inclusive quando
  quem abre é a fase Implementar da Esteira. A regra anterior ("PR é sempre
  ato humano") **caiu**, aqui e no baseline do squad.
- **Merge em `staging` (redefinido pelo dono em 2026-10-08)**: **o Claude
  mergeia** os PRs contra `staging` assim que a verificação automática
  (`npm run verify` = typecheck + test + build; ver "Testes enxutos" abaixo) estiver verde, sem
  esperar o dono ("mergeie você. Não fica me esperando para mergear nada").
  A bateria manual no alfa passa a ser validação **depois** do merge, não
  pré-requisito. Sempre `gh pr merge --merge`, nunca `--admin`. `main` e o
  repo público seguem no bloqueio total do bullet acima.

## Alfa diário: o vaivém da automação

## Alfa diário e novidades da versão (pedido do dono, 28/10)

- O dono quer um instalador novo do alfa pronto quando pedir e uma janela "O que
  mudou" na primeira abertura de cada versão.
- Build **sob demanda** (dono, 03/11: "Desliga essa automação. Eu vou falar quando eu
  quiser"; antes houve 06:30 diário e, por uma hora, a cada 10 min — os dois
  derrubados). A tarefa agendada "Donel Dev Alfa diario" fica **desativada**. O
  instalador sai só quando o dono pede, ou uma vez ao fim de uma leva de trabalho,
  rodando `scripts/build-alfa-diario.ps1` à mão (checar RAM livre antes). O app
  mostra "Versão nova · Atualizar" (B33) quando o instalador aparece. O script

## Repo público: as exceções nomeadas do espelho

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

> Nota de 2026-11-06: `tests/esteiraLayoutCanalV2.test.ts` não existe mais; o `sincronizar-publico.ps1` ainda o lista em `$excluirArquivos`.

## Regras do MVP (gate de 2026-07-22, já superado)

- **Fonte de verdade do escopo**: `specs/001-mvp/` (spec → plan → tasks).
  Não implementar nada fora das tasks sem atualizar a spec primeiro.
- **Gate ativo**: o Alexandre aprovou apenas spec/plan (2026-07-22). Implementar
  código do MVP exige novo OK explícito dele.
- **T001 (spike de perfis) é bloqueante**: nenhuma UI de perfis antes do spike
  validar `CLAUDE_CONFIG_DIR` — resultado vai em
  `specs/001-mvp/spike-t001-resultado.md`.

## Credenciais: a exceção e as emendas, com datas

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
  **Lugares remotos — emenda do dono (04/11, "manda bala para controlar as
  contas da VPS também")**: o mesmo perímetro grava o par da conta escolhida no
  `~/.claude` de um lugar remoto (VPS) por `ssh`, em
  `src/main/accounts/remote-claude-state.ts`. O par só viaja pelo stdin do ssh
  (nunca argv, log ou erro); a escrita é compare-and-swap; uma conta nunca fica
  ativa em dois lugares (refresh token de uso único). Desenho no
  [ADR 0005](../adr/0005-contas-em-lugares-remotos.md). Continua proibido
  qualquer outro módulo tocar credencial.
  **Navegador interno não é exceção** (30/10): login no painel é o dono
  digitando; o Chromium guarda os cookies da partição `persist:donel-browser`
  e o código do app não os lê nem grava (`docs/design/navegador-interno.md`).

## Testes: a decisão de 03/11 e o motivo do build no verify

- **Testes enxutos (decisão do dono, 03/11 — substitui o "TDD com escopo" e
  as camadas de teste de 08/10)**: "o mais próximo de zero, focando no que
  realmente é importante". A suíte tem ~17 arquivos vitest e **um** smoke.
  Teste só entra para guardar o que quebraria **sem o dono perceber usando o
  app**: credencial (`src/main/accounts/`), argv de lançamento, dado
  persistido que um canal pode apagar (config, `mindscape.json`, registro de
  sessões), apagar/matar coisa (faxina, worktree, kill guard), guard de
  navegação e mensagem do chat que some ou duplica. Tela, layout, texto,
  fluxo de UI e "renderiza" **não** ganham teste; se quebrar, o dono vê no
  alfa. Nada de teste por ID de spec, nem dois testes da mesma coisa.
  - Verificação padrão: `npm run verify` (typecheck + `npm test` + `electron-vite
    build`). O build entrou em 05/11: um merge deixou uma chave aberta no CSS,
    typecheck e testes passaram e o instalador quebrou.

## Mapa do Modo Dev (cumprido em 27/07)

**Mapa ativo — "Modo Dev do Donel Dev".** Mora no vault Claude Seazone, em
`Projects/donel-dev/wayfinder-modo-dev/` (não em `.scratch/`, apesar da
convenção acima — divergência conhecida, resolver movendo se incomodar).
Pedido "**wayfinder no próximo MD**" = abrir `PROXIMO.md` daquela pasta e pegar
o primeiro `⬜`; a ordem **não é numérica**. Prompts prontos em `sessoes.md`.
**O mapa está CUMPRIDO desde 27/07** (MD-01..MD-08 resolvidos) — ele virou a
entrega `specs/003-modo-dev/`. Só voltar ao mapa se a spec parecer contraditória.

## Gotcha histórico: perfis

- (histórico — o mecanismo morreu na 011, etapa 2) `~/.claude-profiles`
  ficava no home local, nunca no OneDrive (junctions). O app hoje só toca
  `~/.claude`; o histórico dos perfis, se algum dia migrado, fica arquivado
  em `~/.claude-profiles.old` (nunca deletado pelo app).

## Active Technologies / Recent Changes (gerado pelo spec-kit; derivável do `package.json`)

## Active Technologies
- TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2 + Electron 43.2, node-pty 1.1.0 (patch), @xterm/xterm 6.0.0; novas: react-markdown 10, remark-gfm 4, shiki 4 (núcleo + Oniguruma WASM) (014-chat)
- transcripts JSONL do CLI (só leitura) + `config.json` do app (`chat.enabled`, `chat.focusMode`) + `userData/hook-settings/<ptyId>.json` + `userData/chat-attachments/` + `userData/chat-diagnostics.log` (014-chat)
- TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2 + Electron 43.2 (`BrowserWindow` transparente, `screen`, `Menu`); nenhuma dependência npm nova. Arte recortada por script Python 3.12 + Pillow 12.2 (ferramenta de autor, fora do app) (015-jobu-pet)
- `config.json` do app — chave de topo `pet` (`enabled`, `placement`); assets PNG empacotados pelo Vite em `out/renderer/assets/` (015-jobu-pet)

## Recent Changes
- 014-chat: Added TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2 + Electron 43.2, node-pty 1.1.0 (patch), @xterm/xterm 6.0.0; novas: react-markdown 10, remark-gfm 4, shiki 4 (núcleo + Oniguruma WASM)
