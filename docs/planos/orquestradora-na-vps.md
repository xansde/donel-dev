# Orquestradora na VPS, PC só com o app

**Pedido do dono (08/11), literal:** "hoje seu objetivo é melhorar absurdamente a dinamica do uso da orquestradora.
Seja ela estando na VPS, seja organizando as mensagens, seja otimizando minha RAM. [...] Mas não pode deixar o proxy
sair no IP da VPS. Se não algumas ferramentas minhas caem." Tarefa t-3ebcfa78 (e o resto da t-5b9ce21e, #296).

**Efeito:** o Líder único e os Líderes de quadro rodam na VPS sem o dono escolher nada; o PC só carrega o app. Nenhum
tráfego do Claude de uma sessão da VPS sai pelo IP da nuvem.

## Inventário (08/11, 15 min, lido no código da staging `bc2315e`)

O que ainda põe uma sessão do Claude no PC, e por quê:

| # | Quem | Por que nasce no PC hoje | Onde está |
|---|---|---|---|
| 1 | **Líder único** | `leader.where` ausente = `'local'`. O #296 deu a escolha, mas o padrão é o PC, e o `config-store` grava o padrão na primeira escrita do config: depois dela, não há como distinguir "o dono escolheu o PC" de "nunca escolheu". | `src/shared/leaderPrefs.ts` (`DEFAULT_LEADER_PREFS`), `App.tsx` (`liderDeliverRef`) |
| 2 | **Líder de quadro** | Só o dono o abre (o `sessao_abrir` recusa o papel `lider`). O clique no lugar usa o "Onde roda" do Launcher (`launcherDefaults.where`), que é a última escolha do dono: se a última sessão que ele abriu à mão foi no PC, o Líder do quadro também vai. | `App.tsx` (`handleMindscapeStartPlace`) |
| 3 | Time aberto por um Líder | `sessao_abrir` sem `onde` nasce onde quem abriu roda. Um Líder no PC enche o PC; um Líder na VPS enche a VPS. Some com 1 e 2. | `agentBridge.ts` (`sessao_abrir`) |
| 4 | Sessão com motor de terceiro (`role.engine`) | Provedor de terceiro não roda em lugar remoto (ADR 0006). Fica no PC de propósito. | `App.tsx` |
| 5 | Retomar conversa | Volta onde viveu (`openWhereItLives`). Correto. | `App.tsx` |

O que só o app faz e a VPS já alcança: quadro, sessões, Oráculo, navegador e carta, pelo MCP `donel` no túnel reverso
do ssh (ADR 0006). Contas da VPS: o app grava por ssh (ADR 0005). Nada disso pede sessão no PC.

Proxy de saída (`scripts/proxy-saida`), dois furos que deixam o Claude da VPS sair pelo IP da nuvem:

- **A queda padrão é `direto`.** Com o PC fora (dormindo, Tailscale caída, 502), o relay manda Anthropic/Claude direto.
  O log desta VPS tem dezenas de `proxy-caiu ... direto (IP da nuvem)` entre 06 e 07/11.
- **O `proxy-saida.env` só liga o proxy se o relay estiver de pé na hora.** Sessão que nasce com o relay reiniciando
  roda a vida toda sem proxy.

(As chamadas de modelo nesta VPS já vão ao gateway do PC, porta 8317, pela Tailscale. O que vazava é o resto da lista:
`claude.ai`, `mcp-proxy.anthropic.com`, renovação de token e telemetria.)

## O que entra (PRs pequenos contra a staging)

1. **Proxy fechado** (`fix/proxy-saida-fechado`): a lista do Claude nunca sai direto. Sem o PC, o relay recusa (503)
   e avisa no log; a config antiga com `queda: "direto"` é ignorada, com aviso. O `proxy-saida.env` liga o proxy
   sempre (sem relay, a sessão fica sem rede em vez de sair pela nuvem; o relay é `Restart=always`). O resto (git,
   npm, MCP da Seazone) segue direto, como decidido em 06/11: o proxy do PC só aceita Anthropic/Claude.
   Teste: relay de verdade com o PC fora e config `direto` → `CONNECT api.anthropic.com:443` tem de dar 503. Se sair
   direto, dá 200 (com rede) ou 502 (sem rede), e o teste falha.
2. **Líderes na VPS por padrão** (`feature/lideres-na-vps-padrao`): `leader.where` ganha o valor `auto` = o primeiro
   lugar remoto com conta (a mesma regra do "Onde roda"), e passa a ser o padrão. O `local` gravado antes, sem a marca
   de escolha, conta como `auto`. O lugar com papel Líder no quadro abre onde o Líder único roda, não na última escolha
   do Launcher. Preferências ganha "Na VPS (padrão)".
   Teste: a resolução de onde o Líder roda (`auto`, `local` legado, `local` escolhido, lugar removido).

## Fora (corte para caber hoje)

- **`donel` CLI na VPS.** O MCP pelo túnel já alcança tudo que só o app faz para sessões nascidas pelo Donel. Fica
  para quando houver um caso concreto de cron ou `claude` à mão que precise do quadro.
- **Recusar abrir sessão em VPS sem proxy instalado.** Hoje só a homologações e a pessoal têm o proxy, e as duas já o
  têm.
- Tirar git/npm/MCP da Seazone do IP da nuvem: exige abrir o proxy do PC para qualquer destino, decisão do dono.

## Prova

- `npm run verify` em cada PR.
- Na VPS: `queda` desta VPS para `parar` já hoje (a config aceita), relay reiniciado, `estado` e log conferidos.
- RAM e sessões do Claude no PC antes e depois: daqui não alcanço o PC. Peço ao Líder um print do Gerenciador de
  Tarefas (ou `Get-Process claude`) antes do alfa da noite e depois, com o Líder único e o do quadro já na VPS.
