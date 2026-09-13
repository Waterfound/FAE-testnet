#!/usr/bin/env node
import { spawn } from 'node:child_process';

const ROOT = new URL('../', import.meta.url);
const TOKEN = 'local-l3-token';
const nodes = [
  { id: 'A', region: 'oregon', port: 3191 },
  { id: 'B', region: 'frankfurt', port: 3192 },
  { id: 'C', region: 'singapore', port: 3193 },
];
const controllerPort = 3199;
const children = [];

function start(script, env = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', chunk => process.stdout.write(`[${env.FAE_NODE_ID || 'controller'}] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[${env.FAE_NODE_ID || 'controller'}] ${chunk}`));
  return child;
}

async function json(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${response.status}:${payload.error || response.statusText}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function waitReady(url, label, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try { return await json(url); }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  throw new Error(`${label}_not_ready:${lastError?.message || 'unknown'}`);
}

function stopAll() {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
}
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });

try {
  for (const node of nodes) {
    const url = `http://127.0.0.1:${node.port}`;
    start('candidate-net-lab/v5-node.mjs', {
      PORT: String(node.port),
      FAE_L3_TOKEN: TOKEN,
      FAE_NODE_ID: node.id,
      FAE_REGION: node.region,
      FAE_PUBLIC_URL: url,
    });
  }
  for (const node of nodes) await waitReady(`http://127.0.0.1:${node.port}/status`, `node_${node.id}`);

  start('candidate-net-lab/v5-controller.mjs', {
    PORT: String(controllerPort),
    FAE_L3_TOKEN: TOKEN,
    FAE_NODE_A: 'http://127.0.0.1:3191',
    FAE_NODE_B: 'http://127.0.0.1:3192',
    FAE_NODE_C: 'http://127.0.0.1:3193',
  });
  await waitReady(`http://127.0.0.1:${controllerPort}/status`, 'controller');

  const started = Date.now();
  let result = null;
  while (Date.now() - started < 180_000) {
    result = await json(`http://127.0.0.1:${controllerPort}/result`, 10_000);
    if (result.status === 'COMPLETE') break;
    if (result.status === 'FAILED') throw new Error(`controller_failed:${result.error}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!result || result.status !== 'COMPLETE') throw new Error(`controller_timeout:${JSON.stringify(result)}`);
  if (result.result?.verdict !== 'PASS_L3_MULTI_NODE_TEST_PROFILE') throw new Error(`unexpected_verdict:${result.result?.verdict}`);
  if (result.result.activationAuthorized !== false || result.result.publicConsensusChanged !== false) throw new Error('activation_boundary_failed');
  if (result.result.nodeCount !== 3 || result.result.regionCount !== 3) throw new Error('multi_node_shape_failed');
  console.log(JSON.stringify({ event: 'FAE_V5_L3_LOCAL_HARNESS_PASS', result: result.result }));
} finally {
  stopAll();
}
