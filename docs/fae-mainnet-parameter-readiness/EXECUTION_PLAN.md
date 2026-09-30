# FAE — Mainnet Consensus & Economic Parameter Readiness — Execution Plan

Source of executable truth: `Waterfound/FAE-testnet@3ae59d0d013af0ee518f3cfb73c5fcb08394b075`.

This is a real Build Colony readiness/reconciliation run. It cannot change consensus or economics and cannot activate, release, deploy, spend, select an activation height, or promote a mainnet candidate.

## Work decomposition

The run uses MPR-00 through MPR-12 as defined in BUILD_COLONY_RUN.json. Independent evidence acquisition/modeling proceeds in parallel where safe; any shared-state synthesis is serialized. Existing DP6/HFB/Representative Device/Stability Soak workstreams are consumed as evidence dependencies and are not duplicated.

## Evidence order

1. Reconstruct active testnet executable truth.
2. Compute exact atom-level issuance independently.
3. Reconcile block-time research, including the dedicated 180s branch and 300/600/900 research.
4. Reassess maturity, DAA, low-hashrate, propagation, stale/reorg, fees and security budget.
5. Verify fair-launch/genesis invariants.
6. Consume DP6/HFB/representative-device/Stability evidence without expanding their authority.
7. Build the dependency/decoupling graph.
8. Run independent Project Assurance against the synthesis.
9. Produce parameter-by-parameter freeze readiness and an exact future freeze contract, without executing it.

## Fail-closed classification

Every parameter must end in one of:
- PARAMETER_READY_TO_FREEZE
- PARAMETER_NEEDS_MORE_EVIDENCE
- PARAMETER_DEPENDS_ON_EXTERNAL_GATE
- PARAMETER_RESEARCH_ONLY
- PARAMETER_NOT_JUSTIFIED

Evidence roles remain distinct:
ACTIVE_TESTNET_AUTHORITY, RESEARCH_CANDIDATE, PREFERRED_RESEARCH_INCUMBENT, EVIDENCE_SUPPORTED, HEURISTIC_ONLY, UNRESOLVED, NOT_AUTHORIZED.

The run stops only at a genuine human/external gate, a fail-closed technical contradiction, or closure.
