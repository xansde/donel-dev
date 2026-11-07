#!/bin/sh
# mcp-guard — the command the managed settings run (PreToolUse, matcher "mcp__.*").
# Root-owned, like everything in /etc/claude-code/mcp-guard. Runs node with a clean environment (no
# NODE_OPTIONS, PATH or MCP_GUARD_DIR from the Claude user), and turns any failure into a block:
# node missing, a crash, or an empty answer. (A hook timeout is decided by Claude Code, not here.)
DIR=/etc/claude-code/mcp-guard
NODE=@NODE@
DENY='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Bloqueado pela trava de MCP (mcp-guard): a trava não respondeu (node ausente, erro ou saída vazia); na dúvida, nada passa."}}'
out=$(/usr/bin/env -i PATH=/usr/bin:/bin "$NODE" "$DIR/mcp-guard.mjs" hook --system 2>/dev/null)
code=$?
if [ "$code" -ne 0 ] || [ -z "$out" ]; then
  printf '%s\n' "$DENY"
  exit 0
fi
printf '%s\n' "$out"
