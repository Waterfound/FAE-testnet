import assert from 'node:assert/strict';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy,validateBranchChain} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate,appendRehearsedCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {activatedHeaderRecord,activatedBlockRecord,rehearseHeadersFirstSync} from '../node/authoritative/full-target-headers-sync-candidate.mjs';
import {
  COMPATIBILITY_REPLAY_STATUS,replayCanonicalLegacySegment,legacyReplayDigest,
  replayGenesisThroughActivation,recoverStaleLegacyNode
} from '../node/authoritative/compatibility-replay-candidate.mjs';

const miner=encodeAddress(sha256(Buffer.from('colony-c-compatibility-miner')).subarray(0,20),'faet');
// H=12 is a compact historical rehearsal boundary only: it is the first height
// after the immutable 11-block legacy checkpoint set. It is NOT a proposed live
// activation height.
const policy=freezeActivationPolicy({activationHeight:12});
const descriptor=activationPolicyDescriptor(policy);
const legacy=structuredClone(legacyBlocks);
const h12Time=legacy.at(-1).timestamp_ms+6*60*60_000+180_000;
const mined12=mineFullActivationCandidate(legacy,policy,{minerAddress:miner,timestampMs:h12Time,maxNonce:5_000_000});
assert.equal(mined12.verdict.ok,true);
let candidateChain=appendRehearsedCandidate(legacy,mined12.candidate,policy,{nowMs:h12Time});
const h13Time=h12Time+180_000;
const mined13=mineFullActivationCandidate(candidateChain,policy,{minerAddress:miner,timestampMs:h13Time,maxNonce:5_000_000});
assert.equal(mined13.verdict.ok,true);
candidateChain=appendRehearsedCandidate(candidateChain,mined13.candidate,policy,{nowMs:h13Time});

const activatedHeaders=[activatedHeaderRecord(mined12.candidate),activatedHeaderRecord(mined13.candidate)];
const activatedBlocks=[activatedBlockRecord(mined12.candidate),activatedBlockRecord(mined13.candidate)];

assert.equal(COMPATIBILITY_REPLAY_STATUS,'candidate-not-active-consensus');

// Real historical genesis replay: H1-H11 are reconstructed through the legacy
// feed rules that produced those exact checkpoint hashes. Only then is the
// candidate H12+ validator allowed to take over.
const full=replayGenesisThroughActivation({legacyBlocks:legacy,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor:descriptor,nowMs:h13Time});
assert.equal(full.ok,true);assert.equal(full.genesis_replayed,true);assert.equal(full.legacy_height,11);assert.equal(full.tip.height,13);assert.equal(full.tip.hash,mined13.candidate.hash);
assert.equal(full.activated_headers,2);assert.equal(full.activated_blocks,2);

// A clean restart must reconstruct the same branch state/work without applying
// arrival-time checks to old data.
const restarted=validateBranchChain(JSON.parse(JSON.stringify(full.chain)),policy,{enforceFutureDrift:false});
assert.equal(restarted.tip.hash,full.tip.hash);assert.equal(restarted.work,full.work);

// Stale node recovery: begin from H5, replay only H6-H11 under legacy rules,
// then cross the candidate activation boundary. The reconstructed legacy state
// must be bit-for-bit equivalent at the semantic digest level.
const stale=recoverStaleLegacyNode({
  staleBlocks:legacy.slice(0,5),catchupBlocks:legacy.slice(5),activatedHeaders,activatedBlocks,
  policy,remotePolicyDescriptor:descriptor,nowMs:h13Time
});
assert.equal(stale.stale_height,5);assert.equal(stale.caught_up_legacy_height,11);assert.equal(stale.tip.hash,full.tip.hash);assert.equal(stale.work,full.work);assert.equal(stale.legacy_digest,full.legacy_digest);

// Independent reconstruction of the historical prefix must be deterministic.
const oneShotLegacy=replayCanonicalLegacySegment(legacy);
const splitLegacy=replayCanonicalLegacySegment(legacy.slice(5),{initialState:replayCanonicalLegacySegment(legacy.slice(0,5))});
assert.equal(legacyReplayDigest(oneShotLegacy),legacyReplayDigest(splitLegacy));

// Late join at H11 exercises the existing headers-first network composition: no
// candidate body is trusted until headers, policy id, tip binding and work agree.
const lateJoin=await rehearseHeadersFirstSync({
  localChain:structuredClone(legacy),commonAncestorHeight:11,remotePolicyDescriptor:descriptor,
  remoteClaimedWork:full.work,remoteClaimedTipHash:mined13.candidate.hash,policy,nowMs:h13Time,
  fetchHeaders:async()=>structuredClone(activatedHeaders),fetchBlocks:async()=>structuredClone(activatedBlocks)
});
assert.equal(lateJoin.ok,true);assert.equal(lateJoin.preferred,true);assert.equal(lateJoin.headers_validated,2);assert.equal(lateJoin.blocks_validated,2);assert.equal(lateJoin.candidate_chain.at(-1).hash,full.tip.hash);

// The full replay helper must fail closed before activated validation if the
// peer advertises a different activation policy.
const wrongPolicy=freezeActivationPolicy({activationHeight:12,halfLifeSeconds:12*60*60});
assert.throws(()=>replayGenesisThroughActivation({legacyBlocks:legacy,activatedHeaders,activatedBlocks,policy,remotePolicyDescriptor:activationPolicyDescriptor(wrongPolicy),nowMs:h13Time}),/activation_policy_mismatch/);

console.log(JSON.stringify({
  status:'PASS',worker:'C',candidate_only:true,real_genesis_checkpoints:11,
  rehearsal_activation_height:12,tip_height:13,genesis_replay:true,restart_replay:true,
  stale_from_height:5,stale_recovery:true,late_join:true,headers_first:true,
  policy_mismatch_fail_closed:true,attempts:mined12.attempts+mined13.attempts
}));
