# FAE Peer Isolation & Eclipse Resistance — Real-WAN Gate 3

Status: **zero-cost, non-activated, real-WAN evidence gate**.

Gate 1 froze deterministic discovery-starvation resistance. Gate 2 proved real protocol-6 `HOLD → READY → HOLD` behavior locally. The Authoritative Candidate Gate promoted the proven peer-view semantics without changing consensus or the public v6 entrypoint. Gate 3 moves that candidate across independent GitHub-hosted machines and ephemeral public transports.

## Frozen topology

The workflow creates six independent jobs around an ephemeral GitHub issue used only as a rendezvous record:

- **O1** — ordinary protocol-6 peer, independent runner, Cloudflare Quick Tunnel;
- **O2** — ordinary protocol-6 peer, independent runner, localhost.run;
- **O3** — ordinary protocol-6 peer, independent runner, Pinggy raw-TCP tunnel;
- **ANCHOR** — persistent-identity protocol-6 peer holding a valid stronger chain;
- **OBSERVER** — independently verifies public reachability, four distinct Linux boot IDs, and three ordinary endpoint network groups before isolation;
- **CONTROLLER/VICTIM** — runs `createAuthoritativeV4PeerNodeEclipseCandidate()` and executes the eclipse/recovery sequence.

The Pinggy tunnel is raw TCP. The FAE protocol remains HTTP/protocol-6 end to end; Pinggy supplies only an ephemeral TCP address. No tunnel provider is imported by the FAE authoritative node or candidate implementation.

## Required sequence

1. Four remote peer jobs publish ephemeral endpoint, cryptographic identity, tunnel provider, height and Linux boot ID.
2. The observer confirms all four endpoints are simultaneously reachable and that the three ordinary peers classify into three distinct network groups.
3. The controller tells the anchor to enter the isolation phase.
4. The anchor stops its FAE process while keeping the public tunnel alive. Its endpoint therefore stays stable but no valid FAE peer exists behind it.
5. The victim authenticates all three ordinary peers over the public WAN and fails the pinned-anchor probe. Required state: `HOLD`, `livePinned = 0`, three authenticated ordinary identities, three ordinary network groups, height 11.
6. The same anchor process restarts from durable state with the same cryptographic identity, same local port and same public tunnel. It retains the valid height-13 stronger chain.
7. After bounded retry the victim must establish a fresh protocol-6 session, authenticate the expected anchor identity, adopt the stronger chain through the unchanged headers-first/cumulative-work path, and become `READY` at height 13.
8. The anchor is stopped again behind the still-live tunnel. After the healthy re-probe interval the victim must return to `HOLD` with `livePinned = 0` while retaining the already validated height-13 chain.
9. The controller publishes machine-readable evidence and signals all ephemeral hosts to shut down. The rendezvous issue is closed.

All-runs-must-pass.

## Transport diversity

Three different public endpoint suffix families are deliberately required for the ordinary peers so the existing conservative DNS grouping does not mistake three ephemeral tunnels from one provider for three independent network groups.

- Cloudflare Quick Tunnel → `*.trycloudflare.com`
- localhost.run → `*.localhost.run`, `*.lhr.life`, or `*.lhrtunnel.link`
- Pinggy TCP → a `*.pinggy.link` / `*.pinggy.online` TCP address represented as `http://host:port` because the raw tunnel forwards the FAE node's own HTTP server unchanged

If any provider is unavailable, the Gate-3 workflow fails rather than silently collapsing to fewer network groups. That is an infrastructure failure, not a protocol PASS.

## Authority boundary

The workflow explicitly checks that:

- `node/fae-node-v6-candidate.mjs` still does not import the eclipse candidate;
- Cloudflare, localhost.run and Pinggy names do not appear in the authoritative consensus/core node or eclipse candidate;
- the real-WAN harness remains under tests/workflow paths only.

Thus a Gate-3 PASS is evidence for the candidate, not activation permission.

## What Gate 3 can establish

A GREEN run materially strengthens evidence for:

- liveness fail-closed across actual WAN transport;
- recovery from peer-view isolation without manual chain-state repair;
- anchor identity continuity across process restart;
- resistance to an ordinary peer population that remains fully reachable while the out-of-band anchor is absent;
- non-sticky readiness after a second anchor loss;
- execution across distinct hosted-machine boot domains rather than multiple processes on one machine.

## Non-claims

Gate 3 still does not prove global BGP/AS independence, nation-state routing resistance, immunity to compromise of the configured anchor, or production-grade long-duration Internet soak. GitHub-hosted runners are independent ephemeral machines but not independent human operators. Those claims remain out of scope.
