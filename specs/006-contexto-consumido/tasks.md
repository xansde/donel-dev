# Tasks 006 — Contexto consumido (% da smart zone na toolbar da sessão)

**Status:** IMPLEMENTADO em 2026-07-26 — T601–T614 fechadas (T605 e T607 já
vinham prontas da 004). Falta a validação humana dos passos que exigem turno
real de modelo (`roteiro-e2e.md`, itens 1/4/5). Branch: `feature/mvp-p0`.
**Atualizado:** 2026-07-26

> **O que mudou em relação ao plano de 24/07** (a 004 entrou antes e mudou o
> terreno; medições novas mudaram duas regras):
> - **T605 e T607 não foram feitas aqui** — `readFileTail` já estava extraído no
>   `session-indexer.ts` e o watcher já existia (`transcript-watcher.ts`, com
>   registry e 15 testes). A Fase B encolheu para T606/T608/T609, como a nota de
>   dependência cruzada previa.
> - **A cauda é de 64 KB, não 8 KB** (a 004 subiu por medição), então a regra
>   "se 8 KB não trouxerem `usage`, re-ler com 64 KB" morreu. **Decisão nova,
>   medida sobre 313 transcripts / 590 MB: uma leitura de 64 KB, SEM re-leitura
>   maior** — 99,7% de cobertura; cobrir o pior momento custaria ~2 MB por
>   rajada. Números em `medicao-t606.md`.
> - **A `usage` fica em `message.usage`**, não no topo da linha (a spec citava um
>   recorte). Conferido no disco antes de escrever o parser.
> - **Decisão que o handoff deixou aberta: a regra "leitura vazia não apaga o
>   valor conhecido" VALE para os tokens** — cauda sem `usage` é lacuna de
>   leitura, não contexto zerado. Com teste dedicado.
> - **Turno de subagente (`isSidechain: true`) é descartado** — o contexto dele
>   não é o da sessão. 0 ocorrências em 319 transcripts; o filtro é seguro
>   contra mudança futura do CLI.
> - **`SessionDetails` recebe `contextTokens`, não `contextPercent`** — é o que
>   faz o CA-6 sair de graça (o denominador depende do `model`, que é prop do
>   mesmo componente), como o próprio `plan.md` descreve na Fatia 2.
> - **UI validada por smoke + módulo puro, não por teste de render** — o repo não
>   tem jsdom/testing-library, e instalar dependência exige OK dele. A lógica de
>   apresentação virou função pura testada (`isOverSmartZone`, `computeContextPercent`,
>   `formatContextTooltip`) e o DOM é asseverado no smoke `session-context.spec.ts`.
> - **Dívida nova nomeada:** `specs/backlog.md` §B15 (`fs.watch` pode perder um
>   evento) e §B16 (token morto `--smart-zone-max-tokens: 400000`).

**Referências:** `spec.md` (CA-1..CA-9, tabela S1/C2 fixada via skill
`claude-api`) + `plan.md` (Fatias 0/1/2) deste diretório.
**14 tasks** — `T601`–`T614`, numeração contígua na ordem de dependência
(Fase A: T601–T604 · Fase B: T605–T609 · Fase C: T610–T614).
**Ordem entre features (24/07):** B11 → 004 → **006 (esta)** → 005. Depende da
004 ter construído o watcher: se ela veio antes, a Fase B aqui encolhe para
T608+T609 (pular T607). Nunca rodar as duas em paralelo — colidem no `.jsonl`.

> **Denominador = smart zone de 300k** (decisão do Alexandre, 24/07), não a
> janela bruta: `zona = min(300_000, janela_do_modelo)`. Em opus/sonnet/fable
> a zona vence (300k); em haiku a janela vence (200k). O `%` **não tem teto** —
> passar da zona mostra `127%`, e acima de 100% o número muda de cor (CA-9).

> **Dependência cruzada com a 004 — LER ANTES DE COMEÇAR.** A 004 já está
> clarificada, planejada e commitada (`fc65258`) e a **Fatia 3 dela** constrói
> o watcher (`src/main/session-name-watcher.ts`, ainda **sem código**). A 006
> **herda** as decisões dela e não as contradiz: watch em **todas as abas
> `claude` vivas** (não só a em foco), **debounce ~300 ms**, ciclo de vida no
> `PTY_CHANNELS.create` / `PtyManager.onExit`.
>
> - **004 antes da 006 (recomendado):** a Fase B daqui encolhe para T608+T609
>   (adicionar `contextTokens` ao payload + regra de emissão). Pular T607.
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

