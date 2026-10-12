import assert from 'node:assert/strict';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate,appendRehearsedCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedHeaderRecord,activatedBlockRecord,validateMixedHeaderSequence} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {ACTIVATION_NETWORK_COMPOSITION_STATUS,evaluateActivationReconnect} from '../node/authoritative/activation-network-composition-candidate.mjs';

const address=label=>encodeAddress(sha256(Buffer.from(label)).subarray(0,20),'faet');
const minerA=address('colony-d-miner-a'),minerB=address('colony-d-miner-b');
const policy=freezeActivationPolicy({activationHeight:12});
const descriptor=activationPolicyDescriptor(policy);
const prefix=structuredClone(legacyBlocks);

function buildBranch({miner,delayHours,label}){
  let chain=structuredClone(prefix);
  const t12=chain.at(-1).timestamp_ms+delayHours*60*60_000+180_000;
  const b12=mineFullActivationCandidate(chain,policy,{minerAddress:miner,timestampMs:t12,maxNonce:5_000_000});
  assert.equal(b12.verdict.ok,true,`${label} H12 invalid`);chain=appendRehearsedCandidate(chain,b12.candidate,policy,{nowMs:t12});
  const t13=t12+180_000;
  const b13=mineFullActivationCandidate(chain,policy,{minerAddress:miner,timestampMs:t13,maxNonce:5_000_000});
  assert.equal(b13.verdict.ok,true,`${label} H13 invalid`);chain=appendRehearsedCandidate(chain,b13.candidate,policy,{nowMs:t13});
  return{chain,headers:[activatedHeaderRecord(b12.candidate),activatedHeaderRecord(b13.candidate)],blocks:[activatedBlockRecord(b12.candidate),activatedBlockRecord(b13.candidate)],tip:b13.candidate.hash,nowMs:t13,attempts:b12.attempts+b13.attempts};
}

// During the partition both sides cross the candidate activation boundary. A
// longer activation delay gives branch A easier targets and therefore less work
// per solved block. Branch B should be preferred only after network authority
// is healthy again.
const local=buildBranch({miner:minerA,delayHours:12,label:'local'});
const remote=buildBranch({miner:minerB,delayHours:6,label:'remote'});
const remotePlan=validateMixedHeaderSequence(prefix,remote.headers,policy,{remotePolicyDescriptor:descriptor,nowMs:remote.nowMs});
assert.equal(ACTIVATION_NETWORK_COMPOSITION_STATUS,'candidate-not-active-consensus');

let holdFetches=0;
const isolated=await evaluateActivationReconnect({
  localChain:local.chain,commonAncestorHeight:11,remotePolicyDescriptor:descriptor,
  remoteClaimedWork:remotePlan.work,remoteClaimedTipHash:remote.tip,policy,peerView:{state:'HOLD'},nowMs:Math.max(local.nowMs,remote.nowMs),
  fetchHeaders:async()=>{holdFetches++;throw new Error('HOLD_must_not_fetch_headers')},
  fetchBlocks:async()=>{holdFetches++;throw new Error('HOLD_must_not_fetch_blocks')}
});
assert.equal(isolated.ok,true);assert.equal(isolated.adoption_permitted,false);assert.equal(isolated.adopted,false);assert.equal(isolated.reason,'peer_view_not_ready');assert.equal(isolated.remote_touched,false);assert.equal(holdFetches,0);assert.equal(isolated.retained_tip_hash,local.chain.at(-1).hash);

let headersFetched=0,blocksFetched=0;
const recovered=await evaluateActivationReconnect({
  localChain:local.chain,commonAncestorHeight:11,remotePolicyDescriptor:descriptor,
  remoteClaimedWork:remotePlan.work,remoteClaimedTipHash:remote.tip,policy,peerView:{state:'READY'},nowMs:Math.max(local.nowMs,remote.nowMs),
  fetchHeaders:async()=>{headersFetched++;return structuredClone(remote.headers)},
  fetchBlocks:async()=>{blocksFetched++;return structuredClone(remote.blocks)}
});
assert.equal(recovered.ok,true);assert.equal(recovered.adoption_permitted,true);assert.equal(recovered.adopted,true);assert.equal(recovered.preferred,true);assert.equal(headersFetched,1);assert.equal(blocksFetched,1);assert.equal(recovered.selected_tip_hash,remote.tip);
assert.equal(recovered.classification.partition_spans_activation,true);assert.equal(recovered.classification.activation_crossing_reorg,true);assert.equal(recovered.classification.common_ancestor_height,11);assert.equal(recovered.classification.activation_height,12);

// Losing the trusted/diverse peer view again must not roll the already adopted
// chain back toward any merely advertised branch.
let relostTouches=0;
const relost=await evaluateActivationReconnect({
  localChain:recovered.selected_chain,commonAncestorHeight:11,remotePolicyDescriptor:descriptor,
  policy,peerView:{state:'HOLD'},nowMs:Math.max(local.nowMs,remote.nowMs),
  fetchHeaders:async()=>{relostTouches++;return structuredClone(local.headers)},
  fetchBlocks:async()=>{relostTouches++;return structuredClone(local.blocks)}
});
assert.equal(relost.adopted,false);assert.equal(relost.reason,'peer_view_not_ready');assert.equal(relostTouches,0);assert.equal(relost.retained_tip_hash,remote.tip);

// READY does not override policy identity. A mismatched signed policy fails
// before network bodies are touched.
const wrongDescriptor=activationPolicyDescriptor(freezeActivationPolicy({activationHeight:12,halfLifeSeconds:12*60*60}));let mismatchTouches=0;
const mismatch=await evaluateActivationReconnect({
  localChain:local.chain,commonAncestorHeight:11,remotePolicyDescriptor:wrongDescriptor,policy,peerView:{state:'READY'},nowMs:Math.max(local.nowMs,remote.nowMs),
  fetchHeaders:async()=>{mismatchTouches++;return structuredClone(remote.headers)},fetchBlocks:async()=>{mismatchTouches++;return structuredClone(remote.blocks)}
});
assert.equal(mismatch.ok,false);assert.equal(mismatch.stage,'policy');assert.equal(mismatch.adopted,false);assert.equal(mismatchTouches,0);

console.log(JSON.stringify({
  status:'PASS',worker:'D',candidate_only:true,partition:true,activation_during_partition:true,
  eclipse_hold_blocks_remote_access:true,recovery_ready:true,headers_first:true,
  activation_crossing_reorg:true,relost_hold_preserves_tip:true,policy_mismatch_fail_closed:true,
  attempts:local.attempts+remote.attempts
}));
