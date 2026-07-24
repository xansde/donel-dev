# Plano técnico — 005 Terminal: copiar/colar/imagem por tipo de sessão

Referência: `spec.md` (CA-1..CA-9) + `spike-1-imagem-no-conpty.md` deste
diretório. Todos os paths relativos a `C:/Users/xansd/seazone/donel-dev`.
Branch: `feature/mvp-p0` (mesma; tudo local, **sem push e sem PR**).

**Decisões do clarify já incorporadas:** C1 no-op silencioso · C2
`attachCustomKeyEventHandler` · C3 teclas especiais só como regressão · C4
extras do B7 fora · C5 hard-coded.

## Forma da solução (uma frase)

Um **mapeador puro de tecla → ação**, ramificado por `sessionType`, plugado no
xterm via `attachCustomKeyEventHandler`; as ações "copiar", "colar texto" e
"colar imagem" são executadas por um adaptador fino de clipboard, e "colar
imagem" se resume a escrever `\x1b\x76` no PTY (o CLI faz o resto).

## Decisões técnicas (o "por quê", para não serem revertidas por engano)

1. **`attachCustomKeyEventHandler`, não `term.onKey` nem o evento `paste` do
   DOM.** O `attachCustomKeyEventHandler` é o único gancho do xterm que roda
   **antes** da tradução tecla→bytes e cujo retorno `false` **cancela** o
   `onData` — é exatamente o que CA-1/CA-2 exigem (impedir o `\x03` de nascer).
   `term.onKey` é notificação depois do fato: não cancela nada. O evento
   `paste` do DOM não serve como gancho primário porque o xterm consome o
   `keydown` do `Ctrl+V` no textarea escondido e o comportamento entre
   plataformas/Electron é inconsistente; além disso precisamos ramificar por
   `sessionType`, o que o `paste` não expõe.
2. **`term.onData` continua o único caminho de saída para o PTY.** O handler
   não escreve no PTY direto: quando decide "deixa passar", devolve `true` e o
   fluxo atual segue intacto (`TerminalPane.tsx:337-341`). Quando decide agir,
   devolve `false` e chama a ação. Isso mantém uma só porta de entrada do PTY.
3. **Colar imagem = traduzir tecla, não mover bytes.** `Ctrl+V` com imagem no
   clipboard ⇒ escrever `\x1b\x76` no PTY. Não salvar temp, não inserir path,
   não base64 — provado no SPIKE-1. Corolário: **não criar spinner próprio**
   (o `Pasting…` é do CLI, CA-4b) e **não** rebindar
   `~/.claude/keybindings.json`.
4. **Colar texto usa bracketed paste.** O CLI liga `\x1b[?2004h` no boot (visto
   no trace do spike), então texto multilinha deve ir envolvido em
   `\x1b[200~` … `\x1b[201~` para entrar como um bloco (`[Pasted text #N]`) em
   vez de N submissões. Em aba **shell**, o PowerShell não pede bracketed
   paste — daí a ramificação também valer para colar (ver Fatia 2).
5. **Detecção de imagem no clipboard é local e barata:** `clipboard` do
   Electron no **main** (`availableFormats()` / `readImage().isEmpty()`), nunca
   PowerShell no app. O custo de ~1,5 s do PowerShell é pago **uma vez pelo
   CLI**, não pelo Donel.
6. **Clipboard vive no main, não no renderer.** `contextIsolation: true` sem
   `nodeIntegration` (`src/main/index.ts`): o renderer não alcança o módulo
   `clipboard`. Novo canal IPC `clipboard:*` exposto por `preload` como
   `window.donel.clipboard.*`, no padrão dos canais existentes
   (`PTY_CHANNELS`, `CONFIG_CHANNELS`…). Não usar `navigator.clipboard` —
   depende de foco/permissão e não lê imagem de forma confiável aqui.
7. **A lógica de decisão é um módulo puro em `src/shared/`,** sem xterm, sem
   Electron, sem DOM: recebe um descritor de tecla + `sessionType` + "tem
   seleção?" + "tem imagem no clipboard?" e devolve uma ação. É o que permite
   TDD de verdade (a matriz CA-1..CA-9 vira tabela de teste) — mesma estratégia
   que a 002 usou com `parseQuotaAxiWindows`/`computeSessionAccountLabel`.

## Fatia 1 — Decisor puro `resolveTerminalKeyAction` (invisível ao usuário)

**Arquivo novo:** `src/shared/terminalKeymap.ts` (+ export em
`src/shared/index.ts`).

