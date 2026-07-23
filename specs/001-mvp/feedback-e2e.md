# Feedback humano das validações E2E — acumulado

Registro dos achados do Alexandre ao executar os roteiros de
`specs/001-mvp/roteiros-e2e/`. Itens abertos aqui DEVEM ser endereçados
pelo batch indicado (ou justificados no dossiê se improcedentes).

## 2026-07-23 — rodada 1 (batches 1 e 2)

- [x] **Batch 1 aprovado pelo humano**: login concorrente perfil × global sem
  colisão (addendum registrado no `spike-t001-resultado.md`, commit `ec28004`).
- [ ] **UX — iniciar terminal livre está confuso** (→ **Batch 5 / T015**):
  ao usar o app, não ficou claro como abrir um terminal (FR-008). O botão
  primário comunica "Nova sessão" (claude); a entrada de terminal livre
  precisa ser óbvia — opção visível no SplitButton "Nova sessão" (dropdown),
  atalho documentado na UI e item claro no launcher. Atualizar também o
  roteiro E2E do batch correspondente com o passo exato ("clique em X").
- [ ] **Validação E2E deve rodar em árvore estável** (processo, resolvido):
  rodar `npm run dev` na árvore principal enquanto a esteira edita código
  causa overlay de erro transitório do Vite (import de componente ainda não
  salvo). Worktree `C:\Users\xansd\seazone\donel-dev-e2e` (branch
  `e2e-estavel`) criada fixada no último commit auditado; o orquestrador
  avança essa branch a cada gate aprovado.
- [ ] **BUG — sessão lançada pelo launcher nasce/vira "sem processo vivo" com
  terminal vazio e não digitável** (→ **correção prioritária pós-gate batch 4**):
  reproduzido pelo Alexandre na worktree e2e (estado auditado do batch 3):
  abas criadas via launcher/sidebar ("argiburgo") mostram banner "Sessão sem
  processo vivo", terminal central vazio, digitação sem efeito. Flags
  `--effort high` e `--model fable` validadas como OK no CLI (não são a
  causa). TerminalPane não faz replay de ring buffer ao montar (agrava o
  sintoma de tela vazia). Diagnóstico com repro em andamento (agente na
  worktree e2e). Smokes atuais não cobrem o fluxo real do launcher com
  sessão claude viva — cobertura a fechar junto do fix.
- [ ] **Hooks do settings falhando na sessão de perfil** (→ **T017**):
  `SessionStart` com path sem barras (`C:Usersxansd.localbin...`) e traceback
  do plugin hookify (Python antigo). Ver addendum do spike T001. Confirmar se
  é pré-existente no global ou artefato da cópia de settings do perfil.
