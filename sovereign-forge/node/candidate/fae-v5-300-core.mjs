import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { stableStringify } from '../authoritative/canonical.mjs';
import { hashHex, sha256 } from '../authoritative/crypto.mjs';
import { encodeAddress, isValidAddress } from '../authoritative/address.mjs';
import {
  ECONOMIC_V2_300,
  subsidyAtoms,
  terminalIssuanceAtoms,
} from './economic-v2-300.mjs';
import {
  DAA_V2_300,
  MAX_HASH,
  candidateNextTarget300,
  validateTimestamp300,
  targetFromHex,
  targetHex,
  hashMeetsTarget,
} from './difficulty-timestamp-v2-300.mjs';
import {
  COINBASE_ORIGIN,
  TRANSACTION_ORIGIN,
  materializeCoinbaseOutputs,
  spendabilityAtHeight,
  mempoolSpendHeight,
} from './coinbase-maturity-v2-300.mjs';
import {
  CANDIDATE_NETWORK_ID,
  candidateTxDomain,
  assertCandidateNetwork,
} from './network-boundary-v2-300.mjs';
import { l3TestLaunchProfile } from './activation-profile-v2-300.mjs';
import { createProfileConsensusBinding } from './profile-consensus-binding-v2-300.mjs';

export const CANDIDATE_STATE_FORMAT = 'FAE_V5_300_CANDIDATE_STATE_V2_PROFILE_BOUND';
export const CANDIDATE_TX_VERSION = 3;
export const MAX_INPUTS = 64;
export const MAX_OUTPUTS = 16;
export const MAX_COINBASE_OUTPUTS = 64;
export const ZERO_HASH = '0'.repeat(64);

export const DEFAULT_CANDIDATE_PROFILE = l3TestLaunchProfile();
export const DEFAULT_CANDIDATE_BINDING = createProfileConsensusBinding(DEFAULT_CANDIDATE_PROFILE);

function fail(code, detail = {}) {
  throw Object.assign(new Error(code), { code, ...detail });
}

function atom(value, field = 'amount_atoms') {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`invalid_${field}`);
}

function positiveSafeInteger(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`invalid_${field}`);
  return n;
}

