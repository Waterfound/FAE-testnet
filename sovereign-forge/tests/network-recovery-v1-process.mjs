import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureChain, fixtureWallet, fixtureTx, STEP_MS } from './network-recovery-v1-fixtures.mjs';
import { rebuildCandidateState } from '../node/candidate/fae-v5-300-core.mjs';

const entrypoint = new URL('../../candidate-net-lab/v5-node.mjs', import.meta.url);
const TOKEN = 'network-recovery-local-fixture';

async function request(node, path, body) {
  const response = await fetch(`${node.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-fae-l3-token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json();
  assert.equal(response.ok, true, `${path}: ${JSON.stringify(value)}`);
  return value;
}

async function start(node) {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [entrypoint.pathname], {
    env: {
      PATH: process.env.PATH, PORT: String(port), FAE_HOST: '127.0.0.1',
      FAE_NODE_ID: node.id, FAE_L3_TOKEN: TOKEN, FAE_PEERS: '',
      FAE_L3_STATE_FILE: node.stateFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  node.child = child;
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-20_000); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20_000); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `node ${node.id} exited: ${stderr}`);
    for (const line of stdout.split('\n')) {
      try {
        const row = JSON.parse(line);
        if (row.event === 'listen' && row.port > 0) {
          node.url = `http://127.0.0.1:${row.port}`;
          await request(node, '/status');
          return;
        }
      } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
    }
    await delay(20);
  }
  throw new Error(`node ${node.id} failed to start: ${stderr} ${stdout}`);
}

async function stop(node) {
  if (!node.child || node.child.exitCode !== null || node.child.signalCode !== null) return;
  const exited = once(node.child, 'exit');
  assert.equal(node.child.kill('SIGKILL'), true);
  const result = await Promise.race([exited, delay(5_000, null, { ref: false })]);
  assert.ok(result, `node ${node.id} failed to stop`);
  assert.equal(result[1], 'SIGKILL');
}

