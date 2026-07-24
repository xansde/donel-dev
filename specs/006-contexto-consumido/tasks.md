# Tasks 006 — Contexto consumido (% da janela na toolbar da sessão)

**Status:** PLANEJADO — aguardando OK do Alexandre para implementar (gate de
execução). Branch: `feature/mvp-p0` (mesma; tudo local, sem push).
**Atualizado:** 2026-07-24
**Referências:** `spec.md` (CA-1..CA-8, tabela S1/C2 fixada via skill
`claude-api`) + `plan.md` (Fatias 0/1/2) deste diretório.

> **Dependência cruzada com a 004 — LER ANTES DE COMEÇAR.** A 004 já está
> clarificada, planejada e commitada (`fc65258`) e a **Fatia 3 dela** constrói
> o watcher (`src/main/session-name-watcher.ts`, ainda **sem código**). A 006
> **herda** as decisões dela e não as contradiz: watch em **todas as abas
> `claude` vivas** (não só a em foco), **debounce ~300 ms**, ciclo de vida no
> `PTY_CHANNELS.create` / `PtyManager.onExit`.
>
> - **004 antes da 006 (recomendado):** a Fase B daqui encolhe para T613+T614
>   (adicionar `contextTokens` ao payload + regra de emissão). Pular T612.
> - **006 antes da 004:** construir o watcher **já com os dois campos**.
> - **NUNCA dois watchers** lendo o mesmo `.jsonl`. Se a 004 já começou,
>   estender o arquivo dela.

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros (`contextWindow`, `readTranscriptTail`); UI valida por
smoke roteirizado isolado do `%APPDATA%` real, com fixture de transcript —
**nunca** abrir sessão real de Claude só para ler contexto (padrão da rodada 5).

---

## Fase A — Fatia 0: núcleo puro (invisível ao usuário, mergeável sozinho)

> Nada nesta fase muda a tela. É a parte que **não pode estar errada** — a
> tabela de janelas e a aritmética — e é 100% pura, sem Electron/fs/React.

- **T601 — `MODEL_CONTEXT_WINDOWS` + `normalizeModelAlias` (TDD)** — novo
  `src/shared/contextWindow.ts`
  Tabela `ModelAlias → max_input_tokens` conforme spec §S1/C2:
  `fable`/`opus`/`sonnet` = `1_000_000`, `haiku` = `200_000`. Comentário no
  topo do arquivo registrando **a data da conferência (2026-07-24) e a fonte
  (skill `claude-api`)** — este é o arquivo único a revisitar quando a
  Anthropic mudar janelas. `normalizeModelAlias(raw)` faz strip de sufixos de
  deployment (`sonnet[1m]` → `sonnet`) e devolve `null` para alias
  desconhecido (o chamador exibe `—`; **nunca chutar uma janela**).
  **DoD:** vitest verde — cada alias devolve a janela da tabela; `'opus[1m]'`
  → `opus`; `'gpt-4'` → `null`; a tabela cobre exaustivamente `ModelAlias`
  (typecheck garante via `Record<ModelAlias, number>`, sem `Partial`).

