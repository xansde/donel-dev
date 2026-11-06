#!/bin/sh
# Instala um sshd só na tailnet (porta 2222), só por chave, sem o check do Tailscale SSH.
# Uso: sh instalar-sshd-tailnet.sh "<chave publica>"   (rodar como root na VPS)
set -eu
PUB="$1"
IP=$(tailscale ip -4 | head -n1)
[ -n "$IP" ] || { echo "sem IP da tailnet"; exit 1; }
mkdir -p /etc/ssh/donel-tailnet
umask 077
printf 'from="100.64.0.0/10",no-agent-forwarding,no-X11-forwarding %s\n' "$PUB" > /etc/ssh/donel-tailnet/authorized_keys
umask 022
cat > /etc/ssh/sshd_tailnet_config <<CONF
# Donel Dev: sshd separado, só no IP da tailnet. Desfazer: docs/handoffs/2026-11-06-ssh-tailnet-vps.md
Port 2222
ListenAddress $IP
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_ecdsa_key
HostKey /etc/ssh/ssh_host_rsa_key
PidFile /run/sshd-tailnet.pid
AllowUsers root
PermitRootLogin prohibit-password
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthorizedKeysFile /etc/ssh/donel-tailnet/authorized_keys
UsePAM yes
X11Forwarding no
AllowAgentForwarding no
PrintMotd no
ClientAliveInterval 120
Subsystem sftp /usr/lib/openssh/sftp-server
CONF
cat > /etc/systemd/system/sshd-tailnet.service <<'UNIT'
[Unit]
Description=OpenSSH so na tailnet (Donel Dev, porta 2222)
After=tailscaled.service network-online.target
Wants=tailscaled.service network-online.target

[Service]
ExecStartPre=/bin/mkdir -p -m0755 /run/sshd
ExecStartPre=/usr/sbin/sshd -t -f /etc/ssh/sshd_tailnet_config
ExecStart=/usr/sbin/sshd -D -f /etc/ssh/sshd_tailnet_config
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
mkdir -p /etc/systemd/system/ssh.service.d
cat > /etc/systemd/system/ssh.service.d/donel-preserve-rundir.conf <<'DROP'
# Donel Dev: /run/sshd tambem serve ao sshd-tailnet; nao apagar ao parar o ssh.service.
[Service]
RuntimeDirectoryPreserve=yes
DROP
mkdir -p -m0755 /run/sshd
/usr/sbin/sshd -t -f /etc/ssh/sshd_tailnet_config
systemctl daemon-reload
systemctl enable --now sshd-tailnet.service
sleep 1
systemctl is-active sshd-tailnet.service
ss -ltnp | grep 2222
