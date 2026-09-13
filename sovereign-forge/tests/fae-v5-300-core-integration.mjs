import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { stableStringify } from '../node/authoritative/canonical.mjs';
import { hashHex } from '../node/authoritative/crypto.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
  candidateTxDomain,
} from '../node/candidate/network-boundary-v2-300.mjs';
import {
  targetFromHex,
  targetHex,
  hashMeetsTarget,
} from '../node/candidate/difficulty-timestamp-v2-300.mjs';
import {
  CANDIDATE_TX_VERSION,
  emptyCandidateState,
  deriveCandidateAddress,
  acceptCandidateTxInto,
  candidateBlockTemplate,
  candidateBlockHash,
  appendCandidateBlock,
  rebuildCandidateState,
  reorganizeCandidateState,
  expectedCandidateSubsidy,
  nextCandidateTarget,
  candidateStateInvariantReport,
} from '../node/candidate/fae-v5-300-core.mjs';

function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey,
    publicKeySpki: spki.toString('base64'),
    address: deriveCandidateAddress(spki),
  };
}

function signedTx(owner, inputs, outputs) {
  const unsigned = {
    version: CANDIDATE_TX_VERSION,
    network: CANDIDATE_NETWORK_ID,
    inputs,
    outputs: outputs.map(output => ({ address: output.address, amount_atoms: String(output.amount_atoms) })),
    public_key_spki: owner.publicKeySpki,
  };
  const signature = signPayload(
    null,
    Buffer.from(stableStringify(candidateTxDomain(unsigned))),
    owner.privateKey,
  ).toString('base64');
  return { ...unsigned, signature };
}

function mineTemplate(template) {
  const target = targetFromHex(template.header.target_hex);
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce++) {
    const hash = candidateBlockHash(template.header, nonce);
    if (hashMeetsTarget(hash, target)) return { ...template, nonce, hash };
  }
  throw new Error('nonce_space_exhausted');
}

function mineNext(state, { minerAddress, timestampMs, txids, coinbaseOutputs } = {}) {
  const template = candidateBlockTemplate(state, { minerAddress, timestampMs, txids, coinbaseOutputs });
  return mineTemplate(template);
}

function appendNext(state, options) {
  const envelope = mineNext(state, options);
  return { state: appendCandidateBlock(state, envelope, { nowMs: options.timestampMs }), envelope };
}

function manualEnvelopeWithRecords(state, { minerAddress, timestampMs, records }) {
  const txids = records.map(record => record.txid);
  const fees = records.reduce((sum, record) => sum + BigInt(record.fee_atoms), 0n);
  const height = state.chain.length + 1;
  const subsidy = expectedCandidateSubsidy(state, height);
  const coinbaseOutputs = [{ address: minerAddress, amount_atoms: (subsidy + fees).toString() }];
  const header = {
    version: 5,
    network: CANDIDATE_NETWORK_ID,
    genesis_commitment: CANDIDATE_GENESIS_COMMITMENT,
    height,
    previous_hash: state.chain.at(-1)?.hash || '0'.repeat(64),
    timestamp_ms: timestampMs,
    target_hex: targetHex(nextCandidateTarget(state)),
    subsidy_atoms: subsidy.toString(),
    fee_atoms: fees.toString(),
    miner_address: minerAddress,
    coinbase_root: hashHex(coinbaseOutputs),
    coinbase_count: 1,
    tx_root: hashHex(txids),
    tx_count: txids.length,
  };
  return mineTemplate({ header, txids, coinbaseOutputs });
}

const miner = wallet();
const receiver = wallet();
const BASE = 1_900_000_000_000;
const STEP = 300_000;
let state = emptyCandidateState();

