#!/usr/bin/env node
'use strict';

import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');
const authority=JSON.parse(await read('lab/block-explorer/authority.json'));
const model=JSON.parse(await read('lab/block-explorer/read-model-v1.json'));
const core=await read('sovereign-forge/node/authoritative/fae-v4-core.mjs');
const activation=await read('sovereign-forge/node/authoritative/pplns-activation.mjs');
const nodeSource=await read('sovereign-forge/node/fae-node.mjs');
const explorerSource=await read('sovereign-forge/node/explorer-read.mjs');
const explorerHtml=await read('explorer/index.html').catch(()=>null);
const explorerApp=await read('explorer/app.mjs').catch(()=>null);
const explorerClient=await read('explorer/api-client.mjs').catch(()=>null);
const explorerConfig=await read('explorer/config.json').then(JSON.parse).catch(()=>null);
const explorerBuild=await read('explorer/build.mjs').catch(()=>null);
const be05ProviderScan=await read('lab/block-explorer/be05-provider-scan.json').then(JSON.parse).catch(()=>null);
const be05Deployment=await read('lab/block-explorer/be05-node-deployment-v1.json').then(JSON.parse).catch(()=>null);
const be05Gateway=await read('lab/block-explorer/be05-readonly-gateway.mjs').catch(()=>null);
const be05Probe=await read('lab/block-explorer/be05-binding-probe.mjs').catch(()=>null);

function assert(condition,message){if(!condition)throw new Error(message)}

assert(authority.explorer_principle==='Explorer observes FAE; it never authorizes FAE.','Explorer principle changed');
for(const key of [
  'wallet_write_authorized','consensus_change_authorized','monetary_policy_change_authorized',
  'private_key_or_seed_access_authorized','transaction_signing_authorized',
  'transaction_submission_authorized','mining_authority_authorized','chain_selection_authority_authorized'
]) assert(authority[key]===false,key+' unexpectedly authorized');
if(authority.current_frontier==='BE-02'){
  const phase=authority.be02_authority?.state;
  assert(['AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN'].includes(phase),'BE-02 authority state mismatch');
  if(phase==='AUTHORIZED_BOUNDED'){
    assert(authority.node_query_surface_write_authorized===true,'BE-02 node query write must be explicit');
    assert(authority.current_stage_runtime_write_authorized===true,'BE-02 bounded runtime write must be explicit');
  }else{
    assert(authority.node_query_surface_write_authorized===false,'verified BE-02 query writes must be frozen');
    assert(authority.current_stage_runtime_write_authorized===false,'verified BE-02 runtime writes must be frozen');
  }
  assert(JSON.stringify(authority.be02_authority.explorer_methods)===JSON.stringify(['GET','OPTIONS']),'BE-02 method authority drift');
}else if(authority.current_frontier==='BE-03'){
  assert(authority.be03_authority?.state==='LAB_VERIFIED_FROZEN','BE-03 must be frozen before combined-main admission');
  assert(authority.be03_authority?.application_writes_frozen===true,'BE-03 frozen marker missing');
  assert(authority.explorer_application_write_authorized===false,'BE-03 application write authority must be closed');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-03 active-runtime authority drift');
  assert(authority.node_query_surface_write_authorized===false,'BE-03 node-query authority drift');
  assert(authority.explorer_application_live_authorized===false,'BE-03 LIVE authority drift');
  assert(authority.public_deployment_authorized===false,'BE-03 deployment authority drift');
}else if(authority.current_frontier==='BE-04'){
  const phase=authority.be04_authority?.state;
  assert(['AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN'].includes(phase),'BE-04 authority state mismatch');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-04 active-node authority drift');
  assert(authority.node_query_surface_write_authorized===false,'BE-04 node-query authority drift');
  assert(authority.explorer_application_live_authorized===false,'BE-04 LIVE authority drift');
  assert(authority.public_deployment_authorized===false,'BE-04 generic deployment authority drift');
  assert(authority.public_https_node_binding_authorized===false,'BE-04 cannot synthesize HTTPS node binding');
  assert(authority.independent_node_public_deployment_authorized===false,'BE-04 cannot deploy a persistent node');
  if(phase==='AUTHORIZED_BOUNDED'){
    assert(authority.explorer_application_write_authorized===true,'BE-04 bounded source write authority missing');
    assert(authority.public_frontend_prebind_deployment_authorized===true,'BE-04 public prebind authority missing');
  }else{
    assert(authority.explorer_application_write_authorized===false,'BE-04 frozen source writes must be closed');
    assert(authority.be04_authority?.source_writes_frozen===true,'BE-04 frozen marker missing');
  }
}else if(authority.current_frontier==='BE-05'){
  const phase=authority.be05_authority?.state;
  assert(['DISCOVERY_ONLY','AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN','EXTERNAL_BLOCKED_FROZEN'].includes(phase),'BE-05 authority state mismatch');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-05 active-node runtime authority drift');
  assert(authority.node_query_surface_write_authorized===false,'BE-05 node-query authority drift');
  assert(authority.explorer_application_live_authorized===false,'BE-05 LIVE authority drift');
  assert(authority.public_deployment_authorized===false,'BE-05 generic deployment authority drift');
  if(phase==='DISCOVERY_ONLY'){
    assert(authority.public_https_node_binding_authorized===false,'BE-05 discovery cannot bind');
    assert(authority.independent_node_public_deployment_authorized===false,'BE-05 discovery cannot deploy node');
    assert(authority.explorer_application_write_authorized===false,'BE-05 discovery cannot rewrite Explorer app');
    assert(authority.be05_authority?.deployment_forbidden_until_promoted===true,'BE-05 discovery lock missing');
  }
}else{
  assert(authority.node_query_surface_write_authorized===false,'BE-01 node query authority drift');
}

