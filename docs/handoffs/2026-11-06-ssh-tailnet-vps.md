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

## O que mudou depois (07/11) e o estado conferido em 12/11

Conferido em 12/11 às 13h40, nas duas VPS, sem refazer nada:

- `sshd-tailnet.service` está `active` nas duas. Ele escuta só no IP da tailnet: `100.110.135.26:2222` na pessoal e
  `100.117.181.15:2222` na Homologações. O sshd principal continua na 22, com `PermitRootLogin no` e
  `PasswordAuthentication no` em `sshd_config.d/10-vps.conf`; o `/etc/ssh/sshd_config` não foi alterado.
- O `sshd -T -f /etc/ssh/sshd_tailnet_config` das duas devolve `authenticationmethods publickey`,
  `passwordauthentication no`, `kbdinteractiveauthentication no` e `permitrootlogin without-password`.
- Só no sshd da tailnet da **VPS pessoal**, em 07/11, para o app do PC falar com o lugar remoto "VPS" como o
  usuário dono das sessões (backup em `/etc/ssh/sshd_tailnet_config.antes-2026-11-07`):

  ```diff
  -AllowUsers root
  +AllowUsers root alexandrelentz
  -AuthorizedKeysFile /etc/ssh/donel-tailnet/authorized_keys
  +AuthorizedKeysFile /etc/ssh/donel-tailnet/authorized_keys .ssh/authorized_keys
  ```

  Para desfazer só isso: `cp /etc/ssh/sshd_tailnet_config.antes-2026-11-07 /etc/ssh/sshd_tailnet_config && systemctl restart sshd-tailnet`.
- No `/etc/ssh/donel-tailnet/authorized_keys` da **Homologações** há uma segunda chave, `numeros-factory`. É a chave
  da VPS pessoal: o alias `homologacoes-2222` de lá a usa. Para revogar só ela, apague a linha dela.
- Uso real em 12/11 (`journalctl -u sshd-tailnet`, `Accepted publickey`): o PC (`100.76.108.30`, a mesma chave
  ED25519 `SHA256:d9NJ…` nas duas) entrou como `root` na Homologações 1614 vezes e como `alexandrelentz` na pessoal
  ao longo do dia; a VPS pessoal (`100.110.135.26`) entrou 749 vezes na Homologações. Nenhum desses acessos passou
  pelo check da Tailscale, que só vale na porta 22 da tailnet.

Prova pela VPS pessoal (12/11):

```
$ ssh -o BatchMode=yes homologacoes-2222 'echo ok $(hostname) $(whoami) porta=$(echo $SSH_CONNECTION | cut -d" " -f4)'
ok vps-time-homologacoes root porta=2222
```

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

O script usado está em `scripts/instalar-sshd-tailnet.sh`. Desde 13/11 ele é idempotente **sem perda**: rodar de
novo só ACRESCENTA a chave se ela faltar (as outras, como a `numeros-factory` da Homologações, ficam) e MANTÉM os
usuários de `AllowUsers` e os arquivos de `AuthorizedKeysFile` que já existem (na VPS pessoal: `alexandrelentz` e
`.ssh/authorized_keys`, mudança de 07/11). Antes de trocar um arquivo ele guarda `<arquivo>.bak-<data>` ao lado,
valida a config nova com `sshd -t` antes de pô-la no lugar e, com o serviço de pé, só faz `reload` (não corta
conexões). Atenção: só `AllowUsers` e `AuthorizedKeysFile` são mesclados; qualquer outra diretiva posta à mão
na `sshd_tailnet_config` volta ao padrão do script (fica só no `.bak`). Antes de rodar, faça o ensaio
(`DONEL_SSH_ROOT=… DONEL_SSH_SO_ARQUIVOS=1`, abaixo) e compare a config que ele gera com a atual; se já rodou,
confira o `.bak-<data>` e, se havia outra diretiva, reponha-a e rode `systemctl reload sshd-tailnet`. A versão de 06/11 sobrescrevia os dois arquivos: rodá-la hoje derrubaria o `alexandrelentz` na VPS
pessoal e apagaria a `numeros-factory` na Homologações.

Ensaio sem tocar o sistema (só arquivos sob um prefixo): `DONEL_SSH_ROOT=/tmp/ensaio DONEL_SSH_SO_ARQUIVOS=1
DONEL_SSH_IP=100.64.0.9 sh scripts/instalar-sshd-tailnet.sh "<chave>"`.

Rodar como root na VPS, passando a chave pública:

```sh
ssh root@<vps> "cat > /root/i.sh && sh /root/i.sh '$(cat ~/.ssh/donel_vps_ed25519.pub)'; rm /root/i.sh" \
  < scripts/instalar-sshd-tailnet.sh
```
