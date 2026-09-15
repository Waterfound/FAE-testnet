import assert from 'node:assert/strict';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS} from '../node/authoritative/fae-v4-core.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {
  ACTIVATION_STATE_TRANSITION_STATUS,CANDIDATE_COINBASE_MATURITY_BLOCKS,
  freezeStateTransitionPolicy,coinbaseMaturityForCreationHeight
} from '../node/authoritative/activation-state-transition-candidate.mjs';
import {
  COMPATIBILITY_REPLAY_STATUS,replayCanonicalLegacySegment,legacyReplayDigest
} from '../node/authoritative/compatibility-replay-candidate.mjs';
import {
  ACTIVATION_NETWORK_COMPOSITION_STATUS,classifyActivationComposition
} from '../node/authoritative/activation-network-composition-candidate.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

const activation=freezeActivationPolicy({activationHeight:12});
const descriptor=activationPolicyDescriptor(activation);
const transition=freezeStateTransitionPolicy({activationHeight:12});

// Integration must not silently turn any worker into consensus authority.
for(const status of [ACTIVATION_STATE_TRANSITION_STATUS,COMPATIBILITY_REPLAY_STATUS,ACTIVATION_NETWORK_COMPOSITION_STATUS])assert.equal(status,'candidate-not-active-consensus');

// The compact integration rehearsal uses one boundary across A/B/C/D, while
// preserving that H=12 is only a rehearsal value and not a live activation.
assert.equal(activation.activation_height,transition.activation_height);
assert.equal(descriptor.activation_height,12);
assert.match(descriptor.policy_id,/^[0-9a-f]{64}$/);

// Candidate maturity semantics are versioned by creation height and remain a
// mechanism candidate; the live core economics below are deliberately unchanged.
assert.equal(CANDIDATE_COINBASE_MATURITY_BLOCKS,200);
assert.equal(coinbaseMaturityForCreationHeight(11,transition),0);
assert.equal(coinbaseMaturityForCreationHeight(12,transition),200);
assert.equal(coinbaseMaturityForCreationHeight(13,transition),200);

// The real historical prefix must remain deterministically replayable inside
// the integrated tree, with no rewriting by B or D.
const legacyA=replayCanonicalLegacySegment(structuredClone(legacyBlocks));
const legacyB=replayCanonicalLegacySegment(structuredClone(legacyBlocks.slice(5)),{initialState:replayCanonicalLegacySegment(structuredClone(legacyBlocks.slice(0,5))) });
assert.equal(legacyA.chain.length,11);assert.equal(legacyReplayDigest(legacyA),legacyReplayDigest(legacyB));

// D must classify a partition whose common ancestor is below H and whose two
// tips are post-H as an activation-crossing reorg. This is classification only;
// actual adoption remains behind D's READY + headers/body/work gate.
const syntheticPrefix=legacyBlocks.map(block=>({height:block.height,hash:block.hash}));
const local=[...syntheticPrefix,{height:12,hash:'a'.repeat(64)},{height:13,hash:'b'.repeat(64)}];
const remote=[...syntheticPrefix,{height:12,hash:'c'.repeat(64)},{height:13,hash:'d'.repeat(64)}];
const composition=classifyActivationComposition({localChain:local,remoteChain:remote,commonAncestorHeight:11,policy:activation});
assert.equal(composition.partition_spans_activation,true);assert.equal(composition.activation_crossing_reorg,true);

// Canonical public-testnet authority remains the frozen pre-colony regime.
assert.equal(INITIAL_SUBSIDY,10n*COIN);
assert.equal(HALVING_ERA_BLOCKS,600000);
assert.equal(TARGET_SECONDS,180);

console.log(JSON.stringify({
  status:'PASS',worker:'H',integration_only:true,candidate_only:true,
  activation_rehearsal_height:12,policy_id:descriptor.policy_id,
  b_state_transition:true,c_genesis_replay:true,d_network_composition:true,
  all_preexisting_authority_unchanged:true,live_economics_unchanged:true
}));
