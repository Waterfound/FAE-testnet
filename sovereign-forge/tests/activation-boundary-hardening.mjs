import assert from 'node:assert/strict';
import {freezeActivationBoundary,regimeForHeight,expectedTargetAtHeight,validateBoundaryBlock,cumulativeMixedWork,compareBoundaryForks,rollbackCrossesActivation} from '../node/authoritative/activation-boundary-candidate.mjs';
import {targetHex,targetFromLeadingZeroBits} from '../node/authoritative/difficulty-timestamp-candidate.mjs';

const H='0000013c2316890ee3111e9090f5e02fd72b54471a01ae6dd045a1d7d111e356';
const boundary=freezeActivationBoundary({activationHeight:410,anchorHeight:410,anchorHash:H,anchorDifficultyBits:22,anchorParentTimeSeconds:1789010968});
assert.equal(regimeForHeight(409,boundary),'legacy');assert.equal(regimeForHeight(410,boundary),'full-target');
assert.throws(()=>freezeActivationBoundary({...boundary,activationHeight:411,anchorHeight:410}),/activation_anchor_height_mismatch/);

const legacy={height:409,timestamp_ms:1789010968616,difficulty_bits:22};
assert.equal(validateBoundaryBlock(legacy,boundary).ok,true);
assert.equal(validateBoundaryBlock({...legacy,target_hex:targetHex(targetFromLeadingZeroBits(22))},boundary).error,'pre_activation_target_forbidden');

function modern(height,timestamp_ms){return{height,timestamp_ms,target_hex:targetHex(expectedTargetAtHeight({height,timestampMs:timestamp_ms,boundary}))};}
const b410=modern(410,1789011110822),b411=modern(411,1789011733516),b412=modern(412,1789017612313);
for(const b of [b410,b411,b412])assert.equal(validateBoundaryBlock(b,boundary).ok,true);
assert.equal(validateBoundaryBlock({...b410,difficulty_bits:22},boundary).error,'post_activation_legacy_bits_forbidden');
assert.equal(validateBoundaryBlock({...b410,target_hex:targetHex(targetFromLeadingZeroBits(22))},boundary).error,'unexpected_activation_target');

const mixed=[legacy,b410,b411,b412];assert(cumulativeMixedWork(mixed,boundary)>0n);
assert.equal(rollbackCrossesActivation({oldTipHeight:412,newTipHeight:409,boundary}).crosses,true);
assert.equal(rollbackCrossesActivation({oldTipHeight:412,newTipHeight:410,boundary}).crosses,false);

const forkA=[legacy,b410,b411];
const b410slow=modern(410,1789012000000),b411slow=modern(411,1789012180000);
const forkB=[legacy,b410slow,b411slow];
const cmp=compareBoundaryForks(forkA,forkB,boundary);assert(['a','b','tie'].includes(cmp.winner));assert(cmp.a_work>0n&&cmp.b_work>0n);

assert.throws(()=>cumulativeMixedWork([legacy,b411],boundary),/noncontiguous_chain/);
console.log(JSON.stringify({status:'PASS',activation_height:boundary.activation_height,rollback_cross_boundary:true,mixed_work:true,fork_winner:cmp.winner}));
