# Um motor de contas por VPS: estado em 06/11 e o passo do sábado

Decisão do dono (06/11, por volta das 06:20), literal, corrigindo a carta que
tinha sido aceita por engano com "contas pelo OpenRig":

> "Contas pelo donel. Mas cada VPS deve ter sua própria ferramenta de troca de
> conta para não depender do meu pc ligado"

Desenho no [ADR 0009](../adr/0009-um-motor-de-contas-por-vps.md), que emenda o
[ADR 0008](../adr/0008-contas-das-vps-sem-o-pc.md). Passo a passo completo do
dono em `docs/servico-vps.md`.

## O que mudou no switcher das VPS (PR da fatia 01)

- O serviço `donel-servico` passa a ser instalado em **cada** VPS e troca só o
  `~/.claude` da própria máquina. Ele não tem lugar remoto nem ssh: os comandos
  `lugar ...` saíram, e a config do serviço descarta `remotes`.
- A opção do motor "Homologações escolhe primeiro" (`remotePlacesFirst`) saiu.
  No PC, a ordem é a de sempre.
- A regra "carga cega 10 min = cheia" fica, para os lugares que o PC controla.
- `adotar` e `trocar` não levam mais lugar: `contas adotar <rótulo>` e `contas
  trocar <conta>`.
- `scripts/servico/instalar.sh` aceita `DONEL_SERVICO_USER=root`, porque em
  Homologações tudo roda como root.
- Teste novo: o motor, sem o PC e sem conta real, troca a conta da VPS quando
  ela passa de 90% (`tests/servicoContas.test.ts`).

## O que NÃO foi feito (de propósito)

- Nada foi instalado nem ligado no systemd desta VPS. Não existem
  `/opt/donel-servico`, `/etc/donel` nem a unidade.
- Ninguém tocou no `/root/.claude` desta VPS.
- Nada em `main`. Os PRs vão contra `staging`, e um Revisor confere.

## Sábado: instalar em Homologações (com o aval do dono)

Pré-requisitos:
- o PR da fatia 01 está mesclado em `staging`;
- o dono tirou Homologações de Contas › Lugares no PC (`docs/servico-vps.md`,
  passo 1). Se o PC estiver desligado e o passo ficar para depois, não é perigo
  imediato: a escrita do PC é compare-and-swap e não atropela a VPS. Mas o PC
  guarda cópia da conta, então o passo continua obrigatório antes de ele voltar
  a ligar.

Como root, em `vps-time-homologacoes`:

```bash
systemctl --version | head -1          # precisa ser 250 ou mais (hoje: 255)
cd /root/seazone/"Donel Dev" && git fetch origin
git worktree add --detach .claude/worktrees/servico origin/staging 2>/dev/null || git -C .claude/worktrees/servico checkout --detach origin/staging
cd .claude/worktrees/servico && npm ci
DONEL_SERVICO_USER=root bash scripts/servico/instalar.sh
donel-servico estado                   # motor "ready", nenhuma conta ainda
donel-servico contas adotar "Conta 8"  # a conta que está logada agora no /root/.claude
```

Depois, as reservas desta VPS: login isolado + `donel-servico contas colher`,
uma por conta (`docs/servico-vps.md`, passo 3). Cada conta vai para uma VPS
só.

O OpenRig não precisa de nada. O rig usa o `/root/.claude`, e uma sessão viva
adota a conta nova na mensagem seguinte (provado com o CLI real em 13/09, na
Fase 0 das contas).

Para conferir:

```bash
systemctl status donel-servico --no-pager
donel-servico estado
tail -f /root/.donel/accounts-maintenance.log    # "auto-switch" quando passar de 90%
```

## Desfazer

```bash
systemctl disable --now donel-servico
rm -f /etc/systemd/system/donel-servico.service /usr/local/bin/donel-servico
systemctl daemon-reload
rm -rf /opt/donel-servico
```

A conta que estiver ativa continua logada no `/root/.claude`, e o rig segue com
ela. O cofre (`/root/.donel/`) e a chave (`/etc/donel/vault-key.cred`) ficam:
não apague os dois se for reinstalar. Apagar a chave torna o cofre ilegível.
Para o PC voltar a controlar Homologações, adicione o lugar de novo no PC
(Contas › Lugares).

## Na VPS pessoal

É o mesmo passo, com `sudo bash scripts/servico/instalar.sh` a partir do
usuário dela (`docs/servico-vps.md`, passo 0). Ela não precisa mais de ssh até
Homologações: o passo de liberar isso na tailnet caiu.

## O Oráculo (PR da fatia 02)

Continua fazendo sentido no serviço da **VPS pessoal**. O registro de tarefas é
um só, para todos os quadros, e não se divide por VPS como as contas. O PR só
teve o conflito resolvido. Há um ponto de atenção para quando o serviço for
instalado em Homologações com aquele PR já em `staging`: a API do Oráculo
também sobe lá, vazia e sem token, e responde 401 a tudo. Não faz mal, mas é
um segundo Oráculo vazio. Antes de instalar em Homologações, vale ligar a API
só onde houver token (`donel-servico oraculo token`). Isso é uma linha no
`startOraculoApi` e fica para a fatia 02b.
