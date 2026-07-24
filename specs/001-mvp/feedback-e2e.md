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

## 2026-07-23 — rodada 4 (roteiro batch 4 na worktree e2e)

- [x] **Roteiro E2E batch 4**: passos 1–4, 6–7 e 9 aprovados pelo humano.
- [x] **BUG — input do nome do perfil perde o foco enquanto digita** (item 5;
  → **correção pós-gate batch 5**): ao criar perfil no ProfileSwitcher, o
  campo de nome "desseleciona" a cada instante, tornando a digitação muito
  chata. Causa provável: re-render periódico do dropdown/Modal recriando o
  input (refresh de headroom/quota re-renderizando a árvore; componente
  definido inline ou key instável). Corrigir (memoizar/estabilizar o input,
  pausar refresh de quota com o form aberto) + teste que digita nome longo
  e assere foco contínuo.
  **Resolvido 2026-07-23 (pós-gate)** — a hipótese da auditoria (refresh
  periódico recriando o input) estava ERRADA: o ProfileSwitcher não tem
  nenhum polling. CAUSA RAIZ REAL: `onClose={() => setOpen(false)}` do
  `Modal` era uma arrow function inline — identidade NOVA a cada tecla
  digitada (cada tecla chama `setNewProfileName` → re-render). O
  `useEffect(..., [open, onClose])` de foco-trap do `Modal.tsx`
  (design-system) via a dependência `onClose` mudar a CADA tecla → rodava
  o cleanup (refoca o elemento anterior à abertura do modal) e reexecutava
  o efeito (`getFocusable()[0].focus()`) — `getFocusable()[0]` é o
  botão/AccountBadge da PRIMEIRA linha de perfil (a `<ul>` vem antes do
  form no JSX), nunca o `TextInput`. Fix: `onClose` estabilizado com
  `useCallback` em `ProfileSwitcher.tsx` (`handleCloseModal`). Teste:
  `tests/smoke/profile-switcher-focus.spec.ts` (novo) — digita um nome
  longo caractere a caractere, assere `document.activeElement === input`
  depois de CADA tecla e valor final completo.
- [x] **BUG — headroom de quota não aparece no dropdown de perfis** (item 8;
  → **correção pós-gate batch 5**): o modal "Perfis de conta" lista os
  perfis (doctor funcionando: "Junctions com problema"/"Perfil OK") mas SEM
  nenhum % nem "—". Evidência: `npx -y quota-axi --provider claude --json`
  standalone devolve JSON VÁLIDO (percentUsed 32, five_hour) porém com
  **exit code 255** — se `readQuotaAxiHeadroom` trata exit ≠ 0 como falha,
  descarta o stdout bom; e a UI omite a linha em vez de renderizar "—"
  (dupla violação do combinado). Corrigir: aceitar stdout JSON válido
  independente do exit code (ou mapear os exit codes do quota-axi) + UI
  sempre mostra o slot ("—" quando faltar) + teste com fixture exit 255.
  UX adicional: mostrar o % do perfil ativo no badge do titlebar e/ou
  statusbar (descoberta hoje é difícil).
  **Resolvido 2026-07-23 (pós-gate)** — investigação encontrou a causa raiz
  REAL diferente da suspeita documentada: `readQuotaAxiHeadroom`
  (main/quota-headroom.ts) **já não checava** `code` no handler de `close`
  antes deste fix (só tentava `JSON.parse(stdout)` incondicionalmente) —
  essa parte não era a causa do bug (endurecida mesmo assim: novo
  `parseJsonPayload` com fallback de extração do objeto `{...}` balanceado
  pra tolerar ruído de wrapper `npx`/Windows antes/depois do JSON de
  verdade; `code`/`signal` documentados como recebidos e nunca usados pra
  decidir sucesso/falha). CAUSA RAIZ REAL e 100% reproduzível: em
  `ProfileSwitcher.tsx`, `parseAccountNumber` só reconhece nomes
  "Tecnologia Claude {n}" — qualquer perfil fora da convenção (o que
  SEMPRE inclui o perfil "Principal", único que todo usuário tem por
  padrão) caía no branch de "nome genérico", que nunca renderizava
  headroom nenhum (nem `%`, nem `—`) em NENHUM dos 3 lugares (badge do
  titlebar, linha do dropdown, rótulo da Statusbar) — por isso "não achei
  onde ver a cota" mesmo o headroom técnico estando disponível. Fix:
  componente `HeadroomSlot` (top-level, sempre renderiza `%` ou `—`)
  reaproveitado no badge do titlebar e na linha do dropdown; rótulo da
  Statusbar (`onActiveProfileLabelChange`) agora inclui `%`/`—` SEMPRE, não
  só pro nome convencional. Testes: 3 casos novos em
  `tests/quota-headroom.test.ts` (`readQuotaAxiHeadroom` com `spawn`
  mockado — exit 255 + JSON válido retorna o headroom; exit 0 + stdout
  inválido continua `null`; exit 255 + ruído em volta do JSON extrai o
  objeto balanceado).
