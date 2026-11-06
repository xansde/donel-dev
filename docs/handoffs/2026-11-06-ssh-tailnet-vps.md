# SSH às VPS sem o check do Tailscale (06/11)

## Por quê

Em 05/11 o cofre Bitwarden da `vps-time-homologacoes` trancou às 15h30 e só foi destravado às 06h12
de 06/11. Para destravar, o PC precisava de ssh, e a Tailscale SSH (porta 22 da tailnet) pedia o
"additional check" — o login do dono no navegador. Com o dono dormindo, nada destrava. O vigia de
travas do app (fatia 2) precisa de um caminho que não dependa desse login.

## O que mudou

Nas duas VPS (`vps-time-homologacoes` e `vps-alexandrelentz`), como root:

| Arquivo | O que é |
|---|---|
| `/etc/ssh/sshd_tailnet_config` | config de um **segundo** sshd, só em `<IP da tailnet>:2222` |
| `/etc/ssh/donel-tailnet/authorized_keys` | a única chave aceita, com `from="100.64.0.0/10"` |
| `/etc/systemd/system/sshd-tailnet.service` | o serviço desse sshd (`Restart=always`, sobe depois do `tailscaled`) |
| `/etc/systemd/system/ssh.service.d/donel-preserve-rundir.conf` | `RuntimeDirectoryPreserve=yes`: o `/run/sshd` não some quando o `ssh.service` reinicia (o sshd da tailnet usa o mesmo diretório) |

Regras do sshd da tailnet: só `root`, só chave (`AuthenticationMethods publickey`,
`PasswordAuthentication no`, `KbdInteractiveAuthentication no`), `PermitRootLogin
prohibit-password`, sem agent/X11 forwarding. Escuta **só** no IP da tailnet, então nada novo fica
exposto na internet.

**Não mudou:** o sshd principal (porta 22, `/etc/ssh/sshd_config` e `sshd_config.d/`, que seguem
com `PermitRootLogin no`), a Tailscale SSH da porta 22 da tailnet e a política da tailnet.

No PC (`Seazone173`):

- chave nova dedicada `~/.ssh/donel_vps_ed25519` (+ `.pub`), comentário
  `donel-dev-vigia@Seazone173`, sem passphrase (o vigia roda sem ninguém);
- dois `Host` no `~/.ssh/config`: `vps-homolog-donel` e `vps-pessoal-donel` (porta 2222, root,
  `IdentitiesOnly`, `BatchMode`, `HostKeyAlias` próprio no `known_hosts`).

## Prova (06/11, 06:20)

```
$ ssh -o BatchMode=yes vps-homolog-donel 'echo ok $(hostname) $(whoami)'
ok vps-time-homologacoes root
$ ssh -o BatchMode=yes vps-pessoal-donel 'echo ok $(hostname) $(whoami)'
ok vps-alexandrelentz root
```

Funciona tanto no `ssh` do Git quanto no `C:\Windows\System32\OpenSSH\ssh.exe`. Senha e outro
usuário são recusados (`Permission denied (publickey)`). Depois de `systemctl restart ssh.service`,
a porta 2222 segue atendendo.

## Como desfazer

Em cada VPS (pelo caminho de sempre, `ssh root@<vps>` na porta 22 da tailnet):

```sh
systemctl disable --now sshd-tailnet.service
rm -f /etc/systemd/system/sshd-tailnet.service \
      /etc/systemd/system/ssh.service.d/donel-preserve-rundir.conf \
      /etc/ssh/sshd_tailnet_config
rm -rf /etc/ssh/donel-tailnet
rmdir /etc/systemd/system/ssh.service.d 2>/dev/null
systemctl daemon-reload
```

No PC: apagar os dois blocos `Host vps-*-donel` do `~/.ssh/config`, as linhas
`vps-*-2222` do `~/.ssh/known_hosts` e `~/.ssh/donel_vps_ed25519*`.

Revogar só a chave (perdeu o PC, por exemplo), sem desmontar o resto: esvaziar
`/etc/ssh/donel-tailnet/authorized_keys` nas duas VPS.

## Reinstalar

O script usado está em `scripts/instalar-sshd-tailnet.sh` (idempotente). Rodar como root na VPS,
passando a chave pública:

```sh
ssh root@<vps> "cat > /root/i.sh && sh /root/i.sh '$(cat ~/.ssh/donel_vps_ed25519.pub)'; rm /root/i.sh" \
  < scripts/instalar-sshd-tailnet.sh
```
