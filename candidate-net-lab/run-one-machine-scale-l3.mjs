#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { encodeAddress } from '../sovereign-forge/node/authoritative/address.mjs';

const ROOT = new URL('../', import.meta.url);
const TOKEN = 'local-l3-scale-token';
const NODE_COUNT = 16;
const BASE_PORT = 3290;
const STEP_MS = 300_000;
const BASE_TIME = 1_950_000_000_000;
const nodes = Array.from({ length: NODE_COUNT }, (_, index) => ({
  id: `S${String(index).padStart(2, '0')}`,
  port: BASE_PORT + index,
  url: `http://127.0.0.1:${BASE_PORT + index}`,
  process: null,
}));
const minerA = encodeAddress(Buffer.alloc(20, 1), 'faet');
const minerB = encodeAddress(Buffer.alloc(20, 2), 'faet');
const children = new Set();

function startNode(node) {
  const child = spawn(process.execPath, ['candidate-net-lab/v5-node.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(node.port),
      FAE_L3_TOKEN: TOKEN,
      FAE_NODE_ID: node.id,
      FAE_REGION: 'single-host-scale',
      FAE_PUBLIC_URL: node.url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  node.process = child;
  children.add(child);
  child.stdout.on('data', chunk => process.stdout.write(`[${node.id}] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[${node.id}] ${chunk}`));
  child.on('exit', () => children.delete(child));
  return child;
}

function stopNode(node) {
  if (node.process && !node.process.killed) node.process.kill('SIGTERM');
  node.process = null;
}

function stopAll() {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
}
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });

