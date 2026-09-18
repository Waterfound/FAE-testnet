# Agent Build Colony — Worker B: State Transition

Status: **candidate-only / not active consensus**

Base commit: `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`

Worker B owns only the software-only state-transition ceiling. It does not activate the 300-second block interval, 14 FAE subsidy, 430,000-block halving cadence, 200-block coinbase maturity, any new difficulty rule, or any mainnet/testnet consensus change.

## Purpose

Exercise the mechanics that a future versioned activation would need across wallet/UTXO/mempool state without granting authority to the candidate. The oracle deliberately separates **state semantics** from block validity, signatures, PoW and release authority.

## Candidate policy exercised

- Activation boundary is parameterized and tested at `H-2/H-1/H/H+1/H+2`.
- Legacy coinbases created before `H` preserve the legacy maturity policy.
- Candidate coinbases created at or after `H` use a candidate maturity of **200 blocks**.
- Maturity is bound to the **creation height** of the coinbase output, so an activation cannot retroactively make previously created outputs less spendable.
- Exact maturity boundary is tested: a coinbase created at height 4 is spendable at height 204, not before.

The value `200` is a mechanism candidate only. This file does not authorize it for live consensus.

## Gates

Worker B is GREEN only if all of the following hold:

1. deterministic full replay reconstructs the same state digest after restart;
2. UTXO conservation rejects overspend and duplicate/conflicting inputs;
3. wallet view distinguishes confirmed, spendable and immature coinbase value;
4. pending dependency chains can be replayed deterministically;
5. reorg across the activation boundary rebuilds state from the replacement branch;
6. disconnected transactions return to mempool only when their inputs remain valid and unconflicted;
7. conflicting disconnected transactions are deterministically dropped;
8. the candidate remains explicitly `candidate-not-active-consensus`;
9. canonical `fae-v4-core.mjs` economic constants remain untouched by this worker.

## Authority boundary

This worker may add a candidate oracle, tests, evidence and CI only. It may not:

- modify canonical consensus constants;
- promote the candidate into the public node entrypoint;
- change economic issuance;
- change live coinbase semantics;
- write into the 96-hour evidence environment;
- merge itself into `main` without independent verification/integration.

The colony rule remains:

> **parallelize independent ceilings, serialize shared authority**
