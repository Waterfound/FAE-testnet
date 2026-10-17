import { hashHex } from '../authoritative/crypto.mjs';
import { ECONOMIC_V2_300, terminalIssuanceAtoms } from './economic-v2-300.mjs';
import { DAA_V2_300 } from './difficulty-timestamp-v2-300.mjs';

export const LIVE_V4_NETWORK_ID = 'fairyelf-public-testnet-v4';
export const CANDIDATE_NETWORK_ID = ECONOMIC_V2_300.networkId;
export const CANDIDATE_PROTOCOL_DOMAIN = 'FAIRYELF_TESTNET_V5_CANDIDATE_300S';

export const CANDIDATE_GENESIS_DESCRIPTOR = Object.freeze({
  format: 'FAE_CANDIDATE_GENESIS_DESCRIPTOR_V1',
  authority: 'candidate-not-active-consensus',
  network: CANDIDATE_NETWORK_ID,
  protocolDomain: CANDIDATE_PROTOCOL_DOMAIN,
  lineage: 'fresh-genesis-no-v4-monetary-migration',
  previousNetwork: LIVE_V4_NETWORK_ID,
  inheritedBalances: false,
  inheritedCoinbase: false,
  initialHeight: 0,
  initialIssuedAtoms: '0',
  economics: Object.freeze({
    targetSeconds: ECONOMIC_V2_300.targetSeconds,
    initialSubsidyAtoms: ECONOMIC_V2_300.initialSubsidyAtoms.toString(),
    halvingEraBlocks: ECONOMIC_V2_300.halvingEraBlocks,
    theoreticalCapAtoms: ECONOMIC_V2_300.theoreticalCapAtoms.toString(),
    terminalIssuanceAtoms: terminalIssuanceAtoms().toString(),
    coinbaseMaturityBlocks: ECONOMIC_V2_300.coinbaseMaturityBlocks,
    maxTxPerBlock: ECONOMIC_V2_300.maxTxPerBlock,
  }),
  difficulty: Object.freeze({
    family: 'anchored-asert-style-full-target',
    targetSeconds: DAA_V2_300.targetSeconds,
    halfLifeSeconds: DAA_V2_300.halfLifeSeconds,
    mtpWindow: DAA_V2_300.mtpWindow,
    futureDriftMs: DAA_V2_300.futureDriftMs,
    targetRepresentation: DAA_V2_300.targetRepresentation,
    arithmetic: DAA_V2_300.arithmetic,
  }),
});

export const CANDIDATE_GENESIS_COMMITMENT = hashHex(CANDIDATE_GENESIS_DESCRIPTOR);

function profileIdentity(binding = null) {
  if (!binding) return null;
  const profileId = String(binding.profileId || '');
  const genesisCommitment = String(binding.genesisCommitment || '');
  if (!profileId) throw Object.assign(new Error('profile_id_required'), { code: 'profile_id_required' });
  if (!/^[0-9a-f]{64}$/i.test(genesisCommitment)) throw Object.assign(new Error('profile_genesis_commitment_invalid'), { code: 'profile_genesis_commitment_invalid' });
  return { profileId, genesisCommitment };
}

export function assertCandidateNetwork(network) {
  if (network !== CANDIDATE_NETWORK_ID) {
    const error = new Error(network === LIVE_V4_NETWORK_ID ? 'legacy_v4_network_rejected' : 'wrong_candidate_network');
    error.code = error.message;
    throw error;
  }
  return true;
}

export function candidateTxDomain(tx = {}, binding = null) {
  assertCandidateNetwork(tx.network);
  const identity = profileIdentity(binding);
  if (identity) {
    return {
      domain: 'FAIRYELF_TX_V5_300_PROFILE_BOUND',
      network: CANDIDATE_NETWORK_ID,
      profileId: identity.profileId,
      genesisCommitment: identity.genesisCommitment,
      inputs: [...(tx.inputs || [])].map(String),
      outputs: [...(tx.outputs || [])].map(output => ({
        address: String(output.address),
        amount_atoms: String(output.amount_atoms),
      })),
      public_key_spki: String(tx.public_key_spki || ''),
    };
  }
  return {
    domain: 'FAIRYELF_TX_V5_CANDIDATE_300S',
    network: CANDIDATE_NETWORK_ID,
    genesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
    inputs: [...(tx.inputs || [])].map(String),
    outputs: [...(tx.outputs || [])].map(output => ({
      address: String(output.address),
      amount_atoms: String(output.amount_atoms),
    })),
    public_key_spki: String(tx.public_key_spki || ''),
  };
}

export function peerCompatibility(status = {}, binding = null) {
  if (status.network !== CANDIDATE_NETWORK_ID) return { ok: false, error: 'peer_network_mismatch' };
  const identity = profileIdentity(binding);
  const expectedGenesis = identity?.genesisCommitment || CANDIDATE_GENESIS_COMMITMENT;
  if (status.genesisCommitment !== expectedGenesis) return { ok: false, error: 'peer_genesis_mismatch' };
  if (identity && status.profileId !== identity.profileId) return { ok: false, error: 'peer_profile_mismatch' };
  return { ok: true };
}

export function activationBoundaryManifest(binding = null) {
  const identity = profileIdentity(binding);
  return {
    authority: 'candidate-not-active-consensus',
    network: CANDIDATE_NETWORK_ID,
    profileId: identity?.profileId || null,
    genesisCommitment: identity?.genesisCommitment || CANDIDATE_GENESIS_COMMITMENT,
    freshGenesis: true,
    importsLegacyV4Balances: false,
    importsLegacyV4Coinbase: false,
    activationAuthorized: false,
    publicConsensusChanged: false,
  };
}
