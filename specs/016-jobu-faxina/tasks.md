# Tasks — 016 Jobu faxina

TDD nos módulos puros (teste antes); módulos de efeito com dependências injetáveis e
testes de integração em repos git temporários (`os.tmpdir()`), nunca nos repos reais.

- [x] T001 Spec, tasks e emenda da D2 na 015
- [ ] T002 `src/main/sweep/types.ts` — fatos de inventário, plano, resultado
- [ ] T003 Puros: slug, escolha de instaladores, veredito de scratchpad, nome da pasta da faxina, seleção de repos por atividade
- [ ] T004 Puro: `planRepo` (fatos -> apagar / apagar branch / remover worktree / separar / manter, com motivo)
- [ ] T005 Puro: `renderSummary` (`resumo.html`) e formatação de bytes
- [ ] T006 Puro: balão (`sweepBubbleFace`), evento `sweepFinished` no reducer, `BubbleTarget` `folder`, ação `sweep` e `sweeping` no menu
- [ ] T007 Config: `sweep.lastSweepAt` com sanitização
- [ ] T008 Efeito: runner de git, inventário de um repo (git + fs)
- [ ] T009 Efeito: descoberta de repos e atividade (projectRoots + transcripts + reflog)
- [ ] T010 Efeito: executor (apagar, remover worktree, branches com recibo, separar com EXDEV)
- [ ] T011 Efeito: serviço orquestrador (pasta, resumo, `lastSweepAt`, log)
- [ ] T012 Integração: `PetService` (`sweep`, "Faxinando…", abrir pasta) e `index.ts`
- [ ] T013 Verificação: typecheck, vitest, build
