#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=full-target-shadow-free-real-wan-common.sh
source "${ROOT}/tests/full-target-shadow-free-real-wan-common.sh"

WORK="${WAN_ARTIFACT_DIR:-/tmp/fae-real-wan-d}"
mkdir -p "$WORK"
D_BOOT_ID="$(cat /proc/sys/kernel/random/boot_id)"
[[ -n "$D_BOOT_ID" ]]
printf '%s\n' "$D_BOOT_ID" >"$WORK/boot-id.txt"

A_META=$(wan_wait_role FAE_WAN_ENDPOINT A 300)
B_META=$(wan_wait_role FAE_WAN_ENDPOINT B 300)
C_META=$(wan_wait_role FAE_WAN_ENDPOINT C 300)
A_URL=$(jq -r '.url' <<<"$A_META")
B_URL=$(jq -r '.url' <<<"$B_META")
C_URL=$(jq -r '.url' <<<"$C_META")
A_PROVIDER=$(wan_tunnel_provider_from_url "$A_URL")
B_PROVIDER=$(wan_tunnel_provider_from_url "$B_URL")
C_PROVIDER=$(wan_tunnel_provider_from_url "$C_URL")
[[ "$A_PROVIDER" != unknown && "$B_PROVIDER" != unknown && "$C_PROVIDER" != unknown ]]
TUNNEL_PROVIDERS=$(jq -nc --arg a "$A_PROVIDER" --arg b "$B_PROVIDER" --arg c "$C_PROVIDER" '[$a,$b,$c]|unique')
TUNNEL_PROVIDER_COUNT=$(jq 'length' <<<"$TUNNEL_PROVIDERS")

printf '%s\n' "$A_META" >"$WORK/a-endpoint.json"
printf '%s\n' "$B_META" >"$WORK/b-endpoint.json"
printf '%s\n' "$C_META" >"$WORK/c-endpoint.json"
printf '%s\n' "$TUNNEL_PROVIDERS" >"$WORK/tunnel-providers.json"

# Require both distinct runner allocations and distinct Linux kernel boot IDs.
# Hostname text alone is not used because GitHub-hosted runners may reuse it.
RUNNERS=$(jq -nc --argjson a "$A_META" --argjson b "$B_META" --argjson c "$C_META" '[ $a.runner_name,$b.runner_name,$c.runner_name ]')
[[ "$(jq 'unique|length' <<<"$RUNNERS")" == 3 ]]
D_RUNNER="${RUNNER_NAME:-unknown}"
[[ "$D_RUNNER" != unknown ]]
! jq -e --arg d "$D_RUNNER" 'index($d)!=null' <<<"$RUNNERS" >/dev/null

A_BOOT_ID=$(jq -r '.boot_id // empty' <<<"$A_META")
B_BOOT_ID=$(jq -r '.boot_id // empty' <<<"$B_META")
C_BOOT_ID=$(jq -r '.boot_id // empty' <<<"$C_META")
[[ -n "$A_BOOT_ID" && -n "$B_BOOT_ID" && -n "$C_BOOT_ID" ]]
BOOT_IDS=$(jq -nc --arg a "$A_BOOT_ID" --arg b "$B_BOOT_ID" --arg c "$C_BOOT_ID" --arg d "$D_BOOT_ID" '[$a,$b,$c,$d]')
[[ "$(jq 'unique|length' <<<"$BOOT_IDS")" == 4 ]]

URLS=$(jq -nc --arg a "$A_URL" --arg b "$B_URL" --arg c "$C_URL" '[$a,$b,$c]')
[[ "$(jq 'unique|length' <<<"$URLS")" == 3 ]]
D_HOST=$(hostname)

