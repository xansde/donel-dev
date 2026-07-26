# Roteiro E2E — 005 Terminal: copiar/colar/imagem por tipo de sessão (validação do Alexandre)

**Build:** gerar com `npm run dist` (uma única build/reinstalação ao fim,
não reinstalar entre fatias — `plan.md`/`tasks.md`). Instalação é ato
HUMANO — §B14 do `backlog.md`: há duas instalações na máquina (all-users em
`C:\Program Files\Donel Dev`, per-user em `%LOCALAPPDATA%\Programs\Donel
Dev`), e instalar substitui uma delas. Quem empacota avisa qual.

**O que esta entrega muda:** hoje `Ctrl+C`/`Ctrl+V` não copiam/colam — o
`Ctrl+C` manda SIGINT cru e "muitas vezes interrompe as execuções" (a dor
original). Esta entrega intercepta `Ctrl+C`/`Ctrl+V` por tipo de aba
(`claude` vs `shell`) ANTES de virarem bytes crus pro PTY. Cada passo abaixo
aponta o critério de aceite (CA-N) que ele prova.

**Cobertura automatizada já verde** (não precisa refazer à mão): typecheck,
suíte unit completa (`resolveTerminalKeyAction` — matriz exaustiva CA-1..CA-9
× 2 tipos de aba, `clipboard-bridge` com `electron.clipboard` mockado) e o
smoke `tests/smoke/terminal-copy-paste.spec.ts` (CA-6: `Ctrl+C` sem seleção
mata um `ping -t` real na aba shell). O que **NÃO** está automatizado — e é
por isso que este roteiro existe — é tudo que depende de uma sessão `claude`
real (turno de API) ou de imagem/clipboard de verdade. Ver "Dívida
conhecida" no fim.

---

## Aba `claude`

### 1. `Ctrl+C` sem seleção DURANTE uma execução longa — a execução NÃO PODE morrer (CA-2, o coração da dor)

1. Abrir uma sessão `claude`.
2. Pedir algo que rode por um tempo (ex.: um comando bash demorado, ou uma
   tarefa com várias tool calls em sequência).
3. **Enquanto a execução está rodando** (sem nada selecionado no terminal),
   apertar `Ctrl+C`.

**Esperado:** a execução **continua** — nenhum `\x03` chega ao processo.
Nada visível acontece (no-op silencioso, decisão C1).

**O que reprovaria:** a execução parar/abortar como acontecia antes desta
entrega. Este é o passo mais importante do roteiro inteiro.

### 2. Copiar com seleção não interrompe (CA-1)

1. Numa sessão `claude` rodando (ou parada), selecionar um trecho de texto no
   terminal (mouse).
2. Apertar `Ctrl+C`.

**Esperado:** o texto selecionado vai pro clipboard (colar em outro app pra
confirmar) e, se havia algo em execução, **continua rodando** — `Ctrl+C` com
seleção nunca manda `\x03`.

### 3. `Esc` continua interrompendo (CA-5)

1. Com uma execução longa rodando, apertar `Esc`.

**Esperado:** a execução é interrompida — `Esc` é agora a ÚNICA forma de
interromper em aba `claude` (o `Ctrl+C` deixou de fazer isso, passo 1).

### 4. Colar texto de 1 linha (CA-3)

1. Copiar uma linha curta de texto (fora do app).
2. Focar o terminal da aba `claude` e apertar `Ctrl+V`.

**Esperado:** o texto aparece no input, como se tivesse sido digitado.

### 5. Colar texto de 5 linhas — vira UM bloco colado, não 5 Enters (CA-3, fecha o item "colar multilinha" do batch-5)

1. Copiar um texto com 5 linhas (fora do app).
2. Focar o terminal da aba `claude` e apertar `Ctrl+V`.

**Esperado:** o CLI mostra `[Pasted text #N]` — as 5 linhas entram como UM
bloco colado, não como 5 submissões separadas (5 Enters).

**O que reprovaria:** ver 5 linhas serem enviadas uma a uma (cada uma virando
uma mensagem própria).

### 6. Colar print (imagem) — `[Image #N]` em ~1,5 s (CA-4, CA-4b)

1. Tirar um print (`PrtScn` ou ferramenta de recorte) — imagem vai pro
   clipboard.
2. Focar o terminal da aba `claude` e apertar `Ctrl+V`.

**Esperado:** em ~1,5 s (latência do PowerShell interno do próprio CLI, não
do Donel), aparece `[Image #N]` no input. O `Pasting…` transitório é
desenhado pelo CLI — o Donel **não** mostra spinner/toast próprio.

