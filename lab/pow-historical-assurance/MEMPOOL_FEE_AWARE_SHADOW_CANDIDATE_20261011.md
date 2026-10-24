# HPA-UC-001 / Element 2 — Fee-aware package admission candidate

Date: 2026-10-11. Mode: **candidate-only isolated shadow**. Parent: PR #306, which itself depends on PR #297. This does not replace FAE mainnet fee-economics authority, and does not change the live public v4 network.

## Problem and scope

An active-core mempool with 4096 pending zero-fee transactions rejects an independently signed valid high-fee transaction with `mempool_full`. A previous cloned-state leaf replay (PR #306) showed a single hand-selected leaf can be removed safely. This branch adds a separately importable, guarded **policy candidate** and negative regression suite.

New code: `mempool-fee-aware-shadow-candidate.mjs`; test: `mempool-fee-aware-shadow-candidate.test.mjs`.

Candidate algorithm:
1. Reconcile pending input/output/reservation indexes before any operation. Malformed original state fails closed.
2. Verify the incoming transaction signature, claimed identifiers, input ownership/availability, fee conservation and absence of input reservation before any eviction planning.
3. Build pending parent/child relations from actual indexed pending outputs. Consider bounded root-plus-descendant closure packages, with a default maximum package size of 128.
4. Require **positive aggregate fee increment** and **strictly higher fee density** than the proposed eviction package. Prefer minimum evicted fee density with deterministic stable tie resolution.
5. Remove the entire descendant-closed package from a **deep copy**, clean `transactions`, `mempoolOrder`, `mempoolSpends` and `mempoolOutputs`, admit the signed transfer using the unchanged authoritative `acceptTxInto`, then independently recheck indexes and capacity.
6. On rejection or invalid evidence: fail closed; source state remains unchanged. This is an experimental policy, not a promise that any arbitrary high-fee transaction will be admitted.

Reproduction:
```sh
node --test lab/pow-historical-assurance/mempool-production-shadow-replay.test.mjs
node --test lab/pow-historical-assurance/mempool-fee-aware-shadow-candidate.test.mjs
```

## Acceptance boundaries

Passing these tests would show isolated signed admission, index and descendant-closure coherence, deterministic fee candidate selection and negative defenses. It is **not** the HPA W2 acceptance contract. Explicitly NOT tested/proven by this branch:
- Integration into active `fae-node.mjs` ingress, peer relay, reintroduction or public-testnet consensus;
- Fee-sensitive mining block template with topological ancestor ordering and deterministic tie rules;
- Reorg and **real disk cold restart** of a node (JSON round-trip is only serialization-shape evidence);
- Peer divergence, stale inputs, adversarial computational complexity, BWH/FAW, fee-market viability or honest-miner profit;
- General economic optimality, final fee policy or mainnet release.

The bounded package size is deliberately fail-closed: heavily interdependent candidate packages may be skipped. Deterministic selection does not establish an economically final policy. No mainnet gate is closed.

## Next independently admitted steps

1. Use the existing signed regressions to falsify candidate policy assumptions with more adversarial ancestor/descendant DAGs, source reorg, restart and peer relay shapes, including property/stress tests.
2. Prepare a **non-live, feature-fenced node integration candidate** with isolated storage and fee-sensitive, dependency-topological template ordering. Compare consensus-validity and replay against unmodified source on exact head.
3. Reconcile source SHA/provenance blockers in PRs #296/#297 rather than rehashing blindly.
4. Extend the independent W3 strategic-mining branch: final PPLNS share/stale/job evidence, cost/propagation/tiebreak, BWH/FAW/EFAW negative sensitivity.
5. Await external freeze/reality evidence for terminal DP6 specialization, final DAA, genesis, network and security budget. No synthetic simulation can substitute for those gates.

Authority: draft PR and bounded candidate changes only. No canonical merge, activation, provider/credential mutation, paid capacity, mainnet or release. Owner: pre-existing HPA-UC-001 within the Total Systems Steward.