// Mine the first reward and establish the 300-second full-target DAA anchor.
let mined = appendNext(state, { minerAddress: miner.address, timestampMs: BASE });
state = mined.state;
const firstBlockHash = mined.envelope.hash;
const firstCoinbase = `${firstBlockHash}:0`;
assert.equal(state.chain.length, 1);
assert.equal(state.chain[0].target_hex, targetHex(nextCandidateTarget(emptyCandidateState())));
assert.equal(state.utxos[firstCoinbase].origin, 'coinbase');
assert.equal(state.utxos[firstCoinbase].created_height, 1);
assert.equal(state.utxos[firstCoinbase].coinbase_matures_at_height, 201);

// Build to height 199 at exactly the candidate target cadence. The full target
// must remain stable on schedule and every block must mint exactly 14 FAE.
for (let height = 2; height <= 199; height++) {
  const next = appendNext(state, { minerAddress: miner.address, timestampMs: BASE + (height - 1) * STEP });
  state = next.state;
  assert.equal(state.chain.at(-1).target_hex, state.chain[0].target_hex);
  assert.equal(state.chain.at(-1).subsidy_atoms, '1400000000');
}
assert.equal(state.chain.length, 199);

const spend = signedTx(miner, [firstCoinbase], [
  { address: receiver.address, amount_atoms: '1300000000' },
]);

// Mempool integration: tip 199 means candidate spend height 200, exactly one
// block too early. The real candidate mempool path must reject it.
assert.throws(
  () => acceptCandidateTxInto(state, spend),
  error => error.code === 'immature_coinbase' && error.remainingBlocks === 1 && error.maturesAtHeight === 201,
);
assert.equal(state.mempoolOrder.length, 0);

// Block-validation integration must also reject the same spend at height 200,
// even when supplied directly as a candidate block record instead of via mempool.
const verifiedEarly = signedTx(miner, [firstCoinbase], [
  { address: receiver.address, amount_atoms: '1300000000' },
]);
const earlyRecord = {
  ...verifiedEarly,
  txid: hashHex({ ...verifiedEarly, version: CANDIDATE_TX_VERSION, network: CANDIDATE_NETWORK_ID, inputs: verifiedEarly.inputs, outputs: verifiedEarly.outputs, public_key_spki: verifiedEarly.public_key_spki, signature: verifiedEarly.signature }),
  from_address: miner.address,
  fee_atoms: '100000000',
  status: 'pending',
  confirmed_height: null,
  mempool_seq: 1,
  created_at: 'candidate-test',
};
const earlyEnvelope = manualEnvelopeWithRecords(state, {
  minerAddress: miner.address,
  timestampMs: BASE + 199 * STEP,
  records: [earlyRecord],
});
assert.throws(
  () => appendCandidateBlock(state, earlyEnvelope, {
    nowMs: BASE + 199 * STEP,
    feeRecords: new Map([[earlyRecord.txid, earlyRecord]]),
  }),
  error => error.code === 'immature_coinbase',
);
assert.equal(state.chain.length, 199, 'failed block must not mutate the original state');
assert.equal(state.utxos[firstCoinbase].spent, false);

// Mine height 200 empty. At tip 200, the next candidate block is 201 and the
// exact same coinbase becomes mempool-spendable.
mined = appendNext(state, { minerAddress: miner.address, timestampMs: BASE + 199 * STEP });
state = mined.state;
assert.equal(state.chain.length, 200);
const accepted = acceptCandidateTxInto(state, spend, { createdAt: 'candidate-test' });
assert.equal(accepted.status, 'pending');
assert.equal(accepted.fee_atoms, '100000000');

// Height 201 confirms the mature spend; fees are committed into the coinbase,
// while only the 14 FAE subsidy contributes to monetary issuance.
mined = appendNext(state, {
  minerAddress: miner.address,
  timestampMs: BASE + 200 * STEP,
  txids: [accepted.txid],
});
state = mined.state;
assert.equal(state.chain.length, 201);
assert.equal(state.transactions[accepted.txid].status, 'confirmed');
assert.equal(state.transactions[accepted.txid].confirmed_height, 201);
assert.equal(state.utxos[firstCoinbase].spent, true);
assert.equal(state.chain.at(-1).fee_atoms, '100000000');
assert.equal(BigInt(state.chain.at(-1).coinbase_outputs[0].amount_atoms), 1_500_000_000n);

