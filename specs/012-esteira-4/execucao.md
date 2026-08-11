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

---

## 1. Estado no momento de escrever

| Fato | Situação |
|---|---|
| `design-system/` apagado do working tree (100 arquivos) | **restaurado em 11/08** (`git restore`) — nada builda sem ele |
| PR **#54** (A-1 `artifact.recorded` + A-2 estado `Abandonado`) | **aberto**, esperando merge |
| `specs/012-esteira-4/design.md` | 🟡 **trava a rodada**: `[P-E]` e `[P-F]` esperando o dono |
| `catalogo.md`, `motor.md`, `conversa.md`, `layout-esteira.md` | 🟢 fechadas e mergeadas |
| `wi-esteira4-catalogo-fases`, `wi-esteira4-motor-spec` | ainda `in-progress` no store, **embora as specs já tenham mergeado** |
| Branch atual | `feature/esteira4-a1-a2` |

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

### Onda 0 — destravar (antes de qualquer item)

- [x] `git restore design-system/` — feito em 11/08
- [ ] **`pretypecheck`** no `package.json` raiz (`npm run build -w @donel-dev/design-system`).
      `design-system/dist` ausente quebrou o typecheck em 3 batches distintos;
      é o menor conserto com o maior retorno da lista
- [ ] Fechar `[P-E]` e `[P-F]` da `design.md` → status 🟢 · **decisão do dono**
- [ ] Merge do **PR #54**
- [ ] Declarar `done` os itens `wi-esteira4-catalogo-fases` e
      `wi-esteira4-motor-spec` (dívida de contrato: a spec mergeou, o store não soube)

### Onda 1 — 3 frentes em paralelo

| Frente | Item | Tam. | Por que aqui |
|---|---|---|---|
| **E** | `wi-esteira4-autostart-enter` | P | O bug fundador: **sem o Enter nenhuma onda seguinte roda sozinha**. Hipótese registrada no discovery — `armEsteiraAutoStart` escreve o comando mas não o `\r`. **Verificar no alfa instalado, não assumir** |
| **P1** | `wi-esteira4-pacote-portatil` | M | Pacote em `docs/esteira-dev/` + inversão da fonte do contrato. Toda a trilha P depende |
| **G** | `wi-esteira4-formato-grafo` | P | É **spec**, não código — sessão de conversa, em paralelo. Destrava 2 itens do motor |

**Gate 1:** o Enter funciona *no alfa instalado* (verificado, com evidência) **e**
o molde do `esteira.grafo` foi aprovado pelo dono.

### Onda 2 — 2 frentes

| Frente | Item | Tam. | Nota |
|---|---|---|---|
| **M1** | bloco `ships_with`, nesta ordem: `worktree-por-card` → `headless` → `fila-percorre-grafo` → `gate-barato` | G | **Construção sequencial na mesma branch.** Dois workers na mesma árvore foi o incidente dos commits entrelaçados (A8 / P24-imp, 04/08). A worktree vem primeiro: é a fundação de tudo que vem depois. Ver §7 — decisão pendente sobre fatiar |
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
| 1 | `[P-E]` / `[P-F]` da `design.md` | **nenhum** — trava real, a Onda 0 não fecha sem isso |
| 2 | O `worktree-por-card` sai do bloco `ships_with` e entra sozinho na Onda 1 (PR pequeno e revisável; as frentes seguintes já nascem com árvore isolada), ou o bloco M1 sobe inteiro num PR grande? | **Sai do bloco.** Ele é útil sozinho — resolve A8 e A20, que já custaram commits entrelaçados — e nada em `headless`/`fila`/`gate-barato` exige que suba junto. PR gigante não recebe review de verdade |

---

## 8. Riscos conhecidos desta rodada

- **Auto-hospedar cedo demais.** A Onda 3 roda pelo motor recém-nascido; se a
  fila engasgar, o custo é retrabalho de merge. Mitigação: dispatch manual como
  fallback declarado, e o dono olhando a primeira execução.
- **O bloco M1 é grande.** Ver decisão 2 acima.
- **Flake da suíte sob carga**: 2193/2194, a falha **muda de arquivo entre
  execuções** (timeout de 5 s em spawn de PTY). Isolados, 46/46 verdes. Não
  tratar como regressão sem isolar antes.
- **A trilha P reimplementa regra que a trilha M pode mexer.** O validador
  portátil e o `esteira-check.mjs` compartilham as regras cruzadas do contrato.
  Se o contrato mudar durante a rodada, os dois mudam juntos — no mesmo commit.
