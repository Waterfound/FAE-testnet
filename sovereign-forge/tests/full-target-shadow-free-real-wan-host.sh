#!/usr/bin/env bash
set -euo pipefail

ROLE="${1:?role required}"
PROFILE="${2:?profile required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=full-target-shadow-free-real-wan-common.sh
source "${ROOT}/tests/full-target-shadow-free-real-wan-common.sh"

WORK="${WAN_ARTIFACT_DIR:-/tmp/fae-real-wan-${ROLE,,}}"
mkdir -p "$WORK/data"
NODE_PID_FILE="$WORK/node.pid"
TUNNEL_PID_FILE="$WORK/tunnel.pid"
NODE_LOG="$WORK/node.log"
TUNNEL_LOG="$WORK/tunnel.log"

cleanup(){
  wan_stop_pid_file "$TUNNEL_PID_FILE" TERM
  wan_stop_pid_file "$NODE_PID_FILE" TERM
}
trap cleanup EXIT

FAE_SHADOW_HOST=127.0.0.1 \
FAE_SHADOW_PORT=8788 \
FAE_SHADOW_PROFILE="$PROFILE" \
FAE_SHADOW_LABEL="real-wan-${ROLE,,}" \
FAE_SHADOW_DATA_FILE="$WORK/data/state.json" \
FAE_SHADOW_IDENTITY_FILE="$WORK/data/identity.json" \
FAE_SHADOW_EVIDENCE_FILE="$WORK/data/evidence.jsonl" \
FAE_SHADOW_SYNC=0 \
node "$ROOT/node/lab/fae-full-target-shadow-validation-node.mjs" >"$NODE_LOG" 2>&1 &
echo $! >"$NODE_PID_FILE"
wan_wait_http "http://127.0.0.1:8788/status" 120

wan_install_cloudflared /tmp/cloudflared
PUBLIC_URL=$(wan_start_tunnel 8788 "$TUNNEL_LOG" "$TUNNEL_PID_FILE" /tmp/cloudflared)
STATUS=$(wan_json_status "$PUBLIC_URL")
EXPECTED_HEIGHT=$(jq -r '.height' <<<"$STATUS")
TIP=$(jq -r '.tip_hash' <<<"$STATUS")
WORK_VALUE=$(jq -r '.chain_work' <<<"$STATUS")

ENDPOINT=$(jq -nc \
  --arg run "$GITHUB_RUN_ID" --arg role "$ROLE" --arg profile "$PROFILE" \
  --arg url "$PUBLIC_URL" --arg runner "${RUNNER_NAME:-unknown}" --arg hostname "$(hostname)" \
  --arg os "${RUNNER_OS:-unknown}" --arg arch "${RUNNER_ARCH:-unknown}" \
  --arg tip "$TIP" --arg work "$WORK_VALUE" --argjson height "$EXPECTED_HEIGHT" \
  '{run_id:$run,role:$role,profile:$profile,url:$url,runner_name:$runner,hostname:$hostname,runner_os:$os,runner_arch:$arch,height:$height,tip_hash:$tip,chain_work:$work}')
wan_post FAE_WAN_ENDPOINT "$ENDPOINT"

echo "$ENDPOINT" >"$WORK/endpoint.json"
echo "FAE WAN ${ROLE} online at ${PUBLIC_URL}"

# Keep the independent runner and its tunnel alive until the observer confirms
# the final cross-host state. The checks below also turn a silent node/tunnel
# death into a hard failure rather than a false external PASS.
start=$(date +%s)
while :; do
  if wan_phase_json FAE_WAN_OBSERVER_PASS final | grep -q .; then
    break
  fi
  kill -0 "$(cat "$NODE_PID_FILE")" 2>/dev/null || { cat "$NODE_LOG" >&2; exit 1; }
  kill -0 "$(cat "$TUNNEL_PID_FILE")" 2>/dev/null || { cat "$TUNNEL_LOG" >&2; exit 1; }
  wan_wait_http "${PUBLIC_URL}/status" 30 || exit 1
  now=$(date +%s); (( now-start < 900 )) || { echo "observer timeout" >&2; exit 1; }
  sleep 3
done

FINAL=$(wan_json_status "$PUBLIC_URL")
jq -e --arg tip "$TIP" --arg work "$WORK_VALUE" '.tip_hash==$tip and .chain_work==$work' <<<"$FINAL" >/dev/null
printf '%s\n' "$FINAL" >"$WORK/final-status.json"
wan_post FAE_WAN_HOST_COMPLETE "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg role "$ROLE" --arg tip "$TIP" --arg work "$WORK_VALUE" '{run_id:$run,role:$role,phase:"final",tip_hash:$tip,chain_work:$work,status:"PASS"}')"
