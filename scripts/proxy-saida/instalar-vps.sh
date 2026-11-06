#!/usr/bin/env bash
# Instala o relay do proxy de saída nesta VPS (docs/handoffs/2026-11-06-proxy-no-pc.md).
# Normalmente chamado do PC por instalar-vps.ps1, que copia este script e o proxy-saida.mjs
# para uma pasta temporária e manda a senha pelo stdin (nunca por argumento).
#
#   echo "$SENHA" | bash instalar-vps.sh --upstream 100.76.108.30:3128 --usuario donel-vps \
#        [--queda direto|parar] [--porta 3128] [--settings]
#
# O que faz:
#   /opt/donel-proxy-saida/proxy-saida.mjs           o relay (mesmo arquivo do PC, modo "vps")
#   ~/.config/donel-proxy-saida/vps.json (600)       endereço do PC, usuário, senha, queda
#   donel-proxy-saida.service                        relay em 127.0.0.1, sobe com a VPS
#   ~/.donel/proxy-saida.env                         lido pelo claude.sh das sessões NOVAS do Donel
#   tmux -L donel setenv -g                          idem, enquanto o app do PC não lê o arquivo acima
#   donel-servico.service.d/proxy-saida.conf         o motor de contas desta VPS sai pelo mesmo caminho
#   --settings                                       também põe o proxy no env do ~/.claude/settings.json
#                                                    (vale para todo Claude da VPS, inclusive sessões vivas)
set -euo pipefail

UPSTREAM="" USUARIO="" QUEDA="direto" PORTA="3128" SETTINGS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --usuario) USUARIO="$2"; shift 2 ;;
    --queda) QUEDA="$2"; shift 2 ;;
    --porta) PORTA="$2"; shift 2 ;;
    --settings) SETTINGS=1; shift ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done
case "$QUEDA" in direto|parar) ;; *) echo "--queda precisa ser direto ou parar" >&2; exit 2 ;; esac
[ -n "$UPSTREAM" ] && [ -n "$USUARIO" ] || { echo "faltou --upstream ou --usuario" >&2; exit 2; }
UP_HOST="${UPSTREAM%:*}" UP_PORTA="${UPSTREAM##*:}"

