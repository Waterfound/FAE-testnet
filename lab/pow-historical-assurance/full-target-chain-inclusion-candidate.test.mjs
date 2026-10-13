import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareLedger} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {emptyState,appendBlockFromFeed} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from '../../sovereign-forge/tests/legacy-testnet-fixture.mjs';
import {reconcileFullTargetAgainstVerifiedChain as reconcile,
  reconcileFullTargetAgainstAnchoredLedger as reconcileAnchored,
  reconcileFullTargetAgainstPinnedSignedWitness as reconcileSigned,
  verifyPinnedSignedLedgerWitness as verifyWitness} from './full-target-chain-inclusion-candidate.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash,sign as edSign} from 'node:crypto';
import {NETWORK} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';

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

async function anchoredScenario(){
  const scenario=sourceScenario();
  const dir=await mkdtemp(join(tmpdir(),'fae-hpa-anchored-w3-'));
  const logFile=join(dir,'source-share-ledger.jsonl');
  const persistent=new ShareLedger({logFile});
  const entry=scenario.ledger.shares[0];
  persistent.append({
    jobId:entry.jobId,address:entry.address,nonce:entry.nonce,
    hash:entry.hash,shareDifficultyBits:entry.shareDifficultyBits,
    blockDifficultyBits:entry.blockDifficultyBits,height:entry.height,
    previousBlockHash:entry.previousBlockHash
  });
  const anchor=()=>{
    return {logFile,expectedLastEntryHash:persistent.lastHash,
      expectedTotalShares:persistent.shares.length};
  };
  return {...scenario,dir,logFile,persistent,anchor};
}