- ✅ **T601 — `MODEL_CONTEXT_WINDOWS` + `normalizeModelAlias` (TDD)** (feito 26/07) — novo
  `src/shared/contextWindow.ts`
  Tabela `ModelAlias → max_input_tokens` conforme spec §S1/C2:
  `fable`/`opus`/`sonnet` = `1_000_000`, `haiku` = `200_000`. Comentário no
  topo do arquivo registrando **a data da conferência (2026-07-24) e a fonte
  (skill `claude-api`)** — este é o arquivo único a revisitar quando a
  Anthropic mudar janelas. `normalizeModelAlias(raw)` faz strip de sufixos de
  deployment (`sonnet[1m]` → `sonnet`) e devolve `null` para alias
  desconhecido (o chamador exibe `—`; **nunca chutar uma janela**).
  Adicionar também `SMART_ZONE_TOKENS = 300_000` (decisão do Alexandre,
  24/07 — comentar que **não** é limite de API nem gatilho de auto-compact) e
  `effectiveContextZone(model) = min(SMART_ZONE_TOKENS, janela)`.
  **DoD:** vitest verde — cada alias devolve a janela da tabela; `'opus[1m]'`
  → `opus`; `'gpt-4'` → `null`; a tabela cobre exaustivamente `ModelAlias`
  (typecheck garante via `Record<ModelAlias, number>`, sem `Partial`);
  `effectiveContextZone('opus')` → `300_000`; `('haiku')` → `200_000` (a janela
  vence o `min` — é o caso que prova a regra).