IFS= read -r SENHA || true
SENHA="${SENHA%$'\r'}"
SENHA="${SENHA#$'\xef\xbb\xbf'}"  # BOM que um stdin do Windows possa trazer
[ -n "$SENHA" ] || { echo "a senha do proxy vem pelo stdin e chegou vazia" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo -n"
NODE="$(command -v node)"
ME="$(id -un)"
CONF_DIR="$HOME/.config/donel-proxy-saida"
PROXY_URL="http://127.0.0.1:$PORTA"
NO_PROXY_LIST="localhost,127.0.0.1,::1"

$SUDO install -d -m 755 /opt/donel-proxy-saida
$SUDO install -m 644 "$HERE/proxy-saida.mjs" /opt/donel-proxy-saida/proxy-saida.mjs

install -d -m 700 "$CONF_DIR" "$HOME/.donel"
( umask 077
  DONEL_PROXY_SENHA="$SENHA" "$NODE" -e '
    const [file, host, porta, usuario, queda, local] = process.argv.slice(1);
    const config = {
      modo: "vps",
      porta: Number(local),
      upstream: { host, porta: Number(porta), usuario, senha: process.env.DONEL_PROXY_SENHA },
      queda,
      log: "~/.donel/proxy-saida.log",
      estado: "~/.donel/proxy-saida.estado.json",
    };
    require("fs").writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  ' "$CONF_DIR/vps.json" "$UP_HOST" "$UP_PORTA" "$USUARIO" "$QUEDA" "$PORTA" )
unset SENHA

$SUDO tee /etc/systemd/system/donel-proxy-saida.service >/dev/null <<UNIT
# Donel: proxy de saída das sessões do Claude nesta VPS (scripts/proxy-saida/instalar-vps.sh).
# Manda Anthropic/Claude para o proxy do PC do dono e o resto direto; sem o PC, cai para o direto
# (ou para, com queda=parar) e grava o aviso em ~/.donel/proxy-saida.log.
[Unit]
Description=Donel: proxy de saida (relay para o PC, cai para o direto)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$ME
ExecStart=$NODE /opt/donel-proxy-saida/proxy-saida.mjs $CONF_DIR/vps.json
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT

# O motor de contas desta VPS (ADR 0009) renova token e lê carga pela mesma saída do CLI: uma conta, um IP.
# Inofensivo enquanto o donel-servico não estiver instalado; vale quando ele subir.
$SUDO install -d -m 755 /etc/systemd/system/donel-servico.service.d
$SUDO tee /etc/systemd/system/donel-servico.service.d/proxy-saida.conf >/dev/null <<DROPIN
# scripts/proxy-saida/instalar-vps.sh: o motor sai pelo mesmo proxy das sessões.
[Unit]
Wants=donel-proxy-saida.service
After=donel-proxy-saida.service

[Service]
Environment=HTTPS_PROXY=$PROXY_URL
Environment=NO_PROXY=$NO_PROXY_LIST
Environment=NODE_USE_ENV_PROXY=1
DROPIN

# Lido pelo claude.sh das sessões que o Donel abre daqui em diante (as vivas não mudam).
# Se o relay não estiver de pé na hora, a sessão nasce sem proxy em vez de nascer sem rede.
cat > "$HOME/.donel/proxy-saida.env" <<ENV
# Donel: proxy de saída (scripts/proxy-saida/instalar-vps.sh). Lido pelo claude.sh das sessões do Donel.
if (exec 3<>/dev/tcp/127.0.0.1/$PORTA) 2>/dev/null; then
  export HTTPS_PROXY=$PROXY_URL https_proxy=$PROXY_URL
  export NO_PROXY=$NO_PROXY_LIST no_proxy=$NO_PROXY_LIST
fi
ENV
chmod 600 "$HOME/.donel/proxy-saida.env"

# Ponte até o app do PC trazer o claude.sh que lê o arquivo acima: o servidor tmux do Donel, se estiver de pé,
# passa o proxy para as sessões que ele criar daqui em diante. As que já rodam não mudam.
if tmux -L donel ls >/dev/null 2>&1; then
  for v in HTTPS_PROXY https_proxy; do tmux -L donel setenv -g "$v" "$PROXY_URL"; done
  for v in NO_PROXY no_proxy; do tmux -L donel setenv -g "$v" "$NO_PROXY_LIST"; done
  echo "tmux do Donel: sessões novas saem pelo proxy (as vivas seguem como estão)"
fi

if [ "$SETTINGS" = 1 ]; then
  mkdir -p "$HOME/.claude"
  if [ -f "$HOME/.claude/settings.json" ] && [ ! -f "$HOME/.claude/settings.json.antes-proxy-saida" ]; then
    cp -p "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.antes-proxy-saida"
  fi
  "$NODE" -e '
    const fs = require("fs");
    const [file, proxy, noProxy] = process.argv.slice(1);
    const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    settings.env = { ...(settings.env ?? {}), HTTPS_PROXY: proxy, NO_PROXY: noProxy };
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  ' "$HOME/.claude/settings.json" "$PROXY_URL" "$NO_PROXY_LIST"
  echo "settings.json: env HTTPS_PROXY/NO_PROXY gravados (cópia em settings.json.antes-proxy-saida)"
fi

$SUDO systemctl daemon-reload
$SUDO systemctl enable donel-proxy-saida.service >/dev/null 2>&1
$SUDO systemctl restart donel-proxy-saida.service
if $SUDO systemctl is-active --quiet donel-servico.service 2>/dev/null; then
  echo "AVISO: donel-servico está rodando; ele só passa a usar o proxy depois de: systemctl restart donel-servico"
fi
sleep 2
$SUDO systemctl is-active donel-proxy-saida.service
echo "saída pelo relay: $(curl -s --max-time 15 -x "$PROXY_URL" https://api.ipify.org || echo falhou)"
rm -f "$HERE/proxy-saida.mjs" "$HERE/instalar-vps.sh" 2>/dev/null || true
