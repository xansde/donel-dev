# Modo Dev e indicadores de sessao - estado atual (2026-10-23)

## 1. Modo Dev
- Origem: US-13; spec 003 (CLARIFICADA 27/07) conduz o trabalho pelas 5 fases da Esteira (discovery, plano, implementar, validar, concluir) lendo o que a Esteira grava em disco (specs/003-modo-dev/spec.md:1-25). A 009 (RASCUNHO 29/07) sucede a 003 e adapta ao modelo v3 (fase do plano, fases documentar/cliente, novo caminho de handoff) mais 8 incomodos do app base (specs/009-modo-dev-v3/spec.md:1-60).
- Codigo: src/renderer/src/DevMode/ (DiscoveryMap.tsx, PhaseDetailsPanel.tsx, NodeGraphOverlay.tsx), src/renderer/src/Esteira/EsteiraScreen.tsx, src/shared/devMode.ts, src/main/esteira-*.ts, src/main/taskdex-board-client.ts. ~349 ocorrencias de "modo dev" em 36 arquivos de src/.
- Implementacao: git log mostra "leva noturna 009 (lotes 1-9)" mergeada em staging (bac1e70), depois fixes "board real + forma v3 transplantada do handoff" (4625497) e "porta de entrada enxuta do Modo Dev" (#36). Spec marca como implementados so CA-22 e CA-29 (o texto do spec nao foi atualizado depois da leva). Roteiro de validacao: specs/009-modo-dev-v3/roteiro-e2e-alfa.md (checklist ainda com [ ] nos trechos lidos).
- Fila PROXIMO.md do vault (Projects/donel-dev/implementar-009-modo-dev-v3/): NAO ENCONTRADA. Em C:\Users\compu\Documents\Claude Seazone\Projects existem so distrato-szi, esteira-homologacao, Projects-MOC.md, projects.base. Lotes feitos/faltando: nao confirmado.
- "Defasado": o spec nao usa a palavra; a defasagem relatada pelo solicitante nao esta documentada. Existem branches origin/014-chat (spec "014 Modo Dev sobre a Esteira Seazone", commit 364bb3f) e origin/015-jobu-pet, fora da main.

## 2. Indicadores de estado de sessao
- Semaforo (working/waiting/permission/error/done): maquina de estados pura em src/main/semaphore-state-machine.ts:1-40, alimentada por hooks do CLI; tipo em src/shared/index.ts:368; integracao em src/main/session-semaphore-manager.ts. "error" (quota/falha) vem do exit code do PTY.
- Icone na aba: design-system/src/components/TerminalTab/TerminalTab.tsx (rotulos de SESSION_STATE_LABEL_PT, tooltip estado+modelo; working/permission piscam, linha 37). Cor da aba por sessao (4 tokens) e ordem por arraste: src/shared/tabAppearance.ts (CA-26/27/28).
- Sidebar: estado + "ha Xmin" (stateEnteredAt) por sessao, grupo Favoritos mostra o pior estado das abas vivas: src/renderer/src/App.tsx:1618-1650, ProjectSidebar.tsx:31, ordenacao em src/shared/sessionOrdering.ts.
- Notificacao Windows: quando sessao em segundo plano vira waiting/permission ("Permissao pendente" / "Aguardando sua resposta"); preferencia all / permission-only (default) / none: src/renderer/src/App.tsx:1700-1740, AUMID em src/main/index.ts:858.
- Detalhes da sessao: SessionDetails.tsx (% de contexto, linha 149-184) e StatusBar (CA-22, % de contexto). Farol de fase no mapa do Modo Dev: DevMode/DiscoveryMap.tsx.

## 3. Notas / post-it
Nenhuma funcionalidade de nota, post-it ou anotacao de sessao no codigo. grep por post-it/sticky/anota em src/ so retorna "anotacao" no sentido de boardAnnotation (espelho disco x board) e ocorrencias em specs antigas (001 ui-spec, 003 plan/medicao) sem relacao com notas do usuario (nao lidas em detalhe). Nao existe resumo automatico de sessao alem do nome da sessao (004) e do rotulo de favoritos (007).

## 4. Specs em specs/
001-mvp: MVP (sidebar, abas, launcher, sessoes anteriores, semaforo). 002-quota-headroom: folga de quota. 003-modo-dev: Modo Dev sobre a Esteira. 004-nomear-sessoes: nomes de sessao. 005-terminal-copy-paste: copiar/colar no terminal. 006-contexto-consumido: % de contexto. 007-favoritos-sessoes: projetos/sessoes favoritos. 008-fechar-pendencias: pendencias de 001-007. 009-modo-dev-v3: Modo Dev na Esteira v3 (+ incomodos do app). 010-esteira-donel: Esteira dentro do Donel. 011-contas-e-provedores: pool de contas, troca/auto-switch. 012-esteira-4: Esteira 4.0 (grafos, motor, catalogo). 013-donel-leitor: plano do leitor. (Descricoes inferidas de nomes e cabecalhos; 002, 005, 006, 008, 013 nao lidos a fundo.)
