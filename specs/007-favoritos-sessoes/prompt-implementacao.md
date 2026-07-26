# Prompt de handoff — sessão de implementação da 007 (favoritos + sessões)

Gerado em 2026-07-26, com a **004 e a 006 já entregues e validadas** por ele, e
com esta spec **clarificada no mesmo dia** (D1–D9 do discovery + C1–C6 do
clarify). Roda **em paralelo com a 005** (copiar/colar no terminal), cada uma em
sua própria worktree e branch. Colar o bloco abaixo numa sessão nova.

---

```
Sessão exclusiva de IMPLEMENTAÇÃO da feature 007-favoritos-sessoes do Donel Dev.
Você roda EM PARALELO com outra sessão que está implementando a 005 — leia a
seção "PARALELISMO" antes de qualquer coisa.

## Setup (faça isto primeiro, é a sua worktree isolada)

    git -C C:\Users\xansd\seazone\donel-dev fetch origin
    git -C C:\Users\xansd\seazone\donel-dev worktree add C:\Users\xansd\seazone\donel-dev-007 -b feat/007-favoritos-sessoes origin/feature/mvp-p0
    cd C:\Users\xansd\seazone\donel-dev-007
    npm install

Por que worktree e não a pasta principal: os smokes executam `out/main/index.js`,
e `npm run build` reescreve essa pasta. Duas sessões implementando no MESMO
diretório fazem uma testar o bundle da outra — e o teste PASSA testando a coisa
errada. `npm install` aqui é obrigatório e demora alguns minutos (o `postinstall`
roda `patch-package` + `electron-rebuild` do `node-pty` contra a ABI do Electron,
que é específico da pasta); ocupa ~741 MB.

Base da branch: `origin/feature/mvp-p0` DEPOIS do fetch — nunca o checkout local.

## Leia nesta ordem antes de escrever qualquer linha

1. specs/007-favoritos-sessoes/discovery.md — a ENTREVISTA com ele, com as falas
   verbatim. É o que explica por que a feature é assim.
2. specs/007-favoritos-sessoes/spec.md — CA-1..CA-11, D1–D9 e C1–C6. Todas
   fechadas por ele: são REQUISITO, não sugestão.
3. specs/007-favoritos-sessoes/{plan,tasks}.md — Fatias 0–5, T701–T712.
4. CLAUDE.md do repo · specs/backlog.md §B11 (vermelhos), §B12 (dívidas da 004),
   §B14 (as duas instalações — instalar é ato dele).

## O que esta feature É e o que ela NÃO É

**É** acesso rápido: um grupo no TOPO da sidebar com os projetos FAVORITADOS,
colapsável, mostrando as 5 sessões mais recentes de cada um + as fixadas ALÉM
das 5. Clique cai na sessão (foca a aba se já estiver aberta; senão retoma).

**NÃO é** restaurar/manter sessões vivas. Ele foi explícito: *"Não quero manter
as sessões ativas, apenas acessar as últimas sessões de trabalho de maneira
rápida."* A decisão antiga de 23/07 ("restaurar no boot as sessões com atividade
no dia anterior") foi **CANCELADA por ele** — se você encontrar rastro dela em
algum documento, é histórico, não escopo.

## As cinco decisões de desenho que não podem ser reinventadas

1. **A fonte da lista é o REGISTRO do app, não o disco.** Ele pediu assim:
   *"Mantenha registro durante o trabalho. Na próxima execução do app, já tem
   salvo as últimas sessões/fixadas sem ter que carregar sessões claude."*
   Varrer `~/.claude` no boot custaria ~2 s de sidebar em branco com favoritos
   pesados (medição real da 004: 684 ms num projeto de 72 MB —
   `specs/004-nomear-sessoes/medicao-t403.md`).
2. **Poda na ESCRITA, não na leitura** (T701): cada visita mantém as 5
   não-fixadas mais recentes + TODAS as fixadas. É isso que mantém o
   `config.json` pequeno sem precisar de GC depois.
3. **Só o RENDERER escreve o registro.** O main tem o watcher e poderia
   escrever, mas aí o rótulo (que depende de `resolveSessionName` + `sessionNames`
   + fallback do projeto) teria de ser recalculado lá — duas cópias da mesma
   regra da 004. Um escritor; o main valida o payload.
4. **Debounce de ~10 s no gatilho do transcript** (T707): ele dispara a cada
   turn, e o `config.json` é o MESMO arquivo que guarda favoritos, roots e perfil
   ativo. Escrever ali dezenas de vezes por minuto é risco desnecessário.
5. **T709: o cabeçalho que acende vem ANTES do dedupe.** A lista geral de
   "Sessões" é ordenada por semáforo (permissão pendente no topo — FR-010/CA-6 do
   MVP). Tirar as sessões do favorito de lá pode esconder, num grupo colapsado,
   exatamente a sessão que espera resposta dele. Se o dedupe entrar primeiro,
   existe uma janela com esse bug. Reuse a precedência de `sessionOrdering.ts`
   (`permission > error > waiting > working > done`) — não escreva uma segunda
   tabela.

## Duas consequências ACEITAS por ele (não "conserte")

- **[C3] Entrada órfã some sozinha, sempre — inclusive fixada.** Uma sessão que
  ele fixou pode desaparecer sem aviso se o `.jsonl` for apagado. Ele escolheu
  simples em vez de avisado. Não invente um estado "indisponível" na UI.
- **[C1] O rótulo é cache e pode envelhecer.** Um `/rename` feito FORA do Donel
  deixa o nome do grupo velho até aquela sessão ser aberta. Não há revalidação
  silenciosa, nem botão de atualizar (C6) — foram descartados por ele.

## Uma interpretação minha que ele pode vetar numa palavra

O C6 ("sessão criada fora do Donel não é coberta") eliminou a reconciliação
CONTÍNUA com o disco, **não** a semeadura inicial do CA-8. Sem o CA-8, no
primeiro dia depois desta feature todo projeto favoritado apareceria VAZIO e a
entrega seria uma tela em branco. Então: projeto sem NENHUMA entrada no registro
faz UMA leitura de disco na primeira expansão (T706, com guarda dura no main
para não ler quando já existe registro); projeto que já tem registro nunca lê o
disco por conta própria. Se ele disser que quer o literal, é uma linha na spec.

## O que a 004 e a 006 já deixaram pronto (reaproveite, não recrie)

- `sessionNames` no ConfigStore + `resolveSessionName` (004) → o rótulo de cada
  linha sai resolvido por UMA função (CA-10). Não invente um segundo jeito de
  nomear a mesma sessão.
- A assinatura ÚNICA de `onTranscriptChanged` no `App.tsx` (T412/004, hoje
  compartilhada com a 006) → é o seu gatilho 3. **Reaproveite-a**, não abra uma
  segunda (é risco explícito na tabela do tasks.md).
- `TabState.claudeSessionId` (T404/004) → você já sabe qual aba é qual sessão,
  que é o que permite "focar em vez de abrir de novo" (CA-4).
- O padrão dos QUATRO pontos do `config-store.ts` para chave nova (T704): se
  esquecer um, a chave é silenciosamente descartada na leitura. Foi armadilha
  real na 004.

## PARALELISMO — a 005 está rodando ao mesmo tempo

Ela mexe em `TerminalPane.tsx`, `shared/terminalKeymap.ts` (novo) e
`main/clipboard-bridge.ts` (novo). **Você não toca em nenhum desses.**

**Três arquivos são compartilhados** — `src/main/index.ts`,
`src/preload/index.ts`, `src/shared/index.ts` — e nos três a sua mudança é
ADITIVA (registrar canais, expor métodos, exportar tipos). Regras para o merge
depois ser trivial:
- acrescente ao lado do que já existe; **não reordene, não reformate** nada;
- adicione só as suas linhas de `import`;
- não renomeie nem "arrume" código alheio de passagem.

Não faça rebase na branch da 005. No fim, rebase em `origin/feature/mvp-p0`.
Push da SUA branch: autorizado. Merge/PR: ato dele.

## Estado da suíte de smokes (não confunda com regressão sua)

Última execução completa: **4 vermelhos conhecidos**, causa nomeada em §B11:
2 de `previous-sessions.spec.ts` (dívida T013) + `model-injection.spec.ts` e
`terminal.spec.ts:281` por **cota semanal esgotada** (os dois exigem turno real
do modelo).

⚠️ **Contenção com a outra sessão:** vários smokes fazem asserção sobre CONTAGEM
DE PROCESSOS via `tasklist` (`tabs-lifecycle.spec.ts`). Se a sessão da 005 estiver
rodando a suíte ao mesmo tempo, esses testes podem dar vermelho (ou verde) falso.
Durante o desenvolvimento rode só os SEUS specs; no gate, vermelho fora da lista
acima → **re-rode aquele arquivo isolado** antes de chamar de regressão.

## Medição obrigatória (T712)

O CA-7 exige número, não impressão: tempo do `domcontentloaded` até a sidebar
pintada com o registro cheio (5 favoritos × 5 sessões + fixadas), alvo **< 100 ms**,
registrado em `medicao-ca7.md`. **Meça com polling apertado** — na 004 o
`expect().toPass` do Playwright reportou 852 ms para algo que levava ~350 ms; o
número era do amostrador, não do app.

## Como trabalhar

- TDD nos módulos puros (T701–T703 registro/seleção, T707 decisão de gravar).
- Commit por task ou batch, em português, Conventional Commits. Commitar é
  DEFAULT — não pergunte.
- `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
- Smokes exigem `npm run build` ANTES.
- Não declare pronto sem rodar e VER a saída.

## Fronteiras (inegociáveis)

- `main`: BLOQUEIO TOTAL. Nada de push/PR/merge sem instrução LITERAL dele.
- Nunca `--no-verify`.
- **Instalar o app é ato DELE** (§B14 — duas instalações; avise qual será
  sobrescrita).
- LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
- Não implemente nada fora do tasks.md. Fora de escopo já decidido: restaurar
  sessões no boot, fork no grupo, renomear pelo grupo (é a 004), busca no grupo,
  `%` de contexto na linha (é a 006), reconciliação periódica com o disco.

## Checkpoint

Ao fechar o Batch A (T706) siga direto para o B. Ao fechar a feature (ou ao
travar), PARE e dê um relatório curto: o que passou, o que ficou vermelho com a
saída REAL, os números medidos, e o que precisa de decisão dele. Ao final,
atualize `specs/007-favoritos-sessoes/tasks.md` e o vault
(`Projects/donel-dev/context.md` §Status + `todo.md`).

Comece confirmando em uma linha qual task vai atacar e o teste que vai escrever
primeiro.
```
