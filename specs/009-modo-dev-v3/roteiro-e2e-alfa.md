# Roteiro E2E — leva noturna da 009 (Modo Dev v3) no alfa

**Data da leva:** noite de 29→30/07/2026 · **Canal:** alfa (`staging`)
**Cadeia de PRs (mergear NESTA ordem):** #4 (base: fixes CA-22/29 + docs) → #5 (aba v3) →
#6 (fontes v3) → #7 (engrenagem) → #8 (gh CLI) → #9 (elegibilidade) → #10 (extensões DS) →
#11 (mapa) → #12 (painel/header/reiniciar) → #13 (novo projeto + este roteiro).
Cada PR retargeta sozinho quando a base anterior for mergeada e deletada.
**Atalho sem merge:** `git checkout feat/009-lote-09-novo-projeto` já contém tudo.

## 0. Preparação

1. Mergear a cadeia (ou usar o atalho acima) e, do checkout resultante:
   `npm install && npm run dist:alfa` → instalar o "Donel Dev Alfa".
2. Para os testes do mapa (passos 5-8) é preciso um card v3 no disco. Duas opções:
   - **Fixture**: copiar o layout que os smokes usam (ver `tests/smoke/dev-mode-espelho.spec.ts`,
     seed em `~/.claude/esteira-state/<slug>/<card>/...` conforme contrato §D) — os smokes
     são a referência viva do formato;
   - **Real**: rodar um card pela esteira v3 num repo-alvo e apontar o app para ele.
3. O gate automático da leva já passou (typecheck + 1051 vitest + smokes por lote);
   este roteiro cobre o que máquina não prova: olho, gosto e fluxo real.

## 1. Aba v3 (PR #5 — CA-26/27/28)

- [ ] Abrir 2-3 sessões: a aba mostra **ícone** de estado (▶ trabalhando pisca · ◐ esperando ·
      `!` permissão pisca · ■ concluída · ✕ erro) no lugar do farol antigo.
- [ ] **Clique direito** na aba → menu de 4 cores → a faixa de 2px no topo muda na hora.
- [ ] Arrastar a aba pela alça **⣿** → ordem muda.
- [ ] Fechar e reabrir o app → cor persiste na sessão retomada.

## 2. Fontes v3 (PR #6 — invisível de propósito)

- [ ] Sem nenhum handoff v3 no disco: Modo Dev abre sem erro, sem valor fabricado.
- [ ] Com fixture v3: a árvore nasce dos `plan_cards[]` da raiz nova
      (`~/.claude/esteira-state/…`). A raiz antiga `<repo>/.esteira/` é ignorada.

## 3. Engrenagem do projeto (PR #7 — CA-23)

- [ ] Sessões anteriores → **engrenagem** ao lado do título → painel lateral com
      Workspace ID · Team ID · Repositório GitHub.
- [ ] Salvar → conferir `~/.claude/esteira-config/donel-board-credential.json`
      (IDs gravados, **`token` intocado**) e `repos.json` (entrada com `github`, `path` preservado).
- [ ] Reabrir o app → valores lá. O token **nunca** aparece na tela.

## 4. GitHub por gh (PR #8 — CA-3/5)

- [ ] Com `gh` autenticado + fixture com `spec_issue`: o painel direito (passo 7) mostra o PR da fase.
- [ ] Renomear temporariamente o `gh.exe` (ou tirar do PATH) → app abre normal, seção de PR
      simplesmente omitida. Devolver o `gh` depois.

## 5. Elegibilidade + Trocar… (PR #9 — CA-1/2)

- [ ] Modo Dev sem discovery em foco → modal **"Abrir ou trocar discovery"** abre sozinho,
      com filtro por texto e colunas (backlog + discovery/plano/implementar/validar/documentar).
- [ ] Escolher card **já vinculado** → o discovery existente entra em foco **sem disparo novo**
      (conferir no Gerenciador de Tarefas: nenhum `claude.exe` extra).
- [ ] Com discovery em foco, "Trocar…" reabre o modal.

## 6. O mapa (PRs #10+#11 — CA-7..16)

