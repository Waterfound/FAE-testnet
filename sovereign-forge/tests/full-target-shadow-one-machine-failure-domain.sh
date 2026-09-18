#!/usr/bin/env bash
set -euo pipefail

IMAGE="${FAE_SHADOW_LOCAL_CHAOS_IMAGE:-fae-shadow-validation:one-machine}"
SUFFIX="${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
A="fae-om-a-${SUFFIX}"
B="fae-om-b-${SUFFIX}"
C="fae-om-c-${SUFFIX}"
P="fae-om-proxy-${SUFFIX}"
NET_CA="fae-om-ca-${SUFFIX}"
NET_CP="fae-om-cp-${SUFFIX}"
NET_PB="fae-om-pb-${SUFFIX}"
C_VOL="fae-om-c-data-${SUFFIX}"
P_VOL="fae-om-proxy-data-${SUFFIX}"
C_PORT="${FAE_SHADOW_LOCAL_C_PORT:-18883}"
P_PORT="${FAE_SHADOW_LOCAL_PROXY_PORT:-18890}"

cleanup(){
  docker rm -f "$C" "$P" "$A" "$B" >/dev/null 2>&1 || true
  docker network rm "$NET_CA" "$NET_CP" "$NET_PB" >/dev/null 2>&1 || true
  docker volume rm -f "$C_VOL" "$P_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$NET_CA" >/dev/null
docker network create "$NET_CP" >/dev/null
docker network create "$NET_PB" >/dev/null
docker volume create "$C_VOL" >/dev/null
docker volume create "$P_VOL" >/dev/null

FIXTURE_JSON="$(node --input-type=module -e "import {createShadowValidationFixture} from './sovereign-forge/node/lab/full-target-shadow-validation-fixtures.mjs';const w=createShadowValidationFixture('weak-a');const s=createShadowValidationFixture('strong-b');console.log(JSON.stringify({weak_tip:w.expected_tip_hash,weak_work:w.expected_work,strong_tip:s.expected_tip_hash,strong_work:s.expected_work}))")"
json_field(){ node -e "let v=JSON.parse(process.argv[1]);for(const p of process.argv[2].split('.'))v=v[p];process.stdout.write(typeof v==='string'?v:JSON.stringify(v))" "$1" "$2"; }
WEAK_TIP="$(json_field "$FIXTURE_JSON" weak_tip)"
WEAK_WORK="$(json_field "$FIXTURE_JSON" weak_work)"
STRONG_TIP="$(json_field "$FIXTURE_JSON" strong_tip)"
STRONG_WORK="$(json_field "$FIXTURE_JSON" strong_work)"

wait_url(){
  local url="$1" attempts="${2:-90}"
  for _ in $(seq 1 "$attempts"); do curl -fsS "$url" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out waiting for $url" >&2; return 1
}
status_json(){ curl -fsS "http://127.0.0.1:${C_PORT}/status"; }
proxy_json(){ curl -fsS "http://127.0.0.1:${P_PORT}/proxy/status"; }
assert_tip(){
  local expected_tip="$1" expected_work="$2" label="$3" current tip work
  current="$(status_json)"; tip="$(json_field "$current" tip_hash)"; work="$(json_field "$current" chain_work)"
  test "$tip" = "$expected_tip" || { echo "$label tip mismatch: $tip != $expected_tip" >&2; return 1; }
  test "$work" = "$expected_work" || { echo "$label work mismatch: $work != $expected_work" >&2; return 1; }
}
wait_tip(){
  local expected_tip="$1" expected_work="$2" label="$3" attempts="${4:-90}"
  for _ in $(seq 1 "$attempts"); do
    if current="$(status_json 2>/dev/null)"; then
      tip="$(json_field "$current" tip_hash)"; work="$(json_field "$current" chain_work)"
      if test "$tip" = "$expected_tip" && test "$work" = "$expected_work"; then return 0; fi
    fi
    sleep 1
  done
  echo "timed out waiting for $label" >&2; status_json >&2 || true; return 1
}
wait_faults(){
  local minimum="$1" label="$2" attempts="${3:-90}"
  for _ in $(seq 1 "$attempts"); do
    if current="$(proxy_json 2>/dev/null)"; then
      faults="$(json_field "$current" faults_injected)"
      if test "$faults" -ge "$minimum"; then return 0; fi
    fi
    sleep 1
  done
  echo "timed out waiting for $label fault injection" >&2; proxy_json >&2 || true; return 1
}

start_proxy(){
  local drop="$1" label="$2"
  docker rm -f "$P" >/dev/null 2>&1 || true
  docker run -d --name "$P" --network "$NET_CP" \
    -p "127.0.0.1:${P_PORT}:8790" \
    -v "$P_VOL:/data" \
    -e FAE_SHADOW_PROXY_LABEL="$label" \
    -e FAE_SHADOW_PROXY_TARGET="http://${B}:8788" \
    -e FAE_SHADOW_PROXY_DROP_SECURE_ORDINAL="$drop" \
    -e FAE_SHADOW_PROXY_BASE_DELAY_MS=35 \
    -e FAE_SHADOW_PROXY_JITTER_MS=20 \
    -e FAE_SHADOW_PROXY_CHUNK_BYTES=256 \
    -e FAE_SHADOW_PROXY_CHUNK_DELAY_MS=4 \
    "$IMAGE" node lab/full-target-shadow-fault-proxy.mjs >/dev/null
  docker network connect "$NET_PB" "$P"
  wait_url "http://127.0.0.1:${P_PORT}/proxy/status"
  local pstatus
  pstatus="$(proxy_json)"
  test "$(json_field "$pstatus" degraded_transport)" = true
  test "$(json_field "$pstatus" drop_secure_ordinal)" = "$drop"
}

start_c(){
  local peers="$1" connect_proxy_network="${2:-1}"
  docker rm -f "$C" >/dev/null 2>&1 || true
  docker run -d --name "$C" --network "$NET_CA" \
    -p "127.0.0.1:${C_PORT}:8788" \
    -v "$C_VOL:/data" \
    -e FAE_SHADOW_LABEL=one-machine-c \
    -e FAE_SHADOW_PROFILE=trusted \
    -e FAE_SHADOW_PEERS="$peers" \
    -e FAE_SHADOW_SYNC=1 \
    -e FAE_SHADOW_SYNC_MS=5000 \
    "$IMAGE" >/dev/null
  if test "$connect_proxy_network" = 1; then docker network connect "$NET_CP" "$C"; fi
  wait_url "http://127.0.0.1:${C_PORT}/status"
}

# A and B never share a network. C reaches A directly, but reaches B only through
# a dual-homed lab fault proxy (C<->proxy and proxy<->B are separate namespaces).
docker run -d --name "$A" --network "$NET_CA" \
  -e FAE_SHADOW_LABEL=one-machine-a -e FAE_SHADOW_PROFILE=weak-a -e FAE_SHADOW_SYNC=0 \
  "$IMAGE" >/dev/null
docker run -d --name "$B" --network "$NET_PB" \
  -e FAE_SHADOW_LABEL=one-machine-b -e FAE_SHADOW_PROFILE=strong-b -e FAE_SHADOW_SYNC=0 \
  "$IMAGE" >/dev/null

# Stage 0: persist C on lower-work A before B is reachable.
start_c "http://${A}:8788" 0
wait_tip "$WEAK_TIP" "$WEAK_WORK" "weak-A convergence"

docker stop --time 10 "$C" >/dev/null
docker rm "$C" >/dev/null

# Stage 1A: deterministic headers interruption over a delayed/jittered/throttled
# transport, with B physically unreachable from C except through the proxy.
start_proxy 2 one-machine-headers-cut
start_c "http://${A}:8788,http://${P}:8790" 1

# Prove the logical failure domains, not merely the configured peer list.
docker exec "$C" node -e "fetch('http://${B}:8788/status',{signal:AbortSignal.timeout(1200)}).then(()=>process.exit(9)).catch(()=>process.exit(0))"
docker exec "$A" node -e "fetch('http://${B}:8788/status',{signal:AbortSignal.timeout(1200)}).then(()=>process.exit(9)).catch(()=>process.exit(0))"
docker exec "$B" node -e "fetch('http://${A}:8788/status',{signal:AbortSignal.timeout(1200)}).then(()=>process.exit(9)).catch(()=>process.exit(0))"
docker exec "$C" node -e "fetch('http://${P}:8790/proxy/status',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:8)).catch(()=>process.exit(7))"
docker exec "$P" node -e "fetch('http://${B}:8788/status',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:8)).catch(()=>process.exit(7))"

wait_faults 1 headers-cut
assert_tip "$WEAK_TIP" "$WEAK_WORK" "headers-cut atomicity"

# Stage 1B: allow headers, truncate block bodies. C must remain exactly on A.
start_proxy 3 one-machine-blocks-cut
wait_faults 1 blocks-cut
assert_tip "$WEAK_TIP" "$WEAK_WORK" "blocks-cut atomicity"

# Hard-crash C while the block-body failure is still active. Its durable state
# must restart on the complete weak chain, never a partially adopted B suffix.
docker kill --signal KILL "$C" >/dev/null
docker rm "$C" >/dev/null
start_c "http://${A}:8788,http://${P}:8790" 1
wait_tip "$WEAK_TIP" "$WEAK_WORK" "restart-during-blocks-cut"

# Stage 1C: restore the same degraded path without truncation. A fresh secure
# session must rediscover the fork and atomically adopt higher-work B.
start_proxy 0 one-machine-recovered-link
wait_tip "$STRONG_TIP" "$STRONG_WORK" "degraded-link recovery" 120

PERSISTED_TIP="$(docker exec "$C" node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('/data/full-target-shadow-state.json','utf8'));process.stdout.write(s.chain.at(-1).hash)")"
test "$PERSISTED_TIP" = "$STRONG_TIP"

