#!/usr/bin/env node
'use strict';

import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const root=new URL('../../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');
const authority=JSON.parse(await read('lab/block-explorer/authority.json'));
const model=JSON.parse(await read('lab/block-explorer/read-model-v1.json'));
const core=await read('sovereign-forge/node/authoritative/fae-v4-core.mjs');
const activation=await read('sovereign-forge/node/authoritative/pplns-activation.mjs');
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

assert(['BE-01','BE-02','BE-03','BE-04','BE-05'].includes(authority.current_frontier),'wrong frontier');
const be02=authority.current_frontier==='BE-02';
const be03=authority.current_frontier==='BE-03';
const be04=authority.current_frontier==='BE-04';
const be05=authority.current_frontier==='BE-05';
for(const key of [
  'wallet_write_authorized','consensus_change_authorized','monetary_policy_change_authorized',
  'private_key_or_seed_access_authorized','transaction_signing_authorized','transaction_submission_authorized',
  'mining_authority_authorized','chain_selection_authority_authorized'
]) assert(authority[key]===false,key+' must be false');
if(be02){
  const phase=authority.be02_authority?.state;
  assert(['AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN'].includes(phase),'BE-02 authority state mismatch');
  if(phase==='AUTHORIZED_BOUNDED'){
    assert(authority.current_stage_runtime_write_authorized===true,'BE-02 bounded runtime write must be explicit');
    assert(authority.node_query_surface_write_authorized===true,'BE-02 query-surface write must be explicit');
  }else{
    assert(authority.current_stage_runtime_write_authorized===false,'verified BE-02 runtime writes must be frozen');
    assert(authority.node_query_surface_write_authorized===false,'verified BE-02 query writes must be frozen');
    assert(authority.be02_authority?.runtime_writes_frozen===true,'BE-02 frozen marker missing');
  }
}else if(be03){
  const phase=authority.be03_authority?.state;
  assert(['AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN'].includes(phase),'BE-03 authority state mismatch');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-03 cannot authorize active runtime writes');
  assert(authority.node_query_surface_write_authorized===false,'BE-03 cannot rewrite node query surface');
  assert(authority.explorer_application_live_authorized===false,'BE-03 cannot authorize LIVE Explorer');
  assert(authority.public_deployment_authorized===false,'BE-03 cannot authorize public deployment');
  if(phase==='AUTHORIZED_BOUNDED')assert(authority.explorer_application_write_authorized===true,'BE-03 app-source write must be explicit');
  else{
    assert(authority.explorer_application_write_authorized===false,'verified BE-03 app writes must be frozen');
    assert(authority.be03_authority?.application_writes_frozen===true,'BE-03 frozen marker missing');
  }
}else if(be04){
  const phase=authority.be04_authority?.state;
  assert(['AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN'].includes(phase),'BE-04 authority state mismatch');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-04 cannot authorize active node runtime writes');
  assert(authority.node_query_surface_write_authorized===false,'BE-04 cannot rewrite node query surface');
  assert(authority.explorer_application_live_authorized===false,'BE-04 cannot synthesize LIVE Explorer');
  assert(authority.public_deployment_authorized===false,'BE-04 generic LIVE deployment authority must remain false');
  assert(authority.public_https_node_binding_authorized===false,'BE-04 HTTPS node binding requires external evidence');
  assert(authority.independent_node_public_deployment_authorized===false,'BE-04 cannot spend node-hosting budget');
  if(phase==='AUTHORIZED_BOUNDED'){
    assert(authority.explorer_application_write_authorized===true,'BE-04 app/deploy-source write must be explicit');
    assert(authority.public_frontend_prebind_deployment_authorized===true,'BE-04 prebind frontend deployment must be explicit');
  }else{
    assert(authority.explorer_application_write_authorized===false,'verified BE-04 source writes must be frozen');
    assert(authority.be04_authority?.source_writes_frozen===true,'BE-04 frozen marker missing');
  }
}else if(be05){
  const phase=authority.be05_authority?.state;
  assert(['DISCOVERY_ONLY','AUTHORIZED_BOUNDED','LAB_VERIFIED_FROZEN','EXTERNAL_BLOCKED_FROZEN'].includes(phase),'BE-05 authority state mismatch');
  assert(authority.current_stage_runtime_write_authorized===false,'BE-05 cannot rewrite active node runtime');
  assert(authority.node_query_surface_write_authorized===false,'BE-05 cannot rewrite verified node query surface');
  assert(authority.explorer_application_live_authorized===false,'BE-05 cannot synthesize LIVE');
  assert(authority.public_deployment_authorized===false,'BE-05 cannot synthesize generic deployment authority');
  if(phase==='DISCOVERY_ONLY'){
    assert(authority.independent_node_public_deployment_authorized===false,'BE-05 discovery cannot deploy a node');
    assert(authority.public_https_node_binding_authorized===false,'BE-05 discovery cannot bind a node');
    assert(authority.explorer_application_write_authorized===false,'BE-05 discovery cannot rewrite Explorer app');
    assert(authority.be05_authority?.deployment_forbidden_until_promoted===true,'BE-05 discovery deployment lock missing');
  }
}else{
  assert(authority.current_stage_runtime_write_authorized===false,'BE-01 runtime write must be false');
  assert(authority.node_query_surface_write_authorized===false,'BE-01 node query write must be false');
}

assert(model.active_network.network==='fairyelf-public-testnet-v4','wrong network');
assert(model.active_network.target_seconds===180,'wrong active target');
assert(model.active_network.initial_subsidy_fae==='10','wrong active subsidy');
assert(model.active_network.halving_era_blocks===600000,'wrong active halving era');
assert(model.active_network.max_supply_fae==='12000000','wrong active max supply');
assert(model.active_network.pplns_coinbase_active===false,'PPLNS must not be presented as live');

