# OpenRig — registro de absorção

Último commit absorvido: 545a4234893ed51294d45b066e81b0fec3d471eb

Referência de design do Mindscape (github.com/mvschwarz/openrig). Procedimento na skill `absorver-openrig`. Cada rodada lista o que virou PR, o que ficou adiado, o que espera o dono e o que foi descartado.

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
