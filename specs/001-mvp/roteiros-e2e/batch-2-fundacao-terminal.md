# Roteiro E2E — Batch 2: Fundação (T003–T006)

## O que este batch entregou

Scaffold Electron+React+Vite com o design-system como workspace local
(T003); `PtyManager` + xterm numa aba com IPC (T004); spawn do `claude`
dentro da aba, com resolução do executável (PATH → `~/.local/bin`) e aviso
de "não encontrado" (T005, CA-5); `CommandBuilder` puro coberto por testes
automatizados (T006). Módulos principais: `src/main/pty-manager.ts`,
`src/main/claude-executable.ts`, `src/shared/commandBuilder.ts`,
`src/renderer/src/TerminalPane.tsx`.

**O que este roteiro cobre:** a automação (vitest) já garante o mapeamento
de flags do `CommandBuilder` — não repita isso aqui. Este roteiro foca no
que só um humano percebe: **qualidade visual e comportamento do terminal de
verdade** (cores, teclas, Ctrl+C, colar multilinha, resize, scrollback) —
tudo listado como "Não verificado" pelo contexto do batch.

## Pré-requisitos

```powershell
cd C:\Users\xansd\seazone\donel-dev
npm install
# só se o Electron não tiver o binário baixado (checar antes):
#   Test-Path node_modules\electron\dist  → se $false, rodar:
# node node_modules/electron/install.js
npm run dev
```

O comando `npm run dev` deve abrir a janela do Donel Dev. Deixe-a aberta
para os passos abaixo.

## Custos

O passo 3 abre uma sessão `claude` real dentro da aba. Use
`--model haiku` (ou o default do launcher, se ele já tiver essa opção neste
batch — senão, spawn manual) e prompts triviais. Não é necessário gerar
trabalho real do agente para validar o terminal.

## Segurança

Nenhum passo deste roteiro pede login ou credencial — o batch 2 ainda não
tem perfis (isso é batch 4). Se uma sessão pedir `/login` inesperadamente,
é sinal de que a conta padrão da máquina não está autenticada — resolver
via `/login` normal, nunca digitando senha em outro lugar.

## Passos

### 1. App sobe e mostra o shell

- [ ] **Ação:** `npm run dev` (se ainda não estiver rodando).
- **Resultado esperado:** janela do Electron abre em menos de alguns
  segundos, sem erro no terminal onde rodou o comando; layout do shell
  aparece (mesmo que sidebar/launcher ainda não estejam completos neste
  batch — isso é batch 3). Um componente do design-system deve estar
  visível (confirma a integração do workspace, DoD do T003).

### 2. Terminal PowerShell interativo — sanidade rápida

- [ ] **Ação:** abrir uma aba de terminal comum (PowerShell) dentro do app
  e rodar `dir`.
- **Resultado esperado:** lista o conteúdo do diretório corretamente, com
  cores ANSI legíveis (não texto monocromático quebrado). Isso é sanidade
  rápida — o resto dos passos abaixo é o que vale testar de verdade.

### 3. Cores e formatação

- [ ] **Ação:** na mesma aba, rodar um comando com saída colorida, ex.:
  `Write-Host "teste vermelho" -ForegroundColor Red` e
  `Write-Host "teste verde" -ForegroundColor Green`.
- **Resultado esperado:** cores aparecem corretas e legíveis contra o fundo
  escuro do tema (`bg-app #0E1116`), sem "vazamento" de códigos ANSI como
  texto literal (`\x1b[31m` aparecendo na tela é falha).

### 4. Teclas de seta e histórico de comandos

- [ ] **Ação:** digitar `echo primeiro`, Enter, `echo segundo`, Enter, depois
  apertar seta-para-cima duas vezes.
- **Resultado esperado:** o histórico de comandos do PowerShell é navegável
  normalmente (mostra `echo segundo`, depois `echo primeiro`), igual a um
  terminal nativo do Windows.

### 5. Ctrl+C interrompe processo em execução

- [ ] **Ação:** rodar `Start-Sleep -Seconds 30` e, antes de completar,
  apertar `Ctrl+C`.
- **Resultado esperado:** o processo é interrompido imediatamente (o prompt
  volta antes dos 30s), igual ao comportamento no Windows Terminal (CA-4).

