# Plano técnico — 004 Nomear sessões

Referência: `spec.md` deste diretório (CA-1..CA-6 + decisões C1..C5 do clarify
de 2026-07-24). Todos os paths relativos a `C:/Users/xansd/seazone/donel-dev`.
Branch: `feature/mvp-p0` (mesma; tudo local, sem push).

**Princípio que atravessa o plano:** o `.jsonl` do Claude é **somente leitura**
para o Donel (C1). O app nunca escreve no transcript — nem para renomear.

## Arquitetura em uma frase

Uma função pura `resolveSessionName(fallback, customTitle, stored)` decide o
nome exibido; o `main` alimenta ela com duas fontes (o `custom-title` lido da
cauda do `.jsonl` e o mapa persistido no `ConfigStore`); a UI só renderiza o
resultado e dispara escrita no mapa. Sidebar e aba consomem o **mesmo** valor
— como já hoje (`tab.name`), então CA-1/CA-3 caem juntas sem duplicar lógica.

## Fatia 0 — Resolução do nome: módulo puro (invisível, entregável sozinho)

**Arquivos:** `src/shared/sessionName.ts` (novo), `src/shared/sessions.ts`

O coração da feature é uma decisão de precedência, e ela tem de ser testável
sem Electron, sem PTY e sem disco. Duas funções puras novas:

1. **`extractCustomTitle(tailText: string): string | null`** — varre linhas
   JSONL e devolve o **último** `{"type":"custom-title","customTitle":…}`
   (nunca o primeiro — `spec.md` §Notas). Tolera: linha parcial no início da
   cauda (a leitura de 8 KB corta no meio de uma linha — descartar a primeira
   linha se não parsear), JSON inválido, `customTitle` vazio/ausente.
2. **`resolveSessionName(input): string`** com o dirty-check de C2:
   ```ts
   type StoredName = { name: string; seenTitle: string | null; updatedAt: string };
   type ResolveInput = {
     fallback: string;                 // nome do projeto | preview (comportamento atual)
     customTitle: string | null;       // último do .jsonl
     stored: StoredName | null;        // ConfigStore
   };
   // regra:
   // stored && stored.seenTitle === customTitle  -> stored.name   (UI vence)
   // stored && stored.seenTitle !== customTitle  -> customTitle    (CLI renomeou depois)
   // !stored                                     -> customTitle ?? fallback
   ```
   Junto vai **`reconcileStoredName(stored, customTitle): StoredName | null`**,
   que devolve `null` quando o `stored` deve ser descartado (caso CLI-vence) —
   é o que mantém o storage de crescer com nomes mortos.

`sessionTabName` (`shared/sessions.ts:49-53`) **não é apagada**: ela passa a
ser o produtor do `fallback`, não a resposta final. Assim CA-2 (sem
`custom-title`, nada regride) é garantido por construção.

**Testes (TDD, este é o módulo onde o TDD paga):** matriz completa do
dirty-check (4 combinações + `seenTitle: null`), último-`custom-title`-vence
com 3 registros no mesmo arquivo, cauda cortada no meio de uma linha, linha
não-JSON, `customTitle` string vazia.

## Fatia 1 — Persistência: mapa de nomes no ConfigStore

**Arquivos:** `src/main/config-store.ts`, `src/shared/` (tipo compartilhado)

- Chave nova no config persistido: `sessionNames: Record<string, StoredName>`
  (`sessionId` → `{ name, seenTitle, updatedAt }`). O padrão do arquivo exige
  tocar **quatro** pontos, nesta ordem (senão a chave é silenciosamente
  descartada na leitura): `AppConfig` (`config-store.ts:57-66`),
  `defaultAppConfig` (`:69-79`), `sanitizeAppConfig` (`:206-224`, campo a
  campo, nunca lança — cai em default) e, por ser consumida pelo renderer,
  `toAppConfigDto` (`:82-89`) + `AppConfigDto` em `src/shared/config.ts`.
  `CONFIG_SCHEMA_VERSION` (`:43`) **não** precisa subir: o `sanitize` já
  tolera config legado sem a chave (default `{}`), e a migração de legados só
  roda quando o `config.json` ainda não existe (`:272-281`).
- API mínima no store: `setSessionName(sessionId, name, seenTitle)`,
  `clearSessionName(sessionId)` (para o "vazio apaga" do C5) e
  `getSessionNames()`. Reusa `writeAppConfig` (`:322-334`) com a escrita
  atômica temp+rename+`fsyncSync` já existente (`:139-147`) — **nada de novo
  mecanismo de I/O**. A parte decidível (`toggleFavorite`, `:227-235`) é o
  modelo a imitar: mutação **pura** sobre o config, I/O por fora.
