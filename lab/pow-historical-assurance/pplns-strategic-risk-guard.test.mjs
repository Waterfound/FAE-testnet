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
  assert.equal(coordinator.fullTargetReceipt({jobId:work.jobId,nonce}).status,
    'submission_outcome_unknown');
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce,hash}),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation',
    'failed downstream block must not double-credit repeated nonce');
  assert.equal(coordinator.ledger.summary().totalShares,1);
});
test('HPA-W3-08: a stale-tip share is rejected BEFORE payout weight is appended',async()=>{
  const address=encodeAddress(Buffer.alloc(20,14),'faet');
  let currentTip='b'.repeat(64);
  const candidate={header:{network:'fairyelf-public-testnet-v4',height:101,previous_hash:currentTip,difficulty_bits:8,reward_atoms:'1000000000'},
    txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:100,tip_hash:currentTip,difficulty_bits:8}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async()=>hashHex({candidate:true})
  });
  const work=await coordinator.createWork(address);
  currentTip='c'.repeat(64); // reorg/tip-change race before submission
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce:1,hash:hashHex({candidate:true})}),
    /Stale share job after upstream state change/
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
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,tip_hash:currentTip,difficulty_bits:8}),
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
test('HPA-W3-16: caller cannot disable post-hash upstream-state revalidation',async()=>{
  const x=tipRaceFixture();
  const work=await x.coordinator.createWork(x.address);
  assert.equal(x.coordinator.candidateTipRecheck,true);
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    /Stale share job after hashing upstream state change/);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.getSubmissions(),0);
});
test('HPA-W3-17: mandatory recheck refuses a changed tip before ledger credit or block submission',async()=>{
  const x=tipRaceFixture({recheck:true});
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    /Stale share job after hashing upstream state change/);
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.getSubmissions(),0);
  assert.equal(x.coordinator.jobs.has(work.jobId),false);
});
test('HPA-W3-18: mandatory recheck retains valid full-target work when chain tip is stable',async()=>{
  const x=tipRaceFixture({recheck:true,changeDuringHash:false});
  const work=await x.coordinator.createWork(x.address);
  const result=await x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash});
  assert.equal(result.accepted,true);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.getSubmissions(),1);
});

function fullTargetReceiptFixture({submitBlock,logFile=null,receiptProtection=true}={}){
  const address=encodeAddress(Buffer.alloc(20,16),'faet'),previous='c'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:100,previous_hash:previous,
    difficulty_bits:8,reward_atoms:'1000000000',miner_address:address,
    timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  let attempts=0;
  const coordinator=new ShareCoordinator({
    logFile,multiOutputCoinbaseActive:true,
    candidateFullTargetReceiptProtection:receiptProtection,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,tip_hash:previous,difficulty_bits:8}),
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

test('HPA-W3-23: receipt capacity with 1024 unknown blocks fails closed before share credit',async()=>{
  const x=fullTargetReceiptFixture({
    submitBlock:async()=>{throw new Error('capacity_seed_ack_unknown')}
  });
  for(let i=0;i<1024;i++){
    const seedWork=await x.coordinator.createWork(x.address);
    await assert.rejects(x.coordinator.submitShare({
      jobId:seedWork.jobId,nonce:x.nonce,hash:x.hash
    }),/capacity_seed_ack_unknown/);
  }
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_full_target_receipt_capacity');
  assert.equal(x.coordinator.ledger.summary().totalShares,1024);
  assert.equal(x.attempts(),1024);
  assert.equal(x.coordinator.fullTargetReceipts.size,1024);
});
test('HPA-W3-24: acknowledged receipts can be compacted without losing exact share replay protection',async()=>{
  const x=fullTargetReceiptFixture();
  for(let i=0;i<1024;i++){
    const seedWork=await x.coordinator.createWork(x.address);
    const seedResult=await x.coordinator.submitShare({
      jobId:seedWork.jobId,nonce:x.nonce,hash:x.hash
    });
    assert.equal(seedResult.accepted,true);
  }
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  const result=await x.coordinator.submitShare(input);
  assert.equal(result.accepted,true);
  assert.equal(x.attempts(),1025);
  assert.equal(x.coordinator.ledger.summary().totalShares,1025);
  assert.ok(x.coordinator.fullTargetReceipts.size<=1024);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'acknowledged_not_confirmed');
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.coordinator.ledger.summary().totalShares,1025);
});

