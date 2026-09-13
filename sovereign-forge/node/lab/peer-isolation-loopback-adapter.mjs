import {PeerIsolationPolicy, normalizeLabPeerEndpoint} from './peer-isolation-policy.mjs';

export const LOOPBACK_ADAPTER_SCOPE = 'lab-only-fixed-loopback-allowlist';

// This stage does not integrate with production discovery or change fork choice.
// The allowlist is populated by the local test from nodes it has just started.
export function createPeerIsolationLoopbackAdapter({node, policy, allowedEndpoints}) {
  if (!(policy instanceof PeerIsolationPolicy) || typeof node?.syncPeer !== 'function') throw new Error('invalid_lab_adapter');
  if (!Array.isArray(allowedEndpoints) || allowedEndpoints.length > policy.limits.maxConfigured) throw new Error('invalid_lab_allowlist');
  const allowed = new Set(allowedEndpoints.map(endpoint => {
    const normalized = normalizeLabPeerEndpoint(endpoint), url = new URL(normalized);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port) throw new Error('lab_requires_literal_loopback_endpoint');
    return normalized;
  }));
  let running = false;
  return {
    scope: LOOPBACK_ADAPTER_SCOPE,
    async round() {
      if (running) return [];
      running = true;
      try {
        const results = [];
        for (const probe of policy.nextProbeBatch()) {
          if (!allowed.has(probe.endpoint)) {
            policy.failProbe(probe);
            results.push({accepted: false, reason: 'outside_local_allowlist'});
            continue;
          }
          try {
            // syncPeer already checks expected identity, encrypted session and
            // downloaded chain data. Hints are not auto-dialed by this method.
            const sync = await node.syncPeer(probe.endpoint, {source: 'peer-isolation-lab', expectedIdentityId: probe.expectedIdentityId});
            const verdict = policy.completeProbe(probe, {identityId: sync.peer_id, remoteAddress: new URL(probe.endpoint).hostname});
            results.push({endpoint: probe.endpoint, ...verdict, sync});
          } catch (error) {
            policy.failProbe(probe);
            results.push({endpoint: probe.endpoint, accepted: false, reason: error.code || error.message});
          }
        }
        return results;
      } finally { running = false; }
    },
  };
}
