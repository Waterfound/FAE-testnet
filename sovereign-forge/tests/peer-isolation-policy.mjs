import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerIsolationPolicy, transportGroup, normalizeLabPeerEndpoint} from '../node/lab/peer-isolation-policy.mjs';

const id = n => n.toString(16).padStart(64, '0');
const endpoints = ['http://192.0.2.10', 'http://198.51.100.10', 'http://203.0.113.10'];
function fixture(options = {}) {
  let time = 1_000_000;
  const policy = new PeerIsolationPolicy({now: () => time, selectionKey: Buffer.alloc(32, 7), pinnedIdentityIds: [id(1)], ...options});
  return {policy, advance: ms => { time += ms; }, setTime: value => { time = value; }};
}
function configure(policy, rows = endpoints.map((endpoint, index) => ({endpoint, expectedIdentityId: id(index + 1)}))) {
  for (const row of rows) policy.configurePeer(row);
}
function completeBatch(policy, overrides = () => ({})) {
  const batch = policy.nextProbeBatch();
  for (const probe of batch) assert.equal(policy.completeProbe(probe, {identityId: probe.expectedIdentityId, ...overrides(probe)}).accepted, true);
  return batch;
}
function discover(policy, count, offset = 0, sourceEndpoint = endpoints[0]) {
  return policy.admitHints(Array.from({length: count}, (_, index) => ({
    endpoint: `http://198.18.${index + offset}.10`, identityId: id(100 + index + offset),
    pinned: true, networkGroup: `untrusted:${index}`, authenticated: true,
  })), {sourceEndpoint});
}

test('PI-01 / PI-12: configuration and hints are not live evidence or a security verdict', () => {
  const {policy} = fixture(); configure(policy);
  assert.equal(policy.status().state, 'ISOLATED');
  assert.equal(policy.completeProbe({endpoint: endpoints[0], probeId: 'unsolicited'}, {identityId: id(1)}).accepted, false);
  assert.equal(policy.admitHints([{endpoint: 'http://192.0.2.20', identityId: id(4)}], {sourceEndpoint: endpoints[0]}).reason, 'source_not_live');
  completeBatch(policy);
  assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
  assert.equal(discover(policy, 3).accepted, 3);
  assert.equal(policy.status().freshObservations, 3);
  assert.equal(policy.status().selectedIdentities, 3);
  for (const key of ['consensusAuthority', 'externalWanProof', 'operatorIndependenceProven', 'eclipseResistanceProven']) assert.equal(policy.status()[key], false);
});

test('PI-02: evidence is invalid at the exact TTL boundary', () => {
  const {policy, advance} = fixture(); configure(policy); completeBatch(policy);
  advance(policy.limits.freshMs - 1); assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
  advance(1); assert.equal(policy.status().state, 'ISOLATED');
  completeBatch(policy); assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
});

test('PI-02 / PI-07: failed refresh removes liveness immediately; retry obeys backoff', () => {
  const {policy, advance} = fixture(); configure(policy); completeBatch(policy);
  advance(policy.limits.refreshMs);
  const probes = policy.nextProbeBatch();
  for (const probe of probes) assert.equal(policy.failProbe(probe), true);
  assert.equal(policy.status().state, 'ISOLATED');
  assert.deepEqual(policy.nextProbeBatch(), []);
  advance(policy.limits.retryBaseMs - 1); assert.deepEqual(policy.nextProbeBatch(), []);
  advance(1); completeBatch(policy);
  assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
});

test('PI-03: identity aliases, including across transport groups, count only once', () => {
  const {policy} = fixture();
  configure(policy, endpoints.map(endpoint => ({endpoint, expectedIdentityId: id(1)})));
  completeBatch(policy);
  const status = policy.status();
  assert.equal(status.freshObservations, 3); assert.equal(status.selectedIdentities, 1);
  assert.equal(status.selectedTransportGroups, 1); assert.equal(status.state, 'DEGRADED');
});