assert(model.active_network.network==='fairyelf-public-testnet-v4','wrong live network');
assert(model.active_network.target_seconds===180,'wrong live target');
assert(model.active_network.initial_subsidy_fae==='10','wrong live subsidy');
assert(model.active_network.halving_era_blocks===600000,'wrong live halving era');
assert(model.active_network.max_supply_fae==='12000000','wrong live supply ceiling');
assert(model.active_network.pplns_coinbase_active===false,'PPLNS incorrectly presented as live');

assert(core.includes("export const NETWORK='fairyelf-public-testnet-v4'"),'core network mismatch');
assert(core.includes('export const TARGET_SECONDS=180'),'core target mismatch');
assert(core.includes('export const INITIAL_SUBSIDY=10n*COIN'),'core subsidy mismatch');
assert(core.includes('export const HALVING_ERA_BLOCKS=600000'),'core halving mismatch');
assert(core.includes('export const MAX_SUPPLY=12000000n*COIN'),'core supply mismatch');
assert(activation.includes('PPLNS_COINBASE_ACTIVATION_HEIGHT=null'),'PPLNS activation state mismatch');

assert(model.transport.allowed_methods.every(x=>['GET','OPTIONS'].includes(x)),'mutating Explorer method authorized');
assert(authority.canonical_data_policy.raw_feed_is_authority===false,'raw feed became authority');
assert(authority.canonical_data_policy.explorer_cache_may_be_authority===false,'Explorer cache became authority');
assert(authority.canonical_data_policy.optional_indexer_state==='DERIVED_DISPOSABLE_ONLY','indexer semantics changed');
assert(model.entities.address.event_types.includes('transfer')&&model.entities.address.event_types.includes('reward'),'address event completeness lost');
const digestRule=model.universal_search.rules.find(x=>x.when.includes('64-character'));
assert(digestRule&&digestRule.resolve.includes('block_hash')&&digestRule.resolve.includes('txid'),'digest namespace ambiguity lost');

if(['BE-02','BE-03','BE-04','BE-05'].includes(authority.current_frontier)){
  assert(nodeSource.includes("const snapshot=cloneState(state)"),'Explorer reads must clone validated node state');
  assert(nodeSource.includes("cors('GET,OPTIONS')"),'Explorer CORS must remain read-only');
  assert(explorerSource.includes("if(method!=='GET')return{status:405,payload:{ok:false,error:'read_only'}}"),'Explorer mutation rejection missing');
  assert(explorerSource.includes("tip_changed_retry"),'tip-bound cursor fail-closed behavior missing');
  assert(explorerSource.includes("if(DIGEST.test(query))"),'digest namespace classification missing');
  assert(!explorerSource.includes('submit-tx'),'Explorer reader must not submit transactions');
  assert(!explorerSource.includes('submit-block'),'Explorer reader must not submit blocks');
}
if(['BE-03','BE-04','BE-05'].includes(authority.current_frontier)){
  assert(explorerHtml&&explorerApp&&explorerClient&&explorerConfig,'Explorer application source missing');
  assert(explorerConfig.schema==='FAE_EXPLORER_APP_CONFIG_V2','Explorer config schema drift');
  assert(explorerConfig.network===model.active_network.network&&explorerConfig.read_only===true,'Explorer app config authority drift');
  assert(explorerConfig.deployment_state==='NOT_LIVE','Explorer source config falsely claims LIVE');
  assert(explorerHtml.includes('Read-only'),'Explorer visible read-only identity missing');
  assert(explorerClient.includes("method:'GET'"),'Explorer GET-only client binding missing');
  const appSource=explorerHtml+'\n'+explorerApp+'\n'+explorerClient;
  for(const forbidden of ['/submit-tx','/submit-block',"method:'POST'",'privateKey','seedPhrase','startMining','innerHTML']){
    assert(!appSource.includes(forbidden),'Explorer forbidden capability leaked: '+forbidden);
  }
  if(authority.current_frontier==='BE-04'){
    assert(explorerBuild,'BE-04 build source missing');
    assert(explorerBuild.includes("LIVE cannot be synthesized"),'BE-04 LIVE refusal missing');
    assert(explorerBuild.includes("public node binding requires HTTPS"),'BE-04 HTTPS gate missing');
    assert(explorerApp.includes("binding_state==='UNBOUND'"),'BE-04 public prebind UI handling missing');
  }
  if(authority.current_frontier==='BE-05'){
    assert(be05ProviderScan&&be05Deployment&&be05Gateway&&be05Probe,'BE-05 artifacts missing');
    assert(be05ProviderScan.conclusion.eligible_existing_https_independent_node_found===false,'BE-05 existing-host evidence drift');
    assert(be05ProviderScan.conclusion.deployment_performed===false,'BE-05 discovery unexpectedly deployed infrastructure');
    assert(be05Deployment.node.private_bind.FAE_HOST==='127.0.0.1','BE-05 private-node topology drift');
    assert(JSON.stringify(be05Deployment.public_gateway.allowed_methods)===JSON.stringify(['GET','OPTIONS']),'BE-05 public gateway method drift');
    assert(be05Gateway.includes("node_origin_must_be_loopback"),'BE-05 loopback gateway protection missing');
    assert(be05Gateway.includes("public_route_not_found"),'BE-05 route allowlist protection missing');
    assert(be05Probe.includes("public_node_origin_requires_https"),'BE-05 public HTTPS gate missing');
    assert(be05Probe.includes("live_authority_granted:false"),'BE-05 probe cannot grant LIVE');
  }
}

console.log(JSON.stringify({ok:true,lab:'block-explorer',gate:'combined-main-contract'}));
