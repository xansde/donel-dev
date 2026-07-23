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
  causa). **CAUSA RAIZ ENCONTRADA (23/07): React 18 StrictMode double-invoca
  o mount do TerminalPane em modo dev; `disposedRef` booleano nunca resetado
  no 2º mount → todo PTY recém-criado era morto → aba presa em 'connecting'.**
  Só em `npm run dev` (React dev build) — smokes auditados rodam contra build
  de produção, por isso não pegaram. Fix validado com repro real (contador de
  geração `mountEpochRef`, sem leak de processo: +2 claude.exe para 2 abas) e
  **commitado na worktree e2e** (branch `e2e-estavel`). PENDENTE →
  **Batch 5, item 0**: aplicar o mesmo fix na `feature/mvp-p0` (diff pronto
  no TerminalPane.tsx da e2e) + smoke permanente de modo dev
  (`ELECTRON_RENDERER_URL` + Vite dev server, receita no dossiê do agente de
  diagnóstico) + replay do ring buffer ao montar (agravante do sintoma).
## 2026-07-23 — rodada 2 (roteiro batch 2 na worktree e2e, com fix StrictMode)

- [x] **Roteiro E2E batch 2 aprovado pelo humano** — todos os passos perfeitos,
  exceto: item 7 (bug abaixo) e item 10 (não testado — revalidar na próxima
  rodada ou no smoke final T017).
- [ ] **UX — app inteiro tem scrollbar vertical** (→ **Batch 5 / T015**):
  a janela mostra barra de scroll global mesmo exibindo todo o conteúdo
  (item 7 do roteiro batch 2). O shell deve ser fixo (100vh, sem overflow no
  body/#root); scroll só INTERNO (lista da sidebar, buffer do terminal).
  Provável: alturas somadas de header + conteúdo + statusbar excedendo o
  viewport ou falta de `overflow: hidden` no root. Corrigir e cobrir com
  asserção no smoke (scrollHeight do body == clientHeight).

- [ ] **Hooks do settings falhando na sessão de perfil** (→ **T017**):
  `SessionStart` com path sem barras (`C:Usersxansd.localbin...`) e traceback
  do plugin hookify (Python antigo). Ver addendum do spike T001. Confirmar se
  é pré-existente no global ou artefato da cópia de settings do perfil.
