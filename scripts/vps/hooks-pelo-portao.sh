#!/usr/bin/env bash
# t-d461e003 — points the app's hooks of the sessions ALREADY on this machine to the gate, with the same sed the setup
# runs for a new or resumed session (`HOOKS_TO_GATE_SED`, src/main/remote-session.ts): `http://127.0.0.1:<hookPort>/h/`
# becomes `http://127.0.0.1:<gate>/s/<sid>/h/` in each `~/.donel/s/<sid>/settings.json`. The recados hook and every
# other hook stay as they are. Running it twice changes nothing.
#
# Usage: hooks-pelo-portao.sh --sessoes-vivas
#
# It restarts nobody and touches no tmux. The CLI reads its `--settings` at start only (measured on 2.1.319: a hook
# edited in the file mid-session kept running the old one), so a live CLI keeps calling the old URL until it starts
# again; this only makes sure the file it reads then is the right one.

set -u
if [ "${1:-}" != "--sessoes-vivas" ]; then
  echo "uso: $0 --sessoes-vivas" >&2
  exit 2
fi
if [ ! -r "$HOME/.donel/oraculo/portao" ]; then
  echo "sem portão nesta máquina ($HOME/.donel/oraculo/portao): nada a fazer" >&2
  exit 1
fi
P="$(tr -dc 0-9 < "$HOME/.donel/oraculo/portao")"
if [ -z "$P" ]; then
  echo "o arquivo do portão não diz a porta" >&2
  exit 1
fi

n=0
for S in "$HOME"/.donel/s/*/; do
  S="${S%/}"
  SID="${S##*/}"
  case "$SID" in *[!A-Za-z0-9-]* | "") continue ;; esac
  [ "${#SID}" -le 64 ] || continue
  [ -f "$S/settings.json" ] || continue
  grep -q 'http://127.0.0.1:[0-9]*/h/' "$S/settings.json" || continue
  sed -i "s#http://127.0.0.1:[0-9]*/h/#http://127.0.0.1:$P/s/$SID/h/#g" "$S/settings.json" && n=$((n + 1))
done
echo "$n sessões com os hooks no portão 127.0.0.1:$P (valem quando o CLI de cada uma recomeçar)"
