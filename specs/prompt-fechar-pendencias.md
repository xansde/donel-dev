# Prompt de handoff — fechar as pendências antes do Modo Dev

Gerado em 2026-07-26, depois de: 004/005/006/007 mergeadas em `feature/mvp-p0`,
0.1.0 publicada para colegas, **CA-7 aceito** por ele e **PR #1 fechado** (era
coisa velha, 47 commits, título de duas entregas).

**Decisão dele que define o escopo (26/07):** das três frentes em paralelo do
roadmap, ele quer **duas** — consertar os testes (§B19) e a sessão fixada órfã
(T710). A terceira, **§B18 (primeira abertura na máquina de outra pessoa), fica
FORA**: ele mandou o app para um amigo testar e disse *"é só mais pra frente.
Pode ignorar esse."*

O objetivo declarado: *"organizar essas 2 demandas e me enviar um e2e final para
testar tudo junto e irmos para o modo dev com tudo tinindo sem pendências."*

---

Colar o bloco abaixo numa sessão nova aberta em `C:\Users\xansd\seazone\donel-dev`.

```
Sessão de PLANEJAMENTO e depois execução de duas pendências do Donel Dev, para
fechar tudo antes de abrir o Modo Dev. Repo: C:\Users\xansd\seazone\donel-dev ·
branch feature/mvp-p0 (já é a de trabalho, e está em sincronia com o origin).

O arco desta sessão: planejar as duas → PARAR e me mostrar o plano → implementar
depois do meu OK → verificar → empacotar → me entregar UM roteiro de E2E que
teste tudo junto. Planejamento você toca sozinho; execução espera meu OK.

## As duas demandas (e a que está FORA)

1. **§B19 — a suíte de smokes não é válida fora da pasta `donel-dev`.**
   5 specs falham deterministicamente quando a suíte roda de uma worktree. É
   falha de TESTE, não de produto, e deixa o gate do modelo de lote parcialmente
   cego — que é justamente como a 005 e a 007 foram feitas, e vai ser usado de
   novo.
2. **T710 — esquecer a entrada órfã quando a retomada falha.**
   Segundo momento do CA-11 da 007. A primeira metade (órfã some na semeadura)
   está implementada; esta não.
3. **FORA DE ESCOPO, por decisão dele em 26/07: §B18** (pastas-raiz padrão,
   texto fixo do empty state, falta de diálogo "Procurar…"). Não implemente, não
   "aproveite que está ali". Se encostar nisso, anote e siga.

## Passo 0 — Estado (bloqueante)

    cd C:\Users\xansd\seazone\donel-dev
    git status --short        # tem de estar LIMPO
    git fetch origin
    git log --oneline -3      # HEAD esperado: 748562b ou depois

Árvore suja → PARE e pergunte. **Nunca `git add -A`** neste repo: já teve duas
sessões escrevendo na mesma árvore, e um `-A` distraído commita trabalho alheio.

## Passo 1 — Leia antes de planejar

1. `specs/backlog.md` **§B19** — o mecanismo do bug já está diagnosticado e
   escrito, com os arquivos e as linhas. Não rediagnostique.
2. `specs/007-favoritos-sessoes/spec.md` **CA-11** (os dois momentos em que a
   órfã "some") e `tasks.md` linha do **T710** (o que ficou e por quê).
3. `tests/smoke/favorite-sessions.spec.ts` linhas 20–27 — **a referência a
   copiar** no §B19: `PROJECT_NAME = path.basename(REPO_ABS_PATH)`, com o
   comentário explicando por que é calculado.
4. `CLAUDE.md` do repo · `specs/backlog.md` §B11 (vermelhos conhecidos) e §B14
   (as duas instalações — instalar é ato DELE, nunca seu).

## Passo 2 — Planeje as duas (você toca sozinho)

Escreva `specs/008-fechar-pendencias/plan.md` + `tasks.md`.

**Não crie `spec.md` nova.** Os requisitos já existem e estão aprovados: o CA-11
na spec da 007 e o §B19 no backlog. Inventar spec aqui é cerimônia que atrasa sem
decidir nada. Se durante o plano você achar que falta requisito de verdade,
diga — não preencha por conta.

### O que o plano do §B19 precisa resolver

O mecanismo, já verificado (§B19): os specs semeiam a fixture `.jsonl` num
diretório derivado da PRÓPRIA pasta (`slugify(resolve(__dirname/../..))`, que numa
worktree dá `...-donel-dev-wt-005`), mas localizam o projeto na sidebar por **nome
hardcoded** `'donel-dev'` com `exact: true`. Como o scanner varre `~/seazone`, a
pasta `donel-dev` de verdade TAMBÉM aparece na sidebar da worktree — o clique acha
um projeto, só que o **errado**, e a lista volta com 0 linhas.

Nomeados no §B19: `session-rename.spec.ts:120` ·
`session-rename-live.spec.ts:80,82` · `session-context.spec.ts:97,99`.

**Mas o plano tem de auditar TODOS os specs que hardcodam o nome** e classificar
cada ocorrência, porque elas não são todas o mesmo caso:

- **semeia fixture no próprio `SESSIONS_DIR`** → obrigatoriamente calculado;
- **só precisa de "um projeto qualquer" na sidebar** (ex.: `model-injection.spec.ts:68`,
  `profiles.spec.ts:127`, `empty-state.spec.ts:152`) → funciona hardcoded hoje,
  mas calcular deixa o spec honesto em qualquer pasta;
- ⚠️ **ARMADILHA — não troque:** `config-persistence.spec.ts:158` usa
  `'donel-dev'` como pasta do **APPDATA** (`%APPDATA%\donel-dev\config.json`).
  Ali `donel-dev` é o nome do APP (o `name` do package.json que o Electron usa
  para o `userData`), não a pasta do repo. Trocar por `basename` quebra o spec
  em qualquer worktree. Mesmo cuidado com qualquer outra ocorrência que se
  refira ao app, não ao projeto escaneado.

Onde o helper deve morar: o §B19 sugere derivar o nome no **mesmo helper que já
calcula o `SESSIONS_DIR`**, para as duas coisas nunca divergirem. Decida no plano
se isso vira um módulo compartilhado em `tests/smoke/` ou fica duplicado por spec
(os smokes hoje duplicam constantes de propósito, para não importar de `src/` —
respeite o padrão que encontrar e explique a escolha).

### O que o plano do T710 precisa resolver

A pergunta aberta é **como detectar "a retomada falhou"** — e ela não pode ser
respondida por chute. O T710 ficou de fora justamente porque exigiria "inventar o
texto de erro do CLI para sessão inválida, não verificado contra o binário real".

Então o plano começa com uma **investigação obrigatória, contra o binário**:
rode `claude -r <uuid-que-não-existe>` dentro de uma pasta de projeto e registre
o que acontece de fato — o que imprime, o **exit code**, e em quanto tempo sai.
Grave o resultado num arquivo de medição (`specs/008-fechar-pendencias/`), como
foi feito no `medicao-t403.md` e no `medicao-ca7.md`.

Hipótese a confirmar ou derrubar com esse dado: o sinal robusto é o
**`PtyManager.onExit` com código != 0 pouco depois do spawn de uma sessão com
`-r`**, não o parse do texto (texto de CLI muda sem aviso; exit code é contrato).
Se a investigação mostrar que exit code não distingue os casos, diga — e proponha
o menor sinal confiável que existir, sem inventar.

Verifique também se o canal `sessions:forget` já existe ou precisa nascer, e
lembre do padrão dos **QUATRO pontos** do `config-store.ts` se mexer em chave de
config (esquecer um faz a chave ser silenciosamente descartada na leitura — foi
armadilha real na 004).

`TerminalPane.tsx` está **livre** agora: era o bloqueio do T710 (arquivo da 005,
que já mergeou).

## Passo 3 — GATE: pare e me mostre

Ao fechar o plano, **PARE**. Me mande, curto:
- o que cada demanda vai mexer (arquivos), e o que a investigação do CLI achou;
- o que você decidiu sobre o helper do nome e sobre o sinal de falha de retomada;
- qualquer requisito que você achou faltando.

**Não comece a implementar antes do meu OK.** (Planejar sozinho é o combinado;
executar sem gate, não.)

## Passo 4 — Implementar (depois do OK)

- **TDD nos módulos puros**: teste falhando primeiro, implementação mínima,
  refatora. Vale para a decisão de "esquecer a entrada" — ela deve ser função
  pura testável, não lógica solta no componente.
- `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
- Smokes exigem `npm run build` ANTES (eles rodam `out/main/index.js`).
- Commit por task ou batch, Conventional Commits (tipo em inglês, descrição em
  português), **por caminho explícito**. Commitar é DEFAULT — não pergunte.

