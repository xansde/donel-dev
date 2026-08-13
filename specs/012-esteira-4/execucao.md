# Execução da Esteira 4.0 — a rodada dos 14 itens

**Criado em 2026-08-11.** Este arquivo é o **handoff da rodada de execução**: ele
existe para que uma sessão nova, sem nenhum contexto de conversa, consiga abrir
e começar a trabalhar. Se algo aqui divergir da conversa que o gerou, **vence
este arquivo** — a conversa não sobrevive ao próximo `/compact`.

**Escopo desta rodada:** os **14 itens `open`** do discovery «Definicao esteira
dev» (`dsc-15a7e7f5-fbb`, 07/08), nos 5 planos que têm item declarado.

**Fora do escopo, por decisão do dono (11/08):** os dois planos que nunca foram
desagregados em item — `pln-esteira4-forma-e-leitura` e
`pln-esteira4-donel-leitor`. Eles começam **depois** que esta rodada fechar.
Não puxe item deles para cá.

> **Achado de 13/08 — quando esses dois começarem, `donel-leitor` vem primeiro.**
> A fase Design de `wi-esteira4-textos-laterais` (o primeiro item de
> `forma-e-leitura` a rodar) entregou mockup e diagrama, e o dono não conseguiu
> usá-los: **o painel mostra o ponteiro do artefato, mas o app não abre o
> arquivo** — não lê `.html` nem `.md`. Mostrar não é abrir; artefato declarado
> que não abre é ponteiro morto, e isso vale para as **seis** fases, não só
> Design. Enquanto o app não souber abrir, revisar texto de tela é polir a parte
> errada: o dono para na porta antes de chegar ao conteúdo. Isso **inverte** a
> ordem que estava suposta entre os dois planos. Os artefatos do item ficam
> prontos e commitados em `feature/wi-esteira4-textos-laterais`, esperando
> revisão — nada a refazer, só a rever, aí sim clicando.

---

## 1. Estado no momento de escrever