- [ ] **P1 — troca automática de conta por headroom** (ideia da thread do
  Slack #C0AMDQTDFGF, script `switch_account.py` da Amanda Gois, link no
  Drive na thread): monitorar uso e trocar sozinho para a conta com menos
  uso perto do limite. No Donel Dev o encaixe correto é: ao lançar sessão
  nova, o launcher auto-seleciona o perfil com maior headroom (sessões
  vivas não trocam de conta); alerta quando o perfil ativo cruza limiar.
  As peças já existem (ProfileManager + quota-axi/HeadroomCache). FORA do
  P0 — vai para a fila P1 com spec própria.

- [ ] **Hooks do settings falhando na sessão de perfil** (→ **T017**):
  `SessionStart` com path sem barras (`C:Usersxansd.localbin...`) e traceback
  do plugin hookify (Python antigo). Ver addendum do spike T001. Confirmar se
  é pré-existente no global ou artefato da cópia de settings do perfil.

## 2026-07-23 — rodada 5 (roteiro batch 5, app INSTALADO com fixes pós-gate)

- [x] **BUG — modelo/esforço não selecionável SOMENTE na primeira aba**
  (relato: "Num geral, parece que eu não consigo selecionar modelo/esforço
  SOMENTE da primeira aba. Que estranho"). **Resolvido 2026-07-23 (rodada 5,
  opção A escolhida pelo Alexandre).**
  Causa raiz real: a aba boot nasce SEM `cwd`, rodando o CLI em
  `os.homedir()` — o próprio binário mostra o diálogo pré-REPL "Quick
  safety check" TODA vez nesse cwd (trust de home nunca é persistido); sem
  alguém aceitar manualmente, nenhum hook do semáforo dispara e o
  SegmentedControl fica preso pra sempre.

  **Tentativa 1 (commit `16596dd`) — REPROVADA (auditoria 45/100):**
  auto-aceite "tiro único no primeiro match"; o `\r` disparava ANTES do CLI
  terminar de desenhar o diálogo e armar o leitor de stdin, era engolido, e
  a aba ficava presa exatamente como antes. O auditor rodou o próprio
  `boot-tab-trust.spec.ts` e ele FALHOU.

  **Tentativa 2 (commit `8e0128a`) — REPROVADA (re-auditoria 70/100):**
  reescrito pra "reenvia enquanto o diálogo continuar visível"
  (`setInterval`, `src/shared/trustDialog.ts` exigindo a assinatura
  completa do rodapé interativo). Ainda falha sob carga: o teto de 8
  tentativas × 300 ms dá só **2,4 s** de reenvio, contra a janela de 15 s
  que o próprio código declara — esgotado o teto, desarma e a aba fica
  presa PERMANENTEMENTE. Taxa medida pelo auditor: **1 falha em 5
  execuções** (falhou na suíte completa, passou 4/4 isolado) — ou seja,
  quebra exatamente sob carga, que é a condição de uso real. Evidência:
  dump em `test-results/boot-tab-trust-*/error-context.md` com o diálogo
  inteiro ainda na tela após 20 s.

  **Decisão do Alexandre (2026-07-23): opção A.** As duas tentativas
  acima concediam trust em `os.homedir()` em nome dele (escopo amplo, não
  pedido — o pedido era só destravar modelo/esforço); a opção A elimina a
  causa raiz sem o app tomar nenhuma decisão de segurança:
  - **(A) aba inicial não abre sessão** (nasce vazia: "escolha um projeto
    ou ＋ Nova sessão") — mata a causa na raiz, economiza cota e RAM,
    nenhuma decisão de segurança tomada pelo app. **Escolhida.**
  - (B) manter auto-aceite, com teto redimensionado pra cobrir os 15 s (50
    tentativas) + suíte completa verde 3× seguidas — descartada.
  - (C) só o aviso, humano resolve quando quiser — descartada como única
    medida (o aviso sozinho não digita nada; ver terceira parte do fix
    abaixo).

  **Solução implementada:**
  1. `App.tsx` — `INITIAL_TABS` vazio: o app nasce com ZERO abas e mostra um
     empty state na área do terminal ("Nenhuma sessão aberta — escolha um
     projeto na barra lateral ou clique em ＋ Nova sessão", com botão
     reaproveitando `handleQuickNewClaudeSession`). Nenhum `claude` é
     spawnado sem o usuário pedir — elimina o cwd `os.homedir()` automático
     que causava o diálogo. O MESMO empty state já cobria "fechou a última
     aba" (T010); os dois caminhos convergem pro mesmo estado agora.
  2. `TerminalPane.tsx` — auto-aceite REMOVIDO por completo (o
     `setInterval` de retry, `armTrustAutoAccept`/`disarmTrustAutoAccept`,
     as constantes `TRUST_AUTO_ACCEPT_*`): sem spawn automático em home, o
     cenário que ele existia pra cobrir deixou de existir. O smoke
     `boot-tab-trust.spec.ts` (cobria exatamente esse cenário) foi deletado.
  3. `shared/trustDialog.ts` (detecção pela assinatura completa do rodapé)
     PRESERVADA — passa a servir só ao aviso diagnóstico: `App.tsx`
     `possiblyBlockedOnPrompt` agora exige o diálogo estar DE FATO visível
     no buffer renderizado (`isTrustDialogVisible`), não mais só "nenhum
     evento de semáforo ainda" (que também é o caso normal de qualquer aba
     ociosa antes do primeiro prompt — a condição antiga virava ruído
     constante). O texto do aviso diz o que fazer ("o CLI está aguardando
     confirmação no terminal — clique e responda"); sem diálogo, aba viva e
     ociosa mostra "Sessão pronta — digite no terminal; modelo/esforço
     liberam após o primeiro turno" (`SessionDetails.tsx`, texto explicita a
     causa desde a auditoria rodada 6 — antes só dizia "digite no terminal
     para começar", sem responder à pergunta original "não consigo
     selecionar modelo/esforço"), nunca mais "Conectando…" eterno.

  **CORREÇÃO (auditoria rodada 6, achado media "CTA do próprio empty state
  reproduzia o bug em 1 clique"):** este item estava marcado `[x] Resolvido`
  SEM ressalva, mas o CTA "Nova sessão" **dentro do empty state**
  (`handleQuickNewClaudeSession`, reaproveitado do corpo do "＋ Nova sessão"
  do titlebar) continuava alcançável a um clique de reproduzir exatamente o
  cenário original: sem `lastLaunch` (nunca persistido) e sem
  `selectedProjectPath` (nenhum projeto escolhido ainda — o caso de um boot
  limpo), o handler caía em `cwd: undefined` → `pty-manager.ts` `options.cwd
  ?? os.homedir()` → o mesmo "Quick safety check" preso, semáforo em
  `undefined`, toolbar Modelo/Esforço desabilitada. A decisão A eliminou o
  spawn AUTOMÁTICO no boot (isso está correto), mas não o caminho manual de
  1 clique a partir do PRIMEIRO contato do usuário com o app. **Fix
  aplicado:** o CTA do empty state ganhou uma variante do handler
  (`handleEmptyStateNewSession`, App.tsx) que abre o Launcher (escolha de
  projeto) em vez de spawnar quando não há `lastLaunch` nem
  `selectedProjectPath` — fecha o caminho residual pra quem entra pelo empty
  state. O atalho do titlebar (`handleQuickNewClaudeSession` direto, sem a
  variante) MANTÉM o comportamento antigo de propósito — é um atalho ad hoc
  já testado/documentado como intencional em `terminal.spec.ts`/
  `profiles.spec.ts`/`shell.spec.ts` (sessão rápida em home sem navegar a
  nenhum projeto); redesenhar esse caminho compartilhado exigiria reescrever
  essas 3 suítes por uma decisão de escopo diferente da que este achado
  cobre.
- [x] **Roteiro batch 5, item 4 desatualizado** (relato: "não existe mais
  aquela aba"; print referenciado NÃO chegou — anexo truncado). **Resolvido
  2026-07-23 (rodada 5).** Confirmado: o item 4 (CA-1 via launcher) foi
  escrito antes do launcher virar painel colapsável (commit `5c8d254`,
  batch 5) e não dizia como abrir o painel hoje. Roteiro atualizado com os
  passos exatos da UI atual (seta do split-button → "Sessão Claude" →
  preencher campos → "▶ Iniciar").
- [ ] **PRODUTO — restart não mantém as sessões ativas abertas** (relato:
  "Não manteve as sessões ativas abertas"). Comportamento atual é o
  especificado (PTY não sobrevive; sessões viram "sessões anteriores"),
  mas a expectativa do dono do produto é restauração. **Decisão do
  Alexandre (2026-07-23): restaurar as sessões que tiveram ATIVIDADE NO DIA
  ANTERIOR** é o comportamento desejado (critério de corte = atividade no
  dia anterior ao boot, não "toda sessão anterior sem limite"). **Ainda
  PRECISA DE SPEC** antes de qualquer código — decisão registrada aqui,
  fica na fila (ver `specs/backlog.md`); NÃO implementada nesta rodada
  (rodada 5) nem em nenhuma rodada anterior.
- [x] **UX — statusbar deve mostrar a conta com que a sessão EM FOCO foi
  criada** (relato: "Mudar de conta não muda a conta utilizada naquela
  sessão. Na barra inferior deveria mostrar a conta em que a sessão foi
  criada"). **Resolvido 2026-07-23 (rodada 5).** Trocar perfil ativo não
  mudar sessões vivas é o comportamento CORRETO (CA-3); o incômodo era a
  barra inferior mostrar a conta ativa global, sugerindo que a sessão em
  foco trocou de conta. Fix: statusbar mostra o perfil de criação da aba em
  foco (`sessionAccountLabel.ts`); perfil ativo global segue no badge do
  titlebar/dropdown. **CORREÇÃO (auditoria rodada 5, achado alta):** a
  primeira versão deste fix removeu sem querer a cota (headroom) do rótulo
  — regressão do fix da rodada 4 item 8 ("descoberta hoje é difícil").
  Corrigido: `Sessão: <nome> · <cota>` restaura o slot, agora com a cota do
  perfil de NASCIMENTO da aba (não do ativo global).
- (nota) Item 19 (RAM) da validação humana ficou interrompido no meio do
  relato — sem número reportado. Medição automatizada segue valendo:
  417–451 MB vs. budget 400 MB, decisão de NFR pendente.
