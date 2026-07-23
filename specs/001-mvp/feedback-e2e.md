# Feedback humano das validações E2E — acumulado

Registro dos achados do Alexandre ao executar os roteiros de
`specs/001-mvp/roteiros-e2e/`. Itens abertos aqui DEVEM ser endereçados
pelo batch indicado (ou justificados no dossiê se improcedentes).

## 2026-07-23 — rodada 1 (batches 1 e 2)

- [x] **Batch 1 aprovado pelo humano**: login concorrente perfil × global sem
  colisão (addendum registrado no `spike-t001-resultado.md`, commit `ec28004`).
- [x] **UX — iniciar terminal livre está confuso** (→ **Batch 5 / T015**):
  ao usar o app, não ficou claro como abrir um terminal (FR-008). O botão
  primário comunica "Nova sessão" (claude); a entrada de terminal livre
  precisa ser óbvia — opção visível no SplitButton "Nova sessão" (dropdown),
  atalho documentado na UI e item claro no launcher. Atualizar também o
  roteiro E2E do batch correspondente com o passo exato ("clique em X").
  **Resolvido 2026-07-23** — rótulo do item do dropdown mudou pra "Terminal
  (shell livre)" (App.tsx, SplitButton); roteiro batch-3 §9 atualizado com o
  passo exato (seta do "＋ Nova sessão" → item do menu).
- [ ] **Validação E2E deve rodar em árvore estável** (processo, resolvido):
  rodar `npm run dev` na árvore principal enquanto a esteira edita código
  causa overlay de erro transitório do Vite (import de componente ainda não
  salvo). Worktree `C:\Users\xansd\seazone\donel-dev-e2e` (branch
  `e2e-estavel`) criada fixada no último commit auditado; o orquestrador
  avança essa branch a cada gate aprovado.
- [x] **BUG — sessão lançada pelo launcher nasce/vira "sem processo vivo" com
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
  **Resolvido 2026-07-23 (batch 5)** — fix do StrictMode já estava aplicado
  na `feature/mvp-p0` (commit `3daad10`); os dois pendentes desta task
  fecharam agora: replay do ring buffer via `pty:preview` ANTES de assinar
  `onData` (TerminalPane.tsx + `ringBufferPreview.ts`, testado) e smoke
  permanente de modo dev (`tests/smoke-dev/`, `npm run test:smoke:dev`,
  StrictMode ativo de verdade contra um Vite dev server real) — verde.
## 2026-07-23 — rodada 2 (roteiro batch 2 na worktree e2e, com fix StrictMode)

- [x] **Roteiro E2E batch 2 aprovado pelo humano** — todos os passos perfeitos,
  exceto: item 7 (bug abaixo) e item 10 (não testado — revalidar na próxima
  rodada ou no smoke final T017).
- [x] **UX — app inteiro tem scrollbar vertical** (→ **Batch 5 / T015**):
  a janela mostra barra de scroll global mesmo exibindo todo o conteúdo
  (item 7 do roteiro batch 2). O shell deve ser fixo (100vh, sem overflow no
  body/#root); scroll só INTERNO (lista da sidebar, buffer do terminal).
  Provável: alturas somadas de header + conteúdo + statusbar excedendo o
  viewport ou falta de `overflow: hidden` no root. Corrigir e cobrir com
  asserção no smoke (scrollHeight do body == clientHeight).
  **Resolvido 2026-07-23** — causa raiz era falta de reset global
  (`html`/`body` sem `margin:0`/`height:100%`, `body` de ~8px de margem
  default do UA estourando o `height:100vh` do `.shell`). Novo
  `src/renderer/src/global.css` (reset + `overflow:hidden` em body/#root),
  importado em `main.tsx`. Smoke novo: `tests/smoke/shell.spec.ts`.

## 2026-07-23 — rodada 3 (roteiro batch 3 na worktree e2e)

- [x] **BUG — favoritar projeto só reflete após reiniciar o app**
  (→ **Batch 5**): deveria ser instantâneo. `handleToggleFavorite` já chama
  `setFavorite(...).then(setProjects)` — investigar por que a sidebar não
  re-renderiza/re-ordena na hora (persistência ok mas resposta do IPC sem a
  lista atualizada? agrupamento/ordenação de favoritos aplicado só no scan
  inicial?). Corrigir + teste (unitário da ordenação e/ou smoke: clicar na
  estrela → projeto muda de posição sem restart).
  **Resolvido 2026-07-23** — a lógica de merge/ordenação já estava correta;
  a causa raiz era o round-trip de `listProjectsWithFavorites` (main) refazer
  um `scanProjects` SÍNCRONO do filesystem a cada toggle, perceptível numa
  máquina com dezenas de repos sob os roots. Fix: `handleToggleFavorite`
  (App.tsx) reordena `projects` OTIMISTICAMENTE no clique, com a mesma
  `sortProjects` que o main usa (movida pra `shared/projects.ts`, reusável
  pelo renderer); um guard de `requestId` evita que uma resposta de IPC
  atrasada de um toggle anterior sobrescreva um toggle mais recente (achado
  do próprio smoke, cliques em sequência rápida). Testes:
  `tests/projects.test.ts` (unitário) + `tests/smoke/sidebar-favorites.spec.ts`.
- [ ] **UX/portabilidade — roots de projetos precisam ser configuráveis pela
  UI** (→ **Batch 5 / T015**): o Alexandre quer escolher as pastas-raiz de
  projetos (hoje a estrutura parece presa ao layout atual do disco; se ele
  reorganizar o ambiente, quebra). O ConfigStore do T015 deve expor na UI de
  preferências: adicionar/remover roots de scan (persistidos), com re-scan
  imediato. Atualizar spec/ui-spec com uma nota do ajuste (FR-001).
- [x] **UX — painel lateral "Lançar sessão" fixo rouba espaço e não parece
  produtivo** (→ **Batch 5**): tornar o painel colapsável/sob demanda —
  abre ao clicar "＋ Nova sessão" (ou seta do SplitButton), fecha ao lançar
  ou Esc; por padrão o espaço fica com o terminal. Atualizar ui-spec §4 com
  a decisão. Cuidar para os smokes que assumem `[data-testid="launcher"]`
  visível serem ajustados junto.
  **Resolvido 2026-07-23** — painel fechado por default (`launcherOpen`,
  App.tsx); abre pelo item "Sessão Claude" do menu da seta do "＋ Nova
  sessão" (esse item deixou de duplicar o quick-launch do corpo do botão);
  fecha ao lançar ou `Esc`. Corpo do "＋ Nova sessão" continua com o
  quick-launch de sempre, inalterado. Decisão documentada em ui-spec §2/§4.
  Smokes ajustados (`terminal.spec.ts`, `tabs-lifecycle.spec.ts`,
  `model-injection.spec.ts` — abrem o painel antes de usar o Launcher).

- [ ] **Hooks do settings falhando na sessão de perfil** (→ **T017**):
  `SessionStart` com path sem barras (`C:Usersxansd.localbin...`) e traceback
  do plugin hookify (Python antigo). Ver addendum do spike T001. Confirmar se
  é pré-existente no global ou artefato da cópia de settings do perfil.
