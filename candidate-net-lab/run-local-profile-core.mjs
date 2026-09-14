#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { encodeAddress } from '../sovereign-forge/node/authoritative/address.mjs';
import { DEFAULT_CANDIDATE_BINDING } from '../sovereign-forge/node/candidate/fae-v5-300-core.mjs';

const ROOT = new URL('../', import.meta.url);
const TOKEN = 'local-profile-core-token';
const STEP_MS = 300_000;
const BASE_TIME = Date.now() - 20 * STEP_MS;
const nodes = [
  { id: 'P0', port: 3390, url: 'http://127.0.0.1:3390' },
  { id: 'P1', port: 3391, url: 'http://127.0.0.1:3391' },
  { id: 'P2', port: 3392, url: 'http://127.0.0.1:3392' },
];
const minerA = encodeAddress(Buffer.alloc(20, 11), 'faet');
const minerB = encodeAddress(Buffer.alloc(20, 12), 'faet');
const children = [];

function start(node) {
  const child = spawn(process.execPath, ['candidate-net-lab/v5-node.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(node.port),
      FAE_L3_TOKEN: TOKEN,
      FAE_NODE_ID: node.id,
      FAE_REGION: 'local-profile-core',
      FAE_PUBLIC_URL: node.url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', chunk => process.stdout.write(`[${node.id}] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[${node.id}] ${chunk}`));
}

function stopAll() {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
}

async function request(url, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json', 'x-fae-l3-token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function must(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) throw new Error(`${response.status}:${response.payload.error || 'request_failed'}:${url}`);
  return response.payload;
}

async function post(node, path, body = {}) {
  return must(`${node.url}${path}`, { method: 'POST', body, timeoutMs: 60_000 });
}

async function status(node) {
  return must(`${node.url}/status`, { timeoutMs: 10_000 });
}

async function waitReady(node, timeoutMs = 30_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try { return await status(node); }
    catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  throw new Error(`node_not_ready:${node.id}:${last?.message || 'unknown'}`);
}

async function setPeers(mapping) {
  for (const node of nodes) await post(node, '/control/peers', { peers: mapping[node.id] || [] });
}

async function sync(node) {
  return post(node, '/control/sync', {});
}

async function mine(node, minerAddress, height) {
  return post(node, '/control/mine', {
    minerAddress,
    timestampMs: BASE_TIME + (height - 1) * STEP_MS,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const node of nodes) start(node);
  for (const node of nodes) await waitReady(node);
  for (const node of nodes) await post(node, '/control/reset', {});
  await setPeers({ P0: [], P1: [], P2: [] });

  const initial = await Promise.all(nodes.map(status));
  for (const row of initial) {
    assert(row.profileBoundCore === true, 'profile_bound_core_missing');
    assert(row.profileId === DEFAULT_CANDIDATE_BINDING.profileId, 'profile_id_mismatch');
    assert(row.genesisCommitment === DEFAULT_CANDIDATE_BINDING.genesisCommitment, 'genesis_mismatch');
    assert(row.initialTargetHex === DEFAULT_CANDIDATE_BINDING.initialTargetHex, 'initial_target_mismatch');
    assert(row.activationAuthorized === false && row.publicConsensusChanged === false, 'activation_boundary_failed');
  }

  const first = await mine(nodes[0], minerA, 1);
  assert(first.block.header.profile_id === DEFAULT_CANDIDATE_BINDING.profileId, 'first_block_profile_missing');
  assert(first.block.header.genesis_commitment === DEFAULT_CANDIDATE_BINDING.genesisCommitment, 'first_block_genesis_mismatch');
  assert(first.block.header.target_hex === DEFAULT_CANDIDATE_BINDING.initialTargetHex, 'first_block_target_not_profile_derived');

  const altered = structuredClone(first.block);
  altered.header.profile_id = 'different-profile';
  const rejected = await request(`${nodes[2].url}/block`, { method: 'POST', body: { envelope: altered } });
  assert(rejected.status === 422 && rejected.payload.error === 'wrong_profile', 'profile_mismatch_not_rejected');

  await setPeers({ P0: [nodes[1].url, nodes[2].url], P1: [nodes[0].url], P2: [nodes[0].url] });
  await sync(nodes[1]);
  await sync(nodes[2]);
  let rows = await Promise.all(nodes.map(status));
  assert(rows.every(row => row.height === 1 && row.tipHash === rows[0].tipHash), 'height1_convergence_failed');

  await setPeers({ P0: [], P1: [], P2: [] });
  await mine(nodes[0], minerA, 2);
  await mine(nodes[1], minerB, 2);
  const tie0 = await status(nodes[0]);
  const tie1 = await status(nodes[1]);
  assert(tie0.height === 2 && tie1.height === 2 && tie0.tipHash !== tie1.tipHash, 'equal_work_fork_missing');

  await setPeers({ P0: [nodes[1].url], P1: [nodes[0].url], P2: [nodes[0].url, nodes[1].url] });
  await sync(nodes[0]);
  await sync(nodes[1]);
  const afterTie0 = await status(nodes[0]);
  const afterTie1 = await status(nodes[1]);
  assert(afterTie0.tipHash !== afterTie1.tipHash, 'equal_work_local_tip_policy_changed');

  await mine(nodes[1], minerB, 3);
  await sync(nodes[0]);
  await sync(nodes[2]);
  rows = await Promise.all(nodes.map(status));
  assert(rows.every(row => row.height === 3 && row.tipHash === rows[0].tipHash), 'higher_work_convergence_failed');
  assert(rows.every(row => row.profileBoundCore === true), 'profile_bound_core_lost');
  assert(rows.every(row => row.activationAuthorized === false && row.publicConsensusChanged === false), 'activation_boundary_failed_final');

  console.log(JSON.stringify({
    event: 'FAE_V5_LOCAL_PROFILE_CORE_COMPLETE',
    verdict: 'PASS_LOCAL_3_PROCESS_PROFILE_BOUND_CORE',
    nodeCount: 3,
    profileId: DEFAULT_CANDIDATE_BINDING.profileId,
    genesisCommitment: DEFAULT_CANDIDATE_BINDING.genesisCommitment,
    initialTargetHex: DEFAULT_CANDIDATE_BINDING.initialTargetHex,
    transactionDomainCommitment: DEFAULT_CANDIDATE_BINDING.transactionDomainCommitment,
    profileMismatchRejected: true,
    equalWorkLocalTipPolicy: true,
    higherWorkConvergence: true,
    activationAuthorized: false,
    publicConsensusChanged: false,
  }));
} finally {
  stopAll();
}
