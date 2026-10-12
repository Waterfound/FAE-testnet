import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,appendBlockFromFeed} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {reconcileFullTargetAgainstVerifiedChain as reconcile} from './full-target-chain-inclusion-candidate.mjs';

function sourceScenario(){
  const target=legacyBlocks[5],ledger=new ShareLedger();
  const proof={jobId:'source-owned-historical-block-proof',nonce:target.nonce,hash:target.hash};
  ledger.append({jobId:proof.jobId,address:target.miner_address,
    nonce:proof.nonce,hash:proof.hash,shareDifficultyBits:12,
    blockDifficultyBits:target.difficulty_bits,height:target.height,
    previousBlockHash:target.previous_hash});
  function replay(count){
    let state=emptyState();
    for(const b of legacyBlocks.slice(0,count))
      state=appendBlockFromFeed(state,b,new Map(),{activationHeight:null});
    return state;
  }
  return{ledger,proof,target,includedState:replay(7),notYetSeenState:replay(5)};
}
test('HPA-W3-25: source-replayed real PoW block is observed only when exact hash is in independently verified chain',()=>{
  const {ledger,proof,includedState,target}=sourceScenario();
  const r=reconcile({ledger,...proof,rawChainState:includedState});
  assert.equal(r.verdict,'INCLUDED_IN_THIS_VERIFIED_CHAIN_ONLY');
  assert.equal(r.block_hash,target.hash);
  assert.equal(r.source_tip_hash,includedState.chain.at(-1).hash);
  assert.equal(r.confirmed,true);
  assert.equal(r.observed_depth,2);
  assert.equal(r.finality_guaranteed,false);
  assert.equal(r.safe_to_auto_resubmit,false);
});
test('HPA-W3-26: missing block at a smaller genuine verified tip is inconclusive, never an automatic resend license',()=>{
  const {ledger,proof,notYetSeenState}=sourceScenario();
  const r=reconcile({ledger,...proof,rawChainState:notYetSeenState});
  assert.equal(r.verdict,'NOT_OBSERVED_AT_THIS_VERIFIED_TIP');
  assert.equal(r.confirmed,false);
  assert.equal(r.inclusion_unknown,true);
  assert.equal(r.safe_to_auto_resubmit,false);
});
test('HPA-W3-27: a corrupt or forged persisted chain cannot fabricate full-target block inclusion',()=>{
  const {ledger,proof,includedState}=sourceScenario();
  for(const tamper of [
    state=>{state.chain[5].hash='f'.repeat(64)},
    state=>{state.chain[5].nonce+=1},
    state=>{state.chain[5].previous_hash='a'.repeat(64)}
  ]){
    const bad=structuredClone(includedState);tamper(bad);
    assert.throws(()=>reconcile({ledger,...proof,rawChainState:bad}));
  }
});
test('HPA-W3-28: unknown or mismatched share identity fails closed before chain inclusion classification',()=>{
  const {ledger,proof,includedState}=sourceScenario();
  assert.throws(()=>reconcile({ledger,...proof,jobId:'unknown',rawChainState:includedState}),
    e=>e.code==='no_durable_share_evidence');
  assert.throws(()=>reconcile({ledger,...proof,hash:'f'.repeat(64),rawChainState:includedState}),
    e=>e.code==='full_target_share_evidence_mismatch');
  assert.throws(()=>reconcile({ledger,...proof,nonce:-1,rawChainState:includedState}),
    e=>e.code==='invalid_full_target_reconciliation_input');
});