test('HPA-W3-29: explicit negative provider block ACK never masquerades as confirmed submission',async()=>{
  const x=fullTargetReceiptFixture({submitBlock:async()=>({ok:false,error:'block_stale'})});
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_provider_rejected_unconfirmed');
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'upstream_reported_rejected_unconfirmed');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.attempts(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
});
test('HPA-W3-30: empty, malformed and conflicting block ACKs never yield a positive receipt',async()=>{
  for(const ack of [undefined,null,{},'ok',{ok:'true'},{accepted:false},{ok:true,accepted:false}]){
    const x=fullTargetReceiptFixture({submitBlock:async()=>ack});
    const work=await x.coordinator.createWork(x.address);
    const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
    await assert.rejects(x.coordinator.submitShare(input),
      e=>['candidate_full_target_missing_positive_ack',
        'candidate_full_target_provider_rejected_unconfirmed'].includes(e.code));
    assert.notEqual(x.coordinator.fullTargetReceipt(input).status,'acknowledged_not_confirmed');
    assert.equal(x.coordinator.ledger.summary().totalShares,1);
    assert.equal(x.attempts(),1);
    await assert.rejects(x.coordinator.submitShare(input),
      e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  }
});
test('HPA-W3-31: explicitly accepted upstream result is acknowledged, still not a finality proof',async()=>{
  const x=fullTargetReceiptFixture({submitBlock:async()=>({accepted:true,tip_hash:'a'.repeat(64)})});
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  const result=await x.coordinator.submitShare(input);
  assert.equal(result.accepted,true);
  assert.equal(result.block.accepted,true);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'acknowledged_not_confirmed');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
});

test('HPA-W3-55: caller cannot disable durable full-target uncertainty receipts',async()=>{
  const x=fullTargetReceiptFixture({receiptProtection:false,
    submitBlock:async()=>{throw new Error('provider_ack_lost')}});
  assert.equal(x.coordinator.candidateFullTargetReceiptProtection,true);
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  await assert.rejects(x.coordinator.submitShare(input),/provider_ack_lost/);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_outcome_unknown');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.attempts(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
});

test('HPA-W3-57: runtime property mutation cannot disable full-target uncertainty receipts',async()=>{
  const x=fullTargetReceiptFixture({
    submitBlock:async()=>{throw new Error('provider_ack_lost_after_mutation')}
  });
  assert.throws(()=>{x.coordinator.candidateFullTargetReceiptProtection=false},TypeError);
  assert.equal(x.coordinator.candidateFullTargetReceiptProtection,true);
  const work=await x.coordinator.createWork(x.address);
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  await assert.rejects(x.coordinator.submitShare(input),/provider_ack_lost_after_mutation/);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'submission_outcome_unknown');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.equal(x.attempts(),1);
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.attempts(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
});

test('HPA-W3-56: cold restart cannot bypass unresolved full-target receipt capacity',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-fulltarget-capacity-restart-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const logFile=join(dir,'shares.jsonl');
  const address=encodeAddress(Buffer.alloc(20,16),'faet');
  const seed=new ShareLedger({logFile});
  for(let i=0;i<1024;i++)seed.append({
    jobId:'persisted-unknown-'+i,address,nonce:i,hash:'0'.repeat(64),
    shareDifficultyBits:4,blockDifficultyBits:8,height:99,
    previousBlockHash:'c'.repeat(64)
  });
  const x=fullTargetReceiptFixture({logFile});
  assert.equal(x.coordinator.unresolvedFullTargetReceiptCount(),1024);
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(
    x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_full_target_receipt_capacity');
  assert.equal(x.coordinator.ledger.summary().totalShares,1024);
  assert.equal(x.attempts(),0);
});

test('HPA-W3-58: external receipt-map mutation cannot forge reconciliation or bypass capacity',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-fulltarget-receipt-store-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const logFile=join(dir,'shares.jsonl');
  const address=encodeAddress(Buffer.alloc(20,16),'faet');
  const seed=new ShareLedger({logFile});
  for(let i=0;i<1024;i++)seed.append({
    jobId:'persisted-unknown-'+i,address,nonce:i,hash:'0'.repeat(64),
    shareDifficultyBits:4,blockDifficultyBits:8,height:99,
    previousBlockHash:'c'.repeat(64)
  });
  const x=fullTargetReceiptFixture({logFile});
  assert.equal(x.coordinator.unresolvedFullTargetReceiptCount(),1024);
  const externallyVisible=x.coordinator.fullTargetReceipts;
  for(let i=0;i<1024;i++)externallyVisible.set('persisted-unknown-'+i+':'+i,{
    status:'acknowledged_not_confirmed',hash:'0'.repeat(64),attempts:1
  });
  assert.equal(x.coordinator.unresolvedFullTargetReceiptCount(),1024,
    'caller-owned map mutations must not reclassify durable unknown outcomes');
  const work=await x.coordinator.createWork(x.address);
  await assert.rejects(
    x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_full_target_receipt_capacity');
  assert.equal(x.coordinator.ledger.summary().totalShares,1024);
  assert.equal(x.attempts(),0);
});

