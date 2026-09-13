import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../node/authoritative/canonical.mjs';
import {
  acceptCandidateTxInto, cloneCandidateState, reorganizeCandidateState, candidateChainWork,
} from '../node/candidate/fae-v5-300-core.mjs';
import {
  candidateRecoverySnapshot, restoreCandidateRecoverySnapshot, openCandidateRecoveryStore,
} from '../node/candidate/network-recovery-v1.mjs';
import { fixtureChain, fixtureWallet, fixtureTx, fixtureNext, STEP_MS } from './network-recovery-v1-fixtures.mjs';

const { state: baseline, miner, baseTime } = fixtureChain();
const receiver = fixtureWallet(72), recipient = fixtureWallet(73), rival = fixtureWallet(74);
const now = () => baseTime + 210 * STEP_MS;

function pendingFamily(base = baseline) {
  const state = cloneCandidateState(base);
  const parent = acceptCandidateTxInto(state, fixtureTx(miner, [`${state.chain[0].hash}:0`], [
    { address: receiver.address, amount_atoms: '1300000000' },
  ]), { createdAt: '2026-09-13T00:00:00.000Z' });
  const child = acceptCandidateTxInto(state, fixtureTx(receiver, [`${parent.txid}:0`], [
    { address: recipient.address, amount_atoms: '1200000000' },
  ]), { createdAt: '2026-09-13T00:00:01.000Z' });
  return { state, parent, child };
}

