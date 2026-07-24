# Tasks 002 — Quota headroom (destravar + dropdown enriquecido)

**Status:** PLANEJADO — aguardando OK do Alexandre para implementar (gate de
execução). Branch: `feature/mvp-p0` (mesma; tudo local, sem push).
**Atualizado:** 2026-07-24
**Referências:** `spec.md` (CA-1..CA-7) + `plan.md` (Fatias 0/1/2) deste
diretório. Payload real do `quota-axi --json` medido em 2026-07-24 (janelas
`five_hour`/`seven_day`/`model:fable` com `percentRemaining` + `resetsAt`).

> **Fatia 0 (US-A) JÁ ENTREGUE** — commits `dc46932` (resolve o binário do
> quota-axi em vez de `npx`, mata o timeout) + `28fc534` (estado carregando).
> Instalada e validada por E2E manual em 2026-07-24 (dropdown mostra número,
> nunca "—"). Estas tasks cobrem o que falta: **Batch B** (modelo de dados) e
> **Batch C** (UI). Escopo das janelas: só 5h + semana — `model:fable` fica
> fora (vai pro painel US-12).

Convenções: [P] = paralelizável com a anterior; DoD = definition of done.
TDD nos módulos puros (`parseQuotaAxiWindows`, `computeSessionAccountLabel`);
UI valida por smoke roteirizado (isolado do `%APPDATA%` real, mock/fixture de
quota — padrão da rodada 5, nunca abrir sessão real só pra ler cota).

## Fase A — Batch B: modelo de dados das duas janelas (invisível ao usuário)

> Nada nesta fase muda a tela. Fecha com typecheck + suíte unit verdes; a
> mudança só aparece pro usuário na Fase B. Por isso B e C entram juntos numa
> build — não reinstalar entre as fases.

- **T201 — `parseQuotaAxiWindows` (TDD, módulo puro)** — `src/main/quota-headroom.ts`
  Nova função pura que extrai as janelas `five_hour`, `seven_day` E
  `model:fable` com `{ percentRemaining, resetsAt }` (`model:fable` pode vir
  sem `resetsAt` → tolerar `null`), mantendo a regra dura CA-5:
  `state.stale`/`state.error` → `unavailable` (nunca número de fallback de
  cache, que pode ser de outro perfil). Adicionar `resetsAt` e `label`/`kind`
  à interface `QuotaAxiWindow` (`:26-30`, hoje só `id`/`kind?`/`percentRemaining?`).
  `parseQuotaAxiHeadroom` atual (`:58`) vira seletor derivado (5h primária)
  OU é reescrita — decidir sem quebrar quem a chama.
  **DoD:** vitest verde com fixture do payload real (five_hour 97% / seven_day
  100% / model:fable 100% + `resetsAt` ISO), caso stale → unavailable, caso
  janela ausente → null naquela janela, caso fable sem `resetsAt` → resetsAt
  null. Não confiar em `code`/`signal` (só conteúdo — contrato herdado).

- **T202 — Shape `ProfileQuota` + contrato IPC** (sequencial após T201 — mesmo arquivo) — `src/main/quota-headroom.ts`, `src/shared/`, `src/preload/index.ts`, `src/main/index.ts`
  Trocar `ProfileHeadroomMap = Record<string, number | null>` por:
  ```ts
  type QuotaWindow = { percentRemaining: number; resetsAt: string | null };
  type ProfileQuota = {
    status: 'loading' | 'ok' | 'unavailable';
    fiveHour: QuotaWindow | null;
    sevenDay: QuotaWindow | null;
    fable: QuotaWindow | null; // revelado só na expansão (CA-2b)
  };
  type ProfileHeadroomMap = Record<string, ProfileQuota>;
  ```
  Propagar o tipo em `shared` (contrato IPC), `preload` e o handler
  `profiles:headroom` (`main/index.ts`).
  **DoD:** typecheck verde; contrato IPC refletindo o novo shape ponta a ponta.

- **T203 — `HeadroomCache` + `readAllProfilesHeadroom` no novo shape** (sequencial após T202) — `src/main/quota-headroom.ts`
  Cache (`:255-274`) passa a guardar o objeto `ProfileQuota`, não `number|null`.
  **`unavailable` NÃO é cacheado (CA-5, decisão 24/07): sempre relido** — só
  entradas `ok` respeitam o TTL de 60s (perfil que fez `/login` reflete na
  próxima leitura, sem esperar o TTL). `readAllProfilesHeadroom` (`:287`)
  devolve `ProfileHeadroomMap` novo, mantendo o paralelismo (`Promise.all`).
  **DoD:** vitest do cache (get/set/expiração + `unavailable` nunca servido do
  cache) verde com o novo tipo.

- **T204 — Ajustar consumidores sem quebrar** — `src/shared/sessionAccountLabel.ts`, `src/renderer/src/App.tsx`, design-system `AccountBadge`
  `computeSessionAccountLabel` (`sessionAccountLabel.ts:61`) hoje recebe
  `headroomPercent: number` — passa a ler `.fiveHour.percentRemaining` do novo
  shape. `App.tsx` (`profileHeadroom`, `computeSessionAccountLabel`) e o
  `AccountBadge.headroomPercent` continuam recebendo a 5h.
  **DoD:** `tests/sessionAccountLabel.test.ts` atualizado e verde; typecheck
  verde; suíte unit COMPLETA verde (fim do Batch B, nada visível mudou).

