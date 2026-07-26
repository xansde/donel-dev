# Prompt de handoff — lote 005 + 007 numa sessão-cockpit com subagentes

Gerado em 2026-07-26. Executa as duas features restantes da fila em **uma única
sessão**, que dispara **um subagente in-session por feature**, cada um na sua
worktree — o mesmo desenho da fase Implementar da Esteira do Xande, **sem
TaskDex**.

## Por que sem TaskDex (decisão dele em 26/07)

A esteira formal não roda neste repo hoje, por três motivos verificados:

1. `donel-dev` **não está** em `~/.claude/esteira-config/repos.json` (só
   `spotsys`, `api-spotsys`, `esteira-do-xande`, `dalton`);
2. **não há `.taskdex.json`** no repo, e as fases resolvem trabalho por
   `card_id` via `mcp__taskdex__*`;
3. o preflight do `esteira-implementar` **exige** um
   `plano-result.json` com `status: success` gravado pela fase Plano — e os
   `tasks.md` da 005/007 foram escritos fora da esteira (spec-kit à mão). Produzir
   esse arquivo rodando `/esteira-plano` **refaria** spec/clarify/plan/tasks, com
   risco de sobrescrever o clarify que ele respondeu em 25/07.

Fabricar um `plano-result.json` falso resolveria o gate e sujaria a trilha de
auditoria da esteira — descartado. O que se aproveita é o **desenho**: worktree
recriada do zero, handoff de entrada em arquivo, subagente in-session (herda auth
e gateway da sessão-cockpit), manifesto de saída, gate no cockpit.

## A vantagem sobre rodar duas sessões separadas

Numa máquina só, duas sessões independentes rodando a suíte de smokes ao mesmo
tempo produzem vermelho (ou verde) **falso**: vários specs fazem asserção sobre
contagem de processos via `tasklist` (`tabs-lifecycle.spec.ts`). Com um cockpit,
a implementação corre **em paralelo** e a suíte completa roda **serializada** —
uma worktree depois da outra. Ninguém precisa combinar nada com ninguém.

---

Colar o bloco abaixo numa sessão nova aberta em `C:\Users\xansd\seazone\donel-dev`.

