import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { stableStringify } from '../node/authoritative/canonical.mjs';
import { candidateTxDomain, CANDIDATE_NETWORK_ID } from '../node/candidate/network-boundary-v2-300.mjs';
import { createActivationProfile } from '../node/candidate/activation-profile-v2-300.mjs';
import { POW_LIMIT, targetHex } from '../node/candidate/difficulty-timestamp-v2-300.mjs';
import {
  CANDIDATE_TX_VERSION,
  candidateBindingFromProfile,
  emptyCandidateState,
  nextCandidateTarget,
  candidateBlockTemplate,
  deriveCandidateAddress,
  verifyCandidateTxCrypto,
  candidateStateInvariantReport,
} from '../node/candidate/fae-v5-300-core.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const profile = createActivationProfile({
  profileId: 'public-v5-launch-a',
  initialTargetHex: targetHex(POW_LIMIT >> 3n),
  calibrationEvidenceSha256: sha256('captured launch hashrate calibration packet a'),
  calibrationEvidenceLabel: 'Captured launch hashrate calibration packet A',
});
const binding = candidateBindingFromProfile(profile);
const state = emptyCandidateState({ profile });

assert.equal(state.profileId, profile.profileId);
assert.equal(state.genesisCommitment, profile.activationGenesisCommitment);
assert.equal(state.initialTargetHex, profile.initialTargetHex);
assert.equal(targetHex(nextCandidateTarget(state)), profile.initialTargetHex);
assert.equal(state.activationProfileReady, true);
assert.equal(state.testOnly, false);
assert.equal(state.genesisCommitment, binding.genesisCommitment);
assert.equal(state.transactionDomainCommitment, binding.transactionDomainCommitment);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' });
const address = deriveCandidateAddress(spki);
const unsigned = {
  version: CANDIDATE_TX_VERSION,
  network: CANDIDATE_NETWORK_ID,
  inputs: ['profile-bound-shape:0'],
  outputs: [{ address, amount_atoms: '1' }],
  public_key_spki: spki.toString('base64'),
};

function sign(domain) {
  return signPayload(null, Buffer.from(stableStringify(domain)), privateKey).toString('base64');
}

const profileBoundTx = {
  ...unsigned,
  signature: sign(candidateTxDomain(unsigned, binding)),
};
const profileVerdict = verifyCandidateTxCrypto(profileBoundTx, binding);
assert.equal(profileVerdict.ok, true);
assert.equal(profileVerdict.profileId, profile.profileId);
assert.equal(profileVerdict.ciLegacyDomain, false);

const legacyDomainTx = {
  ...unsigned,
  signature: sign(candidateTxDomain(unsigned)),
};
const legacyVerdict = verifyCandidateTxCrypto(legacyDomainTx, binding);
assert.equal(legacyVerdict.ok, false);
assert.equal(legacyVerdict.error, 'invalid_signature');

const template = candidateBlockTemplate(state, {
  minerAddress: address,
  timestampMs: Date.now() - 300_000,
});
assert.equal(template.header.profile_id, profile.profileId);
assert.equal(template.header.genesis_commitment, profile.activationGenesisCommitment);
assert.equal(template.header.target_hex, profile.initialTargetHex);

const report = candidateStateInvariantReport(state);
assert.equal(report.profileBoundCore, true);
assert.equal(report.bindingValid, true);
assert.equal(report.activationProfileReady, true);
assert.equal(report.testOnly, false);
assert.equal(report.activationAuthorized, false);
assert.equal(report.publicConsensusChanged, false);

console.log('fae-v5-300-profile-bound-launch: PASS');
