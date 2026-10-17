import { hashHex } from '../authoritative/crypto.mjs';
import { targetFromHex } from './difficulty-timestamp-v2-300.mjs';
import { resolveCandidateRuntimeProfile } from './profile-runtime-v2-300.mjs';

export const PROFILE_CONSENSUS_BINDING_FORMAT = 'FAE_V5_300_PROFILE_CONSENSUS_BINDING_V1';

export function createProfileConsensusBinding(profile) {
  const runtime = resolveCandidateRuntimeProfile(profile);
  const transactionDomainDescriptor = Object.freeze({
    domain: 'FAIRYELF_TX_V5_300_PROFILE_BOUND',
    network: runtime.network,
    profileId: runtime.profileId,
    genesisCommitment: runtime.genesisCommitment,
  });
  return Object.freeze({
    format: PROFILE_CONSENSUS_BINDING_FORMAT,
    authority: 'candidate-not-active-consensus',
    network: runtime.network,
    profileId: runtime.profileId,
    profileClass: runtime.profileClass,
    genesisCommitment: runtime.genesisCommitment,
    initialTargetHex: runtime.initialTargetHex,
    initialTarget: targetFromHex(runtime.initialTargetHex),
    transactionDomainDescriptor,
    transactionDomainCommitment: hashHex(transactionDomainDescriptor),
    activationProfileReady: runtime.activationProfileReady,
    testOnly: runtime.testOnly,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}

export function assertProfileConsensusBinding(binding, profile) {
  const expected = createProfileConsensusBinding(profile);
  if (!binding || binding.format !== PROFILE_CONSENSUS_BINDING_FORMAT) throw new Error('profile_consensus_binding_required');
  for (const field of ['network', 'profileId', 'genesisCommitment', 'initialTargetHex', 'transactionDomainCommitment']) {
    if (binding[field] !== expected[field]) throw new Error(`profile_consensus_${field}_mismatch`);
  }
  if (binding.activationAuthorized !== false || binding.publicConsensusChanged !== false) throw new Error('profile_consensus_authority_leak');
  return true;
}