assert(core.includes("export const NETWORK='fairyelf-public-testnet-v4'"),'core network mismatch');
assert(core.includes('export const INITIAL_SUBSIDY=10n*COIN'),'core subsidy mismatch');
assert(core.includes('export const HALVING_ERA_BLOCKS=600000'),'core halving mismatch');
assert(core.includes('export const MAX_SUPPLY=12000000n*COIN'),'core supply mismatch');
assert(core.includes('export const TARGET_SECONDS=180'),'core target mismatch');
assert(activation.includes('PPLNS_COINBASE_ACTIVATION_HEIGHT=null'),'PPLNS activation state mismatch');

assert(model.transport.allowed_methods.every(x=>['GET','OPTIONS'].includes(x)),'write method authorized');
assert(model.transport.mutating_methods_forbidden.includes('POST'),'POST must be forbidden');
assert(model.entities.address.event_types.includes('reward'),'address reward events missing');
assert(model.entities.address.event_types.includes('transfer'),'address transfer events missing');
const digestRule=model.universal_search.rules.find(x=>x.when.includes('64-character'));
assert(digestRule&&digestRule.resolve.includes('block_hash')&&digestRule.resolve.includes('txid'),'digest ambiguity missing');
assert(authority.canonical_data_policy.optional_indexer_state==='DERIVED_DISPOSABLE_ONLY','indexer authority mismatch');

if(be03||be04||be05){
  assert(explorerHtml&&explorerApp&&explorerClient&&explorerConfig,'Explorer application source incomplete');
  assert(explorerConfig.schema==='FAE_EXPLORER_APP_CONFIG_V2','Explorer config schema mismatch');
  assert(explorerConfig.network===model.active_network.network,'Explorer config network mismatch');
  assert(explorerConfig.read_only===true,'Explorer config must be read-only');
  assert(explorerConfig.deployment_state==='NOT_LIVE','Explorer source config must not claim LIVE deployment');
  assert(explorerClient.includes("method:'GET'"),'Explorer client GET binding missing');
  const appSource=explorerHtml+'\n'+explorerApp+'\n'+explorerClient;
  for(const forbidden of ['/submit-tx','/submit-block',"method:'POST'",'privateKey','private_key','seedPhrase','seed_phrase','startMining']){
    assert(!appSource.includes(forbidden),'Explorer forbidden capability leaked: '+forbidden);
  }
  for(const activeImport of ['core.js','wallet.js','wallet-crypto.js','mining.js','coordinator-trust.js']){
    assert(!explorerHtml.includes(activeImport),'Explorer imported active site source: '+activeImport);
  }
  assert(!appSource.includes('innerHTML'),'Explorer must render network data without innerHTML');
  if(be04){
    assert(explorerBuild,'BE-04 build artifact source missing');
    assert(explorerBuild.includes("LIVE cannot be synthesized"),'BE-04 LIVE refusal missing');
    assert(explorerBuild.includes("public node binding requires HTTPS"),'BE-04 HTTPS binding gate missing');
    assert(explorerBuild.includes("bindingState==='UNBOUND'"),'BE-04 explicit UNBOUND artifact path missing');
    assert(explorerApp.includes("binding_state==='UNBOUND'"),'BE-04 UI UNBOUND handling missing');
  }
  if(be05){
    assert(be05ProviderScan&&be05Deployment&&be05Gateway&&be05Probe,'BE-05 discovery/deployment artifacts incomplete');
    assert(be05ProviderScan.conclusion.eligible_existing_https_independent_node_found===false,'BE-05 invented an existing eligible host');
    assert(be05ProviderScan.conclusion.deployment_performed===false,'BE-05 discovery performed deployment');
    assert(be05Deployment.node.private_bind.FAE_HOST==='127.0.0.1','BE-05 node must remain private-loopback');
    assert(JSON.stringify(be05Deployment.public_gateway.allowed_methods)===JSON.stringify(['GET','OPTIONS']),'BE-05 gateway method authority drift');
    assert(be05Gateway.includes("public_route_not_found"),'BE-05 public route allowlist rejection missing');
    assert(be05Gateway.includes("node_origin_must_be_loopback"),'BE-05 loopback isolation missing');
    assert(be05Probe.includes("public_node_origin_requires_https"),'BE-05 HTTPS probe requirement missing');
    assert(be05Probe.includes("live_authority_granted:false"),'BE-05 probe must not grant LIVE authority');
  }
}

const forbidden=/\b(private[_ -]?key|seed[_ -]?phrase)\b/i;
assert(!forbidden.test(JSON.stringify(model)),'read model contains private secret material');

const diffBase=(be02||be03||be04||be05)?authority.frontier_source_revision:authority.source_revision;
const changed=execFileSync('git',['diff','--name-only',diffBase+'..HEAD'],{encoding:'utf8'})
  .trim().split(/\r?\n/).filter(Boolean);
if(be02||be03||be04||be05){
  const frontierAuthority=be05?authority.be05_authority:(be04?authority.be04_authority:(be03?authority.be03_authority:authority.be02_authority));
  const scopes=frontierAuthority?.allowed_write_scopes||[];
  for(const path of changed){
    const allowed=scopes.some(scope=>scope.path===path||(scope.prefix&&path.startsWith(scope.prefix)));
    assert(allowed,'unauthorized '+authority.current_frontier+' path: '+path);
  }
}else{
  const allowed=authority.allowed_write_prefixes;
  for(const path of changed)assert(allowed.some(prefix=>path===prefix||path.startsWith(prefix)), 'unauthorized BE-01 path: '+path);
}

console.log(JSON.stringify({ok:true,frontier:authority.current_frontier,changed_paths:changed.length,network:model.active_network.network}));
