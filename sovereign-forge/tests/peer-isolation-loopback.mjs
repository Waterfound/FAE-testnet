import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PeerIsolationPolicy} from '../node/lab/peer-isolation-policy.mjs';
import {createPeerIsolationLoopbackAdapter} from '../node/lab/peer-isolation-loopback-adapter.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState, appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

function validatedFixtureState() {
  let state = emptyState();
  for (const block of legacyBlocks) state = appendBlockFromFeed(state, block, new Map(), {activationHeight: null});
  return state;
}

test('PI-02 / PI-07 / PI-10 / PI-11 / PI-12: real local sessions recover while loopback diversity stays DEGRADED', {timeout: 30_000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'fae-peer-isolation-'));
  const nodes = [];
  context.after(async () => {
    await Promise.allSettled(nodes.map(node => node.close()));
    await rm(directory, {recursive: true, force: true});
  });
  const state = validatedFixtureState();
  for (let index = 0; index < 3; index++) {
    const node = createAuthoritativeV4PeerNode({host: '127.0.0.1', port: 0,
      initialState: state, activationHeight: null, identityFile: join(directory, `node-${index}.json`)});
    nodes.push(node); await node.start();
  }
  const sources = nodes.slice(), observer = createAuthoritativeV4PeerNode({activationHeight: null});
  nodes.push(observer); await observer.start();
  const endpoints = sources.map(node => node.baseUrl());
  let now = 1_000_000;
  const policy = new PeerIsolationPolicy({now: () => now, selectionKey: Buffer.alloc(32, 9),
    pinnedIdentityIds: [sources[0].identity.id]});
  sources.forEach(node => policy.configurePeer({endpoint: node.baseUrl(), expectedIdentityId: node.identity.id}));
  const adapter = createPeerIsolationLoopbackAdapter({node: observer, policy, allowedEndpoints: endpoints});
  const phases = [{name: 'configured-without-contact', ...policy.status()}];

  const first = await adapter.round();
  assert.equal(first.length, 3); assert.ok(first.every(row => row.accepted));
  assert.equal(first.filter(row => row.sync.adopted).length, 1);
  assert.equal(observer.status().height, legacyBlocks.length);
  assert.equal(observer.status().tip_hash, legacyBlocks.at(-1).hash);
  assert.equal(policy.status().freshObservations, 3);
  assert.equal(policy.status().selectedTransportGroups, 1);
  assert.equal(policy.status().state, 'DEGRADED');
  phases.push({name: 'verified-local-sync', ...policy.status()});

  const retainedPort = Number(new URL(endpoints[0]).port), retainedIdentity = sources[0].identity.id;
  await sources[0].close();
  now += policy.limits.refreshMs;
  const partial = await adapter.round();
  assert.equal(partial.filter(row => row.accepted).length, 2);
  assert.equal(policy.status().freshObservations, 2);
  assert.equal(policy.status().selectedAnchors, 0);
  assert.ok(policy.status().reasons.includes('missing_local_anchor'));
  assert.equal(observer.authenticatedPeerObservations().length, 3, 'historical node observations are not candidate liveness');
  phases.push({name: 'anchor-unavailable', ...policy.status()});

  await Promise.all(sources.slice(1).map(node => node.close()));
  now += policy.limits.refreshMs;
  const isolated = await adapter.round(); assert.ok(isolated.every(row => !row.accepted));
  assert.equal(policy.status().state, 'ISOLATED');
  assert.equal(observer.status().tip_hash, legacyBlocks.at(-1).hash);
  phases.push({name: 'all-local-sources-unavailable', ...policy.status()});
  assert.deepEqual(await adapter.round(), [], 'immediate retry must stay within cooldown');

  const restarted = createAuthoritativeV4PeerNode({host: '127.0.0.1', port: retainedPort,
    initialState: state, activationHeight: null, identityFile: join(directory, 'node-0.json')});
  nodes.push(restarted); await restarted.start();
  assert.equal(restarted.identity.id, retainedIdentity);
  now += policy.limits.attemptWindowMs;
  const recovered = await adapter.round();
  assert.equal(recovered.filter(row => row.accepted).length, 1);
  assert.equal(policy.status().selectedAnchors, 1);
  assert.equal(policy.status().state, 'DEGRADED');
  assert.equal(observer.status().tip_hash, restarted.status().tip_hash);
  phases.push({name: 'same-identity-reconnection', ...policy.status()});

  const freshObserver = createAuthoritativeV4PeerNode({activationHeight: null});
  nodes.push(freshObserver); await freshObserver.start();
  const coldPolicy = new PeerIsolationPolicy({now: () => now, pinnedIdentityIds: [retainedIdentity]});
  coldPolicy.configurePeer({endpoint: endpoints[0], expectedIdentityId: retainedIdentity});
  assert.equal(coldPolicy.status().state, 'ISOLATED');
  const coldAdapter = createPeerIsolationLoopbackAdapter({node: freshObserver, policy: coldPolicy, allowedEndpoints: [endpoints[0]]});
  const coldSync = await coldAdapter.round(); assert.equal(coldSync[0].accepted, true);
  assert.equal(coldSync[0].sync.adopted, true);
  assert.equal(freshObserver.status().tip_hash, legacyBlocks.at(-1).hash);
  assert.deepEqual(freshObserver.getState(), observer.getState(), 'all validated chain and ledger fields converge');
  for (const node of [observer, freshObserver, restarted]) assert.equal(node.status().discovered_coordinators, 0);
  phases.push({name: 'fresh-observer-bootstrap', ...coldPolicy.status()});
  for (const phase of phases) {
    assert.equal(phase.eclipseResistanceProven, false);
    assert.equal(phase.externalWanProof, false);
    assert.equal(phase.operatorIndependenceProven, false);
    assert.equal(phase.consensusAuthority, false);
  }
  if (process.env.FAE_PEER_ISOLATION_EVIDENCE) {
    await writeFile(process.env.FAE_PEER_ISOLATION_EVIDENCE, JSON.stringify({
      format: 'fae-peer-isolation-loopback-evidence-v1', passed: true,
      scope: 'local-process-and-loopback-only', timeBasis: 'virtual-monotonic-policy-clock',
      realSocketTransport: true, independentHosts: false, independentOperators: false,
      consensusAuthority: false, externalWanProof: false, eclipseResistanceProven: false,
      height: legacyBlocks.length, finalTip: legacyBlocks.at(-1).hash, phases,
    }, null, 2) + '\n');
  }
});

