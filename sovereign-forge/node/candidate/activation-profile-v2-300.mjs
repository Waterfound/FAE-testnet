import { hashHex } from '../authoritative/crypto.mjs';
import { ECONOMIC_V2_300 } from './economic-v2-300.mjs';
import {
  DAA_V2_300,
  POW_LIMIT,
  targetFromHex,
  targetHex,
} from './difficulty-timestamp-v2-300.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
} from './network-boundary-v2-300.mjs';

export const ACTIVATION_PROFILE_FORMAT = 'FAE_V5_300_ACTIVATION_PROFILE_V1';
export const ACTIVATION_PROFILE_AUTHORITY = 'candidate-not-active-consensus';
export const ACTIVATION_ANCHOR_POLICY = 'first-block-target_with_parent-time_equal_first-timestamp-minus-300s';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanString(value, field, { min = 1, max = 160 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) fail(`invalid_${field}`);
  return text;
}

function evidenceDigest(value) {
  const digest = cleanString(value, 'calibration_evidence_sha256', { min: 64, max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('invalid_calibration_evidence_sha256');
  if (/^0{64}$/.test(digest)) fail('placeholder_calibration_evidence_rejected');
  return digest;
}

function normalizedTargetHex(value) {
  const target = targetFromHex(cleanString(value, 'initial_target_hex', { min: 64, max: 64 }));
  if (target > POW_LIMIT) fail('initial_target_above_pow_limit');
  return targetHex(target);
}

export function l3TestLaunchProfile() {
  return Object.freeze({
    format: ACTIVATION_PROFILE_FORMAT,
    authority: ACTIVATION_PROFILE_AUTHORITY,
    profileClass: 'l3-ci-test',
    profileId: 'l3-ci-easy-pow-limit-explicit',
    network: CANDIDATE_NETWORK_ID,
    baseGenesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
    targetSeconds: ECONOMIC_V2_300.targetSeconds,
    halfLifeSeconds: DAA_V2_300.halfLifeSeconds,
    initialTargetHex: targetHex(POW_LIMIT),
    anchorPolicy: ACTIVATION_ANCHOR_POLICY,
    calibrationEvidenceSha256: null,
    activationGenesisCommitment: null,
    activationProfileReady: false,
    testOnly: true,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}

export function createActivationProfile({
  profileId,
  initialTargetHex,
  calibrationEvidenceSha256,
  calibrationEvidenceLabel,
} = {}) {
  const id = cleanString(profileId, 'profile_id', { min: 3, max: 80 });
  if (/test|ci|example|placeholder/i.test(id)) fail('activation_profile_id_looks_test_only');
  const initial = normalizedTargetHex(initialTargetHex);
  const evidenceSha = evidenceDigest(calibrationEvidenceSha256);
  const evidenceLabel = cleanString(calibrationEvidenceLabel, 'calibration_evidence_label', { min: 3, max: 160 });
  if (/placeholder|example|dummy/i.test(evidenceLabel)) fail('placeholder_calibration_evidence_rejected');

  const descriptor = Object.freeze({
    format: 'FAE_V5_300_ACTIVATION_GENESIS_DESCRIPTOR_V1',
    authority: ACTIVATION_PROFILE_AUTHORITY,
    lineage: 'fresh-genesis-from-v5-300-candidate-no-v4-monetary-migration',
    network: CANDIDATE_NETWORK_ID,
    baseGenesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
    profileId: id,
    economics: Object.freeze({
      targetSeconds: ECONOMIC_V2_300.targetSeconds,
      initialSubsidyAtoms: ECONOMIC_V2_300.initialSubsidyAtoms.toString(),
      halvingEraBlocks: ECONOMIC_V2_300.halvingEraBlocks,
      theoreticalCapAtoms: ECONOMIC_V2_300.theoreticalCapAtoms.toString(),
      coinbaseMaturityBlocks: ECONOMIC_V2_300.coinbaseMaturityBlocks,
      maxTxPerBlock: ECONOMIC_V2_300.maxTxPerBlock,
    }),
    difficulty: Object.freeze({
      family: 'anchored-asert-style-full-target',
      targetSeconds: DAA_V2_300.targetSeconds,
      halfLifeSeconds: DAA_V2_300.halfLifeSeconds,
      mtpWindow: DAA_V2_300.mtpWindow,
      futureDriftMs: DAA_V2_300.futureDriftMs,
      initialTargetHex: initial,
      anchorPolicy: ACTIVATION_ANCHOR_POLICY,
    }),
    calibrationEvidence: Object.freeze({
      sha256: evidenceSha,
      label: evidenceLabel,
    }),
    inheritedV4Balances: false,
    inheritedV4Coinbase: false,
    initialHeight: 0,
    initialIssuedAtoms: '0',
  });

  const activationGenesisCommitment = hashHex(descriptor);
  return Object.freeze({
    format: ACTIVATION_PROFILE_FORMAT,
    authority: ACTIVATION_PROFILE_AUTHORITY,
    profileClass: 'public-testnet-candidate',
    profileId: id,
    network: CANDIDATE_NETWORK_ID,
    baseGenesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
    targetSeconds: ECONOMIC_V2_300.targetSeconds,
    halfLifeSeconds: DAA_V2_300.halfLifeSeconds,
    initialTargetHex: initial,
    anchorPolicy: ACTIVATION_ANCHOR_POLICY,
    calibrationEvidenceSha256: evidenceSha,
    calibrationEvidenceLabel: evidenceLabel,
    descriptor,
    activationGenesisCommitment,
    activationProfileReady: true,
    testOnly: false,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}

export function assertActivationProfileReady(profile) {
  if (!profile || profile.format !== ACTIVATION_PROFILE_FORMAT) fail('activation_profile_required');
  if (profile.authority !== ACTIVATION_PROFILE_AUTHORITY) fail('activation_profile_authority_mismatch');
  if (profile.profileClass !== 'public-testnet-candidate' || profile.testOnly !== false) fail('test_profile_cannot_activate');
  if (profile.network !== CANDIDATE_NETWORK_ID || profile.baseGenesisCommitment !== CANDIDATE_GENESIS_COMMITMENT) fail('activation_profile_lineage_mismatch');
  if (Number(profile.targetSeconds) !== 300 || Number(profile.halfLifeSeconds) !== DAA_V2_300.halfLifeSeconds) fail('activation_profile_daa_mismatch');
  const target = normalizedTargetHex(profile.initialTargetHex);
  const evidenceSha = evidenceDigest(profile.calibrationEvidenceSha256);
  if (profile.anchorPolicy !== ACTIVATION_ANCHOR_POLICY) fail('activation_anchor_policy_mismatch');
  if (!profile.descriptor || hashHex(profile.descriptor) !== profile.activationGenesisCommitment) fail('activation_genesis_commitment_mismatch');
  if (profile.descriptor.difficulty?.initialTargetHex !== target) fail('activation_descriptor_target_mismatch');
  if (profile.descriptor.calibrationEvidence?.sha256 !== evidenceSha) fail('activation_descriptor_evidence_mismatch');
  if (profile.activationProfileReady !== true) fail('activation_profile_not_ready');
  if (profile.activationAuthorized !== false || profile.publicConsensusChanged !== false) fail('premature_activation_authority');
  return true;
}

export function activationProfileBoundaryReport(profile = null) {
  if (!profile) {
    return {
      authority: ACTIVATION_PROFILE_AUTHORITY,
      activationProfileReady: false,
      activationAuthorized: false,
      publicConsensusChanged: false,
      blocker: 'initial_target_and_calibration_evidence_not_frozen',
    };
  }
  assertActivationProfileReady(profile);
  return {
    authority: profile.authority,
    profileId: profile.profileId,
    initialTargetHex: profile.initialTargetHex,
    calibrationEvidenceSha256: profile.calibrationEvidenceSha256,
    activationGenesisCommitment: profile.activationGenesisCommitment,
    activationProfileReady: true,
    activationAuthorized: false,
    publicConsensusChanged: false,
    blocker: 'focused_l3_review_and_explicit_activation_decision_still_required',
  };
}