test('HPA-W3-51: real persisted ShareLedger replay and exact external head/length anchor permit only a local inclusion witness',async()=>{
  const s=await anchoredScenario();
  try{
    const r=reconcileAnchored({...s.anchor(),...s.proof,rawChainState:s.includedState});
    assert.equal(r.verdict,'INCLUDED_IN_THIS_VERIFIED_CHAIN_ONLY');
    assert.equal(r.source_ledger_replayed_and_anchor_matched,true);
    assert.equal(r.source_ledger_head_hash,s.persistent.lastHash);
    assert.equal(r.source_ledger_share_count,1);
    assert.equal(r.external_checkpoint_authenticity_verified_here,false);
    assert.equal(r.independently_observed_finality,false);
    assert.equal(r.finality_guaranteed,false);
    assert.equal(r.safe_to_auto_resubmit,false);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});

test('HPA-W3-52: an in-memory fabricated share identity or missing external anchor cannot impersonate a durable ledger',async()=>{
  const s=await anchoredScenario();
  try{
    const forged={seen:new Set([s.proof.jobId+':'+s.proof.nonce]),
      shares:[{...s.persistent.shares[0]}]};
    // The original read-only predicate accepts duck-typed source-shaped
    // objects; it MUST NOT be promoted into a durable proof admission gate.
    assert.equal(reconcile({ledger:forged,...s.proof,
      rawChainState:s.includedState}).confirmed,true);
    assert.throws(()=>reconcileAnchored({...s.proof,rawChainState:s.includedState}),
      e=>e.code==='invalid_anchored_ledger_input');
    assert.throws(()=>reconcileAnchored({...s.anchor(),
      expectedLastEntryHash:'a'.repeat(64),...s.proof,
      rawChainState:s.includedState}),
      e=>e.code==='share_ledger_anchor_mismatch');
    assert.throws(()=>reconcileAnchored({...s.anchor(),
      expectedTotalShares:0,...s.proof,rawChainState:s.includedState}),
      e=>e.code==='invalid_anchored_ledger_input');
  }finally{await rm(s.dir,{recursive:true,force:true})}
});

test('HPA-W3-53: malformed source entry and valid-prefix truncation both fail before block inclusion classification',async()=>{
  const s=await anchoredScenario();
  try{
    const original=await readFile(s.logFile,'utf8');
    const modified=JSON.parse(original.trim());
    modified.hash='f'.repeat(64);
    await writeFile(s.logFile,JSON.stringify(modified)+'\n');
    assert.throws(()=>reconcileAnchored({...s.anchor(),...s.proof,
      rawChainState:s.includedState}),/hash mismatch/i);

    await writeFile(s.logFile,original);
    const firstAnchor=s.anchor();
    const entry=s.persistent.shares[0];
    s.persistent.append({jobId:'independent-later-proof',address:entry.address,
      nonce:entry.nonce+1,hash:entry.hash,shareDifficultyBits:entry.shareDifficultyBits,
      blockDifficultyBits:entry.blockDifficultyBits,height:entry.height,
      previousBlockHash:entry.previousBlockHash});
    const twoEntryAnchor=s.anchor();
    assert.equal(reconcileAnchored({...twoEntryAnchor,...s.proof,
      rawChainState:s.includedState}).confirmed,true);
    // The first line is still self-consistent, but an anchored suffix is gone.
    await writeFile(s.logFile,original);
    assert.throws(()=>reconcileAnchored({...twoEntryAnchor,...s.proof,
      rawChainState:s.includedState}),
      e=>e.code==='share_ledger_anchor_mismatch');
    assert.equal(reconcileAnchored({...firstAnchor,...s.proof,
      rawChainState:s.includedState}).confirmed,true);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});

test('HPA-W3-54: even anchored real share proof is INCONCLUSIVE at a shorter valid chain tip',async()=>{
  const s=await anchoredScenario();
  try{
    const r=reconcileAnchored({...s.anchor(),...s.proof,
      rawChainState:s.notYetSeenState});
    assert.equal(r.verdict,'NOT_OBSERVED_AT_THIS_VERIFIED_TIP');
    assert.equal(r.inclusion_unknown,true);
    assert.equal(r.safe_to_auto_resubmit,false);
    assert.equal(r.external_checkpoint_authenticity_verified_here,false);
    assert.equal(r.source_ledger_replayed_and_anchor_matched,true);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});

function signedWitnessFixture(s){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  const trustedWitness={
    witnessId:'fixture-separately-pinned-witness',
    ledgerId:'source-ledger-specific-fixture',
    minimumSequence:7,
    spkiDerBase64:spki.toString('base64'),
    spkiSha256:createHash('sha256').update(spki).digest('hex')
  };
  const payload={
    domain:'FAE_HPA_DURABLE_LEDGER_WITNESS_V1',network:NETWORK,
    witnessId:trustedWitness.witnessId,ledgerId:trustedWitness.ledgerId,
    sequence:7,shareCount:s.persistent.shares.length,lastEntryHash:s.persistent.lastHash
  };
  const seal=(next)=>({
    payload:next,
    signatureBase64:edSign(null,Buffer.from(stableStringify(next),'utf8'),privateKey).toString('base64')
  });
  return {trustedWitness,privateKey,witnessReceipt:seal(payload),seal};
}
test('HPA-W3-55: out-of-band pinned Ed25519 key verifies source-backed durable chain only, never independent third-party authority',async()=>{
  const s=await anchoredScenario();
  try{
    const w=signedWitnessFixture(s);
    const r=reconcileSigned({logFile:s.logFile,witnessReceipt:w.witnessReceipt,
      trustedWitness:w.trustedWitness,...s.proof,rawChainState:s.includedState});
    assert.equal(r.verdict,'INCLUDED_IN_THIS_VERIFIED_CHAIN_ONLY');
    assert.equal(r.witness_signature_valid,true);
    assert.equal(r.source_ledger_replayed_and_anchor_matched,true);
    assert.equal(r.actual_independent_witness_observation_proven,false);
    assert.equal(r.independent_witness_identity_authenticated,false);
    assert.equal(r.external_evidence_gate_open,true);
    assert.equal(r.finality_guaranteed,false);
    assert.equal(r.safe_to_auto_resubmit,false);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});
test('HPA-W3-56: missing trusted key and substitution with attacker-controlled signed key cannot satisfy independently pinned fingerprint',async()=>{
  const s=await anchoredScenario();
  try{
    const w=signedWitnessFixture(s);
    assert.throws(()=>verifyWitness({witnessReceipt:w.witnessReceipt}),
      e=>e.code==='invalid_pinned_witness_inputs');
    const impostor=signedWitnessFixture(s);
    assert.throws(()=>verifyWitness({witnessReceipt:impostor.witnessReceipt,
      trustedWitness:w.trustedWitness}),e=>e.code==='pinned_witness_signature_invalid');
    const mismatched={...w.trustedWitness,spkiDerBase64:impostor.trustedWitness.spkiDerBase64};
    assert.throws(()=>verifyWitness({witnessReceipt:impostor.witnessReceipt,
      trustedWitness:mismatched}),e=>e.code==='pinned_witness_key_fingerprint_mismatch');
    // The caller could supply their OWN matching key+signature. Cryptography
    // cannot attest that the key was independently admitted out of band.
    assert.equal(verifyWitness({witnessReceipt:impostor.witnessReceipt,
      trustedWitness:impostor.trustedWitness}).witness_external_independence_verified_here,false);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});
test('HPA-W3-57: stale sequence and cross-network/ledger/witness substitutions fail closed',async()=>{
  const s=await anchoredScenario();
  try{
    const w=signedWitnessFixture(s);
    for(const payload of [
      {...w.witnessReceipt.payload,sequence:6},
      {...w.witnessReceipt.payload,network:'hostile-network'},
      {...w.witnessReceipt.payload,ledgerId:'other-ledger'},
      {...w.witnessReceipt.payload,witnessId:'other-witness'},
      {...w.witnessReceipt.payload,unusedClaim:true}
    ]){
      assert.throws(()=>verifyWitness({witnessReceipt:w.seal(payload),
        trustedWitness:w.trustedWitness}),e=>
          ['witness_scope_or_sequence_mismatch','witness_payload_shape_mismatch'].includes(e.code));
    }
  }finally{await rm(s.dir,{recursive:true,force:true})}
});
test('HPA-W3-58: tampered signed head/count, signature and source-log truncation fail before chain inclusion assertion',async()=>{
  const s=await anchoredScenario();
  try{
    const w=signedWitnessFixture(s);
    for(const key of ['shareCount','lastEntryHash']){
      const corrupted={...w.witnessReceipt.payload,
        [key]:key==='shareCount'?2:'f'.repeat(64)};
      assert.throws(()=>verifyWitness({
        witnessReceipt:{...w.witnessReceipt,payload:corrupted},
        trustedWitness:w.trustedWitness}),e=>e.code==='pinned_witness_signature_invalid');
    }
    const badSig={...w.witnessReceipt,signatureBase64:'A'+w.witnessReceipt.signatureBase64.slice(1)};
    assert.throws(()=>verifyWitness({witnessReceipt:badSig,
      trustedWitness:w.trustedWitness}),e=>e.code==='pinned_witness_signature_invalid');
    const original=await readFile(s.logFile,'utf8');
    await writeFile(s.logFile,'');
    assert.throws(()=>reconcileSigned({logFile:s.logFile,witnessReceipt:w.witnessReceipt,
      trustedWitness:w.trustedWitness,...s.proof,rawChainState:s.includedState}),
      e=>e.code==='share_ledger_anchor_mismatch');
    await writeFile(s.logFile,original);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});
test('HPA-W3-59: authenticated pinned signer is not proof of inclusion at shorter verified tip or safe retransmission',async()=>{
  const s=await anchoredScenario();
  try{
    const w=signedWitnessFixture(s);
    const r=reconcileSigned({logFile:s.logFile,witnessReceipt:w.witnessReceipt,
      trustedWitness:w.trustedWitness,...s.proof,rawChainState:s.notYetSeenState});
    assert.equal(r.verdict,'NOT_OBSERVED_AT_THIS_VERIFIED_TIP');
    assert.equal(r.inclusion_unknown,true);
    assert.equal(r.safe_to_auto_resubmit,false);
    assert.equal(r.external_evidence_gate_open,true);
  }finally{await rm(s.dir,{recursive:true,force:true})}
});
