/** HPA-W3-160..163: source-bound signed distributed-work transaction claims.
 * Candidate-only: activationHeight:1 in genuine source fixture is NOT live activation.
 * Tests compare signer admission against FAE consensus checks, not PoW acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate,validateBlockEnvelope,NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

function fixture(alter='none'){
  const state=emptyState(),address=encodeAddress(Buffer.alloc(20,97),'faet');
  const genuine=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  const candidate=structuredClone(genuine);
  if(alter==='root')candidate.header.tx_root='0'.repeat(64);
  if(alter==='count')candidate.header.tx_count=1;
  if(alter==='empty_fee'){
    const subsidy=BigInt(candidate.header.reward_atoms);
    candidate.header.fee_atoms='1';
    candidate.coinbase_outputs=[{address,amount_atoms:(subsidy+1n).toString()}];
    candidate.payouts=structuredClone(candidate.coinbase_outputs);
    candidate.header.coinbase_root=hashHex(candidate.payouts);
    candidate.header.coinbase_count=1;
  }
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,networkId:NETWORK,
    statusProvider:async()=>({network:NETWORK,height:0,
      tip_hash:genuine.header.previous_hash,difficulty_bits:genuine.header.difficulty_bits}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async()=>''});
  return{state,address,candidate,genuine,coordinator};
}

for(const [id,alter,consensusError,coordinatorCode] of [
  ['HPA-W3-160','root','tx_commitment_mismatch','candidate_pplns_template_transaction_commitment_mismatch'],
  ['HPA-W3-161','count','tx_commitment_mismatch','candidate_pplns_template_transaction_commitment_mismatch'],
  ['HPA-W3-162','empty_fee','fee_commitment_mismatch','candidate_pplns_empty_template_fee_mismatch']
]){
  test(id+': genuine FAE consensus-invalid provider template must not be signed',async()=>{
    const x=fixture(alter);
    assert.deepEqual(x.candidate.txids,[]);
    assert.equal(x.candidate.header.network,NETWORK);
    assert.throws(()=>validateBlockEnvelope(x.state,x.candidate.header,0,'0'.repeat(64),
      x.candidate.txids,{coinbaseOutputs:x.candidate.coinbase_outputs,activationHeight:1}),
      new RegExp(consensusError));
    await assert.rejects(x.coordinator.createWork(x.address),e=>e.code===coordinatorCode);
    assert.equal(x.coordinator.jobs.size,0);
    assert.equal(x.coordinator.ledger.summary().totalShares,0);
    assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  });
}
test('HPA-W3-163: authentic unmodified source template still receives signed work',async()=>{
  const x=fixture();
  const work=await x.coordinator.createWork(x.address);
  assert.equal(work.header.tx_root,hashHex(work.txids));
  assert.equal(work.header.tx_count,work.txids.length);
  assert.equal(work.header.fee_atoms,'0');
  assert.ok(work.jobId&&work.workProof);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
