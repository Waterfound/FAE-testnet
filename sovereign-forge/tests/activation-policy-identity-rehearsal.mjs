import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nextDifficulty,ZERO_HASH} from '../node/authoritative/fae-v4-core.mjs';
import {freezeActivationPolicy,deriveBranchActivationContext,expectedBranchTarget,validateBranchChain} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor,activationPolicyId,assertActivationPolicyCompatible} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';

function h(label){return createHash('sha256').update(String(label)).digest('hex')}
function legacyPrefix(count,{spacingMs=90_000,startMs=1_800_000_000_000}={}){
  const chain=[];
  for(let height=1;height<=count;height++){
    const previous=chain.at(-1);
    chain.push({height,hash:h(`legacy-${height}`),previous_hash:previous?.hash??ZERO_HASH,timestamp_ms:startMs+(height-1)*spacingMs,difficulty_bits:nextDifficulty(chain),reward_atoms:'0'});
  }
  return chain;
}
function extendActivated(prefix,policy,count=3){
  const chain=structuredClone(prefix),context=deriveBranchActivationContext(chain.slice(0,policy.activation_height-1),policy);
  let previous=chain.at(-1);
  for(let i=0;i<count;i++){
    const height=policy.activation_height+i,ts=Number(previous.timestamp_ms)+180_000;
    const target=expectedBranchTarget({height,timestampMs:ts,context});
    const block={height,hash:h(`active-${policy.activation_height}-${height}`),previous_hash:previous.hash,timestamp_ms:ts,target_hex:targetHex(target),reward_atoms:'0'};
    chain.push(block);previous=block;
  }
  return chain;
}

// Deterministic identity: same parameters -> same id, any consensus-relevant change -> mismatch.
const base=freezeActivationPolicy({activationHeight:21});
const clone=freezeActivationPolicy({activationHeight:21});
assert.equal(activationPolicyId(base),activationPolicyId(clone));
const baseDescriptor=activationPolicyDescriptor(base);
assert.equal(assertActivationPolicyCompatible(base,baseDescriptor).ok,true);
for(const changed of [
  freezeActivationPolicy({activationHeight:22}),
  freezeActivationPolicy({activationHeight:21,halfLifeSeconds:12*60*60}),
  freezeActivationPolicy({activationHeight:21,targetSeconds:300}),
  freezeActivationPolicy({activationHeight:21,mtpWindow:9}),
  freezeActivationPolicy({activationHeight:21,futureDriftMs:120_000})
]){
  const verdict=assertActivationPolicyCompatible(base,activationPolicyDescriptor(changed));
  assert.equal(verdict.ok,false);assert.equal(verdict.error,'activation_policy_mismatch');
}
assert.equal(assertActivationPolicyCompatible(base,{status:'candidate-not-active-consensus',policy_id:'xyz'}).error,'activation_policy_descriptor_required');

// Retarget-boundary rehearsal. The 90s legacy cadence causes the legacy batch DAA
// to increase bits at height 21. Activation before/on/after that boundary must
// derive the correct branch-local anchor difficulty.
const prefix22=legacyPrefix(22,{spacingMs:90_000});
assert.equal(prefix22[18].difficulty_bits,18); // h19
assert.equal(prefix22[19].difficulty_bits,18); // h20
assert.equal(prefix22[20].difficulty_bits,19); // h21 retargeted
assert.equal(prefix22[21].difficulty_bits,19); // h22 inherits

const cases=[
  {activationHeight:20,expectedAnchorBits:18},
  {activationHeight:21,expectedAnchorBits:19},
  {activationHeight:22,expectedAnchorBits:19}
];
for(const scenario of cases){
  const policy=freezeActivationPolicy({activationHeight:scenario.activationHeight});
  const prefix=prefix22.slice(0,scenario.activationHeight-1);
  const context=deriveBranchActivationContext(prefix,policy);
  assert.equal(context.anchor_difficulty_bits,scenario.expectedAnchorBits,`anchor bits at H=${scenario.activationHeight}`);
  assert.equal(context.anchor_parent_height,scenario.activationHeight-1);
  const chain=extendActivated(prefix,policy,4);
  const validated=validateBranchChain(chain,policy);
  assert.equal(validated.ok,true);
  assert.equal(validated.context.anchor_difficulty_bits,scenario.expectedAnchorBits);
}

// Two nodes at same chain tip but different policy identity must refuse compatibility
// before fork-choice or block acceptance is attempted.
const remoteWrong=activationPolicyDescriptor(freezeActivationPolicy({activationHeight:21,halfLifeSeconds:21601}));
const handshake=assertActivationPolicyCompatible(base,remoteWrong);
assert.equal(handshake.ok,false);assert.equal(handshake.error,'activation_policy_mismatch');

console.log(JSON.stringify({status:'PASS',policy_id:baseDescriptor.policy_id,retarget_cases:cases.length,mismatch_guards:6}));
