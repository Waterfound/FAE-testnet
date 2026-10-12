# FAE — Independent Operator Readiness

Status: **SECONDARY / Durable Execution active**

Active portfolio workstream remains **FAE Research — 180s Economic + Block-Time Validation**. This branch is isolated from that research branch. Shared canonical state is serialized only after exact verification.

## Target

`INDEPENDENT_OPERATOR_EVIDENCE_PACKAGE_READY`

This target means the frozen contract, tooling, evidence bundle, verifier, clean-room rehearsal and operator instructions are complete. It does **not** mean `INDEPENDENT_OPERATOR_EVIDENCE_PASS`, `MAINNET_READY`, or `MAINNET_AUTHORIZED`.

## Frozen execution graph

| Frontier | Scope | Terminal condition |
| --- | --- | --- |
| IOR-00 | Inventory | Current runtime, evidence and hidden dependencies are mapped |
| IOR-01 | Definition | Independent operator and authority boundaries are frozen |
| IOR-02 | Bootstrap contract | Fresh-state inputs, outputs and failure conditions are frozen |
| IOR-03 | Provenance integration | Existing recovery/release provenance is reused without scope inflation |
| IOR-04 | Network evidence | Network, genesis, signed node identity, peers and tip are captured |
| IOR-05 | Restart/recovery | Controlled restart and peer/tip recovery are mandatory |
| IOR-06 | Bundle | Machine-readable, checksummed evidence bundle is emitted |
| IOR-07 | Verifier | Deterministic fail-closed verifier emits bounded verdicts |
| IOR-08 | Adversarial | Wrong/copy/partial/tampered evidence cannot obtain PASS |
| IOR-09 | Rehearsal | Fresh disposable real-process rehearsal passes as READINESS_REHEARSAL_ONLY |
| IOR-10 | Operator package | A competent third party can execute without private conversation state |
| IOR-11 | Cross-check | Existing node/recovery/provenance invariants and the new package verify together |
| IOR-12 | Closure | Readiness closes without claiming external evidence |
| IOR-X | External | Eligible real independent operator executes frozen package; outside readiness closure |

## Bootstrap rule

The package does not select final production bootstrap nodes. The future run receives an explicit eligible peer endpoint as a public/admitted input and proves the node authenticated at least one peer on the expected network. A node process merely running, or an isolated node, cannot pass.

## Provenance rule

The verifier is invoked with the exact expected source revision, run challenge, operator identity and evidence class. A copied bundle, stale revision or different run challenge fails closed.

## Rehearsal boundary

The internal rehearsal deliberately uses `READINESS_REHEARSAL_ONLY`. It exercises the real P2P v6 process, fresh state, sync, signed identity, tip progression, restart and durable recovery, but can never satisfy IOR-X.

## Closure boundary

On successful IOR-12:

- `readiness_complete = true`
- `independent_operator_evidence_obtained = false`
- `mainnet_ready = false`
- `mainnet_authorized = false`
- `consensus_changed = false`
- `economics_changed = false`
- `new_spending_authorized = false`
