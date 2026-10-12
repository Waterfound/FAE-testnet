#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/peer-isolation-eclipse-real-wan-common.sh"

role="${1:?role required}" provider="${2:?provider required}"
port="${FAE_WAN_PORT:-18787}"
artifact_dir="${WAN_ARTIFACT_DIR:-/tmp/fae-eclipse-wan-${role}}"
data_dir="${artifact_dir}/data"
node_log="${artifact_dir}/node.log"
tunnel_log="${artifact_dir}/tunnel.log"
node_pid_file="${artifact_dir}/node.pid"
tunnel_pid_file="${artifact_dir}/tunnel.pid"
mkdir -p "$artifact_dir" "$data_dir"

cleanup(){
  wan_stop_pid_file "$node_pid_file" TERM || true
  wan_stop_pid_file "$tunnel_pid_file" TERM || true
}
trap cleanup EXIT

start_node(){
  : >"$node_log"
  FAE_WAN_ROLE="$([[ "$role" == ANCHOR ]] && echo anchor || echo ordinary)" \
  FAE_WAN_PORT="$port" FAE_WAN_DATA_DIR="$data_dir" \
    node sovereign-forge/tests/peer-isolation-eclipse-real-wan-node.mjs serve >>"$node_log" 2>&1 &
  echo $! >"$node_pid_file"
  for _ in $(seq 1 80); do
    grep -q '"event":"node-online"' "$node_log" && return 0
    wan_process_alive "$(cat "$node_pid_file")" || { cat "$node_log" >&2; return 1; }
    sleep 0.25
  done
  cat "$node_log" >&2; return 1
}

stop_node(){
  wan_stop_pid_file "$node_pid_file" TERM
  rm -f "$node_pid_file"
  for _ in $(seq 1 20); do
    if ! curl -fsS --max-time 1 "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}

if [[ "$role" == ANCHOR ]]; then
  FAE_WAN_ROLE=anchor FAE_WAN_PORT="$port" FAE_WAN_DATA_DIR="$data_dir" \
    node sovereign-forge/tests/peer-isolation-eclipse-real-wan-node.mjs init-anchor >"${artifact_dir}/anchor-init.json"
fi

start_node
identity=$(grep '"event":"node-online"' "$node_log" | tail -n1 | jq -r '.identityId')
height=$(grep '"event":"node-online"' "$node_log" | tail -n1 | jq -r '.height')
[[ "$identity" =~ ^[0-9a-f]{64}$ ]]
if [[ "$role" == ANCHOR ]]; then [[ "$height" == 13 ]]; else [[ "$height" == 11 ]]; fi

endpoint=$(wan_start_required_provider "$provider" "$port" "$tunnel_log" "$tunnel_pid_file")
actual_provider=$(wan_tunnel_provider "$endpoint")
case "$provider" in
  cloudflare) [[ "$actual_provider" == cloudflare-quick-tunnel ]] ;;
  localhost-run) [[ "$actual_provider" == localhost-run ]] ;;
  pinggy) [[ "$actual_provider" == pinggy-tcp ]] ;;
esac
public_status=$(wan_json_status "$endpoint" 90)
[[ "$(jq -r '.height' <<<"$public_status")" == "$height" ]]
boot_id=$(cat /proc/sys/kernel/random/boot_id)

peer_json=$(jq -nc \
  --arg run "$GITHUB_RUN_ID" --arg role "$role" --arg endpoint "$endpoint" --arg identity "$identity" \
  --arg provider "$actual_provider" --arg boot "$boot_id" --argjson height "$height" \
  '{run_id:$run,role:$role,endpoint:$endpoint,identityId:$identity,provider:$provider,boot_id:$boot,height:$height}')
wan_post FAE_ECLIPSE_WAN_PEER "$peer_json"
printf '%s\n' "$peer_json" >"${artifact_dir}/peer.json"

if [[ "$role" != ANCHOR ]]; then
  wan_wait_phase FAE_ECLIPSE_WAN_PHASE done 900 >/dev/null
  exit 0
fi

wan_wait_phase FAE_ECLIPSE_WAN_PHASE isolate 600 >/dev/null
stop_node
wan_post FAE_ECLIPSE_WAN_ANCHOR "$(jq -nc --arg run "$GITHUB_RUN_ID" '{run_id:$run,phase:"anchor-offline"}')"

wan_wait_phase FAE_ECLIPSE_WAN_PHASE recover 600 >/dev/null
start_node
restarted_identity=$(grep '"event":"node-online"' "$node_log" | tail -n1 | jq -r '.identityId')
restarted_height=$(grep '"event":"node-online"' "$node_log" | tail -n1 | jq -r '.height')
[[ "$restarted_identity" == "$identity" && "$restarted_height" == 13 ]]
wan_json_status "$endpoint" 90 >"${artifact_dir}/recovered-public-status.json"
wan_post FAE_ECLIPSE_WAN_ANCHOR "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg identity "$identity" '{run_id:$run,phase:"anchor-online",identityId:$identity,height:13}')"

wan_wait_phase FAE_ECLIPSE_WAN_PHASE reloss 600 >/dev/null
stop_node
wan_post FAE_ECLIPSE_WAN_ANCHOR "$(jq -nc --arg run "$GITHUB_RUN_ID" '{run_id:$run,phase:"anchor-reoffline"}')"

wan_wait_phase FAE_ECLIPSE_WAN_PHASE done 600 >/dev/null