- ✅ **T602 — `contextTokensFromUsage` (TDD)** (feito 26/07) (sequencial após T601 — mesmo
  arquivo) — `src/shared/contextWindow.ts`
  Soma `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
  (C1). `output_tokens` **não entra** (é geração, não contexto de entrada).
  Campo ausente conta 0; usage **sem nenhum dos três** → `null`, não `0`
  (CA-4). Input é `unknown` (vem de `JSON.parse`) — validar sem lançar.
  **DoD:** vitest verde com a usage real da spec
  (`290 + 1505 + 132807 = 134602`); usage `{}` → null; só `input_tokens: 500`
  → 500; `{output_tokens: 900}` → null; usage não-objeto/`null` → null.

- ✅ **T603 — `computeContextPercent` SEM teto (TDD)** (feito 26/07) (sequencial após T602)
  — `src/shared/contextWindow.ts`
  `% = round(tokens / effectiveContextZone(model) * 100)`, com **piso em 0 e
  SEM teto** (CA-8 revisado 24/07). `tokens === null` → `null` (CA-4, nunca
  `0%`). Alias desconhecido → `null`.
  ⚠️ **Não usar `Math.min(100, ...)`** — travar em 100% tornaria 305k e 700k
  indistinguíveis, que é exatamente a visibilidade que a feature existe para dar.
  **DoD:** vitest verde — `134602` em `opus` → **`45`**; o mesmo em `haiku` →
  **`67`** (prova CA-6 no nível puro); **`380000` em `opus` → `127`** (prova a
  ausência de teto); `tokens = 0` → `0`; `null` → `null`.
  **Este teste é a evidência de CA-2/CA-6/CA-8.**

- ✅ **T604 — Helper de tooltip** (feito 26/07) — `src/shared/contextWindow.ts`
  `formatContextTooltip(tokens, model)` →
  `"134.602 / 300.000 tokens da smart zone · janela opus 1.000.000"`
  (separador de milhar pt-BR via `toLocaleString('pt-BR')`). Mostra a **zona**
  como denominador **e** a janela real do modelo — o número da zona não pode
  esconder a verdade técnica. `null` → string vazia (sem tooltip).
  **DoD:** vitest verde com o caso real; em `haiku` o tooltip mostra zona
  200.000 = janela 200.000; `null` → `''`.

**Gate da Fase A:** `npm run typecheck` + suíte unit verdes. Commitar
(commit de progresso é default nesta branch de feature).

---

## Fase B — Fatia 1: watcher compartilhado com a 004 (main)

> **Se a 004 já entregou o watcher: pular T607 e fazer T608/T609 sobre o
> arquivo dela.** Não construir a peça duas vezes.

- ⏭️ **T605 — Extrair a leitura de cauda para helper compartilhada** — JÁ ESTAVA FEITO na 004 (`readFileTail`, `session-indexer.ts:288`) — `src/main/session-indexer.ts` +
  novo `src/main/transcript-tail.ts`
  O bloco de `fs.open` + `read(TAIL_READ_BYTES)` + split/varredura reversa de
  `readLastActivity` (`session-indexer.ts:210-240`) passa a ser uma helper
  reutilizável (`readTailChunk(filePath, size, bytes)`). `readLastActivity`
  continua existindo e passa a usá-la.
  **DoD:** `tests/` existentes do `SessionIndexer` verdes **sem alteração**
  (é a prova de "sem mudança de comportamento"); nenhuma duplicação do bloco
  de leitura no repo.

- ✅ **T606 — `readTranscriptTail` (TDD)** (feito 26/07, regra da re-leitura REVISADA por medição) (sequencial após T605) —
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

- ⏭️ **T607 — Watcher (watch + debounce + ciclo de vida)** — PULADA: o watcher veio da 004, com 15 testes verdes — (sequencial após T606) — `src/main/transcript-watcher.ts`
  Implementar conforme a **Fatia 3 da 004**, sem redesenhar: `fs.watch` por
  aba `claude` **viva** (abre no `PTY_CHANNELS.create`, fecha no
  `PtyManager.onExit` — nunca no unmount do renderer, que kill forçado não
  dispara), debounce ~300 ms, leitura imediata na abertura, `.jsonl`
  inexistente não lança. **Não** existe `focus()` — escopo é todas as abas
  vivas (a razão está no plano da 004: "trocou de aba e o nome não seguiu").
  **DoD:** vitest com timers fake — rajada de N escritas gera **1** leitura;
  `onExit` fecha o watcher daquela sessão (spy no `close`, sem vazar handle);
  `dispose()` idempotente; path inexistente não lança.

- ✅ **T608 — Payload com os dois campos + regra de emissão** (payload/canal já existiam da 004; aqui o `contextTokens` deixou de ser `null`) (sequencial após
  T607; **é a task mínima se a 004 veio antes**) — `src/shared/`,
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

- ✅ **T609 — Antisséptico anti-duplicação** (verificado 26/07: um `watch()`, um `readFileTail`, nomes de campo só em `contextWindow.ts`)
  Confirmar que existe **um** leitor de cauda no repo e **um** watcher:
  `contextTokens` calculado por `contextTokensFromUsage` (T602), não por uma
  segunda soma inline; nenhum `fs.watch` adicional sobre `.jsonl`.
  **DoD:** `grep -rn "fs.watch" src/` mostra só o watcher compartilhado;
  `grep -rn "cache_read_input_tokens" src/` mostra só `contextWindow.ts`.

**Gate da Fase B:** typecheck + suíte unit verdes. **Não reinstalar o app
entre B e C** — a mudança só aparece para o usuário na Fase C.

---

## Fase C — Fatia 2: estado no renderer + UI na toolbar

- ✅ **T610 — Estado `sessionId → contextTokens` + assinatura do evento** (feito 26/07, REAPROVEITANDO a assinatura única da 004) —
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

- ✅ **T611 — Render do `%` na toolbar** (feito 26/07) (sequencial após T610) —
  `src/renderer/src/SessionDetails.tsx` + `.module.css`
  Prop **opcional** `contextPercent?: number | null` (opcional para não
  quebrar smokes que já montam o componente). Renderiza depois do hint:
  `contexto {n}%` ou `contexto —`, com `data-testid="session-context"` e
  `title` = `formatContextTooltip(...)` (T604, CA-7). Rótulo literal
  **"contexto"** — nunca "cota" nem `%` solto (CA-5, lição da rodada 6).
  Sem barra, sem ícone, sem gradiente por faixa.
  **DoD:** teste de render — `null` → `contexto —`; `45` → `contexto 45%`;
  atributo `title` presente com zona **e** janela.

- ✅ **T612 — Cor acima de 100% (CA-9)** (feito 26/07, token `--zone-over` do design-system) (sequencial após T611) —
  `src/renderer/src/SessionDetails.tsx` + `.module.css`
  Classe `.contextOverZone` aplicada quando `contextPercent > 100`, usando o
  **token de alerta/danger do design-system** — não hex solto no CSS module.
  Expor `data-over-zone="true"` para o teste asseverar sem depender de classe.
  ⚠️ Isto **revisa** o "nada de cor/ícone" da entrevista — aquele veto era
  sobre a **aba** (feature 004); a cor aqui foi decidida por ele em 24/07.
  **DoD:** teste de render — `45` → sem `data-over-zone`; `100` → **sem**
  (o gatilho é `> 100`, não `>=`); `127` → `data-over-zone="true"`; nenhum
  valor de cor literal no CSS module (só token do design-system).

- ✅ **T613 — CA-6 no nível de UI (troca de modelo)** (coberto pelo unit puro; passo com sessão viva no roteiro E2E) (sequencial após T612)
  O `%` é derivado de `computeContextPercent(tokens, model)` usando a prop
  `model` **já existente** do `SessionDetails` — nenhum estado novo. Trocar o
  modelo re-renderiza e o denominador muda sozinho.
  **DoD:** teste de render que troca só a prop `model` (mesmos tokens,
  `134602`) e observa **`45%` → `67%`** (opus zona 300k → haiku janela 200k).

- ✅ **T614 — Roteiro E2E manual (para o Alexandre)** (feito 26/07: `roteiro-e2e.md`) — novo
  `specs/006-contexto-consumido/roteiro-e2e.md`
  Passos: (1) abrir sessão claude, mandar um prompt, ver o `%` aparecer e
  subir; (2) hover no número → tooltip com zona **e** janela real; (3) trocar
  opus→haiku na toolbar → `%` salta (45% → 67%); (4) rodar `/compact` → `%`
  **cai** (prova de C1: última usage, não acumulado); (5) **sessão longa passando
  de 300k → `%` passa de 100% e muda de cor** (CA-8/CA-9 — o cenário que ele
  pediu para ter visibilidade); (6) aba shell → `contexto —`; (7) aba
  recém-nascida sem turno → `—`, nunca `0%`; (8) trocar de aba → cada aba
  mostra o próprio número.
  **DoD:** roteiro escrito; execução é ato do Alexandre. O passo (5) é o único
  que exige uma sessão real grande — anotar que pode ser validado numa sessão
  de trabalho normal ao longo do dia, não num teste dedicado.

**Gate da Fase C:** suíte completa (unit + 16 smokes de produção + smoke de
modo dev) verde **antes** de considerar a entrega fechada — a rodada 5/6 ficou
com auditoria interrompida em 88/87 por pular isso; não repetir.

---

## Riscos e o que pode dar errado

| Risco | Mitigação nesta lista |
|---|---|
| 8KB de cauda sem nenhuma `usage` (turno longo com muitos `tool_result`) | T606: re-leitura única de 64KB; nunca o arquivo inteiro |
| Linha cortada no início do chunk lido | T606: caso de teste explícito + `try/catch` por linha |
| StrictMode matando o watcher (bug histórico do PTY) | T610: cleanup idempotente + `test:smoke:dev` no DoD |
| Watcher duplicado entre 004 e 006 | Fase B herda o watcher da 004 (não cria outro); T609 é o grep que prova |
| Regra de emissão da 004 (só quando `custom-title` muda) engolir o update de tokens | T608: emitir se **qualquer** campo mudou — com teste da regressão |
| Duas assinaturas de `onTranscriptChanged` no App | T610: assinatura única no nível do App, reaproveitada pela 004 |
| Tabela de janelas envelhecer silenciosamente | T601: arquivo isolado com data e fonte da conferência no topo |
| `%` sempre baixo (1M) parecer bug | **resolvido na origem:** denominador é a smart zone de 300k, não a janela |
| 300k é heurística, não fato da API | Constante única e comentada (T601); tooltip sempre mostra a janela real ao lado |
| Alguém "consertar" o `>100%` achando que é bug | T603: teste de `127%` + comentário no código explicando que é intencional (CA-8) |
| Cor hardcoded fugindo do design-system | T612: DoD proíbe valor de cor literal no CSS module |
| Confusão com o `%` de cota já na tela | T611: rótulo literal "contexto", posição na toolbar por-aba |

## Fora destas tasks

Barra/cor/smart zone (US-8 completo → 003); consulta a `GET /v1/models` em
runtime; histórico de consumo, custo em $, nº de mensagens, distância até o
auto-compact; renomear/persistir nome de sessão (004, mesmo watcher).
