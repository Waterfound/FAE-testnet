/** HPA-UC-001 W3: source-owned guard and exact ShareLedger BWH counterexample. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,activationConfigured,isPplnsCoinbaseActive} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {ShareLedger,ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,appendBlockFromFeed,createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessCurrentPplnsAdmission,requireFreshStrategicAuthority} from './pplns-strategic-risk-guard.mjs';
const honest='honest',infiltrator='infiltrator';
function attachValidCandidateCoinbase(candidate){
  // Existing source-owned negative fixtures predated the v4 multi-output
  // coinbase commitments; populate their genuine one-miner payout encoding,
  // without weakening the coordinator's payout-consistency validation.
  const outputs=candidate.coinbase_outputs;
  candidate.header.fee_atoms='0';
  candidate.header.coinbase_root=hashHex(outputs);
  candidate.header.coinbase_count=outputs.length;
  candidate.header.coinbase_mode='pplns-direct';
  candidate.header.miner_address=outputs[0].address;
  return candidate;
}
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
  attachValidCandidateCoinbase(candidate);
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
  const candidate={header:{network:'fairyelf-public-testnet-v4',height:101,previous_hash:currentTip,difficulty_bits:8,reward_atoms:'1000000000',
    miner_address:address,tx_root:hashHex([]),tx_count:0},
    txids:[],payouts:[{address,amount_atoms:'1000000000'}],
    coinbase_outputs:[{address,amount_atoms:'1000000000'}]};
  attachValidCandidateCoinbase(candidate);
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
  attachValidCandidateCoinbase(candidate);
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
  attachValidCandidateCoinbase(candidate);
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

test('HPA-W3-23: receipt capacity with 1024 unknown blocks fails closed before share credit',async()=>{
  const x=fullTargetReceiptFixture();
  const work=await x.coordinator.createWork(x.address);
  for(let i=0;i<1024;i++)x.coordinator.fullTargetReceipts.set('unknown-'+i,{
    status:'submission_outcome_unknown',hash:'a'.repeat(64),attempts:1});
  await assert.rejects(x.coordinator.submitShare({jobId:work.jobId,nonce:x.nonce,hash:x.hash}),
    e=>e.code==='candidate_full_target_receipt_capacity');
  assert.equal(x.coordinator.ledger.summary().totalShares,0);
  assert.equal(x.attempts(),0);
  assert.equal(x.coordinator.fullTargetReceipts.size,1024);
});
test('HPA-W3-24: acknowledged receipts can be compacted without losing exact share replay protection',async()=>{
  const x=fullTargetReceiptFixture();
  const work=await x.coordinator.createWork(x.address);
  for(let i=0;i<1024;i++)x.coordinator.fullTargetReceipts.set('ack-'+i,{
    status:'acknowledged_not_confirmed',hash:'a'.repeat(64),attempts:1});
  const input={jobId:work.jobId,nonce:x.nonce,hash:x.hash};
  const result=await x.coordinator.submitShare(input);
  assert.equal(result.accepted,true);
  assert.equal(x.attempts(),1);
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
  assert.ok(x.coordinator.fullTargetReceipts.size<=1024);
  assert.equal(x.coordinator.fullTargetReceipt(input).status,'acknowledged_not_confirmed');
  await assert.rejects(x.coordinator.submitShare(input),
    e=>e.code==='candidate_full_target_submission_requires_reconciliation');
  assert.equal(x.coordinator.ledger.summary().totalShares,1);
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

/**
 * HPA-W3-60..63: RED baseline against the real ShareCoordinator.createWork()
 * plus actual FAE createDistributedTemplate(); no invented payout calculator.
 * A coherent forged coinbase may still divert honest PPLNS weights.
 * Pool remains candidate/inactive: test-only activationHeight override.
 */
