# Switcher do lugar remoto — 05/11

Pedido do dono (05/11, ~15h05): "ajusta a conta da VPS para uma conta disponível
uai. Quero ela com o switcher e tudo. Ela não pode ficar parada. De todas, é a
que menos pode ficar parada."

Horários abaixo em UTC (o log grava assim); hora local = UTC − 3.

## 1. Por que a VPS de Homologações não trocou sozinha

Fonte: `%APPDATA%\donel-dev\accounts-maintenance.log` e `config.json` (só os ids
e rótulos das contas), contra o código de `origin/staging` (63efb8e).

O que o log mostra:

| UTC | Evento |
|---|---|
| 15:31 | troca **manual**: Homologações sai da Conta 6 e vai para a Conta 8 |
| 15:50 | esta máquina, na Tech 47 a 90%, vai para o pool Seazone (72%) |
| 16:15 | esta máquina, no pool a 96%, vai para outra conta do pool (61%) |
| 16:35 | 7 contas recusam a renovação (Conta 1, 2, 3, 5, 7, Orca, Tech 89) |
| **17:00** | **esta máquina, no pool a 65%, volta para a Conta 4, a 0%** |
| 17:46 | cópia do par vivo da Conta 8 a partir da VPS (o poll remoto roda) |

Nenhum `remote-switch` com `origin: auto` no dia. O poll remoto roda: há
`remote-pair-captured trigger: sync` às 16:35 e 17:46, e `startPolling` lê a
carga sempre que há lugar com conta (`hasRemoteWithAccount`).

### Causa 1 (corrigida no PR): esta máquina pega a conta livre antes da VPS

`evaluateAutoSwitch` avaliava **esta máquina primeiro** e só depois os lugares
remotos. Para as candidatas, valem estas regras:

- o lugar remoto só usa contas próprias (as do pool Seazone ficam de fora: posse
  e heartbeat são por máquina);
- uma conta nunca fica ativa em dois lugares;
- 7 das 15 contas próprias estão marcadas "Reconectar" desde 16:35 e não contam.

Às 15:50 e às 16:15, esta máquina foi para o pool Seazone. Pela regra "locais
primeiro", isso prova que nenhuma conta própria livre estava com carga conhecida
≤ 70% e ≤ 76%. Ou seja, nesse período não havia para onde mandar a VPS. Às 17:00
a Conta 4 apareceu a 0%, e a regra de "voltar do pool" levou esta máquina para ela
**antes** de a VPS ser avaliada. Esta máquina estava a 65% no pool e não
precisava da conta. A VPS, sem o pool como reserva, ficou na Conta 8.

Prova parcial: o log não grava a carga da Conta 8 às 17:00. A sonda das ~17:40
(semana em 98%) e a ausência de qualquer troca automática remota tornam esta a
explicação mais provável. Mesmo assim, ela é inferida e não foi medida.

**Correção (PR):** avaliar os lugares remotos **antes** desta máquina. Teste novo
em `tests/accountsRemotePlaces.test.ts`: com esta máquina a 95%, a VPS a 98% e
uma só conta livre a 0%, a conta vai para a VPS. Esse teste falha com a ordem
antiga.

### Causa 2 (não corrigida): carga cega quando o par copiado vence

`local-mod.ts` (ramo `isHeldRemotely`) só lê a carga de uma conta que está num
lugar remoto quando o par copiado de lá ainda vale (`expiresAt > now`), e nunca
renova esse par. A cópia só chega quando o CLI de lá renova o token. Se a VPS
fica sem sessão rodando, ou se o CLI de lá para porque a conta encheu, o par
vence e ninguém o renova. A carga fica `null`, e `selectSwitchTarget` sai na
primeira linha (`activeLoad === null`).

O resultado é o pior momento possível: a conta enche, o CLI de lá para, a carga
fica desconhecida e a troca automática nunca acontece. Correção proposta (PR
separado):

- com o par vencido, a sonda de uso deve rodar **na própria VPS** (ssh, com o
  token de lá, sem trazer nada para cá), ou
- o caso deve contar como "cheia" para a política de lugar remoto: carga
  desconhecida há mais de N minutos vale como acima do limiar, desde que exista
  candidata com carga conhecida.

### Achado à parte: 7 recusas de renovação ao mesmo tempo (16:35)

Sete contas paradas tiveram o refresh token recusado no mesmo minuto. A hipótese
mais provável é outro computador com as mesmas contas renovando antes daqui
(refresh token de uso único). Não foi verificado. Isso tira 7 das 15 contas da
troca automática até o dono clicar em Reconectar.

