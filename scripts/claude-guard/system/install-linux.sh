#!/bin/sh
# mcp-guard — one-time install on a Linux machine, run by the OWNER as root:
#   sudo sh scripts/claude-guard/system/install-linux.sh <user who runs Claude>
# Installs the guard root-owned in /etc/claude-code/mcp-guard, registers the hook in the managed settings
# (merged, never overwritten) and the periodic check as a root systemd timer. It does NOT seal: sealing
# is the next step, interactive (`seal --system --user <user>`, typing SELAR).
set -eu
USER_NAME=${1:?uso: sudo sh install-linux.sh <usuário que roda o Claude>}
[ "$(id -u)" = 0 ] || { echo "rode como root (sudo)" >&2; exit 1; }
id "$USER_NAME" >/dev/null 2>&1 || { echo "usuário $USER_NAME não existe" >&2; exit 1; }
SRC=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node) || { echo "node não encontrado" >&2; exit 1; }
NODE=$(readlink -f "$NODE")
[ "$(stat -c %u "$NODE")" = 0 ] || { echo "$NODE não é do root; instale um node do sistema" >&2; exit 1; }
BASE=/etc/claude-code
DIR=$BASE/mcp-guard

install -d -o root -g root -m 0755 "$BASE" "$DIR"
install -o root -g root -m 0644 "$SRC/mcp-guard.mjs" "$DIR/mcp-guard.mjs"
sed "s#@NODE@#$NODE#" "$SRC/system/hook.sh" > "$DIR/hook.sh.tmp"
install -o root -g root -m 0755 "$DIR/hook.sh.tmp" "$DIR/hook.sh"
rm -f "$DIR/hook.sh.tmp"

# Managed settings: add the hook entry if missing, keep everything else.
"$NODE" - "$BASE/managed-settings.json" "$SRC/system/managed-settings.example.json" <<'JS'
const fs = require('fs');
const [file, example] = process.argv.slice(2);
const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const entry = JSON.parse(fs.readFileSync(example, 'utf8')).hooks.PreToolUse[0];
cur.hooks ||= {};
cur.hooks.PreToolUse ||= [];
const already = cur.hooks.PreToolUse.some((e) => (e.hooks || []).some((h) => h.command === entry.hooks[0].command));
if (!already) cur.hooks.PreToolUse.push(entry);
fs.writeFileSync(file + '.tmp', JSON.stringify(cur, null, 2) + '\n');
fs.renameSync(file + '.tmp', file);
console.log(already ? 'managed-settings: hook já estava' : 'managed-settings: hook adicionado');
JS
chown root:root "$BASE/managed-settings.json"
chmod 0644 "$BASE/managed-settings.json"

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  sed "s#@NODE@#$NODE#" "$SRC/system/mcp-guard-check@.service" > /etc/systemd/system/mcp-guard-check@.service
  install -o root -g root -m 0644 "$SRC/system/mcp-guard-check@.timer" /etc/systemd/system/mcp-guard-check@.timer
  systemctl daemon-reload
  systemctl enable --now "mcp-guard-check@$USER_NAME.timer"
else
  echo "AVISO: sem systemd; a reconferência das descrições não foi agendada" >&2
fi

# Root ownership only holds if the Claude user cannot become root.
WARN=0
if sudo -l -U "$USER_NAME" 2>/dev/null | grep -q NOPASSWD; then echo "AVISO: $USER_NAME tem sudo sem senha; o agente consegue reselar e desligar a trava." >&2; WARN=1; fi
for g in $(id -nG "$USER_NAME"); do
  case "$g" in docker|lxd|libvirt|disk) echo "AVISO: $USER_NAME está no grupo $g, que equivale a root." >&2; WARN=1 ;; esac
done
echo "Instalado em $DIR. Próximo passo, como root: $NODE $DIR/mcp-guard.mjs seal --system --user $USER_NAME"
[ "$WARN" = 0 ] || echo "A trava só fica de pé depois de resolver os AVISOS acima." >&2