test('three processes preserve pending dependencies across crash, reorg, repropagation and reconfirmation', { timeout: 90_000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'fae-recovery-v1-'));
  const nodes = ['A', 'B', 'C'].map(id => ({ id, stateFile: join(directory, `${id}.json`) }));
  context.after(async () => {
    await Promise.all(nodes.map(stop));
    await rm(directory, { recursive: true, force: true });
  });
  const [a, b, c] = nodes;
  const baseTime = Date.now() - 220 * STEP_MS;
  const { state, miner } = fixtureChain({ baseTime });
  const receiver = fixtureWallet(72), recipient = fixtureWallet(73), otherMiner = fixtureWallet(74);
  for (const node of nodes) {
    await start(node);
    await request(node, '/control/load-chain', { blocks: state.chain });
  }
  const parent = fixtureTx(miner, [`${state.chain[0].hash}:0`], [{ address: receiver.address, amount_atoms: '1300000000' }]);
  const acceptedParent = await request(a, '/tx', { tx: parent });
  const parentId = acceptedParent.record.txid;
  const child = fixtureTx(receiver, [`${parentId}:0`], [{ address: recipient.address, amount_atoms: '1200000000' }]);
  const childId = (await request(a, '/tx', { tx: child })).record.txid;
  const mined = await request(a, '/control/mine', {
    minerAddress: miner.address, timestampMs: baseTime + 200 * STEP_MS, txids: [parentId],
  });

  await stop(a);
  await start(a);
  const restarted = await request(a, '/status');
  assert.equal(restarted.height, 201, 'acknowledged chain must survive restart without any peer');
  assert.equal(restarted.tipHash, mined.block.hash);
  assert.deepEqual((await request(a, '/mempool')).txids, [childId]);
  assert.equal((await request(a, `/transaction?txid=${parentId}`)).transaction.status, 'confirmed');

  for (const height of [201, 202]) await request(b, '/control/mine', {
    minerAddress: otherMiner.address, timestampMs: baseTime + (height - 1) * STEP_MS,
  });
  await request(a, '/control/peers', { peers: [b.url] });
  const synced = await request(a, '/control/sync', {});
  assert.equal(synced.results[0].adopted, true);
  assert.deepEqual(synced.results[0].resurrected, [parentId, childId]);
  assert.deepEqual((await request(b, '/mempool')).txids, [parentId, childId], 'recovered parent must reach source peer before child');

  // Reproduce a peer with the winning chain but no recovered pending records.
  // A restart must be able to retry relay even though no further reorg is needed.
  await request(b, '/control/load-chain', { blocks: (await request(b, '/snapshot')).blocks });
  assert.deepEqual((await request(b, '/mempool')).txids, []);

  await stop(a);
  await start(a);
  const recovered = await request(a, '/status');
  assert.equal(recovered.height, 202);
  assert.equal(recovered.tipHash, (await request(b, '/status')).tipHash);
  assert.deepEqual((await request(a, '/mempool')).txids, [parentId, childId]);
  assert.equal(recovered.activationAuthorized, false);
  assert.equal(recovered.publicConsensusChanged, false);
  await request(a, '/control/peers', { peers: [b.url] });
  const retry = await request(a, '/control/sync', {});
  assert.equal(retry.results[0].adopted, false);
  assert.equal(retry.results[0].repropagated, 2);
  assert.deepEqual((await request(b, '/mempool')).txids, [parentId, childId]);

  const reconfirmed = await request(b, '/control/mine', {
    minerAddress: otherMiner.address, timestampMs: baseTime + 202 * STEP_MS,
  });
  assert.deepEqual(reconfirmed.block.txids, [parentId, childId]);
  for (const node of [a, c]) {
    await request(node, '/control/peers', { peers: [b.url] });
    await request(node, '/control/sync', {});
  }
  const snapshots = await Promise.all(nodes.map(node => request(node, '/snapshot')));
  const rebuilt = snapshots.map(snapshot => rebuildCandidateState(snapshot.blocks));
  for (const stateAfter of rebuilt) {
    assert.equal(stateAfter.chain.length, 203);
    assert.equal(stateAfter.chain.at(-1).hash, reconfirmed.block.hash);
    assert.deepEqual(stateAfter.utxos, rebuilt[0].utxos);
    assert.equal(stateAfter.transactions[parentId].confirmed_height, 203);
    assert.equal(stateAfter.transactions[childId].confirmed_height, 203);
  }
  for (const node of nodes) assert.deepEqual((await request(node, '/mempool')).txids, []);
  // Exercise persistence of the final confirmation too, with no peers configured on restart.
  await stop(c);
  await start(c);
  assert.equal((await request(c, '/status')).tipHash, reconfirmed.block.hash);
  assert.equal((await request(c, `/transaction?txid=${childId}`)).transaction.confirmed_height, 203);
  context.diagnostic('N1 local: 3 processes, 3 SIGKILL restarts, 2-block replacement, parent/child recovery and identical reconstructed UTXOs.');
});

test('a failed disk write is not acknowledged or published, and a later retry succeeds', { timeout: 30_000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'fae-recovery-write-'));
  const storageDir = join(directory, 'store');
  await mkdir(storageDir);
  const node = { id: 'write-failure', stateFile: join(storageDir, 'state.json') };
  context.after(async () => { await stop(node); await rm(directory, { recursive: true, force: true }); });
  await start(node);
  const timestampMs = Date.now() - 5 * STEP_MS;
  const miner = fixtureWallet(71);
  await request(node, '/control/mine', { minerAddress: miner.address, timestampMs });
  const before = await request(node, '/status');
  await rename(storageDir, `${storageDir}-saved`);
  await writeFile(storageDir, 'fixture: storage parent is unavailable');
  const failure = await fetch(`${node.url}/control/mine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fae-l3-token': TOKEN },
    body: JSON.stringify({ minerAddress: miner.address, timestampMs: timestampMs + STEP_MS }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(failure.ok, false);
  await failure.json();
  const after = await request(node, '/status');
  assert.equal(after.height, 1);
  assert.equal(after.tipHash, before.tipHash);
  assert.equal(after.counters.acceptedBlocks, before.counters.acceptedBlocks);
  assert.equal(after.recovery.generation, before.recovery.generation);
  await rm(storageDir);
  await rename(`${storageDir}-saved`, storageDir);
  const accepted = await request(node, '/control/mine', { minerAddress: miner.address, timestampMs: timestampMs + STEP_MS });
  assert.equal(accepted.status.height, 2);
  await stop(node);
  await start(node);
  assert.equal((await request(node, '/status')).tipHash, accepted.block.hash);
});
