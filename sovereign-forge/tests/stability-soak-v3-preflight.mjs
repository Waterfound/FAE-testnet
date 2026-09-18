#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const V3_DURATION_HOURS=96;
export const V3_MIN_MARGIN_HOURS=12;
export const V3_TRANSIENT_BOUND_SECONDS=180;
export const V3_PHASE_HOURS=[24,24,24,24];

function bool(value){return value===true}
function nonempty(value){return typeof value==='string'&&value.trim().length>0}
function serviceRows(manifest){return [...(manifest.nodes||[]),manifest.controller,manifest.observer].filter(Boolean)}

export function evaluateStabilitySoakV3Preflight(manifest){
  const errors=[],warnings=[];
  if(manifest?.format!=='FAE_STABILITY_SOAK_V3_PREFLIGHT_V1')errors.push('format_invalid');
  if(!/^[0-9a-f]{40}$/.test(String(manifest?.software_commit||'')))errors.push('software_commit_not_frozen');
  if(manifest?.authority?.public_testnet_v4_unchanged!==true)errors.push('public_testnet_authority_not_preserved');
  if(manifest?.authority?.new_economy_activation===true)errors.push('new_economy_activation_forbidden');
  if(manifest?.authority?.candidate_promoted===true)errors.push('candidate_promotion_forbidden');
  if(manifest?.authority?.mainnet_authorized===true)errors.push('mainnet_authorization_forbidden');

  if(Number(manifest?.duration_hours)!==V3_DURATION_HOURS)errors.push('duration_must_equal_96h');
  if(Number(manifest?.margin_hours)<V3_MIN_MARGIN_HOURS)errors.push('margin_below_12h');
  if(Number(manifest?.max_transient_outage_seconds)!==V3_TRANSIENT_BOUND_SECONDS)errors.push('transient_bound_must_remain_180s');
  if(JSON.stringify(manifest?.phase_hours)!==JSON.stringify(V3_PHASE_HOURS))errors.push('phases_must_be_four_24h_windows');

  const nodes=Array.isArray(manifest?.nodes)?manifest.nodes:[];
  if(nodes.length!==3)errors.push('exactly_three_nodes_required');
  const nodeRegions=nodes.map(x=>x?.region).filter(nonempty);
  if(new Set(nodeRegions).size!==3)errors.push('three_distinct_node_regions_required');

  const services=serviceRows(manifest);
  const ids=services.map(x=>x?.service_id).filter(nonempty);
  if(ids.length!==5||new Set(ids).size!==5)errors.push('five_distinct_service_ids_required');

  for(const service of services){
    const role=service?.role||'unknown';
    if(!nonempty(service?.region))errors.push(`${role}:region_missing`);
    if(!nonempty(service?.plan))errors.push(`${role}:plan_missing`);
    if(String(service?.plan).toLowerCase()==='free')errors.push(`${role}:free_plan_not_admissible`);
    if(service?.suspended===true||service?.suspended==='suspended')errors.push(`${role}:service_suspended`);
    if(service?.auto_deploy!==false)errors.push(`${role}:auto_deploy_must_be_disabled`);
    if(Number(service?.continuous_capacity_hours)<V3_DURATION_HOURS+V3_MIN_MARGIN_HOURS)errors.push(`${role}:capacity_below_108h`);
    if(!nonempty(service?.provider))errors.push(`${role}:provider_missing`);
  }

  for(const node of nodes){
    const role=node?.role||'node';
    if(!bool(node?.persistent_state))errors.push(`${role}:persistent_state_required`);
    if(!bool(node?.persistent_identity))errors.push(`${role}:persistent_identity_required`);
    if(!bool(node?.persistent_peer_bootstrap))errors.push(`${role}:persistent_peer_bootstrap_required`);
  }

  if(!bool(manifest?.controller?.durable_evidence_sink))errors.push('controller:durable_evidence_sink_required');
  if(!bool(manifest?.observer?.independent_observer))errors.push('observer:independent_observer_required');

  const telemetry=manifest?.telemetry||{};
  for(const key of [
    'process_boot_id','process_started_at','provider_instance_id',
    'state_height','state_tip_hash','state_generation',
    'peer_directory_count','peer_directory_digest','configured_peer_count',
    'bootstrap_attempts','bootstrap_last_error','transport_reachability',
    'restart_classification','outage_start_end','recovery_duration_ms',
    'propagation_p95','stale_count','reorg_count'
  ]) if(!bool(telemetry[key])) errors.push(`telemetry_missing:${key}`);

  const stats=manifest?.statistics||{};
  if(stats?.wilson_one_sided_confidence!==0.95)errors.push('wilson_confidence_must_equal_0.95');
  if(stats?.stale_rate_threshold!==0.01)errors.push('stale_rate_threshold_must_equal_0.01');
  if(stats?.wilson_upper_threshold!==0.01)errors.push('wilson_upper_threshold_must_equal_0.01');
  if(!(Number(stats?.propagation_p95_max_ms)>0))errors.push('propagation_p95_threshold_missing');

  if(manifest?.run_started===true)errors.push('preflight_must_not_start_run');
  if(manifest?.infrastructure_evidence?.billing_or_quota_clear!==true)errors.push('billing_or_quota_clear_not_proven');
  if(manifest?.infrastructure_evidence?.no_known_96h_suspension_limit!==true)errors.push('96h_provider_continuity_not_proven');

  return {ok:errors.length===0,errors,warnings};
}

async function main(){
  const path=process.argv[2];
  if(!path)throw new Error('usage: node stability-soak-v3-preflight.mjs <manifest.json>');
  const manifest=JSON.parse(await readFile(path,'utf8'));
  const result=evaluateStabilitySoakV3Preflight(manifest);
  console.log(JSON.stringify({event:'FAE_STABILITY_SOAK_V3_PREFLIGHT',...result},null,2));
  if(!result.ok)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