test('PI-03 / PI-11: mapped IPv4, loopback, private addresses and ports cannot fabricate groups', () => {
  assert.equal(transportGroup('http://192.0.2.10'), transportGroup('http://[::ffff:192.0.2.10]:8787'));
  assert.equal(transportGroup('http://[2001:db8:abcd::1]'), transportGroup('http://[2001:db8:abcd:ffff::4]:8787'));
  assert.equal(transportGroup('http://127.0.0.1:1001'), transportGroup('http://[::1]:1002'));
  assert.equal(transportGroup('http://127.10.2.1'), 'local:loopback');
  assert.equal(transportGroup('http://10.1.2.3'), transportGroup('http://192.168.4.5'));
  assert.throws(() => transportGroup('http://192.0.2.10', '203.0.113.10'), /mismatch/);
  assert.throws(() => transportGroup('http://0.0.0.0'), /unusable/);
});

test('PI-03: unrelated DNS names remain unknown until the local adapter supplies transport evidence', () => {
  const {policy, advance} = fixture();
  const dns = ['alpha.invalid', 'beta.example', 'gamma.test'].map((name, index) => ({endpoint: `https://${name}`, expectedIdentityId: id(index + 1)}));
  configure(policy, dns); completeBatch(policy);
  assert.equal(policy.status().selectedTransportGroups, 0);
  assert.equal(policy.status().state, 'DEGRADED');
  advance(policy.limits.refreshMs);
  completeBatch(policy, probe => ({remoteAddress: new URL(endpoints[dns.findIndex(row => row.endpoint === probe.endpoint)]).hostname}));
  assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
});

test('PI-04 / PI-06: discovery cannot consume configured capacity or create pinning', () => {
  const {policy} = fixture({limits: {maxCandidates: 3}});
  configure(policy, [{endpoint: endpoints[0], expectedIdentityId: id(1)}]); completeBatch(policy);
  assert.equal(discover(policy, 10).accepted, 3);
  configure(policy, [{endpoint: endpoints[1], expectedIdentityId: id(2)}, {endpoint: endpoints[2], expectedIdentityId: id(3)}]);
  assert.equal(policy.status().configured, 3); assert.equal(policy.status().candidates, 3);
  const forged = policy.admitHints([{endpoint: endpoints[0], identityId: id(99), pinned: true}], {sourceEndpoint: endpoints[0]});
  assert.equal(forged.accepted, 0);
  completeBatch(policy); completeBatch(policy);
  assert.equal(policy.status().selectedAnchors, 1);
  assert.equal(policy.selectSyncPeers().find(row => row.endpoint === endpoints[0]).identityId, id(1));
});

test('PI-04: enough local anchors are retained without sacrificing available group diversity', () => {
  const {policy} = fixture({pinnedIdentityIds: [id(1), id(4), id(5)], limits: {maxSelected: 3}});
  configure(policy, [
    ...endpoints.map((endpoint, index) => ({endpoint, expectedIdentityId: id(index + 1)})),
    {endpoint: 'http://192.0.2.11', expectedIdentityId: id(4)},
    {endpoint: 'http://192.0.2.12', expectedIdentityId: id(5)},
  ]);
  completeBatch(policy); completeBatch(policy);
  assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
  assert.equal(policy.status().selectedTransportGroups, 3);
});

test('PI-05: separate source identities in one transport group share an admission quota', () => {
  const {policy} = fixture({limits: {maxHintsPerSource: 3}});
  configure(policy, [{endpoint: endpoints[0], expectedIdentityId: id(1)}, {endpoint: 'http://192.0.2.11', expectedIdentityId: id(2)}]);
  completeBatch(policy);
  assert.equal(discover(policy, 3).accepted, 3);
  assert.equal(discover(policy, 3, 20, 'http://192.0.2.11').accepted, 0);
  assert.equal(policy.status().candidates, 3);
});