## 2. Qual conta tem folga agora (~18:00 UTC)

Não li a carga das contas: para isso seria preciso usar os tokens do cofre, e o
pedido proibiu mexer nele. O que o log permite afirmar:

- **Conta 4**: 0% às 17:00. É a conta ativa **deste computador**. Para dar a
  Conta 4 à VPS: no painel Contas, mudar este computador para o pool Seazone e
  depois escolher a Conta 4 em Homologações.
- **Conta 6, Conta 13 e Conta 25**: o par foi renovado às 17:51, então o painel
  Contas tem a carga delas fresca. Olhar ali. A Conta 6 saiu de Homologações às
  15:31, provavelmente cheia.
- **Tech 47**: estava em 90% às 15:50.
- **Tech 50**: nenhum evento hoje. Conferir no painel.
- **Precisam de Reconectar antes de servir**: Conta 1, 2, 3, 5, 7 (Triton), Orca
  e Tech 89.

## 3. Desenho: switcher com o PC desligado

Entra junto com "Oráculo na VPS pessoal". Hoje o motor e o cofre moram neste
computador e falam com a VPS por ssh. Com o PC desligado, ninguém troca nada.

**Ideia:** um **conjunto de contas da VPS**, separado das contas deste
computador, com um motor pequeno rodando na própria VPS.

- **Cofre na VPS.** Um arquivo `~/.donel/accounts-vault.json` (0600, dono do
  usuário de serviço), cifrado com uma chave do sistema (`systemd-creds`, ou
  arquivo de chave fora do repositório). Guarda só as contas do conjunto da VPS.
  Nenhuma conta fica nos dois cofres: a regra "uma conta nunca ativa em dois
  lugares" vira "uma conta pertence a um só conjunto". Passar uma conta de um
  conjunto para o outro é um gesto explícito no painel, que **move** o par: grava
  lá, confirma e apaga daqui.
- **Motor na VPS.** Um serviço `donel-accounts` (systemd, `Restart=always`) que
  roda o mesmo núcleo puro de hoje (`auto-switch.ts`: `selectAutoSwitchTarget`,
  90/20). A leitura de carga usa o par vivo do `~/.claude` de lá e os pares do
  cofre de lá. A troca usa a mesma ordem invariante do `claude-state.ts`: captura
  o par rotacionado, grava `.credentials.json` e apaga `oauthAccount`. O poll é
  de 1 a 5 min, como aqui. Como a carga é lida lá, a "carga cega" da Causa 2
  some.
- **Log na VPS.** O serviço grava `~/.donel/accounts-maintenance.log` no mesmo
  formato de evento de hoje (`auto-switch`, `account-pair-refresh-failed`...),
  nunca com segredo.
- **Este computador vira um painel.** Quando o PC liga, o Donel lê por ssh o
  estado do motor de lá (contas do conjunto, carga e últimos eventos) e mostra
  em Contas › Homologações. A troca manual vira um pedido ao motor de lá, sem
  gravar credencial por ssh. O perímetro de credencial deste computador
  encolhe, porque o par de lá nunca mais cruza o ssh depois de entrar no
  conjunto.
- **Cadastro de conta no conjunto da VPS.** Login isolado feito **na VPS**
  (`CLAUDE_CONFIG_DIR` numa pasta própria, pelo terminal remoto do Donel). O
  motor de lá colhe o par, igual ao fluxo local de hoje.
- **Esgotou tudo.** Com todas as contas do conjunto acima do limiar, o motor
  registra `saturated` e avisa pelo Oráculo/ledger (o Líder vê no Jobu e o dono
  no celular). Ele não pega conta deste computador sozinho.
- **Pool Seazone na VPS:** fica de fora na V1, porque posse e heartbeat são por
  máquina. Se o dono quiser depois, o motor de lá vira um adaptador opcional com
  máquina própria no switcher.

**Emenda necessária no CLAUDE.md:** a exceção de credencial (`src/main/accounts/`)
ganharia um segundo perímetro, o serviço da VPS. O texto atual proíbe isso sem
emenda do dono. Precisa do OK literal dele e de um ADR (sucessor do 0005).

**Fatias sugeridas:** (1) núcleo de auto-switch empacotado como binário node
independente; (2) cofre e serviço na VPS, com log; (3) painel deste computador
lendo o estado de lá; (4) mover conta entre conjuntos.
