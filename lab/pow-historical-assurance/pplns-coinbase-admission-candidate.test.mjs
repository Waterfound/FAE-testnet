/**
 * HPA-W3-70..75: real source PPLNS cap/primary admission regressions.
 * No activation of v4 consensus economics, never a claim of production payout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareLedger,ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {MAX_COINBASE_OUTPUTS,normalizeCoinbaseOutputs} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {allocateLargestRemainderCandidate} from './pplns-atom-remainder-candidate.mjs';
import {assessSourcePplnsCoinbaseAdmission as assess} from './pplns-coinbase-admission-candidate.mjs';

function populated(n){
  const ledger=new ShareLedger({windowSize:2048});
  const addresses=[];
  for(let i=0;i<n;i++){
    const bytes=Buffer.alloc(20);
    bytes.writeUInt16BE(i+1,18);
    const address=encodeAddress(bytes,'faet');
    addresses.push(address);
    ledger.append({
      jobId:'HPA-W3-70-'+i,address,nonce:i,hash:'0'.repeat(64),
      shareDifficultyBits:8,blockDifficultyBits:18,
      height:1,previousBlockHash:'0'.repeat(64)
    });
  }
  addresses.sort();
  return {ledger,addresses,weights:ledger.weights(addresses[0])};
}
function provider({weights}){
  return createDistributedTemplate(emptyState(),weights,{activationHeight:1});
}
test('HPA-W3-70: 257 source ShareLedger payees exhaust v4 256-output consensus template; no unsigned pool job admitted',async()=>{
  const {ledger,addresses,weights}=populated(MAX_COINBASE_OUTPUTS+1);
  assert.equal(ledger.summary().windowShares,257);
  assert.equal(weights.length,257);
  assert.throws(()=>provider({weights}),/invalid_payout_weights/);
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    distributedTemplateProvider:provider,
    candidateHasher:async()=>{throw new Error('not called')}
  });
  coordinator.ledger=ledger;
  await assert.rejects(coordinator.createWork(addresses[0]),/invalid_payout_weights/);
  assert.equal(coordinator.jobs.size,0);
  assert.equal(coordinator.ledger.summary().totalShares,257);
  const guard=assess({weights,totalRewardAtoms:'1000000000',
    declaredMinerAddress:weights[0].address});
  assert.equal(guard.verdict,'CONDITION_WAIT_UNSAFE_PPLNS_TEMPLATE');
  assert.equal(guard.reason,'source_window_exceeds_consensus_output_limit');
  assert.equal(guard.consensus_max_outputs,256);
  assert.equal(guard.safe_to_sign_job,false);
});
test('HPA-W3-71: at 256 distinct source payees, genuine active-height TEST template is structurally encodable and admitted by coordinator',async()=>{
  const {ledger,addresses,weights}=populated(MAX_COINBASE_OUTPUTS);
  const template=provider({weights});
  assert.equal(template.coinbase_outputs.length,256);
  assert.equal(template.header.miner_address,weights[0].address);
  const guard=assess({weights,totalRewardAtoms:template.header.reward_atoms,
    declaredMinerAddress:template.header.miner_address});
  assert.equal(guard.verdict,'STRUCTURAL_CANDIDATE_ONLY');
  assert.equal(guard.source_coinbase_structurally_encodable,true);
  assert.equal(guard.policy_activated,false);
  assert.equal(guard.safe_to_sign_job,false);
  assert.deepEqual(guard.expected_outputs,template.coinbase_outputs);
  assert.equal(guard.expected_coinbase_root,template.header.coinbase_root);
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    distributedTemplateProvider:provider,candidateHasher:async()=>''});
  coordinator.ledger=ledger;
  const work=await coordinator.createWork(addresses[0]);
  assert.equal(coordinator.jobs.size,1);
  assert.equal(work.header.coinbase_count,256);
});
test('HPA-W3-72: source zero-atom filter reassigns primary on hypothetical one/two-atom era and violates v4 primary identity',()=>{
  const {weights}=populated(3);
  for(const atoms of [1n,2n]){
    const outputs=allocatePplnsOutputs(atoms,weights);
    assert.equal(outputs.length,1);
    assert.notEqual(outputs[0].address,weights[0].address);
    assert.doesNotThrow(()=>normalizeCoinbaseOutputs(outputs,{
      validAddress:()=>true,maxOutputs:MAX_COINBASE_OUTPUTS}));
    const guard=assess({weights,totalRewardAtoms:atoms,
      declaredMinerAddress:weights[0].address});
    assert.equal(guard.reason,'zero_value_source_primary_filtered');
    assert.equal(guard.safe_to_sign_job,false);
    assert.equal(guard.source_primary,weights[0].address);
    assert.equal(guard.actual_primary,outputs[0].address);
  }
  // Pure future-reward projection: the current v4 node validates its own
  // height-dependent reward and cannot be tricked into a one-atom block here.
});
test('HPA-W3-73: small but sufficient subsidy remains structurally encodable; unsorted/forged primary fails admission',()=>{
  const {weights}=populated(3);
  const good=assess({weights,totalRewardAtoms:3n,declaredMinerAddress:weights[0].address});
  assert.equal(good.verdict,'STRUCTURAL_CANDIDATE_ONLY');
  assert.equal(good.expected_outputs.length,3);
  assert.equal(good.expected_outputs.reduce((a,x)=>a+BigInt(x.amount_atoms),0n),3n);
  assert.equal(assess({weights,totalRewardAtoms:3n,
    declaredMinerAddress:weights[2].address}).reason,'source_primary_address_mismatch');
  assert.equal(assess({weights:[...weights].reverse(),totalRewardAtoms:3n,
    declaredMinerAddress:weights[2].address}).reason,'invalid_or_unordered_source_weights');
});
test('HPA-W3-74: authoritative future subsidy eras 26-33 produce unpaid primary for 256 equally weighted payees, not active-v4 proof',()=>{
  const {weights}=populated(256);
  let reward=900000000n;
  const failed=[];
  for(let era=0;era<34;era++){
    const result=assess({weights,totalRewardAtoms:reward,
      declaredMinerAddress:weights[0].address});
    if(result.reason==='zero_value_source_primary_filtered')failed.push(era);
    if(era===25)assert.equal(reward,290n);
    if(era===26)assert.equal(reward,159n);
    if(era===33)assert.equal(reward,1n);
    reward=reward*55n/100n;
  }
  assert.deepEqual(failed,[26,27,28,29,30,31,32,33]);
});
test('HPA-W3-75: historical PoW-authentic known tips change public lottery winner; signer independence and feasible grinding NOT proved',()=>{
  const {weights}=populated(3);
  const winners=new Set(),tipIds=[];
  for(const block of legacyBlocks){
    assert.match(block.hash,/^[0-9a-f]{64}$/);
    tipIds.push(block.hash);
    const payout=allocateLargestRemainderCandidate(1n,weights,{tipHash:block.hash});
    assert.equal(payout.length,1);
    winners.add(payout[0].address);
    assert.equal(payout[0].amount_atoms,'1');
  }
  assert.ok(tipIds.length>=10);
  assert.ok(winners.size>=2,
    'different genuinely recorded PoW tips may select distinct recipients');
  // This is conditional sensitivity to historical *observed* tips;
  // it is NOT evidence an attacker could mine and choose those tips.
});
