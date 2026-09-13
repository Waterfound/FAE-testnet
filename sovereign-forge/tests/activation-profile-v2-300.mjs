import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  POW_LIMIT,
  targetHex,
} from '../node/candidate/difficulty-timestamp-v2-300.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
} from '../node/candidate/network-boundary-v2-300.mjs';
import {
  ACTIVATION_ANCHOR_POLICY,
  l3TestLaunchProfile,
  createActivationProfile,
  assertActivationProfileReady,
  activationProfileBoundaryReport,
} from '../node/candidate/activation-profile-v2-300.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const calibrationA = digest('FAE launch-hashrate calibration evidence A');
const calibrationB = digest('FAE launch-hashrate calibration evidence B');
const realisticTarget = targetHex(POW_LIMIT >> 5n);
const slightlyHarderTarget = targetHex(POW_LIMIT >> 6n);

const testProfile = l3TestLaunchProfile();
assert.equal(testProfile.initialTargetHex, targetHex(POW_LIMIT));
assert.equal(testProfile.activationProfileReady, false);
assert.equal(testProfile.testOnly, true);
assert.equal(testProfile.activationAuthorized, false);
assert.throws(() => assertActivationProfileReady(testProfile), error => error.code === 'test_profile_cannot_activate');

const emptyReport = activationProfileBoundaryReport();
assert.equal(emptyReport.activationProfileReady, false);
assert.equal(emptyReport.blocker, 'initial_target_and_calibration_evidence_not_frozen');

assert.throws(
  () => createActivationProfile(),
  error => error.code === 'invalid_profile_id',
);
assert.throws(
  () => createActivationProfile({
    profileId: 'public-launch-a',
    initialTargetHex: realisticTarget,
    calibrationEvidenceSha256: '',
    calibrationEvidenceLabel: 'Measured launch hashrate evidence',
  }),
  error => error.code === 'invalid_calibration_evidence_sha256',
);
assert.throws(
  () => createActivationProfile({
    profileId: 'ci-test-profile',
    initialTargetHex: realisticTarget,
    calibrationEvidenceSha256: calibrationA,
    calibrationEvidenceLabel: 'Measured launch hashrate evidence',
  }),
  error => error.code === 'activation_profile_id_looks_test_only',
);
assert.throws(
  () => createActivationProfile({
    profileId: 'public-launch-a',
    initialTargetHex: 'f'.repeat(64),
    calibrationEvidenceSha256: calibrationA,
    calibrationEvidenceLabel: 'Measured launch hashrate evidence',
  }),
  error => error.code === 'initial_target_above_pow_limit',
);
assert.throws(
  () => createActivationProfile({
    profileId: 'public-launch-a',
    initialTargetHex: realisticTarget,
    calibrationEvidenceSha256: '0'.repeat(64),
    calibrationEvidenceLabel: 'Measured launch hashrate evidence',
  }),
  error => error.code === 'placeholder_calibration_evidence_rejected',
);
assert.throws(
  () => createActivationProfile({
    profileId: 'public-launch-a',
    initialTargetHex: realisticTarget,
    calibrationEvidenceSha256: calibrationA,
    calibrationEvidenceLabel: 'example dummy calibration',
  }),
  error => error.code === 'placeholder_calibration_evidence_rejected',
);

const testnetNamedProfile = createActivationProfile({
  profileId: 'public-testnet-v5-launch-a',
  initialTargetHex: realisticTarget,
  calibrationEvidenceSha256: calibrationA,
  calibrationEvidenceLabel: 'Measured launch hashrate calibration packet A',
});
assert.equal(testnetNamedProfile.profileId, 'public-testnet-v5-launch-a');
assert.equal(testnetNamedProfile.testOnly, false);
assert.equal(testnetNamedProfile.activationAuthorized, false);

const profileA = createActivationProfile({
  profileId: 'public-launch-a',
  initialTargetHex: realisticTarget,
  calibrationEvidenceSha256: calibrationA,
  calibrationEvidenceLabel: 'Measured launch hashrate calibration packet A',
});
assert.equal(assertActivationProfileReady(profileA), true);
assert.equal(profileA.network, CANDIDATE_NETWORK_ID);
assert.equal(profileA.baseGenesisCommitment, CANDIDATE_GENESIS_COMMITMENT);
assert.equal(profileA.initialTargetHex, realisticTarget);
assert.equal(profileA.anchorPolicy, ACTIVATION_ANCHOR_POLICY);
assert.equal(profileA.activationProfileReady, true);
assert.equal(profileA.activationAuthorized, false);
assert.equal(profileA.publicConsensusChanged, false);
assert.equal(profileA.descriptor.inheritedV4Balances, false);
assert.equal(profileA.descriptor.inheritedV4Coinbase, false);
assert.equal(profileA.descriptor.initialHeight, 0);
assert.equal(profileA.descriptor.initialIssuedAtoms, '0');

const profileARepeat = createActivationProfile({
  profileId: 'public-launch-a',
  initialTargetHex: realisticTarget,
  calibrationEvidenceSha256: calibrationA,
  calibrationEvidenceLabel: 'Measured launch hashrate calibration packet A',
});
assert.equal(profileARepeat.activationGenesisCommitment, profileA.activationGenesisCommitment, 'same frozen profile must be deterministic');

const profileTargetChanged = createActivationProfile({
  profileId: 'public-launch-a',
  initialTargetHex: slightlyHarderTarget,
  calibrationEvidenceSha256: calibrationA,
  calibrationEvidenceLabel: 'Measured launch hashrate calibration packet A',
});
assert.notEqual(profileTargetChanged.activationGenesisCommitment, profileA.activationGenesisCommitment, 'initial target must bind genesis commitment');

const profileEvidenceChanged = createActivationProfile({
  profileId: 'public-launch-a',
  initialTargetHex: realisticTarget,
  calibrationEvidenceSha256: calibrationB,
  calibrationEvidenceLabel: 'Measured launch hashrate calibration packet B',
});
assert.notEqual(profileEvidenceChanged.activationGenesisCommitment, profileA.activationGenesisCommitment, 'calibration evidence must bind genesis commitment');

const tampered = structuredClone(profileA);
tampered.initialTargetHex = slightlyHarderTarget;
assert.throws(() => assertActivationProfileReady(tampered), error => error.code === 'activation_descriptor_target_mismatch');

const tamperedCommitment = structuredClone(profileA);
tamperedCommitment.activationGenesisCommitment = '0'.repeat(64);
assert.throws(() => assertActivationProfileReady(tamperedCommitment), error => error.code === 'activation_genesis_commitment_mismatch');

const premature = structuredClone(profileA);
premature.activationAuthorized = true;
assert.throws(() => assertActivationProfileReady(premature), error => error.code === 'premature_activation_authority');

const report = activationProfileBoundaryReport(profileA);
assert.equal(report.activationProfileReady, true);
assert.equal(report.activationAuthorized, false);
assert.equal(report.publicConsensusChanged, false);
assert.equal(report.blocker, 'focused_l3_review_and_explicit_activation_decision_still_required');

console.log('activation-profile-v2-300: PASS');
