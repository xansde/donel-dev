#!/usr/bin/env bash
# Desfaz o instalar-vps.sh nesta VPS. A VPS volta a sair direto, como antes. Sessões vivas que nasceram
# com o proxy perdem a rede até serem reabertas (o relay sai do ar); rode sem sessão ativa ou reabra-as.
# O log (~/.donel/proxy-saida.log) fica, como histórico.
set -euo pipefail
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo -n"

$SUDO systemctl disable --now donel-proxy-saida.service 2>/dev/null || true
$SUDO rm -f /etc/systemd/system/donel-proxy-saida.service
$SUDO rm -f /etc/systemd/system/donel-servico.service.d/proxy-saida.conf
$SUDO rmdir /etc/systemd/system/donel-servico.service.d 2>/dev/null || true
$SUDO systemctl daemon-reload
$SUDO rm -rf /opt/donel-proxy-saida
rm -f "$HOME/.donel/proxy-saida.env" "$HOME/.donel/proxy-saida.estado.json"
rm -rf "$HOME/.config/donel-proxy-saida"
if tmux -L donel ls >/dev/null 2>&1; then
  for v in HTTPS_PROXY https_proxy NO_PROXY no_proxy; do tmux -L donel setenv -gu "$v"; done
fi

# Tira do settings.json só o que o instalador pôs (o proxy local), nada mais.
if [ -f "$HOME/.claude/settings.json" ]; then
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    if (settings.env && /^http:\/\/127\.0\.0\.1:\d+$/.test(settings.env.HTTPS_PROXY ?? "")) {
      delete settings.env.HTTPS_PROXY;
      if (settings.env.NO_PROXY === "localhost,127.0.0.1,::1") delete settings.env.NO_PROXY;
      if (Object.keys(settings.env).length === 0) delete settings.env;
      fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
      console.log("settings.json: proxy removido do env");
    }
  ' "$HOME/.claude/settings.json"
fi
if $SUDO systemctl is-active --quiet donel-servico.service 2>/dev/null; then
  echo "AVISO: reinicie o donel-servico para ele voltar a sair direto: systemctl restart donel-servico"
fi
echo "proxy de saída removido desta VPS"