function payoutTemplateAttack({tamper='redirect'}={}){
  const honestAddr=encodeAddress(Buffer.alloc(20,71),'faet');
  const attackerAddr=encodeAddress(Buffer.alloc(20,72),'faet');
  let state=emptyState();
  for(const b of legacyBlocks)
    state=appendBlockFromFeed(state,b,new Map(),{activationHeight:null});
  const height=state.chain.length+1;
  let sourceTemplate;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    statusProvider:async()=>({network:'fairyelf-public-testnet-v4',height:height-1,
      tip_hash:state.chain.at(-1).hash,difficulty_bits:state.chain.at(-1).difficulty_bits}),
    candidateHasher:async()=>hashHex({fixture:true}),
    distributedTemplateProvider:async({weights})=>{
      const genuine=createDistributedTemplate(state,weights,{activationHeight:height});
      sourceTemplate=genuine;
      if(tamper==='none')return genuine;
      if(tamper==='redirect'){
        const sum=genuine.payouts.reduce((s,p)=>s+BigInt(p.amount_atoms),0n);
        const redirected=[{address:attackerAddr,amount_atoms:sum.toString()}];
        return {...genuine,payouts:redirected,coinbase_outputs:redirected,
          header:{...genuine.header,coinbase_root:hashHex(redirected),
            coinbase_count:1,coinbase_mode:'pplns-direct'}};
      }
      if(tamper==='split'){
        const redirect=genuine.payouts.map((p,i)=>i===0?
          {...p,amount_atoms:(BigInt(p.amount_atoms)-1n).toString()}:
          i===1?{...p,amount_atoms:(BigInt(p.amount_atoms)+1n).toString()}:p);
        return {...genuine,payouts:redirect,
          coinbase_outputs:redirect,header:{...genuine.header,coinbase_root:hashHex(redirect)}};
      }
      if(tamper==='root')return {...genuine,
        header:{...genuine.header,coinbase_root:'a'.repeat(64)}};
      throw new Error('unexpected fixture mutation');
    }
  });
  // Actual persisted-window accounting code: two honest shares and one
  // attacker share create real 2:1 weights, not caller-assigned payout weights.
  for(let i=0;i<3;i++)coordinator.ledger.append({
    jobId:'hpa-payout-source-share-'+i,
    address:i<2?honestAddr:attackerAddr,nonce:i,
    hash:'0'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,
    height,previousBlockHash:state.chain.at(-1).hash
  });
  return {coordinator,honestAddr,attackerAddr,getSource:()=>sourceTemplate};
}

test('HPA-W3-60: coherent template steals honest weights with recalculated root and unchanged total — reject before coordinator work signature',async()=>{
  const x=payoutTemplateAttack({tamper:'redirect'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /distributed_payout_commitment_mismatch/);
  assert.equal(x.coordinator.jobs.size,0,'no signed work for stolen payouts');
  assert.equal(x.coordinator.ledger.summary().totalShares,3,'no share loss');
});

test('HPA-W3-61: even one atom shifted between honest and attacker must not be signed despite exact total',async()=>{
  const x=payoutTemplateAttack({tamper:'split'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /distributed_payout_commitment_mismatch/);
  assert.equal(x.coordinator.jobs.size,0);
});

test('HPA-W3-62: correct outputs with a wrong signed-header coinbase root must not produce a mining job',async()=>{
  const x=payoutTemplateAttack({tamper:'root'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /distributed_payout_commitment_mismatch/);
  assert.equal(x.coordinator.jobs.size,0);
});

test('HPA-W3-63: genuine FAE source output distribution for real PPLNS window remains usable without production activation',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  const work=await x.coordinator.createWork(x.honestAddr);
  assert.ok(work.jobId);
  assert.equal(work.payoutCommitment,hashHex(x.getSource().payouts));
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(x.coordinator.multiOutputCoinbaseActive,true,'fixture opt-in only');
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null,'public production stays inactive');
});

test('HPA-W3-76: a new credited share during asynchronous source template creation cannot yield a signed job for a stale PPLNS window',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  const original=x.coordinator.distributedTemplateProvider;
  let providerInvoked=0;
  x.coordinator.distributedTemplateProvider=async args=>{
    const template=await original(args);
    providerInvoked++;
    await Promise.resolve();
    x.coordinator.ledger.append({
      jobId:'HPA-W3-76-later-honest-share',address:x.honestAddr,nonce:7776,
      hash:'0'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,
      height:template.header.height,previousBlockHash:template.header.previous_hash
    });
    return template;
  };
  const initial=x.coordinator.ledger.summary();
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_source_window_changed_during_template');
  assert.equal(providerInvoked,1);
  assert.equal(x.coordinator.jobs.size,0,'no stale signed coordinator work job');
  assert.equal(x.coordinator.ledger.summary().totalShares,initial.totalShares+1,
    'a legitimate accepted share must never be rolled back by stale template rejection');
});

