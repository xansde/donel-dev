# Evidência das verificações de 07/10 (014)

Material das verificações ao vivo que embasam `../research.md`, guardado aqui
porque o scratchpad das sessões é temporário. Fica só no repo de trabalho:
`specs/` não vai ao espelho público.

| Pasta | O que é | Usado em |
|---|---|---|
| `transcript-schema.md` | Catálogo de **estrutura** do transcript do CLI (2.1.286–2.1.293): tipos de linha, attachments, `toolUseResult` por ferramenta, cadeia ativa, subagentes, tamanhos. Sem conteúdo real. | R11, contrato `conversation-rows.md`, fixtures sintéticas |
| `b1/` | Harness da verificação de **hooks**: driver node-pty, hook `command` e servidor `http`, cenários (`scenarios/`) | R1, R2, R12–R15; contrato `hook-bridge.md` |
| `b2/` | Harness da verificação da **entrada do terminal do Claude**: driver com `@xterm/headless`, `protocol.js` (implementação de referência do protocolo de envio, validada em 11 formas de mensagem), cenários (`scen/`) e **capturas de tela** (`logs/*.txt`) | R4–R10, R16; contrato `send-protocol.md`; fixtures de tela |

## Como rodar de novo

O `node-pty` do repo é compilado para a ABI do Electron, por isso o node puro
não o carrega:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe specs/014-chat/spike/b2/scen/q-protocol.js
```

- O `@xterm/headless` que o `b2/driver.js` usa foi instalado só na pasta da
  verificação; para rodar aqui, instale-o numa pasta temporária.
- Use sempre `--model haiku` e uma pasta de trabalho temporária: cada rodada
  cria transcripts em `~/.claude/projects/`.

## Privacidade

- As capturas de tela tiveram endereços de e-mail trocados por `<email>`.
- Nenhum transcript copiado entrou aqui. Os transcripts das sessões de
  verificação trazem attachments com dados da conta.
- Os trechos do binário do CLI (prova dos itens [BIN]) não foram guardados;
  as conclusões estão no `research.md`.
