/**
 * HPA-W3-60..64: independent negative challenge of ShareCoordinator.createWork
 * against the actual ledger allocator and FAE source block template/verifier.
 * Lab uses an explicit opt-in height; not current network PPLNS activation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareCoordinator,allocatePplnsOutputs} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,appendBlockFromFeed,appendBlockFromSubmission,
  createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex,leadingZeroBits} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {createLedgerBoundPplnsProvider as bind} from './pplns-payout-binding-candidate.mjs';

function fixture(){
  let state=emptyState();
  for(const block of legacyBlocks)
    state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});
  const height=state.chain.length+1;
  const honest=encodeAddress(Buffer.alloc(20,21),'faet');
  const attacker=encodeAddress(Buffer.alloc(20,22),'faet');
  const statusProvider=async()=>({network:'fairyelf-public-testnet-v4',
    height:state.chain.length,tip_hash:state.chain.at(-1).hash,
    difficulty_bits:state.chain.at(-1).difficulty_bits});
  const coordinator=new ShareCoordinator({multiOutputCoinbaseActive:true,
    statusProvider,candidateHasher:async(candidate,nonce)=>hashHex({...candidate.header,nonce})});
  for(let i=0;i<4;i++)coordinator.ledger.append({
    jobId:'hpa-payout-source-'+i,address:i===0?attacker:honest,nonce:i,
    hash:'0'.repeat(64),shareDifficultyBits:8,blockDifficultyBits:12,
    height,previousBlockHash:state.chain.at(-1).hash
  });
  const sourceProvider=({weights})=>
    createDistributedTemplate(state,weights,{activationHeight:height});
  return {state,height,honest,attacker,coordinator,sourceProvider};
}
function hostileRedirect(template,address){
  const total=BigInt(template.header.reward_atoms)+BigInt(template.header.fee_atoms);
  const outputs=[{address,amount_atoms:total.toString()}];
  return {...template,payouts:outputs,coinbase_outputs:outputs,
    header:{...template.header,coinbase_count:outputs.length,
      coinbase_root:hashHex(outputs)}};
}
function solveValidPow(header){
  for(let nonce=0;nonce<4_000_000;nonce++){
    const hash=hashHex({...header,nonce});
    if(leadingZeroBits(hash)>=header.difficulty_bits)return {hash,nonce};
  }
  throw new Error('bounded source PoW challenge exhausted');
}
test('HPA-W3-60: actual ShareCoordinator sum-only template accepts hostile recipient redirection; source consensus lacks private pool-share knowledge',async()=>{
  const x=fixture();
  x.coordinator.distributedTemplateProvider=async args=>
    hostileRedirect(x.sourceProvider(args),x.attacker);
  const work=await x.coordinator.createWork(x.honest);
  assert.equal(work.payouts.length,1);
  assert.equal(work.payouts[0].address,x.attacker);
  assert.equal(work.pplnsWeights.length,2);
  assert.equal(work.pplnsWeights.find(w=>w.address===x.honest).weight,'3');
  assert.equal(work.pplnsWeights.find(w=>w.address===x.attacker).weight,'1');
  const valid=solveValidPow(work.header);
  const next=appendBlockFromSubmission(x.state,{header:work.header,nonce:valid.nonce,
    hash:valid.hash,txids:work.txids,coinbase_outputs:work.coinbase_outputs},
    {activationHeight:x.height});
  assert.equal(next.chain.at(-1).hash,valid.hash);
  assert.equal(next.utxos[valid.hash+':0'].address,x.attacker);
  assert.equal(x.coordinator.ledger.summary().totalShares,4);
  // Only demonstrates source consensus validates TOTAL, not private PPLNS
  // fairness. It does NOT demonstrate live pool exposure or profitability.
});
test('HPA-W3-61: source-ledger bound wrapper rejects fully re-committed all-attacker payout before creating a job',async()=>{
  const x=fixture();
  x.coordinator.distributedTemplateProvider=bind({ledger:x.coordinator.ledger,
    provider:async args=>hostileRedirect(x.sourceProvider(args),x.attacker)});
  await assert.rejects(x.coordinator.createWork(x.honest),
    e=>e.code==='pplns_candidate_payout_diverges_from_ledger');
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,4);
});
test('HPA-W3-62: honest FAE source template and exact allocator rounding remain accepted by the isolated guard',async()=>{
  const x=fixture();
  x.coordinator.distributedTemplateProvider=bind({ledger:x.coordinator.ledger,
    provider:x.sourceProvider});
  const work=await x.coordinator.createWork(x.honest);
  const expected=allocatePplnsOutputs(BigInt(work.header.reward_atoms)+
    BigInt(work.header.fee_atoms),x.coordinator.ledger.weights(x.honest));
  assert.deepEqual(work.payouts,expected);
  assert.deepEqual(work.coinbase_outputs,expected);
  assert.equal(work.header.coinbase_root,hashHex(expected));
  assert.equal(work.header.coinbase_count,expected.length);
  assert.equal(x.coordinator.jobs.size,1);
  assert.equal(x.coordinator.multiOutputCoinbaseActive,true,'lab opt-in only');
});
test('HPA-W3-63: mismatched coinbase outputs, forged commitment and numeric atom coercion all fail closed before jobs',async()=>{
  for(const attack of [
    c=>({...c,coinbase_outputs:[...c.payouts].reverse()}),
    c=>({...c,header:{...c.header,coinbase_root:'f'.repeat(64)}}),
    c=>({...c,payouts:c.payouts.map((o,i)=>i===0?{...o,amount_atoms:Number(o.amount_atoms)}:o)}),
    c=>({...c,header:{...c.header,fee_atoms:Number(c.header.fee_atoms)}})
  ]){
    const x=fixture();
    x.coordinator.distributedTemplateProvider=bind({ledger:x.coordinator.ledger,
      provider:async args=>attack(x.sourceProvider(args))});
    await assert.rejects(x.coordinator.createWork(x.honest),
      e=>['pplns_candidate_payout_diverges_from_ledger',
        'pplns_candidate_header_incompatible',
        'pplns_candidate_coinbase_commitment_mismatch'].includes(e.code));
    assert.equal(x.coordinator.jobs.size,0);
    assert.equal(x.coordinator.ledger.summary().totalShares,4);
  }
});
test('HPA-W3-64: asynchronous new share invalidates a template bound to an earlier finite PPLNS window',async()=>{
  const x=fixture();
  const before=x.coordinator.ledger.summary();
  x.coordinator.distributedTemplateProvider=bind({ledger:x.coordinator.ledger,
    provider:async args=>{
      const candidate=x.sourceProvider(args);
      await Promise.resolve();
      x.coordinator.ledger.append({jobId:'share-during-template',
        address:x.attacker,nonce:2026,hash:'0'.repeat(64),
        shareDifficultyBits:8,blockDifficultyBits:12,height:x.height,
        previousBlockHash:x.state.chain.at(-1).hash});
      return candidate;
    }});
  await assert.rejects(x.coordinator.createWork(x.honest),
    e=>e.code==='pplns_share_window_changed_during_template');
  assert.equal(x.coordinator.jobs.size,0);
  assert.equal(x.coordinator.ledger.summary().totalShares,before.totalShares+1);
});
