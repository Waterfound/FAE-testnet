# FAE Peer Isolation & Eclipse Resistance — Gate 2

Status: **research-only protocol-6 integration evidence**. No production/testnet/mainnet activation authority.

Gate 1 is frozen on `main` and proved that the candidate discovery policy resists descriptor starvation in a deterministic local harness. Gate 2 asks a stronger question: does the same policy still behave correctly when its probes are real FAE protocol-6 sessions and chain synchronization uses the existing authoritative validation path?

## Frozen topology

The Gate-2 executable topology contains:

- one victim node using the research composition layer;
- three reachable ordinary protocol-6 peers in distinct IPv4 /24 groups;
- one out-of-band pinned protocol-6 anchor in a fourth /24;
- an initial period in which the anchor endpoint is offline;
- a later reconnect of the same anchor identity and endpoint;
- a valid stronger chain held by the anchor;
- a second anchor loss after recovery.

The three ordinary peers are sufficient to satisfy the identity and network-group counts except for the required out-of-band anchor. This intentionally tests that a superficially diverse peer population cannot silently satisfy readiness while the anchor is absent.

## Required observations

Gate 2 passes only if all of these are observed in the executable test:

1. The offline anchor probe fails as a real network operation.
2. All three ordinary peers remain reachable and authenticate successfully.
3. The victim reports `HOLD` with `livePinned = 0`, despite three authenticated identities in three network groups.
4. The anchor restarts with the same cryptographic identity and endpoint.
5. A fresh protocol-6 session to the anchor succeeds after bounded retry.
6. The existing headers-first / cumulative-work validation path adopts the anchor's stronger valid chain.
7. The victim reaches `READY` only after the live pinned anchor returns.
8. A subsequent anchor loss returns readiness to `HOLD`; READY must not remain sticky.
9. The already validated chain remains intact while network-view readiness degrades independently.

## Research composition

`node/lab/peer-isolation-protocol6-candidate.mjs` wraps the existing authoritative protocol-6 node without changing its consensus or fork-choice implementation. The wrapper supplies only:

- Gate-1 discovery retention and probe scheduling;
- live-success / live-failure accounting for the eclipse-readiness assessment;
- explicit known and pinned peer records for the test topology.

Every block/header decision remains inside `fae-v4-peer-node.mjs` and its existing `preferred(...)` cumulative-work path.

## Non-claims

A Gate-2 PASS does not establish Internet-scale eclipse resistance, AS diversity, BGP independence, independent cloud/provider failure domains, or long-duration soak behavior. It also does not activate the wrapper as a public node entrypoint.

A PASS authorizes the next narrow step: move only the proven retention/probe/liveness semantics into the authoritative peer node, rerun the same topology against that implementation, and then take the gate to independent real-WAN failure domains.