**O que reprovaria:** qualquer UI própria do Donel (spinner, placeholder,
"salvando imagem..."), arquivo temporário visível, ou nada acontecer.

### 7. `Alt+V` ainda cola imagem (CA-8)

1. Com uma imagem no clipboard, apertar `Alt+V` diretamente (sem passar por
   `Ctrl+V`).

**Esperado:** continua funcionando exatamente como antes desta entrega —
`[Image #N]` aparece. O handler novo intercepta só `Ctrl+C`/`Ctrl+V`.

### 8. `Ctrl+Shift+C`/`Ctrl+Shift+V` continuam funcionando (CA-7)

1. Selecionar texto, apertar `Ctrl+Shift+C`.
2. Apertar `Ctrl+Shift+V` num campo de texto.

**Esperado:** copia/cola exatamente como funcionava antes (comportamento
default do Electron/DOM) — não regrediu.

---

## Aba `shell` (terminal livre)

### 9. `Ctrl+C` mata o processo — zero regressão (CA-6)

> **Já coberto automaticamente** pelo smoke
> `tests/smoke/terminal-copy-paste.spec.ts` (`ping -t 127.0.0.1` real,
> morto de verdade). Rodar à mão só se quiser confirmar visualmente:

1. Abrir uma aba de terminal livre.
2. Rodar `ping -t 127.0.0.1`.
3. Apertar `Ctrl+C` sem nada selecionado.

**Esperado:** o `ping` para (SIGINT), igual sempre foi — nenhuma mudança de
comportamento na aba shell sem seleção.

### 10. `Ctrl+C` com seleção copia (CA-1, mesmo em aba shell)

1. Selecionar um trecho de texto no terminal livre.
2. Apertar `Ctrl+C`.

**Esperado:** copia pro clipboard — **e**, se havia algo rodando, o processo
**não** morre (só é morto por `Ctrl+C` SEM seleção, passo 9).

### 11. `Ctrl+V` cola comando (CA-3, cru — sem bracketed paste)

1. Copiar um comando de texto (ex.: `echo teste`).
2. Focar o terminal livre e apertar `Ctrl+V`.

**Esperado:** o comando aparece no prompt, pronto para rodar com Enter.

---

## Regressão nas DUAS abas (CA-9, C3) — setas e teclas especiais nunca são engolidas

Repetir em uma aba `claude` E em uma aba `shell`:

12. Setas (`↑↓←→`) navegam no histórico/cursor normalmente.
13. `Home`/`End` movem o cursor para início/fim da linha.
14. `PgUp`/`PgDn` rolam o scrollback.
15. `Delete` apaga o caractere à frente do cursor.
16. `Tab`/`Shift+Tab` funcionam como sempre (autocomplete/indentação,
    conforme o contexto).

**Esperado:** nenhuma dessas teclas muda de comportamento — o handler novo
só intercepta `Ctrl+C`/`Ctrl+V`, todo o resto desce cru como sempre desceu.

---

## Fora de escopo (não reprovar por isso)

- Copy-on-select, menu de contexto (botão direito), seleção que sobrevive a
  output novo — ficam no backlog B7.
- Colar imagem em aba **shell** (US-C é só para aba `claude`).
- Keybindings configuráveis pela UI, ou editar
  `~/.claude/keybindings.json` do usuário.
- Overlay/máscara sobre o output bruto do PTY (outro item do `todo.md`).

## Dívida conhecida (medida, NÃO é regressão desta entrega)

- 2 smokes de `previous-sessions.spec.ts` (T013, restauração de sessões) —
  feature própria, código disjunto desta entrega.
- Os vermelhos de cota semanal (`model-injection.spec.ts`,
  `terminal.spec.ts:281`) são ambientais — voltam a verde quando a janela
  semanal vira; se aparecerem de novo durante esta validação, não são
  regressão desta entrega.

## O que fica sem validação humana até este roteiro rodar

Todo o bloco "Aba claude" (passos 1–8) depende de uma sessão `claude` real
(o passo 1, em especial, depende de cota disponível para uma execução
longa de verdade) — a cota semanal do perfil estava esgotada em 25/07.
Enquanto este roteiro não rodar com cota disponível, a prova de CA-1..CA-5,
CA-7 e CA-8 fica restrita ao unit puro (`tests/terminalKeymap.test.ts`), que
prova a DECISÃO mas não o fio até o PTY real.
