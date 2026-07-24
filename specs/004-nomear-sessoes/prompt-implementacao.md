# Prompt de handoff — sessão exclusiva de implementação da 004

Gerado em 2026-07-24, após o clarify (C1..C5) e o gate de planejamento.
Escopo desta sessão: **Batches A + B**. O Batch C (reflexo ao vivo) fica para
uma sessão seguinte, depois da validação humana do rename pela UI.

Colar o bloco abaixo numa sessão nova aberta em `C:\Users\xansd\seazone\donel-dev`.

---

```
Sessão exclusiva de implementação: feature 004-nomear-sessoes do Donel Dev.
Repo: C:\Users\xansd\seazone\donel-dev, branch feature/mvp-p0 (tudo local, sem
remoto). O planejamento está FECHADO e aprovado — não reabra decisões, implemente.

LEIA NESTA ORDEM antes de escrever qualquer linha:
1. specs/004-nomear-sessoes/spec.md    — CA-1..CA-6 e as decisões C1..C5 (já
   respondidas pelo Alexandre; são requisito, não sugestão)
2. specs/004-nomear-sessoes/plan.md    — Fatias 0..5, com path:linha verificado
3. specs/004-nomear-sessoes/tasks.md   — T401..T413, a fonte de verdade do escopo
4. CLAUDE.md do repo

ESCOPO DESTA SESSÃO: Batch A (T401→T405) e Batch B (T406→T410), nessa ordem.
NÃO implemente o Batch C (T411..T413, o fs.watch do reflexo ao vivo) — ele
espera a validação humana do Batch B. Nada fora das tasks: sem features, sem
refactor oportunista, sem cor/ícone/indicador novo na aba (o Alexandre foi
explícito: só o nome).

COMO TRABALHAR:
- Use a skill `batch-gated-development`: implementa o batch, auditoria opus com
  gate >= 95, só então o próximo. Se o gate reprovar, corrige e reaudita — não
  siga adiante com nota baixa.
- TDD de verdade nos módulos puros (T401 resolveSessionName/extractCustomTitle,
  T402 mutações do store, T406 validação de nome): teste falhando primeiro.
- Comandos reais deste repo: `npm run typecheck`, `npm run test` (vitest),
  `npm run test:smoke` (playwright, tests/smoke/), `npm run test:smoke:dev`
  (smoke de modo dev — o StrictMode já matou todo PTY uma vez neste projeto).
- Commit em branch de feature é default, sem me perguntar. Conventional commits
  em pt-BR. NUNCA push, PR ou merge — nem em main, nem na feature.
- Verificação antes de afirmar: só diga "passa" depois de rodar e ver a saída.
  Se algo ficou sem verificar, diga o que ficou.

OS DOIS PONTOS ONDE ESTA FEATURE COSTUMA DAR ERRADO — trate-os como primeira
classe, não como detalhe:

1. T403 / custom-title fora da cauda de 8 KB. O indexer lê só os últimos 8192
   bytes do .jsonl. Um /rename feito no COMEÇO de uma sessão longa fica fora
   dessa janela — e é exatamente o caso de uso do Alexandre (reachar sessão de
   semanas atrás). Implemente o fallback de varredura completa quando a cauda
   não trouxer custom-title, MEÇA o custo na listagem real e registre o número
   no commit. Se passar de ~300 ms, troque para varredura sempre + cache por
   mtime+size. Não "parece rápido".

2. T402 / a chave nova no ConfigStore exige tocar QUATRO pontos de
   src/main/config-store.ts, senão ela é silenciosamente descartada na leitura:
   AppConfig (:57-66), defaultAppConfig (:69-79), sanitizeAppConfig (:206-224,
   campo a campo) e toAppConfigDto (:82-89) + AppConfigDto em
   src/shared/config.ts. CONFIG_SCHEMA_VERSION (:43) NÃO sobe. Teste
   obrigatório: config.json legado sem a chave carrega com {} e não perde
   projectRoots/favorites/launcherDefaults.

Outros fatos já verificados, para não redescobrir:
- O sessionId do Claude é IMPOSTO pelo app no spawn (--session-id, em
  session-correlation.ts:24-34), reusando o id do -r quando é retomada. O path
  do .jsonl é conhecido antes de o CLI subir. Mas esse id NUNCA chega ao
  renderer hoje — T404 o devolve na resposta do PTY_CHANNELS.create (não crie
  canal novo, não acople ao SemaphoreUpdate).
- Não existe updateTab genérico no App.tsx; o único update parcial é o do pin
  (:651). T408 cria updateTab nesse padrão e migra o pin para ele.
- A linha da sidebar não tem componente próprio — é markup inline em
  ProjectSidebar.tsx:173. O gesto de edição sai num EditableLabel compartilhado
  (T407), para aba e sidebar não divergirem.
- TerminalTab.module.css:10 tem white-space: nowrap mas não overflow:hidden +
  text-overflow:ellipsis. Com o limite de 60 chars isso virou obrigatório.
- Cuidado de interação (lição do ProfileSwitcher na entrega 002): clicar na aba
  ATIVA e o × FECHA. O input e o duplo-clique precisam de stopPropagation.
- Os 2 smokes de tests/smoke/previous-sessions.spec.ts (resume/fork) estão
  VERMELHOS por dívida herdada da restauração de sessões — código disjunto
  desta feature. Registre-os explicitamente no gate; NÃO mascare como verde e
  NÃO tente consertar (fora de escopo).

AO FIM DO BATCH B (T410): suíte COMPLETA verde (typecheck + test + test:smoke +
test:smoke:dev), auditoria >= 95, `npm run build` + `npm run dist`, reinstalar,
sincronizar a worktree donel-dev-e2e, e escrever um roteiro E2E curto em
specs/004-nomear-sessoes/roteiro-e2e-batch-b.md para o Alexandre validar
(renomear pela aba, renomear pela sidebar, vazio volta ao fallback, nome
persiste depois de fechar e reabrir o app, sessão antiga com /rename aparece com
o nome certo). Aí PARE e me chame — o Batch C só entra depois desse OK.

Atualize specs/004-nomear-sessoes/tasks.md marcando o que foi entregue, e o
vault (Projects/donel-dev/context.md §Status + todo.md) ao fechar cada batch.
```
