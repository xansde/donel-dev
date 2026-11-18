#!/usr/bin/env bash
# Canal do Donel fora do PC (t-e195b35c, §1 Satélite, §7, Implantação) — the gate of the Donel sessions of a machine
# without the Oráculo (the Homologações): the same bundle as the personal VPS's daemon, in satellite mode
# (`DONEL_PORTAO_SATELITE`), as the SYSTEM unit `donel-portao` (root). Its sessions' tasks are recorded on the personal
# VPS's Oráculo with this machine's gate token (made there by `scripts/oraculo-vps.sh portao <name>`).
#
#   scripts/portao-satelite.sh instalar --url <API da VPS pessoal> [--bundle <oraculo.mjs>] [--token-arquivo <arq>]
#       (root) backup, bundle, token, unidade donel-portao, e o lado das sessões (abaixo). O token vem do arquivo ou
#       do stdin, nunca da linha de comando. Sem --bundle, builda do checkout onde este script está (com node_modules).
#   scripts/portao-satelite.sh atualizar [--bundle <oraculo.mjs>]   troca o bundle (guarda o anterior) e reinicia
#   scripts/portao-satelite.sh so-sessoes   só o lado das sessões (a VPS pessoal, cujo daemon já é o portão)
#   scripts/portao-satelite.sh voltar       desfaz: para a unidade, tira o portão, os hooks, a linha do PATH e o claude
#                                           embrulhado; as sessões voltam ao túnel ao reiniciar (renovar)
#   scripts/portao-satelite.sh status
#
# O lado das sessões: ~/.donel/bin/claude (scripts/vps/claude-wrapper.sh) à frente no PATH pela linha que entra em
# ~/.donel/proxy-saida.env (lido só pelo claude.sh das sessões do Donel), ~/.donel/bin/recados-hook.sh e os hooks de
# usuário Stop/UserPromptSubmit no ~/.claude/settings.json (acrescentados, nada apagado). Antes de mexer, cópia com hora
# de ~/.claude/settings.json e ~/.donel/proxy-saida.env em ~/.donel/portao-backup/<hora>/.
# Vale para as sessões abertas (ou renovadas) depois: as vivas seguem como estão até reiniciar.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DONEL_ORACULO_DIR:-$HOME/.donel/oraculo}"
BIN="$HOME/.donel/bin"
ENV_FILE="$HOME/.donel/proxy-saida.env"
SETTINGS="$HOME/.claude/settings.json"
BACKUPS="$HOME/.donel/portao-backup"
UNIT=donel-portao.service
UNIT_FILE="/etc/systemd/system/$UNIT"
PATH_MARK='# donel-portao: claude embrulhado (scripts/portao-satelite.sh)'
PATH_LINE='export PATH="$HOME/.donel/bin:$PATH"'
WRAPPER_MARK='Canal do Donel fora do PC'

die() {
  echo "portao-satelite: $*" >&2
  exit 1
}

need_root() {
  [ "$(id -u)" = 0 ] || die "rode como root (a unidade donel-portao é do sistema)."
}

stamp() { date +%Y%m%d-%H%M%S; }

# The user's hooks of the recados (add|remove), JSON edited in place: temp file, same mode, rename.
HOOKS_PY='
import json, os, sys, tempfile
path, mode = sys.argv[1], sys.argv[2]
mark = "recados-hook.sh"
want = {"Stop": "~/.donel/bin/recados-hook.sh fim-de-turno", "UserPromptSubmit": "~/.donel/bin/recados-hook.sh ocupada"}
try:
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    exists = True
except FileNotFoundError:
    doc, exists = {}, False
if not isinstance(doc, dict):
    sys.exit("settings.json não é um objeto JSON; nada mudou")
hooks = doc.setdefault("hooks", {})
if not isinstance(hooks, dict):
    sys.exit("\"hooks\" do settings.json não é um objeto; nada mudou")
def ours(hook):
    return isinstance(hook, dict) and mark in str(hook.get("command", ""))
changed = False
for event, command in want.items():
    groups = hooks.get(event, [])
    if not isinstance(groups, list):
        sys.exit("\"hooks.%s\" não é uma lista; nada mudou" % event)
    present = any(ours(h) for g in groups if isinstance(g, dict) for h in (g.get("hooks") or []))
    if mode == "add" and not present:
        hooks[event] = groups + [{"hooks": [{"type": "command", "command": command, "timeout": 3}]}]
        changed = True
    elif mode == "remove" and present:
        kept = []
        for g in groups:
            if isinstance(g, dict) and isinstance(g.get("hooks"), list):
                inner = [h for h in g["hooks"] if not ours(h)]
                if not inner:
                    continue
                g = dict(g, hooks=inner)
            kept.append(g)
        if kept:
            hooks[event] = kept
        else:
            hooks.pop(event, None)
        changed = True
