# FAE Peer Isolation & Eclipse Resistance — Authoritative Candidate Gate

Status: **non-activated authoritative networking candidate**.

Gate 1 proved bounded, pinned-first, diversity-first discovery behavior. Gate 2 proved the same behavior against real FAE protocol-6 sessions and the unchanged cumulative-work recovery path. This gate promotes only those peer-view semantics into `node/authoritative/*-candidate` modules.

## Authority boundary

The candidate has authority over **peer-view selection and liveness only when explicitly instantiated**. It has no independent consensus implementation. Block/header validation, common-ancestor discovery, cumulative-work fork choice, transaction reconciliation and secure protocol-6 transport continue to execute through the existing `createAuthoritativeV4PeerNode()` implementation.

The existing public v6 entrypoint is intentionally unchanged. Therefore merging this gate does not activate the candidate on the public testnet or mainnet.

## Promoted semantics

1. configured out-of-band identity anchors are a protected retention class;
2. candidate memory and endpoint fanout remain bounded;
3. probe budget is pinned-first and round-robins network groups;
4. signed descriptors alone never count as live diversity;
5. failed probes immediately remove that candidate from the live diversity assessment;
6. failed anchors remain known and retry with bounded exponential backoff;
7. healthy peers wait for re-probe, allowing fresh independent feelers to make progress;
8. readiness is fail-closed and is recomputed from current live successes.

## Required evidence

The gate is GREEN only when all of the following pass together:

- the frozen Gate-1 suite;
- the frozen Gate-2 real protocol-6 topology;
- the existing authoritative protocol-6 integration baseline;
- deterministic decision parity between the frozen lab implementation and the promoted authoritative discovery candidate;
- real protocol-6 `HOLD → READY → HOLD` topology using `createAuthoritativeV4PeerNodeEclipseCandidate()`;
- stronger valid anchor chain adoption through the unchanged authoritative cumulative-work path;
- no sticky READY after the anchor becomes unreachable.

All-runs-must-pass.

## Non-claims

A GREEN result does not yet prove independent Internet failure domains, AS/BGP independence, long-duration soak, or public-production suitability. It also does not authorize replacing `fae-node-v6-candidate.mjs` with the eclipse candidate.

The next evidence gate after this one is an executable candidate entrypoint plus independent real-WAN failure domains, reusing the existing zero-cost multi-runner/WAN machinery where possible.
