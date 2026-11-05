#!/usr/bin/env bash
# Instala (ou atualiza) o serviço Donel sem tela na VPS pessoal — ADR 0008.
# Uso, da raiz de um checkout de staging:  sudo bash scripts/servico/instalar.sh
#
# - builda o bundle (npm run build:servico) como o usuário dono do checkout;
# - copia para /opt/donel-servico e cria /usr/local/bin/donel-servico;
# - cria a chave do cofre UMA vez, cifrada pelo systemd (/etc/donel/vault-key.cred);
#   nunca sobrescreve uma chave existente (chave nova = cofre ilegível);
# - instala a unidade donel-servico.service (User = quem chamou o sudo) e reinicia.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "rode com sudo" >&2; exit 1; fi
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "$SERVICE_USER" || "$SERVICE_USER" == root ]]; then echo "rode com sudo a partir do seu usuário (não como root direto)" >&2; exit 1; fi
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE_BIN="$(sudo -u "$SERVICE_USER" bash -lc 'command -v node')"

sudo -u "$SERVICE_USER" bash -lc "cd '$REPO' && npm run build:servico"

install -d -m 0755 /opt/donel-servico
install -m 0644 "$REPO/out-servico/donel-servico.mjs" /opt/donel-servico/donel-servico.mjs
printf '#!/bin/sh\nexec %s /opt/donel-servico/donel-servico.mjs "$@"\n' "$NODE_BIN" > /usr/local/bin/donel-servico
chmod 0755 /usr/local/bin/donel-servico

install -d -m 0700 /etc/donel
if [[ ! -f /etc/donel/vault-key.cred ]]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | systemd-creds encrypt --name=donel-vault-key --with-key=auto - /etc/donel/vault-key.cred
  chmod 0600 /etc/donel/vault-key.cred
  echo "chave do cofre criada em /etc/donel/vault-key.cred (cifrada pelo systemd deste host)"
fi

sed -e "s#@USER@#$SERVICE_USER#g" -e "s#@NODE@#$NODE_BIN#g" "$REPO/scripts/servico/donel-servico.service" > /etc/systemd/system/donel-servico.service
systemctl daemon-reload
systemctl enable donel-servico.service >/dev/null
systemctl restart donel-servico.service
sleep 2
systemctl --no-pager --lines=5 status donel-servico.service || true
