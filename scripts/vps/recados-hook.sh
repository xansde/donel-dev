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
# Outside a Donel session (tmux session "donel-<sid>"), with the gate down or answering an error, it prints nothing and
# exits 0: the CLI goes on as if there were no hook. Port: DONEL_PORTAO_PORT (default 47817, the gate's).

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

saida="$(curl -s -f --max-time 2 --data-binary @- \
  -H 'Content-Type: application/json' \
  -H "X-Donel-Tmux: $nome" \
  "http://127.0.0.1:${DONEL_PORTAO_PORT:-47817}/recados/$evento" 2>/dev/null)" || exit 0

# Only a JSON object reaches the CLI (an empty or odd answer = no hook output).
case "$saida" in
  \{*) printf '%s\n' "$saida" ;;
esac
exit 0