test('PI-05 / PI-06: group, identity, per-call and expiry limits remain independent', () => {
  const {policy, advance} = fixture({limits: {maxHintsPerGroup: 3, maxHintsPerIdentity: 2, maxHintsPerSource: 16, maxHintsPerCall: 4}});
  configure(policy, [{endpoint: endpoints[0], expectedIdentityId: id(1)}]); completeBatch(policy);
  const batch = Array.from({length: 12}, (_, i) => ({endpoint: `http://198.51.100.${20 + i}`, identityId: id(100 + i)}));
  const result = policy.admitHints(batch, {sourceEndpoint: endpoints[0]});
  assert.deepEqual(result, {accepted: 3, examined: 4, truncated: true});
  const aliases = [20, 21, 22].map(i => ({endpoint: `http://198.18.${i}.10`, identityId: id(300)}));
  assert.equal(policy.admitHints(aliases, {sourceEndpoint: endpoints[0]}).accepted, 2);
  assert.equal(policy.status().candidates, 5);
  advance(policy.limits.hintTtlMs);
  assert.equal(policy.status().candidates, 0); assert.equal(policy.status().configured, 1);
});

test('PI-06: outstanding leases and attempt windows bound repeated calls', () => {
  const {policy, advance} = fixture({limits: {maxInFlight: 2, maxAttemptsPerWindow: 3}});
  configure(policy);
  const first = policy.nextProbeBatch(); assert.equal(first.length, 2);
  assert.equal(policy.status().inFlight, 2); assert.deepEqual(policy.nextProbeBatch(), []);
  for (const probe of first) policy.failProbe(probe);
  const last = policy.nextProbeBatch(); assert.equal(last.length, 1); policy.failProbe(last[0]);
  advance(2000); assert.deepEqual(policy.nextProbeBatch(), []);
  assert.equal(policy.status().attemptsInWindow, 3);
  advance(policy.limits.attemptWindowMs); assert.equal(policy.nextProbeBatch().length, 2);
});

test('PI-07: expired completions cannot revive a lease or supersede a later attempt', () => {
  const {policy, advance} = fixture(); configure(policy, [{endpoint: endpoints[0], expectedIdentityId: id(1)}]);
  const old = policy.nextProbeBatch()[0];
  advance(policy.limits.probeTimeoutMs);
  assert.equal(policy.completeProbe(old, {identityId: id(1)}).accepted, false);
  assert.equal(policy.status().inFlight, 0);
  advance(policy.limits.retryBaseMs);
  const newer = policy.nextProbeBatch()[0]; assert.notEqual(old.probeId, newer.probeId);
  assert.equal(policy.completeProbe(old, {identityId: id(1)}).accepted, false);
  assert.equal(policy.completeProbe(newer, {identityId: id(1)}).accepted, true);
  assert.equal(policy.completeProbe(newer, {identityId: id(1)}).accepted, false);
});

test('PI-07: retries are capped and repeated hints do not reset cooldown', () => {
  const {policy, advance} = fixture({limits: {retryBaseMs: 10, retryMaxMs: 40, attemptWindowMs: 10}});
  configure(policy, [{endpoint: endpoints[0], expectedIdentityId: id(1)}]); completeBatch(policy);
  assert.equal(discover(policy, 1).accepted, 1);
  for (const delay of [10, 20, 40, 40]) {
    const [probe] = policy.nextProbeBatch(); assert.ok(probe); policy.failProbe(probe);
    assert.equal(discover(policy, 1).accepted, 0);
    advance(delay - 1); assert.deepEqual(policy.nextProbeBatch(), []);
    advance(1);
  }
  const [recovery] = policy.nextProbeBatch(); assert.ok(recovery);
  assert.equal(policy.completeProbe(recovery, {identityId: id(100)}).accepted, true);
});

