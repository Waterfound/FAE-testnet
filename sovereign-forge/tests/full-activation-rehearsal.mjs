import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ZERO_HASH,nextDifficulty} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {targetFromHex,targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {encodeFullTargetBlockCandidate,decodeFullTargetBlockCandidate} from '../node/authoritative/full-target-migration-candidate.mjs';
import {
  FULL_ACTIVATION_REHEARSAL_STATUS,buildFullActivationTemplate,mineFullActivationCandidate,
  validateFullActivationCandidate,appendRehearsedCandidate,replayFullActivationChain,compareRehearsedForks
} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';

function h(label){return createHash('sha256').update(String(label)).digest('hex')}
function legacyPrefix(count,{startMs=1_800_000_000_000,spacingMs=180_000}={}){
  const chain=[];for(let height=1;height<=count;height++){const previous=chain.at(-1);chain.push({height,hash:h(`legacy-full-rehearsal-${height}`),previous_hash:previous?.hash??ZERO_HASH,timestamp_ms:startMs+(height-1)*spacingMs,difficulty_bits:nextDifficulty(chain),reward_atoms:'1000000000'});}return chain;
}

const miner=encodeAddress(sha256(Buffer.from('full-activation-rehearsal-miner')).subarray(0,20),'faet');
const policy=freezeActivationPolicy({activationHeight:4});
const prefix=legacyPrefix(3);
const activationTimestamp=prefix.at(-1).timestamp_ms+6*60*60_000+180_000;

assert.equal(FULL_ACTIVATION_REHEARSAL_STATUS,'candidate-not-active-consensus');
const template=buildFullActivationTemplate(prefix,policy,{minerAddress:miner,timestampMs:activationTimestamp});
assert.equal(template.header.height,4);assert.equal(template.header.difficulty_bits,undefined);assert.match(template.header.target_hex,/^[0-9a-f]{64}$/);

const mined4=mineFullActivationCandidate(prefix,policy,{minerAddress:miner,timestampMs:activationTimestamp,maxNonce:5_000_000});
assert.equal(mined4.verdict.ok,true);assert.ok(mined4.attempts>0);
assert.deepEqual(decodeFullTargetBlockCandidate(encodeFullTargetBlockCandidate(mined4.candidate)),mined4.candidate);

// JSON object key order is transport syntax, not block semantics. Reordering all
// header keys must preserve hash/PoW and must not fail the binary-codec parity gate.
const reorderedHeader=Object.fromEntries(Object.entries(mined4.candidate.header).reverse());
const reorderedCandidate={txids:[...mined4.candidate.txids],hash:mined4.candidate.hash,nonce:mined4.candidate.nonce,header:reorderedHeader};
const reorderedVerdict=validateFullActivationCandidate(prefix,reorderedCandidate,policy,{nowMs:activationTimestamp});
assert.equal(reorderedVerdict.ok,true,`semantic key-order variant rejected: ${JSON.stringify(reorderedVerdict)}`);

let chainA=appendRehearsedCandidate(prefix,mined4.candidate,policy,{nowMs:activationTimestamp});

const t5=activationTimestamp+180_000;
const mined5=mineFullActivationCandidate(chainA,policy,{minerAddress:miner,timestampMs:t5,maxNonce:5_000_000});
assert.equal(mined5.verdict.ok,true);chainA=appendRehearsedCandidate(chainA,mined5.candidate,policy,{nowMs:t5});
const replay=replayFullActivationChain(JSON.parse(JSON.stringify(chainA)),policy);assert.equal(replay.ok,true);assert.equal(replay.tip.height,5);

const wrongPolicy=freezeActivationPolicy({activationHeight:4,halfLifeSeconds:12*60*60});
const mismatch=validateFullActivationCandidate(prefix,mined4.candidate,policy,{remotePolicyDescriptor:activationPolicyDescriptor(wrongPolicy),nowMs:activationTimestamp});
assert.equal(mismatch.ok,false);assert.equal(mismatch.stage,'policy');assert.equal(mismatch.error,'activation_policy_mismatch');

const badHash={...mined4.candidate,hash:'f'.repeat(64)};
const badHashVerdict=validateFullActivationCandidate(prefix,badHash,policy,{nowMs:activationTimestamp});
assert.equal(badHashVerdict.ok,false);assert.equal(badHashVerdict.error,'hash_mismatch');

const wrongTarget=targetFromHex(mined4.candidate.header.target_hex)-1n;
const badTarget={...mined4.candidate,header:{...mined4.candidate.header,target_hex:targetHex(wrongTarget)}};
const badTargetVerdict=validateFullActivationCandidate(prefix,badTarget,policy,{nowMs:activationTimestamp});
assert.equal(badTargetVerdict.ok,false);assert.equal(badTargetVerdict.error,'unexpected_activation_target');

const future=validateFullActivationCandidate(prefix,mined4.candidate,policy,{nowMs:activationTimestamp-policy.future_drift_ms-1});
assert.equal(future.ok,false);assert.equal(future.error,'timestamp_too_far_future');
assert.throws(()=>buildFullActivationTemplate(prefix,policy,{minerAddress:miner,timestampMs:activationTimestamp,txids:['a','a']}),/duplicate_txid/);

// Competing valid branch with a much larger activation delay receives an easier
// ASERT target and therefore less cumulative work per solved block. Fork choice
// must use work, not height or arrival order.
const slowT4=prefix.at(-1).timestamp_ms+12*60*60_000+180_000;
const slow4=mineFullActivationCandidate(prefix,policy,{minerAddress:miner,timestampMs:slowT4,maxNonce:5_000_000});
let chainB=appendRehearsedCandidate(prefix,slow4.candidate,policy,{nowMs:slowT4});
const slowT5=slowT4+180_000;
const slow5=mineFullActivationCandidate(chainB,policy,{minerAddress:miner,timestampMs:slowT5,maxNonce:5_000_000});
chainB=appendRehearsedCandidate(chainB,slow5.candidate,policy,{nowMs:slowT5});
const fork=compareRehearsedForks(chainA,chainB,policy);assert.equal(fork.winner,'a');assert.ok(fork.a_work>fork.b_work);

console.log(JSON.stringify({status:'PASS',activation_height:policy.activation_height,tip_height:chainA.at(-1).height,policy_guard:true,codec_roundtrip:true,codec_key_order_invariant:true,pow_verified:true,replay:true,fork_choice:'a',attempts:mined4.attempts+mined5.attempts+slow4.attempts+slow5.attempts}));
