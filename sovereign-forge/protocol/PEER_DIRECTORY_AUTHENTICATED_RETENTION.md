# FAE Peer Directory — Authenticated Retention Gate

Status: **non-activated peer-management hardening candidate**.

This gate follows Peer Isolation & Eclipse Resistance real-WAN Gate 3 and the peer-directory admission-hardening gate. The earlier admission gate bounds any one authenticated gossip source and any one network group. This gate addresses the next composition problem: many distinct gossip sources across many distinct groups can each remain below those local quotas while collectively churning the descriptor-only directory.

## Invariant

A signed peer descriptor is a discovery hint, not proof that the advertised endpoint is reachable or that the identity behind it can complete the FAE protocol.

The directory therefore distinguishes:

- **unverified record** — a valid signed descriptor admitted from discovery but not yet proven by the eclipse candidate;
- **authenticated record** — the exact descriptor identity + endpoint has subsequently completed a successful authoritative protocol-6 candidate sync/probe;
- **protected source record** — locally protected provenance such as the node's own `self` descriptor.

Authentication here is retention evidence only. It grants no consensus, fork-choice, mining, wallet, coordinator, or activation authority.

## Candidate policy

The eclipse-resistant candidate opts into:

- hard global directory ceiling: unchanged;
- per-gossip-source ceiling: 64 records;
- per-network-group ceiling: 32 records;
- descriptor-only / unverified ceiling: 256 records;
- protected local source: `self`.

The generic `PeerDirectory` keeps its previous effective defaults unless a caller explicitly opts into stricter admission parameters.

## Promotion rule

A directory record is promoted to authenticated retention only after `createAuthoritativeV4PeerNodeEclipseCandidate()` successfully completes `node.syncPeer()` for the expected descriptor identity and endpoint.

A mere signed descriptor, repeated gossip, source rotation, DNS diversity, or a matching identity string cannot promote a record.

The promotion is local runtime evidence. Re-gossip of the same identity + endpoint does not erase authentication and cannot move an authenticated record into a different untrusted source quota bucket. Locally protected provenance may still supersede untrusted provenance. Identity endpoint fanout prefers an already authenticated endpoint over unverified alternates.

## Eviction rules

Bounds remain hard:

1. protected local provenance has the strongest retention rank;
2. authenticated records outrank descriptor-only records;
3. descriptor-only records are removed first under source, group, unverified, and global pressure;
4. authenticated retention never bypasses the hard global directory ceiling;
5. descriptor expiration still prunes authenticated records.

If the directory is already entirely occupied by retained authenticated records, a new descriptor may be evicted before it can be promoted. This is intentional fail-bounded behavior rather than allowing discovery churn to make memory unbounded. Normal descriptor expiry provides eventual turnover.

## Evidence gate

The dedicated test topology requires all of the following:

- many distinct gossip sources in many distinct DNS groups cannot exceed the unverified-record budget or evict an existing authenticated record;
- re-gossip cannot erase prior authentication evidence or reassign a verified record into an attacker-controlled source bucket;
- endpoint fanout for one identity retains its authenticated endpoint ahead of unverified alternates;
- authenticated records remain subject to the hard global ceiling;
- a real protocol-6 candidate probe promotes the exact directory record only after successful sync;
- generic directory defaults remain behavior-compatible when the new retention policy is not enabled;
- previous admission-hardening and eclipse-isolation regressions remain GREEN;
- the public `fae-node-v6-candidate.mjs` still does not import the eclipse candidate.

## Non-claims

This gate does **not** make authentication equivalent to honesty or Sybil resistance. An operator controlling many live protocol-6 identities can still consume authenticated capacity. It raises the cost of descriptor-only quota laundering from cheap signed advertisement to live protocol participation, while preserving hard bounds and authenticated honest-peer retention.

It also does not prove BGP/AS independence, independent human operation, long-duration Internet soak, or resistance to compromise of configured anchors. Those remain separate evidence classes.
