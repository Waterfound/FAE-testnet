/** HPA-UC-001 W3: source-owned guard and exact ShareLedger BWH counterexample. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,activationConfigured,isPplnsCoinbaseActive} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {ShareLedger,ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessCurrentPplnsAdmission,requireFreshStrategicAuthority} from './pplns-strategic-risk-guard.mjs';
const honest='honest',infiltrator='infiltrator';
function share(log,address,i){
  return log.append({jobId:'job-'+i,address,nonce:i,hash:'0'.repeat(64),
    shareDifficultyBits:12,blockDifficultyBits:18,height:1,previousBlockHash:'0'.repeat(64)});
}
test('HPA-W3-01: frozen PPLNS activation is absent, not economic proof',()=>{
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  assert.equal(activationConfigured(),false);
  assert.equal(isPplnsCoinbaseActive(1),false);
  assert.equal(isPplnsCoinbaseActive(Number.MAX_SAFE_INTEGER),false);
  const result=assessCurrentPplnsAdmission();
  assert.equal(result.mainnet_bwh_faw_economic_proof,false);
  assert.equal(result.active_pool_consensus,false);
});
test('HPA-W3-02: direct mining unaffected by inactive PPLNS candidate',async()=>{
  const coordinator=new ShareCoordinator();
  const valid=encodeAddress(Buffer.alloc(20,7),'faet');
  await assert.rejects(coordinator.createWork(valid),/PPLNS multi-output coinbase activation required/);
  assert.equal(coordinator.jobs.size,0);
  assert.equal(coordinator.multiOutputCoinbaseActive,false);
});
test('HPA-W3-03: a proposed activation height fails closed until strategic authority exists',()=>{
  assert.throws(()=>requireFreshStrategicAuthority({activationHeight:1}),e=>e.code==='HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED');
  assert.throws(()=>requireFreshStrategicAuthority({activationHeight:600000}),e=>e.code==='HPA_POOL_STRATEGIC_ACTIVATION_NOT_ADMITTED');
  assert.equal(requireFreshStrategicAuthority({activationHeight:null}).mainnet_bwh_faw_economic_proof,false);
});
test('HPA-W3-04: actual 2048 ShareLedger retains 25% infiltrator payout weight after undisclosed full block',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  for(let i=0;i<2048;i++)share(ledger,i%4===0?infiltrator:honest,i);
  const weights=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.deepEqual(weights,{honest:1536,infiltrator:512});
  const before=ledger.summary().lastEntryHash;
  // A miner's private undisclosed full-difficulty solution is invisible to
  // the coordinator; deliberately no append or submit operation occurs.
  const privateSolution={found:true,published:false};
  assert.equal(privateSolution.published,false);
  assert.equal(ledger.summary().lastEntryHash,before);
  const after=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.deepEqual(after,weights);
  const outputs=allocatePplnsOutputs(1000000n,ledger.weights(honest));
  assert.equal(outputs.find(x=>x.address===infiltrator).amount_atoms,'250000');
  assert.equal(outputs.find(x=>x.address===honest).amount_atoms,'750000');
  assert.equal(outputs.reduce((s,x)=>s+BigInt(x.amount_atoms),0n),1000000n);
});
test('HPA-W3-05: infiltrator weight disappears only after full honest-window displacement',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  for(let i=0;i<2048;i++)share(ledger,i%4===0?infiltrator:honest,i);
  for(let i=2048;i<2560;i++)share(ledger,honest,i);
  const weight=Object.fromEntries(ledger.weights(honest).map(x=>[x.address,Number(x.weight)]));
  assert.equal(weight.infiltrator,384);
  assert.equal(weight.honest,1664);
  for(let i=2560;i<4096;i++)share(ledger,honest,i);
  const end=ledger.weights(honest);
  assert.deepEqual(end,[{address:honest,weight:2048n}]);
});
test('HPA-W3-06: ShareLedger rejects replayed share identity, without minting additional payout weight',()=>{
  const ledger=new ShareLedger({windowSize:2048});
  share(ledger,infiltrator,1);
  assert.throws(()=>share(ledger,infiltrator,1),/Duplicate share/);
  assert.equal(ledger.summary().totalShares,1);
});

test('HPA-W3-07: valid full-target share is durably counted before downstream block-submission failure',async()=>{
  const address=encodeAddress(Buffer.alloc(20,13),'faet');
  const prev='a'.repeat(64),candidateHeader={network:'fairyelf-public-testnet-v4',height:100,
    previous_hash:prev,difficulty_bits:8,reward_atoms:'1000000000',
    miner_address:address,timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header:candidateHeader,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,tip_hash:prev,difficulty_bits:8}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce}),
    blockSubmitter:async()=>{throw new Error('bounded_downstream_submission_failure')}
  });
  const work=await coordinator.createWork(address);
  let nonce=0,hash='';
  for(;nonce<100000;nonce++){
    hash=hashHex({...candidateHeader,nonce});
    if(leadingZeroBits(hash)>=candidateHeader.difficulty_bits)break;
  }
  assert.ok(nonce<100000,'find a valid low-difficulty full-target proof in bounded lab');
  assert.equal(coordinator.ledger.summary().totalShares,0);
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce,hash}),
    /bounded_downstream_submission_failure/
  );
  assert.equal(coordinator.ledger.summary().totalShares,1,
    'real ShareCoordinator appends/records the share BEFORE downstream block submission');
  assert.equal(coordinator.ledger.weights(address)[0].weight,1n);
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce,hash}),/Duplicate share/,
    'failed downstream block must not double-credit repeated nonce');
  assert.equal(coordinator.ledger.summary().totalShares,1);
});
test('HPA-W3-08: a stale-tip share is rejected BEFORE payout weight is appended',async()=>{
  const address=encodeAddress(Buffer.alloc(20,14),'faet');
  let currentTip='b'.repeat(64);
  const candidate={header:{height:101,previous_hash:currentTip,difficulty_bits:8,reward_atoms:'1000000000'},
    txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({height:100,tip_hash:currentTip,difficulty_bits:8}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async()=>hashHex({candidate:true})
  });
  const work=await coordinator.createWork(address);
  currentTip='c'.repeat(64); // reorg/tip-change race before submission
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce:1,hash:hashHex({candidate:true})}),
    /Stale share job after chain-tip change/
  );
  assert.equal(coordinator.ledger.summary().totalShares,0);
  assert.equal(coordinator.jobs.has(work.jobId),false);
});

function tipRaceFixture({recheck=false,changeDuringHash=true}={}){
  const address=encodeAddress(Buffer.alloc(20,15),'faet');
  let currentTip='a'.repeat(64),submissions=0;
  const header={network:'fairyelf-public-testnet-v4',height:100,
    previous_hash:currentTip,difficulty_bits:8,reward_atoms:'1000000000',
    miner_address:address,timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,candidateTipRecheck:recheck,
    statusProvider:async()=>({height:99,tip_hash:currentTip,difficulty_bits:8}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>{
      await Promise.resolve();
      if(changeDuringHash)currentTip='b'.repeat(64);
      return hashHex({...c.header,nonce});
    },
    blockSubmitter:async()=>{submissions++;return{ok:true}}
  });
  let nonce=0,hash='';
  for(;nonce<100000;nonce++){
    hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)break;
  }
  assert.ok(nonce<100000);
  return {coordinator,address,nonce,hash,getSubmissions:()=>submissions};
}
test('HPA-W3-16: existing asynchronous hash phase can credit a share after tip changes',async()=>{
  const x=tipRaceFixture();
  const work=await x.coordinator.createWork(x.address);
  assert.equal(x.coordinator.candidateTipRecheck,false);
  const result=await x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash});
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.getSubmissions(),1);
});
test('HPA-W3-17: opt-in recheck refuses a changed tip before ledger credit or block submission',async()=>{
  const x=tipRaceFixture({recheck:true});
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    /Stale share job after hashing chain-tip change/);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.getSubmissions(),0);
  assert.equal(x.coordinator.jobs.has(work.jobId),false);
});
test('HPA-W3-18: opt-in recheck retains valid full-target work when chain tip is stable',async()=>{
  const x=tipRaceFixture({recheck:true,changeDuringHash:false});
  const work=await x.coordinator.createWork(x.address);
  const result=await x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash});
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.getSubmissions(),1);
});

function fullTargetReceiptFixture({submitBlock,logFile=null}={}){
  const address=encodeAddress(Buffer.alloc(20,16),'faet'),previous='c'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:100,previous_hash:previous,
    difficulty_bits:8,reward_atoms:'1000000000',miner_address:address,
    timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  let attempts=0;
  const coordinator=new ShareCoordinator({
    logFile,multiOutputCoinbaseActive:true,candidateFullTargetReceiptProtection:true,
    statusProvider:async()=>({height:99,tip_hash:previous,difficulty_bits:8}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce}),
    blockSubmitter:async block=>{attempts++;return submitBlock?submitBlock(block):{ok:true}}
  });
  let nonce=0,hash='';
  for(;nonce<100000;nonce++){
    hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)break;
  }
  assert.ok(nonce<100000);
  return{coordinator,address,nonce,hash,attempts:()=>attempts};
}
test('HPA-W3-19: an ambiguous full-block submission keeps one share and forbids blind resubmit',async()=>{
  const x=fullTargetReceiptFixture({submitBlock:async()=>{throw new Error('provider_ack_unknown')}});
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  await assert.rejects(x.coordinator.submitShare(input),/provider_ack_unknown/);
  const receipt=x.coordinator.fullTargetReceipt(input);
  assert.equal(receipt.status,'submission_outcome_unknown');
  assert.equal(receipt.attempts,1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  await assert.rejects(x.coordinator.submitShare({...input,hash:'f'.repeat(64)}),
    e=>e.code==='candidate_full_target_receipt_hash_mismatch');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
  receipt.status='forged_confirmed';
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_outcome_unknown');
});
test('HPA-W3-20: acknowledged block is not falsely marked confirmed and duplicate proof cannot be credited',async()=>{
  const x=fullTargetReceiptFixture();
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  const result=await x.coordinator.submitShare(input);
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'acknowledged_not_confirmed');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.attempts(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
});
test('HPA-W3-21: racing repeated proof during in-flight submission remains single-credit, single-send',async()=>{
  let entered,fail;
  const submitted=new Promise(resolve=>{entered=resolve});
  const blockOutcome=new Promise((_,reject)=>{fail=reject});
  const x=fullTargetReceiptFixture({submitBlock:async()=>{entered();return blockOutcome}});
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  const first=x.coordinator.submitShare(input);
  await submitted;
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_in_flight');
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.attempts(),1);
  fail(new Error('provider_outcome_indeterminate'));
  await assert.rejects(first,/provider_outcome_indeterminate/);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_outcome_unknown');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
});

test('HPA-W3-22: cold restart replays a durable full-target share but never assumes upstream block inclusion',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-fulltarget-recovery-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const logFile=join(dir,'shares.jsonl');
  const x=fullTargetReceiptFixture({logFile,submitBlock:async()=>{throw new Error('upstream_ack_lost')}});
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  await assert.rejects(x.coordinator.submitShare(input),/upstream_ack_lost/);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_outcome_unknown');
  const fresh=new ShareCoordinator({logFile,candidateFullTargetReceiptProtection:true});
  assert.equal(fresh.ledger.summary().totalShares,1);
  const restored=fresh.fullTargetReceipt(input);
  assert.equal(restored.status,'submission_outcome_unknown_after_restart');
  assert.equal(restored.hash,x.hash);
  await assert.rejects(fresh.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(fresh.ledger.summary().totalShares,1);
});
