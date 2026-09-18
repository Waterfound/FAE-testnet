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

function assert(condition,message){if(!condition)throw new Error(message)}

assert(authority.explorer_principle==='Explorer observes FAE; it never authorizes FAE.','Explorer principle changed');
for(const key of [
  'wallet_write_authorized','consensus_change_authorized','monetary_policy_change_authorized',
  'private_key_or_seed_access_authorized','transaction_signing_authorized',
  'transaction_submission_authorized','mining_authority_authorized','chain_selection_authority_authorized'
]) assert(authority[key]===false,key+' unexpectedly authorized');
if(authority.current_frontier==='BE-02'){
  assert(authority.node_query_surface_write_authorized===true,'BE-02 node query write must be explicit');
  assert(authority.current_stage_runtime_write_authorized===true,'BE-02 bounded runtime write must be explicit');
  assert(authority.be02_authority?.state==='AUTHORIZED_BOUNDED','BE-02 authority state mismatch');
  assert(JSON.stringify(authority.be02_authority.explorer_methods)===JSON.stringify(['GET','OPTIONS']),'BE-02 method authority drift');
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

if(authority.current_frontier==='BE-02'){
  assert(nodeSource.includes("const snapshot=cloneState(state)"),'Explorer reads must clone validated node state');
  assert(nodeSource.includes("cors('GET,OPTIONS')"),'Explorer CORS must remain read-only');
  assert(explorerSource.includes("if(method!=='GET')return{status:405,payload:{ok:false,error:'read_only'}}"),'Explorer mutation rejection missing');
  assert(explorerSource.includes("tip_changed_retry"),'tip-bound cursor fail-closed behavior missing');
  assert(explorerSource.includes("if(DIGEST.test(query))"),'digest namespace classification missing');
  assert(!explorerSource.includes('submit-tx'),'Explorer reader must not submit transactions');
  assert(!explorerSource.includes('submit-block'),'Explorer reader must not submit blocks');
}

console.log(JSON.stringify({ok:true,lab:'block-explorer',gate:'combined-main-contract'}));
