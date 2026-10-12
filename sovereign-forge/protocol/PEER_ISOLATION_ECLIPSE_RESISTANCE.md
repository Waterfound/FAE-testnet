# FAE Peer Isolation & Eclipse Resistance Lab

Status: **research / candidate only**. This lab has no consensus, testnet, mainnet, mining, wallet, PPLNS, genesis, DAA, tokenomics, or activation authority.

## Purpose

The existing protocol-6 peer stack already authenticates peer identities, binds endpoint identity through persistent TOFU, uses encrypted peer sessions, rate-limits abusive remote addresses, validates signed short-lived peer descriptors, and measures peer diversity across identity and network groups.

This lab targets a narrower pre-authentication failure mode: **discovery starvation**. A peer can possess many valid signing identities. Therefore signatures alone do not prevent a descriptor flood from consuming discovery memory or probe budget before an honest out-of-band peer is authenticated.

The lab candidate must preserve an operator-configured identity anchor and spend probe budget across independent network groups instead of accepting a Sybil-heavy discovery prefix.

## Frozen invariants for Gate 1

A Gate-1 PASS requires all of the following:

1. **Protected anchor retention** — an identity explicitly pinned out-of-band survives bounded-directory churn while evictable ordinary records exist.
2. **Pinned-first probing** — an eligible pinned anchor receives probe priority.
3. **Diversity-first probing** — one network group cannot consume the first probe round merely by supplying many identities.
4. **Fail-closed readiness** — many authenticated identities across several groups do not make the gate READY if the required pinned anchor is unavailable.
5. **Bounded retry** — a failed anchor remains known and is retried after bounded exponential backoff rather than disappearing from the candidate set.
6. **Independent feeler progress** — healthy established peers waiting for re-probe do not starve a fresh independent candidate.
7. **Identity fanout bound** — one signer cannot consume unbounded records by advertising many endpoints.
8. **Disconnect degradation** — losing the live anchor immediately moves readiness to HOLD until a fresh successful probe.
9. **Bounded memory** — adversarial identity churn cannot grow the candidate store past its configured limit.

All-runs-must-pass. Any failed assertion is a Gate-1 failure.

## Candidate design

`node/lab/peer-isolation-eclipse-candidate.mjs` is intentionally outside the authoritative node path.

It composes the existing `PeerDiversityPolicy` with a bounded discovery record set and adds:

- a protected class for configured pinned identity IDs;
- eviction order that sacrifices unauthenticated ordinary records before authenticated ordinary records and preserves pinned records last;
- bounded endpoint fanout per identity;
- a group-round-robin probe scheduler with pinned groups first;
- per-candidate bounded exponential failure backoff;
- explicit authenticated/live state, so descriptors alone never count as peer diversity;
- a fail-closed readiness assessment delegated to the existing diversity policy.

## Threats intentionally exercised

Gate 1 covers locally reproducible discovery-layer pressure:

- hundreds of signed identities attempting directory churn;
- a dense Sybil cluster in one IPv4 /24;
- Sybil identities spread across multiple network groups;
- temporary loss of the pinned anchor;
- attacker-controlled ordinary peers remaining healthy while an independent peer first appears;
- one identity advertising many endpoints.

## Non-claims

A Gate-1 PASS does **not** prove complete eclipse resistance on the public Internet. In particular it does not prove:

- AS-level or BGP-path independence;
- independence from DNS, hosting, tunnel, cloud, ISP, or certificate infrastructure;
- resistance to an attacker controlling the configured out-of-band anchor itself;
- real multi-provider network diversity;
- 6h/24h soak behavior;
- production adequacy of the current HTTP transport;
- that the lab candidate should be activated in the authoritative peer node.

It also does not alter the cumulative-work fork-choice rule. Peer diversity governs *which views are sought and considered*, not which valid chain wins after validation.

## Gate sequence

### Gate 1 — discovery starvation resistance

Run:

```sh
node --test sovereign-forge/tests/peer-isolation-eclipse-resistance.mjs
```

The dedicated GitHub Actions workflow also reruns the pre-existing authoritative peer-diversity and P2P-security suites to detect regressions.

### Gate 2 — authoritative-node integration

Only after Gate 1 is GREEN should the smallest equivalent behavior be plumbed into `fae-v4-peer-node.mjs`. Gate 2 must then use real protocol-6 nodes and prove that:

- an honest pinned peer remains reachable under descriptor churn;
- ordinary peers can dominate the apparent peer population without suppressing the anchor probe;
- anchor loss is observable as HOLD rather than silent readiness;
- after reconnect, a fresh authenticated session can expose a higher-work honest chain and the existing validated recovery path reconverges without manual state repair.

### Gate 3 — real-WAN / independent failure domains

If Gate 2 remains GREEN, reuse the already established zero-cost multi-runner/WAN evidence pattern. This is the point to test topology independence that one process or one machine cannot establish.

## Authority boundary

This document and its candidate are evidence scaffolding. A green workflow is permission to continue testing, **not** permission to activate a new networking policy on the public testnet or mainnet.
