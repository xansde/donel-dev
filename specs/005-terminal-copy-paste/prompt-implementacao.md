# Prompt de handoff — sessão de implementação da 005 (copiar/colar/imagem)

Gerado em 2026-07-26, com a **004 e a 006 já entregues e validadas** por ele.
Esta feature roda **em paralelo com a 007** (favoritos + sessões recentes), cada
uma em sua própria worktree e branch. Colar o bloco abaixo numa sessão nova.

---

```
Sessão exclusiva de IMPLEMENTAÇÃO da feature 005-terminal-copy-paste do Donel Dev.
Você roda EM PARALELO com outra sessão que está implementando a 007 — leia a
seção "PARALELISMO" antes de qualquer coisa.

## Setup (faça isto primeiro, é a sua worktree isolada)

    git -C C:\Users\xansd\seazone\donel-dev fetch origin
    git -C C:\Users\xansd\seazone\donel-dev worktree add C:\Users\xansd\seazone\donel-dev-005 -b feat/005-terminal-copy-paste origin/feature/mvp-p0
    cd C:\Users\xansd\seazone\donel-dev-005
    npm install

Por que worktree e não a pasta principal: os smokes executam `out/main/index.js`,
e `npm run build` reescreve essa pasta. Duas sessões implementando no MESMO
diretório fazem uma testar o bundle da outra — e o teste PASSA testando a coisa
errada. `npm install` aqui é obrigatório e demora alguns minutos (o `postinstall`
roda `patch-package` + `electron-rebuild` do `node-pty` contra a ABI do Electron,
que é específico da pasta); ocupa ~741 MB.

Base da branch: `origin/feature/mvp-p0` DEPOIS do fetch — nunca o checkout local
(uma branch deste squad já nasceu 660 commits atrás por isso).

## Leia nesta ordem antes de escrever qualquer linha

1. specs/005-terminal-copy-paste/spec.md — CA-1..CA-9 e as decisões C1–C5, já
   respondidas por ele: são REQUISITO, não sugestão.
2. specs/005-terminal-copy-paste/spike-1-imagem-no-conpty.md — o contrato do
   clipboard PROVADO em ConPTY real. É de onde sai a sequência de tecla da
   imagem; não reinvente nem "melhore" isso.
3. specs/005-terminal-copy-paste/{plan,tasks}.md — Fatias 1–4, T501–T510.
4. CLAUDE.md do repo — remoto, canais main/staging, regras de push.
5. specs/backlog.md §B11 (estado real dos vermelhos) e §B14 (as DUAS instalações
   na máquina dele — instalar é ato dele, não seu).

## O escopo, em uma frase

Hoje `term.onData` (`TerminalPane.tsx:337-341`) repassa TODO byte cru ao PTY,
inclusive o `\x03` do `Ctrl+C` — é a causa da dor dele ("muitas vezes interrompe
as execuções"). Nenhuma task remove esse caminho: elas colocam um DECISOR antes
dele, e o decisor é um módulo puro.

Três coisas que definem o sucesso desta entrega:
- **`Ctrl+C` sem seleção em aba `claude` → `noop`**, e o teste tem de assertar
  explicitamente que NÃO é `passthrough`. É o CA-2, o coração da dor.
- **`Ctrl+C` sem seleção em aba `shell` → `passthrough`** (tem de matar o
  processo, como no Windows Terminal, que é a referência dele).
- **Colar imagem** escreve a sequência do spike no PTY e MAIS NADA — sem arquivo
  temporário, sem base64, sem spinner nosso.

## Gotchas que já custaram tempo neste projeto

- **`attachCustomKeyEventHandler` é SINCRÔNICO e `hasImage()` é IPC async**
  (T507). O padrão decidido no plano: ao identificar `Ctrl+V`, cancelar já
  (`return false`) e resolver async qual colagem fazer — é seguro porque as duas
  saídas são ações nossas. A promise PRECISA de `.catch` (nada de unhandled
  rejection).
- **Não use `navigator.clipboard` no renderer** — `contextIsolation: true`, sem
  `nodeIntegration`. O clipboard vive no main, atrás de IPC (T503/T504).
- **Clipboard indisponível não pode derrubar a digitação:** exceção do clipboard
  degrada (`hasImage → false`, `readText → ''`), nunca propaga.
- **Ordem dos guard rails importa** (T501): `keyup` → passthrough; `shift`/`alt`/
  `meta` → passthrough (é o que preserva `Ctrl+Shift+C/V` e `Alt+V`); só então
  `Ctrl+C`/`Ctrl+V`.
- **Colar multilinha em aba claude vai envolvido em bracketed paste**
  (`\x1b[200~` … `\x1b[201~`) — sem isso 5 linhas viram 5 Enters, que é outra dor
  registrada no roteiro do batch-5.
- Smokes exigem `npm run build` ANTES (eles rodam `out/main/index.js`).

## PARALELISMO — a 007 está rodando ao mesmo tempo

Ela mexe em `App.tsx`, `ProjectSidebar.tsx`, `config-store.ts`,
`shared/config.ts`, `shared/sessions.ts` e um `shared/sessionRegistry.ts` novo.
**Você não toca em nenhum desses.** Seus arquivos: `shared/terminalKeymap.ts`
(novo), `main/clipboard-bridge.ts` (novo), `TerminalPane.tsx`.

**Três arquivos são compartilhados** — `src/main/index.ts`,
`src/preload/index.ts`, `src/shared/index.ts` — e nos três a sua mudança é
ADITIVA (registrar canal, expor método, exportar tipo). Regras para o merge
depois ser trivial:
- acrescente ao lado do que já existe; **não reordene, não reformate** nada;
- adicione só as suas linhas de `import` (o topo do arquivo é o clássico ponto de
  conflito);
- não renomeie nem "arrume" código alheio de passagem.

Não faça rebase na branch da 007. No fim, rebase em `origin/feature/mvp-p0`.
Push da SUA branch: autorizado. Merge/PR: ato dele.

## Estado da suíte de smokes (não confunda com regressão sua)

Última execução completa: **4 vermelhos conhecidos**, causa nomeada em §B11:
2 de `previous-sessions.spec.ts` (dívida T013) + `model-injection.spec.ts` e
`terminal.spec.ts:281` por **cota semanal esgotada** (o CLI imprime "You've hit
your weekly limit" no pane capturado; os dois exigem turno real do modelo).

⚠️ **Contenção com a outra sessão:** vários smokes fazem asserção sobre CONTAGEM
DE PROCESSOS via `tasklist` (`tabs-lifecycle.spec.ts`). Se a sessão da 007 estiver
rodando a suíte ao mesmo tempo, esses testes podem dar vermelho (ou verde) falso.
Durante o desenvolvimento, rode só os SEUS arquivos de spec. No gate, se aparecer
vermelho fora da lista acima, **re-rode aquele arquivo isolado** antes de chamar
de regressão.

## Como trabalhar

- TDD nos módulos puros (T501 decisor, T503 clipboard-bridge): teste falhando
  primeiro, implementação mínima, refatora.
- Commit por task ou batch, em português, Conventional Commits. Commitar é
  DEFAULT — não pergunte.
- `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
- Não declare pronto sem rodar e VER a saída. Se algo ficou sem verificar, diga.

## Fronteiras (inegociáveis)

- `main`: BLOQUEIO TOTAL (é o canal stable do app que ele usa para trabalhar).
  Nada de push/PR/merge sem instrução LITERAL dele.
- Nunca `--no-verify`.
- **Instalar o app é ato DELE.** Você empacota (`npm run build` + `npm run dist`)
  e avisa; §B14 do backlog explica que há duas instalações e qual será
  sobrescrita.
- O app não toca credenciais: `/login` é ato humano no terminal.
- LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
- Não implemente nada fora do tasks.md. Se aparecer algo, ANOTE no
  `specs/backlog.md` e siga.
- Fora de escopo já decidido (não faça): copy-on-select, menu de contexto,
  keybindings configuráveis, colar imagem em aba shell, editar o
  `keybindings.json` global do usuário.

## Cota

O T510 (E2E dele) depende de cota: o passo (a) do roteiro é `Ctrl+C` sem seleção
DURANTE uma execução longa numa sessão claude real. A cota semanal do perfil
estava esgotada em 25/07. Entregue tudo, escreva o roteiro (T509), empacote, e
diga explicitamente o que ficou sem validação humana.

## Checkpoint

Ao fechar a Fase C (T507) ou ao travar, PARE e dê um relatório curto: o que
passou, o que ficou vermelho com a saída REAL, e o que precisa de decisão dele.
Ao final, atualize `specs/005-terminal-copy-paste/tasks.md` e o vault
(`Projects/donel-dev/context.md` §Status + `todo.md`).

Comece confirmando em uma linha qual task vai atacar e o teste que vai escrever
primeiro.
```