- **Não** implementar GC de entradas órfãs nesta entrega (sessão apagada do
  disco deixa uma entrada morta de ~100 bytes). Fica anotado como dívida
  consciente no `backlog.md`; inventar limpeza aqui é escopo não pedido.

**Testes:** unit do store — set/clear/get, round-trip em disco (tmpdir, nunca o
`%APPDATA%` real — padrão dos smokes da rodada 5), config legado sem a chave
carrega com `{}`.

## Fatia 2 — Leitura: o indexer passa a devolver o `custom-title`

**Arquivo:** `src/main/session-indexer.ts`

- O `readLastActivity` já lê **só a cauda de 8 KB** de cada `.jsonl`
  (`session-indexer.ts:210-240`) — é exatamente o insumo do
  `extractCustomTitle`. Estender essa leitura para devolver também o último
  `custom-title` encontrado na cauda, **sem uma segunda passada no arquivo**.
- **Gotcha real, decidir na implementação:** o `custom-title` pode estar
  **fora** da cauda de 8 KB — um `/rename` feito no começo de uma sessão longa.
  Nesse caso o nome desapareceria, o que quebra CA-1 justamente nas sessões
  antigas que são o caso de uso do Alexandre. Duas saídas: (a) uma varredura
  completa do arquivo só quando a cauda não trouxe `custom-title` (custo:
  sessões grandes × N sessões na listagem — medir); (b) varredura completa
  sempre, mas com cache por `mtime+size` do arquivo. **Recomendo (a) com
  medição**: a cauda cobre o caso comum (renomeou e continuou trabalhando), e o
  fallback só paga o custo em quem não tem `custom-title` na cauda. Se a
  medição na listagem real do Alexandre passar de ~300 ms, trocar para (b).
- O comentário em `session-indexer.ts:16-19` (que já *menciona* o
  `type: custom-title` como descartado) deixa de valer — atualizar, não deixar
  comentário mentindo.
- O objeto de sessão devolvido ao renderer ganha `customTitle: string | null`.
  O `preview` **continua existindo** (é o `fallback`).

**Testes:** unit do indexer com `.jsonl` de fixture em tmpdir — sessão com
`custom-title` na cauda, com 3 registros (último vence), com o registro só no
começo de um arquivo > 8 KB (cobre o gotcha), e sem nenhum (`null`).

## Fatia 3 — Reflexo ao vivo: `fs.watch` da sessão viva (C3)

> ⚠️ **PEÇA COMPARTILHADA com a 006 (contexto consumido).** A 006 lê a MESMA
> cauda do MESMO `.jsonl` para extrair a última `usage`. Decisão registrada em
> `specs/006-contexto-consumido/plan.md`: **um watcher só**, este, generalizado
> para `transcript-watcher.ts`, emitindo
> `{ sessionId, customTitle, contextTokens }` numa leitura única.
> **Uma mudança obrigatória no que está descrito abaixo:** a regra de emissão
> não pode ser "só quando o `custom-title` mudar" — o `contextTokens` muda a
> cada turn sem rename nenhum. Emitir quando **qualquer** dos dois campos
> mudar. Se a 004 for implementada primeiro, já nascer com os dois campos.

**Arquivos:** `src/main/session-name-watcher.ts` (novo),
`src/main/session-correlation.ts`, `src/main/index.ts`

- **Como se sabe qual arquivo vigiar — melhor do que o esperado:**
  `resolveClaudeCorrelation` (`session-correlation.ts:24-34`) **impõe**
  `--session-id <uuid>` no spawn de toda sessão nova (e reusa o id do `-r`
  quando é retomada). O `main` já tem o id em mãos em `index.ts:212`. Logo o
  path do `.jsonl` é conhecido **antes de o CLI subir** — sem janela cega no
  início da sessão, sem depender de hook. Isto elimina o risco que este plano
  havia previsto ("correlação ausente").
- Watcher novo: no `PTY_CHANNELS.create` de uma sessão `claude`, abre
  `fs.watch` no `.jsonl` daquela sessão com **debounce ~300 ms**; a cada evento
  relê a cauda, roda `extractCustomTitle` e, **só se o valor mudou**, empurra
  ao renderer. Fecha o watcher no `PtyManager.onExit` (a fonte de verdade de
  morte de sessão — inclusive em kill forçado, lição do spike T002; **não**
  confiar no `SessionEnd`).
- **Escopo do watch:** todas as abas `claude` **vivas**, não só a em foco. O
  custo é um handle por aba (o app já vive com 6+ abas) e evita o bug de "trocou
  de aba e o nome não seguiu". `fs.watch` no Windows usa
  `ReadDirectoryChangesW`, sem polling.
- **Push ao renderer** pelo padrão de evento já usado pelo semáforo
  (`webContents.send` — reusar o padrão existente, não criar um segundo
  mecanismo de push).
- Fatia 3 é onde mora o risco de vazamento de handle: o teste tem de provar que
  o watcher **fecha**.