```ts
export type TerminalKeyContext = {
  sessionType: 'claude' | 'shell';
  hasSelection: boolean;
  clipboardHasImage: boolean;
};
export type TerminalKeyAction =
  | { kind: 'passthrough' }        // devolve true: xterm segue o fluxo normal
  | { kind: 'copySelection' }      // Ctrl+C com seleção
  | { kind: 'pasteText' }          // Ctrl+V sem imagem
  | { kind: 'pasteImage' }         // Ctrl+V com imagem -> \x1b\x76
  | { kind: 'noop' };              // C1: Ctrl+C sem seleção em aba claude

export function resolveTerminalKeyAction(
  key: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; type: string },
  ctx: TerminalKeyContext,
): TerminalKeyAction;
```

Regras (tabela exata; espelha CA-1..CA-9):

| tecla | aba `claude` | aba `shell` |
|---|---|---|
| `Ctrl+C` **com** seleção | `copySelection` | `copySelection` |
| `Ctrl+C` **sem** seleção | `noop` (**nunca `\x03`**) | `passthrough` (SIGINT) |
| `Ctrl+V` + imagem no clipboard | `pasteImage` | `passthrough` |
| `Ctrl+V` sem imagem | `pasteText` | `pasteText` |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | `passthrough` (default do Electron, CA-7) | idem |
| `Alt+V` | `passthrough` (CA-8) | `passthrough` |
| `Esc`, setas, Home/End, PgUp/PgDn, Del, Tab | `passthrough` (CA-5, CA-9) | `passthrough` |
| `keyup`/`keypress` (não `keydown`) | `passthrough` | `passthrough` |

Detalhes que a implementação **não** pode errar:
- **`Ctrl+C` em aba shell COM seleção copia** (CA-1 não restringe por tipo, e é
  o comportamento do Windows Terminal, a referência declarada). Sem seleção,
  shell mantém SIGINT — é a única forma de matar processo lá (CA-6).
- Ramificar só em `type === 'keydown'`; `keyup`/`keypress` sempre `passthrough`
  (senão a ação dispara duas/três vezes por toque).
- `Ctrl+Shift+*` e qualquer combinação com `alt`/`meta` saem por `passthrough`
  **antes** de olhar `Ctrl+C`/`Ctrl+V` (evita `Ctrl+Alt+V` virar colagem).

**Testes (TDD, puro):** um caso por linha da tabela × 2 tipos de aba, mais os
casos de borda (`keyup`, `Ctrl+Alt+V`, `Ctrl+Shift+C`). `tests/terminalKeymap.test.ts`.

## Fatia 2 — Adaptador de clipboard (main + IPC + preload)

**Arquivos:** `src/main/clipboard-bridge.ts` (novo), `src/shared/index.ts`
(canais + tipo em `DonelApi`), `src/preload/index.ts`, `src/main/index.ts`
(registro dos handlers).

- `CLIPBOARD_CHANNELS = { hasImage: 'clipboard:hasImage', readText: 'clipboard:readText', writeText: 'clipboard:writeText' }`.
- `hasImage()` → `!clipboard.readImage().isEmpty()`. Envolver em try/catch:
  clipboard indisponível **nunca** derruba a digitação — degrada para `false`
  (o `Ctrl+V` então cola texto/`passthrough`, nunca quebra a aba).
- `readText()` → `clipboard.readText()`. `writeText(s)` → `clipboard.writeText(s)`.
- Expor em `preload` como `window.donel.clipboard.*`, tipado em `DonelApi`.

**Estado do clipboard é lido no momento do toque, não em cache.** O
`attachCustomKeyEventHandler` do xterm é **sincrônico** e `hasImage` é IPC
assíncrono — resolver isso **sem** cache obsoleto:

> **Padrão adotado:** o handler devolve `false` (cancela o repasse ao PTY)
> assim que identifica `Ctrl+V` em aba claude, e **então** resolve async qual
> colagem fazer (`hasImage()` → `pasteImage` ou `pasteText`). Cancelar antes de
> saber o tipo é seguro porque **as duas** saídas de `Ctrl+V` são ações nossas;
> nunca há um caso em que `Ctrl+V` em aba claude devesse passar cru. Para
> `Ctrl+C` não há assincronia: `term.hasSelection()` é sincrônico.

Consequência de projeto: o decisor da Fatia 1 recebe `clipboardHasImage` já
resolvido — quem faz a dança async é a Fatia 3, não o módulo puro.

**Testes:** unit com `electron.clipboard` mockado (imagem vazia × não vazia ×
`readImage` lançando exceção → `false`). `tests/clipboard-bridge.test.ts`.

## Fatia 3 — Ligação no `TerminalPane` (a única mudança visível)

