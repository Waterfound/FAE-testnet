#!/usr/bin/env node
import {readFile} from 'node:fs/promises';

export function evaluateBe06HostEvidence(evidence){
  const reasons=[];
  const need=(condition,message)=>{if(!condition) reasons.push(message);};
  need(evidence && typeof evidence==='object','evidence must be an object');
  if(!evidence || typeof evidence!=='object') return {eligible:false,reasons};
  need(typeof evidence.provider==='string' && evidence.provider.length>0,'provider is required');
  need(evidence.account_scope_verified===true,'account/region scope is not verified');
  need(evidence.free_tier?.eligible===true,'selected resources are not proven free-tier eligible');
  need(evidence.free_tier?.monthly_cost_ceiling_usd===0,'monthly cost ceiling must be exactly 0 USD');
  need(evidence.free_tier?.paid_upgrade_required===false,'paid upgrade must not be required');
  need(evidence.free_tier?.overage_fail_closed===true,'billing/overage disposition is not fail-closed');
  need(evidence.host?.persistent_runtime===true,'persistent runtime is not proven');
  need(evidence.host?.durable_state===true,'durable node-owned state is not proven');
  need(evidence.host?.node_loopback===true,'Independent Node must bind to loopback/private interface');
  need(evidence.host?.gateway_loopback===true,'read-only gateway must bind to loopback/private interface');
  need(evidence.host?.public_https===true,'public HTTPS edge is not proven');
  need(evidence.host?.mutation_routes_public===false,'mutation/raw node routes must not be public');
  need(evidence.host?.protected_capacity_consumed===false,'protected FAE workstream capacity must not be consumed');
  need(evidence.host?.provider_risks_resolved===true,'provider-specific persistence/reclamation/egress risks are unresolved');
  need(Array.isArray(evidence.host?.public_ports) &&
    evidence.host.public_ports.every(p=>[80,443].includes(p)) &&
    evidence.host.public_ports.includes(443),
    'public ports must be limited to HTTPS and optional ACME/redirect port 80');
  return {eligible:reasons.length===0,reasons};
}

async function main(){
  const path=process.argv[2];
  if(!path){
    console.error('usage: node be06-host-preflight.mjs <evidence.json>');
    process.exit(2);
  }
  const evidence=JSON.parse(await readFile(path,'utf8'));
  const result=evaluateBe06HostEvidence(evidence);
  console.log(JSON.stringify(result,null,2));
  process.exit(result.eligible?0:3);
}

if(import.meta.url===`file://${process.argv[1]}`) main().catch(error=>{
  console.error(error?.stack||String(error));
  process.exit(2);
});
