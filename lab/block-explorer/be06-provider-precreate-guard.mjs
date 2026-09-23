#!/usr/bin/env node
'use strict';

import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const GOOGLE_FREE_REGIONS=Object.freeze(['us-west1','us-central1','us-east1']);
export const ORACLE_FREE_SHAPES=Object.freeze(['VM.Standard.A1.Flex','VM.Standard.E2.1.Micro']);

function bool(value){return value===true}
function zero(value){return typeof value==='number' && Number.isFinite(value) && Object.is(value,0)}
function finiteNonNegative(value){return typeof value==='number' && Number.isFinite(value) && value>=0}
function finitePositive(value){return typeof value==='number' && Number.isFinite(value) && value>0}

function commonReasons(e){
  const reasons=[];
  const need=(ok,msg)=>{if(!ok) reasons.push(msg)};
  need(e&&typeof e==='object','evidence must be an object');
  if(!e||typeof e!=='object') return reasons;
  need(bool(e.account_scope_verified),'account scope is not verified');
  need(bool(e.selected_resources_explicitly_free_eligible),'selected resources are not explicitly free eligible');
  need(zero(e.monthly_cost_ceiling_usd),'monthly cost ceiling must be exactly 0 USD');
  need(e.paid_upgrade_required===false,'paid upgrade must not be required');
  need(e.paid_addons_present===false,'paid add-ons must be absent');
  need(e.protected_capacity_consumed===false,'protected FAE capacity must not be consumed');
  return reasons;
}

function oracleReasons(e){
  const reasons=[];
  const need=(ok,msg)=>{if(!ok) reasons.push(msg)};
  const o=e.oracle_cloud||{};
  need(ORACLE_FREE_SHAPES.includes(o.shape),'Oracle shape is not admitted');
  need(bool(o.home_region_verified),'Oracle home region is not verified');
  need(bool(o.always_free_compute_label_observed),'Oracle Always Free compute label not observed');
  need(bool(o.within_remaining_compute_entitlement),'Oracle remaining compute entitlement not verified');
  need(bool(o.boot_and_durable_storage_within_free_entitlement),'Oracle storage is not proven inside free entitlement');
  need(bool(o.selected_image_price_free),'Oracle selected image is not proven free');
  need(bool(o.public_network_zero_cost_verified),'Oracle public networking is not proven zero-cost');
  need(o.public_ipv4_at_launch===false,'Oracle launch review must explicitly record public IPv4 disabled for the staged exposure plan');
  need(bool(o.post_create_reserved_public_ipv4_required),'post-create reserved public IPv4 assignment must remain mandatory');
  need(bool(o.reserved_public_ipv4_available),'reserved public IPv4 availability is not proven');
  need(bool(o.public_ipv4_no_charge_verified),'Oracle public IPv4 zero-charge evidence is missing');
  need(bool(o.ingress_hardening_before_public_ipv4_required),'ingress hardening must precede public IPv4 assignment');
  need(bool(o.world_open_tcp_22_forbidden),'world-open TCP/22 must remain forbidden');
  need(bool(o.admin_path_without_ssh_key_verified),'non-SSH-key administration path is not verified');
  need(bool(o.runtime_architecture_compatible),'runtime architecture compatibility is not proven');
  need(bool(o.shape_selectable_in_home_region),'Oracle Always Free shape is not selectable in the home region');
  need(bool(o.estimator_excludes_tier_unit_pricing),'Oracle estimator disclaimer excluding tier unit pricing was not observed');
  need(zero(o.entitlement_calculated_monthly_cost_usd),'Oracle entitlement-calculated monthly cost must be exactly 0 USD');
  need(o.trial_credit_reliance===false,'Oracle candidate must not rely on promotional trial credit');
  need(finiteNonNegative(o.raw_estimated_monthly_cost_brl),'Oracle raw estimator list price must be recorded');
  need(finitePositive(o.boot_volume_gb),'Oracle boot volume size must be recorded');
  need(finiteNonNegative(o.free_block_volume_available_gb),'Oracle remaining free block volume must be recorded');
  if(finitePositive(o.boot_volume_gb)&&finiteNonNegative(o.free_block_volume_available_gb)){
    need(o.boot_volume_gb<=o.free_block_volume_available_gb,'Oracle boot volume exceeds remaining Always Free Block Volume entitlement');
  }
  need(o.synthetic_reclaim_evasion===false,'synthetic reclaim evasion must be explicitly false');
  need(bool(o.post_create_reclaim_observation_required),'post-create reclaim observation must remain mandatory');
  need(bool(o.physical_capacity_must_be_rechecked_at_launch),'launch-time physical-capacity gate must remain mandatory');
  return reasons;
}

function googleReasons(e){
  const reasons=[];
  const need=(ok,msg)=>{if(!ok) reasons.push(msg)};
  const g=e.google_cloud||{};
  need(zero(e.estimated_monthly_cost_usd),'Google estimated monthly cost must be exactly 0 USD');
  need(bool(e.provider_console_cost_preview_verified_zero),'Google provider console cost preview is not verified at 0 USD');
  need(g.machine_type==='e2-micro','Google machine type must be e2-micro');
  need(GOOGLE_FREE_REGIONS.includes(g.region),'Google region is not Free Tier eligible');
  need(g.non_preemptible===true,'Google VM must be non-preemptible');
  need(Number.isInteger(g.pd_standard_gb)&&g.pd_standard_gb>0&&g.pd_standard_gb<=30,'Google pd-standard must be 1..30 GB');
  need(g.external_ipv4===false,'Google external IPv4 is forbidden under the 0 USD BE-06 ceiling');
  need(g.external_ipv6===true,'Google zero-cost candidate requires external IPv6');
  need(g.public_https_ipv6_path_planned===true,'Google IPv6 public HTTPS path is not planned');
  need(g.free_tier_usage_remaining_verified===true,'Google remaining Free Tier usage is not verified');
  need(g.runtime_architecture_compatible===true,'runtime architecture compatibility is not proven');
  need(g.egress_fail_closed===true,'Google egress is not fail-closed');
  return reasons;
}

export function evaluateBe06PrecreateEvidence(evidence){
  const reasons=commonReasons(evidence);
  const provider=evidence?.provider;
  if(provider==='oracle_cloud') reasons.push(...oracleReasons(evidence));
  else if(provider==='google_cloud') reasons.push(...googleReasons(evidence));
  else reasons.push('provider must be oracle_cloud or google_cloud');

  const admitted=reasons.length===0;
  return {
    admitted,
    provider:typeof provider==='string'?provider:null,
    reasons,
    safe_to_request_host_creation_authority:admitted,
    resource_creation_authorized:false,
    spend_authorized:false,
    persistent_host_eligible:false,
    explorer_binding_authorized:false,
    explorer_live_authorized:false
  };
}

async function main(){
  const path=process.argv[2];
  if(!path){
    console.error('usage: node be06-provider-precreate-guard.mjs <evidence.json>');
    process.exit(2);
  }
  const evidence=JSON.parse(await readFile(path,'utf8'));
  const result=evaluateBe06PrecreateEvidence(evidence);
  console.log(JSON.stringify(result,null,2));
  process.exit(result.admitted?0:3);
}

const invoked=process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
if(invoked) main().catch(error=>{console.error(error?.stack||String(error));process.exit(2)});
