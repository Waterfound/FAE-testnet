#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/peer-isolation-eclipse-real-wan-common.sh"

artifact_dir="${WAN_ARTIFACT_DIR:-/tmp/fae-eclipse-wan-observer}"
mkdir -p "$artifact_dir"

o1=$(wan_wait_role FAE_ECLIPSE_WAN_PEER O1 600)
o2=$(wan_wait_role FAE_ECLIPSE_WAN_PEER O2 600)
o3=$(wan_wait_role FAE_ECLIPSE_WAN_PEER O3 600)
anchor=$(wan_wait_role FAE_ECLIPSE_WAN_PEER ANCHOR 600)
printf '%s\n%s\n%s\n%s\n' "$o1" "$o2" "$o3" "$anchor" >"${artifact_dir}/peer-markers.jsonl"

unique_boots=$(printf '%s\n%s\n%s\n%s\n' "$o1" "$o2" "$o3" "$anchor" | jq -r '.boot_id' | sort -u | wc -l | tr -d ' ')
[[ "$unique_boots" == 4 ]]
providers=$(printf '%s\n%s\n%s\n' "$o1" "$o2" "$o3" | jq -r '.provider' | sort -u)
[[ "$(wc -l <<<"$providers" | tr -d ' ')" == 3 ]]
grep -qx cloudflare-quick-tunnel <<<"$providers"
grep -qx localhost-run <<<"$providers"
grep -qx pinggy-tcp <<<"$providers"

for role_json in "$o1" "$o2" "$o3" "$anchor"; do
  endpoint=$(jq -r '.endpoint' <<<"$role_json")
  role=$(jq -r '.role' <<<"$role_json")
  expected_height=$(jq -r '.height' <<<"$role_json")
  status=$(wan_json_status "$endpoint" 90)
  [[ "$(jq -r '.height' <<<"$status")" == "$expected_height" ]]
  printf '%s\n' "$status" >"${artifact_dir}/status-${role}.json"
done

ordinary_endpoints=$(jq -nc --argjson a "$o1" --argjson b "$o2" --argjson c "$o3" '[$a.endpoint,$b.endpoint,$c.endpoint]')
groups=$(ENDPOINTS="$ordinary_endpoints" node --input-type=module - <<'NODE'
import {networkGroupForEndpoint} from './sovereign-forge/node/authoritative/peer-diversity.mjs';
const endpoints=JSON.parse(process.env.ENDPOINTS);process.stdout.write(JSON.stringify([...new Set(endpoints.map(networkGroupForEndpoint))]));
NODE
)
[[ "$(jq 'length' <<<"$groups")" == 3 ]]

evidence=$(jq -nc --arg run "$GITHUB_RUN_ID" --argjson groups "$groups" '{run_id:$run,ok:true,phase:"pre-isolation-observed",distinct_boot_ids:4,ordinary_network_groups:$groups,three_transport_families:true}')
printf '%s\n' "$evidence" >"${artifact_dir}/observer.json"
wan_post FAE_ECLIPSE_WAN_OBSERVER "$evidence"
