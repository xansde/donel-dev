# OpenRig — registro de absorção

Último commit absorvido: 3a53a07a50fc3e73564c134b76f079a8f48f7589

Referência de design do Mindscape (github.com/mvschwarz/openrig). Procedimento na skill `absorver-openrig`. Cada rodada lista o que virou PR, o que ficou adiado, o que espera o dono e o que foi descartado.

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
