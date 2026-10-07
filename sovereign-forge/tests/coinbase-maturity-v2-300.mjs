import assert from 'node:assert/strict';
import {
  COINBASE_ORIGIN,
  TRANSACTION_ORIGIN,
  coinbaseMaturesAtHeight,
  materializeCoinbaseOutputs,
  materializeTransactionOutput,
  spendabilityAtHeight,
  assertInputsSpendableAtHeight,
  mempoolSpendHeight,
  spendableOutputsForAddress,
} from '../node/candidate/coinbase-maturity-v2-300.mjs';

const hash = 'a'.repeat(64);
const miner = 'fae-test-address-for-policy-only';
const coinbase = materializeCoinbaseOutputs({
  blockHash: hash,
  height: 1,
  outputs: [{ address: miner, amount_atoms: '1400000000' }],
});
const cb = coinbase[`${hash}:0`];

assert.equal(cb.origin, COINBASE_ORIGIN);
assert.equal(cb.created_height, 1);
assert.equal(cb.coinbase_matures_at_height, 201);
assert.equal(coinbaseMaturesAtHeight(1), 201);
assert.equal(spendabilityAtHeight(cb, 200).ok, false);
assert.equal(spendabilityAtHeight(cb, 200).error, 'immature_coinbase');
assert.equal(spendabilityAtHeight(cb, 201).ok, true);

// Mempool uses the next candidate block height, preventing one-block-early admission.
assert.equal(mempoolSpendHeight(199), 200);
assert.throws(
  () => assertInputsSpendableAtHeight(coinbase, [`${hash}:0`], mempoolSpendHeight(199)),
  error => error.code === 'immature_coinbase' && error.remainingBlocks === 1,
);
assert.equal(assertInputsSpendableAtHeight(coinbase, [`${hash}:0`], mempoolSpendHeight(200)), true);

// Multiple direct/PPLNS coinbase outputs inherit exactly the same maturity.
const multi = materializeCoinbaseOutputs({
  blockHash: 'b'.repeat(64),
  height: 430_000,
  outputs: [
    { address: 'miner-a', amount_atoms: '700000000' },
    { address: 'miner-b', amount_atoms: '700000000' },
  ],
});
assert.equal(Object.values(multi).every(x => x.origin === COINBASE_ORIGIN), true);
assert.equal(Object.values(multi).every(x => x.coinbase_matures_at_height === 430_200), true);
assert.equal(Object.values(multi).every(x => spendabilityAtHeight(x, 430_199).error === 'immature_coinbase'), true);
assert.equal(Object.values(multi).every(x => spendabilityAtHeight(x, 430_200).ok), true);

// Ordinary confirmed transaction outputs are not subject to coinbase maturity.
const normal = materializeTransactionOutput({
  outpoint: 'txid:0',
  address: miner,
  amountAtoms: '100000000',
  createdHeight: 200,
});
assert.equal(normal.origin, TRANSACTION_ORIGIN);
assert.equal(spendabilityAtHeight(normal, 201).ok, true);

// Reorg safety: maturity is evaluated against the candidate spend height after the reorg,
// not cached from a previously taller chain.
const reorgCoinbaseMap = materializeCoinbaseOutputs({
  blockHash: 'c'.repeat(64),
  height: 100,
  outputs: [{ address: miner, amount_atoms: '1400000000' }],
});
const reorgOutpoint = `${'c'.repeat(64)}:0`;
assert.equal(assertInputsSpendableAtHeight(reorgCoinbaseMap, [reorgOutpoint], mempoolSpendHeight(299)), true); // spend height 300
assert.throws(
  () => assertInputsSpendableAtHeight(reorgCoinbaseMap, [reorgOutpoint], mempoolSpendHeight(250)), // after reorg, spend height 251
  error => error.code === 'immature_coinbase' && error.maturesAtHeight === 300 && error.remainingBlocks === 49,
);

// Persisted metadata cannot move maturity earlier than the consensus-derived value.
const forged = { ...cb, coinbase_matures_at_height: 2 };
assert.equal(spendabilityAtHeight(forged, 2).ok, false);
assert.equal(spendabilityAtHeight(forged, 2).error, 'coinbase_maturity_metadata_mismatch');

// Unknown origin fails closed; spent and missing inputs fail closed.
assert.equal(spendabilityAtHeight({ ...normal, origin: 'mystery' }, 201).error, 'unknown_utxo_origin');
assert.equal(spendabilityAtHeight({ ...normal, spent: true }, 201).error, 'spent_input');
assert.equal(spendabilityAtHeight(null, 201).error, 'missing_input');
assert.throws(
  () => assertInputsSpendableAtHeight({ 'x:0': normal }, ['x:0', 'x:0'], 201),
  error => error.code === 'duplicate_input',
);

// Wallet enumeration must hide immature rewards until the exact boundary.
const walletSet = { ...coinbase, 'txid:0': normal };
assert.deepEqual(spendableOutputsForAddress(walletSet, miner, 200).map(x => x.outpoint), ['txid:0']);
assert.deepEqual(new Set(spendableOutputsForAddress(walletSet, miner, 201).map(x => x.outpoint)), new Set([`${hash}:0`, 'txid:0']));

console.log('coinbase-maturity-v2-300: PASS');
