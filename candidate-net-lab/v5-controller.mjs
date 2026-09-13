#!/usr/bin/env node
import http from 'node:http';
import { generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { stableStringify } from '../sovereign-forge/node/authoritative/canonical.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
  LIVE_V4_NETWORK_ID,
  candidateTxDomain,
} from '../sovereign-forge/node/candidate/network-boundary-v2-300.mjs';
import {
  CANDIDATE_TX_VERSION,
  deriveCandidateAddress,
} from '../sovereign-forge/node/candidate/fae-v5-300-core.mjs';

const PORT = Number(process.env.PORT || 3199);
const TOKEN = process.env.FAE_L3_TOKEN || 'local-l3-token';
const NODES = [
  { id: 'A', region: 'oregon', url: String(process.env.FAE_NODE_A || 'http://127.0.0.1:3191').replace(/\/$/, '') },
  { id: 'B', region: 'frankfurt', url: String(process.env.FAE_NODE_B || 'http://127.0.0.1:3192').replace(/\/$/, '') },
  { id: 'C', region: 'singapore', url: String(process.env.FAE_NODE_C || 'http://127.0.0.1:3193').replace(/\/$/, '') },
];
const STEP_MS = 300_000;
const PROFILE = 'l3-easy-pow-limit-non-activating';

let runState = {
  ok: true,
  status: 'STARTING',
  authority: 'candidate-not-active-consensus',
  activationAuthorized: false,
  publicConsensusChanged: false,
  network: CANDIDATE_NETWORK_ID,
  genesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
  profile: PROFILE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  phases: [],
  result: null,
  error: null,
};

