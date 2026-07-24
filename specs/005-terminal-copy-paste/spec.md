# Spec — 005 Terminal: copiar/colar/imagem por tipo de sessão

**Status:** rascunho pós-discovery (aguarda `/clarify` → `/plan`)
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
- **CA-2 (claude / sem seleção):** `Ctrl+C` sem seleção numa aba claude
  **não interrompe** (ver C1 para o comportamento exato — no-op recomendado);
  interromper é responsabilidade do `Esc`.
- **CA-3 (claude / colar texto):** `Ctrl+V` numa aba claude escreve o texto
  do clipboard no PTY (multilinha inclusa — item do batch-5).
- **CA-4 (claude / colar imagem):** `Ctrl+V` (ou o evento `paste`) com imagem
  no clipboard entrega a imagem ao claude CLI de forma que ele a reconheça
  (equivalente a `[Image #N]`) — **depende do SPIKE-1**.
- **CA-5 (claude / Esc):** `Esc` interrompe a geração/execução do claude
  (hoje o `Esc` já desce cru e o CLI o trata; validar que continua após
  introduzir o handler custom).
- **CA-6 (shell):** numa aba `sessionType==='shell'`, `Ctrl+C` continua
  matando o processo e `Ctrl+V` mantém o comportamento atual — **zero
  regressão** no terminal livre.
- **CA-7 (compat):** `Ctrl+Shift+C`/`Ctrl+Shift+V` continuam copiando/colando
  (não quebrar o hábito atual enquanto o novo é aprendido).

## Spikes e decisões

- **[S1] (crítico) Como entregar a imagem colada ao claude CLI dentro do
  ConPTY.** É o gotcha do B6. Investigar o contrato: o Windows Terminal
  repassa o evento e o CLI lê o clipboard nativamente? Ou o app precisa
  (a) salvar a imagem num arquivo temp e inserir o caminho, (b) inserir um
  marcador, (c) reencaminhar a sequência crua que o CLI espera? **Sem fechar
  este spike, US-C/CA-4 não fecham.** Testar num app instalado (não só dev).
- **[C1] `Ctrl+C` sem seleção (aba claude):** no-op silencioso (recomendado) ×
  beep × fallback para enviar `\x03`. O Alexandre disse "`Ctrl+C` sempre
  copia" e "matar processo fica só no Esc" → recomendação: **no-op** quando
  não há seleção (nunca envia SIGINT em aba claude).
- **[C2] Ponto de interceptação:** `term.attachCustomKeyEventHandler` (ainda
  não usado) ramificando pela prop `sessionType`, decidindo copiar/colar vs
  repassar ao PTY. Confirmar no `/plan`.
- **[C3] Escopo das "teclas especiais nunca testadas"** (batch-5): setas,
  Home/End, PgUp/PgDn, Del — entram nesta spec (garantir que descem ao PTY) ou
  ficam num smoke à parte?
- **[C4] Extras do B7 (opcionais):** copy-on-select, menu de contexto (botão
  direito) com Copiar/Colar, seleção que sobrevive a output novo. O Alexandre
  **não** pediu explicitamente — manter fora salvo decisão no clarify.
- **[C5] Atalhos configuráveis:** hard-code por ora (não há schema) × estender
  `config-store.ts`. Recomendação: hard-code nesta entrega.

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