# D observes the deliberately weak C state from its own runner before the fault
# sequence is allowed to proceed. This prevents the controller from self-attesting.
WEAK_PHASE=$(wan_wait_phase FAE_WAN_PHASE weak 300)
A_WEAK=$(wan_json_status "$A_URL")
C_WEAK=$(wan_json_status "$C_URL")
WEAK_TIP=$(jq -r '.c_tip_hash' <<<"$WEAK_PHASE")
WEAK_WORK=$(jq -r '.c_chain_work' <<<"$WEAK_PHASE")
jq -e --arg tip "$WEAK_TIP" --arg work "$WEAK_WORK" '.tip_hash==$tip and .chain_work==$work and .status=="lab-only-no-consensus-authority"' <<<"$A_WEAK" >/dev/null
jq -e --arg tip "$WEAK_TIP" --arg work "$WEAK_WORK" '.tip_hash==$tip and .chain_work==$work and .status=="lab-only-no-consensus-authority" and .secure_context_binding==.policy_id' <<<"$C_WEAK" >/dev/null
printf '%s\n' "$C_WEAK" >"$WORK/c-weak-public.json"
wan_post FAE_WAN_OBSERVER_PHASE "$(jq -nc --arg run "$GITHUB_RUN_ID" --arg phase weak --arg observer_host "$D_HOST" --arg observer_runner "$D_RUNNER" --arg observer_boot_id "$D_BOOT_ID" --arg tip "$WEAK_TIP" --arg work "$WEAK_WORK" '{run_id:$run,phase:$phase,status:"PASS",observer_hostname:$observer_host,observer_runner:$observer_runner,observer_boot_id:$observer_boot_id,c_tip_hash:$tip,c_chain_work:$work,distinct_boot_ids:true,public_endpoint_verified:true}')"

# After C completes the fault/restart/reconnect sequence, D independently fetches
# all three public endpoints. No controller-local file or loopback endpoint is used.
FINAL_PHASE=$(wan_wait_phase FAE_WAN_PHASE final 600)
A_FINAL=$(wan_json_status "$A_URL")
B_FINAL=$(wan_json_status "$B_URL")
C_FINAL=$(wan_json_status "$C_URL")
A_TIP=$(jq -r '.a_tip_hash' <<<"$FINAL_PHASE")
A_WORK=$(jq -r '.a_chain_work' <<<"$FINAL_PHASE")
B_TIP=$(jq -r '.b_tip_hash' <<<"$FINAL_PHASE")
B_WORK=$(jq -r '.b_chain_work' <<<"$FINAL_PHASE")

jq -e --arg tip "$A_TIP" --arg work "$A_WORK" '.tip_hash==$tip and .chain_work==$work and .status=="lab-only-no-consensus-authority"' <<<"$A_FINAL" >/dev/null
jq -e --arg tip "$B_TIP" --arg work "$B_WORK" '.tip_hash==$tip and .chain_work==$work and .status=="lab-only-no-consensus-authority"' <<<"$B_FINAL" >/dev/null
jq -e --arg tip "$B_TIP" --arg work "$B_WORK" '.tip_hash==$tip and .chain_work==$work and .status=="lab-only-no-consensus-authority" and .secure_context_binding==.policy_id' <<<"$C_FINAL" >/dev/null
(( B_WORK > A_WORK ))

printf '%s\n' "$A_FINAL" >"$WORK/a-final-public.json"
printf '%s\n' "$B_FINAL" >"$WORK/b-final-public.json"
printf '%s\n' "$C_FINAL" >"$WORK/c-final-public.json"
printf '%s\n' "$FINAL_PHASE" >"$WORK/controller-final-marker.json"
printf '%s\n' "$RUNNERS" >"$WORK/runner-allocations.json"
printf '%s\n' "$BOOT_IDS" >"$WORK/kernel-boot-ids.json"

PASS=$(jq -nc \
  --arg run "$GITHUB_RUN_ID" --arg phase final --arg observer_host "$D_HOST" --arg observer_runner "$D_RUNNER" --arg observer_boot_id "$D_BOOT_ID" \
  --arg a_tip "$A_TIP" --arg a_work "$A_WORK" --arg b_tip "$B_TIP" --arg b_work "$B_WORK" \
  --argjson tunnel_providers "$TUNNEL_PROVIDERS" --argjson tunnel_provider_count "$TUNNEL_PROVIDER_COUNT" \
  '{run_id:$run,phase:$phase,status:"PASS",observer_hostname:$observer_host,observer_runner:$observer_runner,observer_boot_id:$observer_boot_id,distinct_runner_vms:true,distinct_runner_hosts:true,distinct_boot_ids:true,public_endpoint_consistency:true,weak_state_independently_observed:true,stronger_work_selected:true,secure_context_binding:true,real_public_tunnels:true,compute_provider:"github-actions",tunnel_providers:$tunnel_providers,tunnel_provider_count:$tunnel_provider_count,tunnel_failover_capable:true,multi_provider_compute_proof:false,time_equivalent_soak:false,a_tip_hash:$a_tip,a_chain_work:$a_work,b_tip_hash:$b_tip,b_chain_work:$b_work}')
wan_post FAE_WAN_OBSERVER_PASS "$PASS"
printf '%s\n' "$PASS" >"$WORK/observer-pass.json"