function headers() {
  return { 'content-type': 'application/json', 'x-fae-l3-token': TOKEN };
}
function recordPhase(name, data = {}) {
  const row = { name, at: new Date().toISOString(), ...data };
  runState.phases.push(row);
  console.log(JSON.stringify({ event: 'FAE_V5_L3_PHASE', ...row }));
}
async function requestJson(url, { method = 'GET', body = undefined, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: method === 'GET' ? undefined : headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}
async function must(url, options = {}) {
  const response = await requestJson(url, options);
  if (!response.ok) throw new Error(`${url}:${response.status}:${response.payload.error || 'request_failed'}`);
  return response.payload;
}
async function post(node, path, body = {}) {
  return must(`${node.url}${path}`, { method: 'POST', body, timeoutMs: 120_000 });
}
async function get(node, path) {
  return must(`${node.url}${path}`, { timeoutMs: 30_000 });
}
async function expectError(node, path, body, { status, error }) {
  const response = await requestJson(`${node.url}${path}`, { method: 'POST', body, timeoutMs: 30_000 });
  if (response.status !== status || response.payload.error !== error) {
    throw new Error(`expected_${status}_${error}:${node.id}:${response.status}:${response.payload.error || 'none'}`);
  }
  return response.payload;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
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
    inputs: inputs.map(String),
    outputs: outputs.map(output => ({ address: output.address, amount_atoms: String(output.amount_atoms) })),
    public_key_spki: owner.publicKeySpki,
  };
  const signature = signPayload(null, Buffer.from(stableStringify(candidateTxDomain(unsigned))), owner.privateKey).toString('base64');
  return { ...unsigned, signature };
}
async function statuses() {
  return Promise.all(NODES.map(async node => ({ node, status: await get(node, '/status') })));
}
async function syncAllNodes() {
  for (const node of NODES) await post(node, '/control/sync', {});
}
async function waitFor(predicate, label, timeoutMs = 90_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await statuses();
    if (predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${label}_timeout:${JSON.stringify(last?.map(row => ({ id: row.node.id, h: row.status.height, mempool: row.status.mempoolCount, tip: row.status.tipHash })) || [])}`);
}
async function convergeHeight(height) {
  await syncAllNodes();
  return waitFor(rows => rows.every(row => row.status.height === height && row.status.tipHash === rows[0].status.tipHash), `height_${height}_convergence`, 120_000);
}
async function setPeers(mapping) {
  for (const node of NODES) await post(node, '/control/peers', { peers: mapping[node.id] || [] });
}
async function fullMesh() {
  const mapping = {};
  for (const node of NODES) mapping[node.id] = NODES.filter(other => other.id !== node.id).map(other => other.url);
  await setPeers(mapping);
}
async function mine(node, minerAddress, timestampMs, txids = undefined) {
  const body = { minerAddress, timestampMs };
  if (txids !== undefined) body.txids = txids;
  return post(node, '/control/mine', body);
}
async function submitTxAllowDuplicate(node, tx) {
  const response = await requestJson(`${node.url}/tx`, { method: 'POST', body: { tx }, timeoutMs: 30_000 });
  if (response.ok) return response.payload;
  if (response.status === 409 && response.payload.error === 'duplicate_txid') return response.payload;
  throw new Error(`tx_submit_failed:${node.id}:${response.status}:${response.payload.error || 'unknown'}`);
}

async function run() {
  runState.status = 'RUNNING';
  const miner = wallet();
  const receiver = wallet();
  const baselineNode = NODES[0];
  const branchNode = NODES[2];
  const baseTimestamp = Date.now() - 210 * STEP_MS;

  recordPhase('identity-and-clean-genesis');
  for (const node of NODES) await post(node, '/control/reset', {});
  await fullMesh();
  let rows = await statuses();
  for (const row of rows) {
    assert(row.status.network === CANDIDATE_NETWORK_ID, `network_mismatch_${row.node.id}`);
    assert(row.status.genesisCommitment === CANDIDATE_GENESIS_COMMITMENT, `genesis_mismatch_${row.node.id}`);
    assert(row.status.height === 0, `nonzero_genesis_height_${row.node.id}`);
    assert(row.status.activationAuthorized === false, `activation_leak_${row.node.id}`);
    assert(row.status.publicConsensusChanged === false, `v4_change_leak_${row.node.id}`);
  }

  recordPhase('distributed-chain-build-to-199');
  const first = await mine(baselineNode, miner.address, baseTimestamp);
  const firstBlockHash = first.block.hash;
  const firstCoinbase = `${firstBlockHash}:0`;
  await convergeHeight(1);
  for (let height = 2; height <= 199; height++) {
    await mine(baselineNode, miner.address, baseTimestamp + (height - 1) * STEP_MS);
    if (height % 20 === 0) await convergeHeight(height);
  }
  await convergeHeight(199);

  const spend = signedTx(miner, [firstCoinbase], [
    { address: receiver.address, amount_atoms: '1300000000' },
  ]);

  recordPhase('distributed-coinbase-maturity-boundary');
  for (const node of NODES) {
    const rejected = await expectError(node, '/tx', { tx: spend }, { status: 422, error: 'immature_coinbase' });
    assert(rejected.remainingBlocks === 1, `maturity_remaining_mismatch_${node.id}`);
    assert(rejected.maturesAtHeight === 201, `maturity_height_mismatch_${node.id}`);
  }

  await mine(baselineNode, miner.address, baseTimestamp + 199 * STEP_MS);
  await convergeHeight(200);
  const accepted = await submitTxAllowDuplicate(baselineNode, spend);
  const txid = accepted.record?.txid;
  assert(Boolean(txid), 'accepted_txid_missing');
  for (const node of NODES.slice(1)) await submitTxAllowDuplicate(node, spend);
  await waitFor(statusRows => statusRows.every(row => row.status.mempoolCount === 1), 'mempool_distribution');

  recordPhase('distributed-confirmation-at-height-201');
  await mine(baselineNode, miner.address, baseTimestamp + 200 * STEP_MS);
  await convergeHeight(201);
  for (const node of NODES) {
    const tx = await get(node, `/transaction?txid=${encodeURIComponent(txid)}`);
    assert(tx.transaction.status === 'confirmed' && tx.transaction.confirmed_height === 201, `tx_not_confirmed_201_${node.id}`);
  }

  recordPhase('isolated-alternative-branch');
  const snapshot201 = await get(baselineNode, '/snapshot');
  const prefix150 = snapshot201.blocks.slice(0, 150);
  await setPeers({ A: [NODES[1].url], B: [NODES[0].url], C: [] });
  await post(branchNode, '/control/load-chain', { blocks: prefix150, nowMs: baseTimestamp + 149 * STEP_MS });
  for (let height = 151; height <= 202; height++) {
    await mine(branchNode, receiver.address, baseTimestamp + (height - 1) * STEP_MS);
  }
  const isolatedStatus = await get(branchNode, '/status');
  assert(isolatedStatus.height === 202, 'alternative_branch_height_mismatch');
  assert(isolatedStatus.mempoolCount === 0, 'alternative_branch_should_not_have_detached_tx');

  recordPhase('chainwork-reconciliation-and-resurrection');
  await fullMesh();
  await post(NODES[0], '/control/sync', {});
  await post(NODES[1], '/control/sync', {});
  await post(NODES[2], '/control/sync', {});
  rows = await convergeHeight(202);
  for (const row of rows.slice(0, 2)) {
    assert(row.status.counters.reorgs >= 1, `expected_reorg_missing_${row.node.id}`);
    assert(row.status.counters.resurrected >= 1, `expected_resurrection_missing_${row.node.id}`);
  }
  for (const node of NODES) await submitTxAllowDuplicate(node, spend);
  await waitFor(statusRows => statusRows.every(row => row.status.mempoolCount === 1), 'resurrected_mempool_distribution');

  recordPhase('reconfirmation-on-winning-branch');
  await mine(branchNode, receiver.address, baseTimestamp + 202 * STEP_MS);
  rows = await convergeHeight(203);
  for (const node of NODES) {
    const tx = await get(node, `/transaction?txid=${encodeURIComponent(txid)}`);
    assert(tx.transaction.status === 'confirmed' && tx.transaction.confirmed_height === 203, `tx_not_reconfirmed_203_${node.id}`);
  }

  recordPhase('v4-v5-isolation-probe');
  await expectError(NODES[0], '/block', {
    envelope: {
      header: { network: LIVE_V4_NETWORK_ID, genesis_commitment: CANDIDATE_GENESIS_COMMITMENT },
      nonce: 0,
      hash: '0'.repeat(64),
      txids: [],
      coinbaseOutputs: [],
    },
  }, { status: 422, error: 'wrong_network_or_genesis' });

  const finalRows = await statuses();
  const final = finalRows.map(row => ({
    nodeId: row.node.id,
    region: row.node.region,
    height: row.status.height,
    tipHash: row.status.tipHash,
    chainWork: row.status.chainWork,
    issuedSubsidyAtoms: row.status.issuedSubsidyAtoms,
    mempoolCount: row.status.mempoolCount,
    reorgs: row.status.counters.reorgs,
    resurrected: row.status.counters.resurrected,
    rejected: row.status.counters.rejected,
    activationAuthorized: row.status.activationAuthorized,
    publicConsensusChanged: row.status.publicConsensusChanged,
  }));
  assert(final.every(row => row.height === 203 && row.tipHash === final[0].tipHash), 'final_tip_divergence');
  assert(final.every(row => row.activationAuthorized === false && row.publicConsensusChanged === false), 'activation_boundary_failed');

  runState.status = 'COMPLETE';
  runState.finishedAt = new Date().toISOString();
  runState.result = {
    verdict: 'PASS_L3_MULTI_NODE_TEST_PROFILE',
    selectionAuthorized: false,
    activationAuthorized: false,
    publicConsensusChanged: false,
    profile: PROFILE,
    nodeCount: NODES.length,
    regionCount: new Set(NODES.map(node => node.region)).size,
    firstCoinbase,
    maturitySpendTxid: txid,
    maturityFirstSpendHeight: 201,
    reorgWinningHeight: 202,
    reconfirmedHeight: 203,
    nodes: final,
    remainingActivationBlockers: [
      'freeze_initial_target_and_daa_anchor_from_launch_hashrate_evidence',
      'complete_focused_l3_review_of_integrated_multi_node_candidate',
    ],
  };
  console.log(JSON.stringify({ event: 'FAE_V5_L3_COMPLETE', ...runState.result }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/status' || url.pathname === '/result') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(runState));
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listen', lab: 'FAE_V5_300_MULTI_NODE_L3_CONTROLLER', port: PORT, nodes: NODES.map(({ id, region, url }) => ({ id, region, url })) }));
  setTimeout(() => {
    run().catch(error => {
      runState.ok = false;
      runState.status = 'FAILED';
      runState.finishedAt = new Date().toISOString();
      runState.error = error.message || String(error);
      console.error(JSON.stringify({ event: 'FAE_V5_L3_FAILED', error: runState.error }));
    });
  }, 250);
});