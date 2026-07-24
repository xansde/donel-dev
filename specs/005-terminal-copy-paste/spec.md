# Spec — 005 Terminal: copiar/colar/imagem por tipo de sessão

**Status:** ✅ clarificada (C1–C5 respondidos em 2026-07-24) + **SPIKE-1 FECHADO**
(`spike-1-imagem-no-conpty.md`). Pronta para implementar — aguarda OK do
Alexandre no gate (`plan.md` + `tasks.md` deste diretório já gerados).
**Prioridade:** a definir pelo Alexandre (fila atual: 002-quota → 003-modo-dev)
**Origem:** entrevista aberta com o Alexandre em 2026-07-24. Consolida
**B6** (colar imagens) e **B7** (copiar texto fácil) do `backlog.md` + os
itens "Ctrl+C, teclas especiais, colar multilinha" nunca testados do roteiro
E2E batch-5.

> **Legenda:** `[D]` discovery (requisito) · `[T]` técnico (`path:linha`) ·
> `[C]` clarify · `[S]` spike obrigatório antes de fechar.

## Problema

1. **[D]** No terminal do Donel, `Ctrl+C`/`Ctrl+V` **não** copiam/colam — o
   Alexandre tem que usar `Ctrl+Shift+C`/`Ctrl+Shift+V`, o que **confunde e
   "muitas vezes interrompe as execuções"** (o `Ctrl+C` manda SIGINT).
2. **[D]** Ele **não consegue colar imagem** do clipboard (print da ferramenta
   dele) direto no terminal — **"faz muita falta"**.
3. **[D]** Referência mental de "funciona certo": **Windows Terminal**.
4. **[T]** `TerminalPane.tsx:337-353` liga a entrada com `term.onData`, que
   repassa **todo byte cru** ao PTY (`window.donel.pty.input`), incluindo o
   `\x03` (ETX) do `Ctrl+C` — por isso ele interrompe. **Não existe**
   `attachCustomKeyEventHandler` nem `term.onKey`, e **nenhum** código de
   clipboard em `src/` (grep por `clipboard`/`getSelection`/`paste` = 0 hits).
   O `Ctrl+Shift+C/V` que "funciona" hoje é o default do Electron/DOM, não
   código do app.
5. **[T]** O tipo de sessão **já existe** e já chega ao terminal:
   `sessionType: 'claude' | 'shell'` (`shared/index.ts:56`, `App.tsx:78`,
   `TerminalPane.tsx:36`), passado como prop em `App.tsx:1068`
   (`sessionType={tab.sessionType}`) e já usado para ramificar UI
   (`App.tsx:1017`). **Ponto de extensão pronto** — não precisa inventar campo.
6. **[T]** Spawn: `sessionType==='claude'` → `claude.exe` (`index.ts:192-229`);
   caso contrário → `powershell.exe` (terminal livre, `pty-manager.ts:73,93`).
7. **[T]** Colar imagem: **nada** hoje. Precisa de listener `paste` novo no
   container do xterm (`TerminalPane.tsx:322`, `containerRef`).
8. **[T]** Não há schema de atalhos configuráveis; os poucos atalhos são
   hard-coded em `App.tsx` (`Ctrl+Tab`, `Ctrl+1..9`, `Esc`-fecha-launcher).

## User stories (todas do discovery)

Comportamento **por tipo de sessão** (decisão do Alexandre):

- **US-A — copiar (aba claude):** como usuário numa aba rodando o claude,
  `Ctrl+C` **copia** a seleção (não interrompe a execução).
- **US-B — colar texto (aba claude):** `Ctrl+V` **cola** texto.
- **US-C — colar imagem (aba claude):** `Ctrl+V` cola **imagem** do clipboard
  (print) direto na sessão, funcionando igual ao Windows Terminal.
- **US-D — interromper (aba claude):** interromper a execução é feito com
  **`Esc`** (não mais com `Ctrl+C`).
- **US-E — shell inalterado:** numa aba de terminal/shell, tudo segue o
  **padrão** — `Ctrl+C` mata o processo (SIGINT), como sempre.

## Critérios de aceite

- **CA-1 (claude / copiar):** com texto selecionado numa aba claude, `Ctrl+C`
  copia para o clipboard e **não** envia `\x03` ao PTY (execução segue).
- **CA-2 (claude / sem seleção):** `Ctrl+C` sem seleção numa aba claude é
  **no-op silencioso** (decisão C1) — **nunca** envia `\x03` em aba claude,
  em nenhuma circunstância. Interromper é responsabilidade exclusiva do `Esc`.
- **CA-3 (claude / colar texto):** `Ctrl+V` numa aba claude escreve o texto do
  clipboard no PTY envolvido em **bracketed paste** (`\x1b[200~` … `\x1b[201~`),
  de modo que multilinha entre como **um bloco colado** (o CLI mostra
  `[Pasted text #N]`) e **não** como N Enters — fecha o item "colar multilinha"
  do batch-5.
