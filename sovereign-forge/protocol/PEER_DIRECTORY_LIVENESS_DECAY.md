# FAE Peer Directory — Retained-Peer Liveness Decay Gate

Status: **non-activated peer-management hardening candidate**.

This gate follows authenticated peer-directory retention. That gate prevents descriptor-only churn from displacing peers that have completed a real protocol-6 candidate probe. The remaining local failure mode is one-shot authentication pinning: a peer could authenticate once, disappear, and otherwise retain stronger eviction priority until descriptor expiry.

## Invariant

Authenticated retention is conditional on continuing liveness evidence. A past successful probe is useful history, but it is not permanent trust.

The eclipse candidate therefore uses a two-strike liveness rule:

- successful protocol-6 sync/probe: authenticate or refresh retention and reset the failure streak to zero;
- first consecutive failed probe: keep authenticated retention to tolerate transient jitter or a short partition;
- second consecutive failed probe: demote the exact identity + endpoint back to unverified retention;
- any later successful probe: restore authenticated retention and clear the failure streak.

The generic `PeerDirectory` does not practically opt into liveness demotion by default. The two-strike threshold is enabled by the eclipse-resistant candidate only.

## Why two strikes

Immediate demotion after one network failure would let ordinary packet loss or a brief route interruption erase useful retention too aggressively. No demotion at all would allow stale peers to pin capacity for the full descriptor lifetime.

Two consecutive failures is the current candidate compromise: transient tolerance without long-lived one-shot pinning.

## State and eviction

Directory records expose local runtime telemetry:

- `authenticated`;
- `authenticatedAt`;
- `consecutiveProbeFailures`;
- `lastProbeFailureAt`.

Re-gossip does not reset a failure streak. Only a successful real protocol-6 candidate probe resets it.

When the failure threshold is reached, the record loses authenticated eviction priority and immediately re-enters the unverified-record budget. If that budget is already full, normal bounded eviction may remove the stale record immediately.

Protected local provenance such as `self` remains a separate retention class and is not made authoritative by this mechanism.

## Evidence gate

The dedicated gate requires all of the following:

- one failed probe preserves authenticated retention;
- a second consecutive failure demotes it;
- a later success restores retention and clears the streak;
- re-gossip cannot erase accumulated liveness failures;
- a demoted stale record re-enters the unverified budget and can be displaced;
- a real candidate node promotes a live peer, then preserves it after one failed protocol-6 probe and demotes it after the second;
- previous authenticated-retention, admission-hardening, eclipse, protocol-6 topology, Independent Node, canonical-source and real-WAN gates remain GREEN;
- the public `fae-node-v6-candidate.mjs` remains outside this candidate path.

## Non-claims

This does not solve live Sybil collusion. An operator able to maintain many independently reachable protocol-6 identities can still consume authenticated capacity. The gate specifically removes the cheaper strategy of authenticate-once-then-disappear while keeping ordinary transient-failure tolerance.

It also does not establish AS/BGP independence, independent human operation, nation-state resistance, or long-duration Internet soak. Those remain external evidence classes.
