import { targetFromHex, targetHex, POW_LIMIT } from './difficulty-timestamp-v2-300.mjs';
import {
  ACTIVATION_PROFILE_FORMAT,
  ACTIVATION_PROFILE_AUTHORITY,
  assertActivationProfileReady,
  l3TestLaunchProfile,
} from './activation-profile-v2-300.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
} from './network-boundary-v2-300.mjs';

export const PROFILE_RUNTIME_FORMAT = 'FAE_V5_300_PROFILE_RUNTIME_V1';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizeInitialTarget(value) {
  const target = targetFromHex(String(value || ''));
  if (target > POW_LIMIT) fail('runtime_initial_target_above_pow_limit');
  return targetHex(target);
}

function assertL3TestProfile(profile) {
  if (!profile || profile.format !== ACTIVATION_PROFILE_FORMAT) fail('runtime_profile_required');
  if (profile.authority !== ACTIVATION_PROFILE_AUTHORITY) fail('runtime_profile_authority_mismatch');
  if (profile.profileClass !== 'l3-ci-test' || profile.testOnly !== true) fail('runtime_invalid_test_profile');
  if (profile.network !== CANDIDATE_NETWORK_ID || profile.baseGenesisCommitment !== CANDIDATE_GENESIS_COMMITMENT) fail('runtime_test_profile_lineage_mismatch');
  if (profile.activationProfileReady !== false || profile.activationAuthorized !== false || profile.publicConsensusChanged !== false) fail('runtime_test_profile_authority_leak');
  if (profile.activationGenesisCommitment !== null || profile.calibrationEvidenceSha256 !== null) fail('runtime_test_profile_must_not_claim_launch_evidence');
  return true;
}

export function resolveCandidateRuntimeProfile(profile = l3TestLaunchProfile()) {
  const source = profile || l3TestLaunchProfile();
  let genesisCommitment;
  let profileReady;
  let testOnly;

  if (source.profileClass === 'l3-ci-test') {
    assertL3TestProfile(source);
    genesisCommitment = CANDIDATE_GENESIS_COMMITMENT;
    profileReady = false;
    testOnly = true;
  } else {
    assertActivationProfileReady(source);
    genesisCommitment = String(source.activationGenesisCommitment);
    if (!/^[0-9a-f]{64}$/i.test(genesisCommitment)) fail('runtime_activation_genesis_commitment_invalid');
    if (genesisCommitment === CANDIDATE_GENESIS_COMMITMENT) fail('runtime_activation_genesis_must_bind_profile');
    profileReady = true;
    testOnly = false;
  }

  const initialTargetHex = normalizeInitialTarget(source.initialTargetHex);
  const runtime = {
    format: PROFILE_RUNTIME_FORMAT,
    authority: 'candidate-not-active-consensus',
    profileId: String(source.profileId),
    profileClass: String(source.profileClass),
    network: CANDIDATE_NETWORK_ID,
    baseGenesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
    genesisCommitment,
    initialTargetHex,
    targetSeconds: Number(source.targetSeconds),
    halfLifeSeconds: Number(source.halfLifeSeconds),
    anchorPolicy: String(source.anchorPolicy),
    calibrationEvidenceSha256: source.calibrationEvidenceSha256 ? String(source.calibrationEvidenceSha256) : null,
    activationProfileReady: profileReady,
    testOnly,
    activationAuthorized: false,
    publicConsensusChanged: false,
  };

  if (runtime.targetSeconds !== 300) fail('runtime_target_seconds_mismatch');
  if (!Number.isSafeInteger(runtime.halfLifeSeconds) || runtime.halfLifeSeconds <= 0) fail('runtime_half_life_invalid');
  return Object.freeze(runtime);
}

export function runtimeProfileIdentity(runtime) {
  if (!runtime || runtime.format !== PROFILE_RUNTIME_FORMAT) fail('profile_runtime_required');
  return Object.freeze({
    network: runtime.network,
    profileId: runtime.profileId,
    genesisCommitment: runtime.genesisCommitment,
    initialTargetHex: runtime.initialTargetHex,
  });
}

export function assertRuntimeProfileMatch(a, b) {
  if (!a || !b) fail('profile_runtime_required');
  if (a.network !== b.network) fail('runtime_network_mismatch');
  if (a.profileId !== b.profileId) fail('runtime_profile_id_mismatch');
  if (a.genesisCommitment !== b.genesisCommitment) fail('runtime_genesis_mismatch');
  if (a.initialTargetHex !== b.initialTargetHex) fail('runtime_initial_target_mismatch');
  return true;
}
