#!/usr/bin/env bash
# Oráculo na VPS (docs/planos/oraculo-na-vps.md) — instala e controla o daemon `donel-oraculo` como unidade
# systemd do usuário. Rodar na VPS, de dentro de um checkout do repo com node_modules (o build usa o Vite dele).
#
#   scripts/oraculo-vps.sh instalar    builda, copia para ~/.donel/oraculo/bin e liga a unidade
#   scripts/oraculo-vps.sh atualizar   builda e reinicia (o registro não muda); o bundle anterior fica em
#                                      ~/.donel/oraculo/bin/oraculo.mjs.antes-<hora> (os 5 últimos)
#   scripts/oraculo-vps.sh voltar      põe de volta o bundle anterior mais novo e reinicia
#   scripts/oraculo-vps.sh parar       desliga e desabilita (o registro fica em ~/.donel/oraculo)
#   scripts/oraculo-vps.sh status      estado da unidade e as últimas linhas do log
#   scripts/oraculo-vps.sh servico N   cria (ou troca) a credencial do serviço sem tela N (t-a1ea2798): só o
#                                      sha256 fica no Oráculo; o token vai para ~/.donel/servicos/N.token (0600)
#   scripts/oraculo-vps.sh revogar N   apaga a credencial do serviço N (vale na hora, sem reiniciar)
#   scripts/oraculo-vps.sh portao N    cria (ou troca) a credencial do portão da máquina N (t-e195b35c: a Homologações
#                                      registra as tarefas das sessões dela aqui, scripts/portao-satelite.sh): só o
#                                      sha256 fica no Oráculo; o token vai para ~/.donel/portoes/N.token (0600)
#   scripts/oraculo-vps.sh revogar-portao N   apaga a credencial do portão N (vale na hora)
set -euo pipefail

DIR="${DONEL_ORACULO_DIR:-$HOME/.donel/oraculo}"
UNIT=donel-oraculo.service
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

build() {
  (cd "$REPO" && npm run build:oraculo >/dev/null)
  mkdir -p "$DIR/bin" && chmod 700 "$DIR"
  # t-e195b35c — o bundle que estava no ar fica ao lado, para a volta (`voltar`); só os 5 últimos.
  if [ -f "$DIR/bin/oraculo.mjs" ]; then
    cp -p "$DIR/bin/oraculo.mjs" "$DIR/bin/oraculo.mjs.antes-$(date +%Y%m%d-%H%M%S)"
    ls -1t "$DIR"/bin/oraculo.mjs.antes-* 2>/dev/null | tail -n +6 | xargs -r rm -f
  fi
  # A cópia é do daemon, não do checkout: mexer no repo depois não muda o que está no ar.
  install -m 0644 "$REPO/out/oraculo/oraculo.mjs" "$DIR/bin/oraculo.mjs"
  # F6 do ledger bom: o comando `livro` (ler e lançar no diário) para crons, workflows e bots.
  install -m 0755 "$REPO/scripts/livro.mjs" "$DIR/bin/livro.mjs"
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
  voltar)
    ANTES="$(ls -1t "$DIR"/bin/oraculo.mjs.antes-* 2>/dev/null | head -1)"
    [ -n "$ANTES" ] || { echo "sem bundle anterior em $DIR/bin" >&2; exit 1; }
    install -m 0644 "$ANTES" "$DIR/bin/oraculo.mjs"
    systemctl --user restart "$UNIT"
    echo "De volta a $(basename "$ANTES")."
    sleep 1
    systemctl --user --no-pager status "$UNIT" | head -5
    ;;
  portao|revogar-portao)
    NAME="${2:-}"
    if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
      echo "nome da máquina: minúsculas, números e hífen (ex.: homologacoes)" >&2
      exit 1
    fi
    if [ "$1" = revogar-portao ]; then
      rm -f "$DIR/portoes/$NAME.sha256" "$HOME/.donel/portoes/$NAME.token"
      echo "Revogada a credencial do portão $NAME."
      exit 0
    fi
    umask 077
    mkdir -p "$DIR/portoes" "$HOME/.donel/portoes"
    TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$TOKEN" >"$HOME/.donel/portoes/$NAME.token.tmp"
    mv "$HOME/.donel/portoes/$NAME.token.tmp" "$HOME/.donel/portoes/$NAME.token"
    printf '%s\n' "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >"$DIR/portoes/$NAME.sha256.tmp"
    mv "$DIR/portoes/$NAME.sha256.tmp" "$DIR/portoes/$NAME.sha256"
    echo "Credencial do portão $NAME em $HOME/.donel/portoes/$NAME.token"
    URL="$(tr -d '\n' <"$DIR/url" 2>/dev/null || true)"
    echo "Na máquina $NAME (root): scripts/portao-satelite.sh instalar --url ${URL:-<url do Oráculo>} < <arquivo com o token>"
    ;;
  parar)
    systemctl --user disable --now "$UNIT"
    echo "Parado. O registro segue em $DIR."
    ;;
  status)
    systemctl --user --no-pager status "$UNIT" | head -5 || true
    journalctl --user -u "$UNIT" -n 20 --no-pager || true
    ;;
  servico|revogar)
    NAME="${2:-}"
    if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
      echo "nome do serviço: minúsculas, números e hífen (ex.: slack-mencoes)" >&2
      exit 1
    fi
    if [ "$1" = revogar ]; then
      rm -f "$DIR/servicos/$NAME.sha256" "$HOME/.donel/servicos/$NAME.token"
      echo "Revogada a credencial de $NAME."
      exit 0
    fi
    umask 077
    mkdir -p "$DIR/servicos" "$HOME/.donel/servicos"
    TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$TOKEN" >"$HOME/.donel/servicos/$NAME.token.tmp"
    mv "$HOME/.donel/servicos/$NAME.token.tmp" "$HOME/.donel/servicos/$NAME.token"
    printf '%s\n' "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >"$DIR/servicos/$NAME.sha256.tmp"
    mv "$DIR/servicos/$NAME.sha256.tmp" "$DIR/servicos/$NAME.sha256"
    echo "Credencial de $NAME em $HOME/.donel/servicos/$NAME.token"
    URL="$(tr -d '\n' <"$DIR/url" 2>/dev/null || true)"
    echo "Uso: POST ${URL:-<url do Oráculo>}/v1/servico/apply com Authorization: Bearer <token> e {\"op\": {...}} (criar, assumir, entregar)."
    ;;
  *)
    sed -n '2,19p' "$0"
    exit 1
    ;;
esac
