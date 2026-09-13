import assert from 'node:assert/strict';
import { createActivationProfile, l3TestLaunchProfile } from '../node/candidate/activation-profile-v2-300.mjs';
import { POW_LIMIT, targetHex } from '../node/candidate/difficulty-timestamp-v2-300.mjs';
import { CANDIDATE_GENESIS_COMMITMENT, candidateTxDomain, peerCompatibility } from '../node/candidate/network-boundary-v2-300.mjs';
import { resolveCandidateRuntimeProfile } from '../node/candidate/profile-runtime-v2-300.mjs';
import { createProfileConsensusBinding, assertProfileConsensusBinding } from '../node/candidate/profile-consensus-binding-v2-300.mjs';

const testProfile = l3TestLaunchProfile();
const testRuntime = resolveCandidateRuntimeProfile(testProfile);
assert.equal(testRuntime.genesisCommitment, CANDIDATE_GENESIS_COMMITMENT);
assert.equal(testRuntime.initialTargetHex, targetHex(POW_LIMIT));
assert.equal(testRuntime.testOnly, true);
assert.equal(testRuntime.activationProfileReady, false);

const initialTargetA = targetHex(POW_LIMIT >> 2n);
const initialTargetB = targetHex(POW_LIMIT >> 3n);
const profileA = createActivationProfile({
  profileId: 'public-testnet-v5-300-candidate-a',
  initialTargetHex: initialTargetA,
  calibrationEvidenceSha256: '1'.repeat(64),
  calibrationEvidenceLabel: 'captured launch hashrate calibration A',
});
const profileB = createActivationProfile({
  profileId: 'public-testnet-v5-300-candidate-b',
  initialTargetHex: initialTargetB,
  calibrationEvidenceSha256: '2'.repeat(64),
  calibrationEvidenceLabel: 'captured launch hashrate calibration B',
});

const bindingA = createProfileConsensusBinding(profileA);
const bindingB = createProfileConsensusBinding(profileB);
assertProfileConsensusBinding(bindingA, profileA);
assertProfileConsensusBinding(bindingB, profileB);
assert.equal(bindingA.initialTargetHex, initialTargetA);
assert.equal(bindingB.initialTargetHex, initialTargetB);
assert.notEqual(bindingA.genesisCommitment, CANDIDATE_GENESIS_COMMITMENT);
assert.notEqual(bindingA.genesisCommitment, bindingB.genesisCommitment);
assert.notEqual(bindingA.transactionDomainCommitment, bindingB.transactionDomainCommitment);
assert.equal(bindingA.activationAuthorized, false);
assert.equal(bindingB.activationAuthorized, false);

const txShape = {
  network: bindingA.network,
  inputs: ['example:0'],
  outputs: [{ address: 'faet1example-not-validated-here', amount_atoms: '1' }],
  public_key_spki: 'profile-binding-shape-only',
};
const domainA = candidateTxDomain(txShape, bindingA);
const domainB = candidateTxDomain(txShape, bindingB);
assert.equal(domainA.profileId, bindingA.profileId);
assert.equal(domainA.genesisCommitment, bindingA.genesisCommitment);
assert.equal(domainB.profileId, bindingB.profileId);
assert.notDeepEqual(domainA, domainB);

assert.deepEqual(peerCompatibility({
  network: bindingA.network,
  profileId: bindingA.profileId,
  genesisCommitment: bindingA.genesisCommitment,
}, bindingA), { ok: true });
assert.equal(peerCompatibility({
  network: bindingA.network,
  profileId: bindingB.profileId,
  genesisCommitment: bindingB.genesisCommitment,
}, bindingA).ok, false);

console.log(JSON.stringify({
  ok: true,
  suite: 'profile-consensus-binding-v2-300',
  testGenesis: testRuntime.genesisCommitment,
  profileAGenesis: bindingA.genesisCommitment,
  profileBGenesis: bindingB.genesisCommitment,
  profileAInitialTargetHex: bindingA.initialTargetHex,
  profileBInitialTargetHex: bindingB.initialTargetHex,
  profileATransactionDomainCommitment: bindingA.transactionDomainCommitment,
  profileBTransactionDomainCommitment: bindingB.transactionDomainCommitment,
  activationAuthorized: false,
}));
