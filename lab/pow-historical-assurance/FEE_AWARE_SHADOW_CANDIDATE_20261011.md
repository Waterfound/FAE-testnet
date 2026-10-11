# HPA-UC-001: Fee-aware production-core shadow-policy candidate (2026-10-11)

**Status:** NON-ACTIVATING CANDIDATE, stacked on FAE #306 -> #297. No active-node, consensus, fee policy, wallet, or mainnet mutation.

## Verified source weakness and corrective hypothesis

The v4 core checks the 4,096-entry mempool cap before examining a signed incoming transaction. A full zero-fee dependent chain can reject an independently signed high-fee transfer. Previous PR #306 reproduces this against the actual production core and demonstrates a one-leaf shadow cleanup.

This candidate adds a separate opt-in rehearsal module. It checks real signed FAE transactions, derives fees from currently spendable indexed outputs, models pending ancestry and descendant closures, preserves incoming ancestors, requires a BigInt fee increment and strictly better package fee rate, removes the complete chosen closure on a clone, then invokes unchanged authoritative acceptTxInto. It rejects bad signatures and indexed-state corruption before effects; the caller's live state is never mutated.

A separate candidateFeeOrderedTxids routine explores fee-prioritized, ancestor-preserving template selection. It does NOT replace the canonical FIFO template.

## Negative and exact-source verification

Dedicated read-only Node 22 CI tests signed 4,096-entry saturation, invalid signatures, zero fees, protected ancestors, index corruption, clone stability and fee-prioritized templates. Exact CI results must be inspected before claiming any PASS.

## Explicit remaining risk

No claim of mainnet readiness, comprehensive fee policy, live admission, relay/reorg/restart correctness, attacker churn resistance, final incentives or performance boundedness beyond the static 4,096 cap. Worst-case closure scanning can be quadratic in the bounded mempool; measure hostile DAG/fanout and replacement churn before proposing activation. Real-node, multi-peer, reorg and fee-security-budget gates remain separate.

Other historical PoW gates remain: DP6 specialization economics, final DAA, final genesis, majority-work economics, selfish/stubborn/BWH/FAW/EFAW/PPLNS, launch-state object poisoning, and production routing/partitions.

**Authority:** No merge, no activation, no consensus or economic selection, no production/release/mainnet, no paid spend, no provider/credential mutation.
