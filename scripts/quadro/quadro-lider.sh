#!/bin/sh
# Quadro de tarefas (t-1e354d15) — rotina "quadro-lider" do crontab da VPS: board-cron.mjs lider, sem empilhar (flock).
# Instalada em ~/.donel/board/bin/ junto do bundle (docs/design/quadro-de-tarefas.md, §5-§6).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec /usr/bin/flock -n /tmp/cron-quadro-lider.lock /usr/bin/nice -n 10 node "$DIR/board-cron.mjs" lider