test('HPA-W3-59: acknowledged receipt compaction cannot manufacture an unresolved-capacity deadlock',async()=>{
  const x=fullTargetReceiptFixture();
  let firstInput=null;
  for(let i=0;i<2049;i++){
    const work=await x.coordinator.createWork(x.address);
    const input={
      jobId:work.jobId,nonce:x.nonce,hash:x.hash
    };
    firstInput??=input;
    const result=await x.coordinator.submitShare(input);
    assert.equal(result.accepted,true);
  }
  assert.equal(x.attempts(),2049);
  assert.equal(x.coordinator.ledger.summary().totalShares,2049);
  assert.equal(x.coordinator.unresolvedFullTargetReceiptCount(),0);
  assert.ok(x.coordinator.fullTargetReceipts.size<=1024);
  assert.equal(x.coordinator.fullTargetReceipt(firstInput).status,
    'acknowledged_not_confirmed_compacted');
});

test('HPA-W3-60: compacted acknowledgments become unknown after cold restart and fail closed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-fulltarget-ack-restart-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const logFile=join(dir,'shares.jsonl');
  const x=fullTargetReceiptFixture({logFile});
  let firstInput=null;
  for(let i=0;i<1025;i++){
    const work=await x.coordinator.createWork(x.address);
    const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
    firstInput??=input;
    const result=await x.coordinator.submitShare(input);
    assert.equal(result.accepted,true);
  }
  assert.equal(x.coordinator.unresolvedFullTargetReceiptCount(),0);
  assert.equal(x.coordinator.fullTargetReceipt(firstInput).status,
    'acknowledged_not_confirmed_compacted');

  const fresh=fullTargetReceiptFixture({logFile});
  assert.equal(fresh.coordinator.ledger.summary().totalShares,1025);
  assert.equal(fresh.coordinator.unresolvedFullTargetReceiptCount(),1025);
  assert.equal(fresh.coordinator.fullTargetReceipt(firstInput).status,
    'submission_outcome_unknown_after_restart');
  const next=await fresh.coordinator.createWork(fresh.address);
  await assert.rejects(fresh.coordinator.submitShare({
    jobId:next.jobId,nonce:fresh.nonce,hash:fresh.hash
  }),e=>e.code==='candidate_full_target_receipt_capacity');
  assert.equal(fresh.coordinator.ledger.summary().totalShares,1025);
  assert.equal(fresh.attempts(),0);
});

test('HPA-W3-51: coordinator rejects a template that redirects valid PPLNS weights',async t=>{
  const honestAddress=encodeAddress(Buffer.alloc(20,17),'faet');
  const attackerAddress=encodeAddress(Buffer.alloc(20,18),'faet');
  const previous='d'.repeat(64);
  const diverted=[{address:attackerAddress,amount_atoms:'1000'}];
  const dir=await mkdtemp(join(tmpdir(),'fae-pplns-seed-')),logFile=join(dir,'shares.log');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const seed=new ShareLedger({logFile});
  for(let i=0;i<4;i++)seed.append({
    jobId:'payout-seed-'+i,address:i===0?attackerAddress:honestAddress,nonce:i,
    hash:'0'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:9,
    previousBlockHash:'c'.repeat(64)
  });
  const coordinator=new ShareCoordinator({
    logFile,multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:9,tip_hash:previous,difficulty_bits:8}),
    candidateHasher:async()=>hashHex('unused'),
    distributedTemplateProvider:async()=>({
      header:{network:'fairyelf-public-testnet-v4',height:10,previous_hash:previous,
        difficulty_bits:8,reward_atoms:'1000',fee_atoms:'0',miner_address:attackerAddress,
        tx_root:hashHex([]),tx_count:0,coinbase_root:hashHex(diverted),
        coinbase_count:1,coinbase_mode:'pplns-direct'},
      txids:[],payouts:diverted,coinbase_outputs:diverted
    })
  });
  await assert.rejects(coordinator.createWork(honestAddress),
    error=>error.code==='candidate_pplns_payout_weight_mismatch');
  assert.equal(coordinator.jobs.size,0);
  assert.deepEqual(coordinator.ledger.weights(honestAddress).map(({address,weight})=>
    ({address,weight:weight.toString()})),[
      {address:attackerAddress,weight:'1'},
      {address:honestAddress,weight:'3'}
    ].sort((a,b)=>a.address.localeCompare(b.address)));
});

