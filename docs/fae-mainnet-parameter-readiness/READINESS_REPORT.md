# FAE — Mainnet Consensus & Economic Parameter Readiness

## Terminal readiness result

**PARAMETER_SET_NOT_READY_TO_FREEZE**

The run reconciles the active testnet, block-time research, 300s candidate implementation, DP6/representative-device/HFB dependencies, Stability Soak state, exact atom arithmetic, fee semantics and freeze authority. It does not change consensus or economics.

### Executable truth

Public testnet v4 is bound to 180s, 10 FAE subsidy, 600,000-block eras and a 12,000,000 FAE hard cap. Integer atom halvings terminate at exactly **11,999,999.922 FAE**, 0.078 FAE below the geometric cap.

The active v4 transaction path does **not** enforce a 200-block coinbase maturity. It also computes transaction fees as input minus output but the active block-acceptance path pays the miner subsidy only; the residual fee is not added to coinbase.

### Research state

The dedicated 180s validation terminal verdict is **INSUFFICIENT_EVIDENCE**. No material 180s failure was established, but the mainnet-grade direct-evidence gate was not met.

300s remains the preferred research incumbent and has a strong non-activating candidate implementation: 14 FAE, 430,000-block eras, 12.04M geometric cap, exact terminal issuance 12,039,999.9484 FAE, 200-block candidate maturity, anchored-ASERT-style full-target DAA, fee-paying coinbase, fresh-genesis/profile binding. It remains NOT active consensus.

600s remains a research challenger. 900s is closed under the current research branch.

### What can already be frozen independently

Evidence is sufficient for the mechanical/policy constraints: 100,000,000 atoms per FAE; integer-atom deterministic rounding semantics; zero-premine/zero-VC/zero-insider/zero-treasury/zero-hidden-admin issuance; and fresh-genesis/network-domain separation as a mainnet constraint. Concrete production genesis values remain unset.

### Minimal blockers

1. Block-time selection evidence remains insufficient.
2. Mainnet fee destination and long-run security-budget assumptions are unresolved.
3. DP6 is STRONG_HEURISTIC__LOGIC_PPA_BOUND_CLOSED__MEMORY_ECONOMIC_BOUND_OPEN, with economic proposition WEAKENED_NOT_FALSIFIED / STILL_INCONCLUSIVE; ASIC Lab stays HOLD, NEW_AWS_INFORMATION_GAIN remains INSUFFICIENT_TO_REOPEN, and RP-B3-T3 is the GENUINE_EXTERNAL_EVIDENCE_GATE.
4. Representative-device physical evidence and physical HFB economics are not admitted.
5. Stability Soak V3 has not started; its preflight is prepared for the 2026-10-01 zero-cost checkpoint.
6. Coinbase maturity policy and real launch initial-difficulty calibration remain unresolved.

The exact future freeze contract is captured in FREEZE_CONTRACT_DRAFT.json. It is deliberately non-executing and requires separate parameter-selection and activation authority.
