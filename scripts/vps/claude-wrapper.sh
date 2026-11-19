#!/usr/bin/env bash
# Canal do Donel fora do PC (t-e195b35c, §7) — the `claude` the VPS sessions of the Donel run, ahead of the real one in
# their PATH (~/.donel/bin/claude, put there by the `export PATH` line scripts/portao-satelite.sh adds to
# ~/.donel/proxy-saida.env, which only the sessions' claude.sh reads).
#
# The app on the PC writes each session's `--settings` and `--mcp-config` in ~/.donel/s/<sid>/; until the owner installs
# a new app they carry the old deadlines (10 s per hook, a day on the permission one) and an MCP on the tunnel to the PC.
# For a session of that folder this wrapper writes copies next to them and runs the real CLI with the copies:
#
#   settings.vps.json   every `http` hook of 10 s → 2 s, the permission one of 86400 s → 30 s (the rest as it was)
#   mcp.vps.json        with a gate on this machine (~/.donel/oraculo/portao), the "donel" server on the tunnel
#                       (http://127.0.0.1:<port>/mcp) → the gate (http://127.0.0.1:<gate>/s/<sid>/mcp), same headers
#
# Written with umask 077 (they hold the session's tokens), temp file then rename. Any error: the real CLI with the
# arguments as they came. Any other use of `claude` (no such argument, another folder) goes straight to the real one.

self="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")"

# The real CLI: the next `claude` in the PATH that is not this script, else the usual places.
REAL=""
IFS=: read -r -a path_dirs <<<"${PATH:-}"
for dir in "${path_dirs[@]}" /usr/bin "$HOME/.local/bin" /usr/local/bin; do
  [ -n "$dir" ] || continue
  candidate="$dir/claude"
  [ -f "$candidate" ] && [ -x "$candidate" ] || continue
  resolved="$(readlink -f "$candidate" 2>/dev/null || printf '%s' "$candidate")"
  [ "$resolved" = "$self" ] && continue
  REAL="$candidate"
  break
done
if [ -z "$REAL" ]; then
  echo "claude: não achei o claude de verdade no PATH (este é o embrulho do Donel em $self)." >&2
  exit 127
fi

sessions="$HOME/.donel/s"

# The sid of a path "~/.donel/s/<sid>/<file>", or failure.
sid_of() {
  local path="$1" file="$2" rest
  case "$path" in
    "$sessions"/*/"$file") ;;
    *) return 1 ;;
  esac
  rest="${path#"$sessions"/}"
  rest="${rest%/"$file"}"
  [[ "$rest" =~ ^[A-Za-z0-9-]{1,64}$ ]] || return 1
  printf '%s' "$rest"
}

# The copy of one file. Exit 0 = written to $3, 3 = nothing to change (keep the original), other = error.
REWRITE_PY='
import json, os, re, sys, tempfile
kind, src, dst, sid, home = sys.argv[1:6]
with open(src, encoding="utf-8") as f:
    doc = json.load(f)
if not isinstance(doc, dict):
    sys.exit(1)
if kind == "settings":
    hooks = doc.get("hooks")
    for groups in (hooks.values() if isinstance(hooks, dict) else []):
        for group in (groups if isinstance(groups, list) else []):
            inner = group.get("hooks") if isinstance(group, dict) else None
            for hook in (inner if isinstance(inner, list) else []):
                if isinstance(hook, dict) and hook.get("type") == "http":
                    if hook.get("timeout") == 86400:
                        hook["timeout"] = 30
                    elif hook.get("timeout") == 10:
                        hook["timeout"] = 2
else:
    try:
        with open(os.path.join(home, ".donel", "oraculo", "portao"), encoding="utf-8") as f:
            gate = f.read().strip()
    except OSError:
        sys.exit(3)
    if not re.fullmatch(r"[0-9]{1,5}", gate):
        sys.exit(3)
    servers = doc.get("mcpServers")
    server = servers.get("donel") if isinstance(servers, dict) else None
    url = server.get("url") if isinstance(server, dict) else None
    if not isinstance(url, str) or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}/mcp", url):
        sys.exit(3)
    server["url"] = "http://127.0.0.1:%s/s/%s/mcp" % (gate, sid)
os.umask(0o077)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix=".vps-")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    os.replace(tmp, dst)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
'

# Writes the copy of `$2` (kind `$1`) and prints the path to use: the copy, or the original when nothing changes.
copy_of() {
  local kind="$1" path="$2" sid="$3" target code
  target="$(dirname "$path")/$kind.vps.json"
  python3 -I -c "$REWRITE_PY" "$kind" "$path" "$target" "$sid" "$HOME" >/dev/null 2>&1
  code=$?
  case "$code" in
    0) printf '%s' "$target" ;;
    3) printf '%s' "$path" ;;
    *) return 1 ;;
  esac
}

case " $* " in
  *" --settings "* | *" --mcp-config "*) ;;
  *) exec "$REAL" "$@" ;;
esac
command -v python3 >/dev/null 2>&1 || exec "$REAL" "$@"

args=()
prev=""
in_mcp=0
for arg in "$@"; do
  out="$arg"
  if [ "$prev" = "--settings" ] && sid="$(sid_of "$arg" settings.json)"; then
    out="$(copy_of settings "$arg" "$sid")" || exec "$REAL" "$@"
  fi
  case "$arg" in
    --mcp-config) in_mcp=1 ;;
    -*) in_mcp=0 ;;
    *)
      # `--mcp-config` takes one or more files, up to the next option.
      if [ "$in_mcp" = 1 ] && sid="$(sid_of "$arg" mcp.json)"; then
        out="$(copy_of mcp "$arg" "$sid")" || exec "$REAL" "$@"
      fi
      ;;
  esac
  args+=("$out")
  prev="$arg"
done

exec "$REAL" "${args[@]}"