**Arquivo:** `src/renderer/src/TerminalPane.tsx` (bloco do `useEffect` que cria
o `XTerm`, hoje `:322-341`).

1. Manter `term.onData` como está (decisão técnica 2).
2. Adicionar, logo após `term.open(container)`:
   ```ts
   term.attachCustomKeyEventHandler((event) => {
     const action = resolveTerminalKeyAction(event, {
       sessionType: sessionTypeRef.current,
       hasSelection: term.hasSelection(),
       clipboardHasImage: false, // resolvido async no branch de Ctrl+V
     });
     ...
   });
   ```
3. Ações:
   - `copySelection`: `window.donel.clipboard.writeText(term.getSelection())`.
     Não limpar a seleção depois (não foi pedido).
   - `pasteText`: `readText()` → escrever no PTY. Em aba **claude**, envolver em
     `\x1b[200~` … `\x1b[201~` (decisão 4); em aba **shell**, escrever cru.
     Normalizar `\r\n` → `\r`.
   - `pasteImage`: escrever `\x1b\x76` no PTY. **Nada mais.**
   - `noop`: retornar `false` e não fazer nada (C1).
   - `passthrough`: retornar `true`.
4. **`sessionType` via ref, não closure.** O `useEffect` que cria o terminal
   tem `[cwd, sessionType, args]` nas deps, mas o handler sobrevive a
   re-renders; usar um `sessionTypeRef` atualizado a cada render (padrão já
   usado no arquivo com `ptyIdRef`/`mountEpochRef`) evita ler um valor
   congelado. Aba não muda de tipo hoje, mas o padrão do arquivo é esse e o
   custo é uma linha.
5. **Cuidado com o StrictMode/`mountEpochRef`** (comentário longo em
   `:325-334`): o handler é registrado no `term` daquele mount, então morre
   junto com o `term.dispose()` do cleanup — não precisa de desregistro
   próprio. Confirmar que não há registro duplicado por mount.

**Testes:** a lógica testável já saiu para a Fatia 1. Aqui a cobertura é
**smoke roteirizado** (padrão da rodada 5) + o E2E manual da Fatia 4. Não
tentar montar xterm em jsdom só para simular tecla — custo alto, valor baixo.

## Fatia 4 — Roteiro E2E manual (`roteiro-e2e.md`)

O único jeito de fechar CA-4/CA-7/CA-9 é no **app instalado** (`Donel Dev` do
Desktop), com um print de verdade no clipboard. Cobre:
- aba claude: copiar com seleção · `Ctrl+C` sem seleção durante execução longa
  (**a execução não pode morrer** — é a dor original) · colar texto de 1 linha ·
  colar texto de 5 linhas (vira `[Pasted text #N]`) · colar print (`[Image #N]`
  em ~1,5 s) · `Esc` interrompe · `Alt+V` ainda cola imagem · `Ctrl+Shift+C/V`
  ainda funcionam;
- aba shell: `Ctrl+C` mata processo (`ping -t`) · `Ctrl+C` com seleção copia ·
  `Ctrl+V` cola comando;
- regressão C3/CA-9 nas duas: setas, Home/End, PgUp/PgDn, Del, Tab.

## Ordem de entrega e gate

Fatia 1 → 2 → 3 → 4. Fatias 1 e 2 são independentes entre si (arquivos
distintos) e podem ir em paralelo; a 3 depende das duas. **Uma única build/
reinstalação** ao fim da 3 — não reinstalar entre fatias.

Gate por fatia: `npm run typecheck` 0 erros + suíte unit inteira verde
(322 testes hoje na `feature/mvp-p0` + os novos). Nada de push/PR.

## Riscos

| Risco | Mitigação |
|---|---|
| Handler engolir tecla legítima (o risco real desta entrega) | `passthrough` é o **default** do decisor: só as 2 combinações listadas saem dele. Tabela de teste cobre setas/Esc/Tab explicitamente (CA-9). |
| Regressão no terminal shell | `sessionType === 'shell'` só muda `Ctrl+C` **com seleção**; sem seleção segue `passthrough`. CA-6 no roteiro E2E com processo real. |
| `Ctrl+V` cancelado mas colagem falha (clipboard vazio) | Nada é escrito no PTY; nenhum byte espúrio. Aceitável: é o mesmo resultado de colar nada. |
| Versão futura do CLI mudar o binding de `chat:imagePaste` | A constante `\x1b\x76` fica num só lugar (`terminalKeymap.ts`) com comentário apontando para `spike-1-imagem-no-conpty.md`. Se quebrar, é uma linha. |
| Latência de ~1,5 s parecer travamento | Já resolvido pelo CLI (`Pasting…`). Não adicionar UI nossa (CA-4b). |