```
Sessão-COCKPIT de um lote de duas features do Donel Dev: 005-terminal-copy-paste
e 007-favoritos-sessoes. Você NÃO implementa — você orquestra: dispara um
subagente in-session por feature, cada um na sua worktree, e faz o gate no fim.
Modelo da fase Implementar da Esteira do Xande, sem TaskDex (o repo não tem
vínculo; ver specs/prompt-lote-005-007.md para o porquê).

## Passo 0 — Estado (bloqueante)

    cd C:\Users\xansd\seazone\donel-dev
    git status --short          # tem de estar LIMPO
    git fetch origin
    git log --oneline -3

Árvore suja → PARE e pergunte. Nada de `git add -A` em lugar nenhum deste fluxo:
este repo já teve duas sessões escrevendo na mesma árvore, e um `-A` distraído
commita trabalho alheio.

## Passo 1 — Leia o que já está decidido

1. specs/005-terminal-copy-paste/prompt-implementacao.md
2. specs/007-favoritos-sessoes/prompt-implementacao.md
   (os dois são handoffs completos, escritos por quem entregou a 004 e a 006 —
   trazem gotchas, fronteiras e o estado real da suíte)
3. CLAUDE.md do repo · specs/backlog.md §B11 (vermelhos conhecidos), §B14 (as
   duas instalações — instalar é ato do Alexandre, nunca seu)

Não reabra decisões, não reclarifique, não reescreva spec/plan/tasks. As duas
features estão clarificadas e planejadas; a 007 teve o clarify respondido por ele
em 25/07.

## Passo 2 — Preflight (bloqueante, é o que substitui o preflight.py)

Para CADA feature, confirme:
- `specs/<slug>/tasks.md` existe e está commitado (`git log -1 -- <path>`);
- `origin/feature/mvp-p0` está fresco (fetch do Passo 0);
- `npm` e `git` no PATH.
Qualquer item falhando: PARE e relate. Não crie worktree.

## Passo 3 — Uma worktree por feature, criada do zero

    git worktree remove --force C:\Users\xansd\seazone\donel-dev-wt-005 2>/dev/null || true
    git worktree add C:\Users\xansd\seazone\donel-dev-wt-005 -b feat/005-terminal-copy-paste origin/feature/mvp-p0

    git worktree remove --force C:\Users\xansd\seazone\donel-dev-wt-007 2>/dev/null || true
    git worktree add C:\Users\xansd\seazone\donel-dev-wt-007 -b feat/007-favoritos-sessoes origin/feature/mvp-p0

Depois, `npm install` em CADA worktree (obrigatório: o `postinstall` roda
`patch-package` + `electron-rebuild` do `node-pty` contra a ABI do Electron, que é
específico da pasta; ~741 MB e alguns minutos cada). Rode os dois installs em
paralelo se puder — é I/O.

Por que worktree separada e não a mesma pasta: os smokes executam
`out/main/index.js`, e `npm run build` reescreve essa pasta. Duas implementações
no mesmo diretório fazem uma testar o bundle da outra — e o teste PASSA testando
a coisa errada.

## Passo 4 — Handoff de entrada, em arquivo

Em cada worktree, grave `.esteira-local/<slug>/ctx.md` (pasta `.esteira-local`
de propósito: não colide com o `.esteira/` da esteira formal, que não está em
uso aqui) com frontmatter:

    ---
    feature: <005-terminal-copy-paste|007-favoritos-sessoes>
    fase: implementar
    repo_alvo: C:/Users/xansd/seazone/donel-dev
    branch: <feat/...>
    worktree_path: <path>
    model: sonnet
    base_ref: origin/feature/mvp-p0
    disparado_em: <ISO 8601>
    ---

Corpo: paths absolutos de `spec.md`, `plan.md`, `tasks.md` e
`prompt-implementacao.md` daquela feature.

## Passo 5 — Dispare os DOIS subagentes, em paralelo

Duas chamadas da ferramenta Agent **na mesma mensagem** (para rodarem
concorrentes), modelo **sonnet** — implementar é execução mecânica a partir de um
tasks.md já decidido, não julgamento arquitetural. Anuncie ao Alexandre o
modelo antes de disparar.

Prompt de cada subagente (autocontido; troque <...> pelos valores reais):

    Você implementa a feature <slug> do Donel Dev, sozinho, na worktree
    <worktree_path>. Todos os paths que você usar são absolutos dentro dela.

    Leia, nesta ordem: <worktree_path>/.esteira-local/<slug>/ctx.md →
    specs/<slug>/prompt-implementacao.md → spec.md → plan.md → tasks.md.
    Implemente as tasks pendentes na ordem do tasks.md, com TDD nos módulos
    puros que ele marca (teste falhando primeiro).

    Regras duras:
    - `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
    - Smokes exigem `npm run build` ANTES (eles rodam out/main/index.js).
    - Durante o desenvolvimento rode SÓ os seus arquivos de spec de smoke.
      NÃO rode a suíte completa: quem roda é o cockpit, serializado, no fim.
    - Commit por task ou batch, Conventional Commits (tipo em inglês, descrição
      em português), por caminho explícito. NUNCA `git add -A`.
    - NUNCA abra PR, nunca faça merge, nunca toque em `main`, nunca
      `--no-verify`.
    - Você NÃO é o único trabalhando: a outra feature roda em paralelo em outra
      worktree. Os arquivos dela não são seus. Nos três pontos compartilhados
      (`src/main/index.ts`, `src/preload/index.ts`, `src/shared/index.ts`) sua
      edição é ADITIVA: acrescente ao lado do que existe, não reordene, não
      reformate, adicione só as suas linhas de import.
    - LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
    - Não implemente nada fora do tasks.md. Se aparecer algo, anote em
      specs/backlog.md e siga.

    Se travar em algo que só um humano decide (task ambígua, trade-off não
    coberto pelo plano), ou se para fechar uma lacuna você precisaria AMPLIAR o
    escopo além do tasks.md: NÃO invente a decisão. Marque
    status: needs_attention no manifesto e descreva em summary.

    Ao final, grave o manifesto em
    <worktree_path>/.esteira-local/<slug>/result.json:
    {
      "feature": "<slug>",
      "status": "success | needs_attention | failed",
      "branch": "<feat/...>",
      "commits": ["<sha> <assunto>", ...],
      "tests_run": { "typecheck": "pass|fail", "unit": "<n> passed / <m> failed",
                     "smokes_proprios": "<n> passed / <m> failed" },
      "tasks_entregues": ["T5xx", ...],
      "tasks_pendentes": ["T5xx", ...],
      "artifact_paths": { "spec": "...", "plan": "...", "tasks": "...", "e2e": "..." },
      "knowledge": { "repo_lessons": "written|nothing_to_record" },
      "summary": "<o que ficou pronto, o que ficou vermelho com a saída real, o que precisa de decisão humana>"
    }
    Se o tasks.md pedir roteiro E2E manual, escreva-o no path que ele indica e
    registre em artifact_paths.e2e.

