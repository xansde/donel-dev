#!/usr/bin/env bash
# Oráculo na VPS (docs/planos/oraculo-na-vps.md) — instala e controla o daemon `donel-oraculo` como unidade
# systemd do usuário. Rodar na VPS, de dentro de um checkout do repo com node_modules (o build usa o Vite dele).
#
#   scripts/oraculo-vps.sh instalar    builda, copia para ~/.donel/oraculo/bin e liga a unidade
#   scripts/oraculo-vps.sh atualizar   builda e reinicia (o registro não muda); o bundle anterior fica em
#                                      ~/.donel/oraculo/bin/oraculo.mjs.antes-<hora> (os 5 últimos)
#   scripts/oraculo-vps.sh voltar      põe de volta o bundle anterior mais novo e reinicia
#   scripts/oraculo-vps.sh parar       desliga e desabilita (o registro fica em ~/.donel/oraculo)
#   scripts/oraculo-vps.sh status      estado da unidade e as últimas linhas do log
#   scripts/oraculo-vps.sh servico N   cria (ou troca) a credencial do serviço sem tela N (t-a1ea2798): só o
#                                      sha256 fica no Oráculo; o token vai para ~/.donel/servicos/N.token (0600)
#   scripts/oraculo-vps.sh revogar N   apaga a credencial do serviço N (vale na hora, sem reiniciar)
#   scripts/oraculo-vps.sh portao N    cria (ou troca) a credencial do portão da máquina N (t-e195b35c: a Homologações
#                                      registra as tarefas das sessões dela aqui, scripts/portao-satelite.sh): só o
#                                      sha256 fica no Oráculo; o token vai para ~/.donel/portoes/N.token (0600)
#   scripts/oraculo-vps.sh revogar-portao N   apaga a credencial do portão N (vale na hora)
#   scripts/oraculo-vps.sh separar     passo 9 (t-5358d400): o entregador (portão 47817, recados, chat do celular na
#                                      47815) sai para a unidade donel-entregador; o donel-oraculo fica com o registro
#                                      (47816 e o servidor do celular na 47818). Roteiro: docs/planos/oraculo-entregador.md
#   scripts/oraculo-vps.sh juntar      a volta: desliga o donel-entregador e o donel-oraculo sobe tudo, como antes
#   (com a marca entregador.separado, `atualizar` e `parar` cuidam das duas unidades e `voltar` recusa: rode `juntar`)
set -euo pipefail

DIR="${DONEL_ORACULO_DIR:-$HOME/.donel/oraculo}"
UNIT=donel-oraculo.service
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Passo 9 — a segunda unidade e a marca que liga a separação (src/oraculo/modo.ts). Sem a marca, tudo como antes.
ENTREGADOR=donel-entregador.service
ENTREGADOR_FILE="$HOME/.config/systemd/user/$ENTREGADOR"
MARK="$DIR/entregador.separado"
# O portão desta máquina no registro (`/v1/portao/*`): o entregador lê o token em $DIR/portao.token e o registro só
# aceita o Líder único pelo portão com a marca $DIR/portoes/<nome>.local (src/oraculo/portoes.ts).
LOCAL_GATE=vps-pessoal
# Para o ensaio sem tocar no systemd de verdade: DONEL_SYSTEMCTL / DONEL_JOURNALCTL apontam para um falso.
SYSTEMCTL="${DONEL_SYSTEMCTL:-systemctl}"
JOURNALCTL="${DONEL_JOURNALCTL:-journalctl}"

build() {
  (cd "$REPO" && npm run build:oraculo >/dev/null)
  mkdir -p "$DIR/bin" && chmod 700 "$DIR"
  # t-e195b35c — o bundle que estava no ar fica ao lado, para a volta (`voltar`); só os 5 últimos.
  if [ -f "$DIR/bin/oraculo.mjs" ]; then
    cp -p "$DIR/bin/oraculo.mjs" "$DIR/bin/oraculo.mjs.antes-$(date +%Y%m%d-%H%M%S)"
    ls -1t "$DIR"/bin/oraculo.mjs.antes-* 2>/dev/null | tail -n +6 | xargs -r rm -f
  fi
  # A cópia é do daemon, não do checkout: mexer no repo depois não muda o que está no ar.
  install -m 0644 "$REPO/out/oraculo/oraculo.mjs" "$DIR/bin/oraculo.mjs"
  # F6 do ledger bom: o comando `livro` (ler e lançar no diário) para crons, workflows e bots.
  install -m 0755 "$REPO/scripts/livro.mjs" "$DIR/bin/livro.mjs"
}

