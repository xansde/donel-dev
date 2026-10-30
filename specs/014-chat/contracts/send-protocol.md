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
3. **Rodapé presente**: qualquer texto abaixo da caixa (o modo de
   permissão, as dicas, a saída de uma statusline).
4. **Nenhum diálogo**:
   - diálogo de confiança;
   - tela sem caixa de entrada (`research.md` R16);
   - diálogo de pergunta, permissão ou plano;
   - pendência `open` no chat.

   Num diálogo, colar texto **responde ao diálogo**: dígitos e `j`/`k`
   escolhem opções.
5. Mensagens que começam com `/` ou `!` exigem o CLI **ocioso** (a tela não
   prova turno em andamento, ver abaixo). O Esc que fecha o menu `/`
   interromperia uma rodada em andamento.

**Como a tela prova o turno em andamento** (`isWorking`, `shared/chat/screen.ts`):
"esc to interrupt" no rodapé **ou** a linha do spinner logo acima da caixa
(glifo na coluna 0, verbo e "…": `✻ Booping… (31s · ↓ 58 tokens)`). A linha de
turno encerrado (`✻ Worked for 26s · done 17:38`) não tem "…" e não conta.
O spinner é a prova que vale sempre. As dicas do rodapé faltam em dois casos
medidos no CLI 2.1.314 real (30/10): com **qualquer** `statusLine`
configurada (a ponte da statusline do app ou a do usuário), o CLI tira "esc to
interrupt" e "? for shortcuts" do rodapé, e sobram o modo e a saída da
statusline; e, mesmo sem statusline, com texto na caixa durante o turno. O
spinner aparece e some nos mesmos quadros em que a dica apareceria e sumiria
(Enter, Esc, fim do turno). Os hooks não substituem a tela aqui. No primeiro
envio da sessão, o `UserPromptSubmit` chegou de 13 a 25 s depois do Enter,
porque os hooks `UserPromptSubmit` do próprio usuário rodam antes. E depois de
um Esc o CLI não dispara `Stop`.

Também medido no 2.1.314: com o turno em andamento a marca `❯` da caixa é
*dim*. A marca se procura no texto cru, e só o que vem depois dela descarta as
runs *dim* (`cliInputBox.ts`). Sem isso, a caixa ficava "ilegível" durante
todo turno.

O gate é reavaliado a cada atualização da tela e se repete após spawn,
`/clear` e `/resume`. Os bytes escritos antes de o REPL armar o stdin se
**perdem**: o gate não é opcional.

