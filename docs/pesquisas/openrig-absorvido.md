# OpenRig — registro de absorção

Último commit absorvido: 7ae8f6ef5b636c4a127e1d5976eb37972da9c3af

Referência de design do Mindscape (github.com/mvschwarz/openrig). Procedimento na skill `absorver-openrig`. Cada rodada lista o que virou PR, o que ficou adiado, o que espera o dono e o que foi descartado.

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
