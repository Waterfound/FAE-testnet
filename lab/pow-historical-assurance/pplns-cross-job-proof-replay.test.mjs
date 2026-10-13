/**
 * HPA-W3-130..132: reject cross-job reuse of identical work as PPLNS shares.
 * Genuine FAE ShareCoordinator + ShareLedger, explicit inactive v4 shadow only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShareCoordinator,ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';

const NETWORK='fairyelf-public-testnet-v4';
function fixture(){
  const address=encodeAddress(Buffer.alloc(20,88),'faet');
  const state=emptyState();
  const template=createDistributedTemplate(state,[{address,weight:1n}],{activationHeight:1});
  const bits=Math.max(4,Number(template.header.difficulty_bits)-6);
  const proofs=[];
  for(let nonce=0;nonce<300_000 && proofs.length<2;nonce++){
    const hash=hashHex({...template.header,nonce});
    const zeros=leadingZeroBits(hash);
    if(zeros>=bits&&zeros<Number(template.header.difficulty_bits))proofs.push({nonce,hash});
  }
  assert.equal(proofs.length,2,'bounded genuine non-full-target proofs');
  const coordinator=new ShareCoordinator({
    networkId:NETWORK,multiOutputCoinbaseActive:true,candidateTipRecheck:true,
    statusProvider:async()=>({
      network:NETWORK,height:Number(template.header.height)-1,
      tip_hash:template.header.previous_hash,difficulty_bits:template.header.difficulty_bits
    }),
    distributedTemplateProvider:async()=>template,
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce})
  });
  return{address,coordinator,template,proofs};
}

test('HPA-W3-130: two individually signed jobs must not double-credit identical real PoW proof',async()=>{
  const x=fixture();
  const first=await x.coordinator.createWork(x.address);
  const second=await x.coordinator.createWork(x.address);
  assert.notEqual(first.jobId,second.jobId);
  assert.deepEqual(first.header,second.header,'jobs represent identical computational work');
  const proof=x.proofs[0];
  assert.equal((await x.coordinator.submitShare({jobId:first.jobId,...proof})).accepted,true);
  await assert.rejects(
    x.coordinator.submitShare({jobId:second.jobId,...proof}),
    error=>error.code==='candidate_duplicate_share_pow'
  );
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});

test('HPA-W3-131: persisted ledger must refuse cross-job repeated proof and preserve one credit across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fae-hpa-replay-'));
  const logFile=join(dir,'shares.jsonl');
  try{
    const ledger=new ShareLedger({logFile,windowSize:10});
    const base={address:encodeAddress(Buffer.alloc(20,88),'faet'),nonce:7,
      hash:'a'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:16,
      height:1,previousBlockHash:'0'.repeat(64)};
    ledger.append({...base,jobId:'job-A',rejectRepeatedProof:true});
    assert.throws(()=>ledger.append({...base,jobId:'job-B',rejectRepeatedProof:true}),
      error=>error.code==='candidate_duplicate_share_pow');
    assert.equal(ledger.summary().totalShares,1);
    const recovered=new ShareLedger({logFile,windowSize:10});
    assert.equal(recovered.summary().totalShares,1);
    assert.throws(()=>recovered.append({...base,jobId:'job-C',rejectRepeatedProof:true}),
      error=>error.code==='candidate_duplicate_share_pow');
  }finally{rmSync(dir,{force:true,recursive:true})}
});

test('HPA-W3-132: distinct genuine PoW proofs under the same job retain two legitimate credits',async()=>{
  const x=fixture();
  const work=await x.coordinator.createWork(x.address);
  for(const proof of x.proofs){
    assert.equal((await x.coordinator.submitShare({jobId:work.jobId,...proof})).accepted,true);
  }
  assert.notEqual(x.proofs[0].hash,x.proofs[1].hash);
  assert.equal(x.coordinator.ledger.summary().totalShares,2);
});
