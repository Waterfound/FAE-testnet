#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=full-target-shadow-free-real-wan-common.sh
source "${ROOT}/tests/full-target-shadow-free-real-wan-common.sh"

WORK="${WAN_ARTIFACT_DIR:-/tmp/fae-real-wan-c}"
mkdir -p "$WORK/data"
NODE_PID_FILE="$WORK/c-node.pid"
TUNNEL_PID_FILE="$WORK/c-tunnel.pid"
PROXY_PID_FILE="$WORK/proxy.pid"
NODE_LOG="$WORK/c-node.log"
TUNNEL_LOG="$WORK/c-tunnel.log"
PROXY_LOG="$WORK/proxy.log"
CONTROL_URL="http://127.0.0.1:8791"
PROXY_URL="http://127.0.0.1:8790"

cleanup(){
  wan_stop_pid_file "$PROXY_PID_FILE" TERM
  wan_stop_pid_file "$TUNNEL_PID_FILE" TERM
  wan_stop_pid_file "$NODE_PID_FILE" TERM
}
on_exit(){
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    wan_post FAE_WAN_CONTROLLER_FAIL "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg phase "controller" --arg status "FAIL" '{run_id:$run,phase:$phase,status:$status}')" || true
  fi
  cleanup
  exit "$rc"
}
trap on_exit EXIT

start_c(){
  FAE_SHADOW_HOST=127.0.0.1 \
  FAE_SHADOW_PORT=8788 \
  FAE_SHADOW_CONTROL_HOST=127.0.0.1 \
  FAE_SHADOW_CONTROL_PORT=8791 \
  FAE_SHADOW_PROFILE=trusted \
  FAE_SHADOW_LABEL=real-wan-c \
  FAE_SHADOW_DATA_FILE="$WORK/data/state.json" \
  FAE_SHADOW_IDENTITY_FILE="$WORK/data/identity.json" \
  FAE_SHADOW_EVIDENCE_FILE="$WORK/data/evidence.jsonl" \
  FAE_SHADOW_SYNC=0 \
  node "$ROOT/node/lab/fae-full-target-shadow-validation-node.mjs" >>"$NODE_LOG" 2>&1 &
  echo $! >"$NODE_PID_FILE"
  wan_wait_http "${CONTROL_URL}/control/status" 120
  wan_wait_http "http://127.0.0.1:8788/status" 120
}

hard_kill_c(){
  local pid
  pid=$(cat "$NODE_PID_FILE")
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  return 1
}

control_status(){ curl -fsS --max-time 15 "${CONTROL_URL}/control/status"; }

control_sync(){
  local peer="$1" output="$2" code
  code=$(jq -nc --arg peer "$peer" '{peer:$peer}' | \
    curl -sS --max-time 90 -o "$output" -w '%{http_code}' \
      -X POST -H 'content-type: application/json' --data-binary @- \
      "${CONTROL_URL}/control/sync")
  printf '%s\n' "$code"
}

assert_c_tip_work(){
  local tip="$1" work="$2" status
  status=$(control_status)
  jq -e --arg tip "$tip" --arg work "$work" '.node.tip_hash==$tip and .node.chain_work==$work and .status=="lab-only-local-control-no-consensus-authority" and .node.secure_context_binding==.node.policy_id' <<<"$status" >/dev/null
}

start_proxy(){
  local drop="$1" label="$2"
  wan_stop_pid_file "$PROXY_PID_FILE" TERM
  rm -f "$PROXY_PID_FILE"
  : >"$PROXY_LOG"
  FAE_SHADOW_PROXY_TARGET="$B_URL" \
  FAE_SHADOW_PROXY_HOST=127.0.0.1 \
  FAE_SHADOW_PROXY_PORT=8790 \
  FAE_SHADOW_PROXY_DROP_SECURE_ORDINAL="$drop" \
  FAE_SHADOW_PROXY_BASE_DELAY_MS=120 \
  FAE_SHADOW_PROXY_JITTER_MS=40 \
  FAE_SHADOW_PROXY_CHUNK_BYTES=192 \
  FAE_SHADOW_PROXY_CHUNK_DELAY_MS=12 \
  FAE_SHADOW_PROXY_EVIDENCE_FILE="$WORK/data/proxy-${label}.jsonl" \
  FAE_SHADOW_PROXY_LABEL="real-wan-${label}" \
  node "$ROOT/node/lab/full-target-shadow-fault-proxy.mjs" >>"$PROXY_LOG" 2>&1 &
  echo $! >"$PROXY_PID_FILE"
  wan_wait_http "${PROXY_URL}/proxy/status" 60
}

stop_proxy(){ wan_stop_pid_file "$PROXY_PID_FILE" TERM; rm -f "$PROXY_PID_FILE"; }

