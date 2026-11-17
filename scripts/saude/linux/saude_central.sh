#!/bin/sh
# Central da saúde (t-16393812), só na VPS pessoal: JSON da página, compactação e alertas ao Líder do quadro.
mkdir -p "$HOME/.donel/saude"
exec /usr/bin/nice -n 19 /usr/bin/flock -n "$HOME/.donel/saude/central.lock" /usr/bin/python3 -I "$(dirname "$0")/saude_central.py" "$@"