**Com o Claude trabalhando, a mensagem vai na hora** (decisão do dono,
30/10: "só envia, sem esperar ele finalizar, e acompanha se o próprio Claude
coleta"). O CLI aceita mensagem digitada no meio do turno e a guarda na fila
dele. Por isso, com o turno em andamento pelos hooks (`working`), os itens 2
e 3 **não seguram** um prompt comum: caixa ilegível ou sem rodapé (um comando
longo às vezes a esconde) não é motivo para esperar, e a colagem sai. O
portão só segura por motivo real e visível:

- pergunta ou permissão aberta, faixa "o terminal precisa de você", diálogo
  ou tela sem caixa reconhecida (`blockingScreen`), processo morto;
- texto que sobrou na caixa (§3);
- `/` e `!`, que precisam do CLI parado (item 5);
- nenhuma leitura da tela ainda (é ela que descarta o diálogo), ou a caixa
  tomada por um menu.

Mensagem com imagem e "interromper e mandar agora" também esperam a caixa: o
`[Image #N]` precisa ser visto, e o Esc do interromper precisa da tela
provando o turno (`isWorking`). Essas esperas têm motivo visível ("esperando o Claude
terminar o que está fazendo") e não têm prazo.

Enquanto as pré-condições não valem, o envio fica em `waiting-cli` (rótulo
"na fila"). Quando o motivo é visível (pendência aberta, faixa "o terminal
precisa de você", turno em andamento), a espera não tem prazo. Sem motivo
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
  interromperia a rodada. "Trabalhando" é a tela provando o turno (§1). Com
  texto na caixa, o rodapé do 2.1.314 já não diz "esc to interrupt", mas o
  spinner continua lá.
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
- "Interromper e mandar agora": `ESC` com a tela provando o turno
  (`isWorking`: "esc to interrupt" ou o spinner) e a sequência acima **só
  quando a tela deixa de provar o turno** (o turno parou; o spinner some
  ~0,2–0,7 s depois do `ESC` no 2.1.314), ou 3 s depois do `ESC` se ele não parar (aí a mensagem vai
  para a fila do CLI). Colada no mesmo instante, o `ESC` virava prefixo da
  colagem (`ESC ESC[200~`) e o turno seguia (visto em 30/10). Um `ESC` só.
- **Texto que não aparece na caixa no meio do turno** (máquina lenta, tela que
  esconde a caixa): estourado o prazo do texto (§6) com o turno em andamento
  (a tela provando o turno ou, sem caixa legível, os hooks), o `\r` sai
  mesmo assim e o envio passa a ser acompanhado pelos sinais (§5). Uma colagem
  só; sem Esc Esc. Se um diálogo ou uma pergunta apareceu nesse meio-tempo, o
  Enter responderia a ele: aí é `failed` "o texto não entrou na caixa", como
  antes. Com o CLI ocioso nada muda: o prazo estourado é `failed`.

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

**Acompanhar se o CLI coletou** (Enter dado no meio do turno):

- `enqueue` (ou `UserPromptSubmit`) → `queued`, "na fila — entra na próxima
  pausa do Claude"; `queue-operation remove` + `queued_command` (`deliver`),
  ou um segundo `submit` → `accepted`, "entrou".
- **Sem sinal nenhum**: passado o prazo do reenvio do Enter (3 s) e com o nosso
  texto fora da caixa (ou a caixa ilegível), o envio vira `queued`. O CLI só
  confirma quando entrega.
- **Fim do turno**: com `queued` e os hooks dizendo que o turno acabou
  (`working` falso), passam 15 s sem `submit`/`deliver` e o chat faz o
  `ack-lookup` (os `UserPromptSubmit` guardados e o transcript desde
  `createdAt`). Achou → `accepted`. Não achou → `failed` "o Claude não pegou a
  mensagem", com "tentar de novo". Se o turno recomeça antes, o relógio para e
  recomeça do fim do novo turno; se a tela ainda prova o turno, a
  conferência fica para 15 s depois. Nenhuma mensagem fica "na fila" para
  sempre depois que o Claude para.

## 6. Prazos

| Etapa | Prazo | Ao estourar |
|---|---|---|
| `waiting-cli` sem motivo visível | 30 s | `failed` "o Claude não ficou pronto" |
| Imagem virar `[Image #N]` | 3 s por imagem | `failed` "a imagem não entrou" |
| Texto aparecer na caixa | 3 s + 1 s a cada 15 KB; **12 s** na primeira colagem da sessão | ocioso: `failed` (a caixa é limpa só se o texto for o nosso); **no meio do turno**: Enter mesmo assim, sem Esc Esc (§4) |
| Aceite autoritativo depois do Enter | **15 s** (o primeiro envio de uma sessão confirma em 4–5 s a frio) | `failed` "não foi" + "tentar de novo" |
| Aceite depois de um Enter **no meio da rodada**, com o texto fora da caixa | 3 s (o prazo do reenvio) | `queued` (o CLI guardou na fila dele e só confirma na entrega; o sinal também pode atrasar — máquina sem RAM, 28/10) |
| Enter no meio da rodada com o texto **ainda na caixa** | 15 s (com um `\r` reenviado aos 3 s) | `failed` "não foi" |
| Entrega de mensagem `queued` com o turno em andamento | sem prazo: depende da rodada | — (a fila do CLI aparece na tela) |
| Entrega de mensagem `queued` depois que o turno acabou | 15 s | `ack-lookup`: achou → `accepted`; não achou → `failed` "o Claude não pegou a mensagem" |

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

- Escrever antes do gate (com o turno em andamento, o gate é o do §1: só os
  motivos visíveis seguram).
- Colar com diálogo, menu de tela ou pendência aberta.
- Esc com o CLI trabalhando, fora do Parar e do "interromper e mandar
  agora".
- Esc Esc em caixa vazia.
- Ctrl+C: arma a saída do CLI.
- Recolar sem o dono pedir.
- Enviar `/` ou `!` com o CLI trabalhando.
