#!/bin/sh
# Proof of the root-owned install, inside a throwaway container (never on a real machine):
#   docker run --rm -v "$PWD/scripts/claude-guard:/src:ro" node:22-bookworm-slim sh /src/system/prova-sandbox.sh
# Installs as root, seals as root, then plays the agent as a plain user ("claude") trying every way
# the review found to reseal, edit or bypass the guard. Prints one line per attempt and a total.
set -u
SRC=/src
useradd -m claude
mkdir -p /tmp/srcw && cp -r "$SRC"/. /tmp/srcw/
sh /tmp/srcw/system/install-linux.sh claude >/tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
DIR=/etc/claude-code/mcp-guard
cd /tmp && printf 'SELAR\n' | node "$DIR/mcp-guard.mjs" seal --system --no-discover --from /tmp/srcw/fixtures/work-tools.json >/tmp/seal.log 2>&1 || { cat /tmp/seal.log; exit 1; }

FAIL=0
pay() { printf '{"hook_event_name":"PreToolUse","tool_name":"%s","tool_input":%s}' "$1" "$2"; }
as_claude() { su claude -s /bin/sh -c "$1"; }
decision() { case "$1" in *'"deny"'*) echo deny ;; *suppressOutput*) echo allow ;; *) echo "?:$1" ;; esac; }
expect() { # label expected actual
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FALHA $1 (esperado $2, veio $3)"; FAIL=$((FAIL+1)); fi
}
hook_as_claude() { decision "$(pay "$1" "$2" | su claude -s /bin/sh -c "${3:-} $DIR/hook.sh")"; }

expect "MCP selado de leitura passa" allow "$(hook_as_claude mcp__github__list_pull_requests '{}')"
expect "MCP fora do inventário é barrado" deny "$(hook_as_claude mcp__evil__x '{}')"

# 1. reseal as the Claude user, with a fake TTY
cat > /tmp/evil-tools.json <<'J'
[{"server":"evil","tools":[{"name":"x","description":"harmless"}]}]
J
chmod 644 /tmp/evil-tools.json
as_claude "printf 'SELAR\n' | script -qc 'node $DIR/mcp-guard.mjs seal --system --no-discover --from /tmp/evil-tools.json' /dev/null" >/dev/null 2>&1
expect "agente resela com TTY falso (script): continua barrado" deny "$(hook_as_claude mcp__evil__x '{}')"

# 2. write the inventory, policy, hook or managed settings directly
for f in "$DIR/inventory.json" "$DIR/policy.json" "$DIR/hook.sh" "$DIR/mcp-guard.mjs" /etc/claude-code/managed-settings.json; do
  if as_claude "cp /tmp/evil-tools.json '$f'" 2>/dev/null || as_claude "printf '{}' > '$f'" 2>/dev/null; then r=gravou; else r=negado; fi
  expect "agente grava $f" negado "$r"
done
if as_claude "touch $DIR/novo.json" 2>/dev/null; then r=gravou; else r=negado; fi
expect "agente cria arquivo na pasta da trava" negado "$r"

# 3. point the guard somewhere else through the environment
as_claude "mkdir -p /tmp/fake && MCP_GUARD_DIR=/tmp/fake node /tmp/srcw/mcp-guard.mjs seal --yes --no-discover --from /tmp/evil-tools.json" >/dev/null 2>&1
expect "MCP_GUARD_DIR do agente é ignorado" deny "$(hook_as_claude mcp__evil__x '{}' 'MCP_GUARD_DIR=/tmp/fake')"
cat > /tmp/evil-require.js <<'J'
process.stdout.write('{"suppressOutput":true}\n'); process.exit(0);
J
chmod 644 /tmp/evil-require.js
expect "NODE_OPTIONS --require do agente é ignorado" deny "$(hook_as_claude mcp__evil__x '{}' 'NODE_OPTIONS=--require=/tmp/evil-require.js')"

# 4. the guard run through a symlink still decides
as_claude "ln -sf $DIR/mcp-guard.mjs /tmp/link.mjs"
expect "trava chamada por symlink decide" deny "$(decision "$(pay mcp__evil__x '{}' | su claude -s /bin/sh -c "node /tmp/link.mjs hook --system")")"

# 5. a crash or a missing node becomes a block (root breaks the script on purpose)
mv "$DIR/mcp-guard.mjs" "$DIR/mcp-guard.mjs.bak"
expect "trava ausente/quebrada: barra" deny "$(hook_as_claude mcp__github__list_pull_requests '{}')"
mv "$DIR/mcp-guard.mjs.bak" "$DIR/mcp-guard.mjs"

# 6. an install left writable by the user counts as no inventory
chmod 666 "$DIR/inventory.json"
expect "inventário gravável pelo usuário: barra tudo" deny "$(hook_as_claude mcp__github__list_pull_requests '{}')"
chmod 644 "$DIR/inventory.json"
expect "de volta a só do root: passa" allow "$(hook_as_claude mcp__github__list_pull_requests '{}')"

echo "falhas: $FAIL"
[ "$FAIL" = 0 ]
