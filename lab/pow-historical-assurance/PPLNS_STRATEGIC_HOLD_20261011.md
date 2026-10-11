# HPA-UC-001 W3 — PPLNS strategic risk remains gated

**Date:** 2026-10-11. **Owner:** FAE Historical PoW Assurance (Systems private issue #26). **Scope:** public, non-secret, read-only candidate regression. Stacked on FAE PR #297 exact SHA `bb2d244cd0c595f73a4ea7ac80f7286cc1f0e6c4`.

## Falsification result, not vulnerability closure

The real FAE `ShareLedger` uses a last-2048-admitted-share window. A miner can keep submitting ordinary valid shares while privately withholding a full-difficulty solution: the coordinator has no observation of an undisclosed solution. In a synthetic 2048-share window with 512 attacker shares, that worker retains **25%** nominal weight immediately after withholding a block. After 512 new honest shares, attacker weight remains 384; after replacement of the entire window, it reaches zero. Validity/hash of synthetic ledger appends is NOT modeled here: real coordinator's `submitShare` independently checks proofs before `append`. This experiment tests bookkeeping and the inherent withheld-full-block information gap, not share admission.

The default PPLNS candidate remains **inactive** (`PPLNS_COINBASE_ACTIVATION_HEIGHT=null`). The existing coordinator refuses to issue work while its activation flag is disabled. The standalone guard and negative tests fail closed if that source default changes; they are **not yet a mandatory merge or deployment gate**. Do not infer that external third-party off-chain pools cannot exist.

### Reproduce
```sh
node --test lab/pow-historical-assurance/pplns-strategic-risk-guard.test.mjs
```

## Security disposition

- **CANDIDATE:** PPLNS currently inactive; no active FAE multi-output pool-specific risk was introduced by this assurance code.
- **RISK REMAINS:** BWH, FAW and EFAW may be economically viable. Withholding of undisclosed full work cannot be ruled out by PPLNS share-ledger integrity. The previously observed 140-cell profitability sensitivity is not a FAE final-state proof.
- **NOT DONE:** end-to-end authenticated share/job/stale-tip scenarios, fork races, timestamp/latency, actual pool opportunity cost, multi-pool games, mainnet policy/release, or third-party pool economics.
- **NEXT:** Build a timing-bound FAE-specific adversarial coordinator/job simulator using real source constants, then calibrate external propagation, fee demand, future block-time/DAA and total mining costs. Independently maintain the mainnet activation HOLD until exact, authorized acceptance criteria are evidenced.

No source consensus/economic change, pool activation, mainnet authority, merge, provider credential change or paid spending.

## Element 2 handoff — source-level downstream-block-failure accounting

The 2026-10-11 W3 extension adds two real source-path tests to `pplns-strategic-risk-guard.test.mjs`:

- **HPA-W3-07:** when an isolated opt-in `ShareCoordinator` finds a valid, real-hashed full-target nonce, `submitShare` appends the validated share to the durable `ShareLedger` *before* calling `blockSubmitter`. If the downstream block submission fails, the API call rejects but the share remains counted, and replay of the same nonce does not double-credit it.
- **HPA-W3-08:** a chain-tip change before share submission rejects the stale job *before* the share ledger is mutated.

**Observed boundary, not a proved exploitable loss:** some pool policies intentionally reward valid work independently of whether a block propagates successfully. These source-level results demonstrate the ordering and the lack of atomic rollback of the credited share on a failed block submission. They do **not** show profitability of BWH/FAW/EFAW or prove mainnet pool safety. `PPLNS_COINBASE_ACTIVATION_HEIGHT` remains `null`; all opt-in activation and downstream failure are local fixture-only.

**Existing Element 2 / strategic-mining acceptance gate:** decide the proper share-credit rule for valid full-target proof when network submission fails; execute adversarial retry, late submission, stale-tip and multi-pool economic models with explicit costs and source-backed bounds. Keep PPLNS inactive pending full review. This is linked to the fee-budget Collapse test in candidate PR #310, whose false current-v4 miner fee-revenue assumption is independent from these pool accounting observations.

No consensus, reward rule, deployment, active testnet, provider or mainnet mutation.
