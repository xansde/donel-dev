# Tasks — 016 Jobu faxina

TDD nos módulos puros (teste antes); módulos de efeito com dependências injetáveis e
testes de integração em repos git temporários (`os.tmpdir()`), nunca nos repos reais.

- [x] T001 Spec, tasks e emenda da D2 na 015
- [x] T002 `src/main/sweep/types.ts` — fatos de inventário, plano, resultado
- [x] T003 Puros: slug, escolha de instaladores, veredito de scratchpad, nome da pasta da faxina, seleção de repos por atividade
- [x] T004 Puro: `planRepo` (fatos -> apagar / apagar branch / remover worktree / separar / manter, com motivo)
- [x] T005 Puro: `renderSummary` (`resumo.html`) e formatação de bytes
- [x] T006 Puro: balão (`sweepBubbleFace`), evento `sweepFinished` no reducer, `BubbleTarget` `folder`, ação `sweep` e `sweeping` no menu
- [x] T007 Config: `sweep.lastSweepAt` com sanitização
- [x] T008 Efeito: runner de git, inventário de um repo (git + fs)
- [x] T009 Efeito: descoberta de repos e atividade (projectRoots + transcripts + reflog)
- [x] T010 Efeito: executor (apagar, remover worktree, branches com recibo, separar com EXDEV)
- [x] T011 Efeito: serviço orquestrador (pasta, resumo, `lastSweepAt`, log)
- [x] T012 Integração: `PetService` (`sweep`, "Faxinando…", abrir pasta) e `index.ts`
- [x] T013 Verificação: typecheck, vitest, build
- [x] T014 Pose `sweeping` durante a faxina (evento `sweepStarted`, substituto `mirror` até a arte chegar)
