/** HPA-UC-001 candidate only: test FAE signed-work admission of invalid claimed block target.
 * No consensus activation, network protocol change, or economic policy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate,validateBlockEnvelope,NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

function sourceFixture({blockBits}={}){
  const address=encodeAddress(Buffer.alloc(20,95),'faet'),state=emptyState();
  const genuine=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  const candidate=structuredClone(genuine);
  if(blockBits!==undefined)candidate.header.difficulty_bits=blockBits;
  let providerCalls=0,statusCalls=0;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,networkId:NETWORK,
    statusProvider:async()=>{statusCalls++;return {network:NETWORK,
      height:0,tip_hash:genuine.header.previous_hash,difficulty_bits:genuine.header.difficulty_bits}},
    distributedTemplateProvider:async()=>{providerCalls++;return candidate},
    candidateHasher:async()=>''});
  return{state,candidate,genuine,coordinator,address,
    providerCalls:()=>providerCalls,statusCalls:()=>statusCalls};
}
const EXPECT='candidate_pplns_block_target_out_of_bounds';
for(const [id,bits] of [['HPA-W3-150',0],['HPA-W3-151',-1],['HPA-W3-152',257]]){
  test(id+': degenerate claimed block target must not receive valid signed source work',async()=>{
    const x=sourceFixture({blockBits:bits});
    assert.equal(x.candidate.header.network,NETWORK);
    assert.equal(x.candidate.header.previous_hash,x.genuine.header.previous_hash);
    assert.deepEqual(x.candidate.payouts,x.genuine.payouts);
    await assert.rejects(x.coordinator.createWork(x.address),e=>e.code===EXPECT);
    assert.equal(x.providerCalls(),1);
    assert.equal(x.coordinator.jobs.size,0,'do not publish a job for impossible target');
    assert.equal(x.coordinator.ledger.summary().totalShares,0);
  });
}
test('HPA-W3-153: authentic FAE source template remains signed and finite target intact',async()=>{
  const x=sourceFixture();
  const work=await x.coordinator.createWork(x.address);
  assert.equal(work.header.difficulty_bits,x.genuine.header.difficulty_bits);
  assert.ok(work.jobId && work.workProof);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(x.statusCalls(),1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
test('HPA-W3-154: actual FAE consensus independently rejects a 0-bit header',()=>{
  const x=sourceFixture({blockBits:0});
  assert.throws(()=>validateBlockEnvelope(x.state,x.candidate.header,0,'0'.repeat(64),
    x.candidate.txids,{coinbaseOutputs:x.candidate.coinbase_outputs,activationHeight:1}),
    /invalid_consensus_fields/);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
