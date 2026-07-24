# Roteiro E2E — rodada 6 (o que mudou desde a tua última validação)

**App instalado atualizado em 2026-07-23 23:11** (commit `b558d3d`). Rode
pelo **atalho "Donel Dev" da Área de Trabalho**, não por `npm run dev`.

> ⚠️ **Estado honesto:** as auditorias foram INTERROMPIDAS a pedido do
> Alexandre antes de fechar o gate (últimos scores: 88 e 87, gate 95).
> Typecheck limpo e 305/305 testes unitários verdes, mas **a suíte de smokes
> não foi re-executada depois do último commit** (`b558d3d`, o guard do
> quick-launch). Trate esta build como "pronta para teste humano", não como
> "auditada". Achados vão para o `feedback-e2e.md` como rodada 6.

## 1. App abre vazio (decisão A)

- [ ] Abrir o app pelo atalho.
- **Esperado:** nenhuma sessão é aberta sozinha; aparece um **empty state**
  ("nenhuma sessão aberta — escolha um projeto ou ＋ Nova sessão").
  Nenhum processo `claude.exe` novo deve nascer só por abrir o app
  (conferir no Gerenciador de Tarefas, se quiser).
- **Por quê:** antes, a aba inicial abria uma sessão na tua pasta home, o
  CLI pedia confiança de pasta, e a toolbar de Modelo/Esforço ficava morta
  pra sempre — o bug que você reportou.

## 2. "＋ Nova sessão" sem projeto NÃO trava

- [ ] Sem ter aberto nenhum projeto, clicar no **corpo** do botão
  "＋ Nova sessão" da barra de título.
- **Esperado:** abre o **painel Lançar sessão** (para você escolher o
  projeto) — e NÃO uma sessão na home. O mesmo vale para o botão do empty
  state.
- **Por quê:** este era o mesmo bug por outro caminho; foi o último fix.

## 3. Modelo/Esforço destravam numa sessão real

- [ ] Abrir um projeto na sidebar (ou lançar pelo painel), digitar um
  prompt trivial (`--model haiku` se preferir economizar), esperar a
  resposta terminar.
- **Esperado:** depois que a sessão responde, os controles de **Modelo** e
  **Esforço** ficam habilitados e trocar de valor injeta o comando na
  sessão viva.
- [ ] Deixar uma aba ociosa sem digitar nada por ~30s.
- **Esperado:** o aviso deve ser honesto — algo como "sessão pronta, digite
  no terminal", **não** "Conectando…" eterno nem um alerta de confiança de
  pasta que não existe.

## 4. Statusbar mostra a conta de NASCIMENTO da aba

- [ ] Com um perfil A ativo, abrir uma sessão. Trocar o perfil ativo para B
  no dropdown. Voltar o foco para a aba antiga.
- **Esperado:** a barra inferior mostra **"Sessão: \<conta com que a aba
  nasceu\>"** (o perfil A), não o perfil ativo global. O badge do topo
  continua mostrando o perfil ativo + a cota (%) — que é a conta que a
  PRÓXIMA sessão vai usar.
- [ ] Abrir uma aba de terminal livre e focar nela.
- **Esperado:** rótulo neutro (terminal não nasce de conta nenhuma).

## 5. Cota visível (fix da rodada 4, revalidar)

- [ ] Abrir o dropdown "Perfis de conta".
- **Esperado:** cada perfil mostra o headroom — **% ou "—"**, nunca a linha
  ausente. Inclusive o perfil "Principal".

## 6. Pendências antigas que você nunca testou

Do roteiro do batch 5, seguem sem validação de ninguém:

- [ ] **Ctrl+C** interrompe um comando em andamento (ex.: `Start-Sleep -Seconds 30`
      num terminal livre).
- [ ] **Teclas especiais**: setas (histórico), Home/End, Ctrl+A/Ctrl+E,
      Backspace/Delete, Tab (autocomplete) — comportamento igual ao Windows
      Terminal, sem o Tab roubar foco da UI.
- [ ] **Colar bloco multilinha** (5+ linhas) dentro de uma sessão claude —
      chega inteiro, sem enviar linha a linha.
- [ ] **Notificação** do Windows aparece atribuída a "Donel Dev".

## Decisões suas ainda em aberto

1. **NFR de RAM**: medido 417–451 MB × budget de 400 MB — re-baselinar
   (~450–500 MB) ou abrir task de otimização.
2. **PR/remoto GitHub** da `feature/mvp-p0` (nada foi pushado).
3. **Restauração de sessões**: você decidiu o critério (as com atividade no
   dia anterior) — falta o ciclo de spec antes de qualquer código.
