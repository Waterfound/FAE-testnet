import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const authority=await load('authority.json');
const model=await load('read-model-v1.json');

test('Explorer has no authorization or mutation authority',()=>{
  assert.equal(authority.explorer_principle,'Explorer observes FAE; it never authorizes FAE.');
  assert.equal(authority.transaction_signing_authorized,false);
  assert.equal(authority.transaction_submission_authorized,false);
  assert.equal(authority.chain_selection_authority_authorized,false);
  assert.deepEqual(model.transport.allowed_methods,['GET','OPTIONS']);
});

test('live network is separated from research candidate semantics',()=>{
  assert.equal(model.active_network.network,'fairyelf-public-testnet-v4');
  assert.equal(model.active_network.target_seconds,180);
  assert.equal(model.active_network.initial_subsidy_fae,'10');
  assert.equal(model.active_network.pplns_coinbase_active,false);
});

test('address activity includes transfers and mining rewards',()=>{
  assert.ok(model.entities.address.event_types.includes('transfer'));
  assert.ok(model.entities.address.event_types.includes('reward'));
  assert.match(model.entities.address.semantics.completeness,/must not silently equate/i);
});

test('64-hex universal search does not guess namespace',()=>{
  const rule=model.universal_search.rules.find(x=>x.when.includes('64-character'));
  assert.deepEqual(rule.resolve,['block_hash','txid']);
  assert.match(rule.ambiguity,/query both namespaces/i);
});

test('confirmations are selected-chain and tip bound',()=>{
  assert.match(model.response_binding.confirmations_formula,/observed_tip_height - confirmed_height \+ 1/);
  assert.match(model.response_binding.reorg_rule,/currently selected validated chain/i);
});

test('index/cache can never be canonical truth',()=>{
  assert.equal(authority.canonical_data_policy.explorer_cache_may_be_authority,false);
  assert.equal(authority.canonical_data_policy.optional_indexer_state,'DERIVED_DISPOSABLE_ONLY');
  assert.equal(authority.canonical_data_policy.corrupted_index_must_be_rebuildable_from_validated_state,true);
});
