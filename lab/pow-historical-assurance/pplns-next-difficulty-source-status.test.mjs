/** HPA W3 candidate — real FAE nextDifficulty / signed-work status binding.
 * This is SOURCE validation only, not consensus activation or a network attack.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate,nextDifficulty,NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

function sourceFixture({changeClaim=false,omitDifficulty=false}={}){
  const address=encodeAddress(Buffer.alloc(20,96),'faet'),state=emptyState();
  const genuine=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  assert.equal(genuine.header.difficulty_bits,nextDifficulty(state.chain));
  const candidate=structuredClone(genuine);
  if(changeClaim)candidate.header.difficulty_bits=genuine.header.difficulty_bits+1;
  let statusCalls=0;
  const coordinator=new ShareCoordinator({
    networkId:NETWORK,multiOutputCoinbaseActive:true,
    statusProvider:async()=>{
      statusCalls++;
      return {network:NETWORK,height:0,tip_hash:genuine.header.previous_hash,
        ...(!omitDifficulty?{difficulty_bits:nextDifficulty(state.chain)}:{})};
    },
    distributedTemplateProvider:async()=>candidate,candidateHasher:async()=>''});
  return {address,coordinator,genuine,candidate,statusCalls:()=>statusCalls};
}

test('HPA-W3-160: in-range wrong next difficulty must not receive signed work',async()=>{
  const x=sourceFixture({changeClaim:true});
  assert.ok(x.candidate.header.difficulty_bits>=4&&x.candidate.header.difficulty_bits<=256);
  assert.equal(x.genuine.header.previous_hash,x.candidate.header.previous_hash);
  await assert.rejects(x.coordinator.createWork(x.address),
    e=>e.code==='candidate_pplns_next_difficulty_mismatch');
  assert.equal(x.statusCalls(),1);
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
});

test('HPA-W3-161: matching authentic source next difficulty admits signed work',async()=>{
  const x=sourceFixture();
  const work=await x.coordinator.createWork(x.address);
  assert.ok(work.jobId&&work.workProof);
  assert.equal(work.blockDifficultyBits,x.genuine.header.difficulty_bits);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});

test('HPA-W3-162: status without difficulty remains explicitly legacy/unverified',async()=>{
  const x=sourceFixture({omitDifficulty:true});
  const work=await x.coordinator.createWork(x.address);
  assert.ok(work.jobId&&work.workProof);
  // This compatibility fixture does NOT establish an independently bound next target.
  assert.equal(x.statusCalls(),1);
});
