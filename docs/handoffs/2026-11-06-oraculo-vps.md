# Donel sem tela na VPS pessoal: estado ao fim de 05/11 (para 06/11)

> **Desatualizado na parte das contas (06/11):** o dono decidiu um motor por
> VPS ([ADR 0009](../adr/0009-um-motor-de-contas-por-vps.md)). Não há mais
> "Homologações escolhe primeiro" nem ssh da VPS pessoal até Homologações. O
> estado e os passos novos estão em `2026-11-06-motor-por-vps.md`.

Pedido do dono (05/11): a VPS pessoal autônoma, sem depender do PC, com o
switcher de contas, o Oráculo, as cartas no celular e o MCP donel morando lá.
Prazo: 06/11. Fatias em `BACKLOG.md`, demanda `donel-vps`. Desenho de contas no
ADR 0008. Passo a passo do dono em `docs/servico-vps.md`.

## Pronto (em revisão)

| Fatia | PR | O quê |
|---|---|---|
| 01 | #248 | Serviço `donel-servico` (systemd, `Restart=always`) com o motor de contas das VPS: conjunto próprio, cofre AES-GCM com chave do systemd, troca a 90% da VPS pessoal e de Homologações (Homologações primeiro). PC com a preferência. Carga cega por 10 min conta como cheia. |
| 02 | #249 (empilhada no #248) | O Oráculo mora no serviço: `~/.donel/ledger.json`, API só na tailnet (porta 47816) com token, `oraculo importar` (migração única, sem perder nada) e `oraculo token`. |

Por que Homologações não trocou em 05/11:
`docs/handoffs/2026-11-05-switcher-remoto.md` (branch `fix/switcher-remoto`).
O PC pegou a única conta livre antes da VPS. Por decisão do dono ("Prefiro
preferência no meu pc"), o #245 não entra. A disputa some porque cada lado
passa a ter o seu conjunto de contas.

## Falta (nesta ordem)

1. **Instalar o serviço** na VPS pessoal depois do merge do #248:
   `sudo bash scripts/servico/instalar.sh` num checkout de staging (passo 0 do
   guia).
2. **02b: o PC como cliente do Oráculo.** Um cliente HTTP no main, atrás das
   portas de hoje: IPC `ledger:*`, `executeLedgerTool` (o caller continua sendo
   resolvido no PC e vai junto em `/v1/oraculo/ferramenta`; a prova em arquivo
   sobe antes por `/v1/oraculo/anexo`) e o progresso do Jobu. O token fica num
   arquivo em `userData`. **A migração do Oráculo só depois disso.**
3. **03: cartas no celular pela VPS.** `src/main/celular/` (server, auth,
   ledger-port, tailscale) já roda sem Electron, então é ligar no `run()` do
   serviço sobre o Oráculo da 02, com HTTPS da tailnet (`tailscale cert`) e o
   aviso do #243.
   - Atenção: o PWA guarda o token por origem. Com o endereço novo (VPS), o
     celular precisa parear uma vez. Levar o `celular.json` do PC mantém os
     aparelhos, mas não evita esse pareamento.
4. **04: MCP donel no serviço**, com `tarefa_*` e `sessao_*` da VPS.
   - Falta decidir: com o PC desligado, a VPS não tem o quadro
     (`mindscape.json` mora no PC), e as regras de alcance e de revisão
     (`isOpenedBy`/`isBelow`) precisam dele. Proposta: o PC empurra o quadro
     para o serviço quando está ligado, e o serviço usa a última cópia.
   - O MCP `donel` desta sessão falhou com 403 "Host not allowed": é o caso que
     o #239 resolve.
5. **05 e 06**: o PC como painel do serviço com o gesto "Entregar à VPS", e o
   aviso "todas cheias" no Oráculo.

## Passos do dono (06/11)

Detalhe em `docs/servico-vps.md`:

1. **Tailscale:** liberar o ssh de `vps-alexandrelentz` até
   `vps-time-homologacoes`, com `"action": "accept"` e o mesmo usuário que o PC
   usa. Hoje a tailnet recusa, e sem isso o serviço não troca Homologações.
2. **PC, com o Donel fechado:** copiar o `config.json`, tirar as VPS de
   `accounts.remotes` e as contas delas de `accounts.localAccounts`. A faxina
   da abertura limpa o cofre do PC.
3. **VPS:** `donel-servico lugar definir homologacoes ...`, depois `contas
   adotar homologacoes "Conta 8"` e `contas adotar aqui "<rótulo>"`.
4. **Reservas:** as 7 contas em "Reconectar" no PC (Conta 1, 2, 3, 5, 7, Orca e
   Tech 89). Remover cada uma no PC, fazer login isolado na VPS e rodar `contas
   colher`.
5. **Oráculo:** não migrar antes da 02b.

## Notas para quem continuar

- O git da VPS não tem identidade: os commits usam `GIT_AUTHOR_*` e
  `GIT_COMMITTER_*` = Alexandre Lentz, iguais aos das outras sessões daqui.
- O socket Unix tem limite de 108 caracteres no caminho: teste com HOME curto
  (`/tmp/claude-1000/x`), nunca com o scratchpad.
- No Linux, o `npm test` tem 2 falhas que já vêm do `staging` (`config-store`
  "cria o diretório pai" e `remoteSessions`), porque esperam caminho do Windows.
