import {createHmac, randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {performance} from 'node:perf_hooks';
import {networkGroupForEndpoint} from '../authoritative/peer-diversity.mjs';

export const PEER_ISOLATION_SCOPE = 'lab-only-no-consensus-authority';
export const PEER_ISOLATION_DEFAULTS = Object.freeze({
  maxCandidates: 64, maxConfigured: 16, maxHintsPerSource: 8,
  maxHintsPerGroup: 8, maxHintsPerIdentity: 2, maxHintsPerCall: 64,
  maxInFlight: 4, maxAttemptsPerWindow: 8, attemptWindowMs: 10_000,
  freshMs: 120_000, refreshMs: 30_000, retryBaseMs: 1_000,
  retryMaxMs: 60_000, probeTimeoutMs: 10_000, hintTtlMs: 600_000,
  maxSelected: 8, maxPerGroup: 2, minIdentities: 3,
  minNetworkGroups: 3, minAnchors: 1,
});
const ID = /^[0-9a-f]{64}$/;

export function normalizeLabPeerEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('invalid_peer_endpoint');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('invalid_peer_endpoint');
  return url.origin;
}

function canonicalAddress(value) {
  const bare = String(value).replace(/^\[|\]$/g, '');
  if (!isIP(bare)) throw new Error('invalid_transport_address');
  const host = new URL(isIP(bare) === 6 ? `http://[${bare}]` : `http://${bare}`).hostname.replace(/^\[|\]$/g, '');
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return host;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

// remoteAddress belongs to the local transport adapter, never a peer payload.
export function transportGroup(endpoint, remoteAddress = null) {
  const host = new URL(normalizeLabPeerEndpoint(endpoint)).hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host) ? canonicalAddress(host) : null;
  const address = remoteAddress === null ? literal : canonicalAddress(remoteAddress);
  if (literal && address !== literal) throw new Error('transport_address_mismatch');
  if (address === null) return 'unknown:unresolved';
  if (address === '::1' || address.startsWith('127.')) return 'local:loopback';
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'local:private';
    if (a === 0 || a >= 224) throw new Error('unusable_transport_address');
    return networkGroupForEndpoint(`http://${address}`);
  }
  if (/^f[cd]/.test(address) || /^fe[89ab]/.test(address)) return 'local:private';
  if (address === '::' || address.startsWith('ff')) throw new Error('unusable_transport_address');
  return networkGroupForEndpoint(`http://[${address}]`);
}

export class PeerIsolationPolicy {
  #records = new Map();
  #key;
  #now;
  #lastNow = -Infinity;
  #sequence = 0;
  #windowStart = null;
  #windowAttempts = 0;
  #lastAnchorReservation = -Infinity;
  #pins;

  constructor({limits = {}, pinnedIdentityIds = [], now = () => performance.now(), selectionKey = randomBytes(32)} = {}) {
    for (const key of Object.keys(limits)) if (!Object.hasOwn(PEER_ISOLATION_DEFAULTS, key)) throw new Error(`unknown_limit:${key}`);
    this.limits = Object.freeze({...PEER_ISOLATION_DEFAULTS, ...limits});
    for (const [name, value] of Object.entries(this.limits)) {
      const minimum = name === 'minAnchors' ? 0 : 1;
      if (!Number.isSafeInteger(value) || value < minimum || value > 10_000_000) throw new Error(`invalid_limit:${name}`);
    }
    if (this.limits.refreshMs >= this.limits.freshMs || this.limits.retryBaseMs > this.limits.retryMaxMs ||
        this.limits.hintTtlMs < this.limits.freshMs || this.limits.maxSelected < this.limits.minIdentities ||
        this.limits.maxSelected < this.limits.minNetworkGroups || this.limits.maxSelected < this.limits.minAnchors) {
      throw new Error('inconsistent_limits');
    }
    if (typeof now !== 'function' || !Buffer.isBuffer(selectionKey) || selectionKey.length < 32) throw new Error('invalid_local_policy_context');
    if (!Array.isArray(pinnedIdentityIds) || pinnedIdentityIds.length > this.limits.maxConfigured ||
        pinnedIdentityIds.some(id => !ID.test(id))) throw new Error('invalid_local_pins');
    this.#pins = new Set(pinnedIdentityIds);
    this.#key = Buffer.from(selectionKey);
    this.#now = now;
  }

