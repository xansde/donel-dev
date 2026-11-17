# OpenRig — registro de absorção

Último commit absorvido: 2a94dc34d09077abe497f2cc13dbf704b319f666

Referência de design do Mindscape (github.com/mvschwarz/openrig). Procedimento na skill `absorver-openrig`. Cada rodada lista o que virou PR, o que ficou adiado, o que espera o dono e o que foi descartado.

## 2026-11-17 — 0b25d86..2a94dc3

57 commits do OpenRig; versões novas: v0.7.17.

### Vale → PR

Nenhum. Nada do intervalo trouxe ideia nova que o Donel ainda não tenha.

### Vale → adiado

Nenhum.

### Vale → pendente para o dono

Nenhum novo. Seguem abertas as perguntas das seções anteriores (fila durável do item 13, desde 10/11; resposta do "esperando você" em nome do dono, desde 08/11; pausa até o reset do limite de uso, desde 12/11).

### Descartado

- Fila: respostas de prompt do lugar voltam à conversa escolhida pela pessoa: É a continuação do item 13 (fila durável), e a pergunta sobre ela está com o dono desde 10/11 sem resposta, então não abro outra. Rota de volta, histórico de respostas pelo Slack, contagem de goals e varredura de sucessores são da fila do daemon e do SQLite. A rotina "sessão parada e ninguém vê" (item 20) conta de propósito o lugar que precisa do dono.
- Restore/export: resultado honesto por lugar, cwd, pasta salva ausente, conversa compartilhada: O Donel já tem igual. moveConversation (src/shared/mindscape/model.ts:288) junta num lugar só o cartão que tinha a mesma conversa, então dois lugares não dividem uma conversa. O sessao_retomar já recusa um lugar aberto ou abrindo (agentBridge.ts:1668), e openWhereItLives recusa uma conversa "viva em outra aba". A retomada usa a pasta do projeto, e um spawn numa pasta que não existe dá erro com o nome dela (buildSpawnFailureMessage, pty-manager.ts:170). O relato por lugar na reabertura é o PR #446. Shell vazio, recibos de tentativa, plugin de uma instalação movida e process_limits do export são mecânica de tmux e daemon.
- Estado honesto do lugar: atividade de lugar adotado, compactação, nomes de sessão, token comparado em tempo constante: O Donel já tem. O hook-bridge guarda o estado pelo token de cada PTY, e não por geração, então a sessão adotada na renovação (PR #439) segue com os próprios hooks. O Donel não tem compactação gerenciada; a renovação em voo (item 07) cobre o handoff. O token do hook é um aleatório de 128 bits buscado num Map, só em localhost, sem comparação com !==. A celular, o Oráculo e o portão já usam timingSafeEqual. O limite de recent-transitions é da fila do daemon.
- Acordar lugares Claude por ponte de hook própria do lançamento e entrada nativa ordenada: O Donel já tem. Cada lançamento ganha a própria ponte de hook, com token por sessão (hook-bridge.ts e session-keys.ts), e a entrega ordenada com desfecho tipado vem do sendDriver/tabSend (DeliveryOutcome). O anel de wake com assinatura Standard Webhooks é de membro hospedado do daemon e não existe no Donel.
- MCP e rig_team para assistentes de rede: O roster, os assistentes de rede e o rig_queue_show são do daemon e do CLI rig. O MCP donel acha o lugar pela aba, sem roster, e o "desconhecido" do silêncio já existe (PRs #313 e #417).
- Papel/orientação: refocus e autoMode por lugar: O Donel já tem. O papel é reinjetado a cada lançamento, e o modo vem do papel e do Launcher (src/shared/roleLaunch.ts); a renovação mantém o bypass. O refocus a partir do baton tipado é do daemon.
- Limite de tarefas por lugar (TasksMax) em hosts Linux/systemd: Só existe no Linux com systemd e mexe com o tmux do OpenRig. No Donel, o teto por máquina é a "vaga" do sessao_abrir e do sessao_retomar (waitReasons e openingRoom).
- Escopo/slices e workflow: close in-place, route adota segundo handoff: Slices e workflow do CLI rig dependem de topologia escrita à mão, que está fora de escopo. A esteira do item 15 não tem slices nem pacotes de handoff.
- Terminal: célula herdr sem painel não dimensiona o lugar: É mecânica de tmux e do Herdr. O Donel é dono dos próprios PTYs e dimensiona pelo xterm de cada aba.
- TUI: A TUI está fora de escopo (dono, 03/11).
- CLI: robustez de partida e saída JSON: Robustez do CLI rig e do daemon do OpenRig (archive, listener secundário, bearer, UTF-8 do ACP), sem ideia nova para o Mindscape.
- Daemon: /api/attention barato para o badge 'precisa de você': É desempenho do daemon. No Donel o "precisa de você" sai do semáforo e dos hooks, já no app, sem polling HTTP caro.
- Slack opt-in do OpenRig: É uma integração própria do OpenRig, fora do plano. O Slack do dono passa só pela Composio e pelo Theo, fora do app.
- Docs e skills do OpenRig: São docs e skills do próprio OpenRig. Responder a pessoa onde ela escreveu é a pergunta que está com o dono desde 08/11 (responder o "esperando você" em nome dele).
- Release 0.7.17, changelog e baseline de plugins: Packaging, release e changelog do próprio OpenRig.
- CI e scripts: pins de actions e bootstrap: CI e scripts do próprio OpenRig.
- Rótulo de lugar Codex: Política do Codex no daemon. O Donel não lê a configuração workspace-write do Codex.

## 2026-11-16 — df98bcd..0b25d86

61 commits do OpenRig; versões novas: v0.7.16.

### Vale → PR

- **Lugar remoto que não respondeu na reabertura é dito como sem resposta, nunca como sessão morta** (plano: item 09, salvar e reabrir o quadro inteiro, "diz, por cartão, o que voltou", com a régua do item 04: desconhecido vence resposta confiante e errada; sessão que não morre). Origem: OpenRig `e20c1f9`, `669be28`, `b93e6a3`, `021032b`. PR: https://github.com/xansde/donel-dev/pull/446. Teste primeiro: em `tests/sessao-duravel.test.ts`, "lugar remoto calado na abertura não vira sessão morta no relato ao Líder" falhou antes (com `placeSilence` "retrying", `returnVerdict` dava nao-voltou "a sessão não estava mais viva na máquina remota" em vez de pendente) e passou depois. Verify verde pela fila (`flock ~/.donel/verify.lock`), na árvore mesclada com `origin/staging` f3d4e51d: 121 arquivos, 1514 testes (1 pulado), build ok.

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

Nenhum novo. Seguem abertas as perguntas das seções anteriores (fila durável do item 13, desde 10/11; resposta do "esperando você" em nome do dono, desde 08/11; pausa até o reset do limite de uso, desde 12/11).

### Descartado

- Restore/snapshot, resultado honesto por nó (shell vazio, rollback, retomada em subconjunto): a ideia que vale (dizer o desconhecido em vez de afirmar morte) virou o PR #446. O resto o Donel já tem: o relato único ao Líder com "voltaram / não voltaram + motivo" (`sessionReturn.ts`, `agentBridge.expectReturn`). Shell vazio não ocorre, porque o tmux remoto roda `exec claude` (`remote-session.ts`) e, quando o claude sai, a sessão do tmux morre junto. Rollback de stop e prova por argumentos do Codex são mecânica de tmux/daemon.
- Recuperação/handover, sucessor e retomada da conversa original: no Donel o lugar segue o mesmo na renovação em voo. A passagem já é confirmada (PR #321) e a sessão nova que responde atrasada já é adotada pelo id (PR #439, aberto). Pai do fork pelo processo, pertença de painel e `CLAUDE_CONFIG_DIR` relativo são mecânica de tmux/daemon. O `a323172` é só doc.
- Fila durável: acordar, handoff e etiquetas: continuação do item 13. A pergunta já está com o dono desde 10/11 (repetida em 15/11) e sem resposta, então não se abre outra. A mecânica (wake no binding atual, custódia, tags, sucessor na lista, varredura de travados) é daemon/SQLite, sem onde encaixar hoje.
- Conexões declaram capacidades e rotulam desfecho de entrega: o Donel já tem igual. O envio devolve desfecho tipado (`DeliveryOutcome` entrou / na-fila / não-foi em `tabSend`/`agentBridge`) e a passagem da renovação só conta como confirmada com prova (PR #321). O watchdog de contexto com arquivo nomeado é do daemon; no Donel o limite da renovação lê a statusline da própria aba.
- Estado honesto: diálogo de confiança e leitura de tela: o Donel já tem igual ou melhor. `blockingScreen` (`src/shared/chat/screen.ts:217`) checa o `trustDialogKind` antes de tudo e não usa o cabeçalho "Claude Code v" como marca de pronto. A tela de um lugar sem processo já não é lida. A recusa de login do Codex não se aplica, porque o Donel não lê a tela do Codex.
- Down/release de seat: problema de tmux compartilhado e de sessão adotada por fora. O Donel é dono dos PTYs por `ptyId` e do tmux remoto que ele mesmo criou; o kill guard e a faxina só agem no que o app abriu.
- Workflow, execution view e scope: slices e SPEC em YAML/frontmatter e auditoria de escopo do CLI rig (topologia escrita à mão, fora de escopo). A esteira no Mindscape (item 15) não tem slices nem lista de Requirements R.
- Compaction: o Donel não tem compactação gerenciada nem runner Pi. A renovação em voo (item 07) cobre o handoff, e o falso alarme de "readiness desconhecida" é da fila de avisos do daemon.
- Onboarding, operador e skills de mensagem ao humano: docs e skills do próprio OpenRig (instalador, operador, relay no painel do tmux). O "mandar só o que mudou" o Donel já tem nas rotinas do item 20 (dedup, histerese e teto por janela). Responder o ask em nome do dono é a pergunta que está com ele desde 08/11. Os commits `e783652` e `2f8756` nem resolvem no clone.
- MCP e CLI: mensagens e ajuda: textos de instrução do MCP e do CLI rig (ask-which, roster, seletor de modelo, URLs de hub, política herdada do time), sem equivalente: o MCP donel resolve o lugar pela aba e não tem roster, grant nem hub. O bearer ao gate do Mission Control é do daemon.
- Daemon: tmux, telemetria e desempenho: mecânica interna do daemon (socket tmux, telemetria de runner, fases de startup, log do Codex, worker OpenShell, layout do Codex 0.167), sem ideia nova para o Donel.
- Slack opt-in do OpenRig: integração própria do OpenRig, fora do plano. O Slack do dono passa só pela Composio e pelo Theo, fora do app.
- Release, docs e roadmap: packaging, release, pins e docs do próprio OpenRig (0.7.16, openrig-core 0.1.31).
- Testes e infra de CI: CI, fixtures de tmux e migração de Vitest do próprio OpenRig. O Donel segue a regra de testes enxutos.

## 2026-11-15 — b958a75..df98bcd

47 commits do OpenRig; versões novas: v0.7.15.

### Vale → PR

- **Renovação adota a sessão nova que responde depois do prazo** (plano: item 07, sessão renovada em voo, B36; sessão que não morre). Origem: OpenRig `c9e7f35`, `d245b87`. PR: https://github.com/xansde/donel-dev/pull/439. Teste primeiro: 3 testes novos de `completeRenewal` em `tests/session-renewal.test.ts` falharam antes ("completeRenewal is not a function") e o arquivo passou inteiro depois (17/17). O erro antigo no hook (`takeCompletion` só aceitava a fase `swapping`) não tem teste próprio, pela regra de testes enxutos; o PR diz isso. Verify verde pela fila, em dia com `origin/staging` (118 arquivos, 1504 testes, build ok). Pode conflitar com o PR #385 em `tests/session-renewal.test.ts` (este só acrescenta um bloco no fim). A pendência "atrasada" não expira sozinha: só cai com um id novo, com a aba fechada ou com outra renovação.

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- **Fila durável do item 13: mensagem a lugar ausente ou fechado.** Origem: OpenRig `bbcefee`, `2fae9e2`, `9b11c3c` (grava no outbox do remetente, desfecho recorded/sent false/persisted true; falha de gravação vira "não confirmada"). No Donel o PR #427 (aberto) só melhora o texto da recusa do `sessao_enviar` a lugar fechado. Pergunta: a fila durável do item 13 começa agora? Se sim, `sessao_enviar` a lugar fechado deve guardar a mensagem (com id e desfecho, sobrevivendo ao restart) e entregar quando o lugar reabrir, ou o app deve acordar o lugar antes de entregar, como o plano descreve?
- Seguem abertas as perguntas das seções anteriores (resposta do "esperando você" em nome do dono, desde 08/11; pausa até o reset do limite de uso, desde 12/11).

### Descartado

- Entrega de mensagem: leitura da caixa de entrada e diálogos do Claude/Codex: já igual ou melhor. `blockingScreen` em `src/shared/chat/screen.ts:226` trata como pergunta qualquer tela com "Enter to select" e "to navigate", o que cobre várias perguntas, o atalho de editor e a prévia; `remoteSessions.ts` usa "Enter to select". A caixa vazia e o Codex são captura de tmux do OpenRig.
- Lugar: pasta de runtime (runtime home) da conversa de um lugar existente: daemon/SQLite (migração 169). No Donel cada máquina tem um `~/.claude` só desde a demolição dos perfis (011, etapa 2), e o lugar já guarda conversa atual e anteriores. A retomada honesta já está no `sessao_retomar` e no PR #427.
- Compactação: aviso de recuperação a quem pode agir quando o lugar não tem pai: o Donel não tem compactação gerenciada nem fila de avisos do daemon. O caminho "quem age sem pai" já existe pelo Líder do quadro (`lider-quadro`) e pela rotina "sessão parada e ninguém vê" (item 20).
- Estado do lugar: atividade e sessão (`activityState` em `rig ps`, polling, episódios de cerimônia): CLI `rig ps` e daemon. O Donel já tem os três eixos em `src/shared/mindscape/sessionAxes.ts` e o "desconhecido" honesto (PR #313 mesclado, #417 aberto).
- MCP: nomes de pessoa para time e membros, rotação de token de grant: grants com token e rosters são do daemon. No Donel quem chama o MCP é o lugar resolvido pelo quadro, sem token por grant. O filtro de bidi e caracteres de controle em rótulo é só curiosidade, porque os nomes vêm do dono.
- MCP: rótulo de quem agiu num item de fila separado do chamador externo: já existe. O ledger grava o autor em todo evento, e quem chama é o lugar resolvido pelo quadro, nunca um argumento (item 19, `LedgerService.apply(ator, op)`).
- Troca de conta e token do Claude: aplicar token com painel que não é shell, capturar token adotado: toca credencial e troca de conta, o perímetro proibido `src/main/accounts/`, além de ser mecânica de shell do tmux.
- Lançamento: Claude recusado por `disableSideloadFlags`, lugar pausado que não bloqueia, nomes de sessão: tmux, sondagem de painel e flags do daemon. No Donel a recusa do CLI aparece no terminal da aba, que o dono vê, e o aviso de papel não entregue já existe (PR #311). Não há caso de managed settings com `disableSideloadFlags` nas máquinas do dono.
- Skills de lugar empacotadas sobrevivem a upgrade; guias de operação do lugar: docs, skills e packaging do OpenRig. Permissão do lugar chegar ao dono como pergunta já está coberta por `sessao_permissao` e pelo "precisa de você".
- Permissões: padrão do time mantido para política padrão ou aberta: política gravada no daemon/SQLite. No Donel o modo vem do papel e do Launcher (`src/shared/roleLaunch.ts`), e a renovação mantém o bypass (`tests/renovacao-mantem-bypass.test.ts`).
- Workflow e esteira: dependências, saídas em pacote de fronteira, adoção de sucessor: daemon/SQLite de workflow, com slices e spec em YAML (topologia à mão, fora de escopo). A esteira do Donel no quadro (item 15) não tem pacotes de fronteira.
- TUI: visão de topologia de rig remoto e Projects de frota entre hosts: TUI fora de escopo (dono, 03/11).
- pi-runner: painel nomeia seu lugar e marca as próprias linhas: específico do runner Pi em tmux, sem equivalente no Donel.
- CLI: validação de bundle e nomes de roster: bundle e roster da CLI `rig`, sem equivalente no Donel. O filtro de caracteres invisíveis é só curiosidade de sanitização.
- Testes e docs de teste do OpenRig: infra de teste do próprio OpenRig; o Donel segue a regra de testes enxutos.
- Release 0.7.15, README, roadmap e mapa de capacidades: packaging, release e docs do OpenRig.

## 2026-11-14 — c4b933e..b958a75

49 commits do OpenRig; versões novas: v0.7.14 e claude-directory-v0.1.2.

### Vale → PR

- **`sessao_enviar` a lugar fechado diz como retomá-lo** (plano: item 13, conexões entre sessões com significado; mensagem a lugar adormecido, passo antes do "acorda o lugar antes de entregar"). Origem: OpenRig `835526b`, `f809178`, `0a6d575`, `eae973d`, `3b32f76`, `dd02787`. PR: https://github.com/xansde/donel-dev/pull/427. Teste primeiro: não houve; a mudança altera só o texto da recusa do `sessao_enviar`, e a regra "Testes enxutos" do projeto não dá teste a texto (dito no PR). Verify verde pela fila, com `origin/staging` mesclada (115 arquivos, 1464 testes, build ok).

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

Nenhum novo. Seguem abertas as perguntas das seções anteriores (resposta do "esperando você" em nome do dono, desde 08/11; pausa até o reset do limite de uso, desde 12/11).

### Descartado

- Entrega de mensagem e rascunho do operador: o Donel já tem igual ou melhor. O `sendDriver` (`src/renderer/src/chat/sendDriver.ts`, `runEffects` e `sessionWriting`) segura as teclas do dono enquanto a sessão escreve e não manda Enter quando há tecla dele depois do Enter. A leitura da caixa e a escrita são síncronas, sem await no meio. O `sendMachine` recusa caixa maior que o nosso texto (`looksLikeOurs`/`stillInBox`). O envelope do Donel não leva dica de resposta para endereço humano.
- Fila: park/close com resumo e evidência: fila/inbox não pedida. O ledger do Donel já exige prova para entregar (`src/shared/ledger/contract.ts`, `applyLedgerOp`). O wake ladder é desempenho de daemon/SQLite.
- Watchdog de contexto e identidade do remetente: o Donel já tem. Quem chama o MCP é o lugar resolvido pelo quadro, nunca um argumento (`agentBridge`/`ledger-store`). A rotina "sessão parada" já trata sem sinal como achado, sem descartar o desconhecido (`src/main/rotinas/`). Posse de tmux e contagem de cerimônia são mecânica de daemon.
- MCP: escolha de assistente, host e ensino: não se aplica. O MCP donel resolve o lugar pela aba e não tem vários assistentes por pessoa nem hosts registrados. O resto é texto de ensino das skills do OpenRig.
- Credenciais de runner e política Codex por lugar: credencial de runner exigiria mexer em `src/main/accounts/`. O resto é política e hook do Codex no daemon do OpenRig.
- Daemon: inventário, snapshot e desempenho: daemon, tmux e ps do OpenRig, mecânica interna sem ideia nova para o Donel.
- Workflows: filtro de instâncias por escopo: rotas de workflow do daemon e work-install, refactor interno sem ideia nova para o Mindscape.
- Slack do OpenRig: integração Slack própria do OpenRig, fora do plano. O Donel fala com o Slack por Composio/Theo, fora do app.
- Descoberta de skills (frontmatter CRLF): o Donel já tem. `parseFrontmatter` em `src/shared/chat/commandCatalog.ts` divide as linhas com `/\r?\n/` e tira o BOM, então skill com CRLF já é lida.
- TUI: início só do daemon: TUI e daemon estão fora de escopo.
- Relatório de portabilidade `--strict`: script interno do repositório OpenRig (CI/packaging).
- Docs, skills e plugins: docs e skills do próprio OpenRig (rigs, instalador, Copilot CLI, versão mínima do plugin), sem comportamento novo para levar.
- Testes de CI em runner carregado: CI do próprio OpenRig.

## 2026-11-13 — f06edfa..c4b933e

71 commits do OpenRig; versões novas: v0.7.13 e claude-directory-v0.1.1.

### Vale → PR

- **Cartão do quadro mostra "desconhecido" quando a sessão está sem sinal há muito tempo** (plano: item 04 Cartão rico e estado em três eixos, "desconhecido vence resposta confiante e errada"). Origem: OpenRig `4c4d0f8`. PR: https://github.com/xansde/donel-dev/pull/417. Teste primeiro: em `tests/sessao-parada-aparece-parada.test.ts`, o caso de uma sessão trabalhando sem hook além de `STALE_SIGNAL_MS` falhou antes da implementação (o tique não emitia `signalStale`); o caso de uma ferramenta longa aberta, que segue sem a marca, também está no arquivo. A regra roda no tique do semáforo no processo principal e o renderer recebe só a marca `signalStale`; levar `lastEventAt` e `openCalls` ao renderer faria o app renderizar a cada hook, porque o `sameSemaphoreInfo` só guarda o que muda. Verify verde pela fila, em dia com `origin/staging` (110 arquivos, 1443 testes, build ok).

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

Nenhum novo. Seguem abertas as perguntas das seções anteriores (resposta do "esperando você" em nome do dono, desde 08/11; pausa até o reset do limite de uso, desde 12/11).

### Descartado

- Pessoa: resposta clicada e leitura do "precisa de você" por link: é a mesma pergunta que está com o dono desde 08/11 (uma sessão pode responder o "esperando você" em nome dele?) e ainda não tem resposta, então não abro outra. A resposta parcial como evento e o `needs-me.read` são da fila e do daemon do OpenRig.
- Entrega de mensagem: nova checagem da caixa de entrada e guardas de diálogo: o Donel já faz igual ou melhor. "Select model" está em `SCREEN_TITLES` (`src/shared/chat/screen.ts`), então o envio comum não digita no seletor. O app nunca responde sozinho o diálogo de confiança (auto-aceite removido em 23/07, `TerminalPane.tsx`; `trustDialog.ts` só detecta). A guarda de digitação vem das teclas que passam pelo app, sem raspar a tela do tmux (`sendDriver`/`tabSend`). Broadcast não existe, e os avisos fixos pós-hold são da fila do daemon.
- Estado do lugar: desconhecido, atividade do agente e inventário: a parte que vale (desconhecido também no grafo, `4c4d0f8`) virou o PR #417. O resto não se aplica: os tiles Rex por OSC 7501 são tmux/Rex, e os turnos do inventário, a varredura da execution view e os seats Codex são desempenho do daemon.
- Assistentes conectados: check-in na TUI, `rig ps` e `rig_team`: o Donel já tem igual. `agentBridge.ts` avisa "Seu lugar ainda não está no quadro", e o silêncio vira desconhecido desde o PR #313. A TUI está fora de escopo (dono, 03/11), e `rig ps`/`rig_team` são do CLI rig.
- Fila durável: varredura de travados, filtros e custódia: é a continuação do item 13 (fila durável), pendente com o dono desde 10/11 e ainda não começada. A mecânica (stuck sweep, avisos por pai, índices, wakes de park) é daemon/SQLite, sem onde encaixar hoje.
- Handover, renovação e reconstrução do lugar: no Donel a tarefa do ledger é do lugar, não da conversa, e a renovação em voo mantém o mesmo lugar (item 07, PRs #161/#321/#385), então não sobram claims do ocupante que sai para limpar. Snapshot e restore dependem do item 09, ainda pendente. AGENTS.md do Codex, diagnóstico de compactação e materialização sem launch são mecânica do daemon.
- Suíte de conformância da entrega de mensagens (harness com modelos de mentira): testes enxutos (dono, 03/11): nada de harness novo nem smoke em lote sem pedido do dono. A entrega já tem os testes do `sendMachine`. É engenharia de teste do próprio OpenRig, sem ideia de produto.
- Rede: inscrever em conta e conectar lugares por nome, pareamento: hub e rede de daemons não existem no Donel. O lugar remoto é ssh por chave (ADR 0005, `remote-session.ts`), e o Herdr workspace é da régua do B28 (só referência).
- MCP: limite de uso justo de grant service e permissão do runner: grant service e uso justo são do daemon do OpenRig. No Donel, limite e troca de conta tocam `src/main/accounts/` e `src/main/proxies/`, o perímetro proibido. A pausa até o reset do limite já está com o dono desde 12/11.
- Onboarding e setup: oferta de registrar a pessoa, times ajustados aos logins: operador do kernel e setup do rig com topologia do OpenRig, sem equivalente. No Donel o time é montado no quadro e os logins passam pelo motor de contas (`src/main/accounts/`, perímetro proibido).
- Config: entradas navegáveis com tipo, escolhas, faixa e rota de escrita: são o navegador de config e o validate do CLI rig (pins de harness, pressão de contexto do daemon). O Donel não tem CLI equivalente, e a config dele é a tela de configurações.
- Skills e docs de operação: promessas com escopo, hold após compactação, relay binding: são docs e skills do próprio OpenRig, sem ideia de design. Hold, relay e restore de skill são mecânica do daemon. "Continuar trabalhando com ask aberto" é orientação de papel que não pede mudança no app.
- Plugin edição de skills para o diretório do Claude: packaging e distribuição de plugin do OpenRig (claude-directory 0.1.1/0.1.2, LICENSE, `pack:release`), sem ideia de design.
- Release 0.7.13 e changelog: empacotamento, changelog e roadmap do próprio OpenRig, sem ideia de design.
- Infra de CI/testes e tmux: CI, fixtures e tmux do OpenRig (timeout, DNS, fuso, ulimit, hooks do Codex). A régua descarta CI do OpenRig e tmux.

## 2026-11-12 — 3a53a07..f06edfa

65 commits do OpenRig; versões novas: 0.7.12.

### Vale → PR

Nenhum.

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- Lugar parado por limite de uso espera o reset que a própria mensagem informa (itens 04 e 20 do plano: estado honesto e rotinas que acordam lugares; commits `a7b8a27`, `aae4395`): o OpenRig lê o horário de reset da mensagem de limite e estaciona o lugar até lá, retomando depois; mensagem sem reset claro mantém a nova tentativa a intervalo fixo. No Donel, `turnFailure === 'rate_limit'` vira só 'limite de uso' em `sessionAxes.ts`, sem horário. A rotina `sessao-parada` (`src/shared/rotinas/stalledSessions.ts`) avisa o Líder depois de 30 min, mesmo que o reset ainda esteja longe, e nada retoma o lugar quando o limite volta. A troca automática de conta (`src/main/accounts/auto-switch.ts`) cruza com isso e fica no perímetro proibido. Pergunta: quando uma sessão para por limite de uso, você quer (a) só mostrar no cartão e no aviso ao Líder 'volta às HH:MM', com a rotina sem avisar antes do reset, (b) além disso o app mandar 'continue' sozinho no reset, quando a troca automática de conta não tiver resolvido antes, ou (c) deixar como está, porque a troca automática de conta já resolve?

### Descartado

- Estado honesto: desconhecido vence resposta errada: O Donel já tem igual. O envio responde entrou/na-fila/não-foi/enviando (`tabSend.ts`). Uma leitura de statusline inválida vira `null` (sem medidor), nunca 0% (`statusLine.ts`). 'Trabalhando' sem sinal vira desconhecido (PR #313). O resto é escada de wake da fila do daemon, anel de host em rede, TUI e quadros do Codex.
- Pausa de lugar até o reset do limite de uso: A ideia ficou nos pendentes do dono, com a pergunta. O banner do Codex com apóstrofo curvo (aae4395) não se aplica: o Donel não lê a tela do Codex.
- Entrega de mensagem: rodapés de auto-update do Claude: O Donel já tem melhor. `hasFooter` (`src/shared/chat/screen.ts`) aceita qualquer texto abaixo da régua de base, e `readInputBox` acha a caixa só pela posição entre as duas réguas (`cliInputBox.ts`), sem lista de rodapés conhecidos. Por isso um '✘ Auto-update failed' cheio ou cortado não segura o envio.
- Respostas da pessoa a um runner pelo agente receptor: É a mesma pergunta pendente com o dono desde 08/11 (uma sessão pode decidir em nome dele?), ainda sem resposta. Não abro outra. No Donel, a permissão de outro lugar só se responde por `sessao_permissao`, com hierarquia (`reach.ts`).
- Conexão de lugar local a participante de hub (network): Hub e rede de daemons não existem no Donel. O lugar remoto é ssh por chave (ADR 0005, `remote-session.ts`).
- Fila: custódia e wake falho com achados roteados: É a continuação da fila durável (item 13), pendente com o dono desde 10/11 e ainda não começada. A mecânica (achados, custódia, IDs de bloqueio) é do daemon/SQLite, sem onde encaixar hoje.
- Rig down / unclaim: só para o terminal que prova ser do seat: É um problema de tmux compartilhado. O Donel é dono dos PTYs por ptyId, o lugar remoto anda pelo sid que o próprio app criou (`buildAttachSshArgs`), e a faxina e o kill guard já agem só no que o app abriu.
- Handover: sucessor lançado mas não pronto: O Donel já tem igual. Na renovação em voo, quando a sessão nova não confirma a tempo, o aviso é 'A sessão nova não respondeu a tempo. Confira a aba: a passagem de bastão ficou salva.' (`useSessionRenewal.ts`). Ele não manda tentar de novo.
- Assistente conectado: mostrar se está dando sinal: O Donel já tem igual. `agentBridge.ts` avisa 'Seu lugar ainda não está no quadro', e o desconhecido por silêncio veio no PR #313. O whoami durante o `rig up` e a TUI não têm equivalente.
- Compactação gerenciada e refocus limitado: São docs e mecânica do refocus e da compactação do daemon, mais o limite de contexto do Codex. A renovação em voo (item 07) cobre o handoff, e o refocus é da skill `refocusing`.
- Workflow/missões: leituras com escopo e rendimento: São comandos de workflow, slices e missões do daemon, sem ideia nova para o quadro. A esteira no Mindscape (item 15) não tem slices nem spec YAML.
- Terminal/herdr-app: docs de attach e tile: São docs de tiles tmux/Herdr e do pi-runner. O Donel é dono dos PTYs pelo xterm, e a prévia do cartão (item 05) segue pendente de refinamento.
- Daemon: esperas no thread principal e ssh/host: O Donel já tem igual. Todo ssh do app separa as opções do alvo com `--` (`remote-session.ts`, `buildAttachSshArgs`, `ledger-remote-proof.ts`). O recorder, o clipboard, as sondas TCP e o attach do tmux são do daemon.
- TUI: fuso do Feed e linhas de instância: A TUI está fora de escopo (decisão do dono, 03/11).
- CLI/config: correções pequenas: São pid do daemon, nome de rig com @ e chaves de config do CLI rig, sem equivalente no Donel.
- Guidance e plugins: bloco gerenciado único e vendoring: O bloco gerenciado é a mesma pergunta pendente desde 07/11 (papel de fábrica editado congela), sem resposta do dono. O vendoring de plugin, as URLs e o ícone são empacotamento do OpenRig.
- Release 0.7.12, roadmap e docs: É empacotamento, release e docs do próprio OpenRig, sem ideia de design.
- Testes, scripts e infra interna do OpenRig: São CI, fixtures e scripts do próprio OpenRig, sem ideia de design.

## 2026-11-11 — d5832cd..3a53a07

53 commits do OpenRig; versões novas: 0.7.11.

### Vale → PR

Nenhum.

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- Papel editado depois que o lugar abriu fica visível (commits `a5bda7f`, `85b4ccf`; itens 12 e 04 do plano): o OpenRig mostra no status do lugar se a orientação foi gravada antes ou depois de o agente carregá-la, sem afirmar que ele a leu. No Donel o papel chega só no lançamento (`roleLaunch.ts`, texto gravado para aquele lançamento). Hoje o único aviso é uma frase fixa no editor de papéis (`RolesEditor.tsx`: "Vale para os lugares que ainda vão abrir ou retomar"); um lugar vivo com o papel antigo não tem marca no cartão nem na aba. Pergunta: quando você edita um papel e há lugares vivos com a versão antiga, quer que o cartão e a aba deles mostrem "papel mudou depois que esta sessão abriu" (com renovar para pegar a versão nova)? Ou a frase do editor de papéis basta e a marca seria ruído?

### Descartado

- Pareamento de hosts e respostas a agente receptor: O Donel não pareia hosts por token de daemon: o lugar remoto é ssh por chave (ADR 0005, `remote-session.ts`). A parte "a resposta da pessoa vai a um agente que decide" é a mesma pergunta já pendente com o dono desde a rodada de 08/11 (responder o "esperando você" por uma sessão sua), ainda sem resposta. Não abro outra.
- Permissão do runner decidida pelo agente receptor: É a mesma pergunta pendente desde 08/11 (uma sessão pode decidir em nome do dono?). No Donel, a permissão de outro lugar só se responde por `sessao_permissao`, com hierarquia (`reach.ts`), ou pelo dono na tela. O destino do Slack não se aplica: o Slack passa só pela Composio.
- Entrega de mensagem: guarda contra diálogo e leitura da caixa do Claude: O Donel já tem igual ou melhor. O `evaluateGate` de `src/shared/chat/sendMachine.ts` lê a tela em todo envio (`blockingScreen` + `isReadyForInput`), sem o atalho de "hook ocioso recente" que causou o furo no OpenRig. A caixa é localizada pelas réguas (`locateInputBox`), então a dica de contexto abaixo do rodapé não a esconde. O ack-lookup confere o prompt no hook ou no transcript, o que já cobre a prova de entrega por send.
- Fila e varredura de travados (stuck sweep): Contadores e desempenho da varredura do daemon/SQLite. A fila durável (continuação do item 13) não começou, e o filtro das rotinas (item 20) já tem dedup, histerese e teto por janela.
- Lugar (seat): tipo resolvido numa fronteira e ciclo de vida por tipo: Refactor interno do daemon, sem ideia nova para o Donel.
- Orientação ao lugar: ponteiro de skills, refocus e recap: O ponteiro de skills, ajuda e contexto e o recap-write pertencem ao CLI rig e ao LEARNED.md do OpenRig. No Donel, o escopo do papel já define MCPs, plugins e skills por lugar, e as ferramentas do MCP donel se descrevem sozinhas. O refocus entre hooks sobrepostos é coisa da skill refocusing. A parte "orientação gravada depois do carregamento" foi para pendentes do dono.
- Restore, handover e aviso de restauração: Aviso de restore de compactação, rebuild do Codex e reserva de partida do daemon são mecânica do daemon tmux. A renovação em voo (item 07) já confirma a passagem (PR #321). O pré-lançamento que confia na raiz git canônica não afeta nenhum repo hoje: o lugar remoto já marca a pasta como confiável, e nenhum dos 8 repos em ~/seazone rastreia `.claude/settings.json` com `permissions.allow`, que é o gatilho do diálogo.
- Lugar esperando uma pessoa: nome da pergunta na CLI: O Donel já tem melhor. O "precisa de você" é contagem com todos os motivos em ordem estável (`sessionAxes.ts`), então um erro antigo não esconde a pergunta viva. O resto (dica de rig send, skill loadout) é saída do CLI rig, sem equivalente.
- Gateway Slack: resposta 200 ilegível pode ter postado: Fora do plano. O Slack do dono passa só pela Composio e pelo slack-guard, sem gateway próprio do app.
- TUI: cobertura de saúde e configuração de pareamento: A TUI está fora de escopo (decisão do dono, 03/11).
- Docs, skills, instalador, CI, testes e release 0.7.11: Packaging, release, CI e docs do próprio OpenRig, sem ideia de design nova.

## 2026-11-10 — 521405f..d5832cd

43 commits do OpenRig; versões novas: nenhuma identificada.

### Vale → PR

- Sessão renovada mais de uma vez recebe as passagens anteriores como histórico opcional (commits `c531d48`, `a43e09c`; item 07 do plano, seat do OpenRig): https://github.com/xansde/donel-dev/pull/385. Teste primeiro em `tests/session-renewal.test.ts` (3 renovações em sequência; falhou com `handoffChain` indefinido; caso do lugar remoto usa o caminho do lugar, nunca a cópia local). `npm run verify` verde pela fila (98 arquivos, 1271 testes, build ok).

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- Fila durável entre lugares (continuação do item 13; commits `3518c03`, `7078c754`, `83afa753`, `ac97493c`, `a11a78e`, `fcf0c0f`, `0e49fb8`, `24dd3eb`, `7f7dc97`, `e935533`, `06c05d6`, `10736e1`): o OpenRig acorda um item que nasceu antes de o lugar estar ligado assim que ele fica alcançável, mantém a custódia de quem responde no handoff, avisa quando um item estacionado esperando condição externa não tem quem o acorde e nomeia o sucessor de um item repassado. No Donel, as mensagens pendentes do sessao_enviar e o "quem abriu quem" vivem só na memória do main. A ordem de 04/11 punha a fila durável depois da entrega direta ao CLI e do Líder único, e as duas já andaram (PRs #376/#377 do Líder único estão abertos). Pergunta: abro agora o refinamento da fila durável (mensagem com id e desfecho que sobrevive ao restart, acorda o lugar adormecido antes de entregar, repassada por handoff), usando como base essas regras do OpenRig? Ou ela segue parada?

### Descartado

- Fila (queue): custódia, wake de itens sem rota, delegação, avisos (mecânica): A mecânica em si é daemon/SQLite (sweep de travados, prefixo unroutable, findings de delegates_to, polling, perf de listagem, --source @external), sem onde encaixar enquanto a fila durável não existe. A ideia de produto foi para o dono, em pendentes.
- Restore e compactação: input devido após prontidão desconhecida, defaults de rascunho: Mecânica do enforcer de compactação e do restore do daemon tmux (71aba02, 0830585). Quem entrega a passagem à sessão nova no Donel é o sendDriver/tabSend com renewalHandoffDeliveryNotice (PR #321), e o item 09 (restore por nó) segue pendente.
- Leitura de transcript pelo fim em blocos (a43e09c) e session-jsonl (b6e1604): O Donel já tem igual: transcripts JSONL nunca são lidos inteiros, só por streaming + stat (gotcha do CLAUDE.md). O session-renewal.ts lê inteira só a passagem, que é pequena. A parte da cadeia de passagens foi para o PR passagens-anteriores.
- Terminal: tiles graváveis, tamanho do terminal ativo, provider herdr-app: Específico de tiles tmux/Herdr e da TUI. O Donel é dono dos PTYs pelo xterm, e a prévia do cartão (item 05) segue pendente de refinamento.
- Prova: política exige todos os juízes: O ledger do Donel aceita com um revisor só, e quem entrega não aceita (item 19, D2). A política do repo é de 1 revisor (CLAUDE.md, 04/08). Vários juízes não estão no plano.
- Execução: escada do fluxo padrão mostra status gravado por fatia: View de missão/slices do daemon e da TUI (fora de escopo). O princípio 'não registrado não é o mesmo que não feito' o Donel já aprendeu com a trilha sintética (#35, congelada para reverter), e a esteira no quadro (item 15) não tem slices nem escada.
- Harnesses da comunidade: protocolo pi-rpc e wrappers de lançamento: Runtime Pi e wrappers de lançamento pertencem ao runtime do OpenRig. O Donel monta o argv no CommandBuilder, e motor de terceiro é assunto da 011. Mesmo motivo das rodadas anteriores.
- Gateway: relay pull-mode com outbox e vínculo humano: Gateway e outbox do daemon estão fora do plano, e o Slack do dono passa só pela Composio e pelo slack-guard.
- Retenção e apagamento de conteúdo da fila: Retenção e ledger de apagamento da fila SQLite do daemon. O Donel não tem fila durável, e o ledger (item 19) tem contrato próprio no userData.
- Slack do OpenRig: perguntas abertas e horário silencioso: Integração Slack própria do OpenRig, fora do plano. O Slack do dono passa só pela Composio.
- Daemon/tmux/MCP: credenciais, troca de token, escopo externo, fuso: Credenciais no ambiente do servidor tmux e grant externo são do daemon. A troca de token tocaria src/main/accounts/ (perímetro proibido). O alcance no Donel já mora em reach.ts.
- Scripts, testes, docs e perf internos: Guards de repo, fixtures, lista Help wanted e perf de Markdown do próprio OpenRig: packaging/CI/docs sem ideia de design.

## 2026-11-09 — 545a423..521405f

38 commits do OpenRig; versões novas: nenhuma identificada.

### Vale → PR

Nenhum.

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

Nenhum.

### Descartado

- Identidade de retomada: ocupante anterior não troca o alvo de retomada (`8064fc8`, `1c9d007`): O Donel já tem igual: a ponte de hooks (`src/main/hook-bridge.ts`, `registerSession`) dá token novo a cada lançamento da aba e apaga o antigo, então um hook do processo anterior não chega ao ptyId atual; o `session_id` só serve para correlação (`session-correlation.ts`). O guard de geração do OpenRig compensa o tmux/daemon, que o Donel não usa.
- Entrega de mensagem: leitura da caixa de entrada e override deliberado (`8b003da`, `7d43d56`, `b29a70f`, `ae04d25`, `4147d7d`): O Donel já lê a caixa por posição entre as duas réguas, imune à statusLine (`src/shared/cliInputBox.ts`; patchnote 31/10), e `sendDriver`/`tabSend` dão entrou/na-fila/não-foi com guarda de digitação. O override `--dangerously-interact` é flag do CLI rig, que o Donel não tem.
- Compactação e fila: espera de hooks e retomada de wake (`0a91a8f`, `3de06ef`, `44affad`): Mecânica de daemon/fila do OpenRig. A renovação em voo (item 07, PRs #161/#321) já cobre o handoff, e a fila durável (continuação do 13) ainda não começou.
- Tiles de terminal: linhas inteiras, attach só ao digitar, colagem inteira (`1538231`, `30b8232`): Específico de tiles tmux/Herdr. A prévia do cartão (item 05) segue pendente de refinamento e o Donel é dono dos PTYs pelo xterm.
- Troca de runtime do lugar com Pi e conta Pi (`5eaf0c1`, `2a17eef`, `d13ad48`): Runtime Pi não existe no Donel, e preparar conta tocaria `src/main/accounts/` (perímetro proibido).
- Restore e rig up: mensagens honestas (`e806c4d`, `faff36a`, `1c9d007`, `a2355b7`): Mensagens do CLI `rig up` e do orquestrador de restore do daemon. O Donel não tem esse CLI, e 'salvar e reabrir o quadro' (item 09) segue pendente, sem restore por nó onde aplicar.
- Slack do OpenRig: pergunta aberta, threads e liquidação (`d79049c`, `c415da6`, `a8574f8`): Integração Slack própria do OpenRig, fora do plano. O Slack do dono passa só pela Composio e pelo slack-guard.
- Escopo MCP/CLI: mensagens de rota e raízes visíveis (`521405f`, `fb02dd9`, `1b83d29`): O Donel já tem igual: as recusas de `reach.ts` e `agentBridge.ts` dizem o caminho ("o dono muda em 'Alcance'", "fale com quem está acima de você pelas setas", "só o Faxineiro fecha sem seta"). Raízes e workspaces com escopo são conceito do daemon.
- Workflow e slices: validate somente leitura, documentos alinhados (`1760d6e`, `a57285d`, `cc3a31d`): Comandos de workflow e slices do daemon do OpenRig, sem ideia nova para o quadro. A esteira no Mindscape (item 15) não tem spec YAML.
- Infra do daemon: tmux em escopo systemd, Codex hook trust, OpenShell, JSON de settings (`011b995`, `6b6aa91`, `4d7c50d`, `b40bc71`): Infra de tmux/systemd/Linux e dependências do daemon, sem ideia nova (a régua descarta tmux e daemon).
- Docs, skills, roadmap e testes de contrato (`7f4e326`, `46ba2f5`, `2add9ba`, `0964fb7`, `e1dedbf`, `ce0186c`, `f3268fa`, `cc3a31d`): Só docs, skills, roadmap e testes do próprio OpenRig (packaging/release), sem ideia de design.

## 2026-11-08 (2ª leitura) — 220e27a..545a423

2 commits do OpenRig; versão 0.7.10 (changelog publicado na main).

### Vale → PR

Nenhum.

### Vale → adiado

Nenhum.

### Vale → pendente para o dono

Nenhum.

### Descartado

- Changelog e release do OpenRig (0.7.10 levada ao CHANGELOG da main; baseline de plugins atrelada à 0.7.10; openrig-core 0.1.27): só empacotamento, release e docs do próprio OpenRig (`d2c5bbd` só copia texto do CHANGELOG, já triado na rodada anterior; `545a423` só muda a versão nos manifestos e a fixture de baseline). A régua descarta esse tipo de mudança, e não há ideia de design nova.

## 2026-11-08 — 7ae8f6e..220e27a

31 commits do OpenRig; versão 0.7.10.

### Vale → PR

- **Renovação em voo confirma que a sessão nova recebeu a passagem de bastão** (plano: item 07 Sessão renovada em voo, B36). Origem: OpenRig `2d0bd8b`, `f554785`, `92a1c738`, `4a18628`. PR: https://github.com/xansde/donel-dev/pull/321. Teste primeiro: em `tests/session-renewal.test.ts`, os 2 testes de `renewalHandoffDeliveryNotice` falharam antes de a função existir (2 failed, 7 passed) e passaram depois (9 passed). Verify verde pela fila, com `origin/staging` mesclada (74 arquivos, 1101 testes, build ok).

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- **Pessoa responde as perguntas do time pelo próprio assistente** (OpenRig `cab7f56`, `8a46d8f`). Ferramentas MCP com escopo de pessoa leem e respondem a Steering view, com operationId, revisão esperada e retry que reporta gravado/não gravado. No Donel, o "esperando você" do ledger e as decisões do Oráculo só se respondem como dono pela tela, pelo cartão ou pelo celular (PWA). Pelo MCP donel, toda chamada age como o lugar que chama, nunca como o dono (regra do ledger: quem chama é o lugar resolvido pelo quadro). Pergunta: quer que uma sessão sua (por exemplo, a conversa com o Jobu/Líder) possa responder em seu nome o que está "esperando você" (aceitar, rejeitar, responder decisão), com confirmação de gravado/não gravado? Ou o dono só responde pela tela e pelo celular, como hoje, para que nenhuma sessão vista o crachá de dono?

### Descartado

- Estado e atividade do lugar (helpers, retomada, estado honesto): o Donel já não mistura essas coisas: o hook carrega `session_id` e `session-correlation.ts` liga cada evento à aba pelo id. Um `claude -p` ou Codex auxiliar tem id próprio e não roda com o `--settings` da aba, então não mexe na atividade nem no id de retomada do lugar. O resto é relay de daemon.
- Fila, outbox e varredura de travados: mecânica de daemon/SQLite (poda de eventos, varredura em lote, claim entre hosts, polling). A fila durável (continuação do item 13) ainda não começou, e o filtro das rotinas (item 20) já tem dedup e teto por janela.
- MCP: roteamento de tarefa e lugar sem rig: o Donel já tem igual: `agentBridge.ts` avisa "Seu lugar ainda não está no quadro", e o envio segue as setas via `canSend`/`reach.ts`. Mesmo motivo da rodada anterior.
- Wrappers de lançamento para Claude Code local: pertencem ao runtime do OpenRig (shim, exec fixado, script gerenciado). O Donel monta o argv no `CommandBuilder`, não declara wrapper, e o plano não pede wrapper. O aviso de lançamento que não entrega o papel já entrou no PR #311.
- Workflow: objetivo raiz da execução: o Donel já carrega o pedido de origem: a tarefa do ledger nasce com a frase literal de quem pediu, e o `sessao_abrir` leva o pedido completo (skill `abrir-sessao-com-pedido-completo`). Nenhuma ideia nova para o quadro.
- Refocus e catálogo de projetos: ajustes internos do trace-to-root e de timeout do catálogo de skills do OpenRig. O advisory já vem pela skill `refocusing`, instalada aqui.
- ACP (`rig acp serve`): expor o orquestrador em outro editor não está no plano; a porta é o MCP donel. Mesmo motivo da rodada anterior.
- Plugin, marketplace, docs e TUI demo: packaging, docs e release do próprio OpenRig, e a TUI está fora de escopo (decisão do dono, 03/11).

## 2026-11-07 — c9b1ae4..7ae8f6e

165 commits do OpenRig; versões 0.7.4, 0.7.5, 0.7.6, 0.7.7, 0.7.8, 0.7.9.

### Vale → PR

- **Lançamento que pediu papel e não o entregou fica marcado, nunca silencioso** (plano: item 12 Papéis de sessão e item 07 Sessão renovada em voo). Origem: OpenRig `fe29a92e`, `5fb816f2`, `8e859020`. PR: https://github.com/xansde/donel-dev/pull/311. Lançamento local e remoto avisam em amarelo no topo do terminal da aba quando falta o papel ou o escopo; o lançamento não é barrado (barrar fica com o dono). Marca no cartão do Mindscape ficou de fora. Verify verde (68 arquivos, 1041 testes).
- **"Trabalhando" sem nenhum sinal há muito tempo vira "desconhecido" e a rotina enxerga** (plano: item 04 Cartão rico e estado em três eixos e item 20 Rotinas que acordam lugares). Origem: OpenRig `80e568e9`, `983c80f3`, `91d21bc9` (este último, quadros do Codex, não se aplica). PR: https://github.com/xansde/donel-dev/pull/313. O cartão do quadro ficou de fora (precisaria de relógio para reavaliar sem evento novo); teto de 30 min fixo. Verify verde (69 arquivos, 1053 testes).

### Vale → adiado

Nenhum (teto de 3 PRs não foi atingido).

### Vale → pendente para o dono

- **Papel de fábrica editado congela** (OpenRig `5f31cb57`, `46ce2bd8`, `8edc076d`). O OpenRig atualiza blocos de orientação gerenciados velhos sem sobrescrever a edição da pessoa. No Donel, editar um papel de fábrica (Dev, Revisor, Pesquisa, Líder) grava o arquivo inteiro em `<userData>/papeis/` e a orientação nova de fábrica nunca mais chega (`roles-store.ts`, `readOne`). Pergunta: quando a orientação de fábrica de um papel editado melhorar numa versão nova, prefere (a) bloco separado gerenciado pelo app, com a sua parte intocada, (b) aviso "há orientação nova de fábrica" para você escolher, ou (c) edição continua congelada como hoje?
- **Lugar retomado conta como "precisa de você" até o dono conferir** (OpenRig `7fae244b`, `78afeaa2`, `b1bed9f8`). Pergunta: depois de reabrir o app ou de uma retomada, quer que cada lugar retomado apareça em "precisa de você · retomada" até você olhar uma vez, ou isso viraria ruído e a retomada deve ficar quieta como hoje?

### Descartado

- Entrega honesta de mensagem (recibos incertos, rascunho, modos tmux): o Donel já tem igual ou melhor (`sendToTabAndWait` em `src/renderer/src/chat/composer/tabSend.ts` responde entrou/na-fila/nao-foi/enviando, com dedupe de reenvio; `sendDriver.ts` põe o dono primeiro com guarda de digitação); broadcast não existe e modos tmux não se aplicam.
- Estado honesto (pergunta citada não é diálogo, rodapé/seletor/banner, frames do Codex): `blockingScreen` em `src/shared/chat/screen.ts` já só conta permissão quando a caixa de entrada sumiu; o resto é parser de pane tmux e de outros runners.
- Estado honesto (claim não é "parado" com shell em segundo plano; observações de permissão): o Donel já marca `awaitingBackgroundAgents` e a renovação espera trabalho vivo; claims e permissões são do daemon/fila do OpenRig.
- Restore/handover (wakes falhos, entrega retida pós-compactação, retomada clássica, kernel variant): mecânica do daemon tmux; a renovação em voo (item 07) já resolve o handoff.
- ACP (`rig acp serve`/`run`, `@openrig/acp`): expor o orquestrador em outro editor não está no plano; o MCP `donel` já é a porta.
- Plugins de agente e canais do Claude: packaging e distribuição do OpenRig, sem ideia nova.
- Terminal, follow e prévia: tiles tmux/Herdr e reattach de websocket; a prévia do cartão (item 05) ainda não existe e depende de refinamento.
- Workflows e `rig exec`: comandos do CLI sobre o daemon; tarefa de uma linha já é `sessao_abrir` com papel e pedido.
- Fila durável, ledger e multi-host: inbox do daemon e host pair/ssh; fila durável (continuação do item 13) não iniciada e ledger (item 19) já tem contrato.
- Slack e gateway: fora do plano; Slack do dono passa só pela Composio e pelo slack-guard.
- Performance do daemon e hub de eventos: daemon/SQLite e control client tmux, sem ideia nova.
- UI For You e TUI: TUI fora de escopo (dono, 03/11); responder no cartão já existe no Oráculo (PRs #300/#306).
- Runners Pi/Codex/Claude: troca de contas toca `src/main/accounts/`; wrappers de launch e PATH são do runtime do OpenRig.
- Refocus e recap: advisory da skill `refocusing`, já instalada.
- Perfis de agente, specs e validação: topologia e perfis em YAML à mão, fora de escopo.
- MCP e roteamento de primeira tarefa: o Donel já tem (`agentBridge.ts` avisa "Seu lugar ainda não está no quadro"; envio segue as setas via `canSend`/`reach.ts`).
- CLI e doctor (robustez): doctor, probes e preflight do `rig`; o Donel não tem CLI equivalente.
- Docs, release, CI e testes: packaging/release/CI do OpenRig, sem ideia nova.
- Tmux control mode (aviso de modo desligado): específico de tmux.
- Demais correções de daemon/transport: identidade nativa de pane, openshell, escopo de audit, TUI light; sem equivalente no Donel.