const report201 = candidateStateInvariantReport(state);
assert.equal(report201.underCap, true);
assert.equal(report201.issuedSubsidyAtoms, (201n * 1_400_000_000n).toString());
assert.equal(report201.targetSeconds, 300);
assert.equal(report201.coinbaseMaturityBlocks, 200);
assert.equal(report201.unknownUtxoOrigins, 0);
assert.equal(report201.activationAuthorized, false);
assert.equal(report201.publicConsensusChanged, false);

// Deterministic replay must reconstruct the same tip, issuance, transaction and
// UTXO spend state from the integrated block records.
const replayed = rebuildCandidateState(state.chain, { nowMs: BASE + 200 * STEP });
assert.equal(replayed.chain.at(-1).hash, state.chain.at(-1).hash);
assert.equal(replayed.transactions[accepted.txid].status, 'confirmed');
assert.equal(replayed.utxos[firstCoinbase].spent, true);
assert.deepEqual(candidateStateInvariantReport(replayed), candidateStateInvariantReport(state));

// Build an alternative branch from height 150 that omits the height-201 spend
// and becomes longer. Reorg adoption must be chainwork-based, rebuild canonical
// state, and resurrect the detached spend into mempool because its input is now
// unspent and mature on the new tip.
let alternative = rebuildCandidateState(state.chain.slice(0, 150), { nowMs: BASE + 149 * STEP });
for (let height = 151; height <= 202; height++) {
  const next = appendNext(alternative, {
    minerAddress: receiver.address,
    timestampMs: BASE + (height - 1) * STEP,
  });
  alternative = next.state;
}
assert.equal(alternative.chain.length, 202);
const reorg = reorganizeCandidateState(state, alternative.chain, { nowMs: BASE + 201 * STEP });
assert.equal(reorg.state.chain.length, 202);
assert.ok(reorg.newWork > reorg.oldWork);
assert.deepEqual(reorg.resurrected, [accepted.txid]);
assert.deepEqual(reorg.dropped, []);
assert.equal(reorg.state.transactions[accepted.txid].status, 'pending');
assert.equal(reorg.state.utxos[firstCoinbase].spent, false);

// The resurrected transaction can be confirmed on the winning branch and the
// candidate remains internally consistent after reorg + mempool replay.
mined = appendNext(reorg.state, {
  minerAddress: receiver.address,
  timestampMs: BASE + 202 * STEP,
  txids: [accepted.txid],
});
const finalState = mined.state;
assert.equal(finalState.chain.length, 203);
assert.equal(finalState.transactions[accepted.txid].status, 'confirmed');
assert.equal(finalState.transactions[accepted.txid].confirmed_height, 203);
const finalReport = candidateStateInvariantReport(finalState);
assert.equal(finalReport.underCap, true);
assert.equal(finalReport.unknownUtxoOrigins, 0);
assert.equal(finalReport.network, CANDIDATE_NETWORK_ID);
assert.equal(finalReport.genesisCommitment, CANDIDATE_GENESIS_COMMITMENT);

// Candidate blocks are network/genesis bound; a v4-like envelope cannot cross
// the activation boundary.
const wrongNetworkTemplate = candidateBlockTemplate(finalState, {
  minerAddress: miner.address,
  timestampMs: BASE + 203 * STEP,
});
wrongNetworkTemplate.header.network = 'fairyelf-public-testnet-v4';
const wrongNetworkEnvelope = mineTemplate(wrongNetworkTemplate);
assert.throws(
  () => appendCandidateBlock(finalState, wrongNetworkEnvelope, { nowMs: BASE + 203 * STEP }),
  error => error.code === 'wrong_network_or_genesis',
);

console.log('fae-v5-300-core-integration: PASS');