- **CA-4 (claude / colar imagem):** `Ctrl+V` com **imagem** no clipboard numa
  aba claude escreve `\x1b\x76` (= `alt+v`) no PTY, e o CLI insere `[Image #N]`
  no input. **SPIKE-1 FECHADO e provado** em ConPTY real: `[Image #1]` em
  ~1,5 s; `\x16` (Ctrl+V cru) não faz nada; sem imagem o CLI responde
  "No image found in clipboard. Use alt+v to paste images". Ver
  `spike-1-imagem-no-conpty.md`. O app **não** salva arquivo temp, **não**
  insere path e **não** manuseia base64 — quem lê o clipboard é o CLI.
- **CA-4b (feedback visual é do CLI):** o `Pasting…` e o `[Image #N]` são
  desenhados pelo próprio CLI. O Donel **não** cria spinner, toast ou
  placeholder próprio para a colagem de imagem.
- **CA-8 (Alt+V não regride):** quem já usa `Alt+V` continua podendo usá-lo —
  o handler intercepta apenas `Ctrl+C`/`Ctrl+V`; `Alt+V` segue descendo cru.
- **CA-9 (teclas especiais não são engolidas):** setas, `Home`/`End`,
  `PgUp`/`PgDn`, `Del`, `Tab`, `Shift+Tab` continuam chegando ao PTY em
  **ambos** os tipos de aba (decisão C3 — regressão coberta no roteiro E2E;
  nenhum código específico para elas).
- **CA-5 (claude / Esc):** `Esc` interrompe a geração/execução do claude
  (hoje o `Esc` já desce cru e o CLI o trata; validar que continua após
  introduzir o handler custom).
- **CA-6 (shell):** numa aba `sessionType==='shell'`, `Ctrl+C` continua
  matando o processo e `Ctrl+V` mantém o comportamento atual — **zero
  regressão** no terminal livre.
- **CA-7 (compat):** `Ctrl+Shift+C`/`Ctrl+Shift+V` continuam copiando/colando
  (não quebrar o hábito atual enquanto o novo é aprendido).

## Spikes e decisões — todos resolvidos (2026-07-24)

- **[S1] ✅ FECHADO — como entregar a imagem ao claude CLI no ConPTY.**
  Resposta: **o CLI lê o clipboard sozinho**; o Donel só precisa acionar o
  keybinding `chat:imagePaste`, que no Windows é **`alt+v` = `\x1b\x76`**
  (`ctrl+v` só vale no WSL). Provado por leitura do binário do CLI (tabela de
  bindings + o próprio `checkImage`/`saveImage` em PowerShell) **e** por teste
  empírico em ConPTY real com node-pty 1.1.0 — a mesma versão que o app
  **instalado** empacota. Nenhuma das hipóteses (a) temp+path, (b) marcador,
  (c) sequência exótica era necessária. Detalhes, tabela de resultados e
  ressalva de método: `spike-1-imagem-no-conpty.md`.
- **[C1] ✅ Resolvido — `Ctrl+C` sem seleção (aba claude): no-op silencioso.**
  Nunca envia `\x03` em aba claude; interromper é só `Esc` (CA-2).
- **[C2] ✅ Resolvido — ponto de interceptação:**
  `term.attachCustomKeyEventHandler` (ainda não usado no repo), ramificando
  pela prop `sessionType` já existente. Confirmado no `plan.md`; a decisão
  técnica de por que **não** usar o evento `paste` do DOM nem `term.onKey`
  está registrada lá.
- **[C3] ✅ Resolvido — teclas especiais entram como teste de regressão.**
  Nenhum código específico (o handler só intercepta `Ctrl+C`/`Ctrl+V` e deixa
  o resto passar cru), mas entram no roteiro E2E desta spec, porque é esta
  entrega que cria o risco de engolir tecla (CA-9).
- **[C4] ✅ Resolvido — extras do B7 ficam FORA** (copy-on-select, menu de
  contexto, seleção persistente). Seguem no backlog B7 para decidir depois de
  uso real.
- **[C5] ✅ Resolvido — atalhos hard-coded** nesta entrega. Não criar schema de
  keybindings em `config-store.ts`. **Também não** mexer em
  `~/.claude/keybindings.json` do usuário (config global, afetaria o claude
  fora do Donel) — ver `spike-1-imagem-no-conpty.md`, consequência 5.

## Fora de escopo

- Keybindings configuráveis pela UI (a menos que C5 decida o contrário).
- Overlay/máscara sobre o output bruto do PTY (é outro item do `todo.md`,
  spec própria).
- Colar imagem em aba **shell** (US-C é só para aba claude).

## Notas de realidade

- Em aba claude, o `Esc` já hoje desce cru pelo `term.onData` e o CLI o trata
  como interromper — a mudança é **parar de mandar `\x03` no `Ctrl+C`**, não
  criar o Esc do zero.
- `sessionType` já é a chave da ramificação: a feature é essencialmente um
  handler de teclado consciente do tipo de aba, não uma reescrita do terminal.