test('PI-06 / PI-10: the local adapter cannot dial a discovery hint outside its fixed allowlist', async () => {
  const policy = new PeerIsolationPolicy();
  let calls = 0;
  const node = {syncPeer: async () => { calls++; throw new Error('unexpected_call'); }};
  for (const endpoint of ['https://example.org', 'http://192.0.2.1:8787', 'http://localhost:8787']) {
    assert.throws(() => createPeerIsolationLoopbackAdapter({node, policy, allowedEndpoints: [endpoint]}), /loopback/);
  }
  policy.configurePeer({endpoint: 'http://127.0.0.1:23456', expectedIdentityId: '1'.repeat(64)});
  const adapter = createPeerIsolationLoopbackAdapter({node, policy, allowedEndpoints: []});
  const result = await adapter.round();
  assert.equal(result[0].reason, 'outside_local_allowlist'); assert.equal(calls, 0);
  assert.equal(policy.status().state, 'ISOLATED');
});

test('PI-06: an unsettled local transport operation prevents overlapping adapter rounds', async () => {
  const policy = new PeerIsolationPolicy();
  const endpoint = 'http://127.0.0.1:23457', identityId = '2'.repeat(64);
  policy.configurePeer({endpoint, expectedIdentityId: identityId});
  let resolveSync, calls = 0;
  const node = {syncPeer: () => { calls++; return new Promise(resolve => { resolveSync = resolve; }); }};
  const adapter = createPeerIsolationLoopbackAdapter({node, policy, allowedEndpoints: [endpoint]});
  const pending = adapter.round();
  assert.deepEqual(await adapter.round(), []); assert.equal(calls, 1);
  resolveSync({peer_id: identityId, adopted: false});
  assert.equal((await pending)[0].accepted, true);
});
