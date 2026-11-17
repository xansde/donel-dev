#!/bin/sh
# Coletor de saúde de 1 min (t-16393812): nice 19 + flock + python3 -I. Argumentos vão direto ao saude_coletor.py.
mkdir -p "$HOME/.donel/saude"
exec /usr/bin/nice -n 19 /usr/bin/flock -n "$HOME/.donel/saude/lock" /usr/bin/python3 -I "$(dirname "$0")/saude_coletor.py" "$@"