test('HPA-W3-52: payout aliases and header commitment cannot bypass ledger weights',async t=>{
  const honestAddress=encodeAddress(Buffer.alloc(20,21),'faet');
  const attackerAddress=encodeAddress(Buffer.alloc(20,22),'faet');
  const previous='e'.repeat(64);
  const dir=await mkdtemp(join(tmpdir(),'fae-pplns-seed-')),logFile=join(dir,'shares.log');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const seed=new ShareLedger({logFile});
  for(let i=0;i<4;i++)seed.append({
    jobId:'coinbase-seed-'+i,address:i===0?attackerAddress:honestAddress,nonce:i,
    hash:'0'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:9,
    previousBlockHash:'d'.repeat(64)
  });
  const coordinator=new ShareCoordinator({
    logFile,multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:9,tip_hash:previous,difficulty_bits:8}),
    candidateHasher:async()=>hashHex('unused'),
    distributedTemplateProvider:async({weights})=>{
      const payouts=allocatePplnsOutputs(1000n,
        weights.map(({address,weight})=>({address,weight:BigInt(weight)})));
      const diverted=[{address:attackerAddress,amount_atoms:'1000'}];
      return{
        header:{network:'fairyelf-public-testnet-v4',height:10,previous_hash:previous,
          difficulty_bits:8,reward_atoms:'1000',fee_atoms:'0',miner_address:attackerAddress,
          tx_root:hashHex([]),tx_count:0,coinbase_root:hashHex(diverted),
          coinbase_count:1,coinbase_mode:'pplns-direct'},
        txids:[],payouts,coinbase_outputs:diverted
      };
    }
  });
  await assert.rejects(coordinator.createWork(honestAddress),
    error=>error.code==='candidate_pplns_coinbase_binding_mismatch');
  assert.equal(coordinator.jobs.size,0);
});

test('HPA-W3-53: coordinator binds signed work to upstream network and difficulty',async()=>{
  const address=encodeAddress(Buffer.alloc(20,23),'faet');
  const previous='f'.repeat(64);
  const coordinator=new ShareCoordinator({
    networkId:'fairyelf-public-testnet-v4',multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:9,
      tip_hash:previous,difficulty_bits:18}),
    candidateHasher:async()=>hashHex('unused'),
    distributedTemplateProvider:async({weights})=>{
      const payouts=allocatePplnsOutputs(1000n,
        weights.map(({address,weight})=>({address,weight:BigInt(weight)})));
      return{
        header:{network:'attacker-network',height:10,previous_hash:previous,
          difficulty_bits:4,reward_atoms:'1000',fee_atoms:'0',miner_address:address,
          tx_root:hashHex([]),tx_count:0,coinbase_root:hashHex(payouts),
          coinbase_count:payouts.length,coinbase_mode:'pplns-direct'},
        txids:[],payouts,coinbase_outputs:payouts
      };
    }
  });
  await assert.rejects(coordinator.createWork(address),
    error=>error.code==='candidate_pplns_template_state_mismatch');
  assert.equal(coordinator.jobs.size,0);
  assert.equal(coordinator.ledger.summary().totalShares,0);
});

test('HPA-W3-54: share submission rejects upstream difficulty drift without a tip change',async()=>{
  const address=encodeAddress(Buffer.alloc(20,24),'faet'),previous='e'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:10,previous_hash:previous,
    difficulty_bits:8,reward_atoms:'1000',fee_atoms:'0',miner_address:address,
    tx_root:hashHex([]),tx_count:0};
  const payouts=[{address,amount_atoms:'1000'}];
  let difficulty=8;
  const coordinator=new ShareCoordinator({
    networkId:'fairyelf-public-testnet-v4',multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:9,
      tip_hash:previous,difficulty_bits:difficulty}),
    distributedTemplateProvider:async()=>({header,txids:[],payouts,coinbase_outputs:payouts}),
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce})
  });
  const work=await coordinator.createWork(address);
  let nonce=0,hash='';
  for(;nonce<100000;nonce++){
    hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=work.targetDifficultyBits)break;
  }
  assert.ok(nonce<100000);
  difficulty=7;
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce,hash}),
    /Stale share job after upstream state change/);
  assert.equal(coordinator.jobs.has(work.jobId),false);
  assert.equal(coordinator.ledger.summary().totalShares,0);
});

