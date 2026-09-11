import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nextDifficulty,ZERO_HASH} from '../node/authoritative/fae-v4-core.mjs';
import {targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {
  freezeActivationPolicy,deriveBranchActivationContext,expectedBranchTarget,validateBranchBlock,
  validateBranchChain,compareBranchForks,rollbackBranch,replayBranchState
} from '../node/authoritative/activation-reorg-candidate.mjs';
import {referenceEvaluate,referenceCompare} from '../node/authoritative/activation-reorg-reference.mjs';

const policy=freezeActivationPolicy({activationHeight:25,halfLifeSeconds:6*60*60,targetSeconds:180,mtpWindow:11,futureDriftMs:90_000});
function fakeHash(label){return createHash('sha256').update(label).digest('hex')}
function legacyBlock(chain,height,ts,label){return{height,hash:fakeHash(`${label}:${height}:${ts}`),previous_hash:chain.at(-1)?.hash??ZERO_HASH,timestamp_ms:ts,difficulty_bits:nextDifficulty(chain)};}
function modernBlock(chain,height,ts,label){const context=deriveBranchActivationContext(chain.slice(0,policy.activation_height-1),policy);return{height,hash:fakeHash(`${label}:${height}:${ts}`),previous_hash:chain.at(-1)?.hash??ZERO_HASH,timestamp_ms:ts,target_hex:targetHex(expectedBranchTarget({height,timestampMs:ts,context}))};}
function extend(chain,toHeight,{label='x',stepMs=180_000,skew=0}={}){const out=structuredClone(chain);while(out.length<toHeight){const h=out.length+1,base=(out.at(-1)?.timestamp_ms??1_789_000_000_000)+stepMs+skew;if(h<policy.activation_height)out.push(legacyBlock(out,h,base,label));else out.push(modernBlock(out,h,base,label));}return out;}

// Common history, then two forks begin below activation and independently cross H=25.
const common=extend([],21,{label:'common'});
const forkA=extend(common,31,{label:'A',stepMs:180_000});
const forkB=extend(common,32,{label:'B',stepMs:210_000});
const a=validateBranchChain(forkA,policy),b=validateBranchChain(forkB,policy);
assert.equal(a.ok,true);assert.equal(b.ok,true);assert.notEqual(a.context.anchor_parent_hash,b.context.anchor_parent_hash);
assert.equal(a.context.anchor_parent_hash,forkA[23].hash);assert.equal(b.context.anchor_parent_hash,forkB[23].hash);

// Differential implementation must reproduce work, anchor and fork choice exactly.
const ar=referenceEvaluate(forkA,policy),br=referenceEvaluate(forkB,policy);assert.equal(a.work,ar.work);assert.equal(b.work,br.work);assert.deepEqual(a.context,ar.context);assert.deepEqual(b.context,br.context);
const cmp=compareBranchForks(forkA,forkB,policy),refCmp=referenceCompare(forkA,forkB,policy);assert.equal(cmp.winner,refCmp.winner);assert.equal(cmp.a_work,refCmp.a_work);assert.equal(cmp.b_work,refCmp.b_work);

// Roll back from modern regime to H=21, then enter activation again on a third branch.
const rolled=rollbackBranch(forkA,21,policy);assert.equal(rolled.state.regime,'legacy');assert.equal(rolled.state.context,null);
const forkC=extend(rolled.chain,30,{label:'C',stepMs:150_000});const c=validateBranchChain(forkC,policy);assert.notEqual(c.context.anchor_parent_hash,a.context.anchor_parent_hash);assert.equal(c.context.anchor_parent_hash,forkC[23].hash);

// Restart/replay cannot retain stale branch-local activation state.
const replayA=replayBranchState(JSON.stringify(forkA),policy),replayC=replayBranchState(JSON.stringify(forkC),policy);assert.equal(replayA.work,a.work.toString());assert.equal(replayA.context.anchor_parent_hash,a.context.anchor_parent_hash);assert.equal(replayC.context.anchor_parent_hash,c.context.anchor_parent_hash);assert.notEqual(replayA.context.anchor_parent_hash,replayC.context.anchor_parent_hash);

// Re-entry with a stale target derived from old branch A must fail closed on C.
const stale={...forkC[24],target_hex:forkA[24].target_hex};if(stale.target_hex===forkC[24].target_hex)stale.target_hex='f'.repeat(64);const staleVerdict=validateBranchBlock(forkC.slice(0,24),stale,policy);assert.equal(staleVerdict.ok,false);assert.equal(staleVerdict.error,'unexpected_activation_target');

// Encoding ambiguity around boundary is forbidden.
const premature={...forkA[23],target_hex:'0'.repeat(63)+'1'};assert.equal(validateBranchBlock(forkA.slice(0,23),premature,policy).error,'pre_activation_target_forbidden');
const mixed={...forkA[24],difficulty_bits:nextDifficulty(forkA.slice(0,24))};assert.equal(validateBranchBlock(forkA.slice(0,24),mixed,policy).error,'post_activation_legacy_bits_forbidden');

// Timestamp adversaries: MTP equality, parent regression and arrival-time future drift.
const prefix=forkA.slice(0,27),ctx=a.context;const mtpValues=prefix.slice(-policy.mtp_window).map(x=>x.timestamp_ms).sort((x,y)=>x-y),mtp=mtpValues[Math.floor(mtpValues.length/2)];
const mtpBlock={height:28,hash:fakeHash('mtp'),previous_hash:prefix.at(-1).hash,timestamp_ms:mtp,target_hex:targetHex(expectedBranchTarget({height:28,timestampMs:mtp,context:ctx}))};assert.equal(validateBranchBlock(prefix,mtpBlock,policy,{context:ctx}).error,'timestamp_before_parent');
const futureTs=prefix.at(-1).timestamp_ms+180_000,futureBlock={height:28,hash:fakeHash('future'),previous_hash:prefix.at(-1).hash,timestamp_ms:futureTs,target_hex:targetHex(expectedBranchTarget({height:28,timestampMs:futureTs,context:ctx}))};assert.equal(validateBranchBlock(prefix,futureBlock,policy,{context:ctx,enforceFutureDrift:true,nowMs:futureTs-policy.future_drift_ms-1}).error,'timestamp_too_far_future');

// Linkage corruption and restart corruption are rejected rather than normalized.
const corrupt=structuredClone(forkA);corrupt[22].previous_hash=fakeHash('wrong-parent');assert.throws(()=>validateBranchChain(corrupt,policy),/previous_hash_mismatch/);assert.throws(()=>replayBranchState(JSON.stringify(corrupt),policy),/previous_hash_mismatch/);

console.log(JSON.stringify({status:'PASS',activation_height:policy.activation_height,forks_crossed_boundary:3,rollback_reentry:true,restart_replay:true,differential_reference:true,stale_anchor_rejected:true,winner:cmp.winner}));
