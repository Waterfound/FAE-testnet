# Agent Build Colony — Worker G: Independent Verifier

Status: **verification-only / no integration authority**

Frozen baseline: `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`

Frozen candidate heads:

- Worker B: `46aa7de21a658a26c4607ad7514fcce210ef9568`
- Worker C: `99364b91a75c04413cd63d8d44088e2487eb64d6`
- Worker D: `848fbd89bc1a0bf565b20b7d14ac2890b837e8c0`

Worker G does not trust a builder's GREEN result. It checks out immutable revisions into separate workspaces and reproduces the evidence directly.

## Independent checks

1. **Ownership scope** — every B/C/D diff against the frozen baseline must contain exactly the four declared files for that worker. Extra files are a verifier failure.
2. **Shared-authority immutability** — `fae-v4-core.mjs`, activation/reorg, difficulty/timestamp and headers-sync candidate modules must remain byte-identical to the frozen baseline in every builder checkout.
3. **Economic non-activation** — the canonical public-testnet constants remain the baseline values (`10 FAE`, `600000`-block legacy halving interval and `180s` target) because no colony builder is authorized to activate the preferred future economics.
4. **Worker A reproduction** — rerun pre-colony activation boundary, deep reorg, policy identity/peer negotiation, full activation and headers-first tests from the baseline itself.
5. **Worker B reproduction** — syntax + state transition/maturity/wallet/mempool/reorg test from the frozen B head.
6. **Worker C reproduction** — syntax + real-genesis compatibility replay + independent legacy bootstrap + policy-negotiation test from the frozen C head.
7. **Worker D reproduction** — syntax + activation/network composition + the pre-colony real three-node partition test + authoritative eclipse test + deep activation reorg test from the frozen D head.
8. **Non-activation markers** — all new candidate modules must still identify themselves as `candidate-not-active-consensus`.

## Decision rule

Worker G emits PASS only if every independent checkout and every reproduced gate passes. A builder's own CI success is useful evidence but is not sufficient.

Worker G has **no authority to merge**. A PASS only authorizes Worker H to begin serialized integration.

> **Builders propose. Verifier reproduces. Integrator decides.**
