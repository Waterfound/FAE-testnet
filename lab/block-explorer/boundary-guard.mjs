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

function assert(condition,message){if(!condition)throw new Error(message)}

assert(['BE-01','BE-02','BE-03'].includes(authority.current_frontier),'wrong frontier');
const be02=authority.current_frontier==='BE-02';
const be03=authority.current_frontier==='BE-03';
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

if(be03){
  assert(explorerHtml&&explorerApp&&explorerClient&&explorerConfig,'BE-03 application source incomplete');
  assert(explorerConfig.schema==='FAE_EXPLORER_APP_CONFIG_V1','BE-03 config schema mismatch');
  assert(explorerConfig.network===model.active_network.network,'BE-03 config network mismatch');
  assert(explorerConfig.read_only===true,'BE-03 config must be read-only');
  assert(explorerConfig.deployment_state==='NOT_LIVE','BE-03 must not claim LIVE deployment');
  assert(explorerClient.includes("method:'GET'"),'BE-03 client GET binding missing');
  const appSource=explorerHtml+'\n'+explorerApp+'\n'+explorerClient;
  for(const forbidden of ['/submit-tx','/submit-block',"method:'POST'",'privateKey','private_key','seedPhrase','seed_phrase','startMining']){
    assert(!appSource.includes(forbidden),'BE-03 forbidden capability leaked: '+forbidden);
  }
  for(const activeImport of ['core.js','wallet.js','wallet-crypto.js','mining.js','coordinator-trust.js']){
    assert(!explorerHtml.includes(activeImport),'BE-03 imported active site source: '+activeImport);
  }
  assert(!appSource.includes('innerHTML'),'BE-03 must render network data without innerHTML');
}

const forbidden=/\b(private[_ -]?key|seed[_ -]?phrase)\b/i;
assert(!forbidden.test(JSON.stringify(model)),'read model contains private secret material');

const diffBase=(be02||be03)?authority.frontier_source_revision:authority.source_revision;
const changed=execFileSync('git',['diff','--name-only',diffBase+'..HEAD'],{encoding:'utf8'})
  .trim().split(/\r?\n/).filter(Boolean);
if(be02||be03){
  const scopes=(be03?authority.be03_authority:authority.be02_authority)?.allowed_write_scopes||[];
  for(const path of changed){
    const allowed=scopes.some(scope=>scope.path===path||(scope.prefix&&path.startsWith(scope.prefix)));
    assert(allowed,'unauthorized '+authority.current_frontier+' path: '+path);
  }
}else{
  const allowed=authority.allowed_write_prefixes;
  for(const path of changed)assert(allowed.some(prefix=>path===prefix||path.startsWith(prefix)), 'unauthorized BE-01 path: '+path);
}

console.log(JSON.stringify({ok:true,frontier:authority.current_frontier,changed_paths:changed.length,network:model.active_network.network}));