start_c
wan_install_cloudflared /tmp/cloudflared
C_URL=$(wan_start_tunnel 8788 "$TUNNEL_LOG" "$TUNNEL_PID_FILE" /tmp/cloudflared)
C_INITIAL=$(wan_json_status "$C_URL")
C_ENDPOINT=$(jq -nc \
  --arg run "$GITHUB_RUN_ID" --arg role C --arg profile trusted --arg url "$C_URL" \
  --arg runner "${RUNNER_NAME:-unknown}" --arg hostname "$(hostname)" \
  --arg os "${RUNNER_OS:-unknown}" --arg arch "${RUNNER_ARCH:-unknown}" \
  --arg tip "$(jq -r '.tip_hash' <<<"$C_INITIAL")" --arg work "$(jq -r '.chain_work' <<<"$C_INITIAL")" \
  --argjson height "$(jq -r '.height' <<<"$C_INITIAL")" \
  '{run_id:$run,role:$role,profile:$profile,url:$url,runner_name:$runner,hostname:$hostname,runner_os:$os,runner_arch:$arch,height:$height,tip_hash:$tip,chain_work:$work}')
wan_post FAE_WAN_ENDPOINT "$C_ENDPOINT"
echo "$C_ENDPOINT" >"$WORK/c-endpoint.json"

A_META=$(wan_wait_role FAE_WAN_ENDPOINT A 300)
B_META=$(wan_wait_role FAE_WAN_ENDPOINT B 300)
A_URL=$(jq -r '.url' <<<"$A_META")
B_URL=$(jq -r '.url' <<<"$B_META")
A_STATUS=$(wan_json_status "$A_URL")
B_STATUS=$(wan_json_status "$B_URL")
A_TIP=$(jq -r '.tip_hash' <<<"$A_STATUS")
A_WORK=$(jq -r '.chain_work' <<<"$A_STATUS")
B_TIP=$(jq -r '.tip_hash' <<<"$B_STATUS")
B_WORK=$(jq -r '.chain_work' <<<"$B_STATUS")
jq -e '.status=="lab-only-no-consensus-authority" and .height==15' <<<"$A_STATUS" >/dev/null
jq -e '.status=="lab-only-no-consensus-authority" and .height==15' <<<"$B_STATUS" >/dev/null
(( B_WORK > A_WORK )) || { echo "strong B work is not greater than weak A" >&2; exit 1; }

# Stage 0: C first commits the lower-work A branch over a real public tunnel.
code=$(control_sync "$A_URL" "$WORK/sync-adopt-a.json")
[[ "$code" == 200 ]]
jq -e '.ok==true and .result.adopted==true and .result.headers_validated==3 and .result.blocks_validated==3' "$WORK/sync-adopt-a.json" >/dev/null
assert_c_tip_work "$A_TIP" "$A_WORK"
wan_post FAE_WAN_PHASE "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg phase weak --arg c_url "$C_URL" --arg tip "$A_TIP" --arg work "$A_WORK" '{run_id:$run,phase:$phase,c_url:$c_url,c_tip_hash:$tip,c_chain_work:$work,status:"READY_FOR_OBSERVER"}')"
wan_wait_phase FAE_WAN_OBSERVER_PHASE weak 300 >/dev/null

# Stage 1A: common ancestor succeeds across the real WAN; the C-side lab proxy
# truncates the secure headers response after it returns from B's remote runner.
start_proxy 2 headers-cut
code=$(control_sync "$PROXY_URL" "$WORK/sync-headers-cut.json")
[[ "$code" == 502 ]]
jq -e '.ok==false' "$WORK/sync-headers-cut.json" >/dev/null
jq -e '.faults_injected==1 and .drop_secure_ordinal==2 and .degraded_transport==true' < <(curl -fsS "${PROXY_URL}/proxy/status") >/dev/null
assert_c_tip_work "$A_TIP" "$A_WORK"
stop_proxy

# Stage 1B: headers arrive and validate, then the remote block-body response is
# truncated. C must remain fully on A. C is then SIGKILLed while that fault path
# is still active, and must restart from the complete weak durable state.
start_proxy 3 blocks-cut
code=$(control_sync "$PROXY_URL" "$WORK/sync-blocks-cut.json")
[[ "$code" == 502 ]]
jq -e '.ok==false' "$WORK/sync-blocks-cut.json" >/dev/null
jq -e '.faults_injected==1 and .drop_secure_ordinal==3 and .degraded_transport==true' < <(curl -fsS "${PROXY_URL}/proxy/status") >/dev/null
assert_c_tip_work "$A_TIP" "$A_WORK"
hard_kill_c
start_c
assert_c_tip_work "$A_TIP" "$A_WORK"
stop_proxy

