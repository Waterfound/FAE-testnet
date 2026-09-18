# FAE – Mining Tip Sync & Stale Work Recovery Lab

This Lab closes the browser-miner stale-work gap without using block-time changes as a correctness mechanism.

## Current frontier

- MTS-00 — Boundary Freeze
- MTS-01 — Baseline Reproduction

During this frontier, active runtime files are protected. In particular, `mining.js` must remain byte-identical to the integration base. Candidate miner edits are intentionally gated until the current bug is reproduced deterministically.

## Authority

Network state is authoritative. The current v4 backend already exposes `height` and `tip_hash` through `/status`, while direct templates bind work to `header.height` and `header.previous_hash`.

A cross-tab mechanism such as BroadcastChannel may later accelerate revalidation, but it cannot become chain authority.

Snapshot semantics remain intact: mempool-only changes do not invalidate existing PoW work. Chain-tip changes do.

## MTS-01 reproduction

Run:

```bash
node lab/mining-tip-sync/baseline-reproduction.mjs
```

The test executes the current unmodified `core.js` and `mining.js` in a deterministic VM harness with a controllable Worker and network.

It proves two baseline behaviors:

1. a normal `refresh()` can observe a newer `height + tip_hash` while the existing PoW Worker continues hashing the old parent;
2. stale work is rejected only after the old Worker produces a solution and the client submits it, while manual Worker stop followed by a new direct iteration reacquires a fresh template.

The harness performs no real mining and uses no wallet secrets.
