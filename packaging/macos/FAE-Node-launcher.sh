#!/bin/bash
# Candidate-only FAE local node launcher. No sudo, wallet, keys or public listener.
set -euo pipefail
umask 077
LABEL="org.waterfound.fae-node"
TARGET="$HOME/Applications/FAE Node.app"
SUPPORT="$HOME/Library/Application Support/FAE Node"
LOGS="$HOME/Library/Logs/FAE Node"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
NODE="$SOURCE/Contents/Resources/node/bin/node"
ENTRY="$SOURCE/Contents/Resources/fae-node/fae-node-v6-candidate.mjs"
xml_escape() {
  printf '%s' "$1" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}
show_message() {
  if [ "${CI:-}" = "true" ]; then echo "FAE installer: $1"; return 0; fi
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"FAE Node\"" >/dev/null 2>&1 || true
}
case "${1:---install}" in
  --run)
    test -x "$NODE" && test -f "$ENTRY" || exit 40
    /bin/mkdir -p "$SUPPORT"
    /bin/chmod 700 "$SUPPORT"
    export FAE_HOST="127.0.0.1"
    export FAE_PORT="8787"
    export FAE_SYNC="1"
    export FAE_DATA_FILE="$SUPPORT/chain-state.json"
    export FAE_DURABLE_STATE_FILE="$SUPPORT/chain-state.json.durable"
    export FAE_IDENTITY_FILE="$SUPPORT/node-identity.json"
    export FAE_PEER_TRUST_FILE="$SUPPORT/peer-trust.json"
    export FAE_DURABLE_CHECKPOINT_MS="60000"
    # Empty until a peer is independently authenticated/admitted. Local service
    # operation is not evidence of P2P sync, independent operator or Explorer LIVE.
    export FAE_PEERS=""
    unset FAE_PUBLIC_URL FAE_PPLNS_COINBASE_ACTIVATION_HEIGHT FAE_DAA_CANDIDATE_ACTIVATION_HEIGHT || true
    cd "$SUPPORT"
    # AC-powered idle sleep prevention only. Screen can go dark. Lid close still sleeps.
    exec /usr/bin/caffeinate -s "$NODE" "$ENTRY"
    ;;
  --status)
    /usr/bin/curl --silent --show-error --connect-timeout 2 --max-time 4 \
      http://127.0.0.1:8787/status || exit 50
    ;;
  --uninstall)
    /bin/launchctl bootout "$DOMAIN" "$AGENT" >/dev/null 2>&1 || true
    /bin/rm -f "$AGENT"
    show_message "FAE Node desativado. Seus dados foram preservados neste Mac."
    ;;
  --install)
    test -x "$NODE" && test -f "$ENTRY" || {
      show_message "Pacote incompleto: runtime ou nó FAE ausente."
      exit 40
    }
    /bin/mkdir -p "$HOME/Applications" "$SUPPORT" "$LOGS" "$HOME/Library/LaunchAgents"
    /bin/chmod 700 "$SUPPORT" "$LOGS"
    if [ "$SOURCE" != "$TARGET" ]; then
      # Preserve Gatekeeper and quarantine; no sudo or security bypass.
      /usr/bin/ditto "$SOURCE" "$TARGET"
      exec "$TARGET/Contents/MacOS/FAE-Node" --install
    fi
    /bin/launchctl bootout "$DOMAIN" "$AGENT" >/dev/null 2>&1 || true
    EXE="$(xml_escape "$TARGET/Contents/MacOS/FAE-Node")"
    OUT="$(xml_escape "$LOGS/node.log")"
    ERR="$(xml_escape "$LOGS/node.err.log")"
    cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$EXE</string><string>--run</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>$OUT</string>
<key>StandardErrorPath</key><string>$ERR</string>
</dict></plist>
PLIST
    /bin/chmod 600 "$AGENT"
    if ! /bin/launchctl bootstrap "$DOMAIN" "$AGENT"; then
      show_message "Aplicativo instalado, mas serviço não iniciado. Faça login no macOS e abra FAE Node novamente."
      exit 51
    fi
    /bin/launchctl kickstart -k "$DOMAIN/$LABEL" || true
    show_message "FAE Node instalado. Inicialização automática após login, estado salvo no Mac e porta apenas local. Sincronização com peers P2P depende de peers independentes verificados; ainda não configurada."
    ;;
  *)
    echo "Usage: FAE-Node [--install|--run|--status|--uninstall]" >&2
    exit 2
    ;;
esac
