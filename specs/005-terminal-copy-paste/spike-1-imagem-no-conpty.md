# SPIKE-1 — Como entregar a imagem colada ao claude CLI dentro do ConPTY

**Status:** ✅ **FECHADO — contrato descoberto e provado empiricamente**
**Data:** 2026-07-24
**Pergunta:** o CLI lê o clipboard? Precisa salvar temp + inserir path?
Marcador? Qual sequência de bytes o Donel tem de mandar ao PTY?

## Resposta curta

**O claude CLI lê o clipboard sozinho.** O Donel **não** precisa salvar
arquivo temporário, não precisa inserir path e não precisa base64. Precisa
apenas mandar ao PTY a sequência da tecla que o CLI associa a `chat:imagePaste`
— que **no Windows é `alt+v`, ou seja `ESC v` = `\x1b\x76`** — e o CLI faz o
resto (lê o clipboard via PowerShell, salva PNG num temp dele, e insere
`[Image #N]` no input).

**`Ctrl+V` (`\x16`) não faz nada** no CLI em Windows. É por isso que colar
imagem "não funciona" hoje: o Donel repassa `\x16` cru e o CLI ignora.

## Evidência 1 — o contrato no binário do CLI

`claude.exe` v2.1.219 (`C:\Users\xansd\.local\bin\claude.exe`), strings do bundle:

```js
// tabela de keybindings, contexto "Chat"
{ context:"Chat", bindings:{ ..., [emy]:"chat:imagePaste",
    ...Qgo==="wsl" && {"ctrl+v":"chat:imagePaste"}, ... } }

emy = Zfy ? "alt+v" : "ctrl+v"
Zfy = Qgo==="windows" || Qgo==="wsl"
Qgo = Lt()            // plataforma
```

→ **Windows: `alt+v`.** `ctrl+v` só é aceito ADICIONALMENTE no WSL.
Confirmado pelo predicado de teclado do próprio CLI:

```js
function epm(e){ if(e.key!=="v") return !1;
  if(e.ctrl && !e.meta) return t!=="windows";        // ctrl+v: NÃO no Windows
  if(e.meta && !e.ctrl) return t==="windows"||t==="wsl"; // meta(alt)+v: SIM
  return !1 }
```

E a leitura do clipboard no win32 é feita pelo CLI, por PowerShell:

```js
win32:{
  checkImage:["powershell","-NoProfile","-NonInteractive","-Sta","-Command",
    "Add-Type -AssemblyName System.Windows.Forms; if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }"],
  saveImage: [... "[System.Windows.Forms.Clipboard]::GetImage(); ... $img.Save(<temp>, Png)"],
  deleteFile:[...]
}
```

O resultado entra na sessão como `[Image #N]` (`_Mo(e){return \`[Image #${e}]\`}`),
com `storedImagePaths` mapeando o id → path do PNG temporário.

## Evidência 2 — teste empírico num ConPTY real

Script: `spike1.cjs` (temporário, **não commitado**) — spawna
`C:\Users\xansd\.local\bin\claude.exe` com **node-pty 1.1.0 + ConPTY**, os
mesmos usados pelo app (`src/main/pty-manager.ts` → `spawn()` de `node-pty`;
o app **instalado** em `%LOCALAPPDATA%\Programs\Donel Dev` empacota
`app.asar.unpacked/node_modules/node-pty` **v1.1.0**, idêntico). Imagem PNG
240×120 posta no clipboard via `Clipboard::SetImage`, com processo owner vivo.

| Sequência enviada ao PTY | `[Image #N]` apareceu? | Latência | Observado na tela |
|---|---|---|---|
| `\x1bv` (**alt+v**) | ✅ **sim** (`[Image #1]`) | **1541 ms** | `Pasting…` → `[Image #1]` |
| `\x16` (**ctrl+v**) | ❌ não (janela de 60 s) | — | nada |
| `\x1bv` **sem** imagem no clipboard | ❌ não | — | `No image found in clipboard. Use alt+v to paste images.` |

A terceira linha é a prova cruzada mais forte: **o próprio CLI escreve
"Use alt+v to paste images"** — o gancho é esse, e o Donel só precisa acioná-lo.

### Ressalva honesta de método

O contrato foi provado no ConPTY real com a stack idêntica à do app instalado
(mesmo `claude.exe`, mesmo node-pty 1.1.0), **injetando os bytes no PTY**. O
que **não** foi (nem podia ser) testado é apertar `Ctrl+V` fisicamente na GUI
do app instalado — isso depende do handler que ainda **não existe** e é
justamente o que a implementação vai criar. O E2E manual do Alexandre no app
instalado segue obrigatório após implementar.

## Consequências para a spec/plan

1. **CA-4 muda de "descobrir como" para "traduzir tecla":** em aba `claude`,
   `Ctrl+V` com **imagem** no clipboard ⇒ o Donel escreve `\x1b\x76` no PTY.
   Zero manuseio de arquivo/base64 do lado do app.
2. **Detecção de imagem é barata e local:** `clipboard.availableFormats()` do
   Electron (ou `clipboard.readImage().isEmpty()`) decide, no renderer/main,
   se o `Ctrl+V` vira `\x1b\x76` (imagem) ou uma colagem de texto normal.
   Não precisa chamar PowerShell — quem paga esse custo é o CLI, uma vez.
3. **Colar texto continua sendo do Donel:** `Ctrl+V` sem imagem ⇒ ler
   `clipboard.readText()` e escrever no PTY em **bracketed paste**
   (`\x1b[200~` … `\x1b[201~`) — o CLI liga bracketed paste no boot
   (`\x1b[?2004h` aparece no trace), então multilinha entra como um bloco
   colado (vira `[Pasted text #N]`) em vez de N Enters. Isso resolve o item
   "colar multilinha" do batch-5.
4. **Latência ~1,5 s é do PowerShell do CLI**, não do Donel. O feedback
   visual (`Pasting…`) é desenhado pelo próprio CLI — **não** criar spinner
   próprio no app.
5. **NÃO mexer em `~/.claude/keybindings.json`** para rebindar `chat:imagePaste`
   para `ctrl+v`: é config global do usuário (afeta o claude fora do Donel) e
   colidiria com a colagem de texto. A tradução de tecla no app é a via certa.
6. **Alt+V continua funcionando de graça** para quem já tem o hábito: como o
   Donel só intercepta `Ctrl+C`/`Ctrl+V`, o `Alt+V` segue descendo cru.

## Artefatos

- Script do spike: `spike1.cjs` na raiz do repo — **temporário, remover**
  (não faz parte da entrega; o valor está neste documento).
- Logs brutos: `spike1-altv.log`, `spike1-ctrlv.log` (também descartáveis).
