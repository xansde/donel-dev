# Motor de contas em cada VPS: instalação e passagem das contas

Desenho e decisões no [ADR 0008](adr/0008-contas-das-vps-sem-o-pc.md), emendado
pelo [ADR 0009](adr/0009-um-motor-de-contas-por-vps.md) ("cada VPS deve ter sua
própria ferramenta de troca de conta"). Este arquivo é o passo a passo do dono.

O serviço `donel-servico` roda **em cada VPS** por systemd e reinicia sozinho.
Cada um troca **só a conta da própria VPS** a 90%, com o PC desligado e sem
depender da outra VPS. São três conjuntos de contas: o do PC, o da VPS pessoal
e o de Homologações. O PC continua com as dele, com preferência.

Regra de ouro: **uma conta, um conjunto.** A conta que vai para uma VPS sai do
PC (ou da outra VPS) antes, ou no mesmo passo. Nunca rode `/logout`, porque ele
revoga o token no servidor.

Repita os passos 0 a 4 **em cada VPS**.

## 0. Instalar (uma vez; a cada atualização, rode de novo)

Num checkout de `staging` da própria VPS. Na VPS pessoal (usuário comum, com
sudo):

```bash
cd ~/seazone/"Donel Dev" && git fetch origin
git worktree add --detach .claude/worktrees/servico origin/staging 2>/dev/null || git -C .claude/worktrees/servico checkout --detach origin/staging
cd .claude/worktrees/servico && npm ci
sudo bash scripts/servico/instalar.sh
```

Em Homologações, tudo roda como `root`, e o `~/.claude` do rig é o
`/root/.claude`. Por isso o usuário do serviço é `root`:

```bash
cd /root/seazone/"Donel Dev" && git fetch origin
git worktree add --detach .claude/worktrees/servico origin/staging 2>/dev/null || git -C .claude/worktrees/servico checkout --detach origin/staging
cd .claude/worktrees/servico && npm ci
DONEL_SERVICO_USER=root bash scripts/servico/instalar.sh
```

O script cria a chave do cofre uma vez, cifrada pelo systemd deste host
(`/etc/donel/vault-key.cred`). **Não apague esse arquivo**: sem ele, o cofre
fica ilegível e as contas precisam de login de novo. A chave só abre neste
host. Para ver se o serviço está de pé, use `systemctl status donel-servico` e
`donel-servico estado`.

## 1. Tirar a VPS do PC (o PC continua com as contas dele)

Um lugar, um motor. Se o PC ainda controla esta VPS em Contas › Lugares, os dois
motores mexem no mesmo `~/.claude`. No PC:

1. Em Contas › Lugares, anote a conta desta VPS (Homologações estava na Conta 8).
2. Feche **todos** os canais do Donel (Alfa, Beta e o estável usam os mesmos
   dados).
3. Faça uma cópia: `copy %APPDATA%\donel-dev\config.json %APPDATA%\donel-dev\config.json.bak-0611`.
4. Abra `config.json` e, dentro de `"accounts"`:
   - em `"remotes"`, apague a entrada desta VPS;
   - em `"localAccounts"`, apague a entrada da conta que estava nela (pelo `id`
     anotado; o `label` ajuda a achar).
   Não mexa em mais nada.
5. Abra o Donel. A faxina da abertura tira do cofre do PC o par dessa conta. Em
   Contas, confira se a VPS sumiu dos lugares e se as contas do PC estão lá.

O app do PC não tem botão para isso: o painel bloqueia tirar um lugar que tem
conta, de propósito. Esse botão ("Entregar à VPS") é uma fatia seguinte.

## 2. Adotar a conta que já está logada nesta VPS (sem login novo)

Na VPS:

```bash
donel-servico contas adotar "Conta 8"
```

O par vivo do `~/.claude` desta VPS vai para o cofre dela, e a VPS fica com a
conta. Nenhum token passa pelo PC.

## 3. Dar contas de reserva para esta VPS

Sem reserva, não há para onde trocar. Cada VPS precisa das suas. Sugestão:
dividir entre as duas VPS as 7 contas que o PC marcou "Reconectar" em 05/11
(Conta 1, 2, 3, 5, 7, Orca e Tech 89). No PC elas já estão mortas, e logar de
novo na VPS custa o mesmo que reconectar no PC. **Cada conta vai para uma VPS
só.** Para cada uma:

1. **No PC:** Contas › a conta › Remover.
2. **Na VPS** que vai ficar com ela:

   ```bash
   mkdir -m 700 ~/.donel/login-conta1
   CLAUDE_CONFIG_DIR=~/.donel/login-conta1 claude
   # dentro do claude: /login, abra o link, entre na Conta 1, cole o código; depois /exit (nunca /logout)
   donel-servico contas colher ~/.donel/login-conta1 "Conta 1"
   rm -rf ~/.donel/login-conta1
   ```

   O `colher` guarda o par no cofre e apaga o `.credentials.json` da pasta.

Mudar uma conta de uma VPS para a outra é o mesmo gesto: `donel-servico contas
remover <id>` na de origem (a conta não pode estar ativa nela) e login isolado
+ `colher` na de destino.

## 4. Conferir

```bash
donel-servico estado        # cada conta com carga, qual está "aqui", motor "ready"
tail ~/.donel/accounts-maintenance.log
journalctl -u donel-servico -n 50
```

A troca automática aparece no log como `auto-switch`. Uma conta com
`reconectar: true` no `estado` (ou `account-pair-refresh-failed` no log) pode
estar em dois conjuntos ao mesmo tempo. Tire-a de um deles e faça login de novo
no outro.

Troca à mão: `donel-servico contas trocar <id da conta>` (os ids estão no
`estado`).

## Desfazer

```bash
sudo systemctl disable --now donel-servico
sudo rm -f /etc/systemd/system/donel-servico.service /usr/local/bin/donel-servico
sudo systemctl daemon-reload
sudo rm -rf /opt/donel-servico
```

A conta ativa continua logada no `~/.claude` desta VPS, e o CLI segue usando
ela. O cofre (`~/.donel/`) e a chave (`/etc/donel/vault-key.cred`) ficam. Não
apague os dois se for reinstalar. Para o PC voltar a controlar a VPS, feche o
Donel no PC, volte `config.json.bak-0611` para `config.json` e abra de novo.
As contas colhidas nesta VPS só voltam ao PC com um login novo lá.
