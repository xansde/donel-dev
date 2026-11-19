#!/usr/bin/env bash
# Canal do Donel fora do PC (t-e195b35c, §2) — the user-level hook of the VPS sessions that delivers the recados of the
# gate (src/oraculo/recados.ts) without the PC: at the end of a turn the gate answers {"decision":"block","reason":…}
# with what waits for this session, and a new prompt tells it the session is busy (and confirms a typed recado).
#
# Usage: recados-hook.sh fim-de-turno|ocupada   (the hook's JSON comes on stdin)
#
# It goes in the user's ~/.claude/settings.json of the VPS (it runs next to the session's own --settings), with a short
# timeout so a stuck gate never holds a session:
#
#   "hooks": {
#     "Stop":             [{ "hooks": [{ "type": "command", "command": "~/.donel/bin/recados-hook.sh fim-de-turno", "timeout": 3 }] }],
#     "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "~/.donel/bin/recados-hook.sh ocupada", "timeout": 3 }] }]
#   }
#
# Outside a Donel session (tmux session "donel-<sid>"), from a CLI run inside one (a `claude -p` of its Bash), with the
# gate down or answering an error, it prints nothing and exits 0: the CLI goes on as if there were no hook. Port: DONEL_PORTAO_PORT (default 47817, the gate's).

evento="${1:-}"
case "$evento" in
  fim-de-turno | ocupada) ;;
  *) cat >/dev/null 2>&1; exit 0 ;;
esac

nome=""
if [ -n "${TMUX:-}" ]; then
  nome="$(tmux display-message -p '#S' 2>/dev/null || true)"
fi
case "$nome" in
  donel-*) ;;
  *) cat >/dev/null 2>&1; exit 0 ;;
esac

# Only the CLI of the pane itself. A `claude -p` the session runs from its Bash inherits TMUX and TMUX_PANE, so its
# hooks would name the same tmux session and take (and run) the recados that wait for it, or mark it stopped while it
# works. From this hook up to the pane's process there must be ONE Claude CLI: two = a CLI inside the session's CLI.
e_cli() {
  local comm args
  comm="$(ps -o comm= -p "$1" 2>/dev/null)" || return 1
  [ "${comm##*/}" = "claude" ] && return 0
  args="$(ps -o args= -p "$1" 2>/dev/null)" || return 1
  local -a argv
  read -r -a argv <<<"$args"
  [ "${argv[0]##*/}" = "claude" ] || [ "${argv[1]##*/}" = "claude" ] || case "${argv[1]:-}" in */claude-code/cli.js | */claude-code/cli.mjs) true ;; *) false ;; esac
}
painel="$(tmux display-message -p '#{pane_pid}' 2>/dev/null || true)"
case "$painel" in
  '' | *[!0-9]*) cat >/dev/null 2>&1; exit 0 ;;
esac
clis=0
pid="$PPID"
for _ in $(seq 1 40); do
  case "$pid" in '' | *[!0-9]* | 0 | 1) cat >/dev/null 2>&1; exit 0 ;; esac
  if e_cli "$pid"; then clis=$((clis + 1)); fi
  [ "$pid" = "$painel" ] && break
  pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
done
if [ "$pid" != "$painel" ] || [ "$clis" -gt 1 ]; then
  cat >/dev/null 2>&1
  exit 0
fi

saida="$(curl -s -f --max-time 2 --data-binary @- \
  -H 'Content-Type: application/json' \
  -H "X-Donel-Tmux: $nome" \
  "http://127.0.0.1:${DONEL_PORTAO_PORT:-47817}/recados/$evento" 2>/dev/null)" || exit 0

# Only a JSON object reaches the CLI (an empty or odd answer = no hook output).
case "$saida" in
  \{*) printf '%s\n' "$saida" ;;
esac
exit 0
