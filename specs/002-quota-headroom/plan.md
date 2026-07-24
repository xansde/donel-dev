# Plano técnico — 002 Quota headroom

Referência: `spec.md` deste diretório. Todos os paths relativos a
`C:/Users/xansd/seazone/donel-dev`. Branch: `feature/mvp-p0` (mesma; tudo
local, sem push).

## Fatia 0 — Destravar o número (o bug; entregável sozinho)

**Arquivo:** `src/main/quota-headroom.ts`

1. **Eliminar o overhead do `npx`** (causa raiz do timeout): resolver o
   binário do `quota-axi` uma vez e chamá-lo direto, em vez de `npx -y
   quota-axi` a cada leitura. Investigar na implementação a melhor forma no
   Windows (candidatos: `npx --no-install quota-axi` se já instalado;
   localizar o `.cmd` em `node_modules/.bin`; ou `npm exec`). Se nenhuma for
   confiável entre máquinas, manter `npx` mas com timeout maior (abaixo).
2. **Timeout de segurança:** subir `DEFAULT_TIMEOUT_MS` de 3000 para ~8000
   (rede, não caminho feliz). A leitura é assíncrona e cacheada 60 s; um
   dropdown que espera alguns segundos com "carregando" é aceitável, travar
   a UI não (não trava — é `await` fora do render).
3. **Estado "carregando":** a UI precisa distinguir "ainda não leu" de "leu
   e falhou". Hoje `null` cobre os dois. Introduzir esse estado (ver Fatia 2).
4. Manter intactas: a regra dura `state.stale`/`state.error` → sem número
   (CA-5) e a decisão de ignorar exit code (só conteúdo decide sucesso).

**Testes:** unit com `spawn` mockado — leitura lenta dentro do novo timeout
retorna número; além do timeout retorna null; binário resolvido chamado sem
`npx` (se essa via for adotada).

## Fatia 1 — Modelo de dados: duas janelas por perfil

**Arquivos:** `src/main/quota-headroom.ts`, `src/shared/profiles.ts`,
`src/preload/index.ts`, `src/main/index.ts` (handler `profiles:headroom`).

- Trocar `ProfileHeadroomMap = Record<string, number | null>` por um shape
  com as duas janelas + estado de carregamento, ex.:
  ```ts
  type QuotaWindow = { percentRemaining: number; resetsAt: string | null };
  type ProfileQuota = {
    status: 'loading' | 'ok' | 'unavailable';
    fiveHour: QuotaWindow | null;
    sevenDay: QuotaWindow | null;
  };
  type ProfileHeadroomMap = Record<string, ProfileQuota>;
  ```
- Nova função pura `parseQuotaAxiWindows(output)` que extrai AS DUAS janelas
  (`five_hour`, `seven_day`) com `percentRemaining` + `resetsAt`, mantendo a
  regra stale/error → `unavailable`. A `parseQuotaAxiHeadroom` atual (um
  número só) ou é reescrita, ou vira um seletor derivado (5h como primária).
- `readAllProfilesHeadroom` devolve o novo shape; cache guarda o objeto.
- Propagar o tipo em `shared` (contrato IPC), `preload` e o handler.

**Impacto obrigatório a ajustar (não deixar quebrar):**
`src/shared/sessionAccountLabel.ts` e `App.tsx` (`computeSessionAccountLabel`,
statusbar) consomem o headroom como número — precisam ler `.fiveHour` do
novo shape. `tests/sessionAccountLabel.test.ts` acompanha.

**Testes:** unit da `parseQuotaAxiWindows` com fixture real (o JSON medido:
five_hour 95% / seven_day 0%), caso stale, caso janela ausente.

## Fatia 2 — UI do dropdown (ProfileSwitcher) + badge/statusbar

**Arquivo:** `src/renderer/src/ProfileSwitcher.tsx` (+ `.module.css`),
possível componente novo no design-system.

- Cada linha de perfil passa a renderizar as DUAS janelas: rótulo ("5h" /
  "semana"), barra colorida por `getHeadroomTier`, "% livre" e reset.
- **Componente de barra:** o design-system NÃO tem barra genérica de % — o
  `SmartZoneMeter` é específico de tokens (used/max), semântica diferente.
  Decisão: criar um componente pequeno `QuotaWindowRow` (ou `QuotaBar`) no
  design-system (não é "recriar" algo existente; é peça nova legítima),
  reusando os tokens de cor de tier já existentes. Alternativa mais barata:
  barra local no ProfileSwitcher.module.css sem componentizar — decidir na
  implementação conforme o reuso esperado (o painel do US-12 vai querer a
  mesma barra → favorece componentizar).
- **Botão "Atualizar"** no topo do Modal: chama `profiles.headroom()` com um
  flag de bypass do cache. `HeadroomCache` ganha um modo de invalidação
  (ex.: `readAllProfilesHeadroom(..., { force: true })` que ignora `get`).
- **Estado "carregando":** enquanto `status === 'loading'`, mostrar
  skeleton/"carregando", não "—".
- **Badge do titlebar + statusbar:** o rótulo composto em
  `onActiveProfileLabelChange` (hoje "`{nome} · {percent}`") passa a rotular
  a janela: ex. "`{nome} · 5h 95%`". `AccountBadge.headroomPercent` continua
  recebendo a 5h. Confirmar que o `loginPending` do AccountBadge cobre o
  caso stale.

**Testes:** smoke Playwright (isolado do %APPDATA% real — já feito na rodada
5) — dropdown mostra duas linhas por perfil; botão "Atualizar" dispara nova
leitura; estado loading→número. Reaproveitar o mock/fixture de quota para
não abrir sessão real.

## Ordem de execução sugerida (batches)

1. **Batch A:** Fatia 0 (destrava) — entregável e testável sozinho; já
   resolve a dor imediata do "—". Pode ir pro teu teste antes do resto.
2. **Batch B:** Fatia 1 (modelo de dados das duas janelas) + ajuste dos
   consumidores (sessionAccountLabel/statusbar).
3. **Batch C:** Fatia 2 (UI do dropdown + botão Atualizar + badge rotulado).

Cada batch com gate de auditoria (padrão da esteira: opus, ≥95, suíte
COMPLETA de smokes verde — lição da rodada 5). Reinstalação + worktree e2e
ao final, com roteiro E2E pra tua validação.

## Riscos / gotchas (herdados, respeitar)

- **Cache global do quota-axi** (`~/.cache/quota-axi/quotas.json`) NÃO é
  escopado por `CLAUDE_CONFIG_DIR` — leitura stale pode trazer número de
  OUTRA conta. A regra `state.stale`/`state.error` → `unavailable` é a
  proteção; não afrouxar.
- **Custo ~3,8 s por chamada × N perfis** em paralelo — o botão "Atualizar"
  com muitos perfis pode levar vários segundos; loading state cobre isso.
- **Regra do projeto:** o app NUNCA lê credenciais — fonte é só o quota-axi
  local. O endpoint OAuth (visto no script da Amanda) fica fora.
- **Perfil sem login** → stale → "—"/"login pendente" legítimo, não bug.

## Numeração das specs (reconciliação)

Esta entrega toma o número **002**. O `002-auto-switch` reservado no backlog
passa a não ter número fixo (segue a ordem de criação); `003-modo-dev`
mantém o número. Atualizado em `specs/backlog.md`.