test('HPA-W3-77: stable asynchronous genuine FAE distributed template remains signed after source-ledger snapshot recheck',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  const original=x.coordinator.distributedTemplateProvider;
  x.coordinator.distributedTemplateProvider=async args=>{
    await Promise.resolve();
    return original(args);
  };
  const before=x.coordinator.ledger.summary();
  const job=await x.coordinator.createWork(x.honestAddr);
  assert.ok(job.workProof);
  assert.deepEqual(job.ledgerState,before);
  assert.deepEqual(x.coordinator.ledger.summary(),before);
  assert.equal(x.coordinator.jobs.size,1);
});

test('HPA-W3-78: full rolling window replacement changes weights at constant windowShares and must not produce a stale payout job',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  x.coordinator.ledger.windowSize=3;
  const original=x.coordinator.distributedTemplateProvider;
  x.coordinator.distributedTemplateProvider=async args=>{
    const template=await original(args);
    await Promise.resolve();
    x.coordinator.ledger.append({
      jobId:'HPA-W3-78-window-roll',address:x.attackerAddr,nonce:7878,
      hash:'0'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,
      height:template.header.height,previousBlockHash:template.header.previous_hash
    });
    return template;
  };
  const before=x.coordinator.ledger.summary();
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_source_window_changed_during_template');
  const after=x.coordinator.ledger.summary();
  assert.equal(after.windowShares,before.windowShares,
    'rolling-window item count alone does not prove payout weights unchanged');
  assert.notDeepEqual(x.coordinator.ledger.weights(x.honestAddr),
    [{address:x.honestAddr,weight:2n},{address:x.attackerAddr,weight:1n}],
    'the signed old payout weights are no longer authoritative');
  assert.equal(x.coordinator.jobs.size,0);
});

test('HPA-W3-82: stale async template must not sign a job and genuine appended share remains durably recoverable after restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-w3-stale-durable-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const logFile=join(dir,'shares.jsonl');
  const x=payoutTemplateAttack({tamper:'none'});
  const durable=new ShareLedger({logFile,windowSize:3});
  for(const entry of x.coordinator.ledger.shares)durable.append({
    jobId:entry.jobId,address:entry.address,nonce:entry.nonce,hash:entry.hash,
    shareDifficultyBits:entry.shareDifficultyBits,
    blockDifficultyBits:entry.blockDifficultyBits,height:entry.height,
    previousBlockHash:entry.previousBlockHash
  });
  x.coordinator.ledger=durable;
  const original=x.coordinator.distributedTemplateProvider;
  x.coordinator.distributedTemplateProvider=async args=>{
    const template=await original(args);
    await Promise.resolve();
    durable.append({
      jobId:'HPA-W3-82-durable-during-template',address:x.attackerAddr,
      nonce:8282,hash:'0'.repeat(64),shareDifficultyBits:4,
      blockDifficultyBits:8,height:template.header.height,
      previousBlockHash:template.header.previous_hash
    });
    return template;
  };
  const before=durable.summary();
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_source_window_changed_during_template');
  const after=durable.summary();
  assert.equal(after.totalShares,before.totalShares+1);
  assert.equal(x.coordinator.jobs.size,0);
  const recovered=new ShareLedger({logFile,windowSize:3});
  assert.deepEqual(recovered.summary(),after,
    'exact appended source share must be replayable from the fsync-backed hash chain');
  assert.deepEqual(recovered.weights(x.honestAddr),durable.weights(x.honestAddr));
  assert.equal(recovered.shares.at(-1).jobId,'HPA-W3-82-durable-during-template');
});

test('HPA-W3-83: changed live source weights are refused even if ledger count/head are deceitfully left unchanged',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  const original=x.coordinator.distributedTemplateProvider;
  const summaryBefore=x.coordinator.ledger.summary();
  x.coordinator.distributedTemplateProvider=async args=>{
    const template=await original(args);
    await Promise.resolve();
    // Adversarial memory corruption: not a valid persisted ledger operation.
    // Snapshot length/head alone are insufficient for this safety predicate.
    x.coordinator.ledger.shares[0].address=x.attackerAddr;
    return template;
  };
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_source_window_changed_during_template');
  assert.deepEqual(x.coordinator.ledger.summary(),summaryBefore);
  assert.equal(x.coordinator.jobs.size,0);
});


/**
 * HPA-W3-90..94: actual FAE source ShareCoordinator.createWork tip readback.
 * In the RED baseline, ShareLedger remains unchanged but upstream tip/height
 * moves while the real createDistributedTemplate() provider is suspended.
 * No network activation or synthetic replacement of production source.
 */
