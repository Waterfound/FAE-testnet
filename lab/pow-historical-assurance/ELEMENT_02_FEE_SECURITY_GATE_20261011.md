# Element 2 — Final Consensus & Economics Freeze: fee-security falsification gate

Status: **CANDIDATE-ONLY / MANDATORY HOLD RECOMMENDED**. Date: 2026-10-11. No new Element, activation, economic decision or mainnet authority created.

## Material source-bound negative result

Authoritative public-v4 FAE source has `PPLNS_COINBASE_ACTIVATION_HEIGHT=null`. Under the actual **unactivated** coinbase code, an independently signed transaction with 250,000 atoms in paid fees can be included in a valid mined block, but the actual miner receives the block subsidy only. The fee is subtracted from the transactor's spendable UTXO sum and is **not credited to miners**. This is the current explicit pre-activation rule; it is a falsification of the **claim that current-v4 transaction fees fund honest mining**, not an invalid block, a consensus-inflation vulnerability, or a claim about the final mainnet rules.

Independent direct one-output coinbase activation passed a **test-only override**: miner reward becomes subsidy + fee, issuance increases only by subsidy, and unactivated premature fee-paying coinbase is rejected. This shows a candidate mitigation path but **does not grant activation authority or demonstrate sufficient long-run security budget**.

**Reproduction** (exact-head CI on PR #310):
```sh
node --test lab/pow-historical-assurance/fee-security-budget-falsification.test.mjs
```
Test evidence: HPA-ECON-C1/C2/C3, valid legacy checkpoint replay, signed transaction and mined v4 headers, UTXO conservation. Source files `sovereign-forge/node/authoritative/fae-v4-core.mjs`, `pplns-activation.mjs`. Source-checkpoint `7c25b02419dd627f5dba4089a74c4dc2a2263d86`, workflow `38161780646`, 20/20 focused PASS, 5/5 workflows SUCCESS after one bounded transport retry; failures retained as evidence. The latter GREEN covers a candidate commit only.

## Existing Element placement and ownership

- **Element 2 / Final Consensus & Economics Freeze**: primary binding. HP-02 (DAA/timestamps), HP-03 (fee-aware mempool and miners' template), HP-05 (majority-work/fees/security budget), HP-06 (selfish mining and PPLNS/BWH/FAW/EFAW) each remain below terminal mainnet assurance. Add `COLLAPSE_CURRENT_V4_FEE_REVENUE_SECURITY_PREMISE` as a blocking *assumption* and `FUTURE_FEE_PAYOUT_PRODUCTION_PROOF_OPEN` as release gate. **No final fee/supply/consensus parameter selection is implied**.
- **Element 3 / Production Chain Identity & Genesis**: final genesis bytes, full subsidy/fees issuance and bootstrap no-hidden-issuance proofs must verify the final Element 2 fee rule; candidate v4 observations are not genesis closure.
- **Element 4 / Production Network**: genuine network propagation, peer eclipse/partition and fee-priority relay must be measured on the final topology; isolated local P2P parity is not the production routing proof.
- **DP6 specialization bound in its existing PoW/ASIC research owner**: independent economic-memory/specialization gate stays OPEN. No new FPGA/AWS test and no DP6 algo or resource budget modification is authorized by this finding. Fee payout collapse does **not** imply DP6 collapse.
- Other existing Elements: unchanged. Do not create a competing Element for this historical PoW assurance work.

## Element 2 acceptance conditions (fail closed until independently evidenced)

1. Exact future coinbase activation/fee policy approved under existing human authority; no change to the present public-testnet network from this research PR.
2. Real authorized peer and independent verifier demonstrate *mined block / signed tx fees / miner UTXO receipt / net circulation conservation* before and after restart, reorg, and peer propagation; premature activations rejected.
3. Fee-aware bounded full-mempool admission and dependency-topological template included in a **source-owned, isolated opt-in** node candidate, default behavior unchanged; adversarial signed-input, descendant, fee-conservation, restart, relay and reorg tests PASS.
4. Positive security-budget bounds depend on **explicit measured** honest hash, cost of majority capture, propagation, fees and future tokenomics (9 initial FAE, -45% per 630,000 blocks, 12.6M hard cap). No USD or honest hash-floor claim without supporting observations. If parameters are insufficient, declare `INSUFFICIENT_EVIDENCE` or `COLLAPSE` rather than waiver.
5. Test full BWH/FAW/EFAW/stubborn and selfish mining with source-derived share windows, stale job and withholding rates. Default PPLNS remains inactive; inactive private pool feature does not prevent third-party pools.
6. Exact final-head chain ID, DAA, genesis and multi-provider network tests complete; independent fail-closed source provenance and comparison with candidate branch passing. **No automatic DONE_MAINNET from candidate GREEN.**

## Execution disposition

W1 source and CI provenance — verified candidate at PR #297. W2 anti-pinning / fee templates — shadow candidate GREEN and original HTTP ingress vulnerable to full-pool fee pinning; source integration OPEN. W3 pool incentive attack models — open. W4 final mainnet proof — open. Existing HPA-UC-001 / Total Systems Steward owns candidate engineering. Any Work/Durable unattended claim must have its own real owner/wake receipt, not merely this document.

No canonical merge, active node mutation, production activation, consensus change, parameter freeze, new paid compute, credential/provider/permission changes or mainnet release authorized here.
