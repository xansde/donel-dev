# Contrato — envio de mensagens para a PTY oculta

Como uma mensagem escrita no chat chega ao `claude` interativo **exatamente
como escrita, confirmada e sem duplicidade** (FR-017, FR-018, FR-019, FR-020,
SC-003). Base: verificação ao vivo no CLI 2.1.293 (`research.md` R4–R10) e a
bateria de Enter de 13/08 (`docs/relatorio-bateria-enter-2026-08-13.md`).

O **driver de envio** vive no renderer (`src/renderer/src/chat/sendDriver.ts`),
porque lê a tela pelo xterm que a aba já mantém montado (`TerminalPane`,
oculto na vista de chat). A decisão de cada passo é pura
(`src/shared/chat/sendMachine.ts`). O auto-start da Esteira passa a usar o
mesmo driver (FR-020).

## 1. Pré-condições (gate)

Nada é escrito na PTY antes de **todas**:

1. Processo vivo.
2. **Caixa de entrada visível**: linha `❯` entre duas réguas `─`, em
   qualquer dos layouts, fullscreen ou inline.
3. **Rodapé presente**: "? for shortcuts" (ocioso) ou "esc to interrupt"
   (trabalhando).
4. **Nenhum diálogo**:
   - diálogo de confiança;
   - tela sem caixa de entrada (`research.md` R16);
   - diálogo de pergunta, permissão ou plano;
   - pendência `open` no chat.

   Num diálogo, colar texto **responde ao diálogo**: dígitos e `j`/`k`
   escolhem opções.