# Stage 2: remove B's only route, allow at least one sync interval, then hard
# restart C while partitioned. Reachable lower-work A must never roll C back.
docker stop --time 10 "$P" >/dev/null
docker rm "$P" >/dev/null
sleep 6
assert_tip "$STRONG_TIP" "$STRONG_WORK" "partition-after-convergence"
docker kill --signal KILL "$C" >/dev/null
docker rm "$C" >/dev/null
start_c "http://${A}:8788,http://${P}:8790" 1
wait_tip "$STRONG_TIP" "$STRONG_WORK" "restart-while-B-partitioned"

start_proxy 0 one-machine-reconnect
sleep 7
assert_tip "$STRONG_TIP" "$STRONG_WORK" "post-partition reconnect"

# Accelerated churn soak: three additional partition/reconnect phases. This is
# deliberately a lifecycle stress pass, not a substitute for a 6h/24h real WAN soak.
for cycle in 1 2 3 4 5 6; do
  if test $((cycle % 2)) -eq 1; then
    docker stop --time 10 "$P" >/dev/null
    docker rm "$P" >/dev/null
    sleep 2
    assert_tip "$STRONG_TIP" "$STRONG_WORK" "churn-partition-${cycle}"
    if test "$cycle" = 3; then
      docker kill --signal KILL "$C" >/dev/null
      docker rm "$C" >/dev/null
      start_c "http://${A}:8788,http://${P}:8790" 1
      wait_tip "$STRONG_TIP" "$STRONG_WORK" "churn-restart-${cycle}"
    fi
  else
    start_proxy 0 "one-machine-churn-${cycle}"
    sleep 7
    assert_tip "$STRONG_TIP" "$STRONG_WORK" "churn-reconnect-${cycle}"
  fi
