import assert from 'node:assert/strict';
import {
  LIVE_V4_NETWORK_ID,
  CANDIDATE_NETWORK_ID,
  CANDIDATE_PROTOCOL_DOMAIN,
  CANDIDATE_GENESIS_DESCRIPTOR,
  CANDIDATE_GENESIS_COMMITMENT,
  assertCandidateNetwork,
  candidateTxDomain,
  peerCompatibility,
  activationBoundaryManifest,
} from '../node/candidate/network-boundary-v2-300.mjs';

assert.equal(CANDIDATE_NETWORK_ID, 'fairyelf-public-testnet-v5-candidate-300s');
assert.notEqual(CANDIDATE_NETWORK_ID, LIVE_V4_NETWORK_ID);
assert.equal(CANDIDATE_PROTOCOL_DOMAIN, 'FAIRYELF_TESTNET_V5_CANDIDATE_300S');
assert.match(CANDIDATE_GENESIS_COMMITMENT, /^[0-9a-f]{64}$/);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.lineage, 'fresh-genesis-no-v4-monetary-migration');
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.initialHeight, 0);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.initialIssuedAtoms, '0');
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.inheritedBalances, false);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.inheritedCoinbase, false);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.economics.targetSeconds, 300);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.economics.initialSubsidyAtoms, '1400000000');
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.economics.halvingEraBlocks, 430000);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.economics.coinbaseMaturityBlocks, 200);
assert.equal(CANDIDATE_GENESIS_DESCRIPTOR.difficulty.targetSeconds, 300);

assert.equal(assertCandidateNetwork(CANDIDATE_NETWORK_ID), true);
assert.throws(
  () => assertCandidateNetwork(LIVE_V4_NETWORK_ID),
  error => error.code === 'legacy_v4_network_rejected',
);
assert.throws(
  () => assertCandidateNetwork('other-network'),
  error => error.code === 'wrong_candidate_network',
);

const tx = {
  network: CANDIDATE_NETWORK_ID,
  inputs: ['abc:0'],
  outputs: [{ address: 'faet-test', amount_atoms: '100' }],
  public_key_spki: 'test-key',
};
const domain = candidateTxDomain(tx);
assert.equal(domain.network, CANDIDATE_NETWORK_ID);
assert.equal(domain.genesisCommitment, CANDIDATE_GENESIS_COMMITMENT);
assert.equal(domain.domain, 'FAIRYELF_TX_V5_CANDIDATE_300S');
assert.throws(() => candidateTxDomain({ ...tx, network: LIVE_V4_NETWORK_ID }), /legacy_v4_network_rejected/);

assert.deepEqual(
  peerCompatibility({ network: CANDIDATE_NETWORK_ID, genesisCommitment: CANDIDATE_GENESIS_COMMITMENT }),
  { ok: true },
);
assert.deepEqual(
  peerCompatibility({ network: LIVE_V4_NETWORK_ID, genesisCommitment: CANDIDATE_GENESIS_COMMITMENT }),
  { ok: false, error: 'peer_network_mismatch' },
);
assert.deepEqual(
  peerCompatibility({ network: CANDIDATE_NETWORK_ID, genesisCommitment: '0'.repeat(64) }),
  { ok: false, error: 'peer_genesis_mismatch' },
);

const manifest = activationBoundaryManifest();
assert.equal(manifest.freshGenesis, true);
assert.equal(manifest.importsLegacyV4Balances, false);
assert.equal(manifest.importsLegacyV4Coinbase, false);
assert.equal(manifest.activationAuthorized, false);
assert.equal(manifest.publicConsensusChanged, false);

console.log('network-boundary-v2-300: PASS');
