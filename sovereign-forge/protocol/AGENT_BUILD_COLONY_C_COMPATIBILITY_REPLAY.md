# Agent Build Colony — Worker C: Compatibility & Replay

Status: **candidate-only / not active consensus**

Base commit: `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`

Worker C owns only the compatibility/replay software ceiling. It does not authorize a consensus activation height, economic schedule, public-node promotion, mainnet release, or modification of historical blocks.

## Compatibility rule

Historical bytes remain historical. The canonical public-testnet legacy prefix contains 11 checkpoint blocks whose original headers predate modern `tx_root` / `tx_count` commitments. Worker C therefore does **not** synthesize those fields or rewrite old headers.

Replay is intentionally composed as:

`genesis -> canonical legacy checkpoint/feed rules H1-H11 -> candidate activation validator H12+`

Height 12 is used only as the compact rehearsal boundary immediately after the immutable historical checkpoint set. It is not a proposed live activation height.

## Gates

Worker C is GREEN only if all of the following hold:

1. the real H1-H11 checkpoint set replays from empty state under canonical legacy-feed rules;
2. one-shot and split/stale replay produce the same semantic legacy-state digest;
3. the candidate suffix crosses the rehearsal activation boundary with the exact signed policy identity;
4. activated headers validate before activated bodies are accepted;
5. a late joiner at H11 reaches the same H13 tip/work as a genesis replay;
6. a stale node beginning at H5 catches up through H11 and then reaches the same candidate tip/work;
7. restart replay reconstructs the same tip/work without applying present-time arrival checks to historical blocks;
8. a mismatched activation policy fails closed;
9. existing peer-negotiation tests continue to prove same-policy compatibility, candidate-vs-legacy fail-closed behavior, channel binding and default legacy compatibility;
10. all participating modules remain `candidate-not-active-consensus`.

## Authority boundary

Worker C may add replay orchestration, tests, evidence and CI. It may not:

- rewrite legacy checkpoint headers;
- invent commitments absent from historical bytes;
- select a live activation height;
- change 300s / 14 FAE / 430,000-block candidate economics;
- activate 200-block coinbase maturity;
- touch the 96-hour evidence environment;
- promote candidate code to authoritative consensus;
- merge itself without independent verification and serialized integration.

The colony rule remains:

> **parallelize independent ceilings, serialize shared authority**
