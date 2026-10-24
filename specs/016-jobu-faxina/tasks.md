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

## Achados da 1ª faxina real (23/10)

A primeira faxina real varreu 57 repos em 26 min, deixou 2 linhas no `sweep.log` e acusou 31 "falhas", todas `git worktree remove` -> "working trees containing submodules cannot be moved or removed".

- [x] T015 Worktree com submódulo é mantida, não tentada: fato `hasSubmodules` no inventário (`.gitmodules` na raiz, `modules/` no git dir da worktree ou gitlink no índice, que é o teste do próprio git); `planWorktree` devolve `keep` com "tem submódulo (o git não remove worktree com submódulo)". Worktree ausente (só registro) segue sendo podada
- [x] T016 Progresso no `sweep.log`: uma linha por repo lido (tempo, ações, de lado), uma ao começar a execução, uma por repo executado (ok/falhas) e os totais. Só nomes e contagens, nunca conteúdo
- [x] T017 `measure` concorrente (até 48 chamadas de fs em voo, `readdir` com tipos para descer sem esperar o `lstat`; resultado idêntico: bytes e mtime mais novo; links contam 0 e não são entrados) e leitura de 4 repos em paralelo (era 2). Bench em `node_modules` de ~800 MB: 4,9 s -> 0,8 s (frio) e 1,6 s -> 0,6 s (quente)