test('PI-07: fixed candidates are eventually probed under a small rotating budget', () => {
  const {policy, advance} = fixture({limits: {maxInFlight: 2, maxAttemptsPerWindow: 2, attemptWindowMs: 1000}});
  configure(policy, Array.from({length: 8}, (_, i) => ({endpoint: `http://198.18.${i}.10`, expectedIdentityId: id(i + 1)})));
  const seen = new Set();
  for (let round = 0; round < 8; round++) {
    for (const probe of policy.nextProbeBatch()) { seen.add(probe.endpoint); policy.failProbe(probe); }
    advance(1000);
  }
  assert.equal(seen.size, 8);
});

test('PI-08: restart and regressed time invalidate freshness including anchors', () => {
  const {policy, setTime} = fixture(); configure(policy); completeBatch(policy);
  assert.equal(policy.status().state, 'DIVERSE_LOCAL_EVIDENCE');
  const restarted = fixture().policy; configure(restarted);
  assert.equal(restarted.status().state, 'ISOLATED');
  setTime(999_000); assert.throws(() => policy.status(), /clock_regressed/);
  assert.equal(policy.status().state, 'ISOLATED');
  assert.deepEqual(policy.nextProbeBatch(), []);
});

test('PI-07: an unavailable anchor cannot monopolize a one-slot scheduler', () => {
  const {policy, advance} = fixture({limits: {maxInFlight: 1, maxAttemptsPerWindow: 1, attemptWindowMs: 1000}});
  configure(policy);
  const seen = new Set();
  for (let round = 0; round < 6; round++) {
    for (const probe of policy.nextProbeBatch()) { seen.add(probe.endpoint); policy.failProbe(probe); }
    advance(1000);
  }
  assert.equal(seen.size, 3);
});

test('PI-09: local keyed ordering is reproducible and independent of input ordering', () => {
  const rows = Array.from({length: 8}, (_, i) => ({endpoint: `http://198.18.${i}.10`, expectedIdentityId: id(i + 1)}));
  const left = fixture().policy, right = fixture().policy;
  configure(left, rows); configure(right, [...rows].reverse());
  assert.deepEqual(left.nextProbeBatch(), right.nextProbeBatch());
  const selections = new Set();
  for (let seed = 0; seed < 16; seed++) {
    const policy = fixture({selectionKey: Buffer.alloc(32, seed)}).policy; configure(policy, rows);
    selections.add(policy.nextProbeBatch().map(row => row.endpoint).join(','));
  }
  assert.ok(selections.size > 1, 'different local keys must not select one universal public ordering');
});

test('PI-03 / PI-04: mismatched identity and transport evidence fail closed', () => {
  const {policy, advance} = fixture(); configure(policy); completeBatch(policy);
  advance(policy.limits.refreshMs);
  for (const probe of policy.nextProbeBatch()) {
    const verdict = policy.completeProbe(probe, {identityId: id(900), remoteAddress: new URL(probe.endpoint).hostname});
    assert.equal(verdict.reason, 'identity_mismatch');
  }
  assert.equal(policy.status().state, 'ISOLATED');
  advance(policy.limits.retryBaseMs);
  const probes = policy.nextProbeBatch();
  assert.equal(policy.completeProbe(probes[0], {identityId: probes[0].expectedIdentityId, remoteAddress: '203.0.113.99'}).accepted, false);
  assert.throws(() => policy.configurePeer({endpoint: endpoints[0], expectedIdentityId: id(999)}), /requires_review/);
});

test('PI-06: invalid policy limits and ambiguous endpoint forms are rejected', () => {
  for (const limits of [{maxCandidates: 0}, {maxInFlight: Infinity}, {retryBaseMs: 60001}, {refreshMs: 120000}, {maxSelected: 2}, {unknown: 1}, {toString: 3}]) {
    assert.throws(() => new PeerIsolationPolicy({limits}));
  }
  for (const endpoint of ['ftp://example.org', 'http://user:pass@example.org', 'http://example.org/a', 'http://example.org?x=1', 'http://example.org/#tag']) {
    assert.throws(() => normalizeLabPeerEndpoint(endpoint));
  }
  assert.equal(normalizeLabPeerEndpoint('HTTP://192.0.2.10:80/'), 'http://192.0.2.10');
});