### 6. Colar multilinha

- [ ] **Ação:** copiar um bloco de texto com 3+ linhas (ex.: um trecho de
  código) de outro app e colar (`Ctrl+V` ou botão direito, conforme o app
  implementar) dentro do terminal.
- **Resultado esperado:** as linhas coladas aparecem completas e na ordem
  certa, sem truncar, sem executar cada linha prematuramente antes de
  colar terminar, sem duplicar caracteres.

### 7. Resize da janela/painel

- [ ] **Ação:** redimensionar a janela do app (arrastar a borda) ou, se
  houver painéis colapsáveis, colapsar/expandir um painel lateral.
- **Resultado esperado:** o terminal se readapta ao novo tamanho (reflow do
  xterm via `addon-fit`), sem texto cortado ou área morta; um comando
  rodado depois do resize (ex.: `dir`) usa a largura nova corretamente
  (sem quebra de linha no lugar errado).

### 8. Scrollback

- [ ] **Ação:** gerar bastante output (ex.:
  `1..200 | ForEach-Object { "linha $_" }`) e depois rolar para cima com a
  roda do mouse ou `Shift+PageUp`.
- **Resultado esperado:** consegue rolar de volta e ver as linhas antigas
  (ex.: "linha 1"), sem o buffer ter sido descartado prematuramente.

### 9. Spawn do `claude` na aba (T005)

- [ ] **Ação:** abrir uma aba de sessão Claude (não terminal livre) — o
  mecanismo exato de abrir essa aba pode ainda ser rudimentar neste batch
  (launcher completo é T008); o importante é que o comando `claude` seja
  executado dentro da aba.
- **Resultado esperado:** a sessão `claude` sobe dentro do terminal
  embedado, com a mesma cara de uma sessão `claude` normal no terminal
  (banner inicial, prompt `>`). Testar interação básica: enviar
  "Responda apenas OK" com `--model haiku` (se o comando já suportar
  flags) e ver a resposta aparecer na aba.

### 10. Aviso quando `claude` não está no PATH (CA-5)

- [ ] **Ação:** só se for seguro testar na máquina (ideal: máquina de teste
  ou VM, não a máquina de trabalho do dia a dia) — renomear temporariamente
  `claude.exe` ou rodar o app com um PATH que não o contenha, e abrir uma
  aba de sessão Claude.
- **Resultado esperado:** o app mostra um aviso claro (não uma aba quebrada
  travada) com o caminho esperado `~/.local/bin/claude.exe`, conforme CA-5.
  Se não for seguro testar renomeando o executável real, **pule este passo
  e marque como "(confirmar na implementação)"** — não é obrigatório para
  aprovar o batch, mas vale registrar que ficou sem verificação humana.

## Se falhar

| Grupo de passos | Sintoma | Investigar |
|---|---|---|
| 1 (app sobe) | Janela não abre / erro no console do `npm run dev` | `src/main/index.ts` (bootstrap Electron); checar `npm run build -w @donel-dev/design-system` rodou no `prebuild` |
| 2-3 (cores/PowerShell) | Cores erradas ou texto quebrado | `src/main/ansi.ts`, tema do xterm em `TerminalPane.tsx` |
| 4-6 (teclas/Ctrl+C/colar) | Setas não navegam histórico, Ctrl+C não mata processo, colar corrompe texto | `src/main/pty-manager.ts` (encoding/flush do PTY), `src/renderer/src/TerminalPane.tsx` (bind de teclado do xterm) |
| 7 (resize) | Terminal não readapta, texto cortado | `addon-fit` em `TerminalPane.tsx`; IPC de resize não propagando pro `pty-manager.ts` |
| 8 (scrollback) | Buffer perdido cedo demais | Config de `scrollback` do xterm em `TerminalPane.tsx` |
| 9 (spawn claude) | `claude` não inicia dentro da aba | `src/main/claude-executable.ts` (resolução do exe), `src/shared/commandBuilder.ts` (montagem do comando) |
| 10 (aviso CA-5) | Aba trava em branco em vez de mostrar aviso | `src/main/claude-executable.ts` (fluxo de erro), verificar se o erro está sendo propagado por IPC pro renderer |