**Testes:** unit com `fs.watch` real em tmpdir (append de um `custom-title` →
callback dispara com o nome novo, dentro do debounce), append que **não** é
`custom-title` → callback **não** dispara, `dispose()` fecha o watcher (asserção
sobre o handle / segundo append não dispara nada).

## Fatia 4 — IPC de escrita (a primeira do app para sessões)

**Arquivos:** `src/main/index.ts` (`SESSION_CHANNELS`, `:344` e volta),
`src/preload/index.ts`, `src/shared/`

- Hoje `SESSION_CHANNELS` tem **um** canal só, `list`, read-only
  (`shared/sessions.ts:19-21`; handler em `index.ts:343-347`). Entram dois:
  `sessions:setName` (grava/limpa no ConfigStore via Fatia 1, carimbando
  `seenTitle` com o `customTitle` corrente) e o evento `sessions:nameChanged`
  (push da Fatia 3), seguindo o padrão de `webContents.send` já usado por
  `PTY_CHANNELS.data/exit` (`index.ts:155,159`) e `SEMAPHORE_CHANNELS.update`
  (`:172`) — **não** criar um segundo mecanismo de push.
- **Expor o `sessionId` ao renderer** (o gap do `spec.md` §Notas): o handler
  `PTY_CHANNELS.create` (`index.ts:192`) já calcula o `correlationId`
  (`:212`) — passa a **devolvê-lo** na resposta do create. É o caminho mais
  barato (nenhum canal novo, nenhum estado novo) e o renderer recebe o id no
  mesmo instante em que cria a aba. Alternativa descartada: acrescentar o id ao
  `SemaphoreUpdate` (`shared/index.ts:133-138`) — acopla nome a semáforo e só
  chegaria no primeiro tick.
- **Validação de C5 vive no `main`, não só na UI:** `trim`, `\r\n` → espaço,
  corte em 60 chars, string vazia após trim → `clearSessionName`. A UI valida
  para dar feedback; o `main` valida porque é ele quem persiste.
- Propagar tipos em `shared` para o contrato ficar ponta a ponta (padrão da
  entrega 002).

**Testes:** unit da validação (mesmo módulo puro, sem IPC); o contrato em si é
coberto pelos smokes da Fatia 5.

## Fatia 5 — UI: edição inline na aba e na sidebar

**Arquivos:** `src/renderer/src/App.tsx`, `design-system` (`TerminalTab` e a
linha da sidebar), `.module.css` correspondentes

- **`TabState`** (`App.tsx:67-79`) ganha `claudeSessionId?: string` (devolvido
  pelo create, Fatia 4) e `customName?: string`. **Não existe `updateTab`
  genérico** no `App.tsx` — o único update parcial é o do pin (`:651`,
  `setTabs` + `.map` + spread). Criar um `updateTab(tabId, partial)` nesse
  mesmo padrão e migrar o pin para ele, em vez de espalhar um terceiro
  `.map` inline. O `tab.name` deixa de ser "o nome" e
  passa a ser o **fallback**; o label renderizado é
  `resolveSessionName(...)`. Os dois pontos de consumo continuam sendo os
  mesmos de hoje — a montagem de `SidebarSession[]` em `App.tsx:768-776` e a
  tab bar em `App.tsx:1010-1022` — ou seja **um** ponto de mudança para cada,
  sem duplicar a regra.
- **Dois componentes, não um:** a aba é
  `design-system/src/components/TerminalTab/TerminalTab.tsx` (props em `:5-19`;
  o nome sai num `<span>` em `:42`, **sem** `onDoubleClick` nem input hoje). A
  linha da sidebar **não tem componente próprio** — é markup inline no
  `src/renderer/src/ProjectSidebar.tsx` (nome em `:173`). Extrair um
  `EditableLabel` compartilhado no design-system para os dois usarem — é o que
  evita escrever o gesto (dbl-click/F2/Enter/Esc/blur) duas vezes com dois
  comportamentos ligeiramente diferentes.
- **Truncagem:** o `TerminalTab.module.css:10` tem `white-space: nowrap` mas
  **não** `overflow: hidden` + `text-overflow: ellipsis` — hoje um nome longo
  não trunca com ellipsis. Como o limite subiu para 60 chars (C5), isso vira
  obrigatório, não cosmético.
- Os dois caminhos que hoje batizam a aba seguem intactos como fallback:
  `App.tsx:410` (nome do projeto) e `App.tsx:462/482` (`sessionTabName`).
- **Gesto (C5):** duplo-clique no label da aba **ou** F2 na aba em foco abre um
  `input` inline no lugar do label (mesma largura, sem pular layout). Enter e
  blur confirmam, Esc cancela e restaura. Idem na linha da sidebar. Enquanto
  edita, o texto do input é o nome atual (selecionado, pronto para sobrescrever).