# Stage 1C: restore the same C->Cloudflare->B route, still degraded, and require
# a fresh secure session to atomically adopt the greater-work B branch.
start_proxy 0 recovered-link
code=$(control_sync "$PROXY_URL" "$WORK/sync-recovered.json")
[[ "$code" == 200 ]]
jq -e '.ok==true and .result.adopted==true and .result.headers_validated==3 and .result.blocks_validated==3' "$WORK/sync-recovered.json" >/dev/null
assert_c_tip_work "$B_TIP" "$B_WORK"
stop_proxy

# Reachable lower-work A must never roll C back after B was committed.
code=$(control_sync "$A_URL" "$WORK/sync-rollback-a.json")
[[ "$code" == 200 ]]
jq -e '.ok==true and .result.adopted==false and .result.reason=="validated_but_not_preferred"' "$WORK/sync-rollback-a.json" >/dev/null
assert_c_tip_work "$B_TIP" "$B_WORK"

# Stage 2: B's configured route is absent. Hard restart C while only A is used,
# verify durable strong state, reject A again, then reconnect B through a fresh
# degraded proxy/session and require already_current.
hard_kill_c
start_c
assert_c_tip_work "$B_TIP" "$B_WORK"
code=$(control_sync "$A_URL" "$WORK/sync-partition-a.json")
[[ "$code" == 200 ]]
jq -e '.result.adopted==false and .result.reason=="validated_but_not_preferred"' "$WORK/sync-partition-a.json" >/dev/null

start_proxy 0 reconnect
code=$(control_sync "$PROXY_URL" "$WORK/sync-reconnect-b.json")
[[ "$code" == 200 ]]
jq -e '.result.adopted==false and .result.reason=="already_current"' "$WORK/sync-reconnect-b.json" >/dev/null
assert_c_tip_work "$B_TIP" "$B_WORK"
stop_proxy

# Accelerated cross-runner churn: repeatedly destroy/recreate B's only configured
# path. This is not claimed as a 6h/24h soak; it is a short live-WAN stability pass.
for cycle in 1 2 3 4; do
  if [[ "$cycle" == 3 ]]; then hard_kill_c; start_c; assert_c_tip_work "$B_TIP" "$B_WORK"; fi
  start_proxy 0 "churn-${cycle}"
  code=$(control_sync "$PROXY_URL" "$WORK/sync-churn-${cycle}.json")
  [[ "$code" == 200 ]]
  jq -e '.result.adopted==false and .result.reason=="already_current"' "$WORK/sync-churn-${cycle}.json" >/dev/null
  assert_c_tip_work "$B_TIP" "$B_WORK"
  stop_proxy
  assert_c_tip_work "$B_TIP" "$B_WORK"
done

FINAL_LOCAL=$(control_status)
FINAL_PUBLIC=$(wan_json_status "$C_URL")
jq -e --arg tip "$B_TIP" --arg work "$B_WORK" '.tip_hash==$tip and .chain_work==$work and .secure_context_binding==.policy_id' <<<"$FINAL_PUBLIC" >/dev/null
printf '%s\n' "$A_STATUS" >"$WORK/a-status.json"
printf '%s\n' "$B_STATUS" >"$WORK/b-status.json"
printf '%s\n' "$FINAL_LOCAL" >"$WORK/c-final-control.json"
printf '%s\n' "$FINAL_PUBLIC" >"$WORK/c-final-public.json"

FINAL_PHASE=$(jq -nc \
  --arg run "$GITHUB_RUN_ID" --arg phase final --arg c_url "$C_URL" \
  --arg a_tip "$A_TIP" --arg a_work "$A_WORK" --arg b_tip "$B_TIP" --arg b_work "$B_WORK" \
  '{run_id:$run,phase:$phase,c_url:$c_url,a_tip_hash:$a_tip,a_chain_work:$a_work,b_tip_hash:$b_tip,b_chain_work:$b_work,c_tip_hash:$b_tip,c_chain_work:$b_work,headers_interrupted:true,blocks_interrupted:true,sigkill_recovery:true,fresh_session_recovery:true,rollback_rejected:true,reconnect:true,churn_cycles:4,real_public_tunnels:true,independent_runner_hosts:true,multi_provider_proof:false,time_equivalent_soak:false,status:"READY_FOR_OBSERVER"}')
wan_post FAE_WAN_PHASE "$FINAL_PHASE"
echo "$FINAL_PHASE" >"$WORK/controller-final.json"

# Keep C and its public tunnel alive until D independently fetches A/B/C and
# attests the final state from a fourth runner.
OBSERVER=$(wan_wait_phase FAE_WAN_OBSERVER_PASS final 300)
jq -e '.status=="PASS" and .distinct_runner_hosts==true and .public_endpoint_consistency==true' <<<"$OBSERVER" >/dev/null
wan_post FAE_WAN_CONTROLLER_COMPLETE "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg phase final --arg tip "$B_TIP" --arg work "$B_WORK" '{run_id:$run,phase:$phase,status:"PASS",tip_hash:$tip,chain_work:$work}')"