if not changed:
    print("sem mudança")
    sys.exit(0)
folder = os.path.dirname(path)
os.makedirs(folder, exist_ok=True)
fmode = os.stat(path).st_mode & 0o777 if exists else 0o600
fd, tmp = tempfile.mkstemp(dir=folder, prefix=".settings-")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(tmp, fmode)
    os.replace(tmp, path)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
print("hooks: " + ("acrescentados" if mode == "add" else "retirados"))
'

# The sessions' MCP back from the gate to their tunnel (voltar): the port each one has in its own meta.json.
UNGATE_PY='
import json, os, re, sys, tempfile
root = sys.argv[1]
count = 0
for sid in (os.listdir(root) if os.path.isdir(root) else []):
    folder = os.path.join(root, sid)
    mcp = os.path.join(folder, "mcp.json")
    if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", sid) or not os.path.isfile(mcp):
        continue
    try:
        with open(os.path.join(folder, "meta.json"), encoding="utf-8") as f:
            port = json.load(f).get("mcpPort")
        with open(mcp, encoding="utf-8") as f:
            doc = json.load(f)
        server = doc["mcpServers"]["donel"]
    except Exception:
        continue
    if not isinstance(port, int) or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/s/[A-Za-z0-9-]+/mcp", str(server.get("url", ""))):
        continue
    server["url"] = "http://127.0.0.1:%d/mcp" % port
    old = os.umask(0o077)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".mcp-")
    os.umask(old)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    os.replace(tmp, mcp)
    count += 1
print("sessões de volta ao túnel: %d" % count)
'

backup() {
  local where
  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  where="$(mktemp -d "$BACKUPS/$(stamp)-XXXX")"
  for file in "$SETTINGS" "$ENV_FILE"; do
    if [ -f "$file" ]; then cp -p "$file" "$where/"; else : >"$where/$(basename "$file").ausente"; fi
  done
  echo "cópia de segurança em $where"
}

sessions_side() {
  command -v python3 >/dev/null 2>&1 || die "falta o python3."
  backup
  mkdir -p "$BIN"
  chmod 700 "$HOME/.donel"
  install -m 0755 "$REPO/scripts/vps/claude-wrapper.sh" "$BIN/claude"
  install -m 0755 "$REPO/scripts/vps/recados-hook.sh" "$BIN/recados-hook.sh"
  if [ ! -f "$ENV_FILE" ]; then
    (umask 077 && : >"$ENV_FILE")
  fi
  if ! grep -qxF "$PATH_MARK" "$ENV_FILE"; then
    printf '%s\n%s\n' "$PATH_MARK" "$PATH_LINE" >>"$ENV_FILE"
    echo "PATH das sessões: ~/.donel/bin à frente ($ENV_FILE)"
  fi
  python3 -I -c "$HOOKS_PY" "$SETTINGS" add
}

bundle_in() {
  local bundle="$1"
  if [ -z "$bundle" ]; then
    (cd "$REPO" && npm run build:oraculo >/dev/null) || die "o build do bundle falhou (há node_modules neste checkout?). Use --bundle <oraculo.mjs>."
    bundle="$REPO/out/oraculo/oraculo.mjs"
  fi
  [ -f "$bundle" ] || die "bundle não encontrado: $bundle"
  mkdir -p "$DIR/bin"
  chmod 700 "$DIR"
  if [ -f "$DIR/bin/oraculo.mjs" ]; then cp -p "$DIR/bin/oraculo.mjs" "$DIR/bin/oraculo.mjs.antes-$(stamp)"; fi
  install -m 0644 "$bundle" "$DIR/bin/oraculo.mjs"
}

token_in() {
  local from="$1" token=""
  if [ -n "$from" ]; then
    token="$(tr -d ' \r\n' <"$from")"
  elif [ ! -t 0 ]; then
    token="$(tr -d ' \r\n')"
  fi
  if [ -z "$token" ]; then
    [ -s "$DIR/portao.token" ] && return 0
    die "sem token do portão: passe --token-arquivo <arquivo> ou mande pelo stdin (scripts/oraculo-vps.sh portao <nome>, na VPS pessoal)."
  fi
  mkdir -p "$DIR"
  (umask 077 && printf '%s' "$token" >"$DIR/portao.token.tmp")
  mv "$DIR/portao.token.tmp" "$DIR/portao.token"
  chmod 600 "$DIR/portao.token"
}

