/** HPA-UC-001 W3: real-source network binding at share submission.
 * Candidate-only, shadow PPLNS activationHeight:1; no live policy changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const OTHER_NETWORK='unrelated-public-network';

function sourceShareFixture({changeDuringHash=false,legacyStatus=false}={}){
  const address=encodeAddress(Buffer.alloc(20,93),'faet');
  const state=emptyState();
  const candidate=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  let network=NETWORK,hashCalls=0,statusReads=0;
  const coordinator=new ShareCoordinator({
    networkId:NETWORK,multiOutputCoinbaseActive:true,candidateTipRecheck:true,
    statusProvider:async()=>{
      statusReads++;
      return {...(!legacyStatus?{network}:{}),
        height:Number(candidate.header.height)-1,
        tip_hash:candidate.header.previous_hash,
        difficulty_bits:candidate.header.difficulty_bits};
    },
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>{
      hashCalls++;
      if(changeDuringHash)network=OTHER_NETWORK;
      return hashHex({...c.header,nonce});
    }
  });
  const shareBits=Math.max(4,Number(candidate.header.difficulty_bits)-6);
  let nonce=-1,hash='';
  for(let i=0;i<250_000;i++){
    const trial=hashHex({...candidate.header,nonce:i});
    const bits=leadingZeroBits(trial);
    if(bits>=shareBits&&bits<Number(candidate.header.difficulty_bits)){
      nonce=i;hash=trial;break;
    }
  }
  assert.ok(nonce>=0,'bounded real-source non-full-target proof found');
  return {address,coordinator,candidate,nonce,hash,
    changeNetwork:()=>{network=OTHER_NETWORK},
    statusReads:()=>statusReads,hashCalls:()=>hashCalls};
}

test('HPA-W3-123: mismatched explicit upstream network at share admission must not credit ledger',async()=>{
  const x=sourceShareFixture();
  const work=await x.coordinator.createWork(x.address);
  x.changeNetwork();
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_pplns_share_network_mismatch');
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.coordinator.jobs.has(work.jobId),false);
  assert.equal(x.hashCalls(),0,'refuse before expensive hashing');
});

test('HPA-W3-124: network changes during asynchronous genuine hashing; opt-in recheck must prevent share credit',async()=>{
  const x=sourceShareFixture({changeDuringHash:true});
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_pplns_share_network_mismatch');
  assert.equal(x.hashCalls(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.coordinator.jobs.has(work.jobId),false);
});

test('HPA-W3-125: real-source valid network and tip admit a non-full-target share once',async()=>{
  const x=sourceShareFixture();
  const work=await x.coordinator.createWork(x.address);
  const result=await x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash});
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.hashCalls(),1);
  assert.ok(x.statusReads()>=3,'pre-sign, pre-hash and opt-in post-hash readbacks');
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null,'real v4 PPLNS remains inactive');
});

test('HPA-W3-126: legacy upstream without explicit network retains bounded compatibility',async()=>{
  const x=sourceShareFixture({legacyStatus:true});
  const work=await x.coordinator.createWork(x.address);
  const result=await x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash});
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
