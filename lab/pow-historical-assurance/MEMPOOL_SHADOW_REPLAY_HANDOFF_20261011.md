# PF-12 — Production-core mempool shadow replay (Element 2)

**Snapshot:** 2026-10-11. **Scope:** research/assurance candidate only; source owner [PoW historical assurance #297](https://github.com/Waterfound/FAE-testnet/pull/297), exact base `bb2d244cd0c595f73a4ea7ac80f7286cc1f0e6c4`.

## Problem

A deterministic 4,096-entry cap limits memory, but currently rejects even an unrelated cryptographically valid **higher-fee** transaction when a zero-fee dependent chain saturates the pool. The existing nine counterfactual policy checks model abstract records, not the actual authoritative `acceptTxInto()` indexes and signed transactions.

## Admitted advance

`mempool-production-shadow-replay.test.mjs` imports the **real authoritative production-core functions** from the already existing candidate branch. It creates ephemeral Ed25519 wallets, signs a 4,096-deep zero-fee chain and independently signs a high-fee candidate. It establishes:

1. The real production-core admission path returns `mempool_full` while preserving all original state.
2. A **separate cloned state** can remove only one **leaf** pending transaction with atomic cleanup of `mempoolOrder`, `mempoolSpends`, `mempoolOutputs` and `transactions`, then admit the genuinely signed higher-fee independent transaction via the unchanged `acceptTxInto()` function.
3. Index consistency, capacity, original-state non-mutation and serializable restart shape hold for this **single leaf example**.
4. Non-leaf eviction is rejected instead of orphaning children; malformed signature cannot gain valid admission.

This is **NOT** a fee-policy implementation in a live node. No production or testnet acceptance function, template ordering, mining relay, consensus, persistence or API has been changed. It is one concrete falsifiable stepping stone from abstract Element 2 anti-pinning policy to actual runtime semantics.

## Critical exclusions

- A shadow state with one deliberately selected terminal leaf proves neither optimal fee policy nor arbitrary descendant-safe package eviction and eviction economics.
- A transaction could be reintroduced through network relay, mempool sync, reorg or restart; atomic canonical node propagation and adversarial peers are untested.
- PPLNS, high-hash attacker majority, economic security budget and strategic pool costs are separate hypotheses.
- Final fee priority, deterministic policy across peers, tradeoff against affordable web/mobile mining, acceptance timing and network resource exhaustion **require their own contract/approval**.
- This source wave must remain stacked on #297 rather than editing canonical v4 acceptance or declaring any mainnet historical PoW risk GREEN.

**Execution:** `node --test lab/pow-historical-assurance/mempool-production-shadow-replay.test.mjs`, with dedicated read-only GitHub Actions workflow. Preserve any red CI and rerun only on evidence that failure is provider-transient.

**Next:** decide an independently replayable candidate package policy under final fee/security budget, build controlled experimental node ingress behind a non-live feature fence, simulate reorg/restart/relay, then seek explicit authority before any active-node policy modification.
