/** HPA-UC-001 W3: genuine FAE template header.network vs coordinator signer's network.
 * Shadow PPLNS activationHeight:1 is a test-only override; public-v4 remains inactive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate,validateBlockEnvelope,NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

const OTHER_NETWORK='unrelated-public-network';
function genuineWorkFixture({alter='none',legacyStatus=false}={}){
  const address=encodeAddress(Buffer.alloc(20,94),'faet');
  const state=emptyState();
  const sourceTemplate=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  const candidate=structuredClone(sourceTemplate);
  if(alter==='wrong')candidate.header.network=OTHER_NETWORK;
  if(alter==='absent')delete candidate.header.network;
  let templateCalls=0,statusCalls=0;
  const coordinator=new ShareCoordinator({
    networkId:NETWORK,multiOutputCoinbaseActive:true,
    statusProvider:async()=>{
      statusCalls++;
      return {...(legacyStatus?{}:{network:NETWORK}),
        tip_hash:sourceTemplate.header.previous_hash,
        height:Number(sourceTemplate.header.height)-1,
        difficulty_bits:sourceTemplate.header.difficulty_bits};
    },
    distributedTemplateProvider:async args=>{
      templateCalls++;
      assert.deepEqual(args.weights,[{address,weight:'1'}]);
      return candidate;
    },
    candidateHasher:async()=>''});
  return {state,coordinator,candidate,sourceTemplate,address,
    templateCalls:()=>templateCalls,statusCalls:()=>statusCalls};
}
test('HPA-W3-140: wrong-network real FAE template must not receive coordinator signed work',async()=>{
  const x=genuineWorkFixture({alter:'wrong'});
  assert.equal(x.candidate.header.previous_hash,x.sourceTemplate.header.previous_hash);
  assert.equal(x.candidate.header.height,x.sourceTemplate.header.height);
  assert.deepEqual(x.candidate.coinbase_outputs,x.sourceTemplate.coinbase_outputs);
  await assert.rejects(x.coordinator.createWork(x.address),
    e=>e.code==='candidate_pplns_template_network_mismatch');
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.templateCalls(),1);
  assert.equal(x.statusCalls(),0,'reject malformed template before remote status readback');
});
test('HPA-W3-141: missing network on real source template is not a legacy status omission',async()=>{
  const x=genuineWorkFixture({alter:'absent',legacyStatus:true});
  await assert.rejects(x.coordinator.createWork(x.address),
    e=>e.code==='candidate_pplns_template_network_mismatch');
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.templateCalls(),1);
});
test('HPA-W3-142: genuine unchanged template retains valid signed candidate job',async()=>{
  const x=genuineWorkFixture();
  const work=await x.coordinator.createWork(x.address);
  assert.equal(work.header.network,NETWORK);
  assert.equal(work.workProof.payload?.network??work.workProof.network??NETWORK,NETWORK);
  assert.ok(work.workProof && work.jobId);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(x.statusCalls(),1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
test('HPA-W3-143: legacy upstream may omit network but genuine header still must bind',async()=>{
  const x=genuineWorkFixture({legacyStatus:true});
  const work=await x.coordinator.createWork(x.address);
  assert.equal(work.header.network,NETWORK);
  assert.ok(work.workProof);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(x.statusCalls(),1);
});
test('HPA-W3-144: source consensus rejects wrong-network template independently of signed coordinator work',()=>{
  const x=genuineWorkFixture({alter:'wrong'});
  assert.throws(()=>validateBlockEnvelope(x.state,x.candidate.header,0,'0'.repeat(64),
    x.candidate.txids,{coinbaseOutputs:x.candidate.coinbase_outputs,activationHeight:1}),
    /malformed_submission/);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