  #time() {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER) throw new Error('invalid_monotonic_time');
    if (now < this.#lastNow) {
      for (const row of this.#records.values()) {
        row.lastSuccess = null; row.pending = null;
        row.nextAttempt = now + this.limits.retryBaseMs;
        row.lastAttempt = null;
      }
      this.#windowStart = now; this.#windowAttempts = this.limits.maxAttemptsPerWindow;
      this.#lastNow = now;
      throw new Error('monotonic_clock_regressed');
    }
    this.#lastNow = now;
    if (this.#windowStart === null || now - this.#windowStart >= this.limits.attemptWindowMs) {
      this.#windowStart = now; this.#windowAttempts = 0;
    }
    for (const [endpoint, row] of this.#records) {
      if (row.pending && row.pending.deadline <= now) this.#fail(row, now);
      if (!row.configured && row.expiresAt <= now && !row.pending) this.#records.delete(endpoint);
    }
    return now;
  }

  #rank(label) { return createHmac('sha256', this.#key).update(label).digest('hex'); }
  #fresh(row, now) { return row.lastSuccess !== null && now - row.lastSuccess < this.limits.freshMs; }
  #anchor(row) { return this.#pins.has(row.identityId ?? row.expectedIdentityId); }
  #newRecord(endpoint, expectedIdentityId, configured, sourceGroup, now) {
    return {endpoint, expectedIdentityId, configured, sourceGroup,
      hintGroup: transportGroup(endpoint), group: 'unknown:unresolved',
      identityId: null, expiresAt: now + this.limits.hintTtlMs,
      lastSuccess: null, lastAttempt: null, nextAttempt: now, failures: 0, pending: null};
  }

  // Only local operator configuration calls this method. Gossip uses admitHints.
  configurePeer({endpoint, expectedIdentityId = null}) {
    const now = this.#time(), normalized = normalizeLabPeerEndpoint(endpoint);
    if (expectedIdentityId !== null && !ID.test(expectedIdentityId)) throw new Error('invalid_expected_identity');
    const current = this.#records.get(normalized);
    if (current?.configured) {
      if (current.expectedIdentityId !== expectedIdentityId) throw new Error('configured_identity_change_requires_review');
      return false;
    }
    if ([...this.#records.values()].filter(row => row.configured).length >= this.limits.maxConfigured) throw new Error('configured_capacity');
    // A local override starts with no inherited gossip liveness or identity.
    this.#records.set(normalized, this.#newRecord(normalized, expectedIdentityId, true, 'local-configuration', now));
    return true;
  }

  admitHints(hints, {sourceEndpoint} = {}) {
    const now = this.#time();
    const source = this.#records.get(normalizeLabPeerEndpoint(sourceEndpoint));
    if (!source || !this.#fresh(source, now)) return {accepted: 0, examined: 0, reason: 'source_not_live'};
    if (!Array.isArray(hints)) return {accepted: 0, examined: 0, reason: 'invalid_hint_list'};
    const examined = Math.min(hints.length, this.limits.maxHintsPerCall);
    let accepted = 0;
    for (let index = 0; index < examined; index++) {
      const hint = hints[index];
      let endpoint, candidate;
      try {
        endpoint = normalizeLabPeerEndpoint(hint?.endpoint);
        if (!ID.test(hint?.identityId)) continue;
        if (this.#records.has(endpoint)) continue; // no expiry, retry, pin or identity overwrite
        candidate = this.#newRecord(endpoint, hint.identityId, false, source.group, now);
      } catch { continue; }
      const discovered = [...this.#records.values()].filter(row => !row.configured);
      if (discovered.length >= this.limits.maxCandidates ||
          discovered.filter(row => row.sourceGroup === source.group).length >= this.limits.maxHintsPerSource ||
          discovered.filter(row => row.hintGroup === candidate.hintGroup).length >= this.limits.maxHintsPerGroup ||
          discovered.filter(row => row.expectedIdentityId === hint.identityId).length >= this.limits.maxHintsPerIdentity) continue;
      this.#records.set(endpoint, candidate); accepted++;
    }
    return {accepted, examined, truncated: hints.length > examined};
  }

  nextProbeBatch({limit = this.limits.maxInFlight} = {}) {
    const now = this.#time();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxInFlight) throw new Error('invalid_probe_batch_limit');
    const rows = [...this.#records.values()];
    const slots = Math.min(limit, this.limits.maxInFlight - rows.filter(row => row.pending).length,
      this.limits.maxAttemptsPerWindow - this.#windowAttempts);
    const eligible = rows.filter(row => !row.pending && row.nextAttempt <= now);
    const selected = [], groups = new Map();
    while (selected.length < slots && eligible.length) {
      const reserveAnchor = selected.length === 0 &&
        now - this.#lastAnchorReservation >= Math.max(this.limits.refreshMs, this.limits.attemptWindowMs * 2);
      eligible.sort((a, b) => {
        // Periodically reserve an anchor probe; an unavailable anchor must not
        // monopolize even a one-slot scheduler. Other opportunities rotate.
        const anchorOrder = reserveAnchor ? Number(this.#anchor(b)) - Number(this.#anchor(a)) : 0;
        return anchorOrder || (groups.get(a.hintGroup) || 0) - (groups.get(b.hintGroup) || 0) ||
          (a.lastAttempt ?? -Infinity) - (b.lastAttempt ?? -Infinity) ||
          this.#rank(`probe:${this.#sequence}:${a.endpoint}`).localeCompare(this.#rank(`probe:${this.#sequence}:${b.endpoint}`));
      });
      const row = eligible.shift();
      if (reserveAnchor && this.#anchor(row)) this.#lastAnchorReservation = now;
      this.#sequence++;
      const probeId = this.#rank(`lease:${this.#sequence}:${row.endpoint}`);
      row.pending = {probeId, deadline: now + this.limits.probeTimeoutMs};
      row.lastAttempt = now;
      this.#windowAttempts++;
      groups.set(row.hintGroup, (groups.get(row.hintGroup) || 0) + 1);
      selected.push({endpoint: row.endpoint, expectedIdentityId: row.expectedIdentityId,
        probeId, deadline: row.pending.deadline});
    }
    return selected;
  }

  #lease(probe) {
    const row = this.#records.get(probe?.endpoint);
    return row?.pending && row.pending.probeId === probe.probeId ? row : null;
  }
  #fail(row, now) {
    row.pending = null; row.lastSuccess = null;
    row.failures = Math.min(32, row.failures + 1);
    const delay = Math.min(this.limits.retryMaxMs, this.limits.retryBaseMs * 2 ** (row.failures - 1));
    row.nextAttempt = now + delay;
  }

  completeProbe(probe, {identityId, remoteAddress = null} = {}) {
    const now = this.#time(), row = this.#lease(probe);
    if (!row) return {accepted: false, reason: 'stale_or_unleased_completion'};
    let group;
    try { group = transportGroup(row.endpoint, remoteAddress); }
    catch (error) { this.#fail(row, now); return {accepted: false, reason: error.message}; }
    if (!ID.test(identityId) || (row.expectedIdentityId !== null && row.expectedIdentityId !== identityId) ||
        (row.identityId !== null && row.identityId !== identityId)) {
      this.#fail(row, now); return {accepted: false, reason: 'identity_mismatch'};
    }
    row.identityId = identityId; row.expectedIdentityId = identityId;
    row.group = group; row.lastSuccess = now; row.failures = 0; row.pending = null;
    row.nextAttempt = now + this.limits.refreshMs;
    row.expiresAt = now + this.limits.hintTtlMs;
    return {accepted: true};
  }

  failProbe(probe) {
    const now = this.#time(), row = this.#lease(probe);
    if (!row) return false;
    this.#fail(row, now); return true;
  }

  #select(now) {
    const eligible = [...this.#records.values()].filter(row => this.#fresh(row, now));
    const selected = [], ids = new Set(), groups = new Map();
    while (eligible.length && selected.length < this.limits.maxSelected) {
      const needsAnchor = selected.filter(row => row.pinned).length < this.limits.minAnchors;
      eligible.sort((a, b) => (needsAnchor ? Number(this.#anchor(b)) - Number(this.#anchor(a)) : 0) ||
        (groups.get(a.group) || 0) - (groups.get(b.group) || 0) ||
        Number(a.group === 'unknown:unresolved') - Number(b.group === 'unknown:unresolved') ||
        this.#rank(`select:${a.endpoint}`).localeCompare(this.#rank(`select:${b.endpoint}`)));
      const row = eligible.shift();
      if (ids.has(row.identityId) || (groups.get(row.group) || 0) >= this.limits.maxPerGroup) continue;
      ids.add(row.identityId); groups.set(row.group, (groups.get(row.group) || 0) + 1);
      selected.push({endpoint: row.endpoint, identityId: row.identityId,
        networkGroup: row.group, pinned: this.#anchor(row), lastSuccess: row.lastSuccess});
    }
    return selected;
  }

  selectSyncPeers() { return this.#select(this.#time()); }

  status() {
    const now = this.#time(), selected = this.#select(now);
    const groups = new Set(selected.map(row => row.networkGroup).filter(group => group !== 'unknown:unresolved'));
    const anchors = selected.filter(row => row.pinned).length;
    const reasons = [];
    if (selected.length < this.limits.minIdentities) reasons.push('insufficient_fresh_identities');
    if (groups.size < this.limits.minNetworkGroups) reasons.push('insufficient_transport_groups');
    if (anchors < this.limits.minAnchors) reasons.push('missing_local_anchor');
    const rows = [...this.#records.values()];
    return {scope: PEER_ISOLATION_SCOPE,
      state: selected.length === 0 ? 'ISOLATED' : reasons.length ? 'DEGRADED' : 'DIVERSE_LOCAL_EVIDENCE',
      reasons, freshObservations: rows.filter(row => this.#fresh(row, now)).length,
      selectedIdentities: selected.length, selectedTransportGroups: groups.size, selectedAnchors: anchors,
      configured: rows.filter(row => row.configured).length,
      candidates: rows.filter(row => !row.configured).length,
      inFlight: rows.filter(row => row.pending).length, attemptsInWindow: this.#windowAttempts,
      consensusAuthority: false, externalWanProof: false, operatorIndependenceProven: false,
      eclipseResistanceProven: false};
  }
}