## Passo 5 — Verificar (é aqui que o §B19 se prova)

O §B19 só está consertado se a suíte passar **nos dois lugares**:

1. **Na pasta principal** — `npm run build && npm run typecheck && npm test`,
   depois `npm run test:smoke` e `npm run test:smoke:dev`.
2. **De uma worktree** — crie uma descartável, ex.
   `git worktree add ../donel-dev-wt-check HEAD` (precisa de `npm install` lá
   dentro por causa do `electron-rebuild` do `node-pty`, e de `npm run build`),
   rode a suíte de smokes DE LÁ e mostre os 5 specs passando. Remova a worktree
   depois. **Sem esta segunda execução, o conserto não foi verificado** — foi
   escrito.

Vermelhos esperados, com causa já nomeada (declare, não mascare): 2 de
`previous-sessions.spec.ts` (dívida T013) e o intermitente do §B15. Os dois que
estavam bloqueados por **cota semanal esgotada** (`model-injection.spec.ts` e
`terminal.spec.ts:281`) — **tente de novo**: a janela pode ter virado. Se
passarem, some do §B11; se falharem com cota folgada, é achado NOVO, investigue.
Qualquer outro vermelho: re-rode o arquivo isolado antes de chamar de regressão.

Não confie em relatório: rode e olhe a saída.

