#!/bin/sh
# Recebe pelo stdin as amostras (JSON, uma por linha) que outra máquina manda por ssh (o PC) e as deixa para o coletor
# da VPS gravar no Supabase. uso: saude_receber.sh <maquina>   (só [a-z-]; o nome do arquivo diz quem mandou)
set -eu
case "$1" in ''|*[!a-z-]*) echo "maquina invalida" >&2; exit 2;; esac
d="$HOME/.donel/saude/entrada"
mkdir -p "$d"
f="$d/$1-$(date +%s%N)-$$.json"
head -c 8000000 > "$f.tmp"
mv "$f.tmp" "$f"
echo "ok $(wc -l < "$f")"
