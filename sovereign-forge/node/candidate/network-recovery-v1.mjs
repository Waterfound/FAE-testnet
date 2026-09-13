import { DurableStateStore } from '../authoritative/durable-state-store.mjs';
import {
  DEFAULT_CANDIDATE_BINDING, emptyCandidateState, stateConsensusBinding,
  rebuildCandidateState, acceptCandidateTxInto,
} from './fae-v5-300-core.mjs';

export const RECOVERY_SNAPSHOT_FORMAT = 'FAE_V5_NETWORK_RECOVERY_V1';
const IDENTITY_FIELDS = ['network', 'profileId', 'genesisCommitment', 'initialTargetHex', 'transactionDomainCommitment'];

function fail(code) { throw Object.assign(new Error(code), { code }); }

export function candidateRecoverySnapshot(state) {
  const binding = stateConsensusBinding(state);
  const identity = Object.fromEntries(IDENTITY_FIELDS.map(key => [key, binding[key]]));
  return {
    format: RECOVERY_SNAPSHOT_FORMAT,
    ...identity,
    blocks: structuredClone(state.chain),
    // Preserve dependency order; old mempool sequence numbers are only metadata.
    pending: state.mempoolOrder.map(txid => {
      const record = state.transactions[txid];
      if (!record || record.status !== 'pending' || record.txid !== txid) fail('invalid_recovery_pending_record');
      return structuredClone(record);
    }),
    mempoolSeq: state.mempoolSeq,
  };
}

export function restoreCandidateRecoverySnapshot(snapshot, {
  binding = DEFAULT_CANDIDATE_BINDING, nowMs = Date.now(),
} = {}) {
  const expected = emptyCandidateState({ binding });
  if (!snapshot || snapshot.format !== RECOVERY_SNAPSHOT_FORMAT) fail('wrong_recovery_snapshot_format');
  for (const key of IDENTITY_FIELDS) if (snapshot[key] !== expected[key]) fail(`recovery_identity_mismatch:${key}`);
  if (!Array.isArray(snapshot.blocks) || !Array.isArray(snapshot.pending)) fail('invalid_recovery_collections');
  if (!Number.isSafeInteger(snapshot.mempoolSeq) || snapshot.mempoolSeq < 0) fail('invalid_recovery_mempool_sequence');

  // Reconstruct balances, confirmations and maturity from validated block records.
  // No serialized UTXO cache has authority over the recovered state.
  const state = rebuildCandidateState(snapshot.blocks, { nowMs, binding });
  for (const record of snapshot.pending) {
    if (!record || record.status !== 'pending' || record.profile_id !== state.profileId) fail('invalid_recovery_pending_record');
    if (!Number.isSafeInteger(record.mempool_seq) || record.mempool_seq < 1) fail('invalid_recovery_pending_sequence');
    acceptCandidateTxInto(state, record, { fromFeed: true, createdAt: record.created_at });
  }
  if (snapshot.mempoolSeq < state.mempoolSeq) fail('recovery_mempool_sequence_regressed');
  state.mempoolSeq = snapshot.mempoolSeq;
  return state;
}

export async function openCandidateRecoveryStore({ path, binding = DEFAULT_CANDIDATE_BINDING, now = Date.now } = {}) {
  const empty = emptyCandidateState({ binding });
  const verifyState = snapshot => candidateRecoverySnapshot(restoreCandidateRecoverySnapshot(snapshot, { binding, nowMs: now() }));
  const durable = new DurableStateStore({ path, networkId: empty.network, verifyState });
  const loaded = await durable.load();
  const state = loaded.state
    ? restoreCandidateRecoverySnapshot(loaded.state, { binding, nowMs: now() })
    : empty;
  let tail = Promise.resolve();
  return {
    state,
    // Serialize snapshots, including callers outside the HTTP mutation queue.
    save(nextState) {
      const snapshot = candidateRecoverySnapshot(nextState);
      const run = tail.then(async () => durable.save(await verifyState(snapshot)));
      tail = run.catch(() => {});
      return run;
    },
    status() {
      const report = durable.status();
      return {
        enabled: true, generation: report.generation,
        recoveredOnStart: report.recovered_on_start,
        healedOnStart: report.healed_on_start,
        snapshotFormat: RECOVERY_SNAPSHOT_FORMAT,
      };
    },
  };
}