## Passo 6 — Versão e pacote

**Bumpe para 0.2.0** (`package.json`) e escreva a seção 0.2.0 do `CHANGELOG.md`
na linguagem de quem usa. Motivo: a **0.1.0 já está na mão de outra pessoa** (no
Drive dele); publicar coisa diferente com o mesmo número é o que faz alguém dizer
"estou na 0.1.0 e não tem esse botão" e ninguém saber quem está certo.

`npm run build && npm run dist` → instalador em `release/`. **Instalar é ato
DELE** — avise pelo §B14 que o instalador all-users substitui
`C:\Program Files\Donel Dev` (o app de trabalho) e que o
`%LOCALAPPDATA%\Programs\Donel Dev` de 23/07 é o ponto de retorno.

**Não republique no Drive.** Isso é decisão dele, depois do E2E aprovado
(`npm run publicar` está pronto para quando ele quiser).

## Passo 7 — O E2E final, que é o que ele pediu

Escreva **UM** roteiro: `specs/roteiro-e2e-fechamento.md`. Requisitos do formato,
tirados do que funcionou nos anteriores:

- **Um roteiro só, numa sessão de app**, com passos numerados e o resultado
  esperado escrito ao lado de cada um. Ele roda de uma vez, não em duas rodadas.
- **Ordene para a cota ser gasta UMA vez**: os passos que exigem turno real do
  modelo vêm agrupados, servidos por uma única execução longa. Marque
  explicitamente quais passos precisam de cota e quais não.
- **Cobertura:** o novo (T710) + regressão do que ele usa todo dia, porque este
  é o build que vai substituir o app de trabalho dele:
  - **T710** — sessão fixada cuja retomada falha sai da lista;
  - **007** — favoritar, grupo colapsável, 5 recentes + fixadas além das 5,
    clique focando aba aberta × retomando, cabeçalho acendendo com grupo fechado;
  - **005** — `Ctrl+C` sem seleção em aba de sessão NÃO derruba a execução,
    `Esc` interrompe, `Ctrl+C` em aba de terminal livre interrompe, colar texto
    multilinha, colar print;
  - **004** — `/rename` refletindo na aba ao vivo;
  - **006** — `contexto NN%` subindo.
- Deixe explícito, no fim, **o que ficou sem validação humana** e por quê.

## Fronteiras (inegociáveis)

- **`main`: BLOQUEIO TOTAL.** Nada de push/PR/merge sem instrução literal dele.
  É o canal do app que ele usa para trabalhar.
- **Não abra PR nenhum.** Ele fechou o #1 em 26/07 (era coisa velha e inútil) e
  não pediu outro. Abrir PR exige instrução literal.
- Push na `feature/mvp-p0`: autorizado.
- Nunca `--no-verify`. Nunca `git add -A`.
- O app não toca credenciais: `/login` é sempre ato humano no terminal.
- LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
- Não implemente nada fora do plano aprovado. Apareceu algo? Anota no
  `specs/backlog.md` e segue.

## Encerramento

Relatório final ÚNICO e curto: o que cada demanda entregou, a saída REAL das duas
execuções da suíte (pasta principal e worktree), o que a investigação do CLI
achou, o que ficou vermelho e por quê, e o caminho do instalador 0.2.0.

Atualize, por caminho explícito: `specs/backlog.md` (§B19 fechado), o `tasks.md`
da 007 (T710), `docs/roadmap.html` (as duas frentes viram resolvidas — o arquivo
tem um campo `done: true` por task) e o vault
(`Projects/donel-dev/context.md` §Status + `todo.md`).

Comece confirmando em uma linha: o estado do Passo 0 e qual das duas você vai
planejar primeiro.
```