function presignTipRaceFixture({mutation='tip'}={}){
  const x=payoutTemplateAttack({tamper:'none'});
  let statusReads=0,templateCalls=0;
  const original=x.coordinator.distributedTemplateProvider;
  x.coordinator.distributedTemplateProvider=async args=>{
    templateCalls++;
    const candidate=await original(args);
    const normal={network:'fairyelf-public-testnet-v4',
      height:Number(candidate.header.height)-1,
      tip_hash:candidate.header.previous_hash,
      difficulty_bits:Number(candidate.header.difficulty_bits)};
    if(mutation==='tip')normal.tip_hash='f'.repeat(64);
    if(mutation==='height')normal.height+=1;
    if(mutation==='network')normal.network='unrelated-public-network';
    if(mutation==='incomplete')delete normal.tip_hash;
    x.coordinator.statusProvider=async()=>{
      statusReads++;
      if(mutation==='offline')throw new Error('hpa_upstream_unavailable');
      return normal;
    };
    return candidate;
  };
  return {...x,reads:()=>statusReads,templates:()=>templateCalls};
}
test('HPA-W3-90: source provider tip changes during await; obsolete template must not receive signed work',async()=>{
  const x=presignTipRaceFixture({mutation:'tip'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /candidate_pplns_chain_state_changed_during_template/);
  assert.equal(x.templates(),1);
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,3);
});
test('HPA-W3-91: source height changes independently of tip; obsolete work must not be signed',async()=>{
  const x=presignTipRaceFixture({mutation:'height'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /candidate_pplns_chain_state_changed_during_template/);
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,3);
});
test('HPA-W3-92: upstream becomes unavailable after genuine source template; fail closed before signing',async()=>{
  const x=presignTipRaceFixture({mutation:'offline'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /hpa_upstream_unavailable/);
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,3);
});
test('HPA-W3-93: incomplete tip status after genuine source template fails closed',async()=>{
  const x=presignTipRaceFixture({mutation:'incomplete'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    /candidate_pplns_chain_status_incomplete/);
  assert.equal(x.coordinator.jobs.size,0);
});
test('HPA-W3-94: unchanged source tip and ledger still yield genuine signed work',async()=>{
  const x=presignTipRaceFixture({mutation:'none'});
  const job=await x.coordinator.createWork(x.honestAddr);
  assert.ok(job.jobId && job.workProof);
  assert.equal(x.reads(),1,'must read independent upstream tip before signing');
  assert.equal(x.templates(),1);
  assert.equal(x.coordinator.jobs.size,1);
});


test('HPA-W3-95: upstream reports explicit wrong network; candidate source rejects prior to work signing',async()=>{
  const x=presignTipRaceFixture({mutation:'network'});
  await assert.rejects(x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_chain_status_incomplete');
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,3);
});
test('HPA-W3-96: continuous genuine ShareLedger churn starves work safely; stabilization restores liveness',async()=>{
  const x=payoutTemplateAttack({tamper:'none'});
  const original=x.coordinator.distributedTemplateProvider;
  let churn=0;
  x.coordinator.distributedTemplateProvider=async args=>{
    const candidate=await original(args);
    await Promise.resolve();
    x.coordinator.ledger.append({
      jobId:'HPA-W3-96-churn-'+churn,address:churn%2?x.attackerAddr:x.honestAddr,
      nonce:9600+churn++,hash:'0'.repeat(64),shareDifficultyBits:4,
      blockDifficultyBits:8,height:candidate.header.height,
      previousBlockHash:candidate.header.previous_hash});
    return candidate;
  };
  for(let i=0;i<16;i++)await assert.rejects(
    x.coordinator.createWork(x.honestAddr),
    e=>e.code==='candidate_pplns_source_window_changed_during_template');
  assert.equal(churn,16,'bounded attempts do not provide indefinite-churn liveness');
  assert.equal(x.coordinator.jobs.size,0,'never sign a stale payout to improve liveness');
  assert.equal(x.coordinator.ledger.summary().totalShares,19,'all sixteen real source shares preserved');
  x.coordinator.distributedTemplateProvider=original;
  const job=await x.coordinator.createWork(x.honestAddr);
  assert.equal(job.ledgerState.totalShares,19);
  assert.equal(job.pplnsWeights.reduce((s,w)=>s+BigInt(w.weight),0n),19n);
  assert.equal(x.coordinator.jobs.size,1,'eventual quiet window recovers work production');
});
