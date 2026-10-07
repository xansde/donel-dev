---
card_id: wi-011-etapa1-motor-mods
fase: validar
repo_alvo: C:/Users/xansd/seazone/donel-dev
branch: esteira/contas-e-provedores
worktree_path: C:/Users/xansd/seazone/donel-dev
model: opus
effort: high
disparado_por: run-293a2665-5be (esteira-donel local, sem TaskDex) — rodada 2
disparado_em: 2026-08-04T20:05:00Z
handoff_anterior: C:/Users/xansd/seazone/donel-dev/.esteira/implementar/handoffs/wi-011-etapa1-motor-mods/implementar-result.json
kit_version: 2.1.0
---

# Contexto de entrada — Validar (011, etapa 1) — RODADA 2

Esta é a **segunda rodada** de Validar sobre o mesmo card. A rodada 1
(`validar-result.json` anterior, `success`, risco sensível, 0 blocking
findings) aprovou o código como estava em `b722f53`. Depois dela, o dogfooding
manual no alfa achou **quatro defeitos reais** que a rodada 1 não pegou, e eles
foram corrigidos em 4 commits novos. É esse acréscimo que precisa de revisão.

## Intenção do card (inalterada)

Etapa 1 da spec 011: motor de contas **inerte** (`accounts.mod=null`) + mod
Seazone + mod local + auto-switch 90/20, executando T1102–T1131. Regras duras:
`CredentialPair` nunca sai de `src/main/accounts/`; única escrita de credencial
em `claude-state.ts` na ordem invariante; mod Seazone estruturalmente incapaz
de renovar token; nada de perfis removido; as 4 suítes de perfil verdes.

## O que mudou desde a rodada 1 (o diff a revisar)

Base do incremento: `e8b54d0..HEAD` — 14 arquivos, +837/-72.

- **`5571b73`** — três achados da captura visual:
  1. `applyAccountsClaudeStateSwitch` derivava `claudeJsonPath` de `homedir()`
     sempre, então o override `accounts.claudeHome` isolava só metade do alvo.
     Os 3 smokes da etapa 1 **apagavam o `oauthAccount` do `~/.claude.json`
     real da máquina** — comprovado na prática (o login do CLI caiu e foi
     restaurado de backup). Agora o `.claude.json` acompanha o override.
  2. A recusa do formulário de conectar sobrevivia à troca de provedor.
  3. O rodapé do painel de perfis prometia "o app nunca lê nem grava
     credenciais", falso desde esta etapa.
- **`4445c39`** — placeholder da URL do switcher (`switcher.seazone.dev` não
  existe; a real é `claude-switcher-api.seazone.dev`).
- **`25ebb5b`** — o mod Seazone falava um contrato que a API não fala. Quatro
  divergências (rota `/auth/exchange`→`/auth/refresh`, campo `jwt`→`accessJwt`,
  `/accounts` devolve lista e o identificador é o `label`, carga em
  `fiveHourUtil`/`sevenDayUtil`), mais três regras não registradas: rotação do
  `sessionRefreshToken`, `expiresAt` ISO no heartbeat, e `keepAlive` que batia
  num endpoint que exige corpo. Os dublês da suíte passaram a nascer de
  **respostas capturadas** da API real.
- **`a2824d5`** — B25 no backlog (escopo novo, deliberadamente fora da etapa).

## Verificação já feita nesta sessão (confirmar, não repetir)

- `npm test`: 92 arquivos / **1709** testes verdes (eram 1699; +10 de contrato).
- `npm run typecheck`: limpo.
- **4 smokes** de contas (T1126/T1127/T1128) — rodados de verdade, passam, e o
  `~/.claude.json` real fica intacto (antes da correção, 2 falhavam E davam o
  dano).
- **2 roteiros de captura visual** (`contas-motor-{inerte,ativo}`), 17 prints,
  relatórios HTML gerados e conferidos um a um.
- **Dogfooding no alfa contra o servidor real**: conectou o pool Seazone,
  listou 61 contas com carga real na tela. As 4 divergências de contrato estão
  provadas ponta a ponta.

## O que continua NÃO verificado (não inventar cobertura)

- `POST /session/switch` real nunca foi exercitado — testá-lo troca a
  credencial do CLI da máquina. O formato do `expiresAt` na resposta dele foi
  **inferido**; o parser aceita epoch e ISO por robustez, não por confirmação.
- Seções 2, 4, 5 e 6 do `e2e.md` (pool próprio com credencial real, auto-switch
  em tempo real, heartbeat de 15 min contra o servidor, máquina sem
  `safeStorage`) seguem sem execução.
- Achado conhecido e **aceito sem correção** (decisão do dono, 04/08): o painel
  descarta `available`/`unavailableReason` que a API manda — conta indisponível
  aparece idêntica a disponível e clicável. Registrado no B25.

## Lote e válvula de rodadas

- epic_id: null (card 1:1, esteira-donel local sem TaskDex)
- batch_ready: null
- round_count_anterior: 0 (a rodada 1 passou sem blocking findings)
- round_limit: 3