- **Cuidado de interação (lição do `ProfileSwitcher` na entrega 002):** clicar
  na aba **ativa** a aba e clicar no `×` **fecha** — o duplo-clique não pode
  disparar ativação duas vezes nem o input pode borbulhar clique para o handler
  de ativar/fechar. `stopPropagation` no input e no gesto de edição.
- **Truncagem:** máx 60 chars no dado; na aba, ellipsis por CSS + `title` com o
  nome inteiro (a aba é estreita; 60 chars não caberiam).
- **NADA de cor, ícone ou indicador novo** — o Alexandre foi explícito
  (`spec.md` §Fora de escopo). A única mudança visual é o nome e o input de
  edição.
- **Aba shell (C4):** mesmo gesto, mas grava só em `tab.name` (memória) — não
  chama o IPC de escrita, porque não há `sessionId`.

**Testes:** smoke Playwright novo — `tests/smoke/session-rename.spec.ts`,
rodando por `npm run test:smoke` (config em `tests/smoke/playwright.config.ts`),
**reusando o isolamento do `%APPDATA%` real** de `config-persistence.spec.ts`
(que já exercita exatamente "grava no ConfigStore e sobrevive ao restart" — é o
vizinho mais próximo desta feature) e o padrão de fixture de
`previous-sessions.spec.ts` para a listagem, **sem** abrir sessão real só para
renomear. Casos: duplo-clique edita e Enter persiste o label; Esc restaura;
vazio volta ao fallback; clicar na aba ainda **ativa**; `×` ainda **fecha**;
aba shell renomeia; nome persiste após restart do app.

## Ordem de execução (batches)

1. **Batch A:** Fatia 0 + Fatia 1 + Fatia 2 — toda a regra e a leitura, sem
   nada visível na tela. Fecha com typecheck + unit verdes. É o batch onde a
   feature realmente se decide.
2. **Batch B:** Fatia 4 + Fatia 5 — o rename **pela UI** ponta a ponta
   (CA-3/CA-6). Já é entregável e testável por você sozinho: renomeia, fecha o
   app, reabre, o nome está lá.
3. **Batch C:** Fatia 3 — o reflexo ao vivo (CA-4). Deixado por último de
   propósito: é a fatia de maior risco (watcher, handle, ciclo de vida) e a
   única que não bloqueia o resto. Se travar, os Batches A+B já entregam
   US-A/US-B/US-D.

Cada batch com gate de auditoria (padrão da esteira: opus, ≥95, suíte
**COMPLETA** de smokes verde — lição da rodada 5). Reinstalação + worktree e2e
ao final, com roteiro E2E para sua validação.

## Riscos / gotchas

- **`custom-title` fora da cauda de 8 KB** — o risco funcional nº 1 (quebra
  CA-1 nas sessões antigas, que são o caso de uso). Ver Fatia 2; exige medição,
  não chute.
- **Vazamento de `fs.watch`** — um handle por aba viva, fechado no
  `PtyManager.onExit`. Kill forçado **não** dispara `SessionEnd` (spike T002):
  não pendurar o cleanup nele.
- ~~Correlação ausente~~ — **risco eliminado** na investigação: o `sessionId`
  é imposto no spawn (`--session-id`), não descoberto depois. Toda aba `claude`
  tem id desde o nascimento, então o rename pela UI sempre tem onde persistir.
- **O `.jsonl` pode não existir ainda** quando o watcher abre (o CLI cria o
  arquivo na primeira mensagem). `fs.watch` num path inexistente lança
  `ENOENT` — vigiar o **diretório** da sessão e filtrar pelo nome do arquivo,
  ou tratar o `ENOENT` com um retry. Decidir na implementação; cobrir com teste.
- **Concorrência de escrita no `config.json`** — o mesmo store guarda projetos,
  launcher e notificação; um `setSessionName` durante outra escrita depende da
  atomicidade já existente (temp+rename). Não introduzir um segundo escritor.
- **Regressão de CA-2** — qualquer sessão sem `custom-title` tem de continuar
  exibindo exatamente o que exibe hoje. Teste explícito, não "por inspeção".
- **Dívida herdada, não desta feature:** os 2 smokes de
  `previous-sessions.spec.ts` (resume/fork) estão VERMELHOS por dívida da
  restauração de sessões. Esta feature toca a mesma tela — o gate deve
  registrá-los explicitamente e **não** mascarar como verde (lição da 002).

## Relação com o resto da fila

Entrega independente. Não depende da 002 (quota) nem da 003 (modo dev), e não
colide com a 005 (copiar/colar no terminal — mexe em `TerminalPane`/xterm, não
no label da aba). Toca o mesmo arquivo que a **B5** do `backlog.md` (favoritos
com sub-itens de sessões) — se a B5 entrar depois, herda o nome resolvido de
graça.
