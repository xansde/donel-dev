# 016 — Jobu faxineiro ("Fazer faxina")

Fonte: `specs/backlog.md`, item **B29**, e o protótipo aprovado pelo dono em 23/10/2026
(`seazone/_archive/faxina-2026-10-23/resumo.html`). Emenda a **D2 da 015-jobu-pet**: o Jobu
também avisa o resultado da faxina.

## Contexto

Worktrees mortas, centenas de branches já incorporadas, pastas de sessão de spike em
`~/.claude/projects`, handoffs órfãos em `.esteira/`, instaladores velhos e saída regenerável
se acumulam nos repos do dono. A faxina manual de 23/10 provou o algoritmo; esta spec o
transforma numa opção do menu de clique direito do Jobu, executada por **script determinístico
no main process** (git + filesystem, testado com vitest), nunca por Claude headless.

## Decisões

- **D1 — Forma.** Item "Fazer faxina" no menu do Jobu. Sem lista de confirmação prévia: o que
  não se recria vai para uma pasta que o dono esvazia; o resto é regenerável ou tem recibo.
- **D2 — Três destinos.** *Apaga direto*: saída regenerável, instaladores velhos, scratchpads
  antigos. *Apaga com recibo*: branches (`nome SHA` gravado antes do `git branch -D`).
  *Separa na pasta*: sessões antigas do Claude e arquivos não rastreados de `.esteira/`
  (texto que ninguém recria) — movidos, nunca apagados.
- **D3 — Sem quarentena, sem prazo.** O app **nunca** apaga a pasta da faxina. Quem apaga é o
  dono, à mão, quando quiser.
- **D4 — Pasta e resumo.** `<pai do repo>/_archive/faxina-<AAAA-MM-DD>/` (sufixo `-2`, `-3`
  se já existe), com `resumo.html` autocontido na raiz e uma subpasta por repo. A pasta só é
  criada se algo foi separado ou alguma branch foi apagada (o recibo mora lá).
- **D5 — Alcance.** Repos com trabalho desde `lastSweepAt` (transcript com mtime posterior cujo
  cwd é o repo/worktree dele, ou entrada de reflog posterior). Sem carimbo, todos os conhecidos
  (git repos achados nas `projectRoots` + repos derivados do cwd dos transcripts). Repo sem
  nada a limpar não aparece. `lastSweepAt` só é gravado quando a faxina termina com sucesso.
- **D6 — Nunca tocar.** Root `node_modules`, `out/`, `dist/` da raiz, `probe-*`, `tests/probe/`,
  `scripts/publicar.local.json`; branch checada em qualquer worktree, `main`, `master`,
  `staging`, `dev`, `backup/*`; worktree com mudança não commitada ou commit só local; tudo que
  o git rastreia.
- **D7 — Balão.** Evento novo `sweepFinished` no reducer do pet, mesmo padrão de
  `accountSwitched`. Texto curto (`Faxina · 319 MB liberados`, `Faxina · nada a limpar`,
  `Faxina · falhou`). Clique abre a pasta no Explorer (`BubbleTarget` `folder`); sem pasta, o
  alvo é o Donel. **Aparece mesmo com o Jobu silenciado**: é a resposta a um pedido direto do
  dono, não um aviso espontâneo. Continua respeitando tela cheia (o Jobu está escondido).
- **D8 — Estado do menu.** Durante a execução o item vira "Faxinando…" (desabilitado) e não
  dispara de novo.
- **D9 — Segurança do clique.** O renderer do Jobu nunca escolhe o caminho a abrir: o main
  abre a pasta do balão que ele mesmo mantém.
- **D10 — Falha.** Erro geral gera balão `Faxina · falhou` (alvo Donel) e log em
  `<userData>/sweep.log`. Falha isolada de um item vira linha "não foi possível" no resumo e
  não aborta o resto.

## Requisitos

- **FR-001** Menu do Jobu ganha a ação `sweep`; `buildPetMenu` recebe `sweeping`.
- **FR-002** `git fetch origin` antes de classificar; se falhar, segue com o que tem e anota no resumo.
- **FR-003** Branch de integração = `origin/staging`, senão `origin/dev`, `origin/main`, `origin/master`.
- **FR-004** Worktree (exceto a principal) é removida só se limpa E com HEAD contido na
  integração OU igual ao SHA remoto da mesma branch; `node_modules`/`design-system` que sejam
  link simbólico/junction são desfeitos (`unlink`) antes; `git worktree remove` sem `--force`,
  depois `git worktree prune`; pasta-mãe vazia é removida.
- **FR-005** Branch é candidata se ancestral da integração, ou `git cherry` sem `+`, ou publicada
  com o mesmo SHA; resto fica em "manter" ("N commits só aqui, último em <data>").
- **FR-006** Regenerável: `test-results/`, `.e2e-visual/`, `.tutorial-shots/`, `.playwright-cli/`
  (qualquer profundidade), `prototypes/*/node_modules`, `prototypes/*/dist`, `Microsoft/` na raiz
  — só se não rastreado.
- **FR-007** Instaladores em `release/`: `<Produto>-Setup-<semver>.exe` + `.blockmap` que não
  sejam a versão mais nova do mesmo produto.
- **FR-008** Scratchpads em `%TEMP%/claude/<slug-do-repo>*` sem escrita há mais de 7 dias.
- **FR-009** Sessões antigas: subpasta de `~/.claude/projects/` cujo `cwd` (primeiro registro com
  `cwd`, em streaming) não existe mais e pertence ao repo → `<faxina>/<repo>/sessoes-claude/`.
- **FR-010** Arquivos não rastreados (não ignorados) de `.esteira/` → `<faxina>/<repo>/<relativo>`.
- **FR-011** Mover entre volumes: `rename`, e em `EXDEV` copiar + apagar.
- **FR-012** `resumo.html` autocontido (CSS inline, tema escuro por `prefers-color-scheme`, sem JS
  externo), todo texto escapado, com totais, tabela do que está na pasta, seções recolhidas
  (apagado direto, worktrees, branches com `git branch <nome> <sha>`) e "deixado de lado".
- **FR-013** Tudo assíncrono; o main não trava.

## Critérios de aceite

- **CA-1** Com repos git temporários reais: worktree limpa e incorporada é removida (com o
  junction desfeito sem apagar o alvo); worktree suja, não.
- **CA-2** Branch incorporada some e consta em `branches-apagadas.txt` com o SHA; branch com
  commit só local fica.
- **CA-3** `test-results/` não rastreado some; o mesmo nome rastreado fica.
- **CA-4** Sessão cujo cwd morreu vai para a pasta da faxina e some de `~/.claude/projects`.
- **CA-5** Dois dias seguidos geram `faxina-AAAA-MM-DD` e `faxina-AAAA-MM-DD-2`.
- **CA-6** Sem trabalho novo desde `lastSweepAt`, nenhum repo é varrido e o balão diz "nada a limpar".
- **CA-7** Menu mostra "Faxinando…" durante a execução; segunda ativação é ignorada.
- **CA-8** Balão aparece com o Jobu silenciado; clique abre a pasta (Explorer).
