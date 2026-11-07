#!/usr/bin/env bash
# Oráculo na VPS (docs/planos/oraculo-na-vps.md) — instala e controla o daemon `donel-oraculo` como unidade
# systemd do usuário. Rodar na VPS, de dentro de um checkout do repo com node_modules (o build usa o Vite dele).
#
#   scripts/oraculo-vps.sh instalar    builda, copia para ~/.donel/oraculo/bin e liga a unidade
#   scripts/oraculo-vps.sh atualizar   builda e reinicia (o registro não muda)
#   scripts/oraculo-vps.sh parar       desliga e desabilita (o registro fica em ~/.donel/oraculo)
#   scripts/oraculo-vps.sh status      estado da unidade e as últimas linhas do log
set -euo pipefail

DIR="${DONEL_ORACULO_DIR:-$HOME/.donel/oraculo}"
UNIT=donel-oraculo.service
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

build() {
  (cd "$REPO" && npm run build:oraculo >/dev/null)
  mkdir -p "$DIR/bin" && chmod 700 "$DIR"
  # A cópia é do daemon, não do checkout: mexer no repo depois não muda o que está no ar.
  install -m 0644 "$REPO/out/oraculo/oraculo.mjs" "$DIR/bin/oraculo.mjs"
}

write_unit() {
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Donel Dev — Oráculo Harrow (registro de tarefas)
After=network-online.target tailscaled.service

[Service]
Environment=DONEL_ORACULO_DIR=$DIR
ExecStart=$(command -v node) $DIR/bin/oraculo.mjs
Restart=always
RestartSec=15
UMask=0077

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload
}

case "${1:-}" in
  instalar)
    build
    write_unit
    systemctl --user enable --now "$UNIT"
    sleep 1
    systemctl --user --no-pager status "$UNIT" | head -5
    ;;
  atualizar)
    build
    write_unit
    systemctl --user restart "$UNIT"
    sleep 1
    systemctl --user --no-pager status "$UNIT" | head -5
    ;;
  parar)
    systemctl --user disable --now "$UNIT"
    echo "Parado. O registro segue em $DIR."
    ;;
  status)
    systemctl --user --no-pager status "$UNIT" | head -5 || true
    journalctl --user -u "$UNIT" -n 20 --no-pager || true
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
