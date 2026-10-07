# Bateria do Enter (Gate 1 da Onda 1) — REPROVADA em 13/08/2026

Resultado da bateria manual pendente desde 11/08, a última coisa que faltava
para o Gate 1 da Onda 1 da rodada 012 fechar. **Ela reprova**, e o motivo não é
o que a correção de 11/08 (`wi-esteira4-autostart-enter`, PR #59) assumiu.

Este relatório existe porque o roteiro anterior foi entregue **só na conversa**
de 11/08 e se perdeu — a evidência abaixo não pode morrer do mesmo jeito.

## O que a bateria mediu

Disparo de uma fase no **alfa 0.3.2** (`app.asar` de 11/08 17:49), sem tocar em
nada depois. O comando apareceu escrito na linha e **não foi submetido**. O dono
apertou Enter à mão em seguida e a linha submeteu normalmente.

## O que ficou provado

1. **O fix de 11/08 está no alfa instalado.** Marcadores conferidos dentro do
   `app.asar`: `autoStartWriteSteps`, `AUTO_START_ENTER` e a fase `text-sent` da
   máquina de estados nova. Não é build velho.
2. **O Enter do app e o Enter humano são o mesmo byte, pelo mesmo caminho.** A
   tecla vai para o `onData` do xterm → `pty.input('\r')`; o app chama
   `injectCommand('\r')` → `pty.input('\r')` (`TerminalPane.tsx:275-279`, que é
   passagem direta, sem bracketed paste nem prefixo).
3. **O bug reproduz FORA do Donel Dev.** Uma sonda em `node-pty` falando direto
   com `C:\Users\xansd\.local\bin\claude.exe`, sem app nenhum no meio, reproduz
   o mesmo comportamento. **O app não é a causa.**

## As medições

Sonda A — varrendo o atraso entre o texto e o `\r` (uma sessão por atraso,
`/help` como carga, que é comando local e não gasta turno de API):

| atraso | resultado |
|---|---|
| 50 ms | não submeteu |
| 150 ms | **submeteu** |
| 400 ms | não submeteu |
| 1000 ms | não submeteu |
| 2000 ms | **submeteu** |

Não é monotônico. Se fosse janela de agrupamento de colagem, haveria um limiar:
falha abaixo, sucesso acima. Não há.

Sonda B — o mesmo atraso de 150 ms (o único que tinha submetido), seis vezes:

| rep | boot até "pronto" | resultado |
|---|---|---|
| 1 | 9909 ms | não |
| 2 | 3323 ms | não |
| 3 | 2740 ms | não |
| 4 | 2996 ms | não |
| 5 | 3741 ms | não |
| 6 | 2837 ms | não |

**0/6.** O mesmo valor que submetera antes falha seis vezes seguidas.

## A conclusão

**O envio automático é não determinístico.** Nenhum valor de atraso o torna
confiável, porque o atraso não é a variável que decide.

A causa raiz exata continua em aberto. A pista mais forte é a **prontidão real
do CLI**: as sondas consideraram "pronto" entre 2,7 s e 9,9 s, enquanto o app
mede boots de 14,5–20,9 s — ou seja, a marca de prontidão que ambos usam aparece
na tela **antes** de o REPL aceitar submissão. Isso é hipótese, não fato: ela
explicaria a sonda, mas o app espera mais e falha assim mesmo.

A correção de 11/08 estava **certa pela metade**: separar os dois writes era
necessário, mas não suficiente. E como um teste único pode cair num acerto
(exatamente como o 150 ms da sonda A), ela pareceu funcionar quando não
funcionava.

## O que o conserto tem que ser

Não é ajustar `AUTO_START_ENTER_DELAY_MS`. É fechar o buraco que o próprio
código já nomeia: `injectCommand` garante que o texto foi **escrito** no stdin
do PTY, nunca que o CLI o **executou** — e o watcher trata "escrevi" como
"enviei", por isso marca sucesso e não emite toast nenhum.

O auto-start precisa **confirmar e reenviar**:

1. escreve o texto;
2. manda o `\r`;
3. **verifica no buffer renderizado do xterm** se a linha saiu (a mesma fonte
   que `getRenderedLines` já usa — ver abaixo por que não pode ser o fluxo bruto);
4. reenvia o `\r` se não saiu, com teto de tentativas;
5. estourando o teto, emite um toast **honesto** — "o comando foi escrito mas
   não enviado; aperte Enter na aba" — em vez de silêncio.

## Achado colateral que vale para qualquer verificação futura

No ConPTY o texto do terminal **não contém os espaços**: em vez de escrevê-los,
ele emite sequências de avanço de cursor. Ao remover as sequências ANSI para
procurar texto no fluxo bruto, os espaços somem junto — `bypass permissions`
chega como `bypasspermissions`, e qualquer busca com espaço falha. Duas
tentativas desta sessão morreram nisso antes de a sonda funcionar.

É o mesmo achado que o `TerminalPane.tsx` já registra (T013): a fonte de verdade
tem que ser o **buffer renderizado** do xterm, nunca o byte stream. Vale para o
conserto acima — o passo 3 tem que ler o buffer, não o fluxo.

## Consequência para a rodada

O **Gate 1 não fecha**. A Onda 2 continua bloqueada, agora por um motivo nomeado
e com evidência, em vez de uma pendência genérica. O item
`wi-esteira4-autostart-enter` precisa voltar para Implementar com o escopo de
"confirmar e reenviar" acima.