| Fato | Situação |
|---|---|
| `design-system/` apagado do working tree (100 arquivos) | **restaurado em 11/08** (`git restore`) — nada builda sem ele |
| PR **#54** (A-1 `artifact.recorded` + A-2 estado `Abandonado`) | **mergeado em 11/08** |
| `specs/012-esteira-4/design.md` | 🟢 **fechada em 11/08**: `[P-E]` (entra com `artifact.recorded`) e `[P-F]` (emenda in-place) decididas pelo dono; emenda aplicada ao `catalogo.md` §3.3 |
| `catalogo.md`, `motor.md`, `conversa.md`, `layout-esteira.md` | 🟢 fechadas e mergeadas |
| `wi-esteira4-catalogo-fases`, `wi-esteira4-motor-spec` | **declarados `done` no store em 11/08** (eventos seq 1211-1212) |
| `pretypecheck` | **no `package.json` raiz desde 11/08** (PR #56) — typecheck builda o design-system antes |

**Nenhum dos 14 itens tem uma linha de código.** O que fechou até aqui foi a
coluna de documento: `layout-esteira-dir`, `conversa-spec`, `design-research`.

---

## 2. O grafo — do store, não de palpite

Extraído de `%APPDATA%/donel-dev/esteira/snapshot.json` (`relations`).

```
catalogo-fases ──> formato-grafo ──┐
                                   ├──> fila-percorre-grafo ═╗
motor-spec ────────────────────────┤                         ║ ships_with
                                   ├──> worktree-por-card ═══╣ (entram
                                   ├──> headless ════════════╣  juntos)
                                   ├──> gate-barato ═════════╝
                                   ├──> fila-de-merge
                                   ├──> laco-teto-3
                                   └──> suite-fim-de-plano

layout-esteira(done) ──┐
                       ├──> solto-conversa ═╗ ships_with
pacote-portatil ──> validador-que-viaja ────┤             ├──> aposentar-21
                       └──> solto-automaticas ═╝

autostart-enter ── (nenhuma dependência de entrada)
```

**`ships_with` não é sugestão: é uma entrega só.** Dois blocos:
`{fila-percorre-grafo, worktree-por-card, headless, gate-barato}` e
`{solto-conversa, solto-automaticas}`.

---

## 3. As quatro trilhas — separadas por ARQUIVO

É a separação por arquivo que faz o paralelismo funcionar. Duas frentes que
tocam o mesmo arquivo não são paralelas: são um conflito marcado para depois.

| Trilha | Itens | Arquivos | Colide com |
|---|---|---|---|
| **E** — o Enter | `autostart-enter` | `src/renderer/src/App.tsx:1262` (`armEsteiraAutoStart`), `src/main/pty-manager.ts` | **M** (caminho de dispatch) |
| **M** — motor | 7 itens | `src/main/esteira-dispatch.ts`, `src/main/esteira-service.ts`, `src/main/esteira/*` (novo), `src/shared/esteira/store/` | **E** |
| **P** — portátil | 5 itens | `docs/esteira-dev/`, `tools/`, `.claude/skills/` — **não toca `src/`** | ninguém |
| **G** — grafo | `formato-grafo` | `specs/012-esteira-4/` | ninguém |

P e G são disjuntas de tudo. E e M compartilham o caminho de dispatch — por
isso **E roda antes, sozinha**.

---

## 4. As ondas

### Onda 0 — destravar (antes de qualquer item) — ✅ FECHADA em 11/08

- [x] `git restore design-system/` — feito em 11/08
- [x] **`pretypecheck`** no `package.json` raiz — PR #56, mergeado; typecheck
      rodado verde com o guarda novo
- [x] Fechar `[P-E]` e `[P-F]` da `design.md` → status 🟢 — decididas pelo dono
      em 11/08: `design` entra em `by-phase-when-done` com `artifact.recorded`;
      emenda ao `catalogo.md` §3.3 aplicada **in-place** (padrão fixado)
- [x] Merge do **PR #54** — 11/08
- [x] Declarar `done` os itens `wi-esteira4-catalogo-fases`,
      `wi-esteira4-motor-spec` e `wi-esteira4-design-spec` no store
      (eventos `work_item.updated` appendados ao `events.jsonl`)

### Onda 1 — 3 frentes em paralelo — ✅ frentes entregues em 11/08

| Frente | Item | Estado |
|---|---|---|
| **E** | `wi-esteira4-autostart-enter` | **PR #59 mergeado.** Hipótese confirmada (texto+`\r` num write único = colagem para o REPL); fix: dois writes com `AUTO_START_ENTER_DELAY_MS = 50`, máquina de 3 fases no watcher, 4 testes novos. 2196 verdes na worktree |
| **P1** | `wi-esteira4-pacote-portatil` | **PR #60 mergeado.** Contrato v1 movido para `docs/esteira-dev/contract/v1/` (git mv), fork e 10 testes repontados, teste de unicidade novo, bundle provado sem referência ao caminho antigo |
| **G** | `wi-esteira4-formato-grafo` | **PRs #58 + fechamento mergeados.** Molde **aprovado pelo dono em 11/08** — `[G-1]`…`[G-6]` viram requisito; spec 🟢 |

Integração verificada pelo orquestrador na staging: typecheck limpo,
**2198/2198 testes verdes** (11/08).

**Gate 1:** o molde foi aprovado ✅; o Enter *no alfa instalado* aguarda a
**bateria manual do dono** (roteiro entregue em 11/08) — a Onda 2 só começa
depois do OK dele.

### Onda 2 — 2 frentes

| Frente | Item | Tam. | Nota |
|---|---|---|---|
| **M1** | bloco `ships_with`, nesta ordem: `worktree-por-card` → `headless` → `fila-percorre-grafo` → `gate-barato` | G | **Construção sequencial na mesma branch, e um PR só** (decisão 2 do dono, 13/08 — ver §7). Dois workers na mesma árvore foi o incidente dos commits entrelaçados (A8 / P24-imp, 04/08). A worktree vem primeiro: é a fundação de tudo que vem depois. Como o PR é grande, **os commits precisam ser atômicos e na ordem de construção** — é o review commit a commit que substitui o PR pequeno |
| **P2** | `wi-esteira4-validador-que-viaja` | M | `tools/check.py` autocontido com as regras cruzadas. Porta o que `scripts/esteira-check.mjs` faz hoje, sem depender de `npm` do donel-dev |

**Gate 2 — o ponto de virada:** a fila anda sozinha num plano de brinquedo.
**A partir daqui a rodada pode se auto-hospedar.**

### Onda 3 — 3 frentes, já rodando pelo motor novo

| Frente | Item | Tam. | Nota |
|---|---|---|---|
| **M2** | `fila-de-merge` → `laco-teto-3` | M | Sequenciais **entre si**: mesmo motor, mesmos arquivos |
| **M3** | `suite-fim-de-plano` | P | Disjunto (scripts/CI) — paralelo seguro com M2 |
| **P3** | bloco `ships_with`: `solto-conversa` + `solto-automaticas` | G | Uma entrega. As seis fases rodando em terminal qualquer |

**Gate 3:** um plano inteiro de ponta a ponta, headless, com merge na ordem
declarada pelo Plano.

### Onda 4 — 1 frente

| Frente | Item | Nota |
|---|---|---|
| **P4** | `wi-esteira4-aposentar-21` | Só depois de as fases soltas rodarem de verdade. Aposentar antes é ficar sem esteira nenhuma |

### Onda 5 — fechamento: **jogar no alfa**

Pedido explícito do dono (11/08): a rodada **termina no alfa instalado**.

```
npm test && npm run typecheck
npm run dist:alfa
# instalar per-user, silencioso:
#   <instalador>.exe /S /currentuser
```

- O alfa é liberado sem pedir permissão (decisão dele; ver memória
  `feedback_alfa_sem_permissao`): merge em `staging`, `dist:alfa` e instalar na
  máquina dele são autônomos.
- **`main` e o repo público seguem no bloqueio total** — só com instrução
  literal.
- Conferir o `app.asar` por marcador antes de declarar instalado.
- **Higiene enquanto o B10 não existe:** um canal aberto por vez. Stable, alfa e
  beta dividem `config.json`, e o canal mais antigo apaga em silêncio a chave que
  só o novo entende. Canal se confere por **path do executável**, nunca por
  título de janela.

---

## 5. Regras de execução (não negociáveis nesta rodada)

1. **Worktree por frente, sempre.** Uma branch por frente; nunca duas sessões na
   mesma árvore. Até `worktree-por-card` existir, é gesto manual.
2. **`git fetch origin` antes de criar a branch.** Uma branch já nasceu 660
   commits atrás por não fazer isso.
3. **Typecheck após CADA merge de frente.** Os 4 conflitos silenciosos de 05/08
   (git auto-mergeou errado) eram todos fixture que não conhecia campo novo do
   contrato — só o typecheck acusou.
4. **Ondas 1→2 rodam no modelo atual** (esteira 3.0, uma sessão por item,
   dispatch pelo app). **Onda 3 em diante roda pela fila nova** — é o primeiro
   teste real do motor, feito pelo próprio motor, com o dono olhando e o
   dispatch manual como fallback.
5. **TDD no escopo dele**: motor, validador e módulos puros nascem com teste
   antes. Spike e script exploratório, não.
6. **PR contra `staging` é livre para o Claude**, sem pedir confirmação. **Merge
   é sempre decisão humana.**
7. **Nunca `--no-verify`.**
8. **Blocos grandes de código vão por Write/Edit, nunca por heredoc do bash** —
   foi o que matou o batch N2 da 1ª rodada de 05/08.

---

## 6. Ordem de leitura para quem chega sem contexto

1. Este arquivo.
2. `specs/012-esteira-4/catalogo.md` — as seis fases e o grafo canônico.
3. `specs/012-esteira-4/motor.md` — a máquina de estados da fila (8 estados,
   incluindo `Abandonado`).
4. `specs/012-esteira-4/layout-esteira.md` — o `.esteira/` como canal entre fases.
5. `specs/012-esteira-4/conversa.md` — os dois gates de gente (HITL × AFK).
6. `specs/012-esteira-4/design.md` — 🟡, e o que ela trava.
7. `CLAUDE.md` (raiz) — canais, regra dura de `main`, política de review.

---

## 7. Decisões pendentes do dono

| # | Decisão | Default assumido se não houver resposta |
|---|---|---|
| 1 | ~~`[P-E]` / `[P-F]` da `design.md`~~ **FECHADA em 11/08**: `[P-E]` → entra em `by-phase-when-done` com `artifact.recorded` (recomendação da spec acatada); `[P-F]` → edição in-place com proveniência na legenda (padrão para as próximas emendas) | — |
| 2 | ~~O `worktree-por-card` sai do bloco `ships_with`?~~ **FECHADA em 13/08 pelo dono: FICA no bloco.** M1 sobe inteiro, num PR só | — (ver abaixo) |

**Decisão 2 — o raciocínio, porque ele muda a régua de fatiar PR nesta rodada.**
O default assumido era "sai do bloco", por review: PR gigante não recebe review
de verdade. O dono decidiu o contrário, e por um eixo que o default não pesava:
**cada PR que entra custa uma rodada de validação MANUAL dele** — a bateria do
Enter de 13/08 é o exemplo vivo (7 disparos, cada um uma sessão real). Fatiar
não dobra só o review: dobra a bateria. Ele prefere um teste grande de uma vez.

Some-se a isso o que a §3 já dizia e o default ignorava: os quatro itens de M1
moram nos **mesmos arquivos** (`esteira-dispatch.ts`, `esteira-service.ts`,
`src/main/esteira/*`). Fatiar não eliminaria o conflito de território — adiaria,
cobrando um rebase e um segundo review sobre o mesmo código.

**O que isso obriga, já que o PR será grande:** commits atômicos e legíveis na
ordem de construção (`worktree-por-card` → `headless` → `fila-percorre-grafo` →
`gate-barato`), para o review acontecer commit a commit em vez de num diff só.
A regra nº 1 (worktree por frente) continua **manual** durante toda a Onda 2 —
a automação dela só chega no fim do próprio bloco.

---

## 8. Riscos conhecidos desta rodada

- **Auto-hospedar cedo demais.** A Onda 3 roda pelo motor recém-nascido; se a
  fila engasgar, o custo é retrabalho de merge. Mitigação: dispatch manual como
  fallback declarado, e o dono olhando a primeira execução.
- **O bloco M1 é grande, e vai subir grande** (decisão 2, fechada em 13/08). O
  risco não sumiu, mudou de dono: um PR grande esconde defeito no meio do diff.
  Mitigação declarada: commits atômicos na ordem de construção, typecheck e
  suíte verdes a cada commit (não só no fim), e a bateria manual do dono como
  gate único no fechamento — que é exatamente o que ele quis comprar ao não
  fatiar.
- **Flake da suíte sob carga**: 2193/2194, a falha **muda de arquivo entre
  execuções** (timeout de 5 s em spawn de PTY). Isolados, 46/46 verdes. Não
  tratar como regressão sem isolar antes.
- **A trilha P reimplementa regra que a trilha M pode mexer.** O validador
  portátil e o `esteira-check.mjs` compartilham as regras cruzadas do contrato.
  Se o contrato mudar durante a rodada, os dois mudam juntos — no mesmo commit.