write_unit() {
  local url="$1" node
  node="$(command -v node)" || die "falta o node nesta máquina."
  cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Donel Dev — portão das sessões (satélite do Oráculo)
After=network-online.target tailscaled.service

[Service]
Environment=HOME=$HOME
Environment=DONEL_ORACULO_DIR=$DIR
Environment=DONEL_PORTAO_SATELITE=$url
ExecStart=$node $DIR/bin/oraculo.mjs
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT_EOF
  systemctl daemon-reload
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
URL=""
BUNDLE=""
TOKEN_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --token-arquivo) TOKEN_FILE="${2:-}"; shift 2 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done

case "$cmd" in
  instalar)
    need_root
    [[ "$URL" =~ ^http://[A-Za-z0-9.:-]+(:[0-9]{1,5})?/?$ ]] || die "--url é a API da VPS pessoal (ex.: http://100.110.135.26:47816)."
    token_in "$TOKEN_FILE"
    bundle_in "$BUNDLE"
    write_unit "${URL%/}"
    sessions_side
    systemctl enable "$UNIT" >/dev/null 2>&1
    systemctl restart "$UNIT"
    sleep 1
    systemctl --no-pager status "$UNIT" | head -5 || true
    ;;
  atualizar)
    need_root
    [ -f "$UNIT_FILE" ] || die "o portão não está instalado aqui (use instalar)."
    bundle_in "$BUNDLE"
    install -m 0755 "$REPO/scripts/vps/claude-wrapper.sh" "$BIN/claude"
    install -m 0755 "$REPO/scripts/vps/recados-hook.sh" "$BIN/recados-hook.sh"
    systemctl restart "$UNIT"
    sleep 1
    systemctl --no-pager status "$UNIT" | head -5 || true
    echo "Volta do bundle: copie o oraculo.mjs.antes-<hora> mais novo de $DIR/bin sobre oraculo.mjs e reinicie $UNIT."
    ;;
  so-sessoes)
    sessions_side
    ;;
  voltar)
    if [ -f "$UNIT_FILE" ]; then
      need_root
      systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
      rm -f "$DIR/portao"
      python3 -I -c "$UNGATE_PY" "$HOME/.donel/s"
    fi
    backup
    if [ -f "$SETTINGS" ]; then python3 -I -c "$HOOKS_PY" "$SETTINGS" remove; fi
    if [ -f "$ENV_FILE" ] && grep -qxF "$PATH_MARK" "$ENV_FILE"; then
      grep -vxF -e "$PATH_MARK" -e "$PATH_LINE" "$ENV_FILE" >"$ENV_FILE.tmp" || true
      chmod 600 "$ENV_FILE.tmp"
      mv "$ENV_FILE.tmp" "$ENV_FILE"
      echo "PATH das sessões: linha do portão retirada"
    fi
    if [ -f "$BIN/claude" ] && grep -qF "$WRAPPER_MARK" "$BIN/claude"; then rm -f "$BIN/claude"; fi
    rm -f "$BIN/recados-hook.sh"
    echo "Pronto. As sessões vivas seguem como abriram; ao reiniciar (renovar) voltam ao túnel. Cópias em $BACKUPS."
    ;;
  status)
    if [ -f "$UNIT_FILE" ]; then
      systemctl --no-pager status "$UNIT" | head -5 || true
      journalctl -u "$UNIT" -n 20 --no-pager || true
    else
      echo "unidade $UNIT: não instalada"
    fi
    if [ -f "$BIN/claude" ] && grep -qF "$WRAPPER_MARK" "$BIN/claude"; then echo "claude embrulhado: sim"; else echo "claude embrulhado: não"; fi
    if [ -f "$ENV_FILE" ] && grep -qxF "$PATH_MARK" "$ENV_FILE"; then echo "PATH das sessões: com ~/.donel/bin"; else echo "PATH das sessões: sem ~/.donel/bin"; fi
    if [ -f "$SETTINGS" ] && grep -q 'recados-hook.sh' "$SETTINGS"; then echo "hooks dos recados: sim"; else echo "hooks dos recados: não"; fi
    if [ -r "$DIR/portao" ]; then echo "portão: 127.0.0.1:$(tr -dc 0-9 <"$DIR/portao")"; else echo "portão: sem arquivo $DIR/portao"; fi
    ;;
  *)
    sed -n '2,21p' "$0"
    exit 1
    ;;
esac
