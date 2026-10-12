import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nextDifficulty,ZERO_HASH} from '../node/authoritative/fae-v4-core.mjs';
import {targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {freezeActivationPolicy,deriveBranchActivationContext,expectedBranchTarget,validateBranchChain,compareBranchForks,replayBranchState} from '../node/authoritative/activation-reorg-candidate.mjs';
import {referenceEvaluate,referenceCompare} from '../node/authoritative/activation-reorg-reference.mjs';

let seed=0x5fae2026;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}function hash(s){return createHash('sha256').update(s).digest('hex')}
function makeBlock(chain,policy,height,ts,label){const base={height,hash:hash(`${label}:${height}:${ts}:${rnd()}`),previous_hash:chain.at(-1)?.hash??ZERO_HASH,timestamp_ms:ts};if(height<policy.activation_height)return{...base,difficulty_bits:nextDifficulty(chain)};const context=deriveBranchActivationContext(chain.slice(0,policy.activation_height-1),policy);return{...base,target_hex:targetHex(expectedBranchTarget({height,timestampMs:ts,context}))};}
function extend(prefix,policy,end,label){const chain=structuredClone(prefix);while(chain.length<end){const step=60_000+(rnd()%421_000),ts=(chain.at(-1)?.timestamp_ms??1_789_000_000_000)+step;chain.push(makeBlock(chain,policy,chain.length+1,ts,label));}return chain;}

let cases=0,distinctContexts=0;
for(let scenario=0;scenario<128;scenario++){
  const activation=22+(rnd()%19),policy=freezeActivationPolicy({activationHeight:activation,halfLifeSeconds:[21600,43200,86400][rnd()%3],targetSeconds:180,mtpWindow:11});
  const divergence=Math.max(2,activation-1-(rnd()%Math.min(12,activation-2))),common=extend([],policy,divergence,`c${scenario}`);
  const a=extend(common,policy,activation+1+(rnd()%14),`a${scenario}`),b=extend(common,policy,activation+1+(rnd()%14),`b${scenario}`);
  const ca=validateBranchChain(a,policy),cb=validateBranchChain(b,policy),ra=referenceEvaluate(a,policy),rb=referenceEvaluate(b,policy);
  assert.equal(ca.work,ra.work);assert.equal(cb.work,rb.work);assert.deepEqual(ca.context,ra.context);assert.deepEqual(cb.context,rb.context);
  const cmp=compareBranchForks(a,b,policy),ref=referenceCompare(a,b,policy);assert.equal(cmp.winner,ref.winner);assert.equal(cmp.a_work,ref.a_work);assert.equal(cmp.b_work,ref.b_work);
  const restartA=replayBranchState(JSON.stringify(a),policy),restartB=replayBranchState(JSON.stringify(b),policy);assert.equal(restartA.work,ca.work.toString());assert.equal(restartB.work,cb.work.toString());assert.deepEqual(restartA.context,ca.context);assert.deepEqual(restartB.context,cb.context);
  if(ca.context.anchor_parent_hash!==cb.context.anchor_parent_hash)distinctContexts++;
  cases++;
}
assert.equal(cases,128);assert(distinctContexts>100);
console.log(JSON.stringify({status:'PASS',seed:'0x5fae2026',cases,distinct_branch_contexts:distinctContexts,differential_reference:true,restart_replay:true}));