done

# Evidence must contain both mid-reorg cuts and degraded-transport metadata.
docker exec "$P" node -e "const fs=require('fs');const t=fs.readFileSync('/data/full-target-shadow-fault-proxy.jsonl','utf8');if(!t.includes('\"secure_ordinal\":2')||!t.includes('\"secure_ordinal\":3')||!t.includes('\"degraded_transport\":true'))process.exit(1)"

FINAL="$(status_json)"
test "$(json_field "$FINAL" tip_hash)" = "$STRONG_TIP"
test "$(json_field "$FINAL" chain_work)" = "$STRONG_WORK"
test "$(json_field "$FINAL" secure_context_binding)" = "$(json_field "$FINAL" policy_id)"

printf '%s\n' "$(node -e "console.log(JSON.stringify({status:'PASS',shadow_only:true,scenario:'one-machine-failure-domain-degraded-network-chaos',separate_network_namespaces:true,direct_c_to_b_path_absent:true,direct_a_to_b_path_absent:true,proxy_dual_homed:true,degraded_transport:true,headers_response_interrupted:true,blocks_response_interrupted:true,no_partial_adoption:true,hard_restart_during_reorg_fault:true,fresh_session_recovery:true,stronger_work_selected:true,lower_work_rollback_rejected:true,restart_while_partitioned:true,accelerated_churn_phases:6,persisted_strong_tip:true,external_wan_proof:false}))")"