Não peça ao subagente para reinvocar skill da esteira (evita re-entrância).
Aguarde as notificações de término — sem polling, sem sleep.

## Passo 6 — Gate do cockpit (você mesmo verifica)

Leia os dois `result.json`. Então, **por worktree, UMA DEPOIS DA OUTRA** (nunca
as duas ao mesmo tempo — contenção produz vermelho falso nos smokes que contam
processos via `tasklist`):

    npm run build && npm run typecheck && npm test
    npx playwright test -c tests/smoke/playwright.config.ts
    npx playwright test -c tests/smoke-dev/playwright.config.ts

Vermelhos ESPERADOS (§B11, causa nomeada — declare, não mascare): 2 de
`previous-sessions.spec.ts` (dívida T013) + `model-injection.spec.ts` e
`terminal.spec.ts:281` (cota semanal esgotada; os dois exigem turno real do
modelo). Vermelho FORA dessa lista: re-rode aquele arquivo isolado antes de
chamar de regressão, e só então investigue.

Não confie no relatório do subagente: rode você mesmo e olhe a saída.

## Passo 7 — Empacotar e relatar

`npm run build` + `npm run dist` na worktree que o Alexandre for testar primeiro
(pergunte qual, ou empacote as duas em `release/` e diga qual é qual).
**Instalar é ato dele** — avise, pelo §B14, que o instalador substitui a
instalação de `C:\Program Files\Donel Dev` (all-users) e que o
`%LOCALAPPDATA%\Programs\Donel Dev` (23/07) é o ponto de retorno dele.

Relatório final ÚNICO, curto, cobrindo: o que cada feature entregou, o que ficou
vermelho com a saída REAL, os números medidos que os tasks.md exigem (a 007 pede
o tempo de pintura da sidebar < 100 ms — medido com polling apertado, não com
`expect().toPass`, que na 004 inflou 350 ms para 852 ms), e o que precisa de
decisão dele: instalar, e o merge das duas branches em `feature/mvp-p0`.

Atualize os dois `tasks.md` e o vault (`Projects/donel-dev/context.md` §Status +
`todo.md`) — commit por caminho explícito.

## Fronteiras (valem para você e para os subagentes)

- `main`: BLOQUEIO TOTAL. Nada de push/PR/merge sem instrução LITERAL dele.
- Push das branches `feat/005-*` e `feat/007-*`: autorizado. Merge: ato dele.
- Nunca `--no-verify`. Nunca `git add -A`.
- O app não toca credenciais: `/login` é ato humano no terminal.
- Instalar o app é ato dele.

Comece confirmando em uma linha: o estado do Passo 0, e quais dois subagentes vai
disparar com qual modelo.
```