async function request(url, { method = 'GET', body = undefined, timeoutMs = 20_000 } = {}) {
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
    if (!response.ok) throw new Error(`${response.status}:${payload.error || 'request_failed'}:${url}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function waitReady(node, timeoutMs = 30_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try { return await request(`${node.url}/status`, { timeoutMs: 2_000 }); }
    catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  throw new Error(`node_not_ready:${node.id}:${last?.message || 'unknown'}`);
}

async function post(node, path, body = {}) {
  return request(`${node.url}${path}`, { method: 'POST', body, timeoutMs: 60_000 });
}

async function status(node) {
  return request(`${node.url}/status`, { timeoutMs: 10_000 });
}

function topologyFor(indices) {
  const ids = [...indices];
  const map = new Map();
  for (let p = 0; p < ids.length; p++) {
    const current = ids[p];
    const neighbors = new Set();
    for (const offset of [1, -1, 3, -3]) {
      if (ids.length > 1) neighbors.add(ids[(p + offset + ids.length) % ids.length]);
    }
    neighbors.delete(current);
    map.set(current, [...neighbors].map(index => nodes[index].url));
  }
  return map;
}

async function setTopology(groups) {
  for (const group of groups) {
    const mapping = topologyFor(group);
    for (const index of group) await post(nodes[index], '/control/peers', { peers: mapping.get(index) || [] });
  }
}

async function reset(indices = nodes.map((_, i) => i)) {
  for (const index of indices) await post(nodes[index], '/control/reset', {});
}

async function syncRounds(indices, rounds = 4) {
  for (let round = 0; round < rounds; round++) {
    for (const index of indices) await post(nodes[index], '/control/sync', {});
  }
}

async function statuses(indices = nodes.map((_, i) => i)) {
  return Promise.all(indices.map(async index => ({ index, ...(await status(nodes[index])) })));
}

async function assertConverged(indices, height) {
  const rows = await statuses(indices);
  const tips = new Set(rows.map(row => row.tipHash));
  if (rows.some(row => row.height !== height) || tips.size !== 1) {
    throw new Error(`not_converged_h${height}:${JSON.stringify(rows.map(row => ({ id: row.nodeId, h: row.height, tip: row.tipHash })))}`);
  }
  return rows[0].tipHash;
}

async function mine(nodeIndex, height, minerAddress) {
  return post(nodes[nodeIndex], '/control/mine', {
    minerAddress,
    timestampMs: BASE_TIME + (height - 1) * STEP_MS,
  });
}

async function buildOnLeader(group, leader, fromHeightExclusive, toHeightInclusive, minerAddress) {
  for (let height = fromHeightExclusive + 1; height <= toHeightInclusive; height++) {
    await mine(leader, height, minerAddress);
  }
  await syncRounds(group, 3);
  return assertConverged(group, toHeightInclusive);
}

const all = nodes.map((_, i) => i);
const left = all.slice(0, 8);
const right = all.slice(8);
const shards = [all.slice(0, 4), all.slice(4, 8), all.slice(8, 12), all.slice(12, 16)];

try {
  for (const node of nodes) startNode(node);
  for (const node of nodes) await waitReady(node);
  await reset();
  await setTopology([all]);

  const baseTip = await buildOnLeader(all, 0, 0, 12, minerA);

  await setTopology([left, right]);
  const leftTip13 = await buildOnLeader(left, 0, 12, 13, minerA);
  const rightTip13 = await buildOnLeader(right, 8, 12, 13, minerB);
  if (leftTip13 === rightTip13) throw new Error('equal_work_fork_not_created');

  await setTopology([all]);
  await syncRounds(all, 3);
  const equalRows = await statuses();
  const equalTips = new Set(equalRows.map(row => row.tipHash));
  if (equalTips.size < 2 || equalRows.some(row => row.height !== 13)) throw new Error('equal_work_policy_did_not_preserve_local_tips');

  await mine(8, 14, minerB);
  await syncRounds(all, 6);
  const winningTip14 = await assertConverged(all, 14);
  const reorgAfterTie = (await statuses()).filter(row => row.counters.reorgs > 0).length;
  if (reorgAfterTie < 1) throw new Error('higher_work_reconciliation_missing');

  await setTopology(shards);
  const shardTips = [];
  for (let shard = 0; shard < shards.length; shard++) {
    const group = shards[shard];
    const targetHeight = 15 + shard;
    shardTips.push(await buildOnLeader(group, group[0], 14, targetHeight, shard % 2 ? minerB : minerA));
  }
  if (new Set(shardTips).size !== 4) throw new Error('four_way_partition_not_created');

  stopNode(nodes[15]);
  await new Promise(resolve => setTimeout(resolve, 300));
  const active = all.slice(0, 15);
  await setTopology([active]);
  await syncRounds(active, 8);
  const winningTip18 = await assertConverged(active, 18);

  startNode(nodes[15]);
  await waitReady(nodes[15]);
  await post(nodes[15], '/control/peers', { peers: [nodes[0].url, nodes[7].url, nodes[14].url] });
  await post(nodes[15], '/control/sync', {});
  await setTopology([all]);
  await syncRounds(all, 5);
  const finalTip = await assertConverged(all, 18);
  if (finalTip !== winningTip18) throw new Error('restart_tip_mismatch');

  const finalRows = await statuses();
  if (finalRows.some(row => row.activationAuthorized !== false || row.publicConsensusChanged !== false)) throw new Error('activation_boundary_failed');

  const result = {
    verdict: 'PASS_ONE_MACHINE_SCALE_16_PROCESS',
    authority: 'candidate-not-active-consensus',
    nodeCount: NODE_COUNT,
    processIsolation: true,
    singleHost: true,
    independentOperatorEvidence: false,
    geographicWanEvidence: false,
    scaleSemanticsEvidence: true,
    sparsePeerTopology: true,
    equalWorkLocalTipPolicy: true,
    higherWorkConvergence: true,
    fourWayPartitionReconciliation: true,
    crashRestartCatchup: true,
    baseTip,
    winningTip14,
    finalTip,
    nodesWithObservedReorgs: finalRows.filter(row => row.counters.reorgs > 0).length,
    activationAuthorized: false,
    publicConsensusChanged: false,
  };
  console.log(JSON.stringify({ event: 'FAE_V5_ONE_MACHINE_SCALE_COMPLETE', result }));
} finally {
  stopAll();
}
