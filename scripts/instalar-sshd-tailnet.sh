#!/bin/sh
# Instala (ou reinstala) um sshd só na tailnet (porta 2222), só por chave, sem o check do Tailscale SSH.
# Uso: sh instalar-sshd-tailnet.sh "<chave publica>"   (rodar como root na VPS)
#
# Idempotente E sem perda (13/11): rodar de novo nunca apaga o que já está lá.
# - authorized_keys: a chave só é ACRESCENTADA se ainda não estiver; as outras ficam (ex.: numeros-factory).
# - sshd_tailnet_config: os usuários de AllowUsers e os arquivos de AuthorizedKeysFile que já existem são MANTIDOS
#   (root e o arquivo da tailnet entram se faltarem; ex.: alexandrelentz e .ssh/authorized_keys na VPS pessoal).
# - Antes de trocar um arquivo, guarda uma cópia <arquivo>.bak-AAAAMMDD-HHMMSS ao lado.
# Ensaio sem tocar o sistema: DONEL_SSH_ROOT=/tmp/ensaio DONEL_SSH_SO_ARQUIVOS=1 DONEL_SSH_IP=100.64.0.9 sh ...
#   (grava só os arquivos sob o prefixo; não chama sshd, systemctl, ss nem tailscale).
set -eu
PUB="$1"
R="${DONEL_SSH_ROOT:-}"
SO_ARQUIVOS="${DONEL_SSH_SO_ARQUIVOS:-}"
STAMP=$(date +%Y%m%d-%H%M%S)
IP="${DONEL_SSH_IP:-}"
[ -n "$IP" ] || IP=$(tailscale ip -4 | head -n1)
[ -n "$IP" ] || { echo "sem IP da tailnet"; exit 1; }

KEYDIR="$R/etc/ssh/donel-tailnet"
KEYS="$KEYDIR/authorized_keys"
CONF="$R/etc/ssh/sshd_tailnet_config"
TAILNET_KEYS=/etc/ssh/donel-tailnet/authorized_keys

backup() { [ -f "$1" ] && cp -p "$1" "$1.bak-$STAMP" || true; }

# 1. Chave: acrescenta só se o corpo da chave (tipo + base64) ainda não está no arquivo.
mkdir -p "$KEYDIR"
umask 077
CORPO=$(printf '%s\n' "$PUB" | awk '{print $1" "$2}')
if [ -f "$KEYS" ] && grep -qF "$CORPO" "$KEYS"; then
  echo "chave já presente em $KEYS"
else
  backup "$KEYS"
  printf 'from="100.64.0.0/10",no-agent-forwarding,no-X11-forwarding %s\n' "$PUB" >> "$KEYS"
  echo "chave acrescentada em $KEYS ($(grep -c . "$KEYS") no total)"
fi
umask 022

# 2. Config: une o que já existe com o mínimo necessário.
USERS="root"
FILES="$TAILNET_KEYS"
if [ -f "$CONF" ]; then
  for u in $(awk 'tolower($1)=="allowusers"{for(i=2;i<=NF;i++)print $i}' "$CONF"); do
    case " $USERS " in *" $u "*) ;; *) USERS="$USERS $u" ;; esac
  done
  for f in $(awk 'tolower($1)=="authorizedkeysfile"{for(i=2;i<=NF;i++)print $i}' "$CONF"); do
    case " $FILES " in *" $f "*) ;; *) FILES="$FILES $f" ;; esac
  done
  backup "$CONF"
fi
cat > "$CONF.novo" <<CONF
# Donel Dev: sshd separado, só no IP da tailnet. Desfazer: docs/handoffs/2026-11-06-ssh-tailnet-vps.md
Port 2222
ListenAddress $IP
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_ecdsa_key
HostKey /etc/ssh/ssh_host_rsa_key
PidFile /run/sshd-tailnet.pid
AllowUsers $USERS
PermitRootLogin prohibit-password
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthorizedKeysFile $FILES
UsePAM yes
X11Forwarding no
AllowAgentForwarding no
PrintMotd no
ClientAliveInterval 120
Subsystem sftp /usr/lib/openssh/sftp-server
CONF
echo "AllowUsers $USERS"
echo "AuthorizedKeysFile $FILES"

if [ -n "$SO_ARQUIVOS" ]; then
  mv "$CONF.novo" "$CONF"
  echo "ensaio: só arquivos sob $R"
  exit 0
fi

# Valida a config nova ANTES de pô-la no lugar: uma config quebrada não derruba o sshd que está de pé.
/usr/sbin/sshd -t -f "$CONF.novo"
mv "$CONF.novo" "$CONF"

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
systemctl daemon-reload
if systemctl is-active --quiet sshd-tailnet.service; then
  systemctl reload sshd-tailnet.service   # HUP: relê a config sem cortar as conexões abertas
else
  systemctl enable --now sshd-tailnet.service
fi
sleep 1
systemctl is-active sshd-tailnet.service
ss -ltnp | grep 2222