## Fase B — Batch C: UI do dropdown + badge (o que o usuário vê)

- **T205 — Botão "Atualizar" + bypass de cache (US-C / CA-3)** — `src/main/quota-headroom.ts`, `ProfileSwitcher.tsx`
  `HeadroomCache`/`readAllProfilesHeadroom` ganham modo de invalidação
  (`{ force: true }` ignora o `get`). Botão "Atualizar" no topo do Modal
  chama `profiles.headroom()` com bypass; some/desabilita enquanto relê
  (custo ~1.6s/perfil resolvido × N — loading cobre).
  **DoD:** smoke dispara releitura ignorando cache; botão desabilita durante.

- **T206 — Dropdown: 5h (barra) + semana (texto) + Fable sob expansão (US-B / CA-2 / CA-2b)** — `ProfileSwitcher.tsx` (`:230-276`), `.module.css`
  Colapsado: 5h com barra colorida (`getHeadroomTier`), rótulo "5h", "% livre"
  e reset; semana em texto abaixo ("semana 100% livre · reset 31/07"), sem
  barra. Estado `status==='loading'` → skeleton/"carregando", nunca "—".
  **Expansão (CA-2b):** chevron dedicado na linha com `onClick` +
  `stopPropagation` (não ativa a conta) alternando `expandedSlug` local;
  expandido mostra "fable X% livre". **Clique no corpo da linha continua
  ativando a conta** (`handleActivate`) — gesto primário, fácil. No branch
  `AccountBadge` (`:240-247`), o chevron fica FORA da área clicável do badge
  ou usa `stopPropagation`. Barra: começar local no `.module.css` (só a 5h
  tem barra); extrair `QuotaBar` pro DS fica pro US-12.
  **DoD:** smoke — cada perfil mostra 5h+semana rotuladas (% livre + reset),
  loading→número; expandir revela fable SEM ativar a conta; clicar no corpo
  ativa a conta SEM expandir. Reusa mock/fixture de quota (sem sessão real).

- **T207 — Lista enxuta: remover "Perfil OK", erro vira ícone+tooltip (CA-7)** — `ProfileSwitcher.tsx` (`:256-272`), `.module.css`
  Remover o branch `doctorOk` (`:268-272`) — perfil saudável = linha sem
  status. Manter `doctorWarning` (`:256-267`): trocar por ícone de alerta com
  tooltip no hover ("Junctions com problema"); botão "Recriar links" segue
  VISÍVEL na linha (fora do tooltip). Tooltip: usar componente do
  design-system se existir; senão `title` nativo no ícone (fallback barato).
  **DoD:** linha saudável não renderiza texto de status; smoke do estado de
  erro (ícone presente, ação de reparo clicável).

- **T208 — Badge titlebar + statusbar rotulam a janela (CA-4)** — `ProfileSwitcher.tsx` (`:204-212`), `sessionAccountLabel.ts`
  Rótulo composto passa de "`{nome} · {percent}`" para "`{nome} · 5h {percent}%`"
  (5h explícita, não % ambíguo). `AccountBadge.headroomPercent` continua na 5h.
  Confirmar que o caso stale/`loginPending` do AccountBadge segue coberto.
  **DoD:** `sessionAccountLabel.test.ts` cobrindo o novo rótulo; smoke do
  badge/statusbar; nada quebra com 0 sessões / perfil sem leitura.

## Gate final (antes de declarar pronto)

- **T209 — Gate de qualidade + reinstalação + E2E**
  Suíte COMPLETA verde: typecheck + unit + **smokes** (lição da rodada 5 — não
  interromper antes do gate). Auditoria opus ≥95 (padrão da esteira).
  `npm run build` + `npm run dist`, reinstalar, e roteiro E2E novo pra
  validação do Alexandre (foco: as duas janelas rotuladas, botão Atualizar,
  lista sem "Perfil OK", tooltip de erro).
  > Nota: os 2 smokes de `previous-sessions.spec.ts` (T013 — resume/fork)
  > estão VERMELHOS por dívida da feature de restauração de sessões (código
  > disjunto desta entrega, ver `feedback-e2e.md`). Não são regressão da 002,
  > mas o gate deve registrá-los explicitamente — não mascarar como "verde".

## Ordem e dependências

- Fase A (T201→T204) é pré-requisito da Fase B (a UI consome o shape novo).
  T201→T202→T203→T204 rodam SEQUENCIAIS (todas tocam `quota-headroom.ts` /
  o contrato — nada de `[P]` aqui, evita conflito no mesmo arquivo).
- Fase B: T205 (força cache) e T206 (duas janelas) dependem de A; T207/T208
  são independentes entre si. T209 fecha tudo.
- **B e C numa build só** — o Batch B é invisível, não se reinstala no meio.