write_unit() {
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Donel Dev — Oráculo Harrow (registro de tarefas)
After=network-online.target tailscaled.service

[Service]
Environment=DONEL_ORACULO_DIR=$DIR
ExecStart=$(command -v node) $DIR/bin/oraculo.mjs
Restart=always
RestartSec=15
UMask=0077

[Install]
WantedBy=default.target
UNIT_EOF
  $SYSTEMCTL --user daemon-reload
}

# Cria (ou troca) a credencial do portão $1: o token em ~/.donel/portoes/$1.token (0600), só o sha256 no Oráculo.
new_gate() {
  (
    umask 077
    mkdir -p "$DIR/portoes" "$HOME/.donel/portoes"
    TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$TOKEN" >"$HOME/.donel/portoes/$1.token.tmp"
    mv "$HOME/.donel/portoes/$1.token.tmp" "$HOME/.donel/portoes/$1.token"
    printf '%s\n' "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >"$DIR/portoes/$1.sha256.tmp"
    mv "$DIR/portoes/$1.sha256.tmp" "$DIR/portoes/$1.sha256"
  )
}

# A credencial do portão local já existe e o token confere com o sha256 do Oráculo.
local_gate_ok() {
  local token="$HOME/.donel/portoes/$LOCAL_GATE.token" hash="$DIR/portoes/$LOCAL_GATE.sha256"
  [ -s "$token" ] && [ -s "$hash" ] && [ "$(sha256sum <"$token" | cut -d' ' -f1)" = "$(tr -d ' \n' <"$hash")" ]
}

# A unidade do entregador: o mesmo bundle e o mesmo DONEL_ORACULO_DIR do donel-oraculo, no modo entregador; sem a
# marca, o systemd nem a sobe (ConditionPathExists), e o bundle recusaria subir sozinho (modo.ts).
write_entregador_unit() {
  mkdir -p "$(dirname "$ENTREGADOR_FILE")"
  cat >"$ENTREGADOR_FILE" <<UNIT_EOF
[Unit]
Description=Donel Dev — entregador do Oráculo (portão das sessões, recados e chat do celular)
After=network-online.target tailscaled.service
ConditionPathExists=$MARK

[Service]
Environment=DONEL_ORACULO_DIR=$DIR
Environment=DONEL_ORACULO_MODO=entregador
ExecStart=$(command -v node) $DIR/bin/oraculo.mjs
Restart=always
RestartSec=15
UMask=0077

[Install]
WantedBy=default.target
UNIT_EOF
  $SYSTEMCTL --user daemon-reload
}

# `oraculo.mjs --separar-chat | --juntar-chat` com os dois daemons parados (ele mesmo recusa se algum responder).
move_chat() {
  DONEL_ORACULO_DIR="$DIR" "$(command -v node)" "$DIR/bin/oraculo.mjs" "--$1-chat"
}

separated() { [ -e "$MARK" ]; }