test('HPA-W3-61: coordinator ledger exposure cannot erase dedupe and double-credit one share proof',async()=>{
  const address=encodeAddress(Buffer.alloc(20,29),'faet'),previous='8'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:100,previous_hash:previous,
    difficulty_bits:18,reward_atoms:'1000000000',miner_address:address,
    timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,
      tip_hash:previous,difficulty_bits:18}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce})
  });
  const work=await coordinator.createWork(address);
  let nonce=0,hash='';
  for(;nonce<2_000_000;nonce++){
    hash=hashHex({...header,nonce});
    const bits=leadingZeroBits(hash);
    if(bits>=work.targetDifficultyBits&&bits<header.difficulty_bits)break;
  }
  assert.ok(nonce<2_000_000,'find a valid non-block share in bounded lab');
  await coordinator.submitShare({jobId:work.jobId,nonce,hash});
  assert.equal(coordinator.ledger.summary().totalShares,1);
  assert.equal(coordinator.ledger.seen.delete(`${work.jobId}:${nonce}`),true,
    'adversary must reach the predecessor dedupe store');
  await assert.rejects(coordinator.submitShare({jobId:work.jobId,nonce,hash}),/Duplicate share/);
  assert.equal(coordinator.ledger.summary().totalShares,1,
    'one proof identity must retain exactly one payout weight');
});

test('HPA-W3-62: coordinator job exposure cannot lower proof target and mint payout weight',async()=>{
  const address=encodeAddress(Buffer.alloc(20,30),'faet'),previous='9'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:100,previous_hash:previous,
    difficulty_bits:18,reward_atoms:'1000000000',miner_address:address,
    timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const candidate={header,txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,
      tip_hash:previous,difficulty_bits:18}),
    distributedTemplateProvider:async()=>candidate,
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce})
  });
  const work=await coordinator.createWork(address),snapshot=coordinator.jobs;
  const exposed=snapshot.get(work.jobId);
  exposed.shareDifficultyBits=0;
  snapshot.set(work.jobId,exposed);
  let nonce=0,hash=hashHex({...header,nonce});
  while(leadingZeroBits(hash)>=work.targetDifficultyBits){
    nonce++;hash=hashHex({...header,nonce});
  }
  await assert.rejects(
    coordinator.submitShare({jobId:work.jobId,nonce,hash}),
    /Share below target/);
  assert.equal(coordinator.jobs.get(work.jobId).shareDifficultyBits,work.targetDifficultyBits,
    'authoritative job target must remain isolated from caller mutation');
  assert.equal(coordinator.ledger.summary().totalShares,0,
    'proof below the issued target must not gain payout weight');
});

test('HPA-W3-63: caller cannot forge multi-output activation and request PPLNS work',async()=>{
  const address=encodeAddress(Buffer.alloc(20,31),'faet'),previous='a'.repeat(64);
  const header={network:'fairyelf-public-testnet-v4',height:100,previous_hash:previous,
    difficulty_bits:18,reward_atoms:'1000000000',miner_address:address,
    timestamp_ms:1700000000000,tx_root:hashHex([]),tx_count:0};
  const payouts=[{address,amount_atoms:'1000000000'}];
  let templateRequests=0;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:false,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:99,
      tip_hash:previous,difficulty_bits:18}),
    distributedTemplateProvider:async()=>{templateRequests++;return{
      header,txids:[],payouts,coinbase_outputs:payouts};},
    candidateHasher:async(c,nonce)=>hashHex({...c.header,nonce})
  });
  try{coordinator.multiOutputCoinbaseActive=true}catch{}
  await assert.rejects(coordinator.createWork(address),/activation required/);
  assert.equal(coordinator.multiOutputCoinbaseActive,false,
    'activation state must remain owner-bound and read-only to callers');
  assert.equal(templateRequests,0,'forged activation must fail before template issuance');
});
