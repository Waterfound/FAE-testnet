import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ZERO_HASH,nextDifficulty} from '../node/authoritative/fae-v4-core.mjs';
import {targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {
  ACTIVATION_REORG_STATUS,
  freezeActivationPolicy,
  deriveBranchActivationContext,
  expectedBranchTarget,
  validateBranchBlock,
  validateBranchChain,
  compareBranchForks,
  rollbackBranch,
  replayBranchState
} from '../node/authoritative/activation-reorg-candidate.mjs';
import {referenceEvaluate,referenceCompare} from '../node/authoritative/activation-reorg-reference.mjs';

const H=7;
const policy=freezeActivationPolicy({
  activationHeight:H,
  halfLifeSeconds:6*60*60,
  targetSeconds:180,
  mtpWindow:11,
  futureDriftMs:90_000
});

function hash(label){return createHash('sha256').update(String(label)).digest('hex');}
function legacyBlock(chain,height,timestampMs,label){
  return {
    height,
    hash:hash(`${label}:legacy:${height}:${timestampMs}`),
    previous_hash:chain.at(-1)?.hash??ZERO_HASH,
    timestamp_ms:timestampMs,
    difficulty_bits:nextDifficulty(chain)
  };
}
function fullTargetBlock(chain,height,timestampMs,label){
  const context=deriveBranchActivationContext(chain.slice(0,H-1),policy);
  return {
    height,
    hash:hash(`${label}:full-target:${height}:${timestampMs}`),
    previous_hash:chain.at(-1)?.hash??ZERO_HASH,
    timestamp_ms:timestampMs,
    target_hex:targetHex(expectedBranchTarget({height,timestampMs,context}))
  };
}
function extend(seed,toHeight,{label='branch',stepMs=180_000}={}){
  const chain=structuredClone(seed);
  while(chain.length<toHeight){
    const height=chain.length+1;
    const timestampMs=(chain.at(-1)?.timestamp_ms??1_800_000_000_000)+stepMs;
    chain.push(height<H?legacyBlock(chain,height,timestampMs,label):fullTargetBlock(chain,height,timestampMs,label));
  }
  return chain;
}

assert.equal(ACTIVATION_REORG_STATUS,'candidate-not-active-consensus');
const canonical=extend([],H+2,{label:'canonical',stepMs:180_000});
const canonicalVerdict=validateBranchChain(canonical,policy);
assert.equal(canonicalVerdict.ok,true);
assert.equal(canonicalVerdict.tip.height,H+2);

// Exact activation boundary: H-2, H-1 remain legacy; H, H+1, H+2 are full-target.
const exactHeights=[H-2,H-1,H,H+1,H+2];
const exactRegimes=new Map();
for(const height of exactHeights){
  const prefix=canonical.slice(0,height-1);
  const context=height>=H?deriveBranchActivationContext(prefix.slice(0,H-1),policy):null;
  const verdict=validateBranchBlock(prefix,canonical[height-1],policy,{context});
  assert.equal(verdict.ok,true,`height ${height} rejected: ${verdict.error??'unknown'}`);
  exactRegimes.set(height,verdict.regime);
}
assert.equal(exactRegimes.get(H-2),'legacy');
assert.equal(exactRegimes.get(H-1),'legacy');
assert.equal(exactRegimes.get(H),'full-target');
assert.equal(exactRegimes.get(H+1),'full-target');
assert.equal(exactRegimes.get(H+2),'full-target');

// Wire-format ambiguity must fail closed on both sides of H.
const premature={...canonical[H-2],target_hex:'0'.repeat(63)+'1'};
assert.equal(validateBranchBlock(canonical.slice(0,H-2),premature,policy).error,'pre_activation_target_forbidden');
const mixedAtH={...canonical[H-1],difficulty_bits:nextDifficulty(canonical.slice(0,H-1))};
assert.equal(validateBranchBlock(canonical.slice(0,H-1),mixedAtH,policy).error,'post_activation_legacy_bits_forbidden');

// Restart/replay at every critical boundary snapshot must derive state from chain bytes,
// never from retained process-local activation context.
for(const height of exactHeights){
  const snapshot=canonical.slice(0,height);
  const replay=replayBranchState(JSON.stringify(snapshot),policy);
  const direct=validateBranchChain(snapshot,policy);
  assert.equal(replay.height,height);
  assert.equal(replay.tip_hash,snapshot.at(-1).hash);
  assert.equal(replay.work,direct.work.toString());
  if(height<H)assert.equal(replay.context,null);
  else{
    assert.ok(replay.context);
    assert.equal(replay.context.anchor_parent_hash,canonical[H-2].hash);
  }
}

// Roll back from H+2 to H-1 and cross H again. Because the H-1 parent is unchanged,
// the activation anchor identity must remain unchanged after restart/re-entry.
const rollbackToHMinus1=rollbackBranch(canonical,H-1,policy);
assert.equal(rollbackToHMinus1.state.height,H-1);
assert.equal(rollbackToHMinus1.state.regime,'legacy');
assert.equal(rollbackToHMinus1.state.context,null);
const sameParentReentry=extend(rollbackToHMinus1.chain,H+2,{label:'same-parent-reentry',stepMs:195_000});
const sameParentReplay=replayBranchState(JSON.stringify(sameParentReentry),policy);
assert.equal(sameParentReplay.context.anchor_parent_hash,canonicalVerdict.context.anchor_parent_hash);

// Roll back one block deeper to H-2, create a different H-1 parent, and re-enter.
// The activation context must be re-derived from that branch; stale targets from the
// abandoned branch must fail closed.
const rollbackToHMinus2=rollbackBranch(canonical,H-2,policy);
const diverged=extend(rollbackToHMinus2.chain,H+2,{label:'diverged-reentry',stepMs:240_000});
const divergedVerdict=validateBranchChain(diverged,policy);
assert.notEqual(divergedVerdict.context.anchor_parent_hash,canonicalVerdict.context.anchor_parent_hash);
assert.equal(divergedVerdict.context.anchor_parent_hash,diverged[H-2].hash);

const staleAtH={...diverged[H-1],target_hex:canonical[H-1].target_hex};
if(staleAtH.target_hex===diverged[H-1].target_hex)staleAtH.target_hex='f'.repeat(64);
const staleVerdict=validateBranchBlock(diverged.slice(0,H-1),staleAtH,policy);
assert.equal(staleVerdict.ok,false);
assert.equal(staleVerdict.error,'unexpected_activation_target');

// Independent reference implementation must agree on state/work and fork choice.
const canonicalReference=referenceEvaluate(canonical,policy);
const divergedReference=referenceEvaluate(diverged,policy);
assert.equal(canonicalVerdict.work,canonicalReference.work);
assert.equal(divergedVerdict.work,divergedReference.work);
assert.deepEqual(canonicalVerdict.context,canonicalReference.context);
assert.deepEqual(divergedVerdict.context,divergedReference.context);
const candidateFork=compareBranchForks(canonical,diverged,policy);
const referenceFork=referenceCompare(canonical,diverged,policy);
assert.equal(candidateFork.winner,referenceFork.winner);
assert.equal(candidateFork.a_work,referenceFork.a_work);
assert.equal(candidateFork.b_work,referenceFork.b_work);

console.log(JSON.stringify({
  status:'PASS',
  authority:'candidate-not-active-consensus',
  activation_height:H,
  exact_window:['H-2','H-1','H','H+1','H+2'],
  restart_snapshots:exactHeights.length,
  rollback_h_minus_1_reentry:true,
  rollback_h_minus_2_new_context:true,
  stale_context_rejected:true,
  differential_reference:true,
  fork_winner:candidateFork.winner
}));