5. Mensagens que começam com `/` ou `!` exigem o CLI **ocioso** (rodapé "?
   for shortcuts"). O Esc que fecha o menu `/` interromperia uma rodada em
   andamento.

O gate é reavaliado a cada atualização da tela e se repete após spawn,
`/clear` e `/resume`. Os bytes escritos antes de o REPL armar o stdin se
**perdem**: o gate não é opcional.

Enquanto as pré-condições não valem, o envio fica em `waiting-cli` (rótulo
"na fila"). Quando o motivo é uma pendência aberta ou a faixa "o terminal
precisa de você", a espera é explicada por elas e não tem prazo. Sem motivo
visível, o prazo é de 30 s, e depois vem `failed` (§6).

## 2. Saneamento do texto

Antes de colar, ainda no renderer:

- `\r\n` e `\r` → `\n`;
- remover `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]`. Um ESC no meio do
  texto faria o CLI descartar o caractere seguinte;
- TAB → 4 espaços, que é o que o CLI faria;
- aparar só as bordas.

O texto saneado é o que aparece na mensagem do dono e o que é comparado no
aceite (§5).

## 3. Texto que sobrou na caixa da TUI

O driver lê a caixa considerando o atributo *dim*: placeholder e sugestão
fantasma **não** são texto.

- **Caixa vazia**: segue.
- **Texto real e CLI ocioso**: o envio pausa e o chat oferece "Descartar e
  enviar" (`\x1b\x1b` numa escrita só e releitura) ou "Abrir terminal".
- **Texto real e CLI trabalhando**: pausa sem "Descartar". Aqui o Esc
  interromperia a rodada.
- **Nunca** Esc Esc em caixa vazia: abre o Rewind.

## 4. Sequência de bytes

```text
para cada imagem:     ESC[200~ "<caminho absoluto>" ESC[201~   → esperar "[Image #N]" na caixa (≤ 3 s)
texto:                ESC[200~ <texto saneado> ESC[201~        → esperar o texto na caixa, ou
                                                                  "[Pasted text #N +M lines]" (M = nº de \n)
se o menu "/" estiver aberto (linha "  ❯ /cmd" acima da régua) e o CLI ocioso:
                      ESC                                      → reconferir que o texto continua igual
Enter:                \r  em escrita própria, ~80 ms depois
```

- Cada caminho de imagem vai **sozinho** numa colagem: caminho dentro de
  texto não vira imagem.
- Colagens grandes são aceitas sem truncar (194 KB verificados, ~36 KB/s).
  Quem decide o placeholder é o CLI (≥ 5 linhas ou ~1000 caracteres); o chat
  só espera por ele.
- "Interromper e mandar agora": `ESC` com "esc to interrupt" visível e, logo
  em seguida, a sequência acima. Não precisa esperar.

## 5. Sinais de aceite

O primeiro sinal **autoritativo** que casar fecha o envio. O sinal de tela é
só para decidir o reenvio do Enter (§7), nunca para dizer "entrou".

| Tipo de mensagem | CLI ocioso → `accepted` ("entrou") | CLI trabalhando |
|---|---|---|
| Prompt comum, com ou sem imagem | hook `UserPromptSubmit` com o mesmo texto; ou linha `user` humana no transcript | `UserPromptSubmit` ou `queue-operation enqueue` → `queued` ("na fila"); `queue-operation remove` + `queued_command` → `accepted` |
| Skill ou comando customizado (`/nome args`) | `UserPromptSubmit` (texto cru), precedido de `UserPromptExpansion`; ou linha com `<command-name>/nome</command-name>` | só sai ocioso (§1.5) |
| `/clear` (`/new`, `/reset`) | `SessionEnd(clear)` + `SessionStart(clear)` | só sai ocioso |
| `/compact` | `SessionStart(compact)` / `system/compact_boundary` | só sai ocioso |
| Outro comando nativo local | `system/local_command`; se for `opensScreen`, a tela esperada aparecer | só sai ocioso |
| Comando desconhecido | `system/informational` "Unknown command" → `failed` com o motivo "comando desconhecido" | — |
| `!comando` | linha `<bash-input>` no transcript | só sai ocioso |

**Comparação de texto**: desembrulhar `\n\n<pasted_content id="…">…</pasted_content
id="…">\n` e normalizar `\n`, TAB e bordas. Os `[Image #N]` casam com
qualquer número. Mensagens idênticas seguidas são casadas na ordem: cada
sinal fecha só um envio, o mais antigo pendente.

O main guarda os últimos 20 `UserPromptSubmit` de cada aba, com horário, para
o aceite tardio (§7).

## 6. Prazos

| Etapa | Prazo | Ao estourar |
|---|---|---|
| `waiting-cli` sem motivo visível | 30 s | `failed` "o Claude não ficou pronto" |
| Imagem virar `[Image #N]` | 3 s por imagem | `failed` "a imagem não entrou" |
| Texto aparecer na caixa | 3 s + 1 s a cada 15 KB; **12 s** na primeira colagem da sessão | `failed` (a caixa é limpa só se o texto for o nosso) |
| Aceite autoritativo depois do Enter | **15 s** (o primeiro envio de uma sessão confirma em 4–5 s a frio) | `failed` "não foi" + "tentar de novo" |
| Aceite depois de um Enter **no meio da rodada**, com o texto fora da caixa | 15 s | `queued` (o CLI guardou na fila dele; o sinal só atrasou — máquina sem RAM, 28/10) |
| Entrega de mensagem `queued` | sem prazo: depende da rodada | — (a fila do CLI aparece na tela) |

Todo estado transitório tem prazo. Não existe "enviando…" eterno.

## 7. Reenvio e anti-duplicidade

1. **Texto ainda na caixa 3 s depois do Enter**: nada foi submetido. Reenviar
   **só** `\r`, uma vez.
2. **Caixa vazia sem aceite**: a mensagem **pode ter entrado**. Esperar o
   prazo de 15 s **sem reenviar nada**.
3. **"Tentar de novo"** (ação do dono sobre um `failed`):
   - primeiro procura aceite tardio nos `UserPromptSubmit` guardados e no
     transcript desde `createdAt`;
   - se achar, vira `accepted` sem escrever nada;
   - se não achar, refaz a sequência desde o gate.
4. **Nunca** recolar automaticamente. Enter duplo dentro de 0–120 ms não
   duplica a mensagem; recolagem duplica.

## 8. Esteira (FR-020)

- **Fase que pré-digita**: o comando vai para a **caixa do chat** (rascunho).
  O dono revisa e envia pelo fluxo normal.
- **Fase com auto-start**: o mesmo driver envia sozinho, com o mesmo gate,
  aceite e prazos.
- O caminho atual (`armEsteiraAutoStart`, texto cru sem bracketed paste)
  passa a chamar o driver.

## 9. Nunca

- Escrever antes do gate.
- Colar com diálogo, menu de tela ou pendência aberta.
- Esc com o CLI trabalhando, fora do Parar e do "interromper e mandar
  agora".
- Esc Esc em caixa vazia.
- Ctrl+C: arma a saída do CLI.
- Recolar sem o dono pedir.
- Enviar `/` ou `!` com o CLI trabalhando.