case "${1:-}" in
  instalar)
    build
    write_unit
    $SYSTEMCTL --user enable --now "$UNIT"
    sleep 1
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5
    ;;
  atualizar)
    build
    write_unit
    $SYSTEMCTL --user restart "$UNIT"
    # Separado, o entregador roda o mesmo bundle: sobe com ele também (o registro primeiro).
    if separated; then
      write_entregador_unit
      $SYSTEMCTL --user restart "$ENTREGADOR"
    fi
    sleep 1
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5
    if separated; then $SYSTEMCTL --user --no-pager status "$ENTREGADOR" | head -5; fi
    ;;
  voltar)
    # O bundle anterior pode não conhecer a separação: com o entregador no ar, os dois brigariam pelas portas
    # 47815/47817 e o donel-oraculo ficaria reiniciando sem registro. Primeiro `juntar`.
    if separated; then
      echo "o entregador está separado ($MARK): rode \`$0 juntar\` antes de voltar o bundle" >&2
      exit 1
    fi
    # Sem nenhuma cópia, o `ls` falha e o pipefail sairia do script antes da mensagem: o `|| true` a deixa aparecer.
    ANTES="$(ls -1t "$DIR"/bin/oraculo.mjs.antes-* 2>/dev/null | head -1 || true)"
    [ -n "$ANTES" ] || { echo "sem bundle anterior em $DIR/bin" >&2; exit 1; }
    install -m 0644 "$ANTES" "$DIR/bin/oraculo.mjs"
    $SYSTEMCTL --user restart "$UNIT"
    echo "De volta a $(basename "$ANTES")."
    sleep 1
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5
    ;;
  portao|revogar-portao)
    NAME="${2:-}"
    if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
      echo "nome da máquina: minúsculas, números e hífen (ex.: homologacoes)" >&2
      exit 1
    fi
    if [ "$1" = revogar-portao ]; then
      rm -f "$DIR/portoes/$NAME.sha256" "$HOME/.donel/portoes/$NAME.token"
      echo "Revogada a credencial do portão $NAME."
      exit 0
    fi
    new_gate "$NAME"
    echo "Credencial do portão $NAME em $HOME/.donel/portoes/$NAME.token"
    URL="$(tr -d '\n' <"$DIR/url" 2>/dev/null || true)"
    echo "Na máquina $NAME (root): scripts/portao-satelite.sh instalar --url ${URL:-<url do Oráculo>} < <arquivo com o token>"
    ;;
  parar)
    if separated; then $SYSTEMCTL --user disable --now "$ENTREGADOR"; fi
    $SYSTEMCTL --user disable --now "$UNIT"
    echo "Parado. O registro segue em $DIR."
    ;;
  status)
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5 || true
    $JOURNALCTL --user -u "$UNIT" -n 20 --no-pager || true
    # Sem a marca e sem a unidade do entregador, a saída é a de antes.
    if separated || [ -f "$ENTREGADOR_FILE" ]; then
      echo
      if separated; then echo "Separado ($MARK): o donel-entregador cuida do portão, dos recados e do chat."; else echo "Junto (sem $MARK), mas a unidade $ENTREGADOR existe."; fi
      $SYSTEMCTL --user --no-pager status "$ENTREGADOR" | head -5 || true
      $JOURNALCTL --user -u "$ENTREGADOR" -n 20 --no-pager || true
      # Separado: 47816 e 47818 num pid (registro), 47815 e 47817 noutro (entregador).
      ss -ltnp 2>/dev/null | grep -E ':4781[5-8] ' || true
    fi
    ;;
  separar)
    # Roteiro da implantação (docs/planos/oraculo-entregador.md). ~30 s sem chat e sem registro: combine a janela.
    if separated; then echo "já separado ($MARK)" >&2; exit 1; fi
    [ -f "$DIR/bin/oraculo.mjs" ] || { echo "sem $DIR/bin/oraculo.mjs: rode \`$0 instalar\` antes" >&2; exit 1; }
    # O bundle no ar tem de conhecer a separação (passo 9, PRs 1–3): um antigo ignoraria o modo e subiria tudo duas vezes.
    if ! grep -q 'entregador.separado' "$DIR/bin/oraculo.mjs" || ! grep -q 'separar-chat' "$DIR/bin/oraculo.mjs"; then
      echo "o bundle em $DIR/bin/oraculo.mjs não conhece a separação: rode \`$0 atualizar\` (sem a marca, ele roda como hoje) antes" >&2
      exit 1
    fi
    # 1. A credencial do portão desta máquina (reusada se já confere), o token onde o entregador lê e a marca de local.
    if local_gate_ok; then echo "1. Portão $LOCAL_GATE: a credencial que já existe."; else new_gate "$LOCAL_GATE"; echo "1. Portão $LOCAL_GATE: credencial nova em $HOME/.donel/portoes/$LOCAL_GATE.token."; fi
    install -m 0600 "$HOME/.donel/portoes/$LOCAL_GATE.token" "$DIR/portao.token"
    (umask 077 && : >"$DIR/portoes/$LOCAL_GATE.local")
    # 2. Para o donel-oraculo (o chat e o registro somem daqui até o passo 6).
    echo "2. Parando $UNIT."
    $SYSTEMCTL --user stop "$UNIT"
    # 3. As mensagens do chat vão para chat-local.json (o original fica como celular-local.json.antes-separar-<hora>).
    echo "3. Separando o chat."
    if ! move_chat separar; then
      echo "a separação do chat falhou: nada mais mudou; $UNIT volta como estava (junto)." >&2
      rm -f "$DIR/portoes/$LOCAL_GATE.local"
      $SYSTEMCTL --user start "$UNIT"
      exit 1
    fi
    # 4. A marca: daqui em diante o donel-oraculo é só o registro.
    echo "4. Marca $MARK."
    (umask 077 && : >"$MARK")
    # 5. A unidade do entregador.
    echo "5. Unidade $ENTREGADOR_FILE."
    write_entregador_unit
    # 6. O registro primeiro (47816 e 47818), depois o entregador (47815 e 47817).
    echo "6. Subindo $UNIT e $ENTREGADOR."
    $SYSTEMCTL --user start "$UNIT"
    $SYSTEMCTL --user enable --now "$ENTREGADOR"
    sleep 1
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5 || true
    $SYSTEMCTL --user --no-pager status "$ENTREGADOR" | head -5 || true
    echo "Separado. Confira: ss -ltnp (47816/47818 num pid, 47815/47817 noutro), lsof $DIR/ledger.sqlite, uma tarefa_criar,"
    echo "um recado entre sessões, ida e volta de uma mensagem do celular, um tarefa_ver da Homologação. Volta: $0 juntar"
    ;;
  juntar)
    # A volta (docs/planos/oraculo-entregador.md). A ordem importa: com o entregador no ar, o donel-oraculo sem a marca
    # brigaria com ele pelas portas 47815/47817.
    if ! separated && [ ! -f "$DIR/chat-local.json" ]; then echo "já junto (sem $MARK)" >&2; exit 1; fi
    echo "1. Desligando $ENTREGADOR."
    $SYSTEMCTL --user disable --now "$ENTREGADOR" || true
    # O --juntar-chat recusa com qualquer dos dois no ar: o registro também para (o desenho dizia só reiniciá-lo).
    echo "2. Parando $UNIT."
    $SYSTEMCTL --user stop "$UNIT"
    if [ -f "$DIR/chat-local.json" ]; then
      echo "3. Juntando o chat (as mensagens novas voltam a celular-local.json)."
      if ! move_chat juntar; then
        echo "a volta do chat falhou: tudo segue separado ($UNIT e $ENTREGADOR sobem de novo)." >&2
        $SYSTEMCTL --user start "$UNIT"
        $SYSTEMCTL --user enable --now "$ENTREGADOR"
        exit 1
      fi
    else
      echo "3. Sem $DIR/chat-local.json: nada a juntar no chat."
    fi
    # 4. Sem a marca, o Líder único sai do portão local e o donel-oraculo volta a subir tudo, como antes.
    echo "4. Tirando $MARK."
    rm -f "$MARK" "$DIR/portoes/$LOCAL_GATE.local"
    echo "5. Subindo $UNIT (tudo num processo, como antes)."
    $SYSTEMCTL --user start "$UNIT"
    sleep 1
    $SYSTEMCTL --user --no-pager status "$UNIT" | head -5 || true
    echo "Junto. Só agora, se o bundle estiver ruim: $0 voltar"
    ;;
  servico|revogar)
    NAME="${2:-}"
    if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
      echo "nome do serviço: minúsculas, números e hífen (ex.: slack-mencoes)" >&2
      exit 1
    fi
    if [ "$1" = revogar ]; then
      rm -f "$DIR/servicos/$NAME.sha256" "$HOME/.donel/servicos/$NAME.token"
      echo "Revogada a credencial de $NAME."
      exit 0
    fi
    umask 077
    mkdir -p "$DIR/servicos" "$HOME/.donel/servicos"
    TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$TOKEN" >"$HOME/.donel/servicos/$NAME.token.tmp"
    mv "$HOME/.donel/servicos/$NAME.token.tmp" "$HOME/.donel/servicos/$NAME.token"
    printf '%s\n' "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >"$DIR/servicos/$NAME.sha256.tmp"
    mv "$DIR/servicos/$NAME.sha256.tmp" "$DIR/servicos/$NAME.sha256"
    echo "Credencial de $NAME em $HOME/.donel/servicos/$NAME.token"
    URL="$(tr -d '\n' <"$DIR/url" 2>/dev/null || true)"
    echo "Uso: POST ${URL:-<url do Oráculo>}/v1/servico/apply com Authorization: Bearer <token> e {\"op\": {...}} (criar, assumir, entregar)."
    ;;
  *)
    sed -n '2,22p' "$0"
    exit 1
    ;;
esac
