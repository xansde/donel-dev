---
card_id: wi-demolicao-perfis-migracao
fase: validar
repo_alvo: C:\Users\xansd\seazone\donel-dev
branch: esteira/contas-e-provedores
worktree_path: C:\Users\xansd\seazone\donel-dev
model: opus
effort: high
disparado_por: esteira-donel (run-6daa720f-2d6)
disparado_em: 2026-08-04T22:38:53.919Z
handoff_anterior: .esteira/implementar/handoffs/wi-demolicao-perfis-migracao/implementar-result.json
kit_version: 2.1.0
run_id: run-6daa720f-2d6
outbox_result: C:\Users\xansd\.claude\esteira-donel\outbox\run-6daa720f-2d6.json
---

# Contexto — Validar etapa 2 (011: demolição dos perfis + migração assistida)

## Intenção do card

Demolir o mecanismo de perfis paralelos (CLAUDE_CONFIG_DIR + junctions) do
donel-dev e implementar a migração assistida para o modelo de contas
(motor de contas da etapa 1). Escopo: tasks-etapa-2.md (T1202–T1232, T1201
era gate já confirmado). Fonte de verdade: `specs/011-contas-e-provedores/`
(spec.md, plan-etapa-2.md, tasks-etapa-2.md), clarifications C23–C34.

Regras duras da etapa (violação = finding bloqueante):
- Nenhuma deleção de diretório de perfil real — só renomeação/arquivamento
  (`~/.claude-profiles` → `~/.claude-profiles.old`), ordem invariante
  unlink de junction → rename (D13).
- `CredentialPair` nunca sai de `src/main/accounts/` (não cruza preload,
  não entra em log/erro). A emenda de credenciais do CLAUDE.md NÃO foi
  ampliada: `src/main/accounts/migration/` é o mesmo perímetro.
- Validar nunca abre PR, nunca faz push, nunca faz merge.

## Resumo do que Implementar reportou (conferir contra o diff real)

- 9 commits na branch `esteira/contas-e-provedores` (06cfa85..a8016ea, mais
  docs eeb3ac2/1d27f6c) — sem PR, sem push.
- Fase 1: 4 módulos puros de migração (profile-inventory, mcp-diff,
  transcript-consolidation, migration-plan) + `accounts.migration` no
  config-store, TDD.
- Fase 2: credentials-import (par direto pro cofre; formato real
  `{claudeAiOauth:{...}}`), archive-profiles (unlink→rename, sem verbo de
  deleção), 5 canais IPC, MigrationWizard.tsx + 2 smokes em árvore de
  perfis falsa (mkdtemp).
- Fase 3: PtyCreateResult.profile→account (C24), sessionAccountLabel via
  AccountLoad (C25), ArchivedPhaseSession.profileSlug→accountId com leitura
  tolerante do legado (C30/D15), AccountsPanel substitui ProfileSwitcher.
- Fase 4: demolição — profile-manager.ts, quota-headroom.ts,
  transcript-copy/transcriptCopy, ProfileSwitcher, shared/profiles apagados;
  ponte profiles.* do preload e handlers removidos; spawn nunca mais aplica
  CLAUDE_CONFIG_DIR de perfil. 8 suítes de perfil mortas; smoke novo prova
  negativo+positivo.
- Fase 5: backlog/specs antigas marcadas SUPERSEDED, CLAUDE.md/LEIA-ME
  atualizados, roteiro-e2e-etapa-2.md novo.
- T1232: vitest 94 arquivos / 1649 testes verdes, 0 falhas; typecheck
  limpo; repo sem script de lint. Achado corrigido: assinatura duplicada de
  window.donel.accounts no boot (App.tsx vs AccountsPanel).
- Lições em tasks/lessons.md (formato real do .credentials.json; assinatura
  duplicada de IPC).

## Lote e válvula de rodadas (Passo 1.5/1.6)

- epic_id: null (card 1:1, repo sem TaskDex — esteira do Donel usa
  run-input/outbox local)
- batch_ready: null
- round_count_anterior: 0 (nenhum validar-result.json anterior deste card)
- round_limit: 3 (default; sem round_limit_by_board na config)

## Observações operacionais

- A "worktree" desta esteira é o próprio checkout principal
  (`C:\Users\xansd\seazone\donel-dev`) — Implementar rodou nele; reaproveitar.
- Base do diff: a branch divergiu de `staging` (repo integra por staging).
  Confirmar o merge-base real antes do code-review.
- Repo sem TaskDex: nada de labels/comentários TaskDex; o resultado vai em
  `.esteira/validar/handoffs/wi-demolicao-perfis-migracao/validar-result.json`
  e depois é copiado para o outbox do run.