function nonNegativeSafeInteger(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid_${field}`);
  return n;
}

function normalizedBinding(binding = DEFAULT_CANDIDATE_BINDING) {
  if (!binding || binding.network !== CANDIDATE_NETWORK_ID) fail('candidate_binding_network_mismatch');
  const profileId = String(binding.profileId || '');
  const genesisCommitment = String(binding.genesisCommitment || '');
  const initialTargetHex = String(binding.initialTargetHex || '').toLowerCase();
  if (!profileId) fail('candidate_binding_profile_id_required');
  if (!/^[0-9a-f]{64}$/.test(genesisCommitment)) fail('candidate_binding_genesis_invalid');
  if (!/^[0-9a-f]{64}$/.test(initialTargetHex)) fail('candidate_binding_initial_target_invalid');
  targetFromHex(initialTargetHex);
  const descriptor = {
    domain: 'FAIRYELF_TX_V5_300_PROFILE_BOUND',
    network: CANDIDATE_NETWORK_ID,
    profileId,
    genesisCommitment,
  };
  const transactionDomainCommitment = hashHex(descriptor);
  if (binding.transactionDomainCommitment && binding.transactionDomainCommitment !== transactionDomainCommitment) {
    fail('candidate_binding_transaction_domain_mismatch');
  }
  if (binding.activationAuthorized !== false || binding.publicConsensusChanged !== false) fail('candidate_binding_authority_leak');
  return Object.freeze({
    authority: 'candidate-not-active-consensus',
    network: CANDIDATE_NETWORK_ID,
    profileId,
    profileClass: String(binding.profileClass || 'profile-bound-candidate'),
    genesisCommitment,
    initialTargetHex,
    transactionDomainCommitment,
    activationProfileReady: binding.activationProfileReady === true,
    testOnly: binding.testOnly === true,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}

export function candidateBindingFromProfile(profile = DEFAULT_CANDIDATE_PROFILE) {
  return normalizedBinding(createProfileConsensusBinding(profile));
}

export function stateConsensusBinding(state) {
  if (!state || state.network !== CANDIDATE_NETWORK_ID) fail('candidate_state_network_mismatch');
  return normalizedBinding({
    network: state.network,
    profileId: state.profileId,
    profileClass: state.profileClass,
    genesisCommitment: state.genesisCommitment,
    initialTargetHex: state.initialTargetHex,
    transactionDomainCommitment: state.transactionDomainCommitment,
    activationProfileReady: state.activationProfileReady,
    testOnly: state.testOnly,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}

export function emptyCandidateState({ profile = null, binding = null } = {}) {
  if (profile && binding) fail('candidate_profile_and_binding_are_mutually_exclusive');
  const resolved = binding ? normalizedBinding(binding) : candidateBindingFromProfile(profile || DEFAULT_CANDIDATE_PROFILE);
  return {
    format: CANDIDATE_STATE_FORMAT,
    authority: 'candidate-not-active-consensus',
    network: resolved.network,
    profileId: resolved.profileId,
    profileClass: resolved.profileClass,
    genesisCommitment: resolved.genesisCommitment,
    initialTargetHex: resolved.initialTargetHex,
    transactionDomainCommitment: resolved.transactionDomainCommitment,
    activationProfileReady: resolved.activationProfileReady,
    testOnly: resolved.testOnly,
    chain: [],
    transactions: {},
    mempoolOrder: [],
    mempoolSeq: 0,
    utxos: {},
    mempoolSpends: {},
    mempoolOutputs: {},
  };
}

export function cloneCandidateState(state) {
  return structuredClone(state);
}

export function candidateTip(state) {
  return state.chain.at(-1) || null;
}

export function issuedSubsidyAtoms(state) {
  return state.chain.reduce((sum, block) => sum + BigInt(block.subsidy_atoms), 0n);
}

export function expectedCandidateSubsidy(state, height) {
  const scheduled = subsidyAtoms(height);
  const remaining = ECONOMIC_V2_300.theoreticalCapAtoms - issuedSubsidyAtoms(state);
  if (remaining <= 0n) return 0n;
  return scheduled < remaining ? scheduled : remaining;
}

export function candidateChainWork(chain) {
  return chain.reduce((sum, block) => {
    const target = targetFromHex(block.target_hex);
    return sum + (MAX_HASH / (target + 1n)) + 1n;
  }, 0n);
}

export function nextCandidateTarget(state) {
  const binding = stateConsensusBinding(state);
  if (!state.chain.length) return targetFromHex(binding.initialTargetHex);
  const first = state.chain[0];
  return candidateNextTarget300(state.chain, {
    anchor: {
      target: targetFromHex(first.target_hex),
      height: 1,
      parent_time_seconds: Math.floor(Number(first.timestamp_ms) / 1000) - ECONOMIC_V2_300.targetSeconds,
    },
  });
}

export function deriveCandidateAddress(publicKeySpkiBytes) {
  return encodeAddress(sha256(publicKeySpkiBytes).subarray(0, 20), 'faet');
}

export function normalizeCandidateTx(raw) {
  return {
    version: CANDIDATE_TX_VERSION,
    network: String(raw.network),
    inputs: [...(raw.inputs || [])].map(String),
    outputs: [...(raw.outputs || [])].map(output => ({
      address: String(output.address),
      amount_atoms: String(output.amount_atoms),
    })),
    public_key_spki: String(raw.public_key_spki || ''),
    signature: String(raw.signature || ''),
  };
}

export function verifyCandidateTxCrypto(raw, binding = DEFAULT_CANDIDATE_BINDING) {
  try {
    const resolved = normalizedBinding(binding);
    const tx = normalizeCandidateTx(raw);
    if (raw?.version !== undefined && Number(raw.version) !== CANDIDATE_TX_VERSION) return { ok: false, error: 'wrong_version' };
    assertCandidateNetwork(tx.network);
    if (tx.inputs.length < 1 || tx.inputs.length > MAX_INPUTS || tx.outputs.length < 1 || tx.outputs.length > MAX_OUTPUTS) return { ok: false, error: 'malformed_transaction' };
    if (new Set(tx.inputs).size !== tx.inputs.length || tx.inputs.some(input => !input || input.length > 160)) return { ok: false, error: 'invalid_inputs' };
    for (const output of tx.outputs) {
      if (!isValidAddress(output.address, 'faet') || atom(output.amount_atoms) <= 0n) return { ok: false, error: 'invalid_output' };
    }
    const spki = Buffer.from(tx.public_key_spki, 'base64');
    const signature = Buffer.from(tx.signature, 'base64');
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const signedDomain = candidateTxDomain(tx, resolved);
    if (!verifySignature(null, Buffer.from(stableStringify(signedDomain)), key, signature)) return { ok: false, error: 'invalid_signature' };
    const from = deriveCandidateAddress(spki);
    const txid = hashHex(tx);
    return { ok: true, tx, from, txid, profileId: resolved.profileId };
  } catch (error) {
    return { ok: false, error: error.code || 'invalid_public_key_or_signature', detail: error.message };
  }
}

function inputForMempool(state, outpoint, spendHeight) {
  const confirmed = state.utxos[outpoint];
  if (confirmed) {
    const verdict = spendabilityAtHeight(confirmed, spendHeight);
    if (!verdict.ok) fail(verdict.error, { outpoint, ...verdict });
    return confirmed;
  }
  const pending = state.mempoolOutputs[outpoint];
  if (!pending) fail('missing_or_spent_input', { outpoint });
  return pending;
}

export function acceptCandidateTxInto(state, raw, { fromFeed = false, createdAt = new Date().toISOString() } = {}) {
  const binding = stateConsensusBinding(state);
  const verified = verifyCandidateTxCrypto(raw, binding);
  if (!verified.ok) fail(verified.error, { detail: verified.detail });
  const { tx, from, txid } = verified;
  if (raw.txid && raw.txid !== txid) fail('txid_mismatch');
  if (raw.from_address && raw.from_address !== from) fail('from_key_mismatch');
  if (state.transactions[txid]) fail('duplicate_txid');

  const spendHeight = mempoolSpendHeight(state.chain.length);
  let inputSum = 0n;
  for (const outpoint of tx.inputs) {
    const output = inputForMempool(state, outpoint, spendHeight);
    if (output.address !== from) fail('input_not_owned', { outpoint });
    if (state.mempoolSpends[outpoint]) fail('input_reserved', { outpoint });
    inputSum += BigInt(output.amount_atoms);
  }
  let outputSum = 0n;
  for (const output of tx.outputs) outputSum += BigInt(output.amount_atoms);
  if (outputSum > inputSum) fail('overspend');
  const fee = inputSum - outputSum;

  const seq = fromFeed ? Number(raw.mempool_seq || ++state.mempoolSeq) : ++state.mempoolSeq;
  state.mempoolSeq = Math.max(state.mempoolSeq, seq);
  const record = {
    txid,
    version: CANDIDATE_TX_VERSION,
    network: state.network,
    profile_id: state.profileId,
    from_address: from,
    public_key_spki: tx.public_key_spki,
    signature: tx.signature,
    inputs: tx.inputs,
    outputs: tx.outputs,
    fee_atoms: fee.toString(),
    status: 'pending',
    confirmed_height: null,
    mempool_seq: seq,
    created_at: raw.created_at || createdAt,
  };
  state.transactions[txid] = record;
  state.mempoolOrder.push(txid);
  for (const outpoint of tx.inputs) state.mempoolSpends[outpoint] = txid;
  tx.outputs.forEach((output, index) => {
    const outpoint = `${txid}:${index}`;
    state.mempoolOutputs[outpoint] = {
      outpoint,
      txid,
      output_index: index,
      address: output.address,
      amount_atoms: String(output.amount_atoms),
      origin: TRANSACTION_ORIGIN,
    };
  });
  return record;
}

function confirmedSpendability(output, height, outpoint) {
  const verdict = spendabilityAtHeight(output, height);
  if (!verdict.ok) fail(verdict.error === 'missing_input' ? 'bad_input' : verdict.error, { outpoint, ...verdict });
}

export function applyConfirmedCandidateTx(state, record, height) {
  const txHeight = positiveSafeInteger(height, 'height');
  if (record.profile_id && record.profile_id !== state.profileId) fail('tx_profile_mismatch', { txid: record.txid });
  const verified = verifyCandidateTxCrypto(record, stateConsensusBinding(state));
  if (!verified.ok || verified.txid !== record.txid) fail('invalid_tx', { txid: record.txid, reason: verified.error || 'txid' });
  if (record.from_address && record.from_address !== verified.from) fail('from_key_mismatch', { txid: record.txid });

  let inputSum = 0n;
  for (const outpoint of verified.tx.inputs) {
    const output = state.utxos[outpoint];
    if (!output) fail('bad_input', { txid: record.txid, outpoint });
    confirmedSpendability(output, txHeight, outpoint);
    if (output.address !== verified.from) fail('input_not_owned', { txid: record.txid, outpoint });
    inputSum += BigInt(output.amount_atoms);
  }

  let outputSum = 0n;
  for (const output of verified.tx.outputs) outputSum += BigInt(output.amount_atoms);
  const fee = BigInt(record.fee_atoms ?? (inputSum - outputSum));
  if (inputSum !== outputSum + fee) fail('conservation', { txid: record.txid });

  for (const outpoint of verified.tx.inputs) {
    state.utxos[outpoint].spent = true;
    state.utxos[outpoint].spent_by = record.txid;
  }
  verified.tx.outputs.forEach((output, index) => {
    const outpoint = `${record.txid}:${index}`;
    state.utxos[outpoint] = {
      outpoint,
      address: output.address,
      amount_atoms: String(output.amount_atoms),
      created_height: txHeight,
      origin: TRANSACTION_ORIGIN,
      spent: false,
      spent_by: null,
    };
  });

  state.transactions[record.txid] = {
    ...record,
    version: CANDIDATE_TX_VERSION,
    network: state.network,
    profile_id: state.profileId,
    from_address: verified.from,
    fee_atoms: fee.toString(),
    status: 'confirmed',
    confirmed_height: txHeight,
  };
  for (const outpoint of verified.tx.inputs) delete state.mempoolSpends[outpoint];
  verified.tx.outputs.forEach((_, index) => delete state.mempoolOutputs[`${record.txid}:${index}`]);
  state.mempoolOrder = state.mempoolOrder.filter(id => id !== record.txid);
}

export function candidateTransactionFees(state, txids, { records = null, requirePending = true } = {}) {
  let total = 0n;
  for (const txid of txids) {
    const record = records ? records.get(String(txid)) : state.transactions[String(txid)];
    if (!record) fail('missing_tx', { txid });
    if (requirePending && record.status !== 'pending') fail('tx_not_pending', { txid });
    total += BigInt(record.fee_atoms || 0);
  }
  return total;
}

function normalizeCandidateCoinbaseOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > MAX_COINBASE_OUTPUTS) fail('invalid_coinbase_outputs');
  return outputs.map(output => {
    const address = String(output.address);
    const amount = atom(output.amount_atoms);
    if (!isValidAddress(address, 'faet') || amount <= 0n) fail('invalid_coinbase_output');
    return { address, amount_atoms: amount.toString() };
  });
}

function sumCoinbaseOutputs(outputs) {
  return outputs.reduce((sum, output) => sum + BigInt(output.amount_atoms), 0n);
}

export function candidateBlockTemplate(state, {
  minerAddress,
  timestampMs,
  txids = state.mempoolOrder.slice(0, ECONOMIC_V2_300.maxTxPerBlock),
  coinbaseOutputs = null,
} = {}) {
  stateConsensusBinding(state);
  if (!isValidAddress(minerAddress, 'faet')) fail('invalid_miner_address');
  const height = state.chain.length + 1;
  if (!Array.isArray(txids) || txids.length > ECONOMIC_V2_300.maxTxPerBlock || new Set(txids).size !== txids.length) fail('invalid_tx_list');
  const fees = candidateTransactionFees(state, txids, { requirePending: true });
  const subsidy = expectedCandidateSubsidy(state, height);
  const payout = subsidy + fees;
  const normalizedCoinbase = normalizeCandidateCoinbaseOutputs(coinbaseOutputs || [{ address: minerAddress, amount_atoms: payout.toString() }]);
  if (sumCoinbaseOutputs(normalizedCoinbase) !== payout) fail('invalid_coinbase_value');
  const target = nextCandidateTarget(state);
  const previous = candidateTip(state);
  const ts = nonNegativeSafeInteger(timestampMs, 'timestamp_ms');
  const header = {
    version: 5,
    network: state.network,
    profile_id: state.profileId,
    genesis_commitment: state.genesisCommitment,
    height,
    previous_hash: previous?.hash || ZERO_HASH,
    timestamp_ms: ts,
    target_hex: targetHex(target),
    subsidy_atoms: subsidy.toString(),
    fee_atoms: fees.toString(),
    miner_address: normalizedCoinbase[0].address,
    coinbase_root: hashHex(normalizedCoinbase),
    coinbase_count: normalizedCoinbase.length,
    tx_root: hashHex(txids),
    tx_count: txids.length,
  };
  return { header, txids: [...txids], coinbaseOutputs: normalizedCoinbase };
}

export function candidateBlockHash(header, nonce) {
  const n = nonNegativeSafeInteger(nonce, 'nonce');
  return hashHex({ ...header, nonce: n });
}

export function validateCandidateBlockEnvelope(state, {
  header,
  nonce,
  hash,
  txids,
  coinbaseOutputs,
}, { nowMs = Date.now(), feeRecords = null } = {}) {
  stateConsensusBinding(state);
  if (!header || header.network !== state.network || header.genesis_commitment !== state.genesisCommitment) fail('wrong_network_or_genesis');
  if (header.profile_id !== state.profileId) fail('wrong_profile');
  const height = state.chain.length + 1;
  const previous = candidateTip(state);
  if (Number(header.height) !== height || header.previous_hash !== (previous?.hash || ZERO_HASH)) fail('stale_tip');
  if (!Array.isArray(txids) || txids.length > ECONOMIC_V2_300.maxTxPerBlock || new Set(txids).size !== txids.length) fail('invalid_tx_list');
  if (hashHex(txids) !== header.tx_root || Number(header.tx_count) !== txids.length) fail('tx_commitment_mismatch');

  const expectedTarget = nextCandidateTarget(state);
  if (String(header.target_hex) !== targetHex(expectedTarget)) fail('invalid_target');
  if (String(header.subsidy_atoms) !== expectedCandidateSubsidy(state, height).toString()) fail('invalid_subsidy');

  const fees = candidateTransactionFees(state, txids, { records: feeRecords, requirePending: !feeRecords });
  if (String(header.fee_atoms) !== fees.toString()) fail('fee_commitment_mismatch');
  const normalizedCoinbase = normalizeCandidateCoinbaseOutputs(coinbaseOutputs);
  if (Number(header.coinbase_count) !== normalizedCoinbase.length || header.coinbase_root !== hashHex(normalizedCoinbase)) fail('coinbase_commitment_mismatch');
  if (header.miner_address !== normalizedCoinbase[0].address) fail('primary_coinbase_address_mismatch');
  if (sumCoinbaseOutputs(normalizedCoinbase) !== expectedCandidateSubsidy(state, height) + fees) fail('invalid_coinbase_value');

  const timestampVerdict = validateTimestamp300(state.chain, Number(header.timestamp_ms), { nowMs });
  if (!timestampVerdict.ok) fail(timestampVerdict.error, timestampVerdict);

  const computed = candidateBlockHash(header, nonce);
  if (computed !== hash) fail('block_hash_mismatch');
  if (!hashMeetsTarget(hash, expectedTarget)) fail('invalid_proof_of_work');
  return { height, target: expectedTarget, fees, coinbaseOutputs: normalizedCoinbase, timestampVerdict };
}

export function appendCandidateBlock(state, envelope, { nowMs = Date.now(), feeRecords = null } = {}) {
  const verdict = validateCandidateBlockEnvelope(state, envelope, { nowMs, feeRecords });
  const draft = cloneCandidateState(state);
  const txRecords = [];
  for (const txid of envelope.txids) {
    const record = feeRecords ? feeRecords.get(String(txid)) : draft.transactions[String(txid)];
    if (!record) fail('missing_tx', { txid });
    applyConfirmedCandidateTx(draft, record, verdict.height);
    txRecords.push(structuredClone(draft.transactions[String(txid)]));
  }

  const coinbaseMap = materializeCoinbaseOutputs({
    blockHash: envelope.hash,
    height: verdict.height,
    outputs: verdict.coinbaseOutputs,
  });
  Object.assign(draft.utxos, coinbaseMap);

  draft.chain.push({
    height: verdict.height,
    hash: envelope.hash,
    previous_hash: envelope.header.previous_hash,
    timestamp_ms: Number(envelope.header.timestamp_ms),
    target_hex: envelope.header.target_hex,
    subsidy_atoms: String(envelope.header.subsidy_atoms),
    fee_atoms: String(envelope.header.fee_atoms),
    miner_address: envelope.header.miner_address,
    coinbase_root: envelope.header.coinbase_root,
    coinbase_count: Number(envelope.header.coinbase_count),
    coinbase_outputs: structuredClone(verdict.coinbaseOutputs),
    tx_root: envelope.header.tx_root,
    tx_count: envelope.txids.length,
    txids: [...envelope.txids],
    tx_records: txRecords,
    nonce: Number(envelope.nonce),
    network: state.network,
    profile_id: state.profileId,
    genesis_commitment: state.genesisCommitment,
  });
  return draft;
}

export function rebuildCandidateState(blocks, { nowMs = Date.now(), profile = null, binding = null } = {}) {
  if (!Array.isArray(blocks)) throw new TypeError('blocks must be an array');
  let state = emptyCandidateState({ profile, binding });
  for (const block of blocks) {
    const header = {
      version: 5,
      network: block.network,
      profile_id: block.profile_id,
      genesis_commitment: block.genesis_commitment,
      height: block.height,
      previous_hash: block.previous_hash,
      timestamp_ms: block.timestamp_ms,
      target_hex: block.target_hex,
      subsidy_atoms: block.subsidy_atoms,
      fee_atoms: block.fee_atoms,
      miner_address: block.miner_address,
      coinbase_root: block.coinbase_root,
      coinbase_count: block.coinbase_count,
      tx_root: block.tx_root,
      tx_count: block.tx_count,
    };
    const records = new Map((block.tx_records || []).map(record => [record.txid, record]));
    state = appendCandidateBlock(state, {
      header,
      nonce: block.nonce,
      hash: block.hash,
      txids: block.txids || [],
      coinbaseOutputs: block.coinbase_outputs || [],
    }, { nowMs: Math.max(nowMs, Number(block.timestamp_ms)), feeRecords: records });
  }
  return state;
}

function confirmedTxids(chain) {
  return new Set(chain.flatMap(block => block.txids || []));
}

function replayCandidatesFromOldState(oldState, newChain) {
  const inNew = confirmedTxids(newChain);
  const rows = [];
  for (const block of oldState.chain) {
    for (const record of block.tx_records || []) if (!inNew.has(record.txid)) rows.push(record);
  }
  for (const txid of oldState.mempoolOrder) {
    const record = oldState.transactions[txid];
    if (record && !inNew.has(record.txid)) rows.push(record);
  }
  const seen = new Set();
  return rows.filter(record => record && !seen.has(record.txid) && seen.add(record.txid));
}

export function reorganizeCandidateState(oldState, incomingBlocks, { nowMs = Date.now() } = {}) {
  const binding = stateConsensusBinding(oldState);
  const incoming = rebuildCandidateState(incomingBlocks, { nowMs, binding });
  const oldWork = candidateChainWork(oldState.chain);
  const newWork = candidateChainWork(incoming.chain);
  if (newWork <= oldWork) fail('insufficient_chainwork', { oldWork: oldWork.toString(), newWork: newWork.toString() });

  const resurrected = [];
  const dropped = [];
  for (const record of replayCandidatesFromOldState(oldState, incoming.chain)) {
    const candidate = {
      version: CANDIDATE_TX_VERSION,
      network: record.network,
      profile_id: record.profile_id,
      inputs: record.inputs,
      outputs: record.outputs,
      public_key_spki: record.public_key_spki,
      signature: record.signature,
      txid: record.txid,
      from_address: record.from_address,
      mempool_seq: record.mempool_seq,
      created_at: record.created_at,
    };
    try {
      acceptCandidateTxInto(incoming, candidate, { fromFeed: true, createdAt: record.created_at });
      resurrected.push(record.txid);
    } catch (error) {
      dropped.push({ txid: record.txid, reason: error.code || error.message });
    }
  }
  return { state: incoming, resurrected, dropped, oldWork, newWork };
}

export function candidateStateInvariantReport(state) {
  const binding = stateConsensusBinding(state);
  const issued = issuedSubsidyAtoms(state);
  const coinbaseCount = Object.values(state.utxos).filter(output => output.origin === COINBASE_ORIGIN).length;
  const unknownOrigins = Object.values(state.utxos).filter(output => output.origin !== COINBASE_ORIGIN && output.origin !== TRANSACTION_ORIGIN).length;
  return {
    authority: state.authority,
    network: state.network,
    profileId: state.profileId,
    profileClass: state.profileClass,
    genesisCommitment: state.genesisCommitment,
    initialTargetHex: state.initialTargetHex,
    transactionDomainCommitment: state.transactionDomainCommitment,
    profileBoundCore: true,
    activationProfileReady: state.activationProfileReady === true,
    testOnly: state.testOnly === true,
    height: state.chain.length,
    chainWork: candidateChainWork(state.chain).toString(),
    issuedSubsidyAtoms: issued.toString(),
    theoreticalCapAtoms: ECONOMIC_V2_300.theoreticalCapAtoms.toString(),
    terminalIssuanceAtoms: terminalIssuanceAtoms().toString(),
    underCap: issued <= ECONOMIC_V2_300.theoreticalCapAtoms,
    coinbaseUtxoCount: coinbaseCount,
    unknownUtxoOrigins: unknownOrigins,
    targetSeconds: DAA_V2_300.targetSeconds,
    coinbaseMaturityBlocks: ECONOMIC_V2_300.coinbaseMaturityBlocks,
    bindingValid: binding.profileId === state.profileId,
    activationAuthorized: false,
    publicConsensusChanged: false,
  };
}
