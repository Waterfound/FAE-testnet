import assert from 'node:assert/strict';
import test from 'node:test';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {
  activatedHeaderRecord,
  activatedBlockRecord,
  validateDownloadedBodies
} from '../node/authoritative/full-target-headers-sync-candidate.mjs';

const policy=freezeActivationPolicy({activationHeight:12});
const descriptor=activationPolicyDescriptor(policy);
const historical=structuredClone(legacyBlocks);
const miner=encodeAddress(sha256(Buffer.from('historical-pf07-body-poisoning')).subarray(0,20),'faet');
const t12=historical.at(-1).timestamp_ms+6*60*60_000+180_000;
const mined=mineFullActivationCandidate(historical,policy,{minerAddress:miner,timestampMs:t12,maxNonce:5_000_000});
assert.equal(mined.verdict.ok,true);
const header=activatedHeaderRecord(mined.candidate);
const block=activatedBlockRecord(mined.candidate);

function valid(){
  const replay=validateDownloadedBodies(
    historical,
    [structuredClone(header)],
    [structuredClone(block)],
    policy,
    {remotePolicyDescriptor:descriptor,nowMs:t12}
  );
  assert.equal(replay.ok,true);
  assert.equal(replay.chain.at(-1).hash,mined.candidate.hash);
}

test('PF-07 valid activated body is accepted before and after hostile variants',()=>{
  valid();
});

test('PF-07 same header/hash with altered transaction body is rejected and does not poison later valid body',()=>{
  const mutant=structuredClone(block);
  mutant.txids=['a'.repeat(64)];
  assert.throws(
    ()=>validateDownloadedBodies(historical,[structuredClone(header)],[mutant],policy,{remotePolicyDescriptor:descriptor,nowMs:t12}),
    /tx_commitment|tx_count|invalid/
  );
  valid();
});

test('PF-07 body-side header mutation under unchanged advertised header/hash is rejected and later valid body remains admissible',()=>{
  const mutant=structuredClone(block);
  mutant.header_json={...mutant.header_json,tx_root:'b'.repeat(64)};
  assert.throws(
    ()=>validateDownloadedBodies(historical,[structuredClone(header)],[mutant],policy,{remotePolicyDescriptor:descriptor,nowMs:t12}),
    /downloaded_block_header_mismatch/
  );
  valid();
});

test('PF-07 altered body hash under unchanged header is rejected and later valid body remains admissible',()=>{
  const mutant=structuredClone(block);
  mutant.hash='c'.repeat(64);
  assert.throws(
    ()=>validateDownloadedBodies(historical,[structuredClone(header)],[mutant],policy,{remotePolicyDescriptor:descriptor,nowMs:t12}),
    /downloaded_block_header_mismatch/
  );
  valid();
});

test('PF-07 historical checkpoint body mutation is rejected without poisoning exact checkpoint replay',()=>{
  const h=structuredClone(historical[0]);
  const mutant=structuredClone(h);
  mutant.txids=['d'.repeat(64)];
  assert.throws(
    ()=>validateDownloadedBodies([], [h], [mutant], policy, {remotePolicyDescriptor:descriptor,enforceFutureDrift:false}),
    /invalid_historical_legacy_block/
  );
  const replay=validateDownloadedBodies([], [h], [structuredClone(h)], policy, {remotePolicyDescriptor:descriptor,enforceFutureDrift:false});
  assert.equal(replay.ok,true);
  assert.equal(replay.chain.length,1);
});

console.log(JSON.stringify({
  status:'PASS_IF_NODE_TESTS_COMPLETE',
  scope:'PF-07 full-target same-ID/different-body and rejection-poisoning regression',
  persistent_rejection_cache_observed:false,
  authority:'ASSURANCE_ONLY'
}));