- **T602 — `contextTokensFromUsage` (TDD)** (sequencial após T601 — mesmo
  arquivo) — `src/shared/contextWindow.ts`
  Soma `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
  (C1). `output_tokens` **não entra** (é geração, não contexto de entrada).
  Campo ausente conta 0; usage **sem nenhum dos três** → `null`, não `0`
  (CA-4). Input é `unknown` (vem de `JSON.parse`) — validar sem lançar.
  **DoD:** vitest verde com a usage real da spec
  (`290 + 1505 + 132807 = 134602`); usage `{}` → null; só `input_tokens: 500`
  → 500; `{output_tokens: 900}` → null; usage não-objeto/`null` → null.

- **T603 — `computeContextPercent` com clamp (TDD)** (sequencial após T602)
  — `src/shared/contextWindow.ts`
  `% = round(tokens / janela * 100)`, **clampado em 0–100** (CA-8).
  `tokens === null` → `null` (CA-4, nunca `0%`). Alias desconhecido → `null`.
  **DoD:** vitest verde — `134602` em `opus` → `13`; o mesmo em `haiku` → `67`
  (prova o CA-6 no nível puro); `tokens > janela` → `100`; `tokens = 0` → `0`;
  `null` → `null`. **Este teste é a evidência de CA-2/CA-6/CA-8.**

- **T604 [P] — Helper de tooltip** — `src/shared/contextWindow.ts`
  `formatContextTooltip(tokens, model)` → `"134.602 / 1.000.000 tokens · opus"`
  (separador de milhar pt-BR via `toLocaleString('pt-BR')`). `null` → string
  vazia (sem tooltip).
  **DoD:** vitest verde com o caso real; `null` → `''`.

**Gate da Fase A:** `npm run typecheck` + suíte unit verdes. Commitar
(commit de progresso é default nesta branch de feature).

---

## Fase B — Fatia 1: watcher compartilhado com a 004 (main)

> **Se a 004 já entregou o watcher: pular T612 e fazer T613/T614 sobre o
> arquivo dela.** Não construir a peça duas vezes.

- **T610 — Extrair a leitura de cauda para helper compartilhada (refactor
  sem mudança de comportamento)** — `src/main/session-indexer.ts` +
  novo `src/main/transcript-tail.ts`
  O bloco de `fs.open` + `read(TAIL_READ_BYTES)` + split/varredura reversa de
  `readLastActivity` (`session-indexer.ts:210-240`) passa a ser uma helper
  reutilizável (`readTailChunk(filePath, size, bytes)`). `readLastActivity`
  continua existindo e passa a usá-la.
  **DoD:** `tests/` existentes do `SessionIndexer` verdes **sem alteração**
  (é a prova de "sem mudança de comportamento"); nenhuma duplicação do bloco
  de leitura no repo.

- **T611 — `readTranscriptTail` (TDD)** (sequencial após T610) —
  `src/main/transcript-watcher.ts` (= o `session-name-watcher.ts` da 004,
  renomeado; se a 004 já criou o arquivo, estender **aquele**)
  Devolve `{ contextTokens, customTitle }` numa **única** varredura reversa da
  cauda: `contextTokens` = `contextTokensFromUsage` da primeira linha
  `assistant` com `usage` encontrada de baixo para cima (= a última do
  arquivo); `customTitle` = primeiro `custom-title` de baixo para cima (= o
  último). Para assim que tiver os dois. `try/catch` por linha, **nunca
  lança**, `null` em qualquer falha.
  **Retentativa única:** se 8KB não contiverem nenhuma `usage`, re-ler com
  64KB antes de devolver `null`. **Jamais ler o arquivo inteiro.**
  **DoD:** vitest verde com fixtures `.jsonl` em tmpdir — última de várias
  usages vence; último de vários `custom-title` vence; **linha cortada no
  início do chunk** não lança (caso explícito); arquivo sem usage em 8KB
  dispara a re-leitura de 64KB (spy na helper); arquivo vazio → ambos `null`;
  arquivo inexistente → ambos `null` sem lançar.

- **T612 — Watcher (watch + debounce + ciclo de vida)** — *PULAR se a 004 já
  entregou* — (sequencial após T611) — `src/main/transcript-watcher.ts`
  Implementar conforme a **Fatia 3 da 004**, sem redesenhar: `fs.watch` por
  aba `claude` **viva** (abre no `PTY_CHANNELS.create`, fecha no
  `PtyManager.onExit` — nunca no unmount do renderer, que kill forçado não
  dispara), debounce ~300 ms, leitura imediata na abertura, `.jsonl`
  inexistente não lança. **Não** existe `focus()` — escopo é todas as abas
  vivas (a razão está no plano da 004: "trocou de aba e o nome não seguiu").
  **DoD:** vitest com timers fake — rajada de N escritas gera **1** leitura;
  `onExit` fecha o watcher daquela sessão (spy no `close`, sem vazar handle);
  `dispose()` idempotente; path inexistente não lança.

- **T613 — Payload com os dois campos + regra de emissão** (sequencial após
  T612; **é a task mínima se a 004 veio antes**) — `src/shared/`,
  `src/main/transcript-watcher.ts`, `src/main/index.ts`,
  `src/preload/index.ts`
  Payload tipado `{ sessionId, customTitle, contextTokens }`.
  **Mudança de contrato sobre o plano da 004:** ela emitia só quando o
  `custom-title` mudava — isso **não serve** para a 006, porque
  `contextTokens` muda a cada turn sem `custom-title` novo. Nova regra:
  **emitir quando QUALQUER um dos dois campos mudar** em relação ao último
  emit daquela sessão (comparação por valor, para não spammar o renderer).
  `onTranscriptChanged(cb): () => void` no preload (devolve unsubscribe).
  **DoD:** typecheck verde, zero `any` no payload; teste: append de
  `custom-title` → emite; turno novo que só muda a usage → **emite**
  (é a regressão que a regra antiga causaria); append irrelevante que não muda
  nenhum campo → **não** emite.

- **T614 — Antisséptico anti-duplicação** (verificação, não código novo)
  Confirmar que existe **um** leitor de cauda no repo e **um** watcher:
  `contextTokens` calculado por `contextTokensFromUsage` (T602), não por uma
  segunda soma inline; nenhum `fs.watch` adicional sobre `.jsonl`.
  **DoD:** `grep -rn "fs.watch" src/` mostra só o watcher compartilhado;
  `grep -rn "cache_read_input_tokens" src/` mostra só `contextWindow.ts`.

**Gate da Fase B:** typecheck + suíte unit verdes. **Não reinstalar o app
entre B e C** — a mudança só aparece para o usuário na Fase C.

---

## Fase C — Fatia 2: estado no renderer + UI na toolbar

- **T620 — Estado `sessionId → contextTokens` + assinatura do evento** —
  `src/renderer/src/App.tsx`
  `useState<Record<string, number | null>>` chaveado por **`sessionId`** (o
  watcher cobre todas as abas vivas; não há "aba observada"). **Uma** única
  assinatura de `onTranscriptChanged` no nível do App — se a 004 já assinou
  para o `customTitle`, **reaproveitar a assinatura**, não abrir a segunda.
  A aba resolve o próprio número pelo `sessionId` dela no render; abas
  `sessionType: 'shell'` não têm `sessionId` de Claude → `null` (CA-4).
  **Cuidado com o StrictMode** (bug histórico do PTY): cleanup idempotente,
  seguindo o precedente do `mountEpochRef` — o cleanup de uma montagem antiga
  não pode cancelar a assinatura da montagem nova.
  **DoD:** typecheck verde; `npm run test:smoke:dev` (smoke de modo dev,
  StrictMode) verde — é o guard-rail contra a regressão histórica.

- **T621 — Render do `%` na toolbar** (sequencial após T620) —
  `src/renderer/src/SessionDetails.tsx` + `.module.css`
  Prop **opcional** `contextPercent?: number | null` (opcional para não
  quebrar smokes que já montam o componente). Renderiza depois do hint:
  `contexto {n}%` ou `contexto —`, com `data-testid="session-context"` e
  `title` = `formatContextTooltip(...)` (T604, CA-7). Rótulo literal
  **"contexto"** — nunca "cota" nem `%` solto (CA-5, lição da rodada 6). Sem
  cor, sem barra, sem ícone: escopo é só o número.
  **DoD:** teste de render — `null` → `contexto —`; `13` → `contexto 13%`;
  atributo `title` presente com tokens/janela/modelo.

- **T622 — CA-6 no nível de UI (troca de modelo)** (sequencial após T621)
  O `%` é derivado de `computeContextPercent(tokens, model)` usando a prop
  `model` **já existente** do `SessionDetails` — nenhum estado novo. Trocar o
  modelo re-renderiza e o denominador muda sozinho.
  **DoD:** teste de render que troca só a prop `model` (mesmos tokens) e
  observa `13%` → `67%`.

- **T623 — Roteiro E2E manual (para o Alexandre)** — novo
  `specs/006-contexto-consumido/roteiro-e2e.md`
  Passos: (1) abrir sessão claude, mandar um prompt, ver o `%` aparecer e
  subir; (2) hover no número → tooltip com tokens/janela/modelo; (3) trocar
  opus→haiku na toolbar → `%` salta; (4) rodar `/compact` → `%` **cai**
  (prova de C1: última usage, não acumulado); (5) aba shell → `contexto —`;
  (6) aba recém-nascida sem turno → `—`, nunca `0%`; (7) trocar de aba →
  cada aba mostra o próprio número.
  **DoD:** roteiro escrito; execução é ato do Alexandre.

**Gate da Fase C:** suíte completa (unit + 16 smokes de produção + smoke de
modo dev) verde **antes** de considerar a entrega fechada — a rodada 5/6 ficou
com auditoria interrompida em 88/87 por pular isso; não repetir.

---

## Riscos e o que pode dar errado

| Risco | Mitigação nesta lista |
|---|---|
| 8KB de cauda sem nenhuma `usage` (turno longo com muitos `tool_result`) | T611: re-leitura única de 64KB; nunca o arquivo inteiro |
| Linha cortada no início do chunk lido | T611: caso de teste explícito + `try/catch` por linha |
| StrictMode matando o watcher (bug histórico do PTY) | T620: cleanup idempotente + `test:smoke:dev` no DoD |
| Watcher duplicado entre 004 e 006 | Fase B herda o watcher da 004 (não cria outro); T614 é o grep que prova |
| Regra de emissão da 004 (só quando `custom-title` muda) engolir o update de tokens | T613: emitir se **qualquer** campo mudou — com teste da regressão |
| Duas assinaturas de `onTranscriptChanged` no App | T620: assinatura única no nível do App, reaproveitada pela 004 |
| Tabela de janelas envelhecer silenciosamente | T601: arquivo isolado com data e fonte da conferência no topo |
| `%` sempre baixo (1M) parecer bug | CA-7/T621: rótulo + tooltip explicando tokens/janela |
| Confusão com o `%` de cota já na tela | T621: rótulo literal "contexto", posição na toolbar por-aba |

## Fora destas tasks

Barra/cor/smart zone (US-8 completo → 003); consulta a `GET /v1/models` em
runtime; histórico de consumo, custo em $, nº de mensagens, distância até o
auto-compact; renomear/persistir nome de sessão (004, mesmo watcher).