async function storePath(context) {
  const dir = await mkdtemp(join(tmpdir(), 'fae-recovery-store-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state.json');
}

test('recovery replays chain and pending dependencies; sequence metadata and cached balances have no ordering authority', () => {
  const { state, parent, child } = pendingFamily();
  // A resurrected parent may carry a newer sequence than its still-pending child.
  parent.mempool_seq = 20;
  child.mempool_seq = 5;
  state.mempoolSeq = 20;
  const snapshot = candidateRecoverySnapshot(state);
  snapshot.utxos = { invented: { amount_atoms: '99999999999999999999999' } };
  const recovered = restoreCandidateRecoverySnapshot(snapshot, { nowMs: now() });
  assert.deepEqual(recovered.mempoolOrder, [parent.txid, child.txid]);
  assert.deepEqual(recovered.utxos, state.utxos);
  assert.deepEqual(recovered.mempoolSpends, state.mempoolSpends);
  assert.deepEqual(recovered.mempoolOutputs, state.mempoolOutputs);
  assert.equal(recovered.mempoolSeq, 20);
  assert.equal(recovered.utxos[`${state.chain[0].hash}:0`].coinbase_matures_at_height, 201);
});

test('recovery rejects identity changes, invalid signatures, duplicates and child-before-parent snapshots', () => {
  const snapshot = candidateRecoverySnapshot(pendingFamily().state);
  for (const key of ['network', 'profileId', 'genesisCommitment', 'initialTargetHex', 'transactionDomainCommitment']) {
    const wrong = structuredClone(snapshot);
    wrong[key] = 'foreign';
    assert.throws(() => restoreCandidateRecoverySnapshot(wrong, { nowMs: now() }), { code: `recovery_identity_mismatch:${key}` });
  }
  const invalid = structuredClone(snapshot);
  invalid.pending[0].signature = Buffer.alloc(64).toString('base64');
  assert.throws(() => restoreCandidateRecoverySnapshot(invalid, { nowMs: now() }), { code: 'invalid_signature' });
  const duplicate = structuredClone(snapshot);
  duplicate.pending.push(duplicate.pending[0]);
  assert.throws(() => restoreCandidateRecoverySnapshot(duplicate, { nowMs: now() }), { code: 'duplicate_txid' });
  const reversed = structuredClone(snapshot);
  reversed.pending.reverse();
  assert.throws(() => restoreCandidateRecoverySnapshot(reversed, { nowMs: now() }), { code: 'missing_or_spent_input' });
});

test('a truncated primary snapshot recovers the last valid backup, with its pending transactions', async context => {
  const path = await storePath(context);
  const { state, parent } = pendingFamily();
  const store = await openCandidateRecoveryStore({ path, now });
  await store.save(state);
  const confirmed = fixtureNext(state, miner.address, baseTime + 200 * STEP_MS, [parent.txid]);
  await store.save(confirmed);
  await writeFile(path, '{"interrupted":');
  const recovered = await openCandidateRecoveryStore({ path, now });
  assert.equal(recovered.status().recoveredOnStart, true);
  assert.equal(recovered.status().healedOnStart, true);
  assert.deepEqual(candidateRecoverySnapshot(recovered.state), candidateRecoverySnapshot(state));
  const restarted = await openCandidateRecoveryStore({ path, now });
  assert.equal(restarted.status().recoveredOnStart, false);
  assert.deepEqual(candidateRecoverySnapshot(restarted.state), candidateRecoverySnapshot(state));
});

test('a complete newer temporary snapshot survives an interruption before rename', async context => {
  const path = await storePath(context);
  const { state, parent } = pendingFamily();
  const store = await openCandidateRecoveryStore({ path, now });
  await store.save(state);
  const old = await readFile(path);
  const next = fixtureNext(state, miner.address, baseTime + 200 * STEP_MS, [parent.txid]);
  await store.save(next);
  const completeTemporary = await readFile(path);
  await writeFile(`${path}.tmp`, completeTemporary);
  await writeFile(path, old);
  const recovered = await openCandidateRecoveryStore({ path, now });
  assert.equal(recovered.status().generation, 2);
  assert.equal(recovered.status().recoveredOnStart, true);
  assert.deepEqual(candidateRecoverySnapshot(recovered.state), candidateRecoverySnapshot(next));
});

test('unrecoverable storage fails at startup; a matching checksum cannot validate a broken transaction', async context => {
  const path = await storePath(context);
  const store = await openCandidateRecoveryStore({ path, now });
  await store.save(pendingFamily().state);
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  envelope.state.pending[0].signature = Buffer.alloc(64).toString('base64');
  envelope.state_hash = createHash('sha256').update(stableStringify(envelope.state)).digest('hex');
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(openCandidateRecoveryStore({ path, now }), { code: 'durable_state_unrecoverable' });
  await writeFile(path, '{');
  await writeFile(`${path}.tmp`, '{');
  await writeFile(`${path}.bak`, '{');
  await assert.rejects(openCandidateRecoveryStore({ path, now }), { code: 'durable_state_unrecoverable' });
});

test('a winning conflicting spend drops the detached family and retains an unrelated pending transaction', () => {
  const common = fixtureNext(baseline, miner.address, baseTime + 200 * STEP_MS);
  const { state, parent, child } = pendingFamily(common);
  const unrelated = acceptCandidateTxInto(state, fixtureTx(miner, [`${common.chain[1].hash}:0`], [
    { address: recipient.address, amount_atoms: '1250000000' },
  ]));
  const old = fixtureNext(state, miner.address, baseTime + 201 * STEP_MS, [parent.txid, child.txid]);
  let alternative = cloneCandidateState(common);
  const conflict = acceptCandidateTxInto(alternative, fixtureTx(miner, [`${common.chain[0].hash}:0`], [
    { address: rival.address, amount_atoms: '1100000000' },
  ]));
  alternative = fixtureNext(alternative, rival.address, baseTime + 201 * STEP_MS, [conflict.txid]);
  alternative = fixtureNext(alternative, rival.address, baseTime + 202 * STEP_MS);
  const before = structuredClone(old);
  const result = reorganizeCandidateState(old, alternative.chain, { nowMs: now() });
  assert.deepEqual(old, before, 'reorg must not partially mutate its input');
  assert.deepEqual(result.resurrected, [unrelated.txid]);
  assert.deepEqual(result.dropped.map(row => row.txid), [parent.txid, child.txid]);
  assert.equal(result.state.transactions[conflict.txid].status, 'confirmed');
  assert.equal(result.state.transactions[parent.txid], undefined);
  assert.equal(result.state.transactions[child.txid], undefined);
  const recovered = restoreCandidateRecoverySnapshot(candidateRecoverySnapshot(result.state), { nowMs: now() });
  assert.deepEqual(recovered.utxos, alternative.utxos);
  assert.deepEqual(recovered.mempoolOrder, [unrelated.txid]);
  assert.throws(() => reorganizeCandidateState(result.state, old.chain, { nowMs: now() }), { code: 'insufficient_chainwork' });
});

test('a shorter branch with more work can undo coinbase maturity; recovery never restores the now-immature spend', () => {
  const { state, parent, child } = pendingFamily();
  const old = fixtureNext(state, miner.address, baseTime + 200 * STEP_MS, [parent.txid, child.txid]);
  let stronger = cloneCandidateState(baseline);
  // Retain only the common first block, then generate a faster, harder valid branch.
  const prefix = candidateRecoverySnapshot(stronger);
  prefix.blocks = prefix.blocks.slice(0, 1);
  stronger = restoreCandidateRecoverySnapshot(prefix, { nowMs: now() });
  for (let height = 2; height <= 199; height++) {
    stronger = fixtureNext(stronger, rival.address, baseTime + (height - 1) * 1_000);
  }
  assert.ok(candidateChainWork(stronger.chain) > candidateChainWork(old.chain));
  const result = reorganizeCandidateState(old, stronger.chain, { nowMs: now() });
  assert.equal(result.state.chain.length, 199);
  assert.deepEqual(result.resurrected, []);
  assert.equal(result.dropped.find(row => row.txid === parent.txid)?.reason, 'immature_coinbase');
  assert.ok(result.dropped.some(row => row.txid === child.txid));
  const recovered = restoreCandidateRecoverySnapshot(candidateRecoverySnapshot(result.state), { nowMs: now() });
  assert.deepEqual(recovered.mempoolOrder, []);
  assert.equal(recovered.utxos[`${baseline.chain[0].hash}:0`].coinbase_matures_at_height, 201);
});
