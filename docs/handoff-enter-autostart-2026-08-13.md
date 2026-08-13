# Handoff — consertar o auto-start do Enter (`wi-esteira4-autostart-enter`)

Para uma sessão nova e dedicada. Escrito em 13/08/2026, depois de a bateria
manual reprovar. **Leia junto:** `docs/relatorio-bateria-enter-2026-08-13.md`
(a evidência completa) e este arquivo (o que fazer com ela).

---

## Em uma frase

O comando da fase aparece escrito no terminal e **não é submetido**; a correção
de 11/08 (PR #59) não resolveu, o problema **não é o intervalo entre o texto e o
`\r`**, e o conserto é o app **confirmar que a linha saiu e reenviar**, em vez de
tratar "escrevi no PTY" como "o CLI executou".

## Por que isso importa

É o **bug fundador da esteira**: sem ele, nenhuma fase roda sozinha. É a única
pendência do **Gate 1 da Onda 1** da rodada 012 — a **Onda 2 está bloqueada por
ele**. Fila do vault: `Projects/donel-dev/execucao-012-esteira4/PROXIMO.md`.

---

## O que JÁ está provado — não refazer

1. **O fix de 11/08 está no alfa instalado.** `app.asar` de 11/08 17:49 contém
   `autoStartWriteSteps`, `AUTO_START_ENTER` e a fase `text-sent`. Não perca
   tempo suspeitando de build velho.
2. **O Enter do app e o humano são o mesmo byte, pelo mesmo caminho.** A tecla
   vai para o `onData` do xterm → `pty.input('\r')`; o app chama
   `injectCommand('\r')` → `pty.input('\r')`. `injectCommand` é passagem direta,
   sem bracketed paste e sem prefixo (`TerminalPane.tsx:275-279`).
3. **O bug reproduz FORA do app**, com `node-pty` direto contra o `claude.exe`.
   **Não é culpa do Donel Dev** — não vá procurar em foco de aba, ciclo do React
   ou id de PTY trocado.
4. **Não é limiar de tempo.** Varredura: 50 não · 150 **sim** · 400 não · 1000
   não · 2000 **sim**. Não é monotônico.
5. **É não determinístico.** O mesmo 150 ms, repetido seis vezes: **0/6**.

**Conclusão que fecha o caminho errado:** nenhum valor de
`AUTO_START_ENTER_DELAY_MS` conserta isso. Se a sua primeira ideia for mexer
nessa constante, ela já foi testada e reprovada.

## O que continua EM ABERTO

A causa raiz exata. A pista mais forte é a **prontidão real do CLI**: as sondas
consideraram "pronto" entre 2,7 s e 9,9 s, enquanto o app mede boots de
14,5–20,9 s — a marca de prontidão aparece na tela **antes** de o REPL aceitar
submissão. **Mas isso é hipótese e provavelmente incompleta:** explicaria a
sonda e **não** explica o app, que espera mais e falha do mesmo jeito.

Não é obrigatório achar a causa raiz para consertar — o conserto abaixo é
robusto a ela.

---

## O conserto pedido

Fechar o buraco que o próprio código já nomeia: `injectCommand` garante que o
texto foi **escrito** no stdin do PTY, **nunca** que o CLI o **executou** — e o
watcher trata `written === true` como sucesso, encerra, e por isso não há toast
nem erro. Silêncio é o sintoma.

O auto-start passa a **confirmar e reenviar**:

1. escreve o texto do comando;
2. manda o `\r`;
3. **verifica no buffer renderizado do xterm** se a linha foi submetida;
4. **reenvia o `\r`** se não foi, com **teto de tentativas** (número é decisão
   de quem implementar; proponha e registre);
5. estourando o teto, emite um **toast honesto** — algo como "o comando foi
   escrito mas não enviado; aperte Enter na aba" — em vez de encerrar calado.

### Duas armadilhas que vão te pegar

- **A verificação TEM que ler o buffer renderizado**, via `getRenderedLines` /
  `onRenderedUpdate`, **nunca o byte stream**. No ConPTY o fluxo bruto **não
  contém os espaços** (ele emite avanço de cursor no lugar): ao tirar as
  sequências ANSI, `bypass permissions` vira `bypasspermissions` e qualquer
  busca com espaço falha. Duas tentativas da sessão de 13/08 morreram nisso. É o
  mesmo T013 que o `TerminalPane.tsx` já documenta.
- **Reenviar `\r` num comando que JÁ submeteu manda uma linha vazia** para uma
  sessão que pode estar no meio de um turno. A verificação do passo 3 precisa ser
  confiável antes de o passo 4 existir — e o `cleanup` já cancela Enter pendente
  quando a aba morre (`App.tsx`, `enterTimeoutId`), padrão a preservar.

---

## Onde mexer

| Arquivo | O quê |
|---|---|
| `src/renderer/src/App.tsx:1283-1367` | `armEsteiraAutoStart` — a máquina de estados (`waiting-ready` → `text-sent` → `done`). É aqui que entram a confirmação e o reenvio. |
| `src/renderer/src/App.tsx:225,249` | `PRE_TYPE_READY_TIMEOUT_MS` (30 s) e `AUTO_START_ENTER_DELAY_MS` (50 ms). **Não** resolva pela constante. |
| `src/renderer/src/Esteira/esteiraSession.ts:344+` | `AUTO_START_ENTER` e `autoStartWriteSteps` — o docstring tem o histórico do bug; **atualize-o**, a explicação atual está errada. |
| `src/renderer/src/TerminalPane.tsx:275-296` | `injectCommand`, `getRenderedLines`, `onRenderedUpdate` — as ferramentas do passo 3. |
| `src/shared/preTypeReadiness.ts` | As marcas de prontidão. Se a hipótese da prontidão se confirmar, é aqui. |

## Como reproduzir e verificar

As duas sondas usadas em 13/08 estão versionadas em `scripts/diagnostico/`:

```
node_modules/.bin/electron.cmd scripts/diagnostico/enter-probe.js    # varre atrasos
node_modules/.bin/electron.cmd scripts/diagnostico/enter-repeat.js   # repete o mesmo atraso
```

Rode **da pasta onde quiser o `.txt` de saída** (elas gravam `probe-result.txt` /
`repeat-result.txt` no diretório de trabalho). Usam `/help` de propósito: é
comando local do CLI, **não gasta turno de API**. No Windows o Electron não
anexa `stdout` — por isso gravam em arquivo.

**Critério de aceite da bateria:** o comando é submetido sozinho em **N
disparos consecutivos** no alfa, sem gesto humano. Um acerto único não vale — foi
exatamente assim que a correção de 11/08 passou por boa.

## Regras que continuam valendo

- **TDD no escopo:** isto é código de produção. Teste antes.
- **PR contra `staging` é livre**; **merge é humano**. `main` e o repo público
  seguem no bloqueio total.
- **Uma bateria por vez** na validação manual: entregue uma, espere o resultado,
  só então a próxima.
- O dono roda a esteira no **alfa**. Buildar com `npm run dist:alfa` e conferir
  os marcadores no `app.asar` antes de pedir a bateria.

## Prompt para abrir a sessão nova

> Vou consertar o auto-start do Enter do Donel Dev (`wi-esteira4-autostart-enter`),
> que reprovou na bateria de 13/08. Leia `docs/handoff-enter-autostart-2026-08-13.md`
> e `docs/relatorio-bateria-enter-2026-08-13.md` antes de qualquer coisa — o que já
> está provado está lá e não deve ser refeito, em especial: não é o valor de
> `AUTO_START_ENTER_DELAY_MS`. O conserto é confirmar no buffer renderizado que a
> linha submeteu e reenviar o Enter, com teto e toast honesto.
