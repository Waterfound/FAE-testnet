# Agent Build Colony — Worker H: Integrator

Status: **isolated integration / not active consensus**

Frozen baseline: `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`

Worker H begins only after Worker G independently reproduces A-D as GREEN. H integrates candidates serially on `colony/h-integration-v1`; it does not grant consensus authority merely because a candidate can coexist in one tree.

## Integrated candidates

- B — state transition / wallet / UTXO / mempool / candidate coinbase maturity
- C — compatibility / real-genesis replay / late join / stale recovery
- D — activation network composition / partition / eclipse readiness / reconnect reorg
- G — immutable independent-verifier workflow and protocol evidence

A is inherited from the frozen baseline and is re-run on the integrated tree.

## Strong integration invariant

All Colony changes through this stage are **additive only** relative to the frozen baseline. The H gate rejects any modification, deletion or rename of pre-colony content. Therefore no existing consensus, economics, public-node entrypoint, 96-hour environment or network authority can be silently rewritten by the integration stage.

This is stricter than checking a short deny-list of consensus files: every path that existed at the baseline must remain byte-identical.

## Combined gate

H is GREEN only if:

1. the entire baseline-to-H diff consists only of added files;
2. a cross-worker invariant test proves A/B/C/D share the same compact rehearsal boundary while all new modules remain candidate-only;
3. Worker A's activation boundary, deep reorg, policy identity/negotiation, full activation and headers-first tests pass unchanged on the integrated tree;
4. B, C and D pass again on the same integrated checkout rather than isolated branches;
5. legacy bootstrap, real three-node partition/recovery and authoritative eclipse regression remain green;
6. canonical public-testnet economics remain `10 FAE`, `600000` legacy halving interval and `180s` target;
7. no candidate is wired into live consensus by this stage.

## Promotion rule

A GREEN H result means only:

`A-D software candidates coexist without regression and without modifying existing authority.`

It does **not** authorize:

- 300-second block time;
- 14 FAE subsidy;
- 430,000-block halving cadence;
- 200-block coinbase maturity;
- a live activation height;
- candidate-to-authoritative promotion;
- mainnet launch.

Only after H is GREEN may the colony proceed to E (Release & Reproducibility) and F (Mainnet Rehearsal Package).

> **Parallelize independent ceilings. Serialize shared authority. Promotion remains a separate decision.**