- [ ] Mapa à **esquerda (480px)** · terminal no centro · detalhe à **direita (316px)**. Card de **392px**.
- [ ] Carrossel **vertical** de até 4 níveis (Discovery · Plano · Implementação · Validação):
      nível focado alto (402px nos planos), demais 206/124px; vizinhos translúcidos (34% · 22%).
- [ ] Setas `‹ ›` e contador "N de M" **só** quando o nível tem 2+ cards. Um plano com 2+ fases
      (PRs) vira carrossel horizontal na Implementação/Validação.
- [ ] Trilha do card: etapas já rodadas + a próxima; **"⌁ Preparar" só na próxima**; comando
      armado usa `--fase=n`. Clicar em etapa passada retoma a sessão arquivada.
- [ ] A fileira de botões de fase da faixa central **não existe mais**; "＋ Nova sessão" não
      aparece em Modo Dev; a legenda do rodapé do mapa **saiu**.
- [ ] Etiquetas do card de plano: no máximo 4 (coluna do board · trava · atenção · prazo curto).
      URL de PR e "sem aprovação" **não** existem mais.
- [ ] **Relógio de homologação** no card de Validação (merge < 24h): horário-limite em mono +
      barra de 4px + relativo + frase. Degrau urgente com card fora de foco → versão compacta
      **na barra de status** (e some do card — promoção, nunca duplicação).

## 7. Painel direito + header (PR #12 — CA-18..21, 24, 25)

- [ ] **Header de 44px** acima do terminal, nos dois modos: breadcrumb
      (`discovery › card › fase` no Modo Dev; nome+path no Uso geral) + StateDot + **"⟳ Reiniciar"**.
- [ ] Painel de 316px por etapa: **Garantia da fase** (tipo/descrição/roteiro) · **PR desta fase**
      (mergeado · homologado · revertido-ciclo) · **Artefatos** · **Recibos de conhecimento** ·
      conta da sessão arquivada. Vazios mostram "sem registro", nunca erro.
- [ ] "⟳ Reiniciar" → modal de confirmação → sessão retoma (`-r`) na **conta ativa** do
      ProfileSwitcher. Trocar de conta antes e conferir o aviso de cópia de transcript.
- [ ] Divergência disco×board **não** acusa mais: card parado em Implementar (v3 normal) e
      card orquestrador de lote ficam quietos.

## 8. Novo projeto (PR #13 — CA-30)

- [ ] **Seletor de projetos no titlebar** (ao lado da marca) → lista com `●` no ativo.
- [ ] "＋ Novo projeto" → modal: Nome · "De onde vem o código" · Pasta local (preview) ·
      Repositório GitHub (opcional). Só **"Começar vazio"** cria nesta leva (Clonar/Pasta
      existente aparecem desabilitados com nota — decisão nomeada no PR).
- [ ] Criar → pasta nasce em `~/seazone/<nome>` com `CLAUDE.md` + `git init`; projeto aparece
      na sidebar e no seletor na hora; nome inválido/duplicado é recusado com mensagem.

## Decisões que ficaram SUAS (não implementadas de propósito)

1. **D-V6** — painel de detalhes no modo Uso geral (mockup ressuscita; você mandou tirar em 27/07).
2. **D-V7** — 3º campo "Base de conhecimento" na engrenagem (recomendação: aceitar).
3. **CA-25 na tela geral** — sem coluna de conta nas sessões anteriores: a junction
   `~/.claude-profiles/*/projects` → `~/.claude/projects` impede duplicata física hoje;
   implementado onde há dado real (mapa/painel). Validar se basta.

## Achados da noite (para não estranhar)

- `dev-mode-espelho.spec.ts` esteve vermelho por banner novo do CLI (família §B22) e voltou
  a verde com a superfície do lote 7. `ca7-measurement` flake de cold-start em suíte cheia
  (§B20) — isolado fica na faixa.
- Pasta `C:\Users\xansd\seazone\donel-dev-control-b22\` é resíduo de worktree de grupo de
  controle (só `node_modules`) — pode apagar.
- O PR do track documental (`documentar-result.json → outputs.pr`) não é exibido — nomeado
  no PR #12, candidato a backlog.
