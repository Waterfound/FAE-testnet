# FAE Peer Isolation & Eclipse Resistance — Operator Entrypoint Gate 4

Status: **executable, non-activated candidate**.

Gates 1–3 proved discovery starvation resistance, real protocol-6 recovery, promotion parity, and independent-host real-WAN `HOLD → READY → HOLD`. Gate 4 closes an operability gap: the eclipse-resistant candidate must be executable and observable without replacing the existing public v6 entrypoint or conflating operator readiness with consensus authority.

## Separate candidate entrypoint

`node/fae-node-v6-eclipse-candidate.mjs` is a new executable entrypoint. The existing `node/fae-node-v6-candidate.mjs` remains unchanged and continues to instantiate the base authoritative peer node.

The eclipse entrypoint explicitly instantiates `createAuthoritativeV4PeerNodeEclipseCandidate()` and retains the existing independent-node storage/recovery, node identity, DAA policy binding, durable checkpoint and shutdown semantics.

## Identity-bound peer configuration

The eclipse candidate does not accept legacy endpoint-only `FAE_PEERS` configuration. It requires JSON arrays containing endpoint plus expected cryptographic identity:

- `FAE_ECLIPSE_KNOWN_PEERS_JSON`
- `FAE_ECLIPSE_PINNED_PEERS_JSON`

This prevents an operator from accidentally downgrading the candidate to unauthenticated endpoint discovery while believing eclipse protections are active.

## Local read-only operator surface

A separate operator HTTP server is bound to loopback only. Non-loopback bind requests are rejected at startup.

Default:

- host: `127.0.0.1`
- port: `8790`

Routes:

- `GET /healthz` — process liveness only;
- `GET /readyz` — `200` only when the live eclipse peer-view assessment is `READY`, otherwise `503`;
- `GET /status` — read-only candidate status including live peer diversity, current chain state and durable-state metadata.

Any non-GET request returns `405`. The operator surface has no mining, wallet, chain mutation, sync trigger, peer mutation or consensus-control endpoint.

## Authority separation

The public protocol-6 server remains owned by the underlying authoritative node. Gate 4 explicitly verifies that its public `/status` does not gain `peer_view_authority` from the candidate wrapper. The eclipse-specific readiness view is available only through the separate loopback operator server and in-process candidate API.

Therefore:

- network consensus authority remains unchanged;
- public protocol-6 compatibility remains unchanged;
- operator readiness cannot be mistaken for a new consensus rule;
- merging Gate 4 does not activate the eclipse entrypoint on the public testnet or mainnet.

## Required evidence

Gate 4 is GREEN only if all of the following pass together:

1. the existing public v6 entrypoint test remains GREEN;
2. the promoted authoritative eclipse candidate topology remains GREEN;
3. the new executable candidate starts with protocol 6 and fail-closed `HOLD` when no anchor is live;
4. `GET /healthz` returns live process status;
5. `GET /readyz` returns `503` while the peer view is HOLD;
6. `GET /status` exposes `peer_view_authority = eclipse-resistant-candidate-v1` only on the operator surface;
7. POST/write attempts to the operator surface are rejected;
8. the public P2P `/status` remains free of candidate operator authority;
9. node identity persists across a clean restart;
10. endpoint-only `FAE_PEERS` is rejected;
11. non-loopback operator binding is rejected.

All-runs-must-pass.

## Non-claims

Gate 4 does not activate the candidate, prove long-duration soak, prove BGP/AS independence, or determine a final production monitoring architecture. It establishes that the proven eclipse policy can be run and observed with an explicit authority boundary.

The next meaningful gate after Gate 4 is activation rehearsal / deployment-shadow plumbing: run this separate executable candidate alongside the current public node against copied state and real peer configuration, compare chain decisions and readiness over time, and only after that consider any change to the public entrypoint.
